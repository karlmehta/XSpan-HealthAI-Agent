// ============================================================
// XSpan AI Agent — Core TypeScript Types
// ============================================================

// ── Data Sources ─────────────────────────────────────────────

export type DataSource = 'apple_health' | 'google_health' | 'ehr' | 'manual' | 'computed';

export type EHRProvider = 'epic' | 'cerner' | 'redox' | 'generic_fhir';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type NudgeCategory =
  | 'sleep_optimization'
  | 'nutrition_guidance'
  | 'movement_reminder'
  | 'stress_management'
  | 'hydration'
  | 'medication_adherence'
  | 'preventive_screening'
  | 'lab_followup'
  | 'positive_reinforcement';

// ── Health Samples ────────────────────────────────────────────

export interface HealthSample {
  id: string;
  source: DataSource;
  dataType: string;
  value: number;
  unit: string;
  metadata?: Record<string, unknown>;
  recordedAt: Date;
  syncedAt?: Date;
}

export interface SleepRecord {
  date: string;                // YYYY-MM-DD
  totalMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  awakeMinutes: number;
  efficiency: number;          // 0-100
  onsetLatency: number;        // minutes to fall asleep
  hrv?: number;                // overnight HRV
  restingHeartRate?: number;
}

export interface WorkoutRecord {
  id: string;
  activityType: string;
  durationMinutes: number;
  activeCalories: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  distance?: number;           // meters
  startTime: Date;
  endTime: Date;
  source: DataSource;
}

// ── Nutrition ─────────────────────────────────────────────────

export interface FoodItem {
  name: string;
  quantity: number;
  unit: string;
  fdcId?: string;              // USDA FoodData Central ID
}

export interface NutritionEntry {
  id: string;
  description: string;
  mealType: MealType;
  loggedAt: Date;
  syncedAt?: Date;
  nutrients: {
    calories: number;
    protein: number;           // grams
    carbs: number;             // grams
    fat: number;               // grams
    fiber: number;             // grams
    sugar?: number;            // grams
    sodium?: number;           // mg
    water?: number;            // ml
    vitaminC?: number;         // mg
    vitaminD?: number;         // IU
    calcium?: number;          // mg
    iron?: number;             // mg
    potassium?: number;        // mg
  };
  foods: FoodItem[];
}

export interface NutritionAverages {
  days: number;
  avgDailyCalories: number;
  avgProteinGrams: number;
  avgCarbGrams: number;
  avgFatGrams: number;
  avgFiberGrams: number;
  avgWaterMl: number;
  avgSodiumMg?: number;
}

// ── Biomarkers ────────────────────────────────────────────────

export interface BiomarkerVector {
  // Cardiovascular
  restingHeartRate?: number;
  heartRateVariability?: number;     // SDNN in ms
  bloodPressureSystolic?: number;    // mmHg
  bloodPressureDiastolic?: number;   // mmHg
  vo2Max?: number;                   // mL/kg/min

  // Metabolic
  bloodGlucoseFasting?: number;      // mg/dL
  bloodGlucosePostMeal?: number;     // mg/dL
  bodyMassIndex?: number;
  bodyFatPercentage?: number;
  waistCircumference?: number;       // cm
  bodyMassKg?: number;

  // Sleep
  totalSleepMinutes?: number;
  deepSleepMinutes?: number;
  remSleepMinutes?: number;
  sleepEfficiency?: number;          // 0-100
  sleepOnsetLatency?: number;        // minutes

  // Activity
  dailySteps?: number;
  activeMinutes?: number;
  activeCalories?: number;
  exerciseSessionsPerWeek?: number;

  // Nutrition (7-day averages)
  avgDailyCalories?: number;
  avgProteinGrams?: number;
  avgCarbGrams?: number;
  avgFatGrams?: number;
  avgFiberGrams?: number;
  avgWaterMl?: number;

  // Labs (from EHR, when available)
  hba1c?: number;                    // %
  ldlCholesterol?: number;           // mg/dL
  hdlCholesterol?: number;           // mg/dL
  triglycerides?: number;            // mg/dL
  tshThyroid?: number;               // mIU/L
  vitaminD?: number;                 // ng/mL
  ferritin?: number;                 // ng/mL
  creatinine?: number;               // mg/dL
  egfr?: number;                     // mL/min/1.73m²
  alt?: number;                      // U/L
  ast?: number;                      // U/L
  crp?: number;                      // mg/L (C-reactive protein)
  homocysteine?: number;             // μmol/L

  // Stress & Recovery
  stressIndex?: number;              // 0-100 derived score
  recoveryScore?: number;            // 0-100 derived score
  mindfulnessMinutes?: number;

  // Computed Risk Scores (from H-LLM response)
  cardiovascularRisk?: number;       // 0-100
  metabolicRisk?: number;
  sleepDisorderRisk?: number;
  burnoutRisk?: number;

