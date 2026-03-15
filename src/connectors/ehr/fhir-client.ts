import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { AgentConfig, EHRProvider, HealthSample } from '../../types/index.js';

// ── SMART on FHIR R4 Client ────────────────────────────────────

/**
 * FHIR R4 client with OAuth2 PKCE support for EHR systems.
 * Supports Epic MyChart, Cerner, and generic FHIR R4 endpoints.
 */
export class FhirClient {
  private config: AgentConfig;
  private provider: EHRProvider;
  private fhirBaseUrl: string;
  private clientId: string;
  private oauthPort: number;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private patientId: string | null = null;
  private client: AxiosInstance | null = null;

  // PKCE state
  private codeVerifier: string | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.provider = config.connectors.ehr.provider ?? 'generic_fhir';
    this.fhirBaseUrl = config.connectors.ehr.fhirBaseUrl ?? '';
    this.clientId = config.connectors.ehr.clientId ?? '';
    this.oauthPort = config.connectors.ehr.oauthPort;

    if (!this.fhirBaseUrl) {
      // Default well-known FHIR sandbox URLs
      switch (this.provider) {
        case 'epic':
          this.fhirBaseUrl = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';
          break;
        case 'cerner':
          this.fhirBaseUrl = 'https://fhir-myrecord.cerner.com/r4';
          break;
        default:
          throw new Error('EHR_FHIR_BASE_URL is required for generic FHIR providers');
      }
    }
  }

  // ── OAuth2 PKCE Authorization ───────────────────────────────────

  /**
   * Start the OAuth2 PKCE authorization flow.
   * Opens a local HTTP server to receive the callback.
   * Returns the authorization URL the user should open in a browser.
   */
  async authorize(redirectUri?: string): Promise<string> {
    const redirect = redirectUri ?? `http://localhost:${this.oauthPort}/callback`;

    // Generate PKCE code verifier and challenge
    this.codeVerifier = randomUUID() + randomUUID();
    const codeChallenge = createHash('sha256')
      .update(this.codeVerifier)
      .digest('base64url');

    const wellKnown = await this.getSmartConfiguration();
    const authUrl = new URL(wellKnown.authorization_endpoint);

    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('redirect_uri', redirect);
    authUrl.searchParams.set('scope', this.getScopes().join(' '));
    authUrl.searchParams.set('state', randomUUID());
    authUrl.searchParams.set('aud', this.fhirBaseUrl);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log(`[FHIR] Authorize at: ${authUrl.toString()}`);
    return authUrl.toString();
  }

  /**
   * Handle the OAuth2 callback and exchange the authorization code for tokens.
   */
  async handleCallback(code: string, redirectUri?: string): Promise<void> {
    const redirect = redirectUri ?? `http://localhost:${this.oauthPort}/callback`;

    if (!this.codeVerifier) {
      throw new Error('No PKCE code verifier. Call authorize() first.');
    }

    const wellKnown = await this.getSmartConfiguration();

    const response = await axios.post(wellKnown.token_endpoint, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: this.clientId,
      code_verifier: this.codeVerifier,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = response.data.access_token;
    this.patientId = response.data.patient ?? null;
    this.tokenExpiry = new Date(Date.now() + (response.data.expires_in ?? 3600) * 1000);

    this.client = axios.create({
      baseURL: this.fhirBaseUrl,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/fhir+json',
      },
      timeout: 30_000,
    });

    console.log(`[FHIR] Authenticated with ${this.provider}. Patient: ${this.patientId ?? 'unknown'}`);
  }

  /**
   * Start a local HTTP server and wait for the OAuth callback.
   * Returns the authorization code from the callback.
   */
  async waitForCallback(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', `http://localhost:${this.oauthPort}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authorization Successful</h1><p>You can close this tab.</p>');
          server.close();
          resolve(code);
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      server.listen(this.oauthPort, () => {
        console.log(`[FHIR] OAuth callback server listening on port ${this.oauthPort}`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth callback timeout (5 minutes)'));
      }, 5 * 60 * 1000);
    });
  }

  // ── FHIR Resource Reads ─────────────────────────────────────────

  async getPatient(): Promise<FhirPatient | null> {
    const client = this.ensureClient();
    if (!this.patientId) return null;

    try {
      const response = await client.get(`/Patient/${this.patientId}`);
      return response.data as FhirPatient;
    } catch (error) {
      console.error('[FHIR] Failed to fetch Patient:', error);
      return null;
    }
  }

  async getObservations(): Promise<HealthSample[]> {
    const client = this.ensureClient();
    if (!this.patientId) {
      console.warn('[FHIR] No patient ID — cannot fetch observations');
      return [];
    }

    try {
      const response = await client.get('/Observation', {
        params: {
          patient: this.patientId,
          _sort: '-date',
          _count: 200,
          category: 'vital-signs,laboratory',
        },
      });

      const bundle = response.data as FhirBundle;
      return this.mapObservationsToSamples(bundle);
    } catch (error) {
      console.error('[FHIR] Failed to fetch Observations:', error);
      return [];
    }
  }

  async getConditions(): Promise<FhirCondition[]> {
    const client = this.ensureClient();
    if (!this.patientId) return [];

    try {
      const response = await client.get('/Condition', {
        params: { patient: this.patientId, _count: 100 },
      });
      const bundle = response.data as FhirBundle;
      return (bundle.entry ?? [])
        .map(e => e.resource as FhirCondition)
        .filter(r => r.resourceType === 'Condition');
    } catch (error) {
      console.error('[FHIR] Failed to fetch Conditions:', error);
      return [];
    }
  }

  async getMedications(): Promise<FhirMedicationRequest[]> {
    const client = this.ensureClient();
    if (!this.patientId) return [];

    try {
      const response = await client.get('/MedicationRequest', {
        params: { patient: this.patientId, _count: 100 },
      });
      const bundle = response.data as FhirBundle;
      return (bundle.entry ?? [])
        .map(e => e.resource as FhirMedicationRequest)
        .filter(r => r.resourceType === 'MedicationRequest');
    } catch (error) {
      console.error('[FHIR] Failed to fetch MedicationRequests:', error);
      return [];
    }
  }

  async getAllergyIntolerances(): Promise<FhirAllergyIntolerance[]> {
    const client = this.ensureClient();
    if (!this.patientId) return [];

    try {
      const response = await client.get('/AllergyIntolerance', {
        params: { patient: this.patientId, _count: 100 },
      });
      const bundle = response.data as FhirBundle;
      return (bundle.entry ?? [])
        .map(e => e.resource as FhirAllergyIntolerance)
        .filter(r => r.resourceType === 'AllergyIntolerance');
    } catch (error) {
      console.error('[FHIR] Failed to fetch AllergyIntolerances:', error);
      return [];
    }
  }

  // ── FHIR → HealthSample Mapping ────────────────────────────────

  private mapObservationsToSamples(bundle: FhirBundle): HealthSample[] {
    const samples: HealthSample[] = [];

    for (const entry of bundle.entry ?? []) {
      const obs = entry.resource as FhirObservation;
      if (obs.resourceType !== 'Observation') continue;

      const coding = obs.code?.coding?.[0];
      if (!coding) continue;

      const dataType = this.loincToDataType(coding.code ?? '', coding.display ?? '');
      if (!dataType) continue;

      const value = obs.valueQuantity?.value;
      const unit = obs.valueQuantity?.unit ?? obs.valueQuantity?.code ?? '';

      if (value === undefined) continue;

      samples.push({
        id: obs.id ?? randomUUID(),
        source: 'ehr',
        dataType,
        value,
        unit,
        metadata: {
          loincCode: coding.code,
          display: coding.display,
          fhirId: obs.id,
          provider: this.provider,
        },
        recordedAt: new Date(obs.effectiveDateTime ?? obs.issued ?? Date.now()),
        syncedAt: new Date(),
      });
    }

    return samples;
  }

  /**
   * Map LOINC codes to our internal data types.
   */
  private loincToDataType(loincCode: string, display: string): string | null {
    const mapping: Record<string, string> = {
      // Vital Signs
      '8867-4': 'heartRate',
      '8480-6': 'bloodPressureSystolic',
      '8462-4': 'bloodPressureDiastolic',
      '8310-5': 'bodyTemperature',
      '9279-1': 'respiratoryRate',
      '2708-6': 'oxygenSaturation',
      '59408-5': 'oxygenSaturation',

      // Body Measurements
      '29463-7': 'bodyMass',
      '39156-5': 'bmi',
      '41982-0': 'bodyFatPercentage',

      // Metabolic Labs
      '4548-4': 'hba1c',
      '2345-7': 'bloodGlucose',
      '1558-6': 'bloodGlucose',       // fasting glucose

      // Lipid Panel
      '2089-1': 'ldlCholesterol',
      '2085-9': 'hdlCholesterol',
      '2571-8': 'triglycerides',

      // Thyroid
      '3016-3': 'tshThyroid',

      // Vitamin D
      '1989-3': 'vitaminD',

      // Iron
      '2276-4': 'ferritin',

      // Kidney
      '2160-0': 'creatinine',
      '33914-3': 'egfr',

      // Liver
      '1742-6': 'alt',
      '1920-8': 'ast',

      // Inflammatory
      '1988-5': 'crp',
      '2155-0': 'homocysteine',
    };

    if (mapping[loincCode]) return mapping[loincCode]!;

    // Fallback: try to match by display name
    const lower = display.toLowerCase();
    if (lower.includes('heart rate')) return 'heartRate';
    if (lower.includes('systolic')) return 'bloodPressureSystolic';
    if (lower.includes('diastolic')) return 'bloodPressureDiastolic';
    if (lower.includes('body weight') || lower.includes('body mass')) return 'bodyMass';
    if (lower.includes('bmi')) return 'bmi';
    if (lower.includes('glucose')) return 'bloodGlucose';
    if (lower.includes('hemoglobin a1c')) return 'hba1c';

    return null;
  }

  // ── SMART Configuration Discovery ──────────────────────────────

  private async getSmartConfiguration(): Promise<SmartConfiguration> {
    try {
      const response = await axios.get(`${this.fhirBaseUrl}/.well-known/smart-configuration`);
      return response.data;
    } catch {
      // Fallback: try capability statement
      const response = await axios.get(`${this.fhirBaseUrl}/metadata`);
      const cap = response.data;
      const security = cap.rest?.[0]?.security;
      const oauthExt = security?.extension?.find(
        (e: { url: string }) => e.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris'
      );
      const getUri = (name: string): string => {
        const ext = oauthExt?.extension?.find((e: { url: string }) => e.url === name);
        return ext?.valueUri ?? '';
      };

      return {
        authorization_endpoint: getUri('authorize'),
        token_endpoint: getUri('token'),
        scopes_supported: ['openid', 'fhirUser', 'patient/*.read', 'launch/patient'],
      };
    }
  }

  private getScopes(): string[] {
    const baseScopes = [
      'openid',
      'fhirUser',
      'patient/Patient.read',
      'patient/Observation.read',
      'patient/Condition.read',
      'patient/MedicationRequest.read',
      'patient/AllergyIntolerance.read',
      'launch/patient',
    ];

    // Epic requires specific scope format
    if (this.provider === 'epic') {
      return baseScopes;
    }

    return baseScopes;
  }

  private ensureClient(): AxiosInstance {
    if (!this.client || !this.accessToken) {
      throw new Error(
        'FHIR client not authenticated. Run the OAuth flow first:\n' +
        '  1. Call authorize() to get the authorization URL\n' +
        '  2. Open the URL in a browser and log in\n' +
        '  3. Call handleCallback(code) with the authorization code'
      );
    }

    if (this.tokenExpiry && new Date() > this.tokenExpiry) {
      throw new Error('FHIR access token has expired. Re-authenticate.');
    }

    return this.client;
  }
}

// ── FHIR R4 Type Stubs ───────────────────────────────────────────

interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  scopes_supported?: string[];
}

interface FhirBundle {
  resourceType: 'Bundle';
  entry?: Array<{ resource: FhirResource }>;
}

interface FhirResource {
  resourceType: string;
  id?: string;
}

interface FhirPatient extends FhirResource {
  resourceType: 'Patient';
  name?: Array<{ given?: string[]; family?: string }>;
  birthDate?: string;
  gender?: string;
}

interface FhirObservation extends FhirResource {
  resourceType: 'Observation';
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  };
  valueQuantity?: { value?: number; unit?: string; code?: string };
  effectiveDateTime?: string;
  issued?: string;
}

interface FhirCondition extends FhirResource {
  resourceType: 'Condition';
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  clinicalStatus?: { coding?: Array<{ code?: string }> };
}

interface FhirMedicationRequest extends FhirResource {
  resourceType: 'MedicationRequest';
  medicationCodeableConcept?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  status?: string;
}

interface FhirAllergyIntolerance extends FhirResource {
  resourceType: 'AllergyIntolerance';
  code?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
  clinicalStatus?: { coding?: Array<{ code?: string }> };
}
