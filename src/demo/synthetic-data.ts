// ============================================================
// XSpan AI Agent — Synthetic Data Generator for Demo Mode
// ============================================================
//
// Generates 30 days of realistic health biomarker data with
// natural variation and deliberate drift patterns for
// demonstration purposes. All generated data is marked with
// a `demo` flag so it can be distinguished from real user data.
// ============================================================

import {
  BiomarkerVector,
  BiomarkerSnapshot,
  XSpanNudge,
  NudgeCategory,
} from '../types/index';

// ── Helpers ──────────────────────────────────────────────────

/** Simple seeded PRNG (mulberry32) for reproducible demo data. */
function _seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Return a value that drifts linearly between `start` and `end` over `totalDays`, with jitter. */
function _driftValue(
  dayIndex: number,
  totalDays: number,
  start: number,
  end: number,
  jitter: number,
  rng: () => number,
): number {
  const progress = dayIndex / (totalDays - 1);
  const base = start + (end - start) * progress;
  return base + (rng() - 0.5) * 2 * jitter;
}

/** Return a value with day-to-day random walk behaviour within [min, max]. */
function _walkValue(
  prev: number,
  min: number,
  max: number,
  maxStep: number,
  rng: () => number,
): number {
  const step = (rng() - 0.5) * 2 * maxStep;
  let next = prev + step;
  if (next < min) next = min + rng() * maxStep;
  if (next > max) next = max - rng() * maxStep;
  return next;
}

/** Round to N decimal places. */
function _round(value: number, decimals: number = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Generate an ISO date string N days ago from today. */
function _daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Generate a simple UUID-v4-like string. */
function _uuid(rng: () => number): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += hex[Math.floor(rng() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) id += '-';
  }
  return id;
}

// ── Extended snapshot with demo flag ────────────────────────

/** BiomarkerSnapshot extended with a demo flag. */
export interface DemoBiomarkerSnapshot extends BiomarkerSnapshot {
  demo: true;
}

/** XSpanNudge extended with a demo flag. */
export interface DemoXSpanNudge extends XSpanNudge {
  demo: true;
}

// ── Core Generator ──────────────────────────────────────────

export interface SyntheticDataOptions {
  /** Number of days of data to generate. Default 30. */
  days?: number;
  /** PRNG seed for reproducibility. Default 42. */
  seed?: number;
}

/**
 * Generate an array of `DemoBiomarkerSnapshot` objects representing
 * `days` consecutive days of synthetic health data ending today.
 *
 * Drift patterns baked in:
 *  - HRV declines over the last 7 days
 *  - Sleep efficiency and deep sleep worsen over the last 7 days
 */
