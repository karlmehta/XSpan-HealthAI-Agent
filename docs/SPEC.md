# XSpan AI Agent — Technical Specification

**Version:** 1.0.0  
**Status:** Draft for Implementation  
**Author:** XSpan Engineering  
**Last Updated:** 2025

---

## 1. Overview

### 1.1 Purpose

XSpan AI Agent is an autonomous, open-source health intelligence agent that:

1. Runs persistently on a user's laptop as a background daemon
2. Ingests health data from Apple Health, Google Health, EHR systems, and manual nutrition input
3. Normalizes and synthesizes 100+ biomarkers into a Digital Twin profile
4. Syncs synthesized data to the XSpan cloud (H-LLM engine) via encrypted REST API
5. Receives and delivers personalized health nudges 3× per day
6. Generates a weekly Health Passport (PDF + JSON)
7. Exposes all functionality as an MCP (Model Context Protocol) server for AI assistant integration

### 1.2 Design Principles

- **Local-First:** All raw health data is stored locally. Only normalized biomarker vectors are transmitted to XSpan cloud.
- **Privacy-by-Design:** Data minimization, encryption at rest (AES-256), TLS 1.3 in transit.
- **Open Standards:** FHIR R4, HL7, OAuth 2.0, PKCE, MCP v1.0.
- **Developer-Friendly:** TypeScript, fully typed, tested, documented for open-source contributors.
- **No Mobile Required:** Complete functionality from laptop; no companion app needed.

---

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────── XSpan Agent (Local) ─────────────────────┐
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Connectors │   │  Data Store  │   │   MCP Server    │  │
│  │             │   │  (SQLite +   │   │  (stdio/tcp)    │  │
│  │ • Apple Hlth│──►│   encrypted) │◄──│                 │  │
│  │ • Google Fit│   │              │   │  Tools exposed: │  │
│  │ • EHR/FHIR  │   │  ~/.xspan/   │   │  • get_summary  │  │
│  │ • Nutrition  │   │  data/       │   │  • log_food     │  │
│  └─────────────┘   └──────┬───────┘   │  • get_passport │  │
│                           │           │  • ask_health   │  │
│  ┌─────────────────────────▼────────┐  └─────────────────┘  │
│  │         Agent Orchestrator       │                        │
│  │                                  │                        │
│  │  • Data pipeline (ETL)           │                        │
│  │  • Biomarker normalization       │                        │
│  │  • Sync scheduler                │                        │
│  │  • Nudge scheduler (3×/day)      │                        │
│  │  • Passport builder (weekly)     │                        │
│  └──────────────────┬───────────────┘                        │
└─────────────────────┼──────────────────────────────────────--┘
                      │ HTTPS REST (TLS 1.3)
                      │ Payload: normalized biomarker vectors only
                      ▼
          ┌───────────────────────────┐
          │      XSpan Cloud API      │
          │                           │
          │  POST /v1/sync            │ ← biomarker upload
          │  GET  /v1/nudges          │ → nudge retrieval
          │  GET  /v1/passport/latest │ → passport download
          │  POST /v1/digital-twin    │ ← twin synthesis trigger
          │  POST /v1/ask             │ ← natural language query
          └───────────────────────────┘
```

### 2.2 Data Flow

```
Raw Sources → Connectors → Local SQLite → Normalizer → Sync → XSpan H-LLM
                                    ↑                            ↓
                               MCP Server ←──────── Nudges / Passport
