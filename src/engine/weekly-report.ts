// ============================================================
// XSpan AI Agent — Weekly Report Generator
// ============================================================
//
// Generates a structured weekly health summary by comparing the
// last 7 days to the previous 7 days. Supports free and pro
// tier differentiation: free users get basic comparisons, pro
// users get predictive insights and richer recommendations.
// ============================================================

import { BiomarkerSnapshot, BiomarkerVector } from '../types/index';

// ── Exported Types ──────────────────────────────────────────

export type WeeklyTrend = 'improving' | 'stable' | 'declining';

export interface WeeklyMetric {
  field: string;
  thisWeek: number;
  lastWeek: number;
  change: number; // percent change
  trend: WeeklyTrend;
}

export interface WeeklyReport {
  weekEnding: string;
  overallTrend: WeeklyTrend;
  topPositives: string[];
  topConcerns: string[];
  topActions: string[];
  metrics: WeeklyMetric[];
  tier: 'free' | 'pro';
  proLockedInsights: string[];
}

// ── Field config ────────────────────────────────────────────

interface FieldConfig {
  key: keyof BiomarkerVector;
  label: string;
  /** When value goes up, is that 'good' or 'bad'? */
  upIs: 'good' | 'bad' | 'neutral';
  unit?: string;
}

const TRACKED_FIELDS: FieldConfig[] = [
  { key: 'restingHeartRate', label: 'Resting heart rate', upIs: 'bad', unit: 'bpm' },
  { key: 'heartRateVariability', label: 'HRV', upIs: 'good', unit: 'ms' },
  { key: 'bloodPressureSystolic', label: 'Systolic BP', upIs: 'bad', unit: 'mmHg' },
  { key: 'totalSleepMinutes', label: 'Sleep duration', upIs: 'good', unit: 'min' },
  { key: 'deepSleepMinutes', label: 'Deep sleep', upIs: 'good', unit: 'min' },
  { key: 'remSleepMinutes', label: 'REM sleep', upIs: 'good', unit: 'min' },
  { key: 'sleepEfficiency', label: 'Sleep efficiency', upIs: 'good', unit: '%' },
  { key: 'dailySteps', label: 'Daily steps', upIs: 'good' },
  { key: 'activeMinutes', label: 'Active minutes', upIs: 'good', unit: 'min' },
  { key: 'bloodGlucoseFasting', label: 'Fasting glucose', upIs: 'bad', unit: 'mg/dL' },
  { key: 'bodyMassKg', label: 'Body mass', upIs: 'neutral', unit: 'kg' },
  { key: 'avgDailyCalories', label: 'Daily calories', upIs: 'neutral', unit: 'kcal' },
  { key: 'avgProteinGrams', label: 'Protein intake', upIs: 'good', unit: 'g' },
];

// ── Pro-only locked insight previews ────────────────────────

const PRO_LOCKED_PREVIEWS: string[] = [
  'Unlock predictive cardiovascular risk scoring',
  'Unlock glucose trend forecasting with meal correlation',
  'Unlock personalized recovery recommendations based on HRV patterns',
  'Unlock sleep architecture optimization insights',
  'Unlock burnout risk early warning system',
];

// ── Helpers ──────────────────────────────────────────────────

function _round(value: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function _getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function _filterByDateRange(
  snapshots: BiomarkerSnapshot[],
  startDate: string,
  endDate: string,
): BiomarkerSnapshot[] {
  return snapshots.filter(
    (s) => s.snapshotDate >= startDate && s.snapshotDate <= endDate,
  );
}

function _averageField(
  snapshots: BiomarkerSnapshot[],
  field: keyof BiomarkerVector,
): number | null {
  let sum = 0;
  let count = 0;
  for (const s of snapshots) {
    const val = s.biomarkers[field];
    if (typeof val === 'number') {
      sum += val;
      count++;
    }
  }
  return count > 0 ? _round(sum / count) : null;
}

function _percentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return _round(((current - previous) / Math.abs(previous)) * 100);
}

