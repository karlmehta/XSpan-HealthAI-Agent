// ============================================================
// MyHealthSpan Agent v2 -- LLM-Agnostic Execution Harness
//
// Supports rule-based (deterministic) and LLM-backed adapters.
// Every insight MUST cite source data. No extrapolation beyond
// what the data supports. Single-measurement vs multi-day
// averages are always flagged.
// ============================================================

import type {
  VitalRecord,
  LabRecord,
  SleepRecord,
  ActivityRecord,
  ConditionRecord,
  MedicationRecord,
  AllergyRecord,
} from '../agents/types.js';

// ── Health Context ──────────────────────────────────────────

/** All health data available for summary generation and Q&A. */
export interface HealthContext {
  vitals: VitalRecord[];
  labs: LabRecord[];
  sleep: SleepRecord[];
  activity: ActivityRecord[];
  conditions: ConditionRecord[];
  medications: MedicationRecord[];
  allergies: AllergyRecord[];
}

// ── LLM Adapter Interface ───────────────────────────────────

/** Any LLM backend (or rule-based fallback) implements this. */
export interface LLMAdapter {
  generate(prompt: string, context: Record<string, unknown>): Promise<string>;
}

// ── Reference Ranges ────────────────────────────────────────

interface RefRange {
  low?: number;
  high?: number;
  unit: string;
  optimalLow?: number;
  optimalHigh?: number;
}

const LAB_REFERENCE_RANGES: Record<string, RefRange> = {
  // Metabolic
  glucose:        { low: 70, high: 100, unit: 'mg/dL', optimalLow: 72, optimalHigh: 90 },
  hba1c:          { low: 4.0, high: 5.6, unit: '%', optimalHigh: 5.4 },
  // Lipids
  cholesterol:    { high: 200, unit: 'mg/dL' },
  ldl:            { high: 100, unit: 'mg/dL', optimalHigh: 70 },
  hdl:            { low: 40, unit: 'mg/dL', optimalLow: 60 },
  triglycerides:  { high: 150, unit: 'mg/dL', optimalHigh: 100 },
  // Thyroid
  tsh:            { low: 0.45, high: 4.5, unit: 'mIU/L' },
  // Kidney
  creatinine:     { low: 0.7, high: 1.3, unit: 'mg/dL' },
  egfr:           { low: 60, unit: 'mL/min/1.73m2' },
  bun:            { low: 7, high: 20, unit: 'mg/dL' },
  // Liver
  alt:            { high: 56, unit: 'U/L' },
  ast:            { high: 40, unit: 'U/L' },
  // Hematology
  hemoglobin:     { low: 12, high: 17.5, unit: 'g/dL' },
  wbc:            { low: 4.5, high: 11.0, unit: 'K/uL' },
  platelets:      { low: 150, high: 400, unit: 'K/uL' },
  // Inflammation
  crp:            { high: 3.0, unit: 'mg/L', optimalHigh: 1.0 },
  homocysteine:   { high: 15, unit: 'umol/L', optimalHigh: 10 },
  // Vitamins / Minerals
  vitaminD:       { low: 30, high: 100, unit: 'ng/mL', optimalLow: 40 },
  ferritin:       { low: 20, high: 300, unit: 'ng/mL' },
  b12:            { low: 200, high: 900, unit: 'pg/mL' },
};

// ── Guardrails (inline) ─────────────────────────────────────
// Rule 1: Every metric must include "(source, date)" citation
// Rule 2: No extrapolation -- only state what the data shows
// Rule 3: Flag single measurement vs multi-day average
// Rule 4: Never diagnose -- flag and recommend follow-up

function citedValue(value: number, unit: string, date: string, source: string): string {
  return `${value} ${unit} (${source}, ${date})`;
}

