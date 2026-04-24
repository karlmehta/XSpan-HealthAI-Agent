// ============================================================
// MyHealthSpan Agent — ROOK Connected Health (tryrook.io)
// Wearable data aggregator — 400+ devices, 11 sources
// Replaces Terra API for wearable connectivity
//
// Sources: Oura, Fitbit, Garmin, WHOOP, Dexcom, Withings,
//          Polar, Apple Health, Google Fit, Health Connect, Android
//
// Docs: https://docs.tryrook.io
// Auth: HTTP Basic (client_uuid:secret_key)
// Data: Webhook push + REST API on-demand
// ============================================================

export interface RookConfig {
  clientUuid: string;
  secretKey: string;
  environment: 'sandbox' | 'production';
}

export interface RookSourceStatus {
  oura: boolean;
  polar: boolean;
  whoop: boolean;
  dexcom: boolean;
  fitbit: boolean;
  garmin: boolean;
  withings: boolean;
  google_fit: boolean;
  apple_health: boolean;
  health_connect: boolean;
  android: boolean;
}

export interface RookAuthResult {
  data_source: string;
  authorized: boolean;
  authorization_url?: string;
}

export type RookSource = 'oura' | 'polar' | 'whoop' | 'dexcom' | 'fitbit' | 'garmin' | 'withings' | 'google_fit' | 'apple_health' | 'health_connect' | 'android';

const ROOK_SOURCES: { id: RookSource; name: string; icon: string; desc: string }[] = [
  { id: 'oura', name: 'Oura Ring', icon: '\u{1F48D}', desc: 'Sleep, HRV, readiness, temperature, activity' },
  { id: 'whoop', name: 'WHOOP', icon: '\u{1F4AA}', desc: 'Strain, recovery, sleep, HRV, respiratory rate' },
  { id: 'fitbit', name: 'Fitbit', icon: '\u{231A}', desc: 'Steps, heart rate, sleep, SpO2, stress' },
  { id: 'garmin', name: 'Garmin', icon: '\u{1F3C3}', desc: 'Activity, sleep, stress, body battery, pulse ox' },
  { id: 'dexcom', name: 'Dexcom CGM', icon: '\u{1FA78}', desc: 'Continuous glucose monitoring (5-min intervals)' },
  { id: 'withings', name: 'Withings', icon: '\u{2696}\u{FE0F}', desc: 'Weight, BP, sleep, ECG, temperature' },
  { id: 'polar', name: 'Polar', icon: '\u{2744}\u{FE0F}', desc: 'Heart rate, training load, sleep, recovery' },
  { id: 'apple_health', name: 'Apple Health', icon: '\u{1F34E}', desc: 'Steps, HR, HRV, sleep, SpO2, temperature' },
  { id: 'google_fit', name: 'Google Fit', icon: '\u{1F4F1}', desc: 'Activity, sleep, heart rate, body measurements' },
  { id: 'health_connect', name: 'Health Connect', icon: '\u{1F4F2}', desc: 'Android unified health data (Samsung, Pixel, etc.)' },
  { id: 'android', name: 'Android SDK', icon: '\u{1F916}', desc: 'Direct device sensors via ROOK Android SDK' },
];

export { ROOK_SOURCES };

const SANDBOX_BASE = 'https://api.rook-connect.review/api/v1';
const PROD_BASE = 'https://api.rook-connect.com/api/v1';

export class RookClient {
  private config: RookConfig;
  private baseUrl: string;
  private authHeader: string;

  constructor(config: RookConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'sandbox' ? SANDBOX_BASE : PROD_BASE;
    this.authHeader = 'Basic ' + Buffer.from(`${config.clientUuid}:${config.secretKey}`).toString('base64');
    console.log(`[ROOK] Client initialized (${config.environment}) — 11 wearable sources available`);
  }

  // ── Source Management ───────────────────────────────────────

  /**
   * Get authorization status for all data sources for a user.
   */
  async getSourceStatus(userId: string): Promise<RookSourceStatus> {
    const resp = await this.request(`/user_id/${userId}/data_sources/authorized`);
    if (!resp.ok) throw new Error(`[ROOK] Failed to get source status: ${resp.status}`);
    const data = await resp.json() as { sources: RookSourceStatus };
    return data.sources;
  }

