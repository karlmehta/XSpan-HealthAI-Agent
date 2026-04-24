// ============================================================
// MyHealthSpan Agent — Agentic Architecture Type Definitions
// Orchestrator + Sub-Agents pattern
// ============================================================

/** Message passed between agents */
export interface AgentMessage {
  id: string;
  from: string;        // agent name
  to: string;          // target agent or 'orchestrator'
  type: 'command' | 'data' | 'status' | 'error' | 'result';
  action: string;      // e.g., 'sync', 'analyze', 'summarize'
  payload: Record<string, unknown>;
  timestamp: Date;
  traceId: string;     // for tracking across agents
}

/** Agent status */
export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';

/** Base interface all sub-agents implement */
export interface SubAgent {
  name: string;
  description: string;
  status: AgentStatus;

  /** Initialize the agent */
  initialize(): Promise<void>;

  /** Handle a message from the orchestrator */
  handleMessage(message: AgentMessage): Promise<AgentMessage>;

  /** Get agent health/status */
  getStatus(): AgentStatus;

  /** Shutdown gracefully */
  shutdown(): Promise<void>;
}

/** Health data normalized across all sources */
export interface NormalizedHealthData {
  vitals: VitalRecord[];
  sleep: SleepRecord[];
  activity: ActivityRecord[];
  labs: LabRecord[];
  conditions: ConditionRecord[];
  medications: MedicationRecord[];
  allergies: AllergyRecord[];
  immunizations: ImmunizationRecord[];
}

export interface VitalRecord {
  date: string;
  heartRate?: number;
  heartRateResting?: number;
  hrv?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  spo2?: number;
  respiratoryRate?: number;
  bodyTemperature?: number;
  glucose?: number;
  source: string;
}

export interface SleepRecord {
  date: string;
  totalMin: number;
  deepMin?: number;
  remMin?: number;
  lightMin?: number;
  awakeMin?: number;
  efficiency?: number;
  score?: number;
  avgHr?: number;
  avgHrv?: number;
  avgSpo2?: number;
  avgRespRate?: number;
  skinTempDev?: number;
  source: string;
}

export interface ActivityRecord {
  date: string;
  steps?: number;
  distanceM?: number;
  caloriesActive?: number;
  caloriesTotal?: number;
  activeMin?: number;
  moderateMin?: number;
  vigorousMin?: number;
  strain?: number;
  recovery?: number;
  readiness?: number;
  vo2Max?: number;
  source: string;
}

export interface LabRecord {
  date: string;
  testName: string;
  loincCode?: string;
  value: number;
  unit: string;
  referenceRange?: { low?: number; high?: number };
  interpretation?: string;
  category: string;     // metabolic, lipids, thyroid, etc.
  source: string;
}

export interface ConditionRecord {
  name: string;
  icd10?: string;
  status: string;       // active, resolved
  onsetDate?: string;
  source: string;
}

export interface MedicationRecord {
  name: string;
  dose?: string;
  frequency?: string;
  status: string;
  startDate?: string;
  source: string;
}

export interface AllergyRecord {
  name: string;
  type?: string;        // food, medication, environment
  severity?: string;
  source: string;
}

export interface ImmunizationRecord {
  name: string;
  date: string;
  doseNumber?: number;
  source: string;
}

/** Daily health summary produced by the Summary Agent */
export interface DailyHealthSummary {
  date: string;
  generatedAt: string;

  // Headline
  headline: string;             // "Good recovery day. HRV trending up."
  overallScore: number;         // 0-100

  // Category scores
  cardiovascular: { score: number; summary: string; dataPoints: string[] };
  metabolic: { score: number; summary: string; dataPoints: string[] };
  sleep: { score: number; summary: string; dataPoints: string[] };
  activity: { score: number; summary: string; dataPoints: string[] };

  // Key metrics (most recent)
  keyMetrics: Array<{
    label: string;
    value: string;
    unit: string;
    trend: 'up' | 'down' | 'stable';
    status: 'good' | 'warning' | 'concern';
  }>;

  // Alerts
  alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    message: string;
    metric?: string;
    action?: string;
  }>;

  // Data sources used
  sources: string[];
}

/** Chart data for the Insights dashboard */
export interface ChartDataSet {
  labels: string[];                          // dates (MM-DD)
  series: Record<string, (number | null)[]>; // metric name → values
}
