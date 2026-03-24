// ============================================================
// MyHealthSpan Agent — South Korea MyHealthWay Connector
// Connects to Korea Health Information Highway (건강정보고속도로)
// for patient-consented health record retrieval
// ============================================================
//
// MyHealthWay connects 860+ Korean hospitals and clinics
// with 113 standardized health data types in FHIR R4 format.
// Patient grants consent via MyHealthWay portal.
//
// API Documentation: https://www.healthwaykorea.kr (Korean)
// FHIR IPS: Korean International Patient Summary standard

export interface MyHealthWayConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;           // https://api.healthwaykorea.kr (production)
  callbackUrl: string;
  environment: 'sandbox' | 'production';
}

export interface MyHealthWaySession {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}

// 113 data types available via MyHealthWay
export type KoreanHealthDataType =
  | 'SurgeryReport'
  | 'PathologyReport'
  | 'LaboratoryResult'
  | 'ImagingStudy'
  | 'Prescription'
  | 'DischargeSummary'
  | 'OutpatientRecord'
  | 'VitalSigns'
  | 'Diagnosis'
  | 'Allergy'
  | 'Immunization'
  | 'ReferralLetter';

export class MyHealthWayClient {
  private config: MyHealthWayConfig;
  private session: MyHealthWaySession | null = null;

  constructor(config: MyHealthWayConfig) {
    this.config = config;
    console.log(`[MyHealthWay] Client initialized (${config.environment})`);
  }

  /**
   * Authenticate with MyHealthWay API.
   */
  async authenticate(): Promise<MyHealthWaySession> {
    if (this.session) return this.session;

    console.log('[MyHealthWay] Authenticating...');
    const resp = await fetch(`${this.config.apiUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }).toString(),
    });

    if (!resp.ok) {
      throw new Error(`[MyHealthWay] Auth failed: ${resp.status}`);
    }

    const data = await resp.json() as MyHealthWaySession;
    this.session = data;
    console.log('[MyHealthWay] Authenticated successfully');
    return data;
  }

  /**
   * Initiate patient consent flow.
   * Returns a URL where the patient authenticates with their MyHealthWay credentials.
   */
  async initiateConsent(patientId: string): Promise<string> {
    const session = await this.authenticate();

    const authUrl = `${this.config.apiUrl}/consent/authorize?` +
      `client_id=${this.config.clientId}` +
      `&patient_id=${encodeURIComponent(patientId)}` +
      `&redirect_uri=${encodeURIComponent(this.config.callbackUrl)}` +
      `&scope=patient/*.read` +
      `&response_type=code` +
      `&state=${Math.random().toString(36).slice(2)}`;

    console.log(`[MyHealthWay] Consent URL generated for patient: ${patientId}`);
    return authUrl;
  }

  /**
   * Exchange authorization code for patient access token.
   */
  async exchangeCode(code: string): Promise<{ accessToken: string; patientId: string }> {
    const resp = await fetch(`${this.config.apiUrl}/oauth/token`, {
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

    if (!resp.ok) {
      throw new Error(`[MyHealthWay] Code exchange failed: ${resp.status}`);
    }

    const data = await resp.json() as { access_token: string; patient: string };
    console.log(`[MyHealthWay] Patient access token received: ${data.patient}`);
    return { accessToken: data.access_token, patientId: data.patient };
  }

  /**
   * Fetch patient health records (FHIR R4 format).
   * MyHealthWay returns data in Korean FHIR IPS (International Patient Summary) format.
   */
  async fetchHealthRecords(
    patientAccessToken: string,
    patientId: string,
    resourceTypes: string[] = ['Observation', 'Condition', 'MedicationRequest', 'DiagnosticReport', 'Procedure', 'AllergyIntolerance', 'Immunization'],
  ): Promise<{ resourceType: string; count: number; data: unknown[] }[]> {
    const results: { resourceType: string; count: number; data: unknown[] }[] = [];

    for (const resourceType of resourceTypes) {
      try {
        const resp = await fetch(
          `${this.config.apiUrl}/fhir/R4/${resourceType}?patient=${patientId}&_count=100`,
          {
            headers: {
              'Authorization': `Bearer ${patientAccessToken}`,
              'Accept': 'application/fhir+json',
            },
          },
        );

        if (resp.ok) {
          const bundle = await resp.json() as { total?: number; entry?: { resource: unknown }[] };
          const entries = bundle.entry?.map(e => e.resource) || [];
          results.push({ resourceType, count: entries.length, data: entries });
          console.log(`[MyHealthWay] ${resourceType}: ${entries.length} records`);
        } else {
          console.warn(`[MyHealthWay] ${resourceType}: HTTP ${resp.status}`);
        }
      } catch (err) {
        console.error(`[MyHealthWay] ${resourceType} fetch failed:`, err);
      }
    }

    const total = results.reduce((sum, r) => sum + r.count, 0);
    console.log(`[MyHealthWay] Total records fetched: ${total}`);
    return results;
  }

  /**
   * Check API connectivity.
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }
}
