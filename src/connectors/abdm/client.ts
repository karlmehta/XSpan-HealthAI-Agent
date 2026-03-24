// ============================================================
// XSpan HealthAI Agent — ABDM Gateway API Client
// Handles authentication, consent, and health data retrieval
// from India's Ayushman Bharat Digital Mission
// ============================================================

import { randomUUID } from 'crypto';
import type {
  ABDMConfig,
  ABDMSession,
  ConsentRequest,
  HealthInfoType,
} from './types.js';

const DEFAULT_SANDBOX_CONFIG: Partial<ABDMConfig> = {
  gatewayUrl: 'https://dev.abdm.gov.in',
  environment: 'sandbox',
};

export class ABDMClient {
  private config: ABDMConfig;
  private session: ABDMSession | null = null;

  constructor(config: ABDMConfig) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config } as ABDMConfig;
    console.log(`[ABDM] Client initialized (${this.config.environment})`);
    console.log(`[ABDM] Gateway: ${this.config.gatewayUrl}`);
    console.log(`[ABDM] HIU ID: ${this.config.hiuId}`);
  }

  // ── Authentication ──────────────────────────────────────────

  /**
   * Get session token from ABDM gateway.
   * Required before any other API call.
   */
  async getSession(): Promise<ABDMSession> {
    // Return cached session if still valid (with 60s buffer)
    if (this.session && Date.now() < this.session.createdAt + (this.session.expiresIn - 60) * 1000) {
      return this.session;
    }

    console.log('[ABDM] Requesting new session token...');
    const resp = await fetch(`${this.config.gatewayUrl}/gateway/v0.5/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[ABDM] Session failed (${resp.status}): ${err}`);
    }

    const data = await resp.json() as { accessToken: string; expiresIn: number; tokenType: string };
    this.session = {
      accessToken: data.accessToken,
      expiresIn: data.expiresIn,
      tokenType: data.tokenType,
      createdAt: Date.now(),
    };

    console.log(`[ABDM] Session token obtained (expires in ${data.expiresIn}s)`);
    return this.session;
  }

  /**
   * Get authorization headers for gateway API calls.
   */
  private async getHeaders(extraHeaders?: Record<string, string>): Promise<Record<string, string>> {
    const session = await this.getSession();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`,
      'X-CM-ID': this.config.environment === 'sandbox' ? 'sbx' : 'abdm',
      'X-HIU-ID': this.config.hiuId,
      ...extraHeaders,
    };
  }

  // ── Bridge Registration ─────────────────────────────────────

  /**
   * Register callback URL with ABDM gateway.
   * Must be called once during setup.
   */
  async registerBridge(): Promise<void> {
    console.log(`[ABDM] Registering bridge callback: ${this.config.callbackUrl}`);
    const headers = await this.getHeaders();

    const resp = await fetch(`${this.config.gatewayUrl}/devservice/v1/bridges`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        url: this.config.callbackUrl,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[ABDM] Bridge registration failed (${resp.status}): ${err}`);
    }

    console.log('[ABDM] Bridge callback registered successfully');
  }

  /**
   * Add HIU service to the bridge.
   */
  async addHIUService(hiuName: string): Promise<void> {
    const headers = await this.getHeaders();

    const resp = await fetch(`${this.config.gatewayUrl}/devservice/v1/bridges/addUpdateServices`, {
      method: 'PUT',
      headers,
      body: JSON.stringify([
        {
          id: this.config.hiuId,
          name: hiuName,
          type: 'HIU',
          active: true,
          alias: ['XSPAN'],
        },
      ]),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[ABDM] HIU service registration failed (${resp.status}): ${err}`);
    }

    console.log(`[ABDM] HIU service registered: ${hiuName} (${this.config.hiuId})`);
  }

  // ── Patient Discovery ────────────────────────────────────────

  /**
   * Discover care contexts for a patient by ABHA address.
   */
  async discoverPatient(abhaAddress: string): Promise<string> {
    const requestId = randomUUID();
    const headers = await this.getHeaders();

    console.log(`[ABDM] Discovering patient: ${abhaAddress}`);
    const resp = await fetch(`${this.config.gatewayUrl}/gateway/v0.5/care-contexts/discover`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        timestamp: new Date().toISOString(),
        patient: {
          id: abhaAddress,
          verifiedIdentifiers: [
            { type: 'HEALTH_NUMBER', value: abhaAddress },
          ],
          unverifiedIdentifiers: [],
          name: '',
          gender: null,
          yearOfBirth: null,
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[ABDM] Patient discovery failed (${resp.status}): ${err}`);
      throw new Error(`Patient discovery failed: ${err}`);
    }

    console.log(`[ABDM] Patient discovery request sent: ${requestId}`);
    return requestId;
  }

  // ── Consent Management ──────────────────────────────────────

  /**
   * Request consent from patient to access their health records.
   * Patient will see the request in their ABHA app and can approve/deny.
   */
  async requestConsent(
    abhaAddress: string,
    hiTypes: HealthInfoType[] = ['OPConsultation', 'Prescription', 'DischargeSummary', 'DiagnosticReport', 'ImmunizationRecord'],
    dateRangeYears: number = 5,
  ): Promise<string> {
    const requestId = randomUUID();
    const headers = await this.getHeaders();

    const now = new Date();
    const fromDate = new Date(now.getFullYear() - dateRangeYears, now.getMonth(), now.getDate());

    const consentRequest: ConsentRequest = {
      purpose: {
        text: 'Health data aggregation for personal health insights',
        code: 'CAREMGT',  // Care Management
      },
      patient: {
        id: abhaAddress,
      },
      hip: null,  // null = all linked health facilities
      hiu: {
        id: this.config.hiuId,
      },
      requester: {
        name: 'XSpan HealthAI Agent',
        identifier: {
          type: 'REGNO',
          value: this.config.hiuId,
          system: 'https://xspan.ai',
        },
      },
      hiTypes,
      permission: {
        accessMode: 'VIEW',
        dateRange: {
          from: fromDate.toISOString(),
          to: now.toISOString(),
        },
        dataEraseAt: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString(),
        frequency: {
          unit: 'HOUR',
          value: 1,
          repeats: 0,
        },
      },
    };

    console.log(`[ABDM] Requesting consent for ${abhaAddress} (${hiTypes.join(', ')})`);
    const resp = await fetch(`${this.config.gatewayUrl}/gateway/v0.5/consent-requests/init`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        timestamp: new Date().toISOString(),
        consent: consentRequest,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[ABDM] Consent request failed (${resp.status}): ${err}`);
      throw new Error(`Consent request failed: ${err}`);
    }

    console.log(`[ABDM] Consent request sent: ${requestId}`);
    console.log(`[ABDM] Patient will see the request in their ABHA app`);
    return requestId;
  }

  /**
   * Fetch consent artefact after patient grants consent.
   */
  async fetchConsentArtefact(consentId: string): Promise<string> {
    const requestId = randomUUID();
    const headers = await this.getHeaders();

    console.log(`[ABDM] Fetching consent artefact: ${consentId}`);
    const resp = await fetch(`${this.config.gatewayUrl}/gateway/v0.5/consents/fetch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        timestamp: new Date().toISOString(),
        consentId,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Consent fetch failed: ${err}`);
    }

    console.log(`[ABDM] Consent artefact fetch requested: ${requestId}`);
    return requestId;
  }

  // ── Health Data Retrieval ────────────────────────────────────

  /**
   * Request health information using a granted consent artefact.
   * Data arrives asynchronously at the callback URL.
   */
  async requestHealthData(
    consentId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<string> {
    const requestId = randomUUID();
    const transactionId = randomUUID();
    const headers = await this.getHeaders();

    // Generate key pair for encrypted data transfer
    const { publicKey, nonce } = this.generateKeyMaterial();

    console.log(`[ABDM] Requesting health data (consent: ${consentId})`);
    const resp = await fetch(`${this.config.gatewayUrl}/gateway/v0.5/health-information/hiu/request`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId,
        timestamp: new Date().toISOString(),
        hiRequest: {
          consent: { id: consentId },
          dateRange: {
            from: dateFrom,
            to: dateTo,
          },
          dataPushUrl: `${this.config.callbackUrl}/health-data`,
          keyMaterial: {
            cryptoAlg: 'ECDH',
            curve: 'Curve25519',
            dhPublicKey: {
              expiry: new Date(Date.now() + 86400000).toISOString(),
              parameters: 'Curve25519/32byte random key',
              keyValue: publicKey,
            },
            nonce,
          },
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Health data request failed: ${err}`);
    }

    console.log(`[ABDM] Health data request sent: ${transactionId}`);
    console.log(`[ABDM] Data will arrive at: ${this.config.callbackUrl}/health-data`);
    return transactionId;
  }

  // ── Key Material (simplified — production needs proper ECDH) ─

  private generateKeyMaterial(): { publicKey: string; nonce: string } {
    // In production, use proper Curve25519 ECDH key exchange
    // For sandbox testing, generate random values
    const crypto = require('crypto');
    return {
      publicKey: crypto.randomBytes(32).toString('base64'),
      nonce: crypto.randomBytes(32).toString('base64'),
    };
  }

  // ── Status Check ────────────────────────────────────────────

  /**
   * Check gateway connectivity.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const session = await this.getSession();
      return !!session.accessToken;
    } catch {
      return false;
    }
  }
}