export function generateSyntheticSnapshots(
  options: SyntheticDataOptions = {},
): DemoBiomarkerSnapshot[] {
  const { days = 30, seed = 42 } = options;
  const rng = _seededRandom(seed);

  const snapshots: DemoBiomarkerSnapshot[] = [];

  // Track previous values for random-walk continuity
  let prevHR = 65;
  let prevHRV = 48;
  let prevSystolic = 122;
  let prevDiastolic = 77;
  let prevGlucose = 95;
  let prevBMI = 25.0;
  let prevSleep = 420;
  let prevDeep = 68;
  let prevREM = 80;
  let prevEfficiency = 85;
  let prevSteps = 8500;
  let prevActive = 40;
  let prevCalories = 2100;
  let prevProtein = 95;
  let prevHbA1c = 5.4;
  let prevLDL = 125;
  let prevCardioRisk = 30;
  let prevMetaRisk = 25;
  let prevSleepRisk = 20;
  let prevBurnoutRisk = 28;

  for (let i = 0; i < days; i++) {
    const dateStr = _daysAgo(days - 1 - i);
    const daysFromEnd = days - 1 - i; // 0 = most recent day

    // ── Drift patterns for last 7 days ───────────────────
    const inDriftWindow = daysFromEnd < 7;
    const driftDay = inDriftWindow ? 7 - daysFromEnd : 0; // 1..7

    // HRV declining in last 7 days
    let hrvAdjust = 0;
    if (inDriftWindow) {
      hrvAdjust = -(driftDay * 1.8); // drops ~12.6ms over 7 days
    }

    // Sleep worsening in last 7 days
    let sleepEffAdjust = 0;
    let deepSleepAdjust = 0;
    if (inDriftWindow) {
      sleepEffAdjust = -(driftDay * 1.5); // drops ~10.5% over 7 days
      deepSleepAdjust = -(driftDay * 3); // drops ~21 min over 7 days
    }

    // ── Cardiovascular ───────────────────────────────────
    prevHR = _round(_walkValue(prevHR, 58, 72, 2, rng));
    prevHRV = _round(
      _walkValue(prevHRV + hrvAdjust * 0.15, 35, 55, 2.5, rng),
    );
    // Ensure HRV stays in drift-adjusted range during drift window
    if (inDriftWindow && prevHRV > 50 - driftDay * 1.2) {
      prevHRV = _round(50 - driftDay * 1.2 + (rng() - 0.5) * 2);
    }
    prevSystolic = _round(_walkValue(prevSystolic, 115, 130, 3, rng), 0);
    prevDiastolic = _round(_walkValue(prevDiastolic, 70, 85, 2, rng), 0);

    // ── Metabolic ────────────────────────────────────────
    prevGlucose = _round(_walkValue(prevGlucose, 85, 105, 3, rng), 0);
    prevBMI = _round(_walkValue(prevBMI, 24, 26, 0.1, rng), 1);

    // ── Sleep ────────────────────────────────────────────
    prevSleep = _round(
      _walkValue(prevSleep, 360, 480, 15, rng) + (inDriftWindow ? -driftDay * 3 : 0),
      0,
    );
    prevSleep = Math.max(330, Math.min(500, prevSleep));

    prevDeep = _round(
      _walkValue(prevDeep + deepSleepAdjust * 0.15, 45, 90, 5, rng),
      0,
    );
    if (inDriftWindow && prevDeep > 70 - driftDay * 2) {
      prevDeep = Math.max(30, _round(70 - driftDay * 2 + (rng() - 0.5) * 4, 0));
    }

    prevREM = _round(_walkValue(prevREM, 60, 100, 5, rng), 0);

    prevEfficiency = _round(
      _walkValue(prevEfficiency + sleepEffAdjust * 0.15, 75, 92, 2, rng),
      1,
    );
    if (inDriftWindow && prevEfficiency > 88 - driftDay * 1.2) {
      prevEfficiency = _round(88 - driftDay * 1.2 + (rng() - 0.5) * 2, 1);
    }
    prevEfficiency = Math.max(65, Math.min(95, prevEfficiency));

    // ── Activity ─────────────────────────────────────────
    prevSteps = _round(_walkValue(prevSteps, 5000, 12000, 1200, rng), 0);
    prevActive = _round(_walkValue(prevActive, 20, 60, 8, rng), 0);

    // ── Nutrition (7-day averages, so more stable) ───────
    prevCalories = _round(_walkValue(prevCalories, 1800, 2400, 80, rng), 0);
    prevProtein = _round(_walkValue(prevProtein, 70, 120, 8, rng), 0);
    const carbs = _round(prevCalories * 0.45 / 4 + (rng() - 0.5) * 20, 0);
    const fat = _round(prevCalories * 0.3 / 9 + (rng() - 0.5) * 10, 0);
    const fiber = _round(20 + rng() * 15, 0);
    const water = _round(1800 + rng() * 1200, 0);

    // ── Labs (updated less frequently — hold mostly steady) ─
    if (i % 7 === 0) {
      prevHbA1c = _round(_walkValue(prevHbA1c, 5.2, 5.6, 0.05, rng), 2);
      prevLDL = _round(_walkValue(prevLDL, 110, 140, 3, rng), 0);
    }

    // ── Risk Scores ──────────────────────────────────────
    prevCardioRisk = _round(_walkValue(prevCardioRisk, 15, 45, 3, rng), 0);
    prevMetaRisk = _round(_walkValue(prevMetaRisk, 15, 40, 2, rng), 0);
    prevSleepRisk = _round(
      _walkValue(prevSleepRisk, 15, 45, 2, rng) + (inDriftWindow ? driftDay * 1.5 : 0),
      0,
    );
    prevSleepRisk = Math.max(10, Math.min(60, prevSleepRisk));
    prevBurnoutRisk = _round(_walkValue(prevBurnoutRisk, 15, 45, 2, rng), 0);

    const biomarkers: BiomarkerVector = {
      // Cardiovascular
      restingHeartRate: prevHR,
      heartRateVariability: prevHRV,
      bloodPressureSystolic: prevSystolic,
      bloodPressureDiastolic: prevDiastolic,

      // Metabolic
      bloodGlucoseFasting: prevGlucose,
      bodyMassIndex: prevBMI,
      bodyMassKg: _round(prevBMI * (1.75 * 1.75), 1), // assume 1.75m height

      // Sleep
      totalSleepMinutes: prevSleep,
      deepSleepMinutes: prevDeep,
      remSleepMinutes: prevREM,
      sleepEfficiency: prevEfficiency,

      // Activity
      dailySteps: prevSteps,
      activeMinutes: prevActive,

      // Nutrition (7-day averages)
      avgDailyCalories: prevCalories,
      avgProteinGrams: prevProtein,
      avgCarbGrams: carbs,
      avgFatGrams: fat,
      avgFiberGrams: fiber,
      avgWaterMl: water,

      // Labs
      hba1c: prevHbA1c,
      ldlCholesterol: prevLDL,

      // Risk scores
      cardiovascularRisk: prevCardioRisk,
      metabolicRisk: prevMetaRisk,
      sleepDisorderRisk: prevSleepRisk,
      burnoutRisk: prevBurnoutRisk,

      // Metadata
      snapshotDate: dateStr,
      dataCompleteness: _round(0.85 + rng() * 0.14, 2),
    };

    snapshots.push({
      id: `demo-${_uuid(rng)}`,
      snapshotDate: dateStr,
      biomarkers,
      digitalTwinVersion: 'demo-v1',
      createdAt: new Date(dateStr),
      demo: true,
    });
  }

  return snapshots;
}

