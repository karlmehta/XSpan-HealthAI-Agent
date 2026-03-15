import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import type {
  HealthSample,
  BiomarkerSnapshot,
  BiomarkerVector,
  NutritionEntry,
  XSpanNudge,
  HealthPassport,
  SyncLogEntry,
} from '../types/index.js';

// ── SQLite Local Store ──────────────────────────────────────────

export class LocalStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbPath = join(dataDir, 'xspan.db');
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Apply encryption key if set (requires better-sqlite3 with sqlcipher)
    const encKey = process.env.XSPAN_DB_ENCRYPTION_KEY;
    if (encKey) {
      this.db.pragma(`key = '${encKey}'`);
    }

    this.migrate();
  }

  // ── Migrations ──────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_samples (
        id            TEXT PRIMARY KEY,
        source        TEXT NOT NULL,
        data_type     TEXT NOT NULL,
        value         REAL NOT NULL,
        unit          TEXT NOT NULL,
        metadata      TEXT,
        recorded_at   TEXT NOT NULL,
        synced_at     TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_samples_type_date
        ON health_samples(data_type, recorded_at DESC);

      CREATE TABLE IF NOT EXISTS nutrition_logs (
        id            TEXT PRIMARY KEY,
        description   TEXT NOT NULL,
        meal_type     TEXT NOT NULL,
        logged_at     TEXT NOT NULL,
        synced_at     TEXT,
        nutrients     TEXT NOT NULL,
        foods         TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nutrition_date
        ON nutrition_logs(logged_at DESC);

      CREATE TABLE IF NOT EXISTS biomarker_snapshots (
        id                    TEXT PRIMARY KEY,
        snapshot_date         TEXT NOT NULL,
        biomarkers            TEXT NOT NULL,
        digital_twin_version  TEXT,
        synced_at             TEXT,
        created_at            TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_date
        ON biomarker_snapshots(snapshot_date DESC);

      CREATE TABLE IF NOT EXISTS nudges (
        id              TEXT PRIMARY KEY,
        content         TEXT NOT NULL,
        category        TEXT NOT NULL,
        priority        INTEGER NOT NULL,
        deep_dive       TEXT,
        action_items    TEXT,
        related_biomarkers TEXT,
        follow_up_at    TEXT,
        received_at     TEXT NOT NULL,
        delivered_at    TEXT,
        acknowledged_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_nudges_received
        ON nudges(received_at DESC);

      CREATE TABLE IF NOT EXISTS health_passports (
        id              TEXT PRIMARY KEY,
        week_ending     TEXT NOT NULL,
        overall_score   REAL NOT NULL,
        sections        TEXT NOT NULL,
        risk_scores     TEXT NOT NULL,
        recommendations TEXT NOT NULL,
        pdf_url         TEXT,
        generated_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_passports_week
        ON health_passports(week_ending DESC);

      CREATE TABLE IF NOT EXISTS sync_log (
        id              TEXT PRIMARY KEY,
        sync_type       TEXT NOT NULL,
        status          TEXT NOT NULL,
        records_synced  INTEGER NOT NULL DEFAULT 0,
        error           TEXT,
        started_at      TEXT NOT NULL,
        completed_at    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_log_date
        ON sync_log(started_at DESC);
    `);
  }

  // ── Health Samples ──────────────────────────────────────────────

  getLatestSample(dataType: string): HealthSample | null {
    const row = this.db.prepare(`
      SELECT * FROM health_samples
      WHERE data_type = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `).get(dataType) as RawSampleRow | undefined;

    return row ? this.mapSampleRow(row) : null;
  }

  getSamples(opts: { dataType: string; from: Date; to: Date }): HealthSample[] {
    const rows = this.db.prepare(`
      SELECT * FROM health_samples
      WHERE data_type = ?
        AND recorded_at >= ?
        AND recorded_at <= ?
      ORDER BY recorded_at DESC
    `).all(opts.dataType, opts.from.toISOString(), opts.to.toISOString()) as RawSampleRow[];

    return rows.map(r => this.mapSampleRow(r));
  }

  insertSample(sample: HealthSample): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO health_samples
        (id, source, data_type, value, unit, metadata, recorded_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sample.id || randomUUID(),
      sample.source,
      sample.dataType,
      sample.value,
      sample.unit,
      sample.metadata ? JSON.stringify(sample.metadata) : null,
      sample.recordedAt.toISOString(),
      sample.syncedAt?.toISOString() ?? new Date().toISOString(),
    );
  }

  // ── Biomarker Snapshots ─────────────────────────────────────────

  getLatestSnapshot(): BiomarkerSnapshot | null {
    const row = this.db.prepare(`
      SELECT * FROM biomarker_snapshots
      ORDER BY snapshot_date DESC
      LIMIT 1
    `).get() as RawSnapshotRow | undefined;

    return row ? this.mapSnapshotRow(row) : null;
  }

  getSnapshots(days: number): BiomarkerSnapshot[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const rows = this.db.prepare(`
      SELECT * FROM biomarker_snapshots
      WHERE snapshot_date >= ?
      ORDER BY snapshot_date DESC
    `).all(cutoff.toISOString().split('T')[0]!) as RawSnapshotRow[];

    return rows.map(r => this.mapSnapshotRow(r));
  }

  insertSnapshot(snapshot: BiomarkerSnapshot): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO biomarker_snapshots
        (id, snapshot_date, biomarkers, digital_twin_version, synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id || randomUUID(),
      snapshot.snapshotDate,
      JSON.stringify(snapshot.biomarkers),
      snapshot.digitalTwinVersion ?? null,
      snapshot.syncedAt?.toISOString() ?? null,
      snapshot.createdAt.toISOString(),
    );
  }

  // ── Nutrition ───────────────────────────────────────────────────

  insertNutritionEntry(entry: NutritionEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO nutrition_logs
        (id, description, meal_type, logged_at, synced_at, nutrients, foods)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id || randomUUID(),
      entry.description,
      entry.mealType,
      entry.loggedAt.toISOString(),
      entry.syncedAt?.toISOString() ?? null,
      JSON.stringify(entry.nutrients),
      JSON.stringify(entry.foods),
    );
  }

  getNutritionEntries(from: Date, to: Date): NutritionEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM nutrition_logs
      WHERE logged_at >= ? AND logged_at <= ?
      ORDER BY logged_at DESC
    `).all(from.toISOString(), to.toISOString()) as RawNutritionRow[];

    return rows.map(r => this.mapNutritionRow(r));
  }

  // ── Nudges ──────────────────────────────────────────────────────

  insertNudge(nudge: XSpanNudge): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO nudges
        (id, content, category, priority, deep_dive, action_items,
         related_biomarkers, follow_up_at, received_at, delivered_at, acknowledged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nudge.id || randomUUID(),
      nudge.content,
      nudge.category,
      nudge.priority,
      nudge.deepDive ?? null,
      nudge.actionItems ? JSON.stringify(nudge.actionItems) : null,
      nudge.relatedBiomarkers ? JSON.stringify(nudge.relatedBiomarkers) : null,
      nudge.followUpAt ?? null,
      nudge.receivedAt,
      nudge.deliveredAt ?? null,
      nudge.acknowledgedAt ?? null,
    );
  }

  getUnacknowledgedNudges(): XSpanNudge[] {
    const rows = this.db.prepare(`
      SELECT * FROM nudges
      WHERE acknowledged_at IS NULL
      ORDER BY received_at DESC
    `).all() as RawNudgeRow[];

    return rows.map(r => this.mapNudgeRow(r));
  }

  getTodayNudges(): XSpanNudge[] {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = this.db.prepare(`
      SELECT * FROM nudges
      WHERE received_at >= ?
      ORDER BY received_at DESC
    `).all(todayStart.toISOString()) as RawNudgeRow[];

    return rows.map(r => this.mapNudgeRow(r));
  }

  // ── Health Passports ────────────────────────────────────────────

  getLatestPassport(): HealthPassport | null {
    const row = this.db.prepare(`
      SELECT * FROM health_passports
      ORDER BY week_ending DESC
      LIMIT 1
    `).get() as RawPassportRow | undefined;

    return row ? this.mapPassportRow(row) : null;
  }

  insertPassport(passport: HealthPassport): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO health_passports
        (id, week_ending, overall_score, sections, risk_scores, recommendations, pdf_url, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      passport.id || randomUUID(),
      passport.weekEnding,
      passport.overallScore,
      JSON.stringify(passport.sections),
      JSON.stringify(passport.riskScores),
      JSON.stringify(passport.recommendations),
      passport.pdfUrl ?? null,
      passport.generatedAt,
    );
  }

  // ── Sync Log ────────────────────────────────────────────────────

  logSync(entry: SyncLogEntry): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sync_log
        (id, sync_type, status, records_synced, error, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id || randomUUID(),
      entry.syncType,
      entry.status,
      entry.recordsSynced,
      entry.error ?? null,
      entry.startedAt.toISOString(),
      entry.completedAt?.toISOString() ?? null,
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  // ── Row Mapping Helpers ─────────────────────────────────────────

  private mapSampleRow(row: RawSampleRow): HealthSample {
    return {
      id: row.id,
      source: row.source as HealthSample['source'],
      dataType: row.data_type,
      value: row.value,
      unit: row.unit,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      recordedAt: new Date(row.recorded_at),
      syncedAt: row.synced_at ? new Date(row.synced_at) : undefined,
    };
  }

  private mapSnapshotRow(row: RawSnapshotRow): BiomarkerSnapshot {
    return {
      id: row.id,
      snapshotDate: row.snapshot_date,
      biomarkers: JSON.parse(row.biomarkers) as BiomarkerVector,
      digitalTwinVersion: row.digital_twin_version ?? undefined,
      syncedAt: row.synced_at ? new Date(row.synced_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private mapNutritionRow(row: RawNutritionRow): NutritionEntry {
    return {
      id: row.id,
      description: row.description,
      mealType: row.meal_type as NutritionEntry['mealType'],
      loggedAt: new Date(row.logged_at),
      syncedAt: row.synced_at ? new Date(row.synced_at) : undefined,
      nutrients: JSON.parse(row.nutrients),
      foods: JSON.parse(row.foods),
    };
  }

  private mapNudgeRow(row: RawNudgeRow): XSpanNudge {
    return {
      id: row.id,
      content: row.content,
      category: row.category as XSpanNudge['category'],
      priority: row.priority as 1 | 2 | 3,
      deepDive: row.deep_dive ?? undefined,
      actionItems: row.action_items ? JSON.parse(row.action_items) : undefined,
      relatedBiomarkers: row.related_biomarkers ? JSON.parse(row.related_biomarkers) : undefined,
      followUpAt: row.follow_up_at ?? undefined,
      receivedAt: row.received_at,
      deliveredAt: row.delivered_at ?? undefined,
      acknowledgedAt: row.acknowledged_at ?? undefined,
    };
  }

  private mapPassportRow(row: RawPassportRow): HealthPassport {
    return {
      id: row.id,
      weekEnding: row.week_ending,
      overallScore: row.overall_score,
      sections: JSON.parse(row.sections),
      riskScores: JSON.parse(row.risk_scores),
      recommendations: JSON.parse(row.recommendations),
      pdfUrl: row.pdf_url ?? undefined,
      generatedAt: row.generated_at,
    };
  }
}

// ── Raw Row Types (SQLite column names) ───────────────────────────

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

interface RawNutritionRow {
  id: string;
  description: string;
  meal_type: string;
  logged_at: string;
  synced_at: string | null;
  nutrients: string;
  foods: string;
}

interface RawNudgeRow {
  id: string;
  content: string;
  category: string;
  priority: number;
  deep_dive: string | null;
  action_items: string | null;
  related_biomarkers: string | null;
  follow_up_at: string | null;
  received_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
}

interface RawPassportRow {
  id: string;
  week_ending: string;
  overall_score: number;
  sections: string;
  risk_scores: string;
  recommendations: string;
  pdf_url: string | null;
  generated_at: string;
}
