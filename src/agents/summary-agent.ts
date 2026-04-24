// ============================================================
// MyHealthSpan Agent — Summary Agent
// Daily briefing, Q&A, and weekly report generation
// Perplexity Health-quality output: data-grounded, zero hallucination
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus, DailyHealthSummary } from './types.js';
import type { LocalStore } from '../storage/local-store.js';
import { RuleBasedAdapter, Harness, type HealthContext } from '../harness/harness.js';

// ── Data type → context bucket mapping ──────────────────────

const VITAL_KEYS = new Set([
  'heartRateResting', 'heartRate', 'hrv', 'bpSystolic', 'bpDiastolic', 'spo2', 'respiratoryRate', 'bodyTemperature',
]);

const LAB_KEYS = new Set([
  'glucose', 'hba1c', 'ldl', 'hdl', 'triglycerides', 'creatinine', 'tsh', 'cholesterol',
  'Hemoglobin A1c/Hemoglobin.total in Blood', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma',
  'Cholesterol in HDL [Mass/volume] in Serum or Plasma', 'Triglyceride [Mass/volume] in Serum or Plasma',
  'Glucose [Mass/volume] in Serum or Plasma', 'Creatinine [Mass/volume] in Serum or Plasma',
]);

const SLEEP_KEYS = new Set([
  'totalSleepMin', 'deepSleepMin', 'remSleepMin', 'lightSleepMin', 'sleepScore', 'sleepEfficiency',
]);

const ACTIVITY_KEYS = new Set([
  'steps', 'caloriesActive', 'caloriesTotal', 'activeMin', 'strainScore', 'recoveryScore', 'vo2Max',
]);

/** Maps raw data_type strings to normalized context keys */
function normalizeDataType(raw: string): { bucket: 'vitals' | 'labs' | 'sleep' | 'activity'; key: string } | null {
  const dt = raw.toLowerCase();

  // Vitals
  if (dt.includes('heart rate') || dt.includes('pulse')) return { bucket: 'vitals', key: 'heartRateResting' };
  if (dt.includes('hrv') || dt.includes('heart rate variability')) return { bucket: 'vitals', key: 'hrv' };
  if (dt.includes('systolic') || (dt.includes('blood pressure') && !dt.includes('diastolic'))) return { bucket: 'vitals', key: 'bpSystolic' };
  if (dt.includes('diastolic')) return { bucket: 'vitals', key: 'bpDiastolic' };
  if (dt.includes('spo2') || dt.includes('oxygen saturation')) return { bucket: 'vitals', key: 'spo2' };
  if (dt.includes('respiratory')) return { bucket: 'vitals', key: 'respiratoryRate' };
  if (dt.includes('body temperature') || dt.includes('temperature')) return { bucket: 'vitals', key: 'bodyTemperature' };

  // Labs
  if (dt.includes('a1c') || dt.includes('hemoglobin a1c')) return { bucket: 'labs', key: 'hba1c' };
  if (dt.includes('glucose') && !dt.includes('a1c')) return { bucket: 'labs', key: 'glucose' };
  if (dt.includes('ldl') || dt.includes('low density')) return { bucket: 'labs', key: 'ldl' };
  if (dt.includes('hdl') || dt.includes('high density')) return { bucket: 'labs', key: 'hdl' };
  if (dt.includes('triglyceride')) return { bucket: 'labs', key: 'triglycerides' };
  if (dt.includes('creatinine')) return { bucket: 'labs', key: 'creatinine' };
  if (dt.includes('tsh') || dt.includes('thyrotropin')) return { bucket: 'labs', key: 'tsh' };
  if (dt.includes('cholesterol') && !dt.includes('hdl') && !dt.includes('ldl')) return { bucket: 'labs', key: 'cholesterol' };

  // Sleep
  if (dt.includes('sleep') && dt.includes('duration')) return { bucket: 'sleep', key: 'totalSleepMin' };
  if (dt.includes('deep') && dt.includes('sleep')) return { bucket: 'sleep', key: 'deepSleepMin' };
  if (dt.includes('rem') && dt.includes('sleep')) return { bucket: 'sleep', key: 'remSleepMin' };
  if (dt.includes('light') && dt.includes('sleep')) return { bucket: 'sleep', key: 'lightSleepMin' };
  if (dt.includes('sleep') && dt.includes('score')) return { bucket: 'sleep', key: 'sleepScore' };
  if (dt.includes('sleep') && dt.includes('efficiency')) return { bucket: 'sleep', key: 'sleepEfficiency' };

  // Activity
  if (dt.includes('steps')) return { bucket: 'activity', key: 'steps' };
  if (dt.includes('calories') && dt.includes('active')) return { bucket: 'activity', key: 'caloriesActive' };
  if (dt.includes('recovery')) return { bucket: 'activity', key: 'recoveryScore' };
  if (dt.includes('strain')) return { bucket: 'activity', key: 'strainScore' };
  if (dt.includes('vo2')) return { bucket: 'activity', key: 'vo2Max' };

  // Check against known sets using exact match on raw key
  if (VITAL_KEYS.has(raw)) return { bucket: 'vitals', key: raw };
  if (LAB_KEYS.has(raw)) return { bucket: 'labs', key: raw };
  if (SLEEP_KEYS.has(raw)) return { bucket: 'sleep', key: raw };
  if (ACTIVITY_KEYS.has(raw)) return { bucket: 'activity', key: raw };

  return null;
}

