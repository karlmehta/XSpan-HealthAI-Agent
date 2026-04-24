// ============================================================
// Analytics Agent — crunches health data into charts, scores, trends
// Domain-aware: understands clinical ranges, what's good/bad
// Benchmarked against Perplexity Health's insights quality
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus, ChartDataSet, VitalRecord, LabRecord } from './types.js';
import type { LocalStore } from '../storage/local-store.js';

export class AnalyticsAgent implements SubAgent {
  name = 'analytics-agent';
  description = 'Analyzes health data — creates charts, trend lines, scores, and drift alerts';
  status: AgentStatus = 'idle';

  private store: LocalStore;

  constructor(store: LocalStore) {
    this.store = store;
  }

  async initialize(): Promise<void> { this.status = 'idle'; }

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    switch (message.action) {
      case 'chart-data':
        return this.buildChartData(message);
      case 'analyze':
        return this.runAnalysis(message);
      case 'get-all-data':
        return this.getAllData(message);
      case 'get-lab-summary':
        return this.getLabSummary(message);
      default:
        return { ...message, from: this.name, to: 'orchestrator', type: 'error', payload: { error: `Unknown action: ${message.action}` } };
    }
  }

  getStatus(): AgentStatus { return this.status; }
  async shutdown(): Promise<void> { this.status = 'idle'; }

  // ── Chart Data Builder ──────────────────────────────────────

  private async buildChartData(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    try {
      const rows = this.store.db.prepare(
        "SELECT data_type, value, unit, date(recorded_at) as day FROM health_samples WHERE recorded_at > datetime('now', '-90 days') ORDER BY recorded_at ASC"
      ).all() as Array<{ data_type: string; value: number; unit: string; day: string }>;

      // Group by date → metric
      const byDate: Record<string, Record<string, number[]>> = {};
      for (const r of rows) {
        if (!byDate[r.day]) byDate[r.day] = {};
        const key = this.mapToChartKey(r.data_type, r.value);
        if (key) {
          if (!byDate[r.day][key]) byDate[r.day][key] = [];
          byDate[r.day][key].push(r.value);
        }
      }

      const dates = Object.keys(byDate).sort();
      const labels = dates.map(d => d.slice(5)); // MM-DD

      const avg = (key: string) => dates.map(d => {
        const vals = byDate[d]?.[key];
        return vals?.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
      });

      const chartData: ChartDataSet = {
        labels,
        series: {
          restingHr: avg('restingHr'),
          hrv: avg('hrv'),
          bpSystolic: avg('bpSystolic'),
          bpDiastolic: avg('bpDiastolic'),
          spo2: avg('spo2'),
          glucose: avg('glucose'),
          hba1c: avg('hba1c'),
          cholesterol: avg('cholesterol'),
          ldl: avg('ldl'),
          hdl: avg('hdl'),
          triglycerides: avg('triglycerides'),
          weight: avg('weight'),
          steps: avg('steps'),
          sleepMin: avg('sleepMin'),
          sleepScore: avg('sleepScore'),
          recovery: avg('recovery'),
          strain: avg('strain'),
          creatinine: avg('creatinine'),
          tsh: avg('tsh'),
        },
      };

      this.status = 'idle';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { chartData } };
    } catch (err) {
      this.status = 'error';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  // ── Full Analysis ───────────────────────────────────────────

  private async runAnalysis(msg: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    try {
      // Get recent samples
      const rows = this.store.db.prepare(
        "SELECT data_type, value, unit, recorded_at FROM health_samples ORDER BY recorded_at DESC LIMIT 1000"
      ).all() as Array<{ data_type: string; value: number; unit: string; recorded_at: string }>;

      // Compute category scores
      const labValues = this.extractLabValues(rows);
      const scores = {
        cardiovascular: this.scoreCardiovascular(labValues),
        metabolic: this.scoreMetabolic(labValues),
        sleep: this.scoreSleep(rows),
        activity: this.scoreActivity(rows),
      };

      // Detect alerts
      const alerts = this.detectAlerts(labValues);

      this.status = 'idle';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { scores, alerts, labCount: rows.length } };
    } catch (err) {
      this.status = 'error';
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  // ── Lab Summary ─────────────────────────────────────────────

  private async getLabSummary(msg: AgentMessage): Promise<AgentMessage> {
    try {
      const rows = this.store.db.prepare(
        "SELECT data_type, value, unit, recorded_at FROM health_samples ORDER BY recorded_at DESC LIMIT 500"
      ).all() as Array<{ data_type: string; value: number; unit: string; recorded_at: string }>;

      const vitals: VitalRecord[] = [];
      const labs: LabRecord[] = [];
      const seen = new Set<string>();

      for (const r of rows) {
        const key = this.mapToChartKey(r.data_type, r.value);
        const dt = r.data_type.toLowerCase();
        const dedupeKey = `${r.data_type}-${r.recorded_at.split('T')[0]}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        if (['restingHr', 'bpSystolic', 'bpDiastolic', 'spo2'].includes(key || '')) {
          vitals.push({
            date: r.recorded_at, heartRate: key === 'restingHr' ? r.value : undefined,
            bpSystolic: key === 'bpSystolic' ? r.value : undefined,
            bpDiastolic: key === 'bpDiastolic' ? r.value : undefined,
            spo2: key === 'spo2' ? r.value : undefined,
            source: 'ehr',
          });
        } else if (key) {
          const interp = this.interpretLab(key, r.value);
          labs.push({
            date: r.recorded_at, testName: r.data_type, value: r.value, unit: r.unit,
            category: this.labCategory(key), interpretation: interp, source: 'ehr',
          });
        }
      }

      return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: { vitals, labs } };
    } catch (err) {
      return { ...msg, from: this.name, to: 'orchestrator', type: 'error', payload: { error: String(err) } };
    }
  }

  private async getAllData(msg: AgentMessage): Promise<AgentMessage> {
    const labResult = await this.getLabSummary(msg);
    return { ...msg, from: this.name, to: 'orchestrator', type: 'result', payload: {
      data: {
        vitals: labResult.payload.vitals || [],
        labs: labResult.payload.labs || [],
        sleep: [], activity: [],
        conditions: [], medications: [], allergies: [], immunizations: [],
      }
    }};
  }

  // ── Clinical Scoring ────────────────────────────────────────

  private scoreCardiovascular(labs: Record<string, number>): number {
    let score = 75; // baseline
    if (labs.ldl !== undefined) {
      if (labs.ldl < 70) score += 10;
      else if (labs.ldl < 100) score += 5;
      else if (labs.ldl > 130) score -= 15;
      else if (labs.ldl > 160) score -= 25;
    }
    if (labs.hdl !== undefined) {
      if (labs.hdl >= 60) score += 10;
      else if (labs.hdl < 40) score -= 15;
    }
    if (labs.triglycerides !== undefined) {
      if (labs.triglycerides < 100) score += 5;
      else if (labs.triglycerides > 150) score -= 10;
      else if (labs.triglycerides > 200) score -= 20;
    }
    if (labs.bpSystolic !== undefined) {
      if (labs.bpSystolic < 120) score += 5;
      else if (labs.bpSystolic > 140) score -= 15;
    }
    if (labs.restingHr !== undefined) {
      if (labs.restingHr < 65) score += 5;
      else if (labs.restingHr > 80) score -= 5;
    }
    return Math.max(0, Math.min(100, score));
  }

  private scoreMetabolic(labs: Record<string, number>): number {
    let score = 75;
    if (labs.hba1c !== undefined) {
      if (labs.hba1c < 5.4) score += 10;
      else if (labs.hba1c < 5.7) score += 5;
      else if (labs.hba1c > 6.5) score -= 25;
      else if (labs.hba1c > 5.7) score -= 10; // prediabetic
    }
    if (labs.glucose !== undefined) {
      if (labs.glucose < 90) score += 5;
      else if (labs.glucose > 100) score -= 10;
      else if (labs.glucose > 126) score -= 20;
    }
    if (labs.creatinine !== undefined) {
      if (labs.creatinine > 1.3) score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  private scoreSleep(rows: Array<{ data_type: string; value: number }>): number {
    const sleepSamples = rows.filter(r => r.data_type.toLowerCase().includes('sleep') && r.value > 0);
    if (sleepSamples.length === 0) return -1; // no data
    const avgMin = sleepSamples.reduce((s, r) => s + r.value, 0) / sleepSamples.length;
    if (avgMin >= 420) return 90; // 7+ hours
    if (avgMin >= 360) return 75; // 6+ hours
    if (avgMin >= 300) return 50; // 5+ hours
    return 30;
  }

  private scoreActivity(rows: Array<{ data_type: string; value: number }>): number {
    const stepSamples = rows.filter(r => r.data_type.toLowerCase().includes('steps') && r.value > 0);
    if (stepSamples.length === 0) return -1;
    const avgSteps = stepSamples.reduce((s, r) => s + r.value, 0) / stepSamples.length;
    if (avgSteps >= 10000) return 90;
    if (avgSteps >= 7000) return 75;
    if (avgSteps >= 4000) return 50;
    return 30;
  }

  // ── Alert Detection ─────────────────────────────────────────

  private detectAlerts(labs: Record<string, number>): Array<{ severity: string; message: string; metric: string }> {
    const alerts: Array<{ severity: string; message: string; metric: string }> = [];

    if (labs.hba1c !== undefined && labs.hba1c >= 5.7 && labs.hba1c < 6.5) {
      alerts.push({ severity: 'warning', message: `HbA1c ${labs.hba1c}% — prediabetic range (5.7-6.4%). Consider monitoring glucose more closely.`, metric: 'hba1c' });
    }
    if (labs.hba1c !== undefined && labs.hba1c >= 6.5) {
      alerts.push({ severity: 'critical', message: `HbA1c ${labs.hba1c}% — diabetic range (>=6.5%). Consult your physician.`, metric: 'hba1c' });
    }
    if (labs.ldl !== undefined && labs.ldl > 130) {
      alerts.push({ severity: 'warning', message: `LDL ${labs.ldl} mg/dL — above optimal (<100). Consider dietary changes or statin discussion.`, metric: 'ldl' });
    }
    if (labs.hdl !== undefined && labs.hdl < 40) {
      alerts.push({ severity: 'warning', message: `HDL ${labs.hdl} mg/dL — below protective level (>40). Exercise and omega-3 can help.`, metric: 'hdl' });
    }
    if (labs.triglycerides !== undefined && labs.triglycerides > 150) {
      alerts.push({ severity: 'warning', message: `Triglycerides ${labs.triglycerides} mg/dL — elevated (>150). Reduce refined carbs and sugar.`, metric: 'triglycerides' });
    }
    if (labs.glucose !== undefined && labs.glucose > 126) {
      alerts.push({ severity: 'critical', message: `Fasting glucose ${labs.glucose} mg/dL — diabetic range (>126).`, metric: 'glucose' });
    }
    if (labs.creatinine !== undefined && labs.creatinine > 1.3) {
      alerts.push({ severity: 'warning', message: `Creatinine ${labs.creatinine} mg/dL — elevated (>1.3). May indicate kidney stress.`, metric: 'creatinine' });
    }

    return alerts;
  }

  // ── Helpers ─────────────────────────────────────────────────

  private mapToChartKey(dataType: string, value: number): string | null {
    const dt = dataType.toLowerCase();
    if (dt.includes('heart rate') || dt.includes('pulse')) return 'restingHr';
    if (dt.includes('systolic') || (dt.includes('blood pressure') && value > 80)) return 'bpSystolic';
    if (dt.includes('diastolic') || (dt.includes('blood pressure') && value <= 80)) return 'bpDiastolic';
    if (dt.includes('spo2') || dt.includes('oxygen saturation')) return 'spo2';
    if (dt.includes('glucose') && !dt.includes('a1c')) return 'glucose';
    if (dt.includes('hemoglobin a1c') || dt.includes('hba1c') || dt.includes('a1c/hemoglobin')) return 'hba1c';
    if (dt.includes('cholesterol') && !dt.includes('hdl') && !dt.includes('ldl') && !dt.includes('vldl')) return 'cholesterol';
    if (dt.includes('ldl') || dt.includes('low density')) return 'ldl';
    if (dt.includes('hdl') || dt.includes('high density')) return 'hdl';
    if (dt.includes('triglyceride')) return 'triglycerides';
    if (dt.includes('creatinine')) return 'creatinine';
    if (dt.includes('tsh') || dt.includes('thyrotropin')) return 'tsh';
    if (dt.includes('body weight') || (dt.includes('weight') && dt.includes('body'))) return 'weight';
    if (dt.includes('steps')) return 'steps';
    if (dt.includes('sleep') && dt.includes('duration')) return 'sleepMin';
    if (dt.includes('sleep') && dt.includes('score')) return 'sleepScore';
    if (dt.includes('recovery')) return 'recovery';
    if (dt.includes('strain')) return 'strain';
    if (dt.includes('hrv') || dt.includes('heart rate variability')) return 'hrv';
    return null;
  }

  private extractLabValues(rows: Array<{ data_type: string; value: number }>): Record<string, number> {
    const labs: Record<string, number> = {};
    for (const r of rows) {
      const key = this.mapToChartKey(r.data_type, r.value);
      if (key && !labs[key]) labs[key] = r.value; // most recent first
    }
    return labs;
  }

  private interpretLab(key: string, value: number): string {
    const ranges: Record<string, { low?: number; high?: number }> = {
      glucose: { low: 70, high: 100 }, hba1c: { low: 4.0, high: 5.6 },
      cholesterol: { high: 200 }, ldl: { high: 100 }, hdl: { low: 40 },
      triglycerides: { high: 150 }, creatinine: { low: 0.7, high: 1.3 },
      tsh: { low: 0.45, high: 4.5 },
    };
    const range = ranges[key];
    if (!range) return 'normal';
    if (range.high !== undefined && value > range.high) return 'high';
    if (range.low !== undefined && value < range.low) return 'low';
    return 'normal';
  }

  private labCategory(key: string): string {
    const cats: Record<string, string> = {
      glucose: 'metabolic', hba1c: 'metabolic', cholesterol: 'lipids',
      ldl: 'lipids', hdl: 'lipids', triglycerides: 'lipids',
      creatinine: 'kidney', tsh: 'thyroid', restingHr: 'vitals',
      bpSystolic: 'vitals', bpDiastolic: 'vitals', spo2: 'vitals',
    };
    return cats[key] || 'other';
  }
}
