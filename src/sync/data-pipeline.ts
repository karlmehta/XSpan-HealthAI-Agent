import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LocalStore } from '../storage/local-store.js';
import type { AgentConfig, BiomarkerVector, HealthSample, BiomarkerSnapshot } from '../types/index.js';

const execFileAsync = promisify(execFile);

// ── Data Pipeline Orchestrator ──────────────────────────────────

export class DataPipeline {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // ── Apple Health Sync ───────────────────────────────────────────

  async syncAppleHealth(store: LocalStore, hours = 24): Promise<number> {
    if (!this.config.connectors.appleHealth.enabled) {
      console.warn('[Pipeline] Apple Health connector is disabled');
      return 0;
    }

    if (process.platform !== 'darwin') {
      console.warn('[Pipeline] Apple Health is only available on macOS');
      return 0;
    }

    const syncId = randomUUID();
    store.logSync({
      id: syncId,
      syncType: 'apple_health',
      status: 'running',
      recordsSynced: 0,
      startedAt: new Date(),
    });

    try {
      // Attempt to read Apple Health data via the Swift bridge CLI
      // The Swift helper exports HealthKit data as JSON
      const samples = await this.readAppleHealthSamples(hours);
      let count = 0;

      for (const sample of samples) {
        store.insertSample(sample);
        count++;
      }

      store.logSync({
        id: syncId,
        syncType: 'apple_health',
        status: 'success',
        recordsSynced: count,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      console.log(`[Pipeline] Synced ${count} Apple Health records (last ${hours}h)`);
      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Pipeline] Apple Health sync failed:', message);

      store.logSync({
        id: syncId,
        syncType: 'apple_health',
        status: 'error',
        recordsSynced: 0,
        error: message,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      return 0;
    }
  }

  /**
   * Read samples from Apple Health via the bundled Swift CLI bridge.
   * The bridge binary is expected at ~/.xspan/bin/xspan-healthkit-bridge
   * and outputs JSON to stdout.
   *
   * If the bridge is not installed, returns an empty array and logs a warning.
   */
  private async readAppleHealthSamples(hours: number): Promise<HealthSample[]> {
    const bridgePath = `${process.env.HOME}/.xspan/bin/xspan-healthkit-bridge`;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    try {
      const { stdout } = await execFileAsync(bridgePath, ['export', '--since', since, '--format', 'json']);
      const raw = JSON.parse(stdout) as Array<{
        id: string;
        type: string;
        value: number;
        unit: string;
        startDate: string;
        metadata?: Record<string, unknown>;
      }>;

      return raw.map(r => ({
        id: r.id,
        source: 'apple_health' as const,
        dataType: r.type,
        value: r.value,
        unit: r.unit,
        metadata: r.metadata,
        recordedAt: new Date(r.startDate),
        syncedAt: new Date(),
      }));
    } catch {
      console.warn(
        '[Pipeline] HealthKit bridge not found. Install it with: xspan install-healthkit-bridge\n' +
        '           Apple Health sync will return no data until the bridge is installed.'
      );
      return [];
    }
  }

  // ── EHR Sync ────────────────────────────────────────────────────

  async syncEhr(store: LocalStore): Promise<number> {
    if (!this.config.connectors.ehr.enabled) {
      console.warn('[Pipeline] EHR connector is disabled');
      return 0;
    }

    const syncId = randomUUID();
    store.logSync({
      id: syncId,
      syncType: 'ehr',
      status: 'running',
      recordsSynced: 0,
      startedAt: new Date(),
    });

    try {
      // Dynamically import FHIR client to avoid loading when EHR is disabled
      const { FhirClient } = await import('../connectors/ehr/fhir-client.js');
      const fhir = new FhirClient(this.config);

      const observations = await fhir.getObservations();
      let count = 0;

      for (const sample of observations) {
        store.insertSample(sample);
        count++;
      }

      store.logSync({
        id: syncId,
        syncType: 'ehr',
        status: 'success',
        recordsSynced: count,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      console.log(`[Pipeline] Synced ${count} EHR records`);
      return count;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Pipeline] EHR sync failed:', message);

      store.logSync({
        id: syncId,
        syncType: 'ehr',
        status: 'error',
        recordsSynced: 0,
        error: message,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      return 0;
    }
  }

  // ── Sync All Sources ────────────────────────────────────────────

  async syncAll(store: LocalStore): Promise<number> {
    console.log('[Pipeline] Starting full sync...');

    const results = await Promise.allSettled([
      this.syncAppleHealth(store),
      this.syncEhr(store),
    ]);

    let total = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        total += result.value;
      }
    }

    console.log(`[Pipeline] Full sync complete: ${total} total records`);
    return total;
  }

  // ── Biomarker Synthesis ─────────────────────────────────────────

  async synthesizeBiomarkers(store: LocalStore): Promise<BiomarkerVector> {
    const today = new Date().toISOString().split('T')[0]!;

    // Read latest samples for each data type
    const rhr = store.getLatestSample('restingHeartRate');
    const hrv = store.getLatestSample('heartRateVariabilitySDNN');
    const bpSys = store.getLatestSample('bloodPressureSystolic');
    const bpDia = store.getLatestSample('bloodPressureDiastolic');
    const vo2 = store.getLatestSample('vo2Max');
    const glucose = store.getLatestSample('bloodGlucose');
    const bmi = store.getLatestSample('bmi');
    const bodyFat = store.getLatestSample('bodyFatPercentage');
    const bodyMass = store.getLatestSample('bodyMass');
    const steps = store.getLatestSample('stepCount');
    const activeCal = store.getLatestSample('activeEnergyBurned');
    const mindful = store.getLatestSample('mindfulSession');

    // Sleep data from the last 24h
    const sleepFrom = new Date();
    sleepFrom.setHours(sleepFrom.getHours() - 24);
    const sleepSamples = store.getSamples({
      dataType: 'sleepAnalysis',
      from: sleepFrom,
      to: new Date(),
    });
    const totalSleepMinutes = sleepSamples.reduce((sum, s) => sum + s.value, 0);

    // Nutrition averages (last 7 days)
    const nutritionFrom = new Date();
    nutritionFrom.setDate(nutritionFrom.getDate() - 7);
    const nutritionEntries = store.getNutritionEntries(nutritionFrom, new Date());
    const nutAvg = computeNutritionAverages(nutritionEntries);

    // Lab values from EHR (latest samples)
    const hba1c = store.getLatestSample('hba1c');
    const ldl = store.getLatestSample('ldlCholesterol');
    const hdl = store.getLatestSample('hdlCholesterol');
    const triglycerides = store.getLatestSample('triglycerides');
    const vitD = store.getLatestSample('vitaminD');
    const creatinine = store.getLatestSample('creatinine');
    const crp = store.getLatestSample('crp');

    // Compute derived scores
    const sleepQuality = computeSleepQuality(totalSleepMinutes, sleepSamples);
    const stressIndex = computeStressIndex(rhr?.value, hrv?.value);
    const recoveryScore = computeRecoveryScore(hrv?.value, rhr?.value, totalSleepMinutes);

    // Count available fields for data completeness
    const allFields = [
      rhr, hrv, bpSys, bpDia, vo2, glucose, bmi, bodyFat, bodyMass,
      steps, activeCal, mindful, hba1c, ldl, hdl, triglycerides, vitD, creatinine, crp,
    ];
    const totalPossible = allFields.length + 3; // +3 for sleep, nutrition, scores
    const available = allFields.filter(f => f !== null).length
      + (totalSleepMinutes > 0 ? 1 : 0)
      + (nutritionEntries.length > 0 ? 1 : 0)
      + 1; // derived scores always computed
    const dataCompleteness = Math.round((available / totalPossible) * 100) / 100;

    const vector: BiomarkerVector = {
      // Cardiovascular
      restingHeartRate: rhr?.value,
      heartRateVariability: hrv?.value,
      bloodPressureSystolic: bpSys?.value,
      bloodPressureDiastolic: bpDia?.value,
      vo2Max: vo2?.value,

      // Metabolic
      bloodGlucoseFasting: glucose?.value,
      bodyMassIndex: bmi?.value,
      bodyFatPercentage: bodyFat?.value,
      bodyMassKg: bodyMass?.value,

      // Sleep
      totalSleepMinutes: totalSleepMinutes || undefined,
      sleepEfficiency: sleepQuality,

      // Activity
      dailySteps: steps?.value,
      activeCalories: activeCal?.value,

      // Nutrition
      avgDailyCalories: nutAvg.calories || undefined,
      avgProteinGrams: nutAvg.protein || undefined,
      avgCarbGrams: nutAvg.carbs || undefined,
      avgFatGrams: nutAvg.fat || undefined,
      avgFiberGrams: nutAvg.fiber || undefined,

      // Labs
      hba1c: hba1c?.value,
      ldlCholesterol: ldl?.value,
      hdlCholesterol: hdl?.value,
      triglycerides: triglycerides?.value,
      vitaminD: vitD?.value,
      creatinine: creatinine?.value,
      crp: crp?.value,

      // Stress & Recovery
      stressIndex,
      recoveryScore,
      mindfulnessMinutes: mindful?.value,

      // Metadata
      snapshotDate: today,
      dataCompleteness,
    };

    // Persist snapshot
    const snapshot: BiomarkerSnapshot = {
      id: randomUUID(),
      snapshotDate: today,
      biomarkers: vector,
      digitalTwinVersion: '1.0.0',
      createdAt: new Date(),
    };
    store.insertSnapshot(snapshot);

    console.log(`[Pipeline] Synthesized biomarker vector (completeness: ${(dataCompleteness * 100).toFixed(0)}%)`);
    return vector;
  }
}

// ── Helper Functions ──────────────────────────────────────────────

function computeNutritionAverages(entries: { nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number } }[]) {
  if (entries.length === 0) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  }

  // Group entries by day, then average daily totals
  const dailyMap = new Map<string, { calories: number; protein: number; carbs: number; fat: number; fiber: number }>();

  for (const e of entries) {
    // Use a simple index-based day key since we just need grouping
    const dayKey = entries.indexOf(e).toString();
    const existing = dailyMap.get(dayKey) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    existing.calories += e.nutrients.calories;
    existing.protein += e.nutrients.protein;
    existing.carbs += e.nutrients.carbs;
    existing.fat += e.nutrients.fat;
    existing.fiber += e.nutrients.fiber;
    dailyMap.set(dayKey, existing);
  }

  const totalCalories = entries.reduce((s, e) => s + e.nutrients.calories, 0);
  const totalProtein = entries.reduce((s, e) => s + e.nutrients.protein, 0);
  const totalCarbs = entries.reduce((s, e) => s + e.nutrients.carbs, 0);
  const totalFat = entries.reduce((s, e) => s + e.nutrients.fat, 0);
  const totalFiber = entries.reduce((s, e) => s + e.nutrients.fiber, 0);

  const days = Math.max(1, 7); // 7-day window

  return {
    calories: Math.round(totalCalories / days),
    protein: Math.round(totalProtein / days),
    carbs: Math.round(totalCarbs / days),
    fat: Math.round(totalFat / days),
    fiber: Math.round(totalFiber / days),
  };
}

/**
 * Compute sleep quality score (0-100) from total minutes and sample data.
 * Uses a simple model: 7-9 hours = optimal, with diminishing scores outside.
 */
function computeSleepQuality(totalMinutes: number, _samples: HealthSample[]): number | undefined {
  if (totalMinutes === 0) return undefined;

  const hours = totalMinutes / 60;

  // Optimal: 7-9 hours => score 85-100
  if (hours >= 7 && hours <= 9) {
    return Math.round(85 + ((hours - 7) / 2) * 15);
  }
  // 6-7 hours => 65-85
  if (hours >= 6 && hours < 7) {
    return Math.round(65 + (hours - 6) * 20);
  }
  // 5-6 hours => 40-65
  if (hours >= 5 && hours < 6) {
    return Math.round(40 + (hours - 5) * 25);
  }
  // >9 hours => mild penalty
  if (hours > 9 && hours <= 10) {
    return Math.round(85 - (hours - 9) * 10);
  }
  // <5 or >10 => low
  return Math.round(Math.max(10, 40 - Math.abs(hours - 7.5) * 8));
}

/**
 * Compute stress index (0-100, higher = more stressed).
 * Uses resting heart rate and HRV as primary inputs.
 * Low HRV + high RHR = high stress.
 */
function computeStressIndex(rhr?: number, hrv?: number): number | undefined {
  if (rhr === undefined && hrv === undefined) return undefined;

  let score = 50; // baseline

  if (hrv !== undefined) {
    // HRV < 20ms = very stressed, > 60ms = very relaxed
    if (hrv < 20) score += 30;
    else if (hrv < 35) score += 15;
    else if (hrv < 50) score += 0;
    else if (hrv < 70) score -= 15;
    else score -= 25;
  }

  if (rhr !== undefined) {
    // RHR > 80 = stressed, < 55 = relaxed
    if (rhr > 90) score += 20;
    else if (rhr > 80) score += 10;
    else if (rhr > 70) score += 0;
    else if (rhr > 60) score -= 10;
    else score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Compute recovery score (0-100, higher = better recovered).
 * Uses HRV, RHR, and sleep duration.
 */
function computeRecoveryScore(hrv?: number, rhr?: number, sleepMinutes?: number): number | undefined {
  if (hrv === undefined && rhr === undefined && (!sleepMinutes || sleepMinutes === 0)) {
    return undefined;
  }

  let score = 50;

  if (hrv !== undefined) {
    if (hrv > 70) score += 25;
    else if (hrv > 50) score += 15;
    else if (hrv > 35) score += 5;
    else if (hrv > 20) score -= 10;
    else score -= 20;
  }

  if (rhr !== undefined) {
    if (rhr < 55) score += 15;
    else if (rhr < 65) score += 5;
    else if (rhr < 75) score -= 5;
    else score -= 15;
  }

  if (sleepMinutes && sleepMinutes > 0) {
    const hours = sleepMinutes / 60;
    if (hours >= 7 && hours <= 9) score += 10;
    else if (hours >= 6) score += 0;
    else score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