```

---

## 3. Module Specifications

### 3.1 Connectors

#### 3.1.1 Apple Health Connector (`src/connectors/apple-health.ts`)

**Platform:** macOS ≥ 13 only

**Mechanism:** 
- Uses a bundled Swift CLI binary (`scripts/apple-health-bridge/AppleHealthBridge`) that reads HealthKit data on macOS
- The TypeScript connector spawns this binary as a subprocess and parses JSON output
- Binary must be code-signed with the `com.apple.developer.healthkit` entitlement

**Data Types Read:**
```typescript
type AppleHealthDataType =
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
```

**Sync Frequency:** Every 15 minutes when agent is running.

**Interface:**
```typescript
interface AppleHealthConnector {
  isAvailable(): Promise<boolean>;
  requestPermissions(types: AppleHealthDataType[]): Promise<boolean>;
  queryRecent(type: AppleHealthDataType, hours?: number): Promise<HealthSample[]>;
  querySleep(date: Date): Promise<SleepRecord>;
  queryWorkouts(since: Date): Promise<WorkoutRecord[]>;
}
```

#### 3.1.2 Google Health Connector (`src/connectors/google-health.ts`)

**Mechanism:** Google Fit REST API v1 + Google OAuth2 PKCE flow  
**Fallback:** Google Health Connect API (Android Data)  

**OAuth2 Flow:**
1. Agent opens local HTTP server on port 9876 for callback
2. Launches browser to Google OAuth2 consent screen
3. Captures authorization code on callback
4. Exchanges for tokens (stored encrypted in local store)
5. Refreshes automatically before expiry

**Data Sources (Google Fit Data Types):**
```
com.google.step_count.delta
com.google.calories.expended
com.google.heart_rate.bpm
com.google.sleep.segment
com.google.activity.segment
com.google.weight
com.google.oxygen_saturation
com.google.blood_glucose
com.google.blood_pressure
```

#### 3.1.3 EHR Connector (`src/connectors/ehr-connector.ts`)

**Protocol:** SMART on FHIR R4 (HL7)  
**Supported Providers:**
- Epic (via Epic SMART on FHIR)
- Cerner (via Cerner Ignite FHIR)
- Redox (via Redox FHIR API)
- Generic FHIR R4 endpoint

**FHIR Resources Fetched:**
```
Patient           → demographics
Observation       → lab results, vitals
Condition         → diagnoses, chronic conditions
MedicationRequest → current medications
AllergyIntolerance → allergies
Immunization      → vaccination history
DiagnosticReport  → lab panels, imaging reports
Procedure         → surgical history
CarePlan          → care plans
Goal              → health goals
```

**Auth Flow:** SMART App Launch (standalone app profile), PKCE, offline_access scope.

#### 3.1.4 Nutrition Connector (`src/connectors/nutrition-db.ts`)

**Input Methods:**
1. Natural language description: `"I ate a bowl of oatmeal with blueberries"`
2. Barcode scan (via webcam or manual UPC entry)
3. Restaurant menu item lookup
4. Structured JSON entry

**Database:** USDA FoodData Central API + local cache  
**NLP Parsing:** Sends description to XSpan H-LLM for structured extraction  
**Stores:** Meal records in local SQLite with full nutritional breakdown

---

### 3.2 Local Data Store (`src/storage/local-store.ts`)

**Engine:** SQLite via `better-sqlite3`  
**Encryption:** SQLCipher (AES-256-CBC) with key derived from machine-specific secret  
**Location:** `~/.xspan/data/xspan.db`  

**Schema:**

```sql
-- Raw health samples
CREATE TABLE health_samples (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- 'apple_health' | 'google_health' | 'ehr' | 'manual'
  data_type TEXT NOT NULL,
  value REAL,
  unit TEXT,
  metadata JSON,
  recorded_at DATETIME NOT NULL,
  synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Nutrition logs
CREATE TABLE nutrition_logs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  structured_data JSON NOT NULL,  -- parsed macros/micros
  meal_type TEXT,                 -- breakfast | lunch | dinner | snack
  logged_at DATETIME NOT NULL,
  synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Biomarker snapshots (normalized)
CREATE TABLE biomarker_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  biomarkers JSON NOT NULL,       -- 100+ biomarker vector
  digital_twin_version TEXT,
  synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Nudges received
CREATE TABLE nudges (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT,                  -- nutrition | sleep | exercise | stress | prevention
  priority INTEGER DEFAULT 0,
  delivered_at DATETIME,
  acknowledged_at DATETIME,
  received_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Health passports
CREATE TABLE health_passports (
  id TEXT PRIMARY KEY,
  week_ending DATE NOT NULL,
  summary JSON NOT NULL,
  pdf_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sync log
CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  records_synced INTEGER DEFAULT 0,
  error TEXT,
  started_at DATETIME NOT NULL,
  completed_at DATETIME
);
```

---

### 3.3 Data Pipeline (`src/sync/data-pipeline.ts`)

**Responsibilities:**
1. Pull raw samples from all connectors
2. Deduplicate by `(source, data_type, recorded_at)`
3. Normalize units to SI/standard (e.g., mg/dL, bpm, steps)
4. Compute derived biomarkers:
   - Sleep quality score (from sleep stages + HRV)
   - Stress index (from HRV, resting HR, cortisol proxy)
   - Recovery score (from sleep + activity + HRV)
   - Metabolic health index (from glucose, BMI, activity)
   - Cardiovascular fitness score (from VO2Max, resting HR, BP)
5. Build biomarker vector for XSpan H-LLM input
6. Store in `biomarker_snapshots`

**Biomarker Vector (100+ fields):**
```typescript
interface BiomarkerVector {
  // Cardiovascular
  restingHeartRate: number;
  heartRateVariability: number;
  bloodPressureSystolic: number;
  bloodPressureDiastolic: number;
  vo2Max?: number;

  // Metabolic
  bloodGlucoseFasting?: number;
  bloodGlucosePostMeal?: number;
  bodyMassIndex: number;
  bodyFatPercentage?: number;
  waistCircumference?: number;

  // Sleep
  totalSleepMinutes: number;
  deepSleepMinutes: number;
  remSleepMinutes: number;
  sleepEfficiency: number;
  sleepOnsetLatency: number;

  // Activity
  dailySteps: number;
  activeMinutes: number;
  activeCalories: number;
  exerciseSessionsPerWeek: number;

  // Nutrition (7-day averages)
  avgDailyCalories: number;
  avgProteinGrams: number;
  avgCarbGrams: number;
  avgFatGrams: number;
  avgFiberGrams: number;
  avgWaterMl: number;

  // Labs (from EHR, when available)
  hba1c?: number;
  ldlCholesterol?: number;
  hdlCholesterol?: number;
  triglycerides?: number;
  tshThyroid?: number;
  vitaminD?: number;
  ferritin?: number;
  creatinine?: number;
  egfr?: number;
  alt?: number;
  ast?: number;
  crp?: number;   // C-reactive protein (inflammation)
  homocysteine?: number;

  // Stress & Recovery
  stressIndex: number;          // 0-100 derived score
  recoveryScore: number;        // 0-100 derived score
  mindfulnessMinutes: number;

  // Computed Risk Scores (from H-LLM)
  cardiovascularRisk?: number;
  metabolicRisk?: number;
  sleepDisorderRisk?: number;
  burnoutRisk?: number;

  // Genomics (optional, from file upload)
  genomeRiskVariants?: Record<string, number>;

  // Timestamp
  snapshotDate: string;         // ISO date
  dataCompleteness: number;     // 0-1, fraction of fields populated
}
```

---

### 3.4 XSpan API Client (`src/sync/xspan-api.ts`)

**Base URL:** `https://api.xspan.ai/v1`  
**Auth:** Bearer token (XSpan API key)  
**Retry:** Exponential backoff (3 retries, max 30s delay)  
**Timeout:** 30s per request  

**Endpoints Used:**

```typescript
// Upload biomarker vector
POST /sync
Body: { userId, biomarkers: BiomarkerVector, clientVersion }
Response: { syncId, digitalTwinUpdated, nextNudgeAt }

// Fetch nudges
GET /nudges?since=ISO_DATETIME&limit=10
Response: { nudges: Nudge[], nextNudgeAt }

// Fetch latest passport
GET /passport/latest
Response: { passport: HealthPassport, pdfUrl }

// Ask health question
POST /ask
Body: { userId, question, context?: BiomarkerVector }
Response: { answer, confidence, citations, followUps }

// Trigger digital twin synthesis
POST /digital-twin/synthesize
Body: { userId, force?: boolean }
Response: { twinId, processingTime, updatedAt }

// Get risk scores
GET /risk-scores
Response: { scores: RiskScore[], updatedAt }
```

---

### 3.5 Agent Orchestrator (`src/agent/index.ts`)

**Runtime:** Node.js daemon using `node-cron` for scheduling  

**Scheduled Jobs:**

```typescript
// Continuous health data sync (every 15 min)
cron.schedule('*/15 * * * *', syncHealthData);

// Morning nudge (8 AM local)
cron.schedule('0 8 * * *', deliverNudge);

// Midday nudge (12 PM local)
cron.schedule('0 12 * * *', deliverNudge);

// Evening nudge (6 PM local)
cron.schedule('0 18 * * *', deliverNudge);

// Cloud sync (every hour)
cron.schedule('0 * * * *', syncToXSpan);

// Weekly passport generation (Sunday 7 AM)
cron.schedule('0 7 * * 0', generateHealthPassport);
```

**Startup Sequence:**
1. Load and validate config
2. Initialize local SQLite store
3. Run pending migrations
4. Verify XSpan API connectivity
5. Check connector availability
6. Run initial data sync
7. Start scheduled jobs
8. Start MCP server
9. Log ready state

---

### 3.6 MCP Server (`src/mcp/server.ts`)

**Transport:** stdio (for Claude Desktop integration) with optional TCP mode for custom integrations  
**Protocol:** MCP v1.0 (JSON-RPC 2.0 over stdio)  
**Port (TCP mode):** 3456  

**Tool Definitions:**

```typescript
const tools: MCPTool[] = [
  {
    name: 'xspan_get_health_summary',
    description: 'Get a summary of the user\'s health metrics for today or a specific date',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'ISO date (YYYY-MM-DD), defaults to today' }
      }
    }
  },
  {
    name: 'xspan_get_biomarkers',
    description: 'Get the latest biomarker readings including labs, vitals, and derived scores',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['cardiovascular', 'metabolic', 'sleep', 'activity', 'nutrition', 'labs', 'all'],
          description: 'Filter by biomarker category'
        },
        days: { type: 'number', description: 'Number of days of history (default: 7)' }
      }
    }
  },
  {
    name: 'xspan_get_digital_twin',
    description: 'Get the user\'s complete Digital Twin health profile',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'xspan_log_nutrition',
    description: 'Log a meal or food item. Accepts natural language descriptions.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string', description: 'e.g. "grilled salmon with asparagus and brown rice"' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        time: { type: 'string', description: 'ISO datetime, defaults to now' }
      }
    }
  },
  {
    name: 'xspan_get_nudges',
    description: 'Get today\'s personalized health nudges from XSpan',
    inputSchema: {
      type: 'object',
      properties: {
        unread_only: { type: 'boolean', description: 'Only return unacknowledged nudges' }
      }
    }
  },
  {
    name: 'xspan_get_health_passport',
    description: 'Get the latest weekly Health Passport summary',
    inputSchema: {
      type: 'object',
      properties: {
        week_ending: { type: 'string', description: 'ISO date for the week ending date, defaults to latest' }
      }
    }
  },
  {
    name: 'xspan_get_risk_scores',
    description: 'Get predictive health risk scores across multiple disease categories',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'xspan_ask_health',
    description: 'Ask a natural language question about the user\'s health, powered by XSpan H-LLM',
    inputSchema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: { type: 'string', description: 'Health question in natural language' }
      }
    }
  },
  {
    name: 'xspan_sync_apple_health',
    description: 'Manually trigger an Apple Health data sync',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Hours of data to sync (default: 24)' }
      }
    }
  },
  {
    name: 'xspan_sync_ehr',
    description: 'Manually trigger an EHR data sync',
    inputSchema: { type: 'object', properties: {} }
  }
];
```

---

### 3.7 Nudge Scheduler (`src/agent/nudge-scheduler.ts`)

**Delivery Channels:**
1. macOS system notification (via `node-notifier`)
2. Terminal output (when running in foreground)
3. Local file log at `~/.xspan/nudges/YYYY-MM-DD.json`
4. Optional webhook (configurable in `.env`)

**Nudge Format:**
```typescript
interface Nudge {
  id: string;
  content: string;              // Main nudge text (max 280 chars)
  category: NudgeCategory;
  priority: 1 | 2 | 3;         // 3 = urgent
  deepDive?: string;            // Extended explanation (for MCP/Claude)
  actionItems?: string[];       // Specific action steps
  relatedBiomarkers?: string[]; // Which biomarkers triggered this
  followUpAt?: string;          // ISO datetime for follow-up nudge
  receivedAt: string;
}

type NudgeCategory =
  | 'sleep_optimization'
  | 'nutrition_guidance'
  | 'movement_reminder'
  | 'stress_management'
  | 'hydration'
  | 'medication_adherence'
  | 'preventive_screening'
  | 'lab_followup'
  | 'positive_reinforcement';
```

---

### 3.8 Health Passport Builder (`src/agent/passport-builder.ts`)

**Output:** PDF + JSON  
**Schedule:** Every Sunday 7 AM  
**PDF Library:** `pdfkit`  

**Health Passport Sections:**

```
1. Executive Summary
   - Overall Health Score (0-100)
   - Week's key wins
   - Priority focus areas

2. Vital Signs & Biometrics
   - 7-day trend charts for: HR, HRV, BP, weight

3. Sleep Quality
   - Sleep stages breakdown
   - Sleep consistency score
   - Key insights

4. Physical Activity
   - Steps, active minutes, workout sessions
   - VO2Max trend
   - Movement quality score

5. Nutrition Overview
   - Macro/micro averages
   - Meal timing patterns
   - Nutrient gaps identified

6. Stress & Recovery
   - Stress index trend
   - Recovery score
   - Mindfulness minutes

7. Lab Results (if EHR connected)
   - Latest values vs. optimal ranges
   - Trend arrows
   - Action items

8. Risk Radar
   - Visual risk scores across 6 domains
   - Changes from last week

9. Digital Twin Insights
   - Personalized observations from H-LLM
   - Predicted health trajectory

10. Next Week's Action Plan
    - 3-5 prioritized recommendations
    - Specific, measurable goals
```

---

## 4. Security Specification

### 4.1 Data Encryption

| Layer | Method |
|---|---|
| Local database | SQLCipher (AES-256-CBC) |
| OAuth tokens | AES-256-GCM, key in OS keychain |
| API key | Stored in OS keychain (Keychain on macOS, libsecret on Linux) |
| Transit | TLS 1.3 minimum, certificate pinning for XSpan endpoints |

### 4.2 Data Minimization

**What is sent to XSpan cloud:**
- Normalized biomarker vectors (no raw sensor data)
- Nutrition summaries (not individual meal descriptions unless user opts in)
- Derived health scores

**What stays local:**
- Raw HealthKit samples
- Raw EHR FHIR resources
- Individual meal descriptions
- Genomics raw data

### 4.3 Authentication

- XSpan API: Bearer token (JWT, 30-day expiry, refreshed automatically)
- Google OAuth2: PKCE flow, tokens stored in OS keychain
- EHR SMART on FHIR: PKCE flow, per-provider token storage
- No passwords stored in `.env` or plaintext files

---

## 5. TypeScript Type Definitions (`src/types/index.ts`)

```typescript
// Core health sample
export interface HealthSample {
  id: string;
  source: DataSource;
  dataType: string;
  value: number;
  unit: string;
  metadata?: Record<string, unknown>;
  recordedAt: Date;
}

export type DataSource = 'apple_health' | 'google_health' | 'ehr' | 'manual' | 'computed';

// Sleep record
export interface SleepRecord {
  date: string;
  totalMinutes: number;
  deepMinutes: number;
  remMinutes: number;
  lightMinutes: number;
  awakeMinutes: number;
  efficiency: number;
  onsetLatency: number;
  hrv?: number;
}

// Workout record
export interface WorkoutRecord {
  id: string;
  activityType: string;
  durationMinutes: number;
  activeCalories: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  distance?: number;
  startTime: Date;
  endTime: Date;
}

// Nutrition entry
export interface NutritionEntry {
  id: string;
  description: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  loggedAt: Date;
  nutrients: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
    sugar?: number;
    sodium?: number;
    water?: number;
  };
  foods: FoodItem[];
}

export interface FoodItem {
  name: string;
  quantity: number;
  unit: string;
  fdcId?: string;   // USDA FoodData Central ID
}

// Agent configuration
export interface AgentConfig {
  xspan: {
    apiKey: string;
    userId: string;
    apiUrl: string;
  };
  connectors: {
    appleHealth: { enabled: boolean };
    googleHealth: { enabled: boolean; clientId?: string; clientSecret?: string };
    ehr: { enabled: boolean; provider?: EHRProvider; fhirBaseUrl?: string; clientId?: string };
  };
  schedules: {
    nudgeTimes: string[];   // cron expressions for 3 nudge times
    reportSchedule: string; // cron for weekly passport
    syncInterval: number;   // minutes between syncs
  };
  storage: {
    dataDir: string;
    passportDir: string;
  };
  notifications: {
    enabled: boolean;
    webhook?: string;
  };
}

export type EHRProvider = 'epic' | 'cerner' | 'redox' | 'generic_fhir';

// XSpan API types
export interface XSpanSyncResponse {
  syncId: string;
  digitalTwinUpdated: boolean;
  nextNudgeAt: string;
  message?: string;
}

export interface XSpanNudge {
  id: string;
  content: string;
  category: string;
  priority: number;
  deepDive?: string;
  actionItems?: string[];
  relatedBiomarkers?: string[];
  receivedAt: string;
}

export interface HealthPassport {
  id: string;
  weekEnding: string;
  overallScore: number;
  sections: PassportSection[];
  riskScores: RiskScore[];
  recommendations: string[];
  pdfUrl?: string;
}

export interface PassportSection {
  title: string;
  score?: number;
  insights: string[];
  metrics: Record<string, number | string>;
}

export interface RiskScore {
  category: string;
  score: number;      // 0-100
  trend: 'improving' | 'stable' | 'declining';
  factors: string[];
}
```

---

## 6. Build & Deployment

### 6.1 Package.json Scripts

```json
{
  "scripts": {
    "start": "node dist/agent/index.js",
    "dev": "tsx watch src/agent/index.ts",
    "mcp": "node dist/mcp/server.js",
    "mcp:dev": "tsx src/mcp/server.ts",
    "build": "tsc && npm run build:swift",
    "build:swift": "swift build -C scripts/apple-health-bridge --configuration release",
    "setup": "node scripts/install.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src"
  }
}
```

### 6.2 Process Management

For production use, users are recommended to run the agent as a launchd service (macOS) or systemd service (Linux):

**macOS LaunchAgent** (`~/Library/LaunchAgents/ai.xspan.agent.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.xspan.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/usr/local/lib/xspan-agent/dist/agent/index.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/xspan-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/xspan-agent-error.log</string>
</dict>
</plist>
```

---

## 7. Testing Strategy

| Layer | Framework | Coverage Target |
|---|---|---|
| Unit tests | Vitest | ≥ 80% |
| Integration tests | Vitest + msw (mock APIs) | Key flows |
| E2E | Playwright (MCP client simulation) | Happy paths |
| Type checking | tsc --noEmit | 100% |

**Mock Data:**
- Apple Health: JSON fixtures in `tests/fixtures/apple-health/`
- Google Fit: JSON fixtures in `tests/fixtures/google-fit/`
- EHR FHIR: FHIR R4 bundle fixtures in `tests/fixtures/fhir/`
- XSpan API: MSW handlers in `tests/mocks/xspan-api.ts`

---

## 8. Open Source Publishing

### 8.1 GitHub Repository

**Org:** `xspanai`  
**Repo:** `xspan-agent`  
**Topics:** `health`, `mcp`, `ai-agent`, `digital-health`, `apple-health`, `fhir`, `ehr`, `typescript`, `open-source`

### 8.2 npm Package

**Package name:** `@xspan/agent`  
**Publish:** GitHub Actions on tag push  

### 8.3 Distribution Channels

| Channel | Package | Command |
|---|---|---|
| npm/npx | `@xspan/agent` | `npx @xspan/agent setup` |
| Homebrew | `xspan-agent` | `brew install xspanai/agent/xspan-agent` |
| OpenClaw | `xspan-health-agent` | Via OpenClaw marketplace |
| Smithery MCP | `xspan` | Add via Claude Desktop UI |
| Direct download | GitHub Releases | `.pkg` installer for macOS |

---

## 9. Roadmap

| Version | Features |
|---|---|
| v1.0 | Apple Health, EHR FHIR, Nutrition logging, MCP server, 3×/day nudges, weekly passport |
| v1.1 | Google Health, Oura Ring, Garmin, Windows Health (Samsung Health) |
| v1.2 | Genomics integration (23andMe VCF parser), advanced risk models |
| v1.3 | Local H-LLM option (MedGemma on-device), fully offline mode |
| v2.0 | Family health management, caregiver mode, physician-facing dashboard |

---

*XSpan.ai — Whole Body Intelligence*
