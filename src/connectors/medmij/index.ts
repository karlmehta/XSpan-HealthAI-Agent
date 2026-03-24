// ============================================================
// MyHealthSpan Agent — Netherlands MedMij Connector
// Patient-directed health data access via PGO (Persoonlijke
// Gezondheidsomgeving / Personal Health Environment)
//
// MedMij is purpose-built for third-party apps pulling patient
// records with consent — the exact model MyHealthSpan uses.
//
// Docs: https://www.medmij.nl/ | https://www.nictiz.nl/
// FHIR profiles: HL7 FHIR NL (NICTIZ)
// ============================================================

export interface MedMijConfig {
  clientId: string;
  clientSecret: string;
  pgoName: string;              // Our registered PGO name
  apiUrl: string;               // MedMij infrastructure URL
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export interface MedMijSession {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  patientId: string;
}

// MedMij Gegevensdiensten (data services) available
export type MedMijDataService =
  | 'BasisgegevensZorg'         // Basic care data (GP summary)
  | 'Medicatieoverzichten'      // Medication overview
  | 'Laboratoriumresultaten'    // Lab results
  | 'Allergieintoleranties'     // Allergies & intolerances
  | 'Vaccinaties'               // Vaccinations
  | 'Meetwaarden'               // Measurements (vitals)
  | 'PDFDocumenten'             // PDF documents (letters, reports)
  | 'Afspraken'                 // Appointments
  | 'Verwijzingen';             // Referrals

export class MedMijClient {
  private config: MedMijConfig;

  constructor(config: MedMijConfig) {
    this.config = config;
    console.log(`[MedMij] PGO client initialized: ${config.pgoName} (${config.environment})`);
  }

  /**
   * Step 1: Get the list of available healthcare providers (Zorgaanbieders).
   * MedMij maintains a whitelist of participating providers.
   */
  async getProviderList(): Promise<{ id: string; name: string; fhirEndpoint: string }[]> {
    console.log('[MedMij] Fetching provider whitelist (Zorgaanbiederslijst)...');
    const resp = await fetch(`${this.config.apiUrl}/zal`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) throw new Error(`[MedMij] Provider list failed: ${resp.status}`);
    const data = await resp.json() as { zorgaanbieders: { id: string; naam: string; fhirEndpoint: string }[] };

    console.log(`[MedMij] ${data.zorgaanbieders.length} providers available`);
    return data.zorgaanbieders.map(z => ({
      id: z.id,
      name: z.naam,
      fhirEndpoint: z.fhirEndpoint,
    }));
  }

  /**
   * Step 2: Initiate OAuth2 authorization with a specific healthcare provider.
   * Patient selects their provider (huisarts/hospital) and authorizes access.
   * Returns the authorization URL to redirect the patient to.
   */
  async initiateAuthorization(
    providerId: string,
    dataServices: MedMijDataService[] = ['BasisgegevensZorg', 'Medicatieoverzichten', 'Laboratoriumresultaten', 'Allergieintoleranties', 'Meetwaarden'],
  ): Promise<string> {
    const scope = dataServices.join(' ');
    const state = Math.random().toString(36).slice(2);

    // MedMij uses DigiD (Dutch national identity) for patient authentication
    const authUrl = `${this.config.apiUrl}/authorize?` +
      `response_type=code` +
      `&client_id=${encodeURIComponent(this.config.clientId)}` +
      `&redirect_uri=${encodeURIComponent(this.config.callbackUrl)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${state}` +
      `&zorgaanbieder=${encodeURIComponent(providerId)}`;

    console.log(`[MedMij] Authorization URL generated for provider: ${providerId}`);
    console.log(`[MedMij] Patient will authenticate via DigiD`);
    return authUrl;
  }

  /**
   * Step 3: Exchange authorization code for access token.
   */
  async exchangeCode(code: string): Promise<MedMijSession> {
    console.log('[MedMij] Exchanging authorization code for token...');
    const resp = await fetch(`${this.config.apiUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.callbackUrl,
      }).toString(),
    });

    if (!resp.ok) throw new Error(`[MedMij] Token exchange failed: ${resp.status}`);
    const data = await resp.json() as MedMijSession;
    console.log(`[MedMij] Token received — scope: ${data.scope}, patient: ${data.patientId}`);
    return data;
  }

  /**
   * Step 4: Fetch health records from the provider's FHIR endpoint.
   * Uses NICTIZ/HL7 NL FHIR profiles.
   */
  async fetchRecords(
    session: MedMijSession,
    fhirEndpoint: string,
    resourceTypes: string[] = ['Patient', 'Observation', 'MedicationStatement', 'AllergyIntolerance', 'Immunization', 'Condition', 'DiagnosticReport'],
  ): Promise<{ resourceType: string; count: number; data: unknown[] }[]> {
    const results: { resourceType: string; count: number; data: unknown[] }[] = [];

    for (const resourceType of resourceTypes) {
      try {
        const url = `${fhirEndpoint}/${resourceType}?patient=${session.patientId}&_count=100`;
        console.log(`[MedMij] Fetching ${resourceType}...`);

        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/fhir+json',
          },
        });

        if (resp.ok) {
          const bundle = await resp.json() as { entry?: { resource: unknown }[] };
          const entries = bundle.entry?.map(e => e.resource) || [];
          results.push({ resourceType, count: entries.length, data: entries });
          console.log(`[MedMij] ${resourceType}: ${entries.length} records`);
        } else {
          console.warn(`[MedMij] ${resourceType}: HTTP ${resp.status}`);
        }
      } catch (err) {
        console.error(`[MedMij] ${resourceType} failed:`, err);
      }
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`[MedMij] Total records: ${total}`);
    return results;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const providers = await this.getProviderList();
      return providers.length > 0;
    } catch {
      return false;
    }
  }
}