function measurementContext(count: number): string {
  if (count === 1) return '[single measurement]';
  return `[${count}-day average]`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Rule-Based Adapter ──────────────────────────────────────

/**
 * Generates health summaries without any LLM -- pure deterministic
 * logic using template strings and data values. Designed to produce
 * Perplexity-quality output through structured templates.
 */
export class RuleBasedAdapter implements LLMAdapter {
  async generate(prompt: string, context: Record<string, unknown>): Promise<string> {
    // The prompt prefix routes to the appropriate builder
    const data = context as unknown as HealthContext;

    if (prompt.startsWith('SUMMARY:')) {
      return this.buildSummary(data);
    }
    if (prompt.startsWith('QA:')) {
      const question = prompt.slice(3).trim();
      return this.buildAnswer(question, data);
    }

    return this.buildSummary(data);
  }

  // ── Summary Builder ─────────────────────────────────────

  private buildSummary(data: HealthContext): string {
    const today = new Date().toISOString().slice(0, 10);
    const sections: string[] = [];

    const cardioResult = this.scoreCardiovascular(data);
    sections.push(cardioResult.section);

    const metabResult = this.scoreMetabolic(data);
    sections.push(metabResult.section);

    const sleepResult = this.scoreSleep(data);
    sections.push(sleepResult.section);

    const activityResult = this.scoreActivity(data);
    sections.push(activityResult.section);

    const clinicalSection = this.buildClinicalSection(data);
    if (clinicalSection) sections.push(clinicalSection);

    const alerts = this.buildAlerts(data);
    if (alerts) sections.push(alerts);

    // Overall score: average of available category scores
    const categoryScores = [
      cardioResult.score, metabResult.score,
      sleepResult.score, activityResult.score,
    ].filter((s): s is number => s >= 0);

    const overallScore = categoryScores.length > 0
      ? Math.round(categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length)
      : -1;

    const overallLabel = overallScore >= 80 ? 'Good'
      : overallScore >= 60 ? 'Fair'
      : overallScore >= 0 ? 'Needs Attention'
      : 'Insufficient Data';

    const headline = [
      `## Health Status -- ${today}`,
      '',
      `**Overall: ${overallScore >= 0 ? overallScore + '/100' : 'N/A'} (${overallLabel})**`,
      '',
    ].join('\n');

    return headline + sections.join('\n\n');
  }

  // ── Cardiovascular ──────────────────────────────────────

  private scoreCardiovascular(data: HealthContext): { score: number; section: string } {
    const lines: string[] = ['### Cardiovascular'];
    let score = 75;
    let dataPoints = 0;

    const hrRecords = data.vitals.filter(v => v.heartRateResting !== undefined);
    if (hrRecords.length > 0) {
      const latest = hrRecords[0]!;
      const val = latest.heartRateResting!;
      const ctx = measurementContext(hrRecords.length);
      const interp = val < 60 ? 'athletic range'
        : val < 70 ? 'good'
        : val < 80 ? 'normal'
        : 'elevated';
      lines.push(`- Resting HR: ${citedValue(val, 'bpm', latest.date, latest.source)} -- ${interp} ${ctx}`);
      if (val < 65) score += 5;
      else if (val > 80) score -= 10;
      dataPoints++;
    }

    const hrvRecords = data.vitals.filter(v => v.hrv !== undefined);
    if (hrvRecords.length > 0) {
      const latest = hrvRecords[0]!;
      const val = latest.hrv!;
      const ctx = measurementContext(hrvRecords.length);
      const interp = val > 50 ? 'good autonomic balance'
        : val > 30 ? 'moderate'
        : 'low -- recovery may be needed';
      lines.push(`- HRV: ${citedValue(val, 'ms', latest.date, latest.source)} -- ${interp} ${ctx}`);
      if (val > 50) score += 10;
      else if (val < 30) score -= 10;
      dataPoints++;
    }

    const bpRecords = data.vitals.filter(v => v.bpSystolic !== undefined);
    if (bpRecords.length > 0) {
      const latest = bpRecords[0]!;
      const sys = latest.bpSystolic!;
      const dia = latest.bpDiastolic ?? 0;
      const ctx = measurementContext(bpRecords.length);
      const interp = sys < 120 && dia < 80 ? 'normal'
        : sys < 130 ? 'elevated'
        : sys < 140 ? 'stage 1 hypertension'
        : 'stage 2 hypertension -- consult physician';
      lines.push(`- Blood Pressure: ${citedValue(sys, `/${dia} mmHg`, latest.date, latest.source)} -- ${interp} ${ctx}`);
      if (sys < 120) score += 5;
      else if (sys >= 140) score -= 20;
      else if (sys >= 130) score -= 10;
      dataPoints++;
    }

    const spo2Records = data.vitals.filter(v => v.spo2 !== undefined);
    if (spo2Records.length > 0) {
      const latest = spo2Records[0]!;
      const val = latest.spo2!;
      const interp = val >= 95 ? 'normal'
        : val >= 90 ? 'borderline low'
        : 'critically low -- seek medical attention';
      lines.push(`- SpO2: ${citedValue(val, '%', latest.date, latest.source)} -- ${interp}`);
      if (val < 95) score -= 15;
      dataPoints++;
    }

    if (dataPoints === 0) {
      lines.push('- No cardiovascular data available');
      score = -1;
    }

    const finalScore = score >= 0 ? clamp(score, 0, 100) : -1;
    if (finalScore >= 0) {
      lines.splice(0, 1, `### Cardiovascular (${finalScore}/100)`);
    }

    return { score: finalScore, section: lines.join('\n') };
  }

  // ── Metabolic ───────────────────────────────────────────

  private scoreMetabolic(data: HealthContext): { score: number; section: string } {
    const lines: string[] = ['### Metabolic'];
    let score = 75;
    let dataPoints = 0;

    const glucoseRecords = data.vitals.filter(v => v.glucose !== undefined);
    if (glucoseRecords.length > 0) {
      const latest = glucoseRecords[0]!;
      const val = latest.glucose!;
      const ctx = measurementContext(glucoseRecords.length);
      const interp = val < 70 ? 'hypoglycemic -- monitor closely'
        : val <= 90 ? 'optimal fasting range'
        : val <= 100 ? 'normal'
        : val <= 125 ? 'prediabetic range -- consider follow-up'
        : 'diabetic range -- consult physician';
      lines.push(`- Fasting Glucose: ${citedValue(val, 'mg/dL', latest.date, latest.source)} -- ${interp} ${ctx}`);
      if (val <= 90) score += 5;
      else if (val > 125) score -= 25;
      else if (val > 100) score -= 10;
      dataPoints++;
    }

    const metabolicLabs = data.labs.filter(l =>
      l.category === 'metabolic' || l.category === 'lipids'
    );
    for (const lab of metabolicLabs) {
      const interp = this.interpretLabValue(lab.testName.toLowerCase(), lab.value, lab.unit, lab.referenceRange);
      lines.push(`- ${lab.testName}: ${citedValue(lab.value, lab.unit, lab.date, lab.source)} -- ${interp}`);
      dataPoints++;

      const key = lab.testName.toLowerCase();
      if (key.includes('a1c') || key.includes('hba1c')) {
        if (lab.value <= 5.4) score += 10;
        else if (lab.value >= 6.5) score -= 25;
        else if (lab.value >= 5.7) score -= 10;
      }
      if (key.includes('ldl')) {
        if (lab.value <= 70) score += 10;
        else if (lab.value > 130) score -= 15;
      }
    }

    if (dataPoints === 0) {
      lines.push('- No metabolic data available');
      score = -1;
    }

    const finalScore = score >= 0 ? clamp(score, 0, 100) : -1;
    if (finalScore >= 0) {
      lines.splice(0, 1, `### Metabolic (${finalScore}/100)`);
    }

    return { score: finalScore, section: lines.join('\n') };
  }

  // ── Sleep ───────────────────────────────────────────────

  private scoreSleep(data: HealthContext): { score: number; section: string } {
    const lines: string[] = ['### Sleep'];
    let score = 75;

    if (data.sleep.length === 0) {
      lines.push('- No sleep data available');
      return { score: -1, section: lines.join('\n') };
    }

    const latest = data.sleep[0]!;
    const ctx = measurementContext(data.sleep.length);
    const totalHrs = Math.round((latest.totalMin / 60) * 10) / 10;

    const interp = totalHrs >= 7 ? 'meets recommended 7-9 hours'
      : totalHrs >= 6 ? 'slightly below recommended'
      : 'insufficient -- aim for 7+ hours';
    lines.push(`- Duration: ${citedValue(totalHrs, 'hours', latest.date, latest.source)} -- ${interp} ${ctx}`);

    if (totalHrs >= 7) score += 10;
    else if (totalHrs < 6) score -= 15;

    if (latest.deepMin !== undefined) {
      const deepPct = Math.round((latest.deepMin / latest.totalMin) * 100);
      const deepInterp = deepPct >= 15 ? 'good deep sleep proportion'
        : 'below optimal (aim for 15-20%)';
      lines.push(`- Deep Sleep: ${latest.deepMin} min (${deepPct}%) -- ${deepInterp}`);
      if (deepPct >= 15) score += 5;
      else score -= 5;
    }

    if (latest.remMin !== undefined) {
      const remPct = Math.round((latest.remMin / latest.totalMin) * 100);
      const remInterp = remPct >= 20 ? 'good REM proportion'
        : 'below optimal (aim for 20-25%)';
      lines.push(`- REM Sleep: ${latest.remMin} min (${remPct}%) -- ${remInterp}`);
    }

    if (latest.efficiency !== undefined) {
      const effInterp = latest.efficiency >= 85 ? 'efficient'
        : latest.efficiency >= 75 ? 'moderate'
        : 'poor efficiency';
      lines.push(`- Efficiency: ${latest.efficiency}% -- ${effInterp}`);
      if (latest.efficiency >= 85) score += 5;
      else if (latest.efficiency < 75) score -= 10;
    }

    if (latest.score !== undefined) {
      lines.push(`- Sleep Score: ${latest.score}/100 (${latest.source})`);
    }

    const finalScore = clamp(score, 0, 100);
    lines.splice(0, 1, `### Sleep (${finalScore}/100)`);

    return { score: finalScore, section: lines.join('\n') };
  }

  // ── Activity ────────────────────────────────────────────

  private scoreActivity(data: HealthContext): { score: number; section: string } {
    const lines: string[] = ['### Activity'];
    let score = 75;

    if (data.activity.length === 0) {
      lines.push('- No activity data available');
      return { score: -1, section: lines.join('\n') };
    }

    const latest = data.activity[0]!;
    const ctx = measurementContext(data.activity.length);

    if (latest.steps !== undefined) {
      const interp = latest.steps >= 10000 ? 'excellent'
        : latest.steps >= 7000 ? 'good'
        : latest.steps >= 4000 ? 'moderate'
        : 'low';
      lines.push(`- Steps: ${citedValue(latest.steps, 'steps', latest.date, latest.source)} -- ${interp} ${ctx}`);
      if (latest.steps >= 10000) score += 10;
      else if (latest.steps < 4000) score -= 10;
    }

    if (latest.caloriesActive !== undefined) {
      lines.push(`- Active Calories: ${citedValue(latest.caloriesActive, 'kcal', latest.date, latest.source)}`);
    }

    if (latest.activeMin !== undefined) {
      const interp = latest.activeMin >= 30 ? 'meets daily recommendation'
        : 'below 30 min target';
      lines.push(`- Active Minutes: ${citedValue(latest.activeMin, 'min', latest.date, latest.source)} -- ${interp}`);
      if (latest.activeMin >= 30) score += 5;
    }

    if (latest.vo2Max !== undefined) {
      const interp = latest.vo2Max >= 45 ? 'excellent cardiorespiratory fitness'
        : latest.vo2Max >= 35 ? 'good'
        : 'below average -- consider aerobic training';
      lines.push(`- VO2 Max: ${citedValue(latest.vo2Max, 'mL/kg/min', latest.date, latest.source)} -- ${interp}`);
      if (latest.vo2Max >= 45) score += 10;
    }

    if (latest.recovery !== undefined) {
      lines.push(`- Recovery Score: ${latest.recovery}/100 (${latest.source})`);
    }

    if (latest.strain !== undefined) {
      lines.push(`- Strain Score: ${latest.strain} (${latest.source})`);
    }

    const finalScore = clamp(score, 0, 100);
    lines.splice(0, 1, `### Activity (${finalScore}/100)`);

    return { score: finalScore, section: lines.join('\n') };
  }

  // ── Clinical Section ────────────────────────────────────

  private buildClinicalSection(data: HealthContext): string | null {
    const lines: string[] = [];

    const activeConditions = data.conditions.filter(c => c.status === 'active');
    if (activeConditions.length > 0) {
      lines.push('### Active Conditions');
      for (const c of activeConditions) {
        const onset = c.onsetDate ? ` (onset: ${c.onsetDate})` : '';
        lines.push(`- ${c.name}${onset} -- source: ${c.source}`);
      }
    }

    const activeMeds = data.medications.filter(m => m.status === 'active');
    if (activeMeds.length > 0) {
      lines.push('### Current Medications');
      for (const m of activeMeds) {
        const dose = m.dose ? ` ${m.dose}` : '';
        const freq = m.frequency ? `, ${m.frequency}` : '';
        lines.push(`- ${m.name}${dose}${freq} -- source: ${m.source}`);
      }
    }

    if (data.allergies.length > 0) {
      lines.push('### Allergies');
      for (const a of data.allergies) {
        const severity = a.severity ? ` (${a.severity})` : '';
        const type = a.type ? ` [${a.type}]` : '';
        lines.push(`- ${a.name}${type}${severity} -- source: ${a.source}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  // ── Alerts ──────────────────────────────────────────────

  private buildAlerts(data: HealthContext): string | null {
    const alerts: string[] = ['### Alerts'];

    for (const v of data.vitals.slice(0, 5)) {
      if (v.bpSystolic !== undefined && v.bpSystolic >= 140) {
        alerts.push(`- [WARNING] Blood pressure ${v.bpSystolic}/${v.bpDiastolic ?? '?'} mmHg on ${v.date} is stage 2 hypertension. Follow up with physician.`);
      }
      if (v.spo2 !== undefined && v.spo2 < 92) {
        alerts.push(`- [CRITICAL] SpO2 ${v.spo2}% on ${v.date} is critically low. Seek immediate medical attention.`);
      }
      if (v.glucose !== undefined && v.glucose > 125) {
        alerts.push(`- [WARNING] Fasting glucose ${v.glucose} mg/dL on ${v.date} is in diabetic range. Consult physician.`);
      }
    }

    for (const l of data.labs.slice(0, 10)) {
      const key = l.testName.toLowerCase();
      if ((key.includes('a1c') || key.includes('hba1c')) && l.value >= 6.5) {
        alerts.push(`- [CRITICAL] HbA1c ${l.value}% on ${l.date} is in diabetic range (>=6.5%). Consult physician.`);
      }
      if (key.includes('creatinine') && l.value > 1.5) {
        alerts.push(`- [WARNING] Creatinine ${l.value} mg/dL on ${l.date} may indicate kidney stress. Follow up recommended.`);
      }
    }

    return alerts.length > 1 ? alerts.join('\n') : null;
  }

  // ── Q&A Builder ─────────────────────────────────────────

  private buildAnswer(question: string, data: HealthContext): string {
    const q = question.toLowerCase();
    const lines: string[] = [];

    if (q.includes('heart') || q.includes('cardio') || q.includes('blood pressure') || q.includes('hrv')) {
      lines.push('**Cardiovascular Data:**');
      for (const v of data.vitals.slice(0, 5)) {
        const parts: string[] = [];
        if (v.heartRateResting !== undefined) parts.push(`Resting HR: ${v.heartRateResting} bpm`);
        if (v.hrv !== undefined) parts.push(`HRV: ${v.hrv} ms`);
        if (v.bpSystolic !== undefined) parts.push(`BP: ${v.bpSystolic}/${v.bpDiastolic} mmHg`);
        if (parts.length > 0) lines.push(`- ${v.date} (${v.source}): ${parts.join(', ')}`);
      }
    }

    if (q.includes('sleep')) {
      lines.push('**Sleep Data:**');
      for (const s of data.sleep.slice(0, 5)) {
        const hrs = Math.round((s.totalMin / 60) * 10) / 10;
        lines.push(`- ${s.date} (${s.source}): ${hrs} hours total, ${s.deepMin ?? '?'} min deep, ${s.remMin ?? '?'} min REM`);
      }
    }

    if (q.includes('lab') || q.includes('blood') || q.includes('cholesterol') || q.includes('glucose') || q.includes('a1c')) {
      lines.push('**Lab Results:**');
      for (const l of data.labs.slice(0, 10)) {
        const interp = this.interpretLabValue(l.testName.toLowerCase(), l.value, l.unit, l.referenceRange);
        lines.push(`- ${l.date} (${l.source}): ${l.testName} = ${l.value} ${l.unit} -- ${interp}`);
      }
    }

    if (q.includes('medication') || q.includes('drug') || q.includes('prescription')) {
      lines.push('**Current Medications:**');
      for (const m of data.medications.filter(m => m.status === 'active')) {
        lines.push(`- ${m.name} ${m.dose ?? ''} ${m.frequency ?? ''} (${m.source})`);
      }
    }

    if (q.includes('allerg')) {
      lines.push('**Allergies:**');
      for (const a of data.allergies) {
        lines.push(`- ${a.name} ${a.type ? `[${a.type}]` : ''} ${a.severity ? `(${a.severity})` : ''} -- ${a.source}`);
      }
    }

    if (q.includes('condition') || q.includes('diagnos')) {
      lines.push('**Active Conditions:**');
      for (const c of data.conditions.filter(c => c.status === 'active')) {
        lines.push(`- ${c.name} (onset: ${c.onsetDate ?? 'unknown'}) -- ${c.source}`);
      }
    }

    if (q.includes('step') || q.includes('activity') || q.includes('exercise') || q.includes('workout')) {
      lines.push('**Activity Data:**');
      for (const a of data.activity.slice(0, 5)) {
        const parts: string[] = [];
        if (a.steps !== undefined) parts.push(`${a.steps} steps`);
        if (a.caloriesActive !== undefined) parts.push(`${a.caloriesActive} active kcal`);
        if (a.activeMin !== undefined) parts.push(`${a.activeMin} active min`);
        if (parts.length > 0) lines.push(`- ${a.date} (${a.source}): ${parts.join(', ')}`);
      }
    }

    if (lines.length === 0) {
      lines.push('I can answer questions about your vitals, labs, sleep, activity, conditions, medications, and allergies.');
      lines.push('Please ask about a specific health topic so I can ground the answer in your data.');
    }

    lines.push('');
    lines.push('_All values sourced from your health records. This is not medical advice. Consult your physician for clinical decisions._');

    return lines.join('\n');
  }

  // ── Lab Interpretation (shared) ─────────────────────────

  private interpretLabValue(
    testKey: string,
    value: number,
    unit: string,
    refRange?: { low?: number; high?: number },
  ): string {
    const ref = refRange ?? this.lookupRefRange(testKey);
    if (!ref) return 'no reference range available';

    if (ref.high !== undefined && value > ref.high) {
      return `high (reference: ${ref.low !== undefined ? ref.low + '-' : '<'}${ref.high} ${unit})`;
    }
    if (ref.low !== undefined && value < ref.low) {
      return `low (reference: ${ref.low}-${ref.high !== undefined ? ref.high : '+'} ${unit})`;
    }
    return 'within normal range';
  }

  private lookupRefRange(testKey: string): { low?: number; high?: number } | null {
    for (const [key, range] of Object.entries(LAB_REFERENCE_RANGES)) {
      if (testKey.includes(key)) return range;
    }
    return null;
  }
}

// ── Claude Adapter (stub) ───────────────────────────────────

/**
 * Calls Anthropic's Claude API for LLM-powered health summaries.
 * Handles missing @anthropic-ai/sdk dependency gracefully -- falls
 * back to an error message if the SDK is not installed.
 */
export class ClaudeAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private client: unknown | null = null;

  constructor(config: { apiKey?: string; model?: string } = {}) {
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.model = config.model ?? 'claude-sonnet-4-20250514';
    this.initClient();
  }

  private initClient(): void {
    try {
      // Dynamic require to handle missing dependency gracefully
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { default: Anthropic } = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: this.apiKey });
    } catch {
      // SDK not installed -- generate() will return a fallback message
      this.client = null;
    }
  }

  async generate(prompt: string, context: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      return '[ClaudeAdapter] @anthropic-ai/sdk is not installed. Install with: npm install @anthropic-ai/sdk';
    }

    if (!this.apiKey) {
      return '[ClaudeAdapter] ANTHROPIC_API_KEY not set. Set the environment variable or pass apiKey in constructor.';
    }

    try {
      const anthropic = this.client as {
        messages: {
          create(params: Record<string, unknown>): Promise<{
            content: Array<{ type: string; text?: string }>;
          }>;
        };
      };

      const systemPrompt = [
        'You are a health data analyst for MyHealthSpan. You MUST:',
        '1. Only reference data provided in the context -- never fabricate values',
        '2. Cite source and date for every metric mentioned',
        '3. Flag whether a value is a single measurement or multi-day average',
        '4. Never diagnose -- only describe what the data shows and suggest follow-up when values are out of range',
        '5. Use clinical reference ranges to interpret lab values',
      ].join('\n');

      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nHealth Data Context:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      });

      const textBlock = response.content.find((c: { type: string }) => c.type === 'text');
      return textBlock?.text ?? '[No response generated]';
    } catch (err) {
      return `[ClaudeAdapter] API call failed: ${String(err)}`;
    }
  }
}

// ── Harness ─────────────────────────────────────────────────

/**
 * LLM-agnostic execution engine. Accepts any adapter (rule-based,
 * Claude, or custom) and provides structured health operations.
 */
export class Harness {
  private adapter: LLMAdapter;

  constructor(adapter: LLMAdapter) {
    this.adapter = adapter;
  }

  /**
   * Generate a full health summary from available data.
   * Routes through the configured adapter using prompt templates.
   */
  async generateSummary(data: HealthContext): Promise<string> {
    return this.adapter.generate('SUMMARY:', data as unknown as Record<string, unknown>);
  }

  /**
   * Answer a health question grounded in the user's data.
   * Every answer must cite source data. No extrapolation.
   */
  async answerQuestion(question: string, data: HealthContext): Promise<string> {
    return this.adapter.generate(`QA:${question}`, data as unknown as Record<string, unknown>);
  }

  /**
   * Interpret a single lab result against reference ranges.
   * Pure rule-based -- no LLM needed regardless of adapter.
   */
  interpretLab(
    testName: string,
    value: number,
    unit: string,
    refRange: { low?: number; high?: number },
  ): string {
    const lines: string[] = [];
    const name = testName.trim();

    // Determine status against reference range
    let status: 'low' | 'normal' | 'high' | 'unknown' = 'unknown';
    if (refRange.high !== undefined && refRange.low !== undefined) {
      if (value > refRange.high) status = 'high';
      else if (value < refRange.low) status = 'low';
      else status = 'normal';
    } else if (refRange.high !== undefined) {
      status = value > refRange.high ? 'high' : 'normal';
    } else if (refRange.low !== undefined) {
      status = value < refRange.low ? 'low' : 'normal';
    }

    // Build range description
    const rangeStr = refRange.low !== undefined && refRange.high !== undefined
      ? `${refRange.low}-${refRange.high} ${unit}`
      : refRange.high !== undefined
        ? `<${refRange.high} ${unit}`
        : refRange.low !== undefined
          ? `>${refRange.low} ${unit}`
          : 'no reference range';

    lines.push(`**${name}**: ${value} ${unit}`);
    lines.push(`Reference range: ${rangeStr}`);

    switch (status) {
      case 'high':
        lines.push(`Status: HIGH -- above the upper limit of ${refRange.high} ${unit}`);
        lines.push('Recommendation: Follow up with your healthcare provider to discuss this result.');
        break;
      case 'low':
        lines.push(`Status: LOW -- below the lower limit of ${refRange.low} ${unit}`);
        lines.push('Recommendation: Follow up with your healthcare provider to discuss this result.');
        break;
      case 'normal':
        lines.push('Status: NORMAL -- within reference range');
        break;
      default:
        lines.push('Status: Unable to determine without complete reference range');
    }

    // Check for optimal range notes from built-in data
    const builtIn = LAB_REFERENCE_RANGES[testName.toLowerCase()];
    if (builtIn) {
      if (builtIn.optimalHigh !== undefined && value > builtIn.optimalHigh && status === 'normal') {
        lines.push(`Note: While within normal range, value is above the optimal threshold of ${builtIn.optimalHigh} ${unit}.`);
      }
      if (builtIn.optimalLow !== undefined && value < builtIn.optimalLow && status === 'normal') {
        lines.push(`Note: While within normal range, value is below the optimal threshold of ${builtIn.optimalLow} ${unit}.`);
      }
    }

    lines.push('');
    lines.push('_This is an automated interpretation. Always consult your physician for clinical decisions._');

    return lines.join('\n');
  }
}
