// ============================================================
// Storage Agent v2 -- wraps LocalStore as a proper sub-agent
//
// Provides structured data access for the orchestrator:
// read/write samples, lab grouping by category, conditions,
// medications, allergies, snapshots, and full export.
//
// Uses db.prepare() pattern (better-sqlite3) for all queries.
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus } from './types.js';
import type { LocalStore } from '../storage/local-store.js';

// ── Lab Category Groupings ──────────────────────────────────

const LAB_CATEGORIES: Record<string, string[]> = {
  metabolic: ['glucose', 'hba1c', 'a1c', 'hemoglobin a1c', 'insulin', 'c-peptide'],
  lipids: ['cholesterol', 'ldl', 'hdl', 'triglyceride', 'vldl', 'lipoprotein', 'apolipoprotein'],
  thyroid: ['tsh', 'thyrotropin', 't3', 't4', 'thyroid', 'free t3', 'free t4'],
  kidney: ['creatinine', 'bun', 'egfr', 'urea', 'uric acid', 'albumin/creatinine', 'microalbumin', 'glomerular'],
  liver: ['alt', 'ast', 'alp', 'alkaline phosphatase', 'bilirubin', 'ggt', 'albumin'],
  hematology: ['hemoglobin', 'hematocrit', 'wbc', 'rbc', 'platelet', 'mcv', 'mch', 'mchc', 'rdw', 'neutrophil', 'lymphocyte', 'monocyte', 'eosinophil', 'basophil'],
};

// ── Data type patterns for conditions, medications, allergies

const CONDITION_PATTERNS = ['condition', 'diagnosis', 'problem', 'icd'];
const MEDICATION_PATTERNS = ['medication', 'drug', 'prescription', 'rx', 'med_'];
const ALLERGY_PATTERNS = ['allergy', 'allergen', 'adverse_reaction', 'sensitivity'];

// ── Vital type keywords ─────────────────────────────────────

const VITAL_KEYWORDS = [
  'heart rate', 'heartrate', 'heartrateresting', 'hrv', 'heart rate variability',
  'blood pressure', 'bpsystolic', 'bpdiastolic', 'systolic', 'diastolic',
  'spo2', 'oxygen saturation', 'respiratory rate', 'respiratoryrate',
  'body temperature', 'bodytemperature', 'pulse', 'skin temp', 'skintemp',
];

// ── Raw row types from SQLite ───────────────────────────────

interface RawSampleRow {
  id: string;
  source: string;
  data_type: string;
  value: number;
  unit: string;
  metadata: string | null;
  recorded_at: string;
  synced_at: string | null;
}

interface RawSnapshotRow {
  id: string;
  snapshot_date: string;
  biomarkers: string;
  digital_twin_version: string | null;
  synced_at: string | null;
  created_at: string;
}

// ── Internal database handle type ───────────────────────────

interface PreparedStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface DatabaseHandle {
  prepare(sql: string): PreparedStatement;
}

// ── Lab interpretation reference ranges ─────────────────────

const LAB_INTERPRETATIONS: Record<string, (v: number) => string> = {
  glucose: (v) => v < 70 ? 'Low' : v < 100 ? 'Normal' : v < 126 ? 'Prediabetic' : 'High',
  hba1c: (v) => v < 5.7 ? 'Normal' : v < 6.5 ? 'Prediabetic' : 'Diabetic range',
  a1c: (v) => v < 5.7 ? 'Normal' : v < 6.5 ? 'Prediabetic' : 'Diabetic range',
  ldl: (v) => v < 70 ? 'Optimal' : v < 100 ? 'Near optimal' : v < 130 ? 'Borderline' : 'High',
  hdl: (v) => v >= 60 ? 'Protective' : v >= 40 ? 'Normal' : 'Low',
  triglyceride: (v) => v < 100 ? 'Optimal' : v < 150 ? 'Normal' : v < 200 ? 'Borderline' : 'High',
  cholesterol: (v) => v < 200 ? 'Normal' : v < 240 ? 'Borderline' : 'High',
  creatinine: (v) => v <= 1.3 ? 'Normal' : 'Elevated',
  tsh: (v) => v >= 0.45 && v <= 4.5 ? 'Normal' : v < 0.45 ? 'Low (hyper)' : 'High (hypo)',
  egfr: (v) => v >= 90 ? 'Normal' : v >= 60 ? 'Mild decrease' : 'Moderate decrease',
  alt: (v) => v <= 56 ? 'Normal' : 'Elevated',
  ast: (v) => v <= 40 ? 'Normal' : 'Elevated',
  hemoglobin: (v) => v >= 12 && v <= 17.5 ? 'Normal' : v < 12 ? 'Low' : 'High',
  wbc: (v) => v >= 4.5 && v <= 11.0 ? 'Normal' : v < 4.5 ? 'Low' : 'High',
  platelets: (v) => v >= 150 && v <= 400 ? 'Normal' : v < 150 ? 'Low' : 'High',
  homocysteine: (v) => v < 10 ? 'Optimal' : v < 15 ? 'Normal' : 'Elevated',
  crp: (v) => v <= 1.0 ? 'Optimal' : v <= 3.0 ? 'Normal' : 'Elevated',
  vitamind: (v) => v < 30 ? 'Low' : v <= 100 ? 'Normal' : 'High',
  ferritin: (v) => v < 20 ? 'Low' : v <= 300 ? 'Normal' : 'High',
  b12: (v) => v < 200 ? 'Low' : v <= 900 ? 'Normal' : 'High',
};