/**
 * Generate a set of sample nudges for demo mode.
 * Returns 5 nudges covering various categories.
 */
export function generateSampleNudges(): DemoXSpanNudge[] {
  const now = new Date().toISOString();

  const nudges: DemoXSpanNudge[] = [
    {
      id: 'demo-nudge-001',
      content:
        'Your HRV has dropped 14% over the past week. Consider lighter workouts and earlier bedtimes to support recovery.',
      category: 'stress_management' as NudgeCategory,
      priority: 1,
      deepDive:
        'Heart rate variability is a key indicator of autonomic nervous system balance. A sustained decline may reflect accumulated stress or insufficient recovery. Prioritizing sleep quality and reducing high-intensity training volume for a few days can help restore HRV.',
      actionItems: [
        'Aim for 7.5+ hours of sleep tonight',
        'Replace one intense workout with a walk or yoga session',
        'Try 10 minutes of box breathing before bed',
      ],
      relatedBiomarkers: ['heartRateVariability', 'restingHeartRate', 'sleepEfficiency'],
      receivedAt: now,
      demo: true,
    },
    {
      id: 'demo-nudge-002',
      content:
        'Your deep sleep has declined for 5 straight nights. Deep sleep is critical for physical recovery and memory consolidation.',
      category: 'sleep_optimization' as NudgeCategory,
      priority: 1,
      deepDive:
        'Deep (N3) sleep is when your body repairs tissue, strengthens the immune system, and consolidates memories. Consistent decline can compound fatigue and reduce cognitive performance.',
      actionItems: [
        'Keep the bedroom at 65-68 degrees F',
        'Avoid screens 60 minutes before bed',
        'Avoid caffeine after 2 PM',
      ],
      relatedBiomarkers: ['deepSleepMinutes', 'totalSleepMinutes', 'sleepEfficiency'],
      receivedAt: now,
      demo: true,
    },
    {
      id: 'demo-nudge-003',
      content:
        'Great job! You hit 10,000+ steps on 4 of the last 7 days. Keep the momentum going.',
      category: 'positive_reinforcement' as NudgeCategory,
      priority: 3,
      actionItems: ['Try to make it 5 out of 7 this week'],
      relatedBiomarkers: ['dailySteps', 'activeMinutes'],
      receivedAt: now,
      demo: true,
    },
    {
      id: 'demo-nudge-004',
      content:
        'Your fasting glucose averaged 101 mg/dL this week, slightly above optimal. Small dietary tweaks can help.',
      category: 'nutrition_guidance' as NudgeCategory,
      priority: 2,
      deepDive:
        'Fasting glucose between 100-125 mg/dL may indicate pre-diabetic ranges. Increasing fiber intake, reducing refined carbohydrates, and adding post-meal walks can improve insulin sensitivity.',
      actionItems: [
        'Add a 15-minute walk after dinner',
        'Swap refined grains for whole grains',
        'Increase daily fiber to 25g+',
      ],
      relatedBiomarkers: ['bloodGlucoseFasting', 'hba1c', 'bodyMassIndex'],
      receivedAt: now,
      demo: true,
    },
    {
      id: 'demo-nudge-005',
      content:
        'You have been averaging only 1,900 mL of water daily. Aim for 2,500 mL to support energy and recovery.',
      category: 'hydration' as NudgeCategory,
      priority: 2,
      actionItems: [
        'Start each morning with a full glass of water',
        'Keep a water bottle at your desk',
        'Set 3 hydration reminders throughout the day',
      ],
      relatedBiomarkers: ['avgWaterMl'],
      receivedAt: now,
      demo: true,
    },
  ];

  return nudges;
}

/**
 * Convenience function: generates both snapshots and nudges for demo mode.
 */
export function generateDemoData(options: SyntheticDataOptions = {}): {
  snapshots: DemoBiomarkerSnapshot[];
  nudges: DemoXSpanNudge[];
} {
  return {
    snapshots: generateSyntheticSnapshots(options),
    nudges: generateSampleNudges(),
  };
}
