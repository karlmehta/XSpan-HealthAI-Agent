import { randomUUID } from 'crypto';
import type { HealthSample, DataSource } from '../../types/index.js';

// ── Wearable Connector Interface ────────────────────────────────

export interface WearableCredentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface WearableConnector {
  readonly name: string;
  readonly source: DataSource;
  connect(credentials: WearableCredentials): Promise<void>;
  syncData(since: Date): Promise<HealthSample[]>;
  disconnect(): Promise<void>;
}

// ── Oura Ring Connector ─────────────────────────────────────────

export class OuraConnector implements WearableConnector {
  readonly name = 'Oura Ring';
  readonly source: DataSource = 'apple_health'; // Oura syncs via Apple Health on iOS
  private credentials: WearableCredentials | null = null;

  async connect(credentials: WearableCredentials): Promise<void> {
    console.warn('[Oura] Oura Ring direct API integration coming in v1.1');
    console.warn('[Oura] For now, Oura data syncs via Apple Health automatically');
    this.credentials = credentials;
  }

  async syncData(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Oura connector not connected. Call connect() first.');
    }

    console.warn('[Oura] Direct sync not yet implemented — using Apple Health bridge');
    console.warn(`[Oura] Would sync data since ${since.toISOString()}`);

    // TODO v1.1: Call Oura API v2
    // GET https://api.ouraring.com/v2/usercollection/daily_sleep
    // GET https://api.ouraring.com/v2/usercollection/daily_readiness
    // GET https://api.ouraring.com/v2/usercollection/heartrate

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Oura] Disconnected');
  }
}

// ── WHOOP Connector ─────────────────────────────────────────────

export class WhoopConnector implements WearableConnector {
  readonly name = 'WHOOP';
  readonly source: DataSource = 'apple_health';
  private credentials: WearableCredentials | null = null;

  async connect(credentials: WearableCredentials): Promise<void> {
    console.warn('[WHOOP] WHOOP API integration coming in v1.1');
    console.warn('[WHOOP] For now, WHOOP data syncs via Apple Health automatically');
    this.credentials = credentials;
  }

  async syncData(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('WHOOP connector not connected. Call connect() first.');
    }

    console.warn('[WHOOP] Direct sync not yet implemented — using Apple Health bridge');
    console.warn(`[WHOOP] Would sync data since ${since.toISOString()}`);

    // TODO v1.1: Call WHOOP API v1
    // GET https://api.prod.whoop.com/developer/v1/activity/sleep
    // GET https://api.prod.whoop.com/developer/v1/recovery
    // GET https://api.prod.whoop.com/developer/v1/activity/workout

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[WHOOP] Disconnected');
  }
}

// ── Dexcom CGM Connector ────────────────────────────────────────

export class DexcomConnector implements WearableConnector {
  readonly name = 'Dexcom CGM';
  readonly source: DataSource = 'apple_health';
  private credentials: WearableCredentials | null = null;
  private sandbox = true;

  async connect(credentials: WearableCredentials): Promise<void> {
    console.warn('[Dexcom] Dexcom CGM API integration coming in v1.1');
    console.warn('[Dexcom] For now, Dexcom data syncs via Apple Health automatically');
    this.credentials = credentials;
  }

  async syncData(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Dexcom connector not connected. Call connect() first.');
    }

    console.warn('[Dexcom] Direct sync not yet implemented — using Apple Health bridge');
    console.warn(`[Dexcom] Would sync glucose readings since ${since.toISOString()}`);

    // TODO v1.1: Call Dexcom API v3
    // Base URL: https://api.dexcom.com (prod) or https://sandbox-api.dexcom.com
    // GET /v3/users/self/egvs?startDate=...&endDate=...
    // GET /v3/users/self/events?startDate=...&endDate=...

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Dexcom] Disconnected');
  }
}

// ── Garmin Connect Connector ────────────────────────────────────

export class GarminConnector implements WearableConnector {
  readonly name = 'Garmin Connect';
  readonly source: DataSource = 'apple_health';
  private credentials: WearableCredentials | null = null;

  async connect(credentials: WearableCredentials): Promise<void> {
    console.warn('[Garmin] Garmin Connect API integration coming in v1.2');
    console.warn('[Garmin] For now, Garmin data syncs via Apple Health automatically');
    this.credentials = credentials;
  }

  async syncData(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Garmin connector not connected. Call connect() first.');
    }

    console.warn('[Garmin] Direct sync not yet implemented — using Apple Health bridge');
    console.warn(`[Garmin] Would sync data since ${since.toISOString()}`);

    // TODO v1.2: Call Garmin Health API (OAuth 1.0a)
    // Garmin uses push-based API (webhooks), so this requires a server component
    // GET https://apis.garmin.com/wellness-api/rest/dailies
    // GET https://apis.garmin.com/wellness-api/rest/activities
    // GET https://apis.garmin.com/wellness-api/rest/sleeps

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Garmin] Disconnected');
  }
}

// ── Fitbit Connector ────────────────────────────────────────────

export class FitbitConnector implements WearableConnector {
  readonly name = 'Fitbit';
  readonly source: DataSource = 'apple_health';
  private credentials: WearableCredentials | null = null;

  async connect(credentials: WearableCredentials): Promise<void> {
    console.warn('[Fitbit] Fitbit Web API integration coming in v1.2');
    console.warn('[Fitbit] For now, Fitbit data syncs via Apple Health automatically');
    this.credentials = credentials;
  }

  async syncData(since: Date): Promise<HealthSample[]> {
    if (!this.credentials) {
      throw new Error('Fitbit connector not connected. Call connect() first.');
    }

    console.warn('[Fitbit] Direct sync not yet implemented — using Apple Health bridge');
    console.warn(`[Fitbit] Would sync data since ${since.toISOString()}`);

    // TODO v1.2: Call Fitbit Web API v1.2 (OAuth2)
    // Base URL: https://api.fitbit.com
    // GET /1/user/-/activities/heart/date/today/1d.json
    // GET /1.2/user/-/sleep/date/{date}.json
    // GET /1/user/-/activities/date/{date}.json
    // GET /1/user/-/body/log/weight/date/{date}.json

    return [];
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Fitbit] Disconnected');
  }
}

// ── Factory ─────────────────────────────────────────────────────

export type WearableProvider = 'oura' | 'whoop' | 'dexcom' | 'garmin' | 'fitbit';

export function createWearableConnector(provider: WearableProvider): WearableConnector {
  switch (provider) {
    case 'oura':
      return new OuraConnector();
    case 'whoop':
      return new WhoopConnector();
    case 'dexcom':
      return new DexcomConnector();
    case 'garmin':
      return new GarminConnector();
    case 'fitbit':
      return new FitbitConnector();
    default:
      throw new Error(`Unknown wearable provider: ${provider}`);
  }
}
