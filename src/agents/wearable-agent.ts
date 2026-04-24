// ============================================================
// Wearable Agent — manages ROOK (tryrook.io) for all wearables
// Oura, WHOOP, Fitbit, Garmin, Dexcom, Withings, Polar, Apple Health
//
// User never sees "ROOK" — they just see their devices.
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus } from './types.js';
import type { LocalStore } from '../storage/local-store.js';

const ROOK_BASE_SANDBOX = 'https://api.rook-connect.review/api/v1';
const ROOK_BASE_PROD = 'https://api.rook-connect.com/api/v1';
const WEBHOOK_POLL_URL = 'https://research.xspan.ai/api/rook/webhook';

export class WearableAgent implements SubAgent {
  name = 'wearable-agent';
  description = 'Connects and syncs wearable devices (Oura, WHOOP, Fitbit, Garmin, Dexcom, etc.)';
  status: AgentStatus = 'idle';

  private store: LocalStore;
  private rookBase: string;
  private rookAuth: string;
  private userId: string;
  private lastSyncTimestamp = '2020-01-01T00:00:00Z';

  constructor(store: LocalStore, config: {
    clientUuid: string;
    secretKey: string;
    environment: 'sandbox' | 'production';
    userId: string;
  }) {
    this.store = store;
    this.rookBase = config.environment === 'production' ? ROOK_BASE_PROD : ROOK_BASE_SANDBOX;
    this.rookAuth = 'Basic ' + Buffer.from(`${config.clientUuid}:${config.secretKey}`).toString('base64');
    this.userId = config.userId;
  }

  async initialize(): Promise<void> {
    try {
      const resp = await fetch(`${this.rookBase}/ping`, { headers: { 'Authorization': this.rookAuth } });
      this.status = resp.ok ? 'idle' : 'error';
    } catch {
      this.status = 'error';
    }
  }

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    switch (message.action) {
      case 'sync':
        return this.sync(message);
      case 'get-sources':
        return this.getSources(message);
      case 'authorize':
        return this.authorize(message);
      default:
        return { ...message, from: this.name, to: 'orchestrator', type: 'error', payload: { error: `Unknown action: ${message.action}` } };
    }
  }

  getStatus(): AgentStatus { return this.status; }
  async shutdown(): Promise<void> { this.status = 'idle'; }

  // ── Actions ─────────────────────────────────────────────────

  private async sync(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';
    let stored = 0;

    try {
      // Poll the Vercel webhook relay for new data from ROOK
      const resp = await fetch(`${WEBHOOK_POLL_URL}?user_id=${this.userId}&since=${encodeURIComponent(this.lastSyncTimestamp)}&limit=500`);
      const webhookData = await resp.json() as { data?: Array<{ payload: Record<string, unknown>; receivedAt: string; dataType: string; source: string }> };
      const entries = webhookData.data || [];

      for (const entry of entries) {
        stored += this.processWebhookEntry(entry);
      }

      this.lastSyncTimestamp = new Date().toISOString();
      this.status = 'idle';

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { stored, entries: entries.length } };
    } catch (err) {
      this.status = 'error';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err), stored } };
    }
  }

  private async getSources(msg: AgentMessage): Promise<AgentMessage> {
    try {
      const resp = await fetch(`${this.rookBase}/user_id/${this.userId}/data_sources/authorized`, {
        headers: { 'Authorization': this.rookAuth },
      });
      const data = await resp.json() as { sources: Record<string, boolean> };

      // Map source IDs to user-friendly names (no "ROOK" branding)
      const sourceNames: Record<string, string> = {
        oura: 'Oura Ring', whoop: 'WHOOP', fitbit: 'Fitbit', garmin: 'Garmin',
        dexcom: 'Dexcom CGM', withings: 'Withings', polar: 'Polar',
        apple_health: 'Apple Health', google_fit: 'Google Fit',
        health_connect: 'Health Connect', android: 'Android',
      };

      const sources = Object.entries(data.sources || {}).map(([id, connected]) => ({
        id, name: sourceNames[id] || id, connected,
      }));

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { sources } };
    } catch (err) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  private async authorize(msg: AgentMessage): Promise<AgentMessage> {
    const source = msg.payload.source as string || 'oura';
    try {
      const resp = await fetch(`${this.rookBase}/user_id/${this.userId}/data_source/${source}/authorizer`, {
        headers: { 'Authorization': this.rookAuth },
      });
      const data = await resp.json() as { authorized: boolean; authorization_url?: string };
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: data as Record<string, unknown> };
    } catch (err) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  // ── Data Processing ─────────────────────────────────────────

  private processWebhookEntry(entry: { payload: Record<string, unknown>; receivedAt: string; source: string }): number {
    let stored = 0;
    const data = (entry.payload.data || entry.payload) as Record<string, unknown>;
    const recordedAt = new Date((data.datetime as string) || entry.receivedAt);

    const fieldMap: Record<string, { type: string; unit: string; divideBy?: number }> = {
      steps: { type: 'steps', unit: 'count' },
      calories: { type: 'caloriesActive', unit: 'kcal' },
      hr_average: { type: 'heartRateResting', unit: 'bpm' },
      hrv_average: { type: 'hrv', unit: 'ms' },
      sleep_duration_seconds: { type: 'totalSleepMin', unit: 'min', divideBy: 60 },
      deep_sleep_seconds: { type: 'deepSleepMin', unit: 'min', divideBy: 60 },
      rem_sleep_seconds: { type: 'remSleepMin', unit: 'min', divideBy: 60 },
      light_sleep_seconds: { type: 'lightSleepMin', unit: 'min', divideBy: 60 },
      sleep_score: { type: 'sleepScore', unit: 'score' },
      recovery_score: { type: 'recoveryScore', unit: 'score' },
      strain_score: { type: 'strainScore', unit: 'score' },
      spo2_average: { type: 'spo2', unit: '%' },
      respiratory_rate_average: { type: 'respiratoryRate', unit: 'breaths/min' },
      temperature_delta: { type: 'skinTempDev', unit: 'C' },
      weight_kg: { type: 'weightKg', unit: 'kg' },
      blood_glucose_mg_dl: { type: 'bloodGlucose', unit: 'mg/dL' },
      blood_pressure_systolic: { type: 'bpSystolic', unit: 'mmHg' },
      blood_pressure_diastolic: { type: 'bpDiastolic', unit: 'mmHg' },
      vo2_max: { type: 'vo2Max', unit: 'mL/kg/min' },
    };

    for (const [key, meta] of Object.entries(fieldMap)) {
      const val = data[key];
      if (val !== undefined && val !== null) {
        const numVal = meta.divideBy ? Number(val) / meta.divideBy : Number(val);
        try {
          this.store.insertSample({
            id: Math.random().toString(36).slice(2),
            source: 'wearable',
            dataType: meta.type,
            value: numVal,
            unit: meta.unit,
            metadata: { provider: entry.source, via: 'rook' },
            recordedAt,
            syncedAt: new Date(),
          });
          stored++;
        } catch {}
      }
    }

    return stored;
  }
}
