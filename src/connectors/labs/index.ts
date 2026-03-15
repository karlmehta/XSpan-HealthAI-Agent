import { randomUUID } from 'crypto';
import type { HealthSample } from '../../types/index.js';

// ── Lab Provider Connector Interface ────────────────────────────

export interface LabCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  expiresAt?: Date;
}

export interface LabConnector {
  readonly name: string;
  connect(credentials: LabCredentials): Promise<void>;
  getResults(since: Date): Promise<HealthSample[]>;
  disconnect(): Promise<void>;
}

// ── LOINC Code Mapping ──────────────────────────────────────────

const LOINC_TO_DATA_TYPE: Record<string, { dataType: string; unit: string }> = {
  // Complete Blood Count
  '718-7':   { dataType: 'hemoglobin', unit: 'g/dL' },
  '4544-3':  { dataType: 'hematocrit', unit: '%' },
  '6690-2':  { dataType: 'wbc', unit: '10*3/uL' },
  '789-8':   { dataType: 'rbc', unit: '10*6/uL' },
  '777-3':   { dataType: 'platelets', unit: '10*3/uL' },

  // Metabolic Panel
  '2345-7':  { dataType: 'bloodGlucose', unit: 'mg/dL' },
  '1558-6':  { dataType: 'bloodGlucose', unit: 'mg/dL' },
  '4548-4':  { dataType: 'hba1c', unit: '%' },
  '2160-0':  { dataType: 'creatinine', unit: 'mg/dL' },
  '3094-0':  { dataType: 'bun', unit: 'mg/dL' },
  '17861-6': { dataType: 'calcium', unit: 'mg/dL' },
  '2951-2':  { dataType: 'sodium', unit: 'mEq/L' },
  '2823-3':  { dataType: 'potassium', unit: 'mEq/L' },
  '2075-0':  { dataType: 'chloride', unit: 'mEq/L' },

  // Lipid Panel
  '2093-3':  { dataType: 'totalCholesterol', unit: 'mg/dL' },
  '2089-1':  { dataType: 'ldlCholesterol', unit: 'mg/dL' },
  '2085-9':  { dataType: 'hdlCholesterol', unit: 'mg/dL' },
  '2571-8':  { dataType: 'triglycerides', unit: 'mg/dL' },

  // Thyroid
  '3016-3':  { dataType: 'tshThyroid', unit: 'mIU/L' },
  '3053-6':  { dataType: 'freeT3', unit: 'pg/mL' },
  '3024-7':  { dataType: 'freeT4', unit: 'ng/dL' },

  // Vitamins & Minerals
  '1989-3':  { dataType: 'vitaminD', unit: 'ng/mL' },
  '2132-9':  { dataType: 'vitaminB12', unit: 'pg/mL' },
  '2276-4':  { dataType: 'ferritin', unit: 'ng/mL' },
  '2498-4':  { dataType: 'iron', unit: 'ug/dL' },

  // Liver
  '1742-6':  { dataType: 'alt', unit: 'U/L' },
  '1920-8':  { dataType: 'ast', unit: 'U/L' },

  // Kidney
  '33914-3': { dataType: 'egfr', unit: 'mL/min/1.73m2' },

  // Inflammatory
  '1988-5':  { dataType: 'crp', unit: 'mg/L' },
  '2155-0':  { dataType: 'homocysteine', unit: 'umol/L' },

  // Hormones
  '2986-8':  { dataType: 'testosterone', unit: 'ng/dL' },
  '14715-7': { dataType: 'cortisol', unit: 'ug/dL' },
};

/**
 * Map a LOINC code to our internal data type.
 */
function mapLoincToSample(
  loincCode: string,
  value: number,
  recordedAt: Date,
  source: string,
): HealthSample | null {
  const mapping = LOINC_TO_DATA_TYPE[loincCode];
  if (!mapping) return null;

  return {
    id: randomUUID(),
    source: 'ehr',
    dataType: mapping.dataType,
    value,
    unit: mapping.unit,
    metadata: { loincCode, labProvider: source },
    recordedAt,
    syncedAt: new Date(),
  };
}

