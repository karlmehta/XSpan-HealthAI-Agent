// ============================================================
// XSpan HealthAI Agent — ABDM (Ayushman Bharat) Types
// India's national health data exchange protocol
// ============================================================

export interface ABDMConfig {
  clientId: string;
  clientSecret: string;
  gatewayUrl: string;        // https://dev.abdm.gov.in (sandbox) or https://live.abdm.gov.in (prod)
  callbackUrl: string;       // Where ABDM sends async responses
  hiuId: string;             // Health Information User ID
  environment: 'sandbox' | 'production';
}

export interface ABDMSession {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  createdAt: number;
}

// Patient identification
export interface ABHAProfile {
  abhaNumber: string;        // 14-digit ABHA number
  abhaAddress: string;       // user@abdm format
  name: string;
  yearOfBirth: string;
  gender: 'M' | 'F' | 'O';
  mobile: string;
  healthId: string;
}

// Consent
export interface ConsentRequest {
  purpose: {
    text: string;
    code: string;            // CAREMGT, BTG, PUBHLTH, HPAYMT, DSRCH, PATRQT
  };
  patient: {
    id: string;              // ABHA address
  };
  hip: {
    id: string;              // Health facility ID
  } | null;
  hiu: {
    id: string;              // Our HIU ID
  };
  requester: {
    name: string;
    identifier: {
      type: string;
      value: string;
      system: string;
    };
  };
  hiTypes: HealthInfoType[];
  permission: {
    accessMode: 'VIEW' | 'STORE' | 'QUERY' | 'STREAM';
    dateRange: {
      from: string;          // ISO datetime
      to: string;
    };
    dataEraseAt: string;     // When to delete data
    frequency: {
      unit: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
      value: number;
      repeats: number;
    };
  };
}

export type HealthInfoType =
  | 'OPConsultation'
  | 'Prescription'
  | 'DischargeSummary'
  | 'DiagnosticReport'
  | 'ImmunizationRecord'
  | 'HealthDocumentRecord'
  | 'WellnessRecord';

export interface ConsentArtefact {
  consentId: string;
  status: 'GRANTED' | 'DENIED' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  patient: { id: string };
  hip: { id: string } | null;
  hiTypes: HealthInfoType[];
  permission: ConsentRequest['permission'];
}

// Health data response
export interface HealthDataBundle {
  pageNumber: number;
  pageCount: number;
  transactionId: string;
  entries: HealthDataEntry[];
}

export interface HealthDataEntry {
  content: string;           // Base64-encoded encrypted FHIR Bundle
  media: string;             // application/fhir+json
  checksum: string;
  careContextReference: string;
}

// Care context — represents a visit/encounter
export interface CareContext {
  referenceNumber: string;
  display: string;           // e.g., "OPD Visit - 15 Mar 2026"
}

// Callback events from ABDM gateway
export interface ABDMCallback {
  requestId: string;
  timestamp: string;
  resp: {
    requestId: string;
  };
}

export interface ConsentNotification extends ABDMCallback {
  notification: {
    consentRequestId: string;
    status: 'GRANTED' | 'DENIED' | 'EXPIRED' | 'REVOKED';
    consentArtefacts?: { id: string }[];
  };
}

export interface HealthDataNotification extends ABDMCallback {
  hiRequest: {
    transactionId: string;
    sessionStatus: 'REQUESTED' | 'ACKNOWLEDGED' | 'TRANSFERRED' | 'FAILED';
  };
}