  // Genomics (optional, from file upload)
  genomeRiskVariants?: Record<string, number>;

  // Metadata
  snapshotDate: string;              // ISO date YYYY-MM-DD
  dataCompleteness: number;          // 0-1
}

export interface BiomarkerSnapshot {
  id: string;
  snapshotDate: string;
  biomarkers: BiomarkerVector;
  digitalTwinVersion?: string;
  syncedAt?: Date;
  createdAt: Date;
}

// ── XSpan Cloud API Types ─────────────────────────────────────

export interface XSpanSyncResponse {
  syncId: string;
  digitalTwinUpdated: boolean;
  nextNudgeAt: string;             // ISO datetime
  message?: string;
}

export interface XSpanNudge {
  id: string;
  content: string;                 // max 280 chars
  category: NudgeCategory;
  priority: 1 | 2 | 3;
  deepDive?: string;               // extended explanation
  actionItems?: string[];
  relatedBiomarkers?: string[];
  followUpAt?: string;             // ISO datetime
  receivedAt: string;              // ISO datetime
  deliveredAt?: string;
  acknowledgedAt?: string;
}

export interface HealthAnswer {
  answer: string;
  confidence: number;              // 0-1
  citations?: string[];
  followUps?: string[];
}

export interface RiskScore {
  category: string;
  score: number;                   // 0-100 (higher = higher risk)
  trend: 'improving' | 'stable' | 'declining';
  factors: string[];
  updatedAt: string;
}

// ── Health Passport ───────────────────────────────────────────

export interface PassportSection {
  title: string;
  score?: number;                  // 0-100
  insights: string[];
  metrics: Record<string, number | string>;
}

export interface HealthPassport {
  id: string;
  weekEnding: string;              // ISO date (Sunday)
  overallScore: number;            // 0-100
  sections: PassportSection[];
  riskScores: RiskScore[];
  recommendations: string[];
  pdfUrl?: string;
  generatedAt: string;
}

// ── Storage Types ─────────────────────────────────────────────

export interface SyncLogEntry {
  id: string;
  syncType: string;
  status: 'running' | 'success' | 'error';
  recordsSynced: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface SyncResult {
  newRecords: number;
  connectorResults: Record<string, number>;
  biomarkerVector?: BiomarkerVector;
  errors: string[];
}

// ── Configuration ─────────────────────────────────────────────

export interface AgentConfig {
  xspan: {
    apiKey: string;
    userId: string;
    apiUrl: string;
  };
  connectors: {
    appleHealth: {
      enabled: boolean;
    };
    googleHealth: {
      enabled: boolean;
      clientId?: string;
      clientSecret?: string;
      oauthPort: number;
    };
    ehr: {
      enabled: boolean;
      provider?: EHRProvider;
      fhirBaseUrl?: string;
      clientId?: string;
      oauthPort: number;
    };
  };
  schedules: {
    nudgeMorning: string;
    nudgeMidday: string;
    nudgeEvening: string;
    passportGeneration: string;
    syncIntervalMinutes: number;
    cloudSyncIntervalMinutes: number;
  };
  storage: {
    dataDir: string;
    passportDir: string;
  };
  notifications: {
    enabled: boolean;
    webhookUrl?: string;
  };
  // HIPAA: No MCP server — health data never exposed to third-party AI tools
  // All queries processed exclusively by XSpan's HIPAA-compliant H-LLM
}

// ── Apple Health Bridge Types ─────────────────────────────────

export type AppleHealthDataType =
  | 'stepCount'
  | 'distanceWalkingRunning'
  | 'heartRate'
  | 'heartRateVariabilitySDNN'
  | 'restingHeartRate'
  | 'oxygenSaturation'
  | 'respiratoryRate'
  | 'bodyTemperature'
  | 'bloodPressureSystolic'
  | 'bloodPressureDiastolic'
  | 'bodyMass'
  | 'bodyFatPercentage'
  | 'leanBodyMass'
  | 'bmi'
  | 'activeEnergyBurned'
  | 'basalEnergyBurned'
  | 'sleepAnalysis'
  | 'mindfulSession'
  | 'vo2Max'
  | 'bloodGlucose'
  | 'dietaryEnergyConsumed'
  | 'dietaryProtein'
  | 'dietaryCarbohydrates'
  | 'dietaryFatTotal'
  | 'dietaryFiber'
  | 'dietaryWater';

export interface AppleHealthRawSample {
  id: string;
  type: string;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  source: string;
  metadata?: Record<string, unknown>;
}

// ── HIPAA Compliance ─────────────────────────────────────────
// No MCP tool schemas — health data is not exposed to external AI tools.
// All health queries are processed by XSpan's HIPAA-compliant H-LLM.
// Users interact with their health data exclusively through xspan.ai
