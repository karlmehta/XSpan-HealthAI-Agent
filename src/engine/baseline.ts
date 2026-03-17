// ============================================================
// XSpan AI Agent — Baseline Computation & Drift Detection
// ============================================================
//
// Computes personal rolling baselines from historical biomarker
// snapshots and detects meaningful drift from those baselines.
// All outputs are non-medical observations — no diagnoses.
// ============================================================

import { BiomarkerVector, BiomarkerSnapshot } from '../types/index';

// ── Exported Types ──────────────────────────────────────────

export type DriftDirection = 'up' | 'down';

export type DriftSeverity = 'normal' | 'notable' | 'significant';

export interface DriftResult {
  field: string;
  currentValue: number;
  baselineValue: number;
  changePercent: number;
  direction: DriftDirection;
  severity: DriftSeverity;
}

/**
 * A baseline vector is a partial BiomarkerVector containing
 * only the numeric averages computed over the rolling window.
 */
export type BaselineVector = Partial<
  Pick<
    BiomarkerVector,
    | 'restingHeartRate'
    | 'heartRateVariability'
    | 'bloodPressureSystolic'
    | 'bloodPressureDiastolic'
    | 'bloodGlucoseFasting'
    | 'bodyMassIndex'
    | 'bodyMassKg'
    | 'totalSleepMinutes'
    | 'deepSleepMinutes'
    | 'remSleepMinutes'
    | 'sleepEfficiency'
    | 'dailySteps'
    | 'activeMinutes'
    | 'avgDailyCalories'
    | 'avgProteinGrams'
    | 'hba1c'
    | 'ldlCholesterol'
    | 'cardiovascularRisk'
    | 'metabolicRisk'
    | 'sleepDisorderRisk'
    | 'burnoutRisk'
  >
>;

// ── Fields we track for drift detection ─────────────────────

const TRACKED_FIELDS: (keyof BiomarkerVector)[] = [
  'restingHeartRate',
  'heartRateVariability',
  'bloodPressureSystolic',
  'totalSleepMinutes',
  'deepSleepMinutes',
  'sleepEfficiency',
  'dailySteps',
  'bodyMassKg',
  'bloodGlucoseFasting',
];

/** Human-readable labels for drift insight formatting. */
const FIELD_LABELS: Record<string, string> = {
  restingHeartRate: 'Resting heart rate',
  heartRateVariability: 'HRV',
  bloodPressureSystolic: 'Systolic blood pressure',
  bloodPressureDiastolic: 'Diastolic blood pressure',
  totalSleepMinutes: 'Total sleep',
  deepSleepMinutes: 'Deep sleep',
  sleepEfficiency: 'Sleep efficiency',
  dailySteps: 'Daily steps',
  bodyMassKg: 'Body mass',
  bloodGlucoseFasting: 'Fasting glucose',
  avgDailyCalories: 'Daily calories',
  avgProteinGrams: 'Protein intake',
  hba1c: 'HbA1c',
  ldlCholesterol: 'LDL cholesterol',
  remSleepMinutes: 'REM sleep',
  activeMinutes: 'Active minutes',
  cardiovascularRisk: 'Cardiovascular risk score',
  metabolicRisk: 'Metabolic risk score',
  sleepDisorderRisk: 'Sleep disorder risk score',
  burnoutRisk: 'Burnout risk score',
};

// ── Severity Thresholds ─────────────────────────────────────

const NOTABLE_THRESHOLD = 5; // percent
const SIGNIFICANT_THRESHOLD = 15; // percent

function _classifySeverity(changePercent: number): DriftSeverity {
  const abs = Math.abs(changePercent);
  if (abs >= SIGNIFICANT_THRESHOLD) return 'significant';
  if (abs >= NOTABLE_THRESHOLD) return 'notable';
  return 'normal';
}

// ── Helpers ──────────────────────────────────────────────────

function _round(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function _filterSnapshotsByWindow(
  snapshots: BiomarkerSnapshot[],
  windowDays: number,
): BiomarkerSnapshot[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return snapshots.filter((s) => s.snapshotDate >= cutoffStr);
}

// ── Core Functions ──────────────────────────────────────────

/**
 * Compute a rolling average baseline from the given snapshots
 * over the specified window of days.
 *
 * @param snapshots - Array of BiomarkerSnapshot objects (need not be sorted)
 * @param windowDays - Number of trailing days to include (e.g. 30)
 * @returns A BaselineVector with averaged values for each tracked field
 */
export function computeBaseline(
  snapshots: BiomarkerSnapshot[],
  windowDays: number,
): BaselineVector {
  const filtered = _filterSnapshotsByWindow(snapshots, windowDays);

  if (filtered.length === 0) {
    return {};
  }

  // Accumulate sums and counts for every numeric biomarker key
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const snapshot of filtered) {
    const bio = snapshot.biomarkers;
    for (const key of Object.keys(bio) as (keyof BiomarkerVector)[]) {
      const value = bio[key];
      if (typeof value === 'number') {
        sums[key] = (sums[key] ?? 0) + value;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  const baseline: Record<string, number> = {};
  for (const key of Object.keys(sums)) {
    baseline[key] = _round(sums[key] / counts[key]);
  }

  return baseline as unknown as BaselineVector;
}

/**
 * Detect drift between a current biomarker reading and a
 * computed baseline. Returns a DriftResult for each tracked
 * field where both current and baseline values exist.
 *
 * @param current - The most recent BiomarkerVector
 * @param baseline - A BaselineVector computed via computeBaseline()
 * @returns Array of DriftResult objects
 */
export function detectDrift(
  current: BiomarkerVector,
  baseline: BaselineVector,
): DriftResult[] {
  const results: DriftResult[] = [];

  for (const field of TRACKED_FIELDS) {
    const currentVal = current[field];
    const baselineVal = (baseline as Record<string, number | undefined>)[field];

    if (
      typeof currentVal !== 'number' ||
      typeof baselineVal !== 'number' ||
      baselineVal === 0
    ) {
      continue;
    }

    const changePercent = _round(
      ((currentVal - baselineVal) / Math.abs(baselineVal)) * 100,
      1,
    );
    const direction: DriftDirection = changePercent >= 0 ? 'up' : 'down';
    const severity = _classifySeverity(changePercent);

    results.push({
      field,
      currentValue: currentVal,
      baselineValue: baselineVal,
      changePercent,
      direction,
      severity,
    });
  }

  return results;
}

/**
 * Return the top N drifts sorted by severity (significant first),
 * then by absolute changePercent descending.
 *
 * @param drifts - Array of DriftResult objects from detectDrift()
 * @param limit - Maximum number of results to return
 */
export function getTopDrifts(
  drifts: DriftResult[],
  limit: number,
): DriftResult[] {
  const severityOrder: Record<DriftSeverity, number> = {
    significant: 0,
    notable: 1,
    normal: 2,
  };

  return [...drifts]
    .sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return Math.abs(b.changePercent) - Math.abs(a.changePercent);
    })
    .slice(0, limit);
}

/**
 * Format a single DriftResult into a human-readable insight string.
 * Avoids medical language — purely observational.
 *
 * @example "HRV is down 14% from your 30-day average"
 */
export function formatDriftInsight(
  drift: DriftResult,
  windowLabel: string = '30-day',
): string {
  const label = FIELD_LABELS[drift.field] ?? drift.field;
  const directionWord = drift.direction === 'up' ? 'up' : 'down';
  const absChange = Math.abs(drift.changePercent);

  return `${label} is ${directionWord} ${absChange}% from your ${windowLabel} average`;
}
