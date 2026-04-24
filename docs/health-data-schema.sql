-- ============================================================
-- XSpan-EHR Data Schema
-- Stores normalized health data from all sources:
-- b.well (EHR), Terra (wearables), Labs, Genomics, Microbiome
--
-- Database: SQLite (local-first, AES-256 encrypted)
-- All timestamps in UTC ISO-8601
-- ============================================================

-- ── CORE TABLES ─────────────────────────────────────────────

-- Patient profile (single user per agent install)
CREATE TABLE IF NOT EXISTS patient (
  id                TEXT PRIMARY KEY,               -- UUID
  source            TEXT NOT NULL,                   -- 'bwell', 'manual', 'ehr'
  source_id         TEXT,                            -- external ID (bwell patient ID, etc.)
  first_name        TEXT,
  last_name         TEXT,
  date_of_birth     TEXT,                            -- YYYY-MM-DD
  gender            TEXT,                            -- male, female, other, unknown
  email             TEXT,
  phone             TEXT,
  address_line      TEXT,
  address_city      TEXT,
  address_state     TEXT,
  address_zip       TEXT,
  address_country   TEXT DEFAULT 'US',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Connected data sources
CREATE TABLE IF NOT EXISTS data_source (
  id                TEXT PRIMARY KEY,               -- UUID
  source_type       TEXT NOT NULL,                   -- 'ehr', 'wearable', 'lab', 'genomics', 'microbiome', 'manual'
  provider          TEXT NOT NULL,                   -- 'bwell', 'terra', 'apple_health', 'oura', 'dexcom', 'quest', '23andme'
  provider_name     TEXT,                            -- Display name: "UCLA Health", "Oura Ring"
  connection_status TEXT DEFAULT 'disconnected',     -- connected, disconnected, pending, expired, error
  last_sync_at      TEXT,
  next_sync_at      TEXT,
  sync_frequency    TEXT,                            -- 'realtime', 'hourly', 'daily', 'weekly', 'manual'
  access_token      TEXT,                            -- encrypted
  refresh_token     TEXT,                            -- encrypted
  token_expires_at  TEXT,
  metadata          TEXT,                            -- JSON blob for source-specific config
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── VITAL SIGNS ─────────────────────────────────────────────
-- Sources: Wearables (continuous), EHR (episodic), Manual
-- Frequency: Wearables = every 1-60 min; EHR = per visit; Manual = ad-hoc

CREATE TABLE IF NOT EXISTS vital_signs (
  id                TEXT PRIMARY KEY,               -- UUID
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,                            -- original FHIR resource ID
  recorded_at       TEXT NOT NULL,                   -- when measurement was taken
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  -- Heart
  heart_rate            REAL,     -- bpm         | INTEGER | wearable: every 1-5 min, EHR: per visit
  heart_rate_resting    REAL,     -- bpm         | INTEGER | wearable: daily
  hrv_sdnn              REAL,     -- ms          | REAL    | wearable: daily (Oura, WHOOP, Apple)
  hrv_rmssd             REAL,     -- ms          | REAL    | wearable: per sleep session

  -- Blood Pressure
  bp_systolic           REAL,     -- mmHg        | INTEGER | EHR: per visit, home monitor: daily
  bp_diastolic          REAL,     -- mmHg        | INTEGER | EHR: per visit, home monitor: daily
  bp_position           TEXT,     -- sitting, standing, supine

  -- Respiratory
  respiratory_rate      REAL,     -- breaths/min | INTEGER | wearable: nightly, EHR: per visit
  spo2                  REAL,     -- %           | REAL    | wearable: nightly, EHR: per visit
  spo2_min_overnight    REAL,     -- %           | REAL    | wearable: nightly

  -- Temperature
  body_temperature      REAL,     -- °C          | REAL    | wearable: nightly, EHR: per visit
  skin_temperature_dev  REAL,     -- °C          | REAL    | Oura: nightly deviation from baseline

  -- Other
  blood_glucose         REAL,     -- mg/dL       | REAL    | CGM: every 5 min, lab: per draw
  blood_glucose_type    TEXT,     -- fasting, random, postprandial, cgm

  metadata              TEXT,     -- JSON: LOINC code, device, provider notes
  UNIQUE(source_id, recorded_at, heart_rate, bp_systolic, blood_glucose)
);

CREATE INDEX idx_vitals_date ON vital_signs(recorded_at);
CREATE INDEX idx_vitals_source ON vital_signs(source_id);

-- ── BODY MEASUREMENTS ───────────────────────────────────────
-- Sources: Smart scale, EHR, Manual
-- Frequency: Daily (scale), per visit (EHR)

CREATE TABLE IF NOT EXISTS body_measurements (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  weight_kg             REAL,     -- kg          | REAL    | smart scale: daily, EHR: per visit
  weight_lbs            REAL,     -- lbs         | REAL    | derived from kg * 2.20462
  height_cm             REAL,     -- cm          | REAL    | EHR: annually
  bmi                   REAL,     -- kg/m²       | REAL    | derived: weight / height²
  body_fat_pct          REAL,     -- %           | REAL    | smart scale: daily
  lean_mass_kg          REAL,     -- kg          | REAL    | smart scale: daily
  bone_mass_kg          REAL,     -- kg          | REAL    | smart scale: daily
  water_pct             REAL,     -- %           | REAL    | smart scale: daily
  waist_cm              REAL,     -- cm          | REAL    | manual: monthly
  hip_cm                REAL,     -- cm          | REAL    | manual: monthly
  waist_hip_ratio       REAL,     -- ratio       | REAL    | derived

  metadata              TEXT
);

CREATE INDEX idx_body_date ON body_measurements(recorded_at);

-- ── SLEEP ───────────────────────────────────────────────────
-- Sources: Oura, WHOOP, Apple Watch, Garmin, Fitbit
-- Frequency: Nightly

CREATE TABLE IF NOT EXISTS sleep (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  recorded_at       TEXT NOT NULL,                   -- date of sleep (night of)
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  -- Duration
  sleep_start           TEXT,     -- ISO datetime | when fell asleep
  sleep_end             TEXT,     -- ISO datetime | when woke up
  total_sleep_min       INTEGER,  -- minutes      | total sleep time
  time_in_bed_min       INTEGER,  -- minutes      | total time in bed
  sleep_latency_min     INTEGER,  -- minutes      | time to fall asleep
  awake_min             INTEGER,  -- minutes      | time awake during night

  -- Stages
  rem_min               INTEGER,  -- minutes      | REM sleep
  deep_min              INTEGER,  -- minutes      | deep / N3 sleep
  light_min             INTEGER,  -- minutes      | light / N1+N2 sleep

  -- Quality
  sleep_efficiency      REAL,     -- %           | REAL   | total_sleep / time_in_bed * 100
  sleep_score           INTEGER,  -- 0-100       | Oura/WHOOP composite score
  restfulness_score     INTEGER,  -- 0-100       | movement-based

  -- Biometrics during sleep
  avg_hr_sleep          REAL,     -- bpm         | average HR during sleep
  min_hr_sleep          REAL,     -- bpm         | lowest HR during sleep
  avg_hrv_sleep         REAL,     -- ms          | average HRV during sleep
  avg_spo2_sleep        REAL,     -- %           | average SpO2 during sleep
  avg_resp_rate_sleep   REAL,     -- breaths/min | average respiratory rate
  avg_skin_temp_sleep   REAL,     -- °C          | average skin temperature

  metadata              TEXT
);

CREATE INDEX idx_sleep_date ON sleep(recorded_at);

-- ── ACTIVITY ────────────────────────────────────────────────
-- Sources: All wearables, Apple Health, Google Fit
-- Frequency: Daily summary + intraday

CREATE TABLE IF NOT EXISTS activity (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  recorded_at       TEXT NOT NULL,                   -- date (daily summary)
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  -- Steps & Distance
  steps                 INTEGER,  -- count       | daily total
  distance_m            REAL,     -- meters      | daily total
  floors_climbed        INTEGER,  -- count       | daily total

  -- Calories
  calories_total        INTEGER,  -- kcal        | total (BMR + active)
  calories_active       INTEGER,  -- kcal        | active calories only
  calories_bmr          INTEGER,  -- kcal        | basal metabolic rate

  -- Active Time
  active_min            INTEGER,  -- minutes     | moderate + vigorous
  moderate_min          INTEGER,  -- minutes     | moderate intensity
  vigorous_min          INTEGER,  -- minutes     | vigorous intensity
  sedentary_min         INTEGER,  -- minutes     | sedentary time

  -- Scores (device-specific)
  activity_score        INTEGER,  -- 0-100       | Oura activity score
  strain_score          REAL,     -- 0-21        | WHOOP strain
  recovery_score        INTEGER,  -- 0-100       | WHOOP recovery
  body_battery          INTEGER,  -- 0-100       | Garmin Body Battery
  readiness_score       INTEGER,  -- 0-100       | Oura readiness
  stress_score          INTEGER,  -- 0-100       | Garmin stress (inverted: low = good)

  -- Training
  training_volume       REAL,     -- arbitrary   | training load
  vo2_max               REAL,     -- mL/kg/min   | estimated VO2 max

  metadata              TEXT
);

CREATE INDEX idx_activity_date ON activity(recorded_at);

-- ── LAB RESULTS ─────────────────────────────────────────────
-- Sources: b.well (EHR), Quest, LabCorp, Function Health
-- Frequency: Per lab order (typically quarterly-annually)

CREATE TABLE IF NOT EXISTS lab_results (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,                   -- specimen collection date
  reported_at       TEXT,                            -- report date
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  -- Test identification
  loinc_code        TEXT,                            -- LOINC code (e.g., '2345-7')
  test_name         TEXT NOT NULL,                   -- display name
  category          TEXT,                            -- hematology, chemistry, lipids, thyroid, metabolic, inflammatory, hormonal, tumor_marker, vitamin, mineral

  -- Result
  value_numeric     REAL,                            -- numeric result
  value_string      TEXT,                            -- string result (e.g., "Positive", "Reactive")
  unit              TEXT,                            -- unit of measurement
  reference_low     REAL,                            -- reference range low
  reference_high    REAL,                            -- reference range high
  interpretation    TEXT,                            -- normal, abnormal, critical, low, high

  -- Context
  ordering_provider TEXT,                            -- who ordered
  performing_lab    TEXT,                            -- lab that ran the test
  specimen_type     TEXT,                            -- blood, urine, saliva, stool
  fasting           INTEGER DEFAULT 0,              -- 1 = fasting, 0 = non-fasting

  metadata          TEXT                             -- JSON: full FHIR Observation or DiagnosticReport
);

CREATE INDEX idx_labs_date ON lab_results(recorded_at);
CREATE INDEX idx_labs_loinc ON lab_results(loinc_code);
CREATE INDEX idx_labs_category ON lab_results(category);

-- ── COMMON LAB REFERENCE (for lookup) ───────────────────────
-- Pre-populated with standard lab tests, units, and ranges

CREATE TABLE IF NOT EXISTS lab_reference (
  loinc_code        TEXT PRIMARY KEY,
  test_name         TEXT NOT NULL,
  category          TEXT NOT NULL,
  unit              TEXT NOT NULL,
  value_type        TEXT NOT NULL DEFAULT 'numeric', -- numeric, string, ratio
  reference_low     REAL,
  reference_high    REAL,
  optimal_low       REAL,                            -- tighter "optimal" range
  optimal_high      REAL,
  frequency         TEXT                             -- 'quarterly', 'annually', 'as_needed'
);

-- Pre-populate common labs
INSERT OR IGNORE INTO lab_reference VALUES
  -- Metabolic
  ('2345-7',  'Glucose',                  'metabolic',    'mg/dL',    'numeric', 70,   100,  75,   90,   'quarterly'),
  ('1558-6',  'Fasting Glucose',          'metabolic',    'mg/dL',    'numeric', 65,   99,   70,   90,   'quarterly'),
  ('4548-4',  'Hemoglobin A1c',           'metabolic',    '%',        'numeric', 4.0,  5.6,  4.0,  5.3,  'quarterly'),
  ('14749-6', 'Fasting Insulin',          'metabolic',    'uIU/mL',  'numeric', 2.6,  24.9, 2.6,  8.0,  'annually'),
  ('13457-7', 'HOMA-IR',                  'metabolic',    'ratio',    'numeric', NULL, 2.0,  NULL, 1.0,  'annually'),

  -- Lipid Panel
  ('2093-3',  'Total Cholesterol',        'lipids',       'mg/dL',    'numeric', NULL, 200,  NULL, 180,  'annually'),
  ('2085-9',  'HDL Cholesterol',          'lipids',       'mg/dL',    'numeric', 40,   NULL, 60,   NULL, 'annually'),
  ('2089-1',  'LDL Cholesterol',          'lipids',       'mg/dL',    'numeric', NULL, 100,  NULL, 70,   'annually'),
  ('2571-8',  'Triglycerides',            'lipids',       'mg/dL',    'numeric', NULL, 150,  NULL, 100,  'annually'),
  ('13458-5', 'VLDL Cholesterol',         'lipids',       'mg/dL',    'numeric', 5,    40,   NULL, NULL, 'annually'),
  ('9830-1',  'TC/HDL Ratio',             'lipids',       'ratio',    'numeric', NULL, 5.0,  NULL, 3.5,  'annually'),
  ('43396-1', 'ApoB',                     'lipids',       'mg/dL',    'numeric', NULL, 130,  NULL, 90,   'annually'),
  ('43245-0', 'Lp(a)',                    'lipids',       'nmol/L',   'numeric', NULL, 75,   NULL, 30,   'once'),

  -- Thyroid
  ('3016-3',  'TSH',                      'thyroid',      'mIU/L',    'numeric', 0.45, 4.5,  1.0,  2.5,  'annually'),
  ('3051-0',  'Free T3',                  'thyroid',      'pg/mL',    'numeric', 2.0,  4.4,  2.5,  4.0,  'annually'),
  ('3024-7',  'Free T4',                  'thyroid',      'ng/dL',    'numeric', 0.82, 1.77, 1.0,  1.5,  'annually'),

  -- Inflammatory
  ('1988-5',  'CRP (C-Reactive Protein)', 'inflammatory', 'mg/L',    'numeric', NULL, 3.0,  NULL, 1.0,  'annually'),
  ('30522-7', 'hs-CRP',                   'inflammatory', 'mg/L',    'numeric', NULL, 3.0,  NULL, 1.0,  'annually'),
  ('4537-7',  'ESR',                      'inflammatory', 'mm/hr',    'numeric', 0,    20,   0,    10,   'annually'),
  ('2155-0',  'Homocysteine',             'inflammatory', 'umol/L',   'numeric', NULL, 15,   NULL, 10,   'annually'),

  -- Kidney
  ('2160-0',  'Creatinine',               'kidney',       'mg/dL',    'numeric', 0.7,  1.3,  0.7,  1.1,  'annually'),
  ('3094-0',  'BUN',                      'kidney',       'mg/dL',    'numeric', 6,    20,   7,    18,   'annually'),
  ('33914-3', 'eGFR',                     'kidney',       'mL/min/1.73m²','numeric', 60, NULL, 90, NULL, 'annually'),
  ('14959-1', 'Microalbumin/Creatinine',  'kidney',       'mg/g',     'numeric', NULL, 30,   NULL, 20,   'annually'),

  -- Liver
  ('1742-6',  'ALT',                      'liver',        'U/L',      'numeric', 7,    56,   7,    35,   'annually'),
  ('1920-8',  'AST',                      'liver',        'U/L',      'numeric', 10,   40,   10,   30,   'annually'),
  ('6768-6',  'ALP',                      'liver',        'U/L',      'numeric', 44,   147,  50,   120,  'annually'),
  ('1975-2',  'Bilirubin (Total)',        'liver',        'mg/dL',    'numeric', 0.1,  1.2,  0.1,  1.0,  'annually'),
  ('2336-6',  'GGT',                      'liver',        'U/L',      'numeric', 0,    65,   0,    40,   'annually'),
  ('1751-7',  'Albumin',                  'liver',        'g/dL',     'numeric', 3.4,  5.4,  4.0,  5.0,  'annually'),

  -- Hematology (CBC)
  ('718-7',   'Hemoglobin',               'hematology',   'g/dL',     'numeric', 12.0, 17.5, 13.5, 16.0, 'annually'),
  ('4544-3',  'Hematocrit',              'hematology',   '%',        'numeric', 36,   51,   40,   48,   'annually'),
  ('6690-2',  'WBC',                      'hematology',   '10³/uL',  'numeric', 3.4,  10.8, 4.0,  8.0,  'annually'),
  ('777-3',   'Platelets',               'hematology',   '10³/uL',  'numeric', 150,  379,  175,  350,  'annually'),
  ('789-8',   'RBC',                      'hematology',   '10⁶/uL',  'numeric', 3.77, 5.28, 4.2,  5.0,  'annually'),
  ('785-6',   'MCH',                      'hematology',   'pg',       'numeric', 25,   33,   27,   32,   'annually'),
  ('786-4',   'MCHC',                     'hematology',   'g/dL',     'numeric', 31,   37,   32,   36,   'annually'),
  ('787-2',   'MCV',                      'hematology',   'fL',       'numeric', 79,   97,   82,   95,   'annually'),

  -- Vitamins & Minerals
  ('1989-3',  'Vitamin D (25-OH)',        'vitamin',      'ng/mL',    'numeric', 30,   100,  40,   70,   'semi_annually'),
  ('2132-9',  'Vitamin B12',             'vitamin',      'pg/mL',    'numeric', 211,  946,  400,  800,  'annually'),
  ('2284-8',  'Folate',                   'vitamin',      'ng/mL',    'numeric', 2.7,  17.0, 5.0,  15.0, 'annually'),
  ('2502-3',  'Iron (Serum)',             'mineral',      'ug/dL',    'numeric', 38,   169,  60,   140,  'annually'),
  ('2276-4',  'Ferritin',                'mineral',      'ng/mL',    'numeric', 15,   150,  30,   100,  'annually'),
  ('2601-3',  'Magnesium',               'mineral',      'mg/dL',    'numeric', 1.6,  2.6,  2.0,  2.4,  'annually'),
  ('2947-0',  'Zinc',                     'mineral',      'ug/dL',    'numeric', 56,   134,  70,   120,  'annually'),

  -- Hormonal
  ('2986-8',  'Testosterone (Total)',     'hormonal',     'ng/dL',    'numeric', 264,  916,  400,  800,  'annually'),
  ('2991-8',  'Free Testosterone',        'hormonal',     'pg/mL',    'numeric', 5.0,  21.0, 8.0,  18.0, 'annually'),
  ('2243-4',  'Estradiol (E2)',           'hormonal',     'pg/mL',    'numeric', NULL, NULL, NULL, NULL, 'annually'),
  ('83086-8', 'DHEA-S',                   'hormonal',     'ug/dL',    'numeric', NULL, NULL, NULL, NULL, 'annually'),
  ('2842-3',  'Cortisol (AM)',            'hormonal',     'ug/dL',    'numeric', 6.2,  19.4, 10,   18,   'annually'),
  ('3026-2',  'IGF-1',                    'hormonal',     'ng/mL',    'numeric', NULL, NULL, NULL, NULL, 'annually'),

  -- Cardiac
  ('42757-5', 'NT-proBNP',               'cardiac',      'pg/mL',    'numeric', NULL, 125,  NULL, 100,  'as_needed'),
  ('6598-7',  'Troponin T (hs)',          'cardiac',      'ng/L',     'numeric', NULL, 14,   NULL, 10,   'as_needed'),
  ('30313-1', 'HbA1c (IFCC)',            'cardiac',      'mmol/mol', 'numeric', 20,   42,   20,   38,   'quarterly'),

  -- Tumor Markers
  ('2857-1',  'PSA',                      'tumor_marker', 'ng/mL',    'numeric', NULL, 4.0,  NULL, 2.0,  'annually'),
  ('15156-2', 'CEA',                      'tumor_marker', 'ng/mL',    'numeric', NULL, 5.0,  NULL, 3.0,  'as_needed'),
  ('10834-0', 'CA 125',                   'tumor_marker', 'U/mL',     'numeric', NULL, 35,   NULL, 21,   'as_needed');

-- ── CONDITIONS / DIAGNOSES ──────────────────────────────────
-- Sources: b.well (EHR)
-- Frequency: Updated per encounter

CREATE TABLE IF NOT EXISTS conditions (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,                   -- onset date
  resolved_at       TEXT,                            -- abatement date (NULL if active)
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  icd10_code        TEXT,                            -- ICD-10 code
  snomed_code       TEXT,                            -- SNOMED CT code
  display_name      TEXT NOT NULL,                   -- human-readable name
  category          TEXT,                            -- encounter-diagnosis, problem-list-item
  clinical_status   TEXT,                            -- active, recurrence, relapse, inactive, remission, resolved
  severity          TEXT,                            -- mild, moderate, severe
  body_site         TEXT,
  notes             TEXT,

  metadata          TEXT
);

CREATE INDEX idx_conditions_status ON conditions(clinical_status);

-- ── MEDICATIONS ─────────────────────────────────────────────
-- Sources: b.well (EHR), manual entry
-- Frequency: Updated per prescription change

CREATE TABLE IF NOT EXISTS medications (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  rxnorm_code       TEXT,                            -- RxNorm code
  ndc_code          TEXT,                            -- NDC code
  medication_name   TEXT NOT NULL,
  generic_name      TEXT,
  brand_name        TEXT,
  status            TEXT,                            -- active, completed, stopped, on-hold, cancelled
  category          TEXT,                            -- inpatient, outpatient, community

  -- Dosage
  dose_value        REAL,
  dose_unit         TEXT,                            -- mg, mL, mcg, units, puffs
  frequency         TEXT,                            -- QD, BID, TID, QID, PRN, weekly
  route             TEXT,                            -- oral, topical, injection, inhalation, IV
  form              TEXT,                            -- tablet, capsule, liquid, cream, injection

  -- Dates
  start_date        TEXT,
  end_date          TEXT,
  prescriber        TEXT,
  pharmacy          TEXT,
  refills_remaining INTEGER,

  notes             TEXT,
  metadata          TEXT
);

CREATE INDEX idx_meds_status ON medications(status);

-- ── ALLERGIES ───────────────────────────────────────────────
-- Sources: b.well (EHR)
-- Frequency: Updated as discovered

CREATE TABLE IF NOT EXISTS allergies (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  allergen_code     TEXT,                            -- SNOMED or RxNorm
  allergen_name     TEXT NOT NULL,
  allergen_type     TEXT,                            -- food, medication, environment, biologic
  clinical_status   TEXT,                            -- active, inactive, resolved
  verification      TEXT,                            -- confirmed, unconfirmed, refuted
  criticality       TEXT,                            -- low, high, unable-to-assess
  reaction_type     TEXT,                            -- allergy, intolerance
  manifestation     TEXT,                            -- rash, anaphylaxis, hives, nausea, etc.
  severity          TEXT,                            -- mild, moderate, severe
  onset_date        TEXT,
  notes             TEXT,

  metadata          TEXT
);

-- ── IMMUNIZATIONS ───────────────────────────────────────────
-- Sources: b.well (EHR), state registries (via b.well)
-- Frequency: Per vaccination event

CREATE TABLE IF NOT EXISTS immunizations (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,                   -- administration date
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  cvx_code          TEXT,                            -- CVX vaccine code
  vaccine_name      TEXT NOT NULL,
  manufacturer      TEXT,
  lot_number        TEXT,
  dose_number       INTEGER,                         -- 1, 2, 3 (for multi-dose series)
  series_name       TEXT,                            -- "COVID-19 Primary", "Hepatitis B"
  site              TEXT,                            -- left arm, right arm, etc.
  route             TEXT,                            -- intramuscular, subcutaneous, oral
  status            TEXT,                            -- completed, not-done
  administering_org TEXT,
  notes             TEXT,

  metadata          TEXT
);

-- ── ENCOUNTERS / VISITS ─────────────────────────────────────
-- Sources: b.well (EHR)
-- Frequency: Per visit

CREATE TABLE IF NOT EXISTS encounters (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,                   -- visit start
  end_at            TEXT,                            -- visit end
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  encounter_type    TEXT,                            -- office_visit, er, inpatient, telehealth, lab_visit
  class             TEXT,                            -- ambulatory, emergency, inpatient, observation
  status            TEXT,                            -- planned, arrived, in-progress, finished, cancelled
  reason            TEXT,                            -- chief complaint / reason for visit
  provider_name     TEXT,
  provider_specialty TEXT,
  facility_name     TEXT,
  facility_type     TEXT,                            -- hospital, clinic, urgent_care, lab

  -- Outcomes
  diagnoses         TEXT,                            -- JSON array of ICD-10 codes from this visit
  procedures        TEXT,                            -- JSON array of procedure codes from this visit
  discharge_status  TEXT,                            -- home, transferred, AMA, deceased

  notes             TEXT,
  metadata          TEXT
);

CREATE INDEX idx_encounters_date ON encounters(recorded_at);

-- ── PROCEDURES ──────────────────────────────────────────────
-- Sources: b.well (EHR)
-- Frequency: Per procedure

CREATE TABLE IF NOT EXISTS procedures (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  cpt_code          TEXT,                            -- CPT code
  snomed_code       TEXT,
  procedure_name    TEXT NOT NULL,
  category          TEXT,                            -- surgical, diagnostic, therapeutic
  status            TEXT,                            -- completed, in-progress, not-done
  body_site         TEXT,
  performer         TEXT,
  facility          TEXT,
  outcome           TEXT,
  notes             TEXT,

  metadata          TEXT
);

-- ── CARE PLANS ──────────────────────────────────────────────
-- Sources: b.well (EHR)

CREATE TABLE IF NOT EXISTS care_plans (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  fhir_id           TEXT,
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  title             TEXT NOT NULL,
  status            TEXT,                            -- active, completed, revoked, on-hold
  intent            TEXT,                            -- plan, order, proposal
  category          TEXT,                            -- assess-plan, longitudinal
  description       TEXT,
  start_date        TEXT,
  end_date          TEXT,
  conditions        TEXT,                            -- JSON array of addressed condition IDs
  goals             TEXT,                            -- JSON array of goals
  activities        TEXT,                            -- JSON array of planned activities
  care_team         TEXT,                            -- JSON array of providers

  metadata          TEXT
);

-- ── GENOMICS ────────────────────────────────────────────────
-- Sources: 23andMe, Illumina, Foundation Medicine
-- Frequency: Once (WGS) or per test (panel)

CREATE TABLE IF NOT EXISTS genomic_variants (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  gene              TEXT NOT NULL,                   -- gene symbol (BRCA1, APOE, MTHFR)
  rsid              TEXT,                            -- rs number (rs429358)
  chromosome        TEXT,                            -- chr1-22, chrX, chrY
  position          INTEGER,                        -- genomic position
  ref_allele        TEXT,                            -- reference allele
  alt_allele        TEXT,                            -- alternate allele
  genotype          TEXT,                            -- e.g., "AG", "CC", "CT"
  zygosity          TEXT,                            -- homozygous, heterozygous, hemizygous

  clinical_significance TEXT,                        -- pathogenic, likely_pathogenic, VUS, benign, likely_benign
  condition         TEXT,                            -- associated condition
  inheritance       TEXT,                            -- autosomal_dominant, autosomal_recessive, X_linked
  pharmacogenomic   INTEGER DEFAULT 0,              -- 1 = affects drug metabolism

  metadata          TEXT                             -- JSON: full variant annotation
);

CREATE INDEX idx_genomics_gene ON genomic_variants(gene);

-- ── MICROBIOME ──────────────────────────────────────────────
-- Sources: Viome, Tiny Health, Gut.id, ZOE
-- Frequency: Per test (typically 1-4x/year)

CREATE TABLE IF NOT EXISTS microbiome (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  recorded_at       TEXT NOT NULL,
  synced_at         TEXT NOT NULL DEFAULT (datetime('now')),

  sample_type       TEXT,                            -- stool, oral, vaginal, skin
  test_type         TEXT,                            -- 16S, shotgun, metatranscriptomics

  -- Diversity scores
  shannon_diversity     REAL,                        -- Shannon diversity index
  simpson_diversity     REAL,                        -- Simpson diversity index
  firmicutes_pct        REAL,     -- %               | Firmicutes abundance
  bacteroidetes_pct     REAL,     -- %               | Bacteroidetes abundance
  fb_ratio              REAL,     -- ratio           | Firmicutes:Bacteroidetes ratio

  -- Composite scores (provider-specific)
  gut_health_score      INTEGER,  -- 0-100           | overall gut health
  inflammation_score    REAL,                        -- provider-specific
  metabolic_fitness     REAL,                        -- provider-specific

  -- Top taxa (JSON arrays)
  top_species           TEXT,     -- JSON: [{name, abundance_pct}]
  top_genera            TEXT,     -- JSON: [{name, abundance_pct}]
  missing_beneficial    TEXT,     -- JSON: [species not detected but expected]
  elevated_pathogenic   TEXT,     -- JSON: [species above threshold]

  metadata              TEXT
);

-- ── DAILY SNAPSHOTS (AGGREGATED) ────────────────────────────
-- Materialized daily view combining all sources
-- Used by the Insights dashboard for trend charts

CREATE TABLE IF NOT EXISTS daily_snapshot (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL UNIQUE,            -- YYYY-MM-DD
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),

  -- Vitals (daily aggregates)
  resting_hr        REAL,     -- bpm
  hrv               REAL,     -- ms (RMSSD or SDNN)
  bp_systolic       REAL,     -- mmHg
  bp_diastolic      REAL,     -- mmHg
  spo2              REAL,     -- %
  respiratory_rate  REAL,     -- breaths/min
  body_temp         REAL,     -- °C

  -- Body
  weight_kg         REAL,
  bmi               REAL,
  body_fat_pct      REAL,

  -- Sleep
  sleep_duration    INTEGER,  -- minutes
  sleep_efficiency  REAL,     -- %
  sleep_score       INTEGER,  -- 0-100
  deep_sleep_min    INTEGER,
  rem_sleep_min     INTEGER,

  -- Activity
  steps             INTEGER,
  active_calories   INTEGER,  -- kcal
  active_minutes    INTEGER,
  strain            REAL,     -- WHOOP 0-21
  recovery          INTEGER,  -- 0-100
  readiness         INTEGER,  -- 0-100

  -- Metabolic
  avg_glucose       REAL,     -- mg/dL (CGM daily avg)
  glucose_variability REAL,   -- CV% (CGM)
  time_in_range_pct REAL,     -- % time 70-180 mg/dL

  -- Sources present (bitmask or JSON)
  sources           TEXT,     -- JSON: ["apple_health", "oura", "dexcom", "bwell"]

  -- Scores (computed by agent)
  cardiovascular_score  INTEGER,  -- 0-100
  metabolic_score       INTEGER,  -- 0-100
  sleep_score_composite INTEGER,  -- 0-100
  activity_score_comp   INTEGER,  -- 0-100
  overall_health_score  INTEGER   -- 0-100
);

CREATE INDEX idx_snapshot_date ON daily_snapshot(date);

-- ── BASELINES & DRIFT ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS baselines (
  id                TEXT PRIMARY KEY,
  metric            TEXT NOT NULL UNIQUE,            -- 'resting_hr', 'hrv', 'weight_kg', etc.
  baseline_value    REAL NOT NULL,
  baseline_stddev   REAL,
  window_days       INTEGER DEFAULT 30,              -- rolling window size
  computed_at       TEXT NOT NULL,
  sample_count      INTEGER
);

CREATE TABLE IF NOT EXISTS drift_alerts (
  id                TEXT PRIMARY KEY,
  metric            TEXT NOT NULL,
  detected_at       TEXT NOT NULL,
  baseline_value    REAL,
  current_value     REAL,
  pct_change        REAL,                            -- percentage change from baseline
  severity          TEXT,                            -- info, warning, critical
  direction         TEXT,                            -- up, down
  message           TEXT,                            -- human-readable: "HRV down 14% from 30-day average"
  acknowledged      INTEGER DEFAULT 0
);

-- ── DATA SYNC LOG ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_log (
  id                TEXT PRIMARY KEY,
  source_id         TEXT REFERENCES data_source(id),
  started_at        TEXT NOT NULL,
  completed_at      TEXT,
  status            TEXT,                            -- running, success, failed, partial
  records_fetched   INTEGER DEFAULT 0,
  records_stored    INTEGER DEFAULT 0,
  error_message     TEXT
);