// ── Storage Agent ───────────────────────────────────────────

export class StorageAgent implements SubAgent {
  name = 'storage-agent';
  description = 'Local data store access -- read/write samples, labs by category, conditions, medications, allergies, snapshots, export';
  status: AgentStatus = 'idle';

  private store: LocalStore;

  constructor(store: LocalStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    this.status = 'idle';
  }

  async handleMessage(message: AgentMessage): Promise<AgentMessage> {
    this.status = 'running';

    const reply = (type: AgentMessage['type'], payload: Record<string, unknown>): AgentMessage => ({
      ...message,
      from: this.name,
      to: 'orchestrator',
      type,
      payload,
      timestamp: new Date(),
    });

    try {
      switch (message.action) {
        case 'read-samples':
          return reply('result', this.readSamples(message.payload));
        case 'write-samples':
          return reply('result', this.writeSamples(message.payload));
        case 'read-snapshots':
          return reply('result', this.readSnapshots(message.payload));
        case 'get-recent-labs':
          return reply('result', this.getRecentLabs(message.payload));
        case 'get-recent-vitals':
          return reply('result', this.getRecentVitals(message.payload));
        case 'get-conditions':
          return reply('result', this.getConditions(message.payload));
        case 'get-medications':
          return reply('result', this.getMedications(message.payload));
        case 'get-allergies':
          return reply('result', this.getAllergies(message.payload));
        case 'export-all':
          return reply('result', this.exportAll(message.payload));
        default:
          this.status = 'idle';
          return reply('error', { error: `Unknown action: ${message.action}` });
      }
    } catch (err) {
      this.status = 'error';
      return reply('error', { error: String(err) });
    } finally {
      if (this.status === 'running') this.status = 'idle';
    }
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.status = 'idle';
  }

  // ── Database accessor ─────────────────────────────────────

  private get db(): DatabaseHandle {
    return (this.store as unknown as { db: DatabaseHandle }).db;
  }

  // ── read-samples ──────────────────────────────────────────
  // Filters: dataType (string), days (number), limit (number)

  private readSamples(payload: Record<string, unknown>): Record<string, unknown> {
    const dataType = payload.dataType as string | undefined;
    const days = (payload.days as number) ?? 90;
    const limit = (payload.limit as number) ?? 500;

    const cutoff = this.daysAgoISO(days);
    let rows: RawSampleRow[];

    if (dataType) {
      rows = this.db.prepare(`
        SELECT * FROM health_samples
        WHERE data_type LIKE ?
          AND recorded_at >= ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `).all(`%${dataType}%`, cutoff, limit) as RawSampleRow[];
    } else {
      rows = this.db.prepare(`
        SELECT * FROM health_samples
        WHERE recorded_at >= ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `).all(cutoff, limit) as RawSampleRow[];
    }

    return {
      samples: rows.map(r => this.mapSampleRow(r)),
      count: rows.length,
      filters: { dataType: dataType ?? null, days, limit },
    };
  }

  // ── write-samples ─────────────────────────────────────────

