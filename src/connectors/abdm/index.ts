// ============================================================
// XSpan HealthAI Agent — ABDM Connector (India)
// Connects to Ayushman Bharat Digital Mission for patient
// health records via consent-based data exchange
// ============================================================

import { ABDMClient } from './client.js';
import type { ABDMConfig, HealthInfoType } from './types.js';

export class ABDMConnector {
  private client: ABDMClient;
  private pendingConsents: Map<string, { abhaAddress: string; requestedAt: Date }> = new Map();
  private grantedConsents: Map<string, string> = new Map(); // consentRequestId → consentArtefactId

  constructor(config: ABDMConfig) {
    this.client = new ABDMClient(config);
  }

  /**
   * Initialize the connector: authenticate and register bridge.
   */
  async initialize(): Promise<boolean> {
    try {
      const healthy = await this.client.checkHealth();
      if (!healthy) {
        console.error('[ABDM] Gateway not reachable');
        return false;
      }

      await this.client.registerBridge();
      await this.client.addHIUService('XSpan HealthAI Agent');
      console.log('[ABDM] Connector initialized successfully');
      return true;
    } catch (err) {
      console.error('[ABDM] Initialization failed:', err);
      return false;
    }
  }

  /**
   * Connect a patient: discover their care contexts and request consent.
   * The patient will receive a consent request in their ABHA app.
   */
  async connectPatient(
    abhaAddress: string,
    hiTypes?: HealthInfoType[],
  ): Promise<{ requestId: string; status: string }> {
    console.log(`[ABDM] Connecting patient: ${abhaAddress}`);

    // Step 1: Discover patient
    const discoveryId = await this.client.discoverPatient(abhaAddress);
    console.log(`[ABDM] Discovery request: ${discoveryId}`);

    // Step 2: Request consent (patient approves in ABHA app)
    const consentRequestId = await this.client.requestConsent(abhaAddress, hiTypes);
    this.pendingConsents.set(consentRequestId, {
      abhaAddress,
      requestedAt: new Date(),
    });

    return {
      requestId: consentRequestId,
      status: 'consent_requested',
    };
  }

  /**
   * Handle consent notification callback from ABDM gateway.
   * Called when patient approves or denies the consent request.
   */
  async handleConsentNotification(notification: {
    consentRequestId: string;
    status: string;
    consentArtefacts?: { id: string }[];
  }): Promise<void> {
    const { consentRequestId, status, consentArtefacts } = notification;
    console.log(`[ABDM] Consent notification: ${consentRequestId} → ${status}`);

    if (status === 'GRANTED' && consentArtefacts?.length) {
      const artefactId = consentArtefacts[0].id;
      this.grantedConsents.set(consentRequestId, artefactId);
      console.log(`[ABDM] Consent granted! Artefact: ${artefactId}`);

      // Auto-fetch health data
      const pending = this.pendingConsents.get(consentRequestId);
      if (pending) {
        console.log(`[ABDM] Auto-fetching health data for ${pending.abhaAddress}...`);
        const now = new Date();
        const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
        await this.client.requestHealthData(
          artefactId,
          fiveYearsAgo.toISOString(),
          now.toISOString(),
        );
      }
    } else if (status === 'DENIED') {
      console.log(`[ABDM] Consent denied by patient for request: ${consentRequestId}`);
    }

    this.pendingConsents.delete(consentRequestId);
  }

  /**
   * Handle health data delivery callback from ABDM gateway.
   * Called when health records are transferred after consent.
   */
  async handleHealthDataDelivery(data: {
    transactionId: string;
    entries: { content: string; media: string; careContextReference: string }[];
  }): Promise<number> {
    console.log(`[ABDM] Health data received: ${data.entries.length} entries (tx: ${data.transactionId})`);

    let recordCount = 0;
    for (const entry of data.entries) {
      try {
        // Entries are base64-encoded, encrypted FHIR Bundles
        // In production, decrypt using the ECDH key exchange
        // For now, log the receipt
        console.log(`[ABDM] Entry: ${entry.careContextReference} (${entry.media})`);
        recordCount++;

        // TODO: Decrypt entry.content using ECDH shared key
        // TODO: Parse FHIR Bundle
        // TODO: Store in local SQLite via LocalStore
      } catch (err) {
        console.error(`[ABDM] Failed to process entry:`, err);
      }
    }

    console.log(`[ABDM] Processed ${recordCount} health records`);
    return recordCount;
  }

  /**
   * Get status of pending consent requests.
   */
  getStatus(): {
    pendingConsents: number;
    grantedConsents: number;
  } {
    return {
      pendingConsents: this.pendingConsents.size,
      grantedConsents: this.grantedConsents.size,
    };
  }
}

// Export all types
export type { ABDMConfig, HealthInfoType } from './types.js';
