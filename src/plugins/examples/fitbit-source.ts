// ============================================================
// XSpan AI Agent — Example Source Plugin: Fitbit
// ============================================================
//
// This is a STUB demonstrating how to build a source plugin
// that ingests data from the Fitbit Web API. In production,
// you would implement OAuth 2.0 token management and actual
// HTTP calls to Fitbit's endpoints.
//
// ## How source plugins work
//
//   1. Implement the Plugin interface with type = 'source'.
//   2. In `init()`, validate credentials and set up any
//      HTTP clients or token refresh logic.
//   3. In `execute(context)`, fetch data from the external
//      source and call `context.emit(snapshot)` for each
//      new BiomarkerSnapshot.
//
// ## Usage
//
//   import { createFitbitSourcePlugin } from './plugins/examples/fitbit-source';
//
//   const fitbit = createFitbitSourcePlugin({
//     clientId: 'YOUR_CLIENT_ID',
//     clientSecret: 'YOUR_CLIENT_SECRET',
//     accessToken: 'USER_ACCESS_TOKEN',
//     refreshToken: 'USER_REFRESH_TOKEN',
//   });
//
//   const manager = new PluginManager();
//   await manager.register(fitbit);
//   const newSnapshots = await manager.executeSources(existingSnapshots);
//
// ============================================================

import { BiomarkerSnapshot, BiomarkerVector } from '../../types/index';
import { Plugin, PluginContext } from '../index';

// ── Configuration ───────────────────────────────────────────

export interface FitbitSourceConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  /** Base URL for Fitbit API. Default: https://api.fitbit.com */
  apiBaseUrl?: string;
}

// ── Plugin Implementation ───────────────────────────────────

/**
 * Factory function that creates a Fitbit source plugin instance.
 *
 * @param config - Fitbit API credentials and configuration
 * @returns A Plugin that fetches data from Fitbit
 */
export function createFitbitSourcePlugin(
  config: FitbitSourceConfig,
): Plugin<void> {
  const _apiBaseUrl = config.apiBaseUrl ?? 'https://api.fitbit.com';
  let _initialized = false;

  return {
    name: 'fitbit-source',
    version: '1.0.0',
    type: 'source',

    async init(): Promise<void> {
      // In production:
      // - Validate that clientId and clientSecret are present
      // - Attempt to refresh the access token if expired
      // - Verify API connectivity with a lightweight call

      if (!config.clientId || !config.clientSecret) {
        throw new Error(
          'Fitbit source plugin requires clientId and clientSecret',
        );
      }

      // TODO: Implement OAuth token refresh logic
      // const tokenResponse = await refreshToken(config.refreshToken);
      // config.accessToken = tokenResponse.access_token;

      _initialized = true;
      console.log('[fitbit-source] Initialized successfully (stub mode)');
    },

    async execute(context: PluginContext): Promise<void> {
      if (!_initialized) {
        throw new Error(
          'Fitbit source plugin not initialized. Call init() first.',
        );
      }

      // In production, this would:
      // 1. Determine the date range to sync (last sync -> now)
      // 2. Call Fitbit API endpoints for each data type
      // 3. Transform Fitbit responses into BiomarkerVector
      // 4. Emit snapshots via context.emit()

      // Example of what the production flow looks like:
      //
      // const today = new Date().toISOString().slice(0, 10);
      // const heartData = await fetch(`${_apiBaseUrl}/1/user/-/activities/heart/date/${today}/1d.json`, {
      //   headers: { Authorization: `Bearer ${config.accessToken}` },
      // });
      // const sleepData = await fetch(`${_apiBaseUrl}/1.2/user/-/sleep/date/${today}.json`, { ... });
      // const activityData = await fetch(`${_apiBaseUrl}/1/user/-/activities/date/${today}.json`, { ... });
      //
      // const biomarkers: BiomarkerVector = {
      //   restingHeartRate: heartData.restingHeartRate,
      //   totalSleepMinutes: sleepData.summary.totalMinutesAsleep,
      //   deepSleepMinutes: sleepData.summary.stages.deep,
      //   remSleepMinutes: sleepData.summary.stages.rem,
      //   sleepEfficiency: sleepData.summary.efficiency,
      //   dailySteps: activityData.summary.steps,
      //   activeMinutes: activityData.summary.fairlyActiveMinutes + activityData.summary.veryActiveMinutes,
      //   activeCalories: activityData.summary.activityCalories,
      //   snapshotDate: today,
      //   dataCompleteness: 0.7,
      // };
      //
      // context.emit({
      //   id: `fitbit-${today}-${Date.now()}`,
      //   snapshotDate: today,
      //   biomarkers,
      //   createdAt: new Date(),
      // });

      // Stub: emit a placeholder snapshot to demonstrate the pattern
      const today = new Date().toISOString().slice(0, 10);

      const stubBiomarkers: BiomarkerVector = {
        restingHeartRate: 64,
        heartRateVariability: 42,
        totalSleepMinutes: 435,
        deepSleepMinutes: 72,
        remSleepMinutes: 88,
        sleepEfficiency: 87,
        dailySteps: 9200,
        activeMinutes: 45,
        activeCalories: 380,
        snapshotDate: today,
        dataCompleteness: 0.65,
      };

      const snapshot: BiomarkerSnapshot = {
        id: `fitbit-${today}-${Date.now()}`,
        snapshotDate: today,
        biomarkers: stubBiomarkers,
        createdAt: new Date(),
      };

      context.emit(snapshot);
      console.log(`[fitbit-source] Emitted stub snapshot for ${today}`);
    },
  };
}