  /**
   * Get OAuth authorization URL for a specific wearable source.
   * User clicks this URL to connect their wearable account.
   */
  async getAuthUrl(userId: string, source: RookSource, redirectUrl?: string): Promise<RookAuthResult> {
    const params = redirectUrl ? `?redirect_url=${encodeURIComponent(redirectUrl)}` : '';
    const resp = await this.request(`/user_id/${userId}/data_source/${source}/authorizer${params}`);
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`[ROOK] Authorizer failed for ${source}: ${resp.status} ${err}`);
    }
    return await resp.json() as RookAuthResult;
  }

  /**
   * Revoke all data source connections for a user.
   */
  async revokeAll(userId: string): Promise<void> {
    const resp = await this.request(`/user_id/${userId}/data_sources/revoke_auth`, { method: 'POST' });
    if (!resp.ok) console.warn(`[ROOK] Revoke failed: ${resp.status}`);
    else console.log(`[ROOK] All sources revoked for user ${userId}`);
  }

  // ── Health Data Retrieval ───────────────────────────────────

  /**
   * Fetch sleep summary for a date.
   */
  async getSleepSummary(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'sleep', 'summary', date);
  }

  /**
   * Fetch physical/activity summary for a date.
   */
  async getPhysicalSummary(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'physical', 'summary', date);
  }

  /**
   * Fetch body summary for a date.
   */
  async getBodySummary(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'body', 'summary', date);
  }

  /**
   * Fetch heart rate events for a date.
   */
  async getHeartRateEvents(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'heart_rate', 'events', date);
  }

  /**
   * Fetch oxygenation events for a date.
   */
  async getOxygenationEvents(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'oxygenation', 'events', date);
  }

  /**
   * Fetch stress events for a date.
   */
  async getStressEvents(userId: string, date: string): Promise<unknown> {
    return this.fetchData(userId, 'stress', 'events', date);
  }

  /**
   * Fetch all available health data for a date (convenience method).
   */
  async fetchAllData(userId: string, date: string): Promise<{
    sleep: unknown;
    physical: unknown;
    body: unknown;
    heartRate: unknown;
    oxygenation: unknown;
    stress: unknown;
  }> {
    console.log(`[ROOK] Fetching all health data for ${userId} on ${date}...`);

    const [sleep, physical, body, heartRate, oxygenation, stress] = await Promise.allSettled([
      this.getSleepSummary(userId, date),
      this.getPhysicalSummary(userId, date),
      this.getBodySummary(userId, date),
      this.getHeartRateEvents(userId, date),
      this.getOxygenationEvents(userId, date),
      this.getStressEvents(userId, date),
    ]);

    return {
      sleep: sleep.status === 'fulfilled' ? sleep.value : null,
      physical: physical.status === 'fulfilled' ? physical.value : null,
      body: body.status === 'fulfilled' ? body.value : null,
      heartRate: heartRate.status === 'fulfilled' ? heartRate.value : null,
      oxygenation: oxygenation.status === 'fulfilled' ? oxygenation.value : null,
      stress: stress.status === 'fulfilled' ? stress.value : null,
    };
  }

  // ── Webhook Payload Processing ──────────────────────────────

  /**
   * Process incoming webhook payload from ROOK.
   * Returns normalized health samples for storage.
   */
  static processWebhook(payload: Record<string, unknown>): {
    userId: string;
    dataType: string;
    source: string;
    samples: Array<{ dataType: string; value: number; unit: string; recordedAt: string }>;
  } {
    const userId = (payload.user_id as string) || '';
    const dataType = (payload.data_type as string) || (payload.type as string) || 'unknown';
    const source = (payload.data_source as string) || (payload.source as string) || 'rook';

    const samples: Array<{ dataType: string; value: number; unit: string; recordedAt: string }> = [];

    // Extract from sleep summary
    if (dataType.includes('sleep')) {
      const sleep = (payload.sleep_summary || payload.data || payload) as Record<string, unknown>;
      if (sleep.sleep_duration_seconds) samples.push({ dataType: 'totalSleepMin', value: Number(sleep.sleep_duration_seconds) / 60, unit: 'min', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.deep_sleep_seconds) samples.push({ dataType: 'deepSleepMin', value: Number(sleep.deep_sleep_seconds) / 60, unit: 'min', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.rem_sleep_seconds) samples.push({ dataType: 'remSleepMin', value: Number(sleep.rem_sleep_seconds) / 60, unit: 'min', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.light_sleep_seconds) samples.push({ dataType: 'lightSleepMin', value: Number(sleep.light_sleep_seconds) / 60, unit: 'min', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.sleep_score) samples.push({ dataType: 'sleepScore', value: Number(sleep.sleep_score), unit: 'score', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.hr_average) samples.push({ dataType: 'avgHrSleep', value: Number(sleep.hr_average), unit: 'bpm', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.hrv_average) samples.push({ dataType: 'avgHrvSleep', value: Number(sleep.hrv_average), unit: 'ms', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.respiratory_rate_average) samples.push({ dataType: 'avgRespRateSleep', value: Number(sleep.respiratory_rate_average), unit: 'breaths/min', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.spo2_average) samples.push({ dataType: 'avgSpo2Sleep', value: Number(sleep.spo2_average), unit: '%', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
      if (sleep.temperature_delta) samples.push({ dataType: 'skinTempDev', value: Number(sleep.temperature_delta), unit: 'C', recordedAt: (sleep.datetime as string) || new Date().toISOString() });
    }

    // Extract from physical summary
    if (dataType.includes('physical')) {
      const phys = (payload.physical_summary || payload.data || payload) as Record<string, unknown>;
      if (phys.steps) samples.push({ dataType: 'steps', value: Number(phys.steps), unit: 'count', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.active_seconds) samples.push({ dataType: 'activeMin', value: Number(phys.active_seconds) / 60, unit: 'min', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.calories) samples.push({ dataType: 'caloriesActive', value: Number(phys.calories), unit: 'kcal', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.distance_meters) samples.push({ dataType: 'distanceM', value: Number(phys.distance_meters), unit: 'm', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.hr_average) samples.push({ dataType: 'heartRateResting', value: Number(phys.hr_average), unit: 'bpm', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.hrv_average) samples.push({ dataType: 'hrvSdnn', value: Number(phys.hrv_average), unit: 'ms', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.stress_score) samples.push({ dataType: 'stressScore', value: Number(phys.stress_score), unit: 'score', recordedAt: (phys.datetime as string) || new Date().toISOString() });
      if (phys.vo2_max) samples.push({ dataType: 'vo2Max', value: Number(phys.vo2_max), unit: 'mL/kg/min', recordedAt: (phys.datetime as string) || new Date().toISOString() });
    }

    // Extract from body summary
    if (dataType.includes('body')) {
      const body = (payload.body_summary || payload.data || payload) as Record<string, unknown>;
      if (body.weight_kg) samples.push({ dataType: 'weightKg', value: Number(body.weight_kg), unit: 'kg', recordedAt: (body.datetime as string) || new Date().toISOString() });
      if (body.blood_glucose_mg_dl) samples.push({ dataType: 'bloodGlucose', value: Number(body.blood_glucose_mg_dl), unit: 'mg/dL', recordedAt: (body.datetime as string) || new Date().toISOString() });
      if (body.blood_pressure_systolic) samples.push({ dataType: 'bpSystolic', value: Number(body.blood_pressure_systolic), unit: 'mmHg', recordedAt: (body.datetime as string) || new Date().toISOString() });
      if (body.blood_pressure_diastolic) samples.push({ dataType: 'bpDiastolic', value: Number(body.blood_pressure_diastolic), unit: 'mmHg', recordedAt: (body.datetime as string) || new Date().toISOString() });
      if (body.spo2_percentage) samples.push({ dataType: 'spo2', value: Number(body.spo2_percentage), unit: '%', recordedAt: (body.datetime as string) || new Date().toISOString() });
      if (body.temperature_celsius) samples.push({ dataType: 'bodyTemperature', value: Number(body.temperature_celsius), unit: 'C', recordedAt: (body.datetime as string) || new Date().toISOString() });
    }

    console.log(`[ROOK] Webhook processed: ${dataType} from ${source} — ${samples.length} samples`);
    return { userId, dataType, source, samples };
  }

  // ── Utilities ───────────────────────────────────────────────

  async checkHealth(): Promise<boolean> {
    try {
      const resp = await this.request('/ping');
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── Private ─────────────────────────────────────────────────

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  }

  private async fetchData(userId: string, metric: string, type: string, date: string): Promise<unknown> {
    try {
      const resp = await this.request(`/user_id/${userId}/${metric}/${type}?date=${date}`);
      if (!resp.ok) {
        if (resp.status === 404) return null; // No data for this date
        console.warn(`[ROOK] ${metric}/${type} failed: ${resp.status}`);
        return null;
      }
      return await resp.json();
    } catch (err) {
      console.error(`[ROOK] ${metric}/${type} error:`, err);
      return null;
    }
  }
}