function _classifyTrend(change: number): WeeklyTrend {
  if (Math.abs(change) < 3) return 'stable';
  return change > 0 ? 'improving' : 'declining';
}

/**
 * Check for consecutive-day decline in a field over the this-week window.
 * Returns the number of consecutive declining days, or 0.
 */
function _consecutiveDeclineDays(
  snapshots: BiomarkerSnapshot[],
  field: keyof BiomarkerVector,
): number {
  const sorted = [...snapshots].sort(
    (a, b) => a.snapshotDate.localeCompare(b.snapshotDate),
  );

  let streak = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].biomarkers[field];
    const curr = sorted[i].biomarkers[field];
    if (typeof prev === 'number' && typeof curr === 'number' && curr < prev) {
      streak++;
    } else {
      streak = 0;
    }
  }
  return streak;
}

// ── Core Generator ──────────────────────────────────────────

/**
 * Generate a weekly health summary report.
 *
 * Compares the last 7 days ("this week") to days 8-14 ("last week").
 * Free tier gets basic metric comparisons; pro tier adds predictive
 * insights and richer recommendations.
 *
 * @param snapshots - Full array of BiomarkerSnapshots (at least 14 days recommended)
 * @param tier - User subscription tier
 */
export function generateWeeklyReport(
  snapshots: BiomarkerSnapshot[],
  tier: 'free' | 'pro',
): WeeklyReport {
  const today = _getDateNDaysAgo(0);
  const sevenAgo = _getDateNDaysAgo(7);
  const eightAgo = _getDateNDaysAgo(8);
  const fourteenAgo = _getDateNDaysAgo(14);

  const thisWeekSnaps = _filterByDateRange(snapshots, sevenAgo, today);
  const lastWeekSnaps = _filterByDateRange(snapshots, fourteenAgo, eightAgo);

  // ── Compute metrics ──────────────────────────────────────
  const metrics: WeeklyMetric[] = [];
  const positives: { text: string; magnitude: number }[] = [];
  const concerns: { text: string; magnitude: number }[] = [];

  for (const fieldCfg of TRACKED_FIELDS) {
    const thisWeekAvg = _averageField(thisWeekSnaps, fieldCfg.key);
    const lastWeekAvg = _averageField(lastWeekSnaps, fieldCfg.key);

    if (thisWeekAvg === null || lastWeekAvg === null) continue;

    const change = _percentChange(thisWeekAvg, lastWeekAvg);
    const trend = _classifyFieldTrend(change, fieldCfg.upIs);

    metrics.push({
      field: fieldCfg.key,
      thisWeek: thisWeekAvg,
      lastWeek: lastWeekAvg,
      change,
      trend,
    });

    const absChange = Math.abs(change);
    const unitStr = fieldCfg.unit ? ` (${fieldCfg.unit})` : '';

    // Classify as positive or concern based on direction + upIs
    if (absChange >= 3) {
      const dirLabel = change > 0 ? 'up' : 'down';
      const text = `${fieldCfg.label} ${dirLabel} ${absChange}%${unitStr}`;

      if (
        (change > 0 && fieldCfg.upIs === 'good') ||
        (change < 0 && fieldCfg.upIs === 'bad')
      ) {
        positives.push({ text, magnitude: absChange });
      } else if (
        (change > 0 && fieldCfg.upIs === 'bad') ||
        (change < 0 && fieldCfg.upIs === 'good')
      ) {
        concerns.push({ text, magnitude: absChange });
      }
    }
  }

  // Check for consecutive-day decline patterns (concerns)
  const hrvDecline = _consecutiveDeclineDays(thisWeekSnaps, 'heartRateVariability');
  if (hrvDecline >= 3) {
    concerns.push({
      text: `HRV declining for ${hrvDecline + 1} consecutive days`,
      magnitude: hrvDecline * 5,
    });
  }
  const deepDecline = _consecutiveDeclineDays(thisWeekSnaps, 'deepSleepMinutes');
  if (deepDecline >= 3) {
    concerns.push({
      text: `Deep sleep declining for ${deepDecline + 1} consecutive days`,
      magnitude: deepDecline * 5,
    });
  }

  // Sort and take top 3
  positives.sort((a, b) => b.magnitude - a.magnitude);
  concerns.sort((a, b) => b.magnitude - a.magnitude);

  const topPositives = positives.slice(0, 3).map((p) => p.text);
  const topConcerns = concerns.slice(0, 3).map((c) => c.text);

  // ── Generate action items ────────────────────────────────
  const topActions = _generateActions(concerns, tier);

  // ── Overall trend ────────────────────────────────────────
  const overallTrend = _computeOverallTrend(metrics);

  // ── Pro locked insights ──────────────────────────────────
  const proLockedInsights =
    tier === 'free' ? PRO_LOCKED_PREVIEWS.slice(0, 3) : [];

  return {
    weekEnding: today,
    overallTrend,
    topPositives,
    topConcerns,
    topActions,
    metrics,
    tier,
    proLockedInsights,
  };
}

