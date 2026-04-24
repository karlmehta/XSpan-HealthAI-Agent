// ============================================================
// EHR Agent — manages b.well for health record access
// Connects to 650+ EHR systems (Epic, Cerner, Allscripts, etc.)
//
// User never sees "b.well" — they just see "Health Records"
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus } from './types.js';
import type { LocalStore } from '../storage/local-store.js';

const SANDBOX_GATEWAY = 'https://api-gateway.client-sandbox.icanbwell.com';
const SANDBOX_API = 'https://api.client-sandbox.icanbwell.com';
const PROD_GATEWAY = 'https://api-gateway.prod.icanbwell.com';
const PROD_API = 'https://api.prod.icanbwell.com';

export class EhrAgent implements SubAgent {
  name = 'ehr-agent';
  description = 'Connects to health records from 650+ hospitals (Epic, Cerner, Allscripts, etc.)';
  status: AgentStatus = 'idle';

  private store: LocalStore;
  private clientKey: string;
  private gatewayUrl: string;
  private apiUrl: string;
  private accessToken: string | null = null;
  private personId: string | null = null;

  constructor(store: LocalStore, config: {
    clientKey: string;
    environment: 'sandbox' | 'production';
  }) {
    this.store = store;
    this.clientKey = config.clientKey;
    this.gatewayUrl = config.environment === 'production' ? PROD_GATEWAY : SANDBOX_GATEWAY;
    this.apiUrl = config.environment === 'production' ? PROD_API : SANDBOX_API;
  }

  async initialize(): Promise<void> {
    this.status = 'idle';
  }

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    switch (message.action) {
      case 'login':
        return this.login(message);
      case 'sync':
        return this.sync(message);
      case 'get-records':
        return this.getRecords(message);
      case 'get-connected-systems':
        return this.getConnectedSystems(message);
      default:
        return { ...message, from: this.name, to: 'orchestrator', type: 'error', payload: { error: `Unknown action: ${message.action}` } };
    }
  }

  getStatus(): AgentStatus { return this.status; }
  async shutdown(): Promise<void> { this.status = 'idle'; this.accessToken = null; }

  // ── Actions ─────────────────────────────────────────────────

  private async login(msg: AgentMessage): Promise<AgentMessage> {
    const email = msg.payload.email as string;
    const password = msg.payload.password as string;

    try {
      const resp = await fetch(`${this.gatewayUrl}/identity/account/login`, {
        method: 'POST',
        headers: { 'clientkey': this.clientKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!resp.ok) {
        return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: `Login failed (${resp.status})` } };
      }

      const data = await resp.json() as {
        accessToken?: { jwtToken?: string; payload?: { bwellFhirPersonId?: string } };
      };

      this.accessToken = data.accessToken?.jwtToken || null;
      this.personId = data.accessToken?.payload?.bwellFhirPersonId || null;

      if (!this.accessToken) {
        return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: 'No access token' } };
      }

      this.status = 'idle';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { success: true, personId: this.personId } };
    } catch (err) {
      this.status = 'error';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  private async sync(msg: AgentMessage): Promise<AgentMessage> {
    // Auto-login if not authenticated
    if (!this.accessToken) {
      const email = msg.payload.email as string || process.env.BWELL_EMAIL || '';
      const password = msg.payload.password as string || process.env.BWELL_PASSWORD || '';
      if (email && password) {
        await this.login({ ...msg, payload: { email, password } });
      }
    }

    if (!this.accessToken || !this.personId) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { stored: 0, error: 'Not authenticated' } };
    }

    this.status = 'running';

    try {
      const resp = await fetch(`${this.apiUrl}/v1/Patient/person.${this.personId}/$everything`, {
        headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Accept': 'application/fhir+json' },
      });

      if (!resp.ok) {
        this.status = 'error';
        return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: `FHIR fetch failed (${resp.status})` } };
      }

      const bundle = await resp.json() as {
        entry?: Array<{ resource: Record<string, unknown> }>;
      };

      const entries = bundle.entry || [];
      const categories: Record<string, number> = {};
      let stored = 0;

      for (const e of entries) {
        const r = e.resource;
        const rt = r.resourceType as string;
        categories[rt] = (categories[rt] || 0) + 1;

        // Store observations as health samples
        if (rt === 'Observation') {
          const coding = (r.code as { coding?: Array<{ code?: string; display?: string }> })?.coding?.[0];
          const vq = r.valueQuantity as { value?: number; unit?: string } | undefined;
          if (coding?.display && vq?.value !== undefined) {
            try {
              this.store.insertSample({
                id: Math.random().toString(36).slice(2),
                source: 'ehr',
                dataType: coding.display,
                value: vq.value,
                unit: vq.unit || '',
                metadata: { loincCode: coding.code, provider: 'health-system' },
                recordedAt: new Date((r.effectiveDateTime as string) || (r.issued as string) || Date.now()),
                syncedAt: new Date(),
              });
              stored++;
            } catch {}
          }
        }
      }

      this.status = 'idle';
      console.log(`[EHR Agent] Synced ${stored} observations from ${entries.length} total resources`);

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: {
        stored, total: entries.length, categories,
      }};
    } catch (err) {
      this.status = 'error';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  private async getRecords(msg: AgentMessage): Promise<AgentMessage> {
    try {
      const rows = this.store.db.prepare(
        "SELECT data_type, value, unit, recorded_at, source FROM health_samples WHERE source = 'ehr' ORDER BY recorded_at DESC LIMIT 500"
      ).all() as Array<{ data_type: string; value: number; unit: string; recorded_at: string; source: string }>;

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { records: rows, total: rows.length } };
    } catch (err) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  /** Get health systems already matched/connected to this user via b.well */
  private async getConnectedSystems(msg: AgentMessage): Promise<AgentMessage> {
    // Auto-login if needed
    if (!this.accessToken) {
      const email = process.env.BWELL_EMAIL || '';
      const password = process.env.BWELL_PASSWORD || '';
      if (email && password) await this.login({ ...msg, payload: { email, password } });
    }

    if (!this.accessToken) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { systems: [], authenticated: false } };
    }

    try {
      // Use b.well SDK to get member connections (personalized to this user)
      const { BWellSDK } = await import('@icanbwell/bwell-sdk-ts');
      const sdk = new BWellSDK({ clientKey: this.clientKey });
      await sdk.initialize();
      await sdk.authenticate({ token: this.accessToken });

      const connections = await sdk.connection.getMemberConnections();
      const systems = ((connections as Record<string, unknown>).data as Array<{
        id: string; name: string; status: string; syncStatus: string;
        lastSynced: string; category: string; type: string;
      }>) || [];

      const mapped = systems.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,         // CONNECTED, PENDING, etc.
        syncStatus: s.syncStatus, // RETRIEVED, SYNCING, etc.
        lastSynced: s.lastSynced,
        type: s.type,
      }));

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: {
        systems: mapped,
        authenticated: true,
        total: mapped.length,
      }};
    } catch (err) {
      // Fallback: if SDK fails, return basic status from our session
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: {
        systems: this.accessToken ? [{ id: 'ehr', name: 'Health Records', status: 'CONNECTED', syncStatus: 'RETRIEVED' }] : [],
        authenticated: !!this.accessToken,
      }};
    }
  }

  /** Check if authenticated */
  isAuthenticated(): boolean {
    return !!this.accessToken && !!this.personId;
  }

  /** Set credentials for auto-login */
  setCredentials(email: string, password: string): void {
    process.env.BWELL_EMAIL = email;
    process.env.BWELL_PASSWORD = password;
  }
}