// ── Quest Diagnostics Connector ─────────────────────────────────

export class QuestDiagnosticsConnector implements LabConnector {
  readonly name = 'Quest Diagnostics';
  private credentials: LabCredentials | null = null;

  async connect(credentials: LabCredentials): Promise<void> {
    console.warn('[Quest] Quest Diagnostics API integration coming in v1.1');
    console.warn('[Quest] Requires Quest Health API partner access');
    console.warn('[Quest] For now, lab results are pulled via EHR/FHIR integration');
    this.credentials = credentials;
  }

  async getResults(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Quest connector not connected. Call connect() first.');
    }

    console.warn(`[Quest] Direct API sync not yet implemented`);
    console.warn(`[Quest] Would fetch results since ${since.toISOString()}`);

    // TODO v1.1: Call Quest Health API
    // POST https://api.questdiagnostics.com/v1/oauth/token
    // GET  https://api.questdiagnostics.com/v1/results
    //
    // Quest uses HL7 FHIR R4 with DiagnosticReport and Observation resources.
    // Results include LOINC codes that we map via mapLoincToSample().

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Quest] Disconnected');
  }
}

// ── LabCorp Connector ───────────────────────────────────────────

export class LabCorpConnector implements LabConnector {
  readonly name = 'LabCorp';
  private credentials: LabCredentials | null = null;

  async connect(credentials: LabCredentials): Promise<void> {
    console.warn('[LabCorp] LabCorp Patient API integration coming in v1.1');
    console.warn('[LabCorp] Requires LabCorp Developer Portal registration');
    console.warn('[LabCorp] For now, lab results are pulled via EHR/FHIR integration');
    this.credentials = credentials;
  }

  async getResults(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('LabCorp connector not connected. Call connect() first.');
    }

    console.warn(`[LabCorp] Direct API sync not yet implemented`);
    console.warn(`[LabCorp] Would fetch results since ${since.toISOString()}`);

    // TODO v1.1: Call LabCorp Patient API (FHIR R4)
    // OAuth2 authorization code flow
    // GET https://api.labcorp.com/fhir/r4/DiagnosticReport?patient={id}
    // GET https://api.labcorp.com/fhir/r4/Observation?patient={id}
    //
    // LabCorp returns standard FHIR DiagnosticReport bundles with LOINC-coded Observations.

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[LabCorp] Disconnected');
  }
}

// ── Function Health Connector ───────────────────────────────────

export class FunctionHealthConnector implements LabConnector {
  readonly name = 'Function Health';
  private credentials: LabCredentials | null = null;

  async connect(credentials: LabCredentials): Promise<void> {
    console.warn('[Function Health] Function Health API integration coming in v1.1');
    console.warn('[Function Health] Requires Function Health membership and API access');
    this.credentials = credentials;
  }

  async getResults(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Function Health connector not connected. Call connect() first.');
    }

    console.warn(`[Function Health] Direct API sync not yet implemented`);
    console.warn(`[Function Health] Would fetch results since ${since.toISOString()}`);

    // TODO v1.1: Call Function Health API
    // Function Health provides 100+ biomarker tests.
    // API access pending — will integrate when available.
    //
    // Expected flow:
    // 1. OAuth2 or API key auth
    // 2. GET /api/v1/results?since={date}
    // 3. Map Function Health biomarker IDs to LOINC codes
    // 4. Convert to HealthSample[] via mapLoincToSample()

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Function Health] Disconnected');
  }
}

// ── Factory ─────────────────────────────────────────────────────

export type LabProvider = 'quest' | 'labcorp' | 'function_health';

export function createLabConnector(provider: LabProvider): LabConnector {
  switch (provider) {
    case 'quest':
      return new QuestDiagnosticsConnector();
    case 'labcorp':
      return new LabCorpConnector();
    case 'function_health':
      return new FunctionHealthConnector();
    default:
      throw new Error(`Unknown lab provider: ${provider}`);
  }
}

// Export the LOINC mapping utility for use by other connectors
export { mapLoincToSample, LOINC_TO_DATA_TYPE };
