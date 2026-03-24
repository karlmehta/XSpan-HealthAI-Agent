// ============================================================
// MyHealthSpan Agent — Australia My Health Record Connector
// National opt-out health record (90% of Australians)
//
// Docs: https://developer.digitalhealth.gov.au/
// Auth: myGov authentication (Australian Government)
// Format: FHIR R4 (AU Core profiles), CDA for documents
// ============================================================

export interface MyHealthRecordConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;               // https://api.digitalhealth.gov.au (production)
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export interface MyHealthRecordSession {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  ihi: string;                  // Individual Healthcare Identifier (16 digits)
  scope: string;
}

// Document types available in My Health Record
export type AUHealthDocType =
  | 'SharedHealthSummary'        // GP summary
  | 'EventSummary'              // Clinical events
  | 'DischargeSummary'          // Hospital discharge
  | 'Prescription'              // eRx prescriptions
  | 'DispenseRecord'            // Pharmacy dispensing
  | 'PathologyReport'           // Pathology/lab results
  | 'DiagnosticImagingReport'   // Radiology/imaging
  | 'MedicareOverview'          // PBS claims, MBS items
  | 'ImmunisationRecord'        // AIR (Australian Immunisation Register)
  | 'OrganDonorDecision';       // Organ donor status

export class MyHealthRecordClient {
  private config: MyHealthRecordConfig;

  constructor(config: MyHealthRecordConfig) {
    this.config = config;
    console.log(`[AU-MHR] Client initialized (${config.environment})`);
  }

  /**
   * Step 1: Generate myGov authentication URL.
   * Patient logs in with their myGov credentials (linked to Medicare).
   */
  async initiateLogin(): Promise<string> {
    const state = Math.random().toString(36).slice(2);

    const authUrl = `https://my.gov.au/mygov/oauth2/authorize?` +
      `response_type=code` +
      `&client_id=${encodeURIComponent(this.config.clientId)}` +
      `&redirect_uri=${encodeURIComponent(this.config.callbackUrl)}` +
      `&scope=${encodeURIComponent('openid mhr:read patient/*.read')}` +
      `&state=${state}`;

    console.log('[AU-MHR] myGov login URL generated');
    return authUrl;
  }

  /**
   * Step 2: Exchange authorization code for access token.
   */
  async exchangeCode(code: string): Promise<MyHealthRecordSession> {
    console.log('[AU-MHR] Exchanging code for token...');
    const resp = await fetch(`https://my.gov.au/mygov/oauth2/token`, {
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

    if (!resp.ok) throw new Error(`[AU-MHR] Token exchange failed: ${resp.status}`);
    const data = await resp.json() as { access_token: string; token_type: string; expires_in: number; ihi: string; scope: string };

    console.log(`[AU-MHR] Token received — IHI: ${data.ihi ? data.ihi.slice(0, 6) + '***' : 'not available'}`);
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      ihi: data.ihi || '',
      scope: data.scope || '',
    };
  }

  /**
   * Step 3: Fetch health records from My Health Record.
   * Uses ADHA FHIR R4 (AU Core) profiles.
   */
  async fetchRecords(
    session: MyHealthRecordSession,
    documentTypes: AUHealthDocType[] = [
      'SharedHealthSummary', 'EventSummary', 'DischargeSummary',
      'Prescription', 'DispenseRecord', 'PathologyReport',
      'DiagnosticImagingReport', 'MedicareOverview', 'ImmunisationRecord',
    ],
  ): Promise<{ docType: string; count: number; data: unknown[] }[]> {
    const results: { docType: string; count: number; data: unknown[] }[] = [];

    // Map document types to FHIR resource queries
    const fhirMap: Record<string, { resource: string; params?: string }> = {
      'SharedHealthSummary': { resource: 'Composition', params: 'type=http://loinc.org|60591-5' },
      'EventSummary': { resource: 'Composition', params: 'type=http://loinc.org|34133-9' },
      'DischargeSummary': { resource: 'Composition', params: 'type=http://loinc.org|18842-5' },
      'Prescription': { resource: 'MedicationRequest' },
      'DispenseRecord': { resource: 'MedicationDispense' },
      'PathologyReport': { resource: 'DiagnosticReport', params: 'category=LAB' },
      'DiagnosticImagingReport': { resource: 'DiagnosticReport', params: 'category=RAD' },
      'MedicareOverview': { resource: 'ExplanationOfBenefit' },
      'ImmunisationRecord': { resource: 'Immunization' },
      'OrganDonorDecision': { resource: 'Consent' },
    };

    for (const docType of documentTypes) {
      const mapping = fhirMap[docType];
      if (!mapping) continue;

      try {
        const params = `patient=${session.ihi}&_count=100${mapping.params ? '&' + mapping.params : ''}`;
        const url = `${this.config.apiUrl}/fhir/R4/${mapping.resource}?${params}`;
        console.log(`[AU-MHR] Fetching ${docType} (${mapping.resource})...`);

        const resp = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
            'Accept': 'application/fhir+json',
          },
        });

        if (resp.ok) {
          const bundle = await resp.json() as { entry?: { resource: unknown }[] };
          const entries = bundle.entry?.map(e => e.resource) || [];
          results.push({ docType, count: entries.length, data: entries });
          console.log(`[AU-MHR] ${docType}: ${entries.length} records`);
        } else {
          console.warn(`[AU-MHR] ${docType}: HTTP ${resp.status}`);
        }
      } catch (err) {
        console.error(`[AU-MHR] ${docType} failed:`, err);
      }
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`[AU-MHR] Total records: ${total}`);
    return results;
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