  private writeSamples(payload: Record<string, unknown>): Record<string, unknown> {
    const samples = payload.samples as Array<{
      source?: string;
      dataType: string;
      value: number;
      unit: string;
      metadata?: Record<string, unknown>;
      recordedAt: string;
    }>;

    if (!Array.isArray(samples)) {
      return { error: 'payload.samples must be an array', written: 0 };
    }

    let written = 0;
    for (const s of samples) {
      try {
        this.store.insertSample({
          id: Math.random().toString(36).slice(2),
          source: (s.source ?? 'manual') as 'apple_health' | 'google_health' | 'ehr' | 'manual' | 'computed',
          dataType: s.dataType,
          value: s.value,
          unit: s.unit,
          metadata: s.metadata,
          recordedAt: new Date(s.recordedAt),
          syncedAt: new Date(),
        });
        written++;
      } catch {
        // Skip individual sample failures silently
      }
    }

    return { written, requested: samples.length };
  }

  // ── read-snapshots ────────────────────────────────────────

  private readSnapshots(payload: Record<string, unknown>): Record<string, unknown> {
    const days = (payload.days as number) ?? 30;
    const cutoffDate = this.daysAgoDate(days);

    const rows = this.db.prepare(`
      SELECT * FROM biomarker_snapshots
      WHERE snapshot_date >= ?
      ORDER BY snapshot_date DESC
    `).all(cutoffDate) as RawSnapshotRow[];

    return {
      snapshots: rows.map(r => ({
        id: r.id,
        snapshotDate: r.snapshot_date,
        biomarkers: JSON.parse(r.biomarkers),
        digitalTwinVersion: r.digital_twin_version ?? undefined,
        createdAt: r.created_at,
      })),
      count: rows.length,
    };
  }

  // ── get-recent-labs ───────────────────────────────────────
  // Returns labs grouped by category (metabolic, lipids, thyroid,
  // kidney, liver, hematology) with most recent value per test.

  private getRecentLabs(payload: Record<string, unknown>): Record<string, unknown> {
    const days = (payload.days as number) ?? 365;
    const cutoff = this.daysAgoISO(days);

    const rows = this.db.prepare(`
      SELECT data_type, value, unit, metadata, recorded_at, source
      FROM health_samples
      WHERE recorded_at >= ?
      ORDER BY recorded_at DESC
    `).all(cutoff) as Array<{
      data_type: string;
      value: number;
      unit: string;
      metadata: string | null;
      recorded_at: string;
      source: string;
    }>;

    // Group by category, deduplicate to most recent per test name
    const grouped: Record<string, Array<{
      testName: string;
      value: number;
      unit: string;
      date: string;
      source: string;
      interpretation: string;
      metadata: Record<string, unknown> | null;
    }>> = {
      metabolic: [],
      lipids: [],
      thyroid: [],
      kidney: [],
      liver: [],
      hematology: [],
    };

    const seenTests = new Set<string>();

    for (const row of rows) {
      const dt = row.data_type.toLowerCase();

      // Skip non-lab data (vitals, sleep, activity, conditions, meds, allergies)
      if (this.isVitalType(dt)) continue;
      if (this.isSleepOrActivityType(dt)) continue;
      if (this.matchesPatterns(dt, CONDITION_PATTERNS)) continue;
      if (this.matchesPatterns(dt, MEDICATION_PATTERNS)) continue;
      if (this.matchesPatterns(dt, ALLERGY_PATTERNS)) continue;

      // Keep only the most recent value per test name
      if (seenTests.has(dt)) continue;
      seenTests.add(dt);

      const category = this.classifyLabCategory(dt);
      if (!category) continue; // skip tests we cannot classify

      const interp = this.interpretLabValue(dt, row.value);

      grouped[category]!.push({
        testName: row.data_type,
        value: row.value,
        unit: row.unit,
        date: row.recorded_at.split('T')[0] ?? row.recorded_at,
        source: row.source,
        interpretation: interp,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      });
    }

    // Remove empty categories from result
    const labs: Record<string, unknown> = {};
    for (const [cat, items] of Object.entries(grouped)) {
      if (items.length > 0) {
        labs[cat] = items;
      }
    }

    return {
      labs,
      totalTests: seenTests.size,
    };
  }

  // ── get-recent-vitals ─────────────────────────────────────

