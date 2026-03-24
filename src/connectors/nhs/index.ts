// ============================================================
// MyHealthSpan Agent — UK NHS Connector
// Patient-facing GP record access via NHS GP Connect FHIR API
//
// Docs: https://digital.nhs.uk/developer/api-catalogue
// Auth: NHS Login (identity verification)
// Format: FHIR STU3 (GP Connect), FHIR R4 (newer APIs)
// ============================================================

export interface NHSConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;               // https://api.service.nhs.uk (production)
  callbackUrl: string;
  environment: 'sandbox' | 'integration' | 'production';
}

export interface NHSSession {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  nhsNumber: string;            // 10-digit NHS number
  scope: string;
}

// NHS GP Connect record sections
export type NHSRecordSection =
  | 'Summary'
  | 'Encounters'
  | 'Problems'
  | 'Medications'
  | 'Allergies'
  | 'Immunizations'
  | 'Observations'
  | 'Referrals'
  | 'Documents';

export class NHSClient {
  private config: NHSConfig;

  constructor(config: NHSConfig) {
    this.config = config;
    console.log(`[NHS] Client initialized (${config.environment})`);
  }

  /**
   * Step 1: Generate NHS Login authorization URL.
   * Patient authenticates with NHS login (email + password + identity verification).
   */
  async initiateLogin(): Promise<string> {
    const state = Math.random().toString(36).slice(2);
    const nonce = Math.random().toString(36).slice(2);

    // NHS Login uses OpenID Connect
    const authUrl = `https://auth.login.nhs.uk/authorize?` +
      `response_type=code` +
      `&client_id=${encodeURIComponent(this.config.clientId)}` +
      `&redirect_uri=${encodeURIComponent(this.config.callbackUrl)}` +
      `&scope=${encodeURIComponent('openid profile nhs_login gp_registration gp_read')}` +
      `&state=${state}` +
      `&nonce=${nonce}`;

    console.log('[NHS] Login URL generated — patient authenticates via NHS Login');
    return authUrl;
  }

  /**
   * Step 2: Exchange authorization code for access token.
   */
  async exchangeCode(code: string): Promise<NHSSession> {
    console.log('[NHS] Exchanging code for token...');
    const resp = await fetch(`https://auth.login.nhs.uk/token`, {
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

    if (!resp.ok) throw new Error(`[NHS] Token exchange failed: ${resp.status}`);

    const tokenData = await resp.json() as { access_token: string; token_type: string; expires_in: number; scope: string };

    // Decode ID token to get NHS number
    const idToken = (await resp.json() as { id_token?: string }).id_token;
    let nhsNumber = '';
    if (idToken) {
      try {
        const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        nhsNumber = payload.nhs_number || '';
      } catch {}
    }

    console.log(`[NHS] Token received — NHS Number: ${nhsNumber ? nhsNumber.slice(0, 3) + '***' : 'not available'}`);
    return {
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      nhsNumber,
      scope: tokenData.scope,
    };
  }

  /**
   * Step 3: Fetch GP records via GP Connect Access Record FHIR API.
   */
  async fetchGPRecords(
    session: NHSSession,
    sections: NHSRecordSection[] = ['Summary', 'Medications', 'Allergies', 'Immunizations', 'Observations', 'Problems'],
  ): Promise<{ section: string; count: number; data: unknown[] }[]> {
    const results: { section: string; count: number; data: unknown[] }[] = [];

    // GP Connect uses a structured record retrieval endpoint
    const fhirResourceMap: Record<NHSRecordSection, string> = {
      'Summary': 'Patient',
      'Encounters': 'Encounter',
      'Problems': 'Condition',
      'Medications': 'MedicationStatement',
      'Allergies': 'AllergyIntolerance',
      'Immunizations': 'Immunization',
      'Observations': 'Observation',
      'Referrals': 'ReferralRequest',
      'Documents': 'DocumentReference',
    };

    for (const section of sections) {
      const resourceType = fhirResourceMap[section];
      if (!resourceType) continue;

      try {
        const url = `${this.config.apiUrl}/fhir/STU3/${resourceType}?patient=${session.nhsNumber}&_count=100`;
        console.log(`[NHS] Fetching ${section} (${resourceType})...`);

        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/fhir+json',
            'Ssp-TraceID': Math.random().toString(36).slice(2),
            'Ssp-From': this.config.clientId,
            'Ssp-To': '00000000000',  // Target GP practice ODS code
            'Ssp-InteractionID': `urn:nhs:names:services:gpconnect:fhir:rest:search:${resourceType.toLowerCase()}`,
          },
        });

        if (resp.ok) {
          const bundle = await resp.json() as { entry?: { resource: unknown }[] };
          const entries = bundle.entry?.map(e => e.resource) || [];
          results.push({ section, count: entries.length, data: entries });
          console.log(`[NHS] ${section}: ${entries.length} records`);
        } else {
          console.warn(`[NHS] ${section}: HTTP ${resp.status}`);
        }
      } catch (err) {
        console.error(`[NHS] ${section} failed:`, err);
      }
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`[NHS] Total GP records: ${total}`);
    return results;
  }

  /**
   * Fetch prescriptions via Electronic Prescription Service (EPS).
   */
  async fetchPrescriptions(session: NHSSession): Promise<unknown[]> {
    try {
      const resp = await fetch(
        `${this.config.apiUrl}/prescriptions-for-patients?patient.identifier=https://fhir.nhs.uk/Id/nhs-number|${session.nhsNumber}`,
        {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/fhir+json',
          },
        },
      );

      if (resp.ok) {
        const bundle = await resp.json() as { entry?: { resource: unknown }[] };
        const prescriptions = bundle.entry?.map(e => e.resource) || [];
        console.log(`[NHS] Prescriptions: ${prescriptions.length}`);
        return prescriptions;
      }
    } catch (err) {
      console.error('[NHS] Prescriptions fetch failed:', err);
    }
    return [];
  }

  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.config.apiUrl}/health`);
      return resp.ok;
    } catch {
      return false;
    }
  }
}