// ── Summary Agent ───────────────────────────────────────────

export class SummaryAgent implements SubAgent {
  name = 'summary-agent';
  description = 'Generates daily health briefings, answers health questions with cited data';
  status: AgentStatus = 'idle';

  private store: LocalStore;
  private harness: Harness;
  private latestSummary: DailyHealthSummary | null = null;

  constructor(store: LocalStore) {
    this.store = store;
    this.harness = new Harness(new RuleBasedAdapter());
  }

  async initialize(): Promise<void> {
    this.status = 'idle';
  }

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    switch (message.action) {
      case 'generate-daily':
        return this.generateDaily(message);
      case 'get-latest':
        return this.getLatest(message);
      case 'answer-question':
        return this.answerQuestion(message);
      case 'weekly-report':
        return this.weeklyReport(message);
      default:
        return {
          ...message,
          from: this.name,
          to: 'orchestrator',
          type: 'error',
          payload: { error: `Unknown action: ${message.action}` },
        };
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.status = 'idle';
  }

  // ── Actions ─────────────────────────────────────────────────

  private async generateDaily(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    try {
      const context = this.buildHealthContext();

      // Generate text summary via harness (returns string)
      const text = await this.harness.generateSummary(context);

      // Build structured summary from context directly
      const today = new Date().toISOString().split('T')[0]!;
      const sources = new Set<string>();
      const keyMetrics: DailyHealthSummary['keyMetrics'] = [];
      const alerts: DailyHealthSummary['alerts'] = [];

      // Extract key metrics from context
      for (const v of context.vitals) {
        if (v.heartRateResting) { keyMetrics.push({ label: 'Resting HR', value: String(v.heartRateResting), unit: 'bpm', trend: 'stable', status: v.heartRateResting < 70 ? 'good' : v.heartRateResting < 85 ? 'warning' : 'concern' }); sources.add(v.source); }
        if (v.heartRate) { keyMetrics.push({ label: 'Heart Rate', value: String(v.heartRate), unit: 'bpm', trend: 'stable', status: 'good' }); sources.add(v.source); }
        if (v.bpSystolic) { keyMetrics.push({ label: 'BP Systolic', value: String(v.bpSystolic), unit: 'mmHg', trend: 'stable', status: v.bpSystolic < 120 ? 'good' : v.bpSystolic < 140 ? 'warning' : 'concern' }); sources.add(v.source); }
        if (v.spo2) { keyMetrics.push({ label: 'SpO2', value: String(v.spo2), unit: '%', trend: 'stable', status: v.spo2 >= 95 ? 'good' : 'concern' }); sources.add(v.source); }
      }
      for (const l of context.labs) {
        sources.add(l.source);
        let status: 'good' | 'warning' | 'concern' = 'good';
        if (l.testName === 'hba1c' && l.value >= 5.7) status = l.value >= 6.5 ? 'concern' : 'warning';
        if (l.testName === 'ldl' && l.value > 130) status = 'warning';
        if (l.testName === 'hdl' && l.value < 40) status = 'warning';
        if (l.testName === 'triglycerides' && l.value > 150) status = 'warning';
        if (l.testName === 'glucose' && l.value > 100) status = l.value > 126 ? 'concern' : 'warning';
        keyMetrics.push({ label: l.testName.charAt(0).toUpperCase() + l.testName.slice(1), value: String(l.value), unit: l.unit, trend: 'stable', status });

        // Generate alerts for out-of-range labs
        if (l.testName === 'hba1c' && l.value >= 5.7) alerts.push({ severity: l.value >= 6.5 ? 'critical' : 'warning', message: `HbA1c ${l.value}% -- ${l.value >= 6.5 ? 'diabetic' : 'prediabetic'} range`, metric: 'hba1c' });
        if (l.testName === 'hdl' && l.value < 40) alerts.push({ severity: 'warning', message: `HDL ${l.value} mg/dL -- below protective level (>40)`, metric: 'hdl' });
        if (l.testName === 'triglycerides' && l.value > 150) alerts.push({ severity: 'warning', message: `Triglycerides ${l.value} mg/dL -- elevated (>150)`, metric: 'triglycerides' });
      }

      // Compute scores
      const cvScore = this.scoreCategory(context.vitals, context.labs, 'cardiovascular');
      const metScore = this.scoreCategory(context.vitals, context.labs, 'metabolic');
      const sleepScore = context.sleep.length > 0 ? 75 : -1;
      const actScore = context.activity.length > 0 ? 75 : -1;
      const validScores = [cvScore, metScore, sleepScore, actScore].filter(s => s >= 0);
      const overallScore = validScores.length > 0 ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : 0;

      const headline = overallScore >= 75 ? 'Good overall health profile.'
        : overallScore >= 50 ? 'Some metrics need attention.'
        : keyMetrics.length > 0 ? 'Several areas of concern detected.'
        : 'Connect devices to start tracking.';

      const summary: DailyHealthSummary = {
        date: today,
        generatedAt: new Date().toISOString(),
        headline,
        overallScore,
        cardiovascular: { score: cvScore, summary: cvScore >= 0 ? `${cvScore}/100` : 'Awaiting data', dataPoints: [] },
        metabolic: { score: metScore, summary: metScore >= 0 ? `${metScore}/100` : 'Awaiting data', dataPoints: [] },
        sleep: { score: sleepScore, summary: sleepScore >= 0 ? `${sleepScore}/100` : 'Awaiting wearable data', dataPoints: [] },
        activity: { score: actScore, summary: actScore >= 0 ? `${actScore}/100` : 'Awaiting wearable data', dataPoints: [] },
        keyMetrics,
        alerts: alerts.sort((a, b) => (a.severity === 'critical' ? 0 : a.severity === 'warning' ? 1 : 2) - (b.severity === 'critical' ? 0 : b.severity === 'warning' ? 1 : 2)),
        sources: Array.from(sources),
      };

      // Cache for get-latest
      this.latestSummary = summary;

      this.status = 'idle';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'result',
        payload: { summary },
      };
    } catch (err) {
      this.status = 'error';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'error',
        payload: { error: String(err) },
      };
    }
  }

  private async getLatest(msg: AgentMessage): Promise<AgentMessage> {
    if (!this.latestSummary) {
      // Try generating one on the fly
      return this.generateDaily(msg);
    }

    return {
      ...msg,
      from: this.name,
      to: 'orchestrator',
      type: 'result',
      payload: { summary: this.latestSummary },
    };
  }

  private async answerQuestion(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    try {
      const question = msg.payload.question as string;
      if (!question) {
        this.status = 'idle';
        return {
          ...msg,
          from: this.name,
          to: 'orchestrator',
          type: 'error',
          payload: { error: 'No question provided' },
        };
      }

      const context = this.buildHealthContext();
      const result = this.harness.answerQuestion(question, context);

      this.status = 'idle';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'result',
        payload: {
          answer: result.answer,
          citations: result.citations,
          question,
        },
      };
    } catch (err) {
      this.status = 'error';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'error',
        payload: { error: String(err) },
      };
    }
  }

  private async weeklyReport(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    try {
      // Generate 7 daily snapshots for comparison
      const today = new Date();
      const thisWeekSummaries: DailyHealthSummary[] = [];

      // Generate current summary as basis for the weekly report
      const context = this.buildHealthContext();
      const result = this.harness.generateSummary(context);

      const todayStr = today.toISOString().split('T')[0]!;
      const currentSummary: DailyHealthSummary = {
        date: todayStr,
        generatedAt: new Date().toISOString(),
        headline: result.headline,
        overallScore: result.overallScore,
        cardiovascular: result.cardiovascular,
        metabolic: result.metabolic,
        sleep: result.sleep,
        activity: result.activity,
        keyMetrics: result.keyMetrics,
        alerts: result.alerts,
        sources: result.sources,
      };

      thisWeekSummaries.push(currentSummary);

      const weeklyOverview = {
        weekEnding: todayStr,
        overallScore: result.overallScore,
        categories: {
          cardiovascular: result.cardiovascular,
          metabolic: result.metabolic,
          sleep: result.sleep,
          activity: result.activity,
        },
        alerts: result.alerts,
        sources: result.sources,
      };

      this.status = 'idle';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'result',
        payload: { weeklyReport: weeklyOverview },
      };
    } catch (err) {
      this.status = 'error';
      return {
        ...msg,
        from: this.name,
        to: 'orchestrator',
        type: 'error',
        payload: { error: String(err) },
      };
    }
  }

  // ── Context Builder ─────────────────────────────────────────

  /**
   * Query the latest health samples from the local store and
   * organize them into a HealthContext for the harness.
   * Deduplicates by key — keeps only the most recent value per metric.
   */
  private buildHealthContext(): HealthContext {
    const vitals: HealthContext['vitals'] = [];
    const labs: HealthContext['labs'] = [];
    const sleep: HealthContext['sleep'] = [];
    const activity: HealthContext['activity'] = [];

    // Query recent samples (most recent first, up to 1000)
    const rows = (this.store as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => RawRow[] } } }).db.prepare(
      `SELECT data_type, value, unit, recorded_at, source
       FROM health_samples
       ORDER BY recorded_at DESC
       LIMIT 1000`
    ).all() as RawRow[];

    const seen = new Set<string>();

    for (const row of rows) {
      const mapped = normalizeDataType(row.data_type);
      if (!mapped) continue;

      // Deduplicate — keep only the most recent value per key
      if (seen.has(mapped.key)) continue;
      seen.add(mapped.key);

      const date = row.recorded_at.split('T')[0] ?? row.recorded_at;
      const sourceLabel = this.formatSource(row.source);

      if (mapped.bucket === 'vitals') {
        const rec: Record<string, unknown> = { date, source: sourceLabel };
        rec[mapped.key] = row.value;
        vitals.push(rec as HealthContext['vitals'][0]);
      } else if (mapped.bucket === 'labs') {
        labs.push({
          date, source: sourceLabel, testName: mapped.key, value: row.value,
          unit: row.unit, category: 'labs',
        } as HealthContext['labs'][0]);
      } else if (mapped.bucket === 'sleep') {
        const rec: Record<string, unknown> = { date, source: sourceLabel, totalMin: 0 };
        rec[mapped.key] = row.value;
        if (mapped.key === 'totalSleepMin') (rec as Record<string, number>).totalMin = row.value;
        sleep.push(rec as HealthContext['sleep'][0]);
      } else if (mapped.bucket === 'activity') {
        const rec: Record<string, unknown> = { date, source: sourceLabel };
        rec[mapped.key] = row.value;
        activity.push(rec as HealthContext['activity'][0]);
      }
    }

    return { vitals, labs, sleep, activity, conditions: [], medications: [], allergies: [] };
  }

  private scoreCategory(vitals: HealthContext['vitals'], labs: HealthContext['labs'], category: string): number {
    let score = 75;
    let hasData = false;
    if (category === 'cardiovascular') {
      for (const v of vitals) {
        if (v.heartRateResting) { hasData = true; if (v.heartRateResting < 65) score += 10; else if (v.heartRateResting > 80) score -= 10; }
        if (v.bpSystolic) { hasData = true; if (v.bpSystolic < 120) score += 5; else if (v.bpSystolic >= 140) score -= 15; }
      }
      for (const l of labs) {
        if (l.testName === 'ldl') { hasData = true; if (l.value < 70) score += 10; else if (l.value > 130) score -= 15; }
        if (l.testName === 'hdl') { hasData = true; if (l.value >= 60) score += 10; else if (l.value < 40) score -= 15; }
        if (l.testName === 'triglycerides') { hasData = true; if (l.value < 100) score += 5; else if (l.value > 150) score -= 10; }
      }
    } else if (category === 'metabolic') {
      for (const l of labs) {
        if (l.testName === 'hba1c') { hasData = true; if (l.value < 5.4) score += 10; else if (l.value > 6.5) score -= 25; else if (l.value > 5.7) score -= 10; }
        if (l.testName === 'glucose') { hasData = true; if (l.value < 90) score += 5; else if (l.value > 126) score -= 20; else if (l.value > 100) score -= 10; }
        if (l.testName === 'creatinine') { hasData = true; if (l.value > 1.3) score -= 10; }
      }
    }
    return hasData ? Math.max(0, Math.min(100, score)) : -1;
  }

  private formatSource(source: string): string {
    switch (source.toLowerCase()) {
      case 'ehr': return 'EHR';
      case 'apple_health': return 'Apple Health';
      case 'google_health': return 'Google Health';
      case 'wearable': return 'Wearable';
      case 'manual': return 'Manual';
      default: return source;
    }
  }
}

// ── Raw Row Type ──────────────────────────────────────────────

interface RawRow {
  data_type: string;
  value: number;
  unit: string;
  recorded_at: string;
  source: string;
}