  private getRecentVitals(payload: Record<string, unknown>): Record<string, unknown> {
    const days = (payload.days as number) ?? 30;
    const limit = (payload.limit as number) ?? 100;
    const cutoff = this.daysAgoISO(days);

    // Build LIKE clauses for vital keywords
    const likeClauses = VITAL_KEYWORDS.map(() => 'LOWER(data_type) LIKE ?').join(' OR ');
    const likeParams = VITAL_KEYWORDS.map(k => `%${k}%`);

    const rows = this.db.prepare(`
      SELECT data_type, value, unit, recorded_at, source
      FROM health_samples
      WHERE recorded_at >= ?
        AND (${likeClauses})
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(cutoff, ...likeParams, limit) as Array<{
      data_type: string;
      value: number;
      unit: string;
      recorded_at: string;
      source: string;
    }>;

    // Deduplicate to most recent per metric type
    const seen = new Set<string>();
    const vitals: Array<{
      metric: string;
      value: number;
      unit: string;
      date: string;
      source: string;
    }> = [];

    for (const r of rows) {
      if (seen.has(r.data_type)) continue;
      seen.add(r.data_type);

      vitals.push({
        metric: r.data_type,
        value: r.value,
        unit: r.unit,
        date: r.recorded_at.split('T')[0] ?? r.recorded_at,
        source: this.friendlySourceName(r.source),
      });
    }

    return { vitals, count: vitals.length };
  }

  // ── get-conditions ────────────────────────────────────────
  // Queries health_samples where data_type matches condition patterns

  private getConditions(_payload: Record<string, unknown>): Record<string, unknown> {
    const likeClauses = CONDITION_PATTERNS.map(() => 'LOWER(data_type) LIKE ?').join(' OR ');
    const likeParams = CONDITION_PATTERNS.map(p => `%${p}%`);

    const rows = this.db.prepare(`
      SELECT data_type, value, unit, metadata, recorded_at, source
      FROM health_samples
      WHERE ${likeClauses}
      ORDER BY recorded_at DESC
    `).all(...likeParams) as Array<{
      data_type: string;
      value: number;
      unit: string;
      metadata: string | null;
      recorded_at: string;
      source: string;
    }>;

    return {
      conditions: rows.map(r => {
        const meta = r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : {};
        return {
          name: (meta.displayName as string) ?? r.data_type,
          icd10: meta.icd10 as string | undefined,
          status: r.value === 1 ? 'active' : 'resolved',
          onsetDate: r.recorded_at.split('T')[0] ?? r.recorded_at,
          source: this.friendlySourceName(r.source),
        };
      }),
      count: rows.length,
    };
  }

  // ── get-medications ───────────────────────────────────────
  // Queries health_samples where data_type matches medication patterns

  private getMedications(_payload: Record<string, unknown>): Record<string, unknown> {
    const likeClauses = MEDICATION_PATTERNS.map(() => 'LOWER(data_type) LIKE ?').join(' OR ');
    const likeParams = MEDICATION_PATTERNS.map(p => `%${p}%`);

    const rows = this.db.prepare(`
      SELECT data_type, value, unit, metadata, recorded_at, source
      FROM health_samples
      WHERE ${likeClauses}
      ORDER BY recorded_at DESC
    `).all(...likeParams) as Array<{
      data_type: string;
      value: number;
      unit: string;
      metadata: string | null;
      recorded_at: string;
      source: string;
    }>;

    return {
      medications: rows.map(r => {
        const meta = r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : {};
        return {
          name: (meta.displayName as string) ?? r.data_type,
          dose: meta.dose as string | undefined,
          frequency: meta.frequency as string | undefined,
          status: r.value === 1 ? 'active' : 'inactive',
          startDate: r.recorded_at.split('T')[0] ?? r.recorded_at,
          source: this.friendlySourceName(r.source),
        };
      }),
      count: rows.length,
    };
  }

  // ── get-allergies ─────────────────────────────────────────
  // Queries health_samples where data_type matches allergy patterns

  private getAllergies(_payload: Record<string, unknown>): Record<string, unknown> {
    const likeClauses = ALLERGY_PATTERNS.map(() => 'LOWER(data_type) LIKE ?').join(' OR ');
    const likeParams = ALLERGY_PATTERNS.map(p => `%${p}%`);

    const rows = this.db.prepare(`
      SELECT data_type, value, unit, metadata, recorded_at, source
      FROM health_samples
      WHERE ${likeClauses}
      ORDER BY recorded_at DESC
    `).all(...likeParams) as Array<{
      data_type: string;
      value: number;
      unit: string;
      metadata: string | null;
      recorded_at: string;
      source: string;
    }>;

    return {
      allergies: rows.map(r => {
        const meta = r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : {};
        return {
          name: (meta.displayName as string) ?? r.data_type,
          type: meta.type as string | undefined,
          severity: meta.severity as string | undefined,
          source: this.friendlySourceName(r.source),
        };
      }),
      count: rows.length,
    };
  }

  // ── export-all ────────────────────────────────────────────
  // Full data export: samples, snapshots, nutrition logs

  private exportAll(payload: Record<string, unknown>): Record<string, unknown> {
    const days = (payload.days as number) ?? 90;
    const cutoff = this.daysAgoISO(days);
    const cutoffDate = this.daysAgoDate(days);

    const samples = this.db.prepare(`
      SELECT * FROM health_samples
      WHERE recorded_at >= ?
      ORDER BY recorded_at DESC
    `).all(cutoff) as RawSampleRow[];

    const snapshots = this.db.prepare(`
      SELECT * FROM biomarker_snapshots
      WHERE snapshot_date >= ?
      ORDER BY snapshot_date DESC
    `).all(cutoffDate) as RawSnapshotRow[];

    const nutrition = this.db.prepare(`
      SELECT * FROM nutrition_logs
      WHERE logged_at >= ?
      ORDER BY logged_at DESC
    `).all(cutoff) as Array<Record<string, unknown>>;

    const sampleCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM health_samples'
    ).get() as { count: number };

    const sourceBreakdown = this.db.prepare(
      'SELECT source, COUNT(*) as count FROM health_samples GROUP BY source'
    ).all() as Array<{ source: string; count: number }>;

    return {
      exportDate: new Date().toISOString(),
      days,
      stats: {
        totalSamples: sampleCount.count,
        bySource: sourceBreakdown,
      },
      samples: {
        data: samples.map(r => this.mapSampleRow(r)),
        count: samples.length,
      },
      snapshots: {
        data: snapshots.map(r => ({
          id: r.id,
          snapshotDate: r.snapshot_date,
          biomarkers: JSON.parse(r.biomarkers),
          digitalTwinVersion: r.digital_twin_version ?? undefined,
          createdAt: r.created_at,
        })),
        count: snapshots.length,
      },
      nutrition: {
        data: nutrition,
        count: nutrition.length,
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  private mapSampleRow(row: RawSampleRow): Record<string, unknown> {
    return {
      id: row.id,
      source: row.source,
      dataType: row.data_type,
      value: row.value,
      unit: row.unit,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      recordedAt: row.recorded_at,
      syncedAt: row.synced_at,
    };
  }

  private classifyLabCategory(dataType: string): string | null {
    const dt = dataType.toLowerCase();
    for (const [category, keywords] of Object.entries(LAB_CATEGORIES)) {
      for (const keyword of keywords) {
        if (dt.includes(keyword)) {
          // Avoid classifying hemoglobin A1c as hematology
          if (category === 'hematology' && (dt.includes('a1c') || dt.includes('glyc'))) {
            return 'metabolic';
          }
          return category;
        }
      }
    }
    return null;
  }

  private interpretLabValue(dataType: string, value: number): string {
    const dt = dataType.toLowerCase();
    for (const [key, fn] of Object.entries(LAB_INTERPRETATIONS)) {
      if (dt.includes(key)) return fn(value);
    }
    return 'See reference range';
  }

  private matchesPatterns(value: string, patterns: string[]): boolean {
    return patterns.some(p => value.includes(p));
  }

  private isVitalType(dt: string): boolean {
    return VITAL_KEYWORDS.some(k => dt.includes(k));
  }

  private isSleepOrActivityType(dt: string): boolean {
    const keywords = [
      'sleep', 'rem', 'deep_sleep', 'light_sleep',
      'steps', 'calories', 'strain', 'recovery', 'active_min',
      'vo2', 'distance', 'workout',
    ];
    return keywords.some(k => dt.includes(k));
  }

  private friendlySourceName(source: string): string {
    switch (source) {
      case 'ehr': return 'Health Records';
      case 'wearable': return 'Wearable';
      case 'apple_health': return 'Apple Health';
      case 'google_health': return 'Google Health';
      case 'manual': return 'Manual Entry';
      case 'computed': return 'Computed';
      default: return source;
    }
  }

  private daysAgoISO(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  private daysAgoDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0]!;
  }
}