// ── Internal Helpers ────────────────────────────────────────

function _classifyFieldTrend(
  change: number,
  upIs: 'good' | 'bad' | 'neutral',
): WeeklyTrend {
  if (Math.abs(change) < 3) return 'stable';
  if (upIs === 'neutral') return 'stable';
  if (upIs === 'good') return change > 0 ? 'improving' : 'declining';
  // upIs === 'bad'
  return change > 0 ? 'declining' : 'improving';
}

function _computeOverallTrend(metrics: WeeklyMetric[]): WeeklyTrend {
  let improvingCount = 0;
  let decliningCount = 0;

  for (const m of metrics) {
    if (m.trend === 'improving') improvingCount++;
    if (m.trend === 'declining') decliningCount++;
  }

  if (improvingCount > decliningCount + 2) return 'improving';
  if (decliningCount > improvingCount + 2) return 'declining';
  return 'stable';
}

function _generateActions(
  concerns: { text: string; magnitude: number }[],
  tier: 'free' | 'pro',
): string[] {
  const actions: string[] = [];

  // Map concern keywords to action suggestions
  const actionMap: Record<string, string> = {
    'HRV': 'Prioritize recovery: try lighter workouts and stress-reducing activities',
    'Deep sleep': 'Prioritize 7+ hours of sleep and keep the bedroom cool and dark',
    'Sleep duration': 'Set a consistent bedtime alarm 8 hours before your wake-up time',
    'Sleep efficiency': 'Avoid screens and caffeine in the 2 hours before bed',
    'Resting heart rate': 'Incorporate more aerobic activity and monitor hydration',
    'Fasting glucose': 'Add a 15-minute post-meal walk and increase fiber intake',
    'Systolic BP': 'Reduce sodium intake and increase potassium-rich foods',
    'Daily steps': 'Schedule short walking breaks throughout the day',
    'Active minutes': 'Aim for at least 30 minutes of moderate activity each day',
    'Protein intake': 'Aim for 1.2-1.6g of protein per kg of body mass daily',
  };

  for (const concern of concerns.slice(0, 5)) {
    for (const [keyword, action] of Object.entries(actionMap)) {
      if (concern.text.includes(keyword) && !actions.includes(action)) {
        actions.push(action);
        break;
      }
    }
  }

  // Pro tier: add predictive/richer recommendations
  if (tier === 'pro') {
    if (actions.length < 3) {
      actions.push(
        'Based on your 30-day trend, consider scheduling a wellness check-in with your provider',
      );
    }
    if (actions.length < 3) {
      actions.push(
        'Your recovery pattern suggests a rest day would benefit performance this week',
      );
    }
  }

  return actions.slice(0, 3);
}
