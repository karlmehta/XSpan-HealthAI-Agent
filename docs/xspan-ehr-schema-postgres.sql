-- ============================================================
-- XSpan-EHR Data Schema — PostgreSQL Production
-- Full relational integrity, enums, indexes, triggers
-- Designed for b.well EHR, wearables, labs, genomics, microbiome
-- ============================================================

-- ── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";          -- encryption helpers

-- ── ENUMS ───────────────────────────────────────────────────

CREATE TYPE source_type_enum AS ENUM (
  'ehr', 'wearable', 'lab', 'genomics', 'microbiome', 'manual', 'pharmacy', 'imaging'
);

CREATE TYPE connection_status_enum AS ENUM (
  'connected', 'disconnected', 'pending', 'expired', 'error', 'revoked'
);

CREATE TYPE sync_frequency_enum AS ENUM (
  'realtime', 'every_5_min', 'hourly', 'daily', 'weekly', 'manual', 'on_demand'
);

CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other', 'unknown');

CREATE TYPE clinical_status_enum AS ENUM (
  'active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'
);

CREATE TYPE severity_enum AS ENUM ('mild', 'moderate', 'severe');

CREATE TYPE med_status_enum AS ENUM (
  'active', 'completed', 'stopped', 'on_hold', 'cancelled', 'entered_in_error', 'draft'
);

CREATE TYPE encounter_class_enum AS ENUM (
  'ambulatory', 'emergency', 'inpatient', 'observation', 'virtual'
);

CREATE TYPE encounter_status_enum AS ENUM (
  'planned', 'arrived', 'in_progress', 'finished', 'cancelled', 'entered_in_error'
);

CREATE TYPE allergy_type_enum AS ENUM ('food', 'medication', 'environment', 'biologic');
CREATE TYPE criticality_enum AS ENUM ('low', 'high', 'unable_to_assess');
CREATE TYPE verification_enum AS ENUM ('confirmed', 'unconfirmed', 'refuted', 'entered_in_error');

CREATE TYPE lab_interpretation_enum AS ENUM (
  'normal', 'abnormal', 'critical', 'low', 'high', 'very_low', 'very_high', 'inconclusive'
);

CREATE TYPE specimen_type_enum AS ENUM ('blood', 'urine', 'saliva', 'stool', 'csf', 'tissue', 'other');
CREATE TYPE lab_value_type_enum AS ENUM ('numeric', 'string', 'ratio', 'boolean');

CREATE TYPE drift_severity_enum AS ENUM ('info', 'warning', 'critical');
CREATE TYPE drift_direction_enum AS ENUM ('up', 'down');
CREATE TYPE sync_status_enum AS ENUM ('running', 'success', 'failed', 'partial', 'cancelled');

CREATE TYPE glucose_type_enum AS ENUM ('fasting', 'random', 'postprandial', 'cgm', 'oral_glucose_tolerance');
CREATE TYPE bp_position_enum AS ENUM ('sitting', 'standing', 'supine', 'unknown');

CREATE TYPE zygosity_enum AS ENUM ('homozygous', 'heterozygous', 'hemizygous');
CREATE TYPE clinical_significance_enum AS ENUM (
  'pathogenic', 'likely_pathogenic', 'uncertain_significance', 'likely_benign', 'benign'
);

CREATE TYPE procedure_category_enum AS ENUM ('surgical', 'diagnostic', 'therapeutic', 'preventive');
CREATE TYPE procedure_status_enum AS ENUM ('completed', 'in_progress', 'not_done', 'entered_in_error');

-- ── HELPER: auto-update updated_at ─────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════
-- CORE TABLES
-- ════════════════════════════════════════════════════════════

CREATE TABLE patient (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          TEXT NOT NULL DEFAULT 'manual',
  source_id       TEXT,                              -- external ID (bwell, ABDM, NHS number)
  first_name      TEXT,
  last_name       TEXT,
  date_of_birth   DATE,
  gender          gender_enum,
  email           TEXT,
  phone           TEXT,
  address_line    TEXT,
  address_city    TEXT,
  address_state   TEXT,
  address_zip     TEXT,
  address_country TEXT DEFAULT 'US',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER patient_updated_at BEFORE UPDATE ON patient
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


CREATE TABLE data_source (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id          UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_type         source_type_enum NOT NULL,
  provider            TEXT NOT NULL,                  -- 'bwell', 'terra_oura', 'apple_health', etc.
  provider_name       TEXT,                           -- "UCLA Health", "Oura Ring"
  connection_status   connection_status_enum NOT NULL DEFAULT 'disconnected',
  last_sync_at        TIMESTAMPTZ,
  next_sync_at        TIMESTAMPTZ,
  sync_frequency      sync_frequency_enum DEFAULT 'daily',
  access_token_enc    BYTEA,                          -- pgcrypto encrypted
  refresh_token_enc   BYTEA,
  token_expires_at    TIMESTAMPTZ,
  config              JSONB DEFAULT '{}',             -- source-specific config
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ds_patient ON data_source(patient_id);
CREATE INDEX idx_ds_provider ON data_source(provider);
CREATE INDEX idx_ds_status ON data_source(connection_status);

CREATE TRIGGER data_source_updated_at BEFORE UPDATE ON data_source
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ════════════════════════════════════════════════════════════
-- VITAL SIGNS
-- Sources: Wearables (1-5 min), EHR (per visit), CGM (5 min)
-- ════════════════════════════════════════════════════════════

CREATE TABLE vital_signs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id             UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id               TEXT,
  recorded_at           TIMESTAMPTZ NOT NULL,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Heart
  heart_rate            SMALLINT CHECK (heart_rate BETWEEN 20 AND 300),               -- bpm
  heart_rate_resting    SMALLINT CHECK (heart_rate_resting BETWEEN 20 AND 150),       -- bpm
  hrv_sdnn              REAL CHECK (hrv_sdnn BETWEEN 0 AND 500),                      -- ms
  hrv_rmssd             REAL CHECK (hrv_rmssd BETWEEN 0 AND 500),                     -- ms

  -- Blood Pressure
  bp_systolic           SMALLINT CHECK (bp_systolic BETWEEN 50 AND 300),              -- mmHg
  bp_diastolic          SMALLINT CHECK (bp_diastolic BETWEEN 20 AND 200),             -- mmHg
  bp_position           bp_position_enum,

  -- Respiratory
  respiratory_rate      REAL CHECK (respiratory_rate BETWEEN 4 AND 60),               -- breaths/min
  spo2                  REAL CHECK (spo2 BETWEEN 50 AND 100),                         -- %
  spo2_min_overnight    REAL CHECK (spo2_min_overnight BETWEEN 50 AND 100),           -- %

  -- Temperature
  body_temperature      REAL CHECK (body_temperature BETWEEN 30 AND 45),              -- °C
  skin_temperature_dev  REAL CHECK (skin_temperature_dev BETWEEN -5 AND 5),           -- °C deviation

  -- Glucose
  blood_glucose         REAL CHECK (blood_glucose BETWEEN 20 AND 600),                -- mg/dL
  blood_glucose_type    glucose_type_enum,

  metadata              JSONB DEFAULT '{}'
);

CREATE INDEX idx_vitals_patient_date ON vital_signs(patient_id, recorded_at DESC);
CREATE INDEX idx_vitals_source ON vital_signs(source_id);
CREATE INDEX idx_vitals_recorded ON vital_signs(recorded_at DESC);
-- Partial indexes for common queries
CREATE INDEX idx_vitals_hr ON vital_signs(patient_id, recorded_at DESC) WHERE heart_rate IS NOT NULL;
CREATE INDEX idx_vitals_bp ON vital_signs(patient_id, recorded_at DESC) WHERE bp_systolic IS NOT NULL;
CREATE INDEX idx_vitals_glucose ON vital_signs(patient_id, recorded_at DESC) WHERE blood_glucose IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- BODY MEASUREMENTS
-- Sources: Smart scale (daily), EHR (per visit)
-- ════════════════════════════════════════════════════════════

CREATE TABLE body_measurements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  weight_kg         REAL CHECK (weight_kg BETWEEN 1 AND 500),          -- kg
  height_cm         REAL CHECK (height_cm BETWEEN 30 AND 300),         -- cm
  bmi               REAL GENERATED ALWAYS AS (
                      CASE WHEN height_cm > 0 AND weight_kg > 0
                        THEN ROUND((weight_kg / ((height_cm/100.0) * (height_cm/100.0)))::NUMERIC, 1)
                        ELSE NULL END
                    ) STORED,                                           -- kg/m² (auto-computed)
  body_fat_pct      REAL CHECK (body_fat_pct BETWEEN 1 AND 70),       -- %
  lean_mass_kg      REAL CHECK (lean_mass_kg BETWEEN 1 AND 200),      -- kg
  bone_mass_kg      REAL CHECK (bone_mass_kg BETWEEN 0.5 AND 10),     -- kg
  water_pct         REAL CHECK (water_pct BETWEEN 20 AND 80),         -- %
  waist_cm          REAL CHECK (waist_cm BETWEEN 30 AND 250),         -- cm
  hip_cm            REAL CHECK (hip_cm BETWEEN 40 AND 250),           -- cm
  waist_hip_ratio   REAL GENERATED ALWAYS AS (
                      CASE WHEN hip_cm > 0 AND waist_cm > 0
                        THEN ROUND((waist_cm / hip_cm)::NUMERIC, 3)
                        ELSE NULL END
                    ) STORED,                                           -- auto-computed

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_body_patient_date ON body_measurements(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- SLEEP
-- Sources: Oura, WHOOP, Apple Watch, Garmin, Fitbit — nightly
-- ════════════════════════════════════════════════════════════

CREATE TABLE sleep (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id             UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  recorded_at           DATE NOT NULL,                                       -- night of
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  sleep_start           TIMESTAMPTZ,
  sleep_end             TIMESTAMPTZ,
  total_sleep_min       SMALLINT CHECK (total_sleep_min BETWEEN 0 AND 1440),
  time_in_bed_min       SMALLINT CHECK (time_in_bed_min BETWEEN 0 AND 1440),
  sleep_latency_min     SMALLINT CHECK (sleep_latency_min >= 0),
  awake_min             SMALLINT CHECK (awake_min >= 0),

  -- Stages
  rem_min               SMALLINT CHECK (rem_min >= 0),
  deep_min              SMALLINT CHECK (deep_min >= 0),
  light_min             SMALLINT CHECK (light_min >= 0),

  -- Quality
  sleep_efficiency      REAL CHECK (sleep_efficiency BETWEEN 0 AND 100),    -- %
  sleep_score           SMALLINT CHECK (sleep_score BETWEEN 0 AND 100),
  restfulness_score     SMALLINT CHECK (restfulness_score BETWEEN 0 AND 100),

  -- Biometrics during sleep
  avg_hr_sleep          REAL CHECK (avg_hr_sleep BETWEEN 20 AND 150),       -- bpm
  min_hr_sleep          REAL CHECK (min_hr_sleep BETWEEN 20 AND 150),       -- bpm
  avg_hrv_sleep         REAL CHECK (avg_hrv_sleep BETWEEN 0 AND 500),       -- ms
  avg_spo2_sleep        REAL CHECK (avg_spo2_sleep BETWEEN 50 AND 100),     -- %
  avg_resp_rate_sleep   REAL CHECK (avg_resp_rate_sleep BETWEEN 4 AND 40),  -- breaths/min
  avg_skin_temp_sleep   REAL CHECK (avg_skin_temp_sleep BETWEEN 25 AND 42), -- °C

  metadata              JSONB DEFAULT '{}',

  UNIQUE(patient_id, source_id, recorded_at)          -- one sleep record per source per night
);

CREATE INDEX idx_sleep_patient_date ON sleep(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- ACTIVITY
-- Sources: All wearables — daily summary
-- ════════════════════════════════════════════════════════════

CREATE TABLE activity (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  recorded_at       DATE NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  steps             INTEGER CHECK (steps >= 0),
  distance_m        REAL CHECK (distance_m >= 0),
  floors_climbed    SMALLINT CHECK (floors_climbed >= 0),

  calories_total    INTEGER CHECK (calories_total >= 0),                   -- kcal
  calories_active   INTEGER CHECK (calories_active >= 0),
  calories_bmr      INTEGER CHECK (calories_bmr >= 0),

  active_min        SMALLINT CHECK (active_min >= 0),
  moderate_min      SMALLINT CHECK (moderate_min >= 0),
  vigorous_min      SMALLINT CHECK (vigorous_min >= 0),
  sedentary_min     SMALLINT CHECK (sedentary_min >= 0),

  -- Device scores
  activity_score    SMALLINT CHECK (activity_score BETWEEN 0 AND 100),     -- Oura
  strain_score      REAL CHECK (strain_score BETWEEN 0 AND 21),            -- WHOOP
  recovery_score    SMALLINT CHECK (recovery_score BETWEEN 0 AND 100),     -- WHOOP
  body_battery      SMALLINT CHECK (body_battery BETWEEN 0 AND 100),       -- Garmin
  readiness_score   SMALLINT CHECK (readiness_score BETWEEN 0 AND 100),    -- Oura
  stress_score      SMALLINT CHECK (stress_score BETWEEN 0 AND 100),       -- Garmin

  training_volume   REAL,
  vo2_max           REAL CHECK (vo2_max BETWEEN 10 AND 100),               -- mL/kg/min

  metadata          JSONB DEFAULT '{}',

  UNIQUE(patient_id, source_id, recorded_at)
);

CREATE INDEX idx_activity_patient_date ON activity(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- LAB REFERENCE (lookup table — pre-populated)
-- ════════════════════════════════════════════════════════════

CREATE TABLE lab_reference (
  id              SERIAL PRIMARY KEY,
  loinc_code      TEXT NOT NULL UNIQUE,
  test_name       TEXT NOT NULL,
  category        TEXT NOT NULL,                  -- metabolic, lipids, thyroid, inflammatory, kidney, liver, hematology, vitamin, mineral, hormonal, cardiac, tumor_marker
  unit            TEXT NOT NULL,
  value_type      lab_value_type_enum NOT NULL DEFAULT 'numeric',
  reference_low   REAL,
  reference_high  REAL,
  optimal_low     REAL,
  optimal_high    REAL,
  frequency       TEXT,                           -- quarterly, annually, semi_annually, once, as_needed
  description     TEXT
);

CREATE INDEX idx_labref_category ON lab_reference(category);

-- ════════════════════════════════════════════════════════════
-- LAB RESULTS
-- Sources: b.well (EHR), Quest, LabCorp, Function Health
-- ════════════════════════════════════════════════════════════

CREATE TABLE lab_results (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  lab_ref_id        INTEGER REFERENCES lab_reference(id),       -- FK to reference table
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,                       -- specimen collection
  reported_at       TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  loinc_code        TEXT,
  test_name         TEXT NOT NULL,
  category          TEXT,

  value_numeric     REAL,
  value_string      TEXT,
  unit              TEXT,
  reference_low     REAL,
  reference_high    REAL,
  interpretation    lab_interpretation_enum,

  ordering_provider TEXT,
  performing_lab    TEXT,
  specimen_type     specimen_type_enum,
  is_fasting        BOOLEAN DEFAULT FALSE,

  metadata          JSONB DEFAULT '{}',

  -- Auto-link to lab_reference on insert
  CONSTRAINT lab_has_value CHECK (value_numeric IS NOT NULL OR value_string IS NOT NULL)
);

CREATE INDEX idx_labs_patient_date ON lab_results(patient_id, recorded_at DESC);
CREATE INDEX idx_labs_loinc ON lab_results(loinc_code);
CREATE INDEX idx_labs_category ON lab_results(category);
CREATE INDEX idx_labs_interpretation ON lab_results(patient_id, interpretation) WHERE interpretation IN ('abnormal', 'critical', 'high', 'low');

-- Auto-populate lab_ref_id from loinc_code
CREATE OR REPLACE FUNCTION auto_link_lab_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.loinc_code IS NOT NULL AND NEW.lab_ref_id IS NULL THEN
    SELECT id INTO NEW.lab_ref_id FROM lab_reference WHERE loinc_code = NEW.loinc_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lab_results_auto_ref BEFORE INSERT OR UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION auto_link_lab_reference();

-- ════════════════════════════════════════════════════════════
-- CONDITIONS / DIAGNOSES
-- ════════════════════════════════════════════════════════════

CREATE TABLE conditions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,          -- onset
  resolved_at       TIMESTAMPTZ,                   -- NULL if active
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  icd10_code        TEXT,
  snomed_code       TEXT,
  display_name      TEXT NOT NULL,
  category          TEXT,                           -- encounter-diagnosis, problem-list-item
  clinical_status   clinical_status_enum DEFAULT 'active',
  severity          severity_enum,
  body_site         TEXT,
  notes             TEXT,

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_cond_patient ON conditions(patient_id);
CREATE INDEX idx_cond_status ON conditions(patient_id, clinical_status);
CREATE INDEX idx_cond_icd ON conditions(icd10_code);
-- Active conditions (most common query)
CREATE INDEX idx_cond_active ON conditions(patient_id) WHERE clinical_status = 'active';

-- ════════════════════════════════════════════════════════════
-- MEDICATIONS
-- ════════════════════════════════════════════════════════════

CREATE TABLE medications (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  rxnorm_code       TEXT,
  ndc_code          TEXT,
  medication_name   TEXT NOT NULL,
  generic_name      TEXT,
  brand_name        TEXT,
  status            med_status_enum DEFAULT 'active',
  category          TEXT,                           -- inpatient, outpatient, community

  dose_value        REAL CHECK (dose_value > 0),
  dose_unit         TEXT,                           -- mg, mL, mcg, units, puffs
  frequency         TEXT,                           -- QD, BID, TID, QID, PRN, weekly, q4h
  route             TEXT,                           -- oral, topical, injection, inhalation, IV, sublingual
  form              TEXT,                           -- tablet, capsule, liquid, cream, patch, injection

  start_date        DATE,
  end_date          DATE,
  prescriber        TEXT,
  pharmacy          TEXT,
  refills_remaining SMALLINT CHECK (refills_remaining >= 0),

  notes             TEXT,
  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_meds_patient ON medications(patient_id);
CREATE INDEX idx_meds_active ON medications(patient_id) WHERE status = 'active';
CREATE INDEX idx_meds_rxnorm ON medications(rxnorm_code);

-- ════════════════════════════════════════════════════════════
-- ALLERGIES
-- ════════════════════════════════════════════════════════════

CREATE TABLE allergies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  allergen_code     TEXT,
  allergen_name     TEXT NOT NULL,
  allergen_type     allergy_type_enum,
  clinical_status   clinical_status_enum DEFAULT 'active',
  verification      verification_enum DEFAULT 'confirmed',
  criticality       criticality_enum,
  reaction_type     TEXT,                           -- allergy, intolerance
  manifestation     TEXT[],                         -- array: rash, anaphylaxis, hives, etc.
  severity          severity_enum,
  onset_date        DATE,
  notes             TEXT,

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_allergy_patient ON allergies(patient_id);
CREATE INDEX idx_allergy_active ON allergies(patient_id) WHERE clinical_status = 'active';

-- ════════════════════════════════════════════════════════════
-- IMMUNIZATIONS
-- ════════════════════════════════════════════════════════════

CREATE TABLE immunizations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       DATE NOT NULL,                  -- administration date
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  cvx_code          TEXT,
  vaccine_name      TEXT NOT NULL,
  manufacturer      TEXT,
  lot_number        TEXT,
  dose_number       SMALLINT CHECK (dose_number > 0),
  series_name       TEXT,
  site              TEXT,
  route             TEXT,
  status            TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'not_done')),
  administering_org TEXT,
  notes             TEXT,

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_imm_patient ON immunizations(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- ENCOUNTERS / VISITS
-- ════════════════════════════════════════════════════════════

CREATE TABLE encounters (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  encounter_type    TEXT,                           -- office_visit, er, inpatient, telehealth, lab_visit
  class             encounter_class_enum,
  status            encounter_status_enum DEFAULT 'finished',
  reason            TEXT,
  provider_name     TEXT,
  provider_specialty TEXT,
  facility_name     TEXT,
  facility_type     TEXT,

  diagnoses         JSONB DEFAULT '[]',             -- [{icd10, display}]
  procedures_json   JSONB DEFAULT '[]',             -- [{cpt, display}]
  discharge_status  TEXT,

  notes             TEXT,
  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_enc_patient_date ON encounters(patient_id, recorded_at DESC);
CREATE INDEX idx_enc_status ON encounters(status);

-- ════════════════════════════════════════════════════════════
-- PROCEDURES
-- ════════════════════════════════════════════════════════════

CREATE TABLE procedures (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  encounter_id      UUID REFERENCES encounters(id), -- optional link to encounter
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  cpt_code          TEXT,
  snomed_code       TEXT,
  procedure_name    TEXT NOT NULL,
  category          procedure_category_enum,
  status            procedure_status_enum DEFAULT 'completed',
  body_site         TEXT,
  performer         TEXT,
  facility          TEXT,
  outcome           TEXT,
  notes             TEXT,

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_proc_patient ON procedures(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- CARE PLANS
-- ════════════════════════════════════════════════════════════

CREATE TABLE care_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id        UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  fhir_id           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  title             TEXT NOT NULL,
  status            TEXT CHECK (status IN ('active', 'completed', 'revoked', 'on_hold', 'draft')),
  intent            TEXT CHECK (intent IN ('plan', 'order', 'proposal', 'option')),
  category          TEXT,
  description       TEXT,
  start_date        DATE,
  end_date          DATE,
  addressed_conditions JSONB DEFAULT '[]',          -- [{condition_id, display}]
  goals             JSONB DEFAULT '[]',
  activities        JSONB DEFAULT '[]',
  care_team         JSONB DEFAULT '[]',             -- [{name, role, specialty}]

  metadata          JSONB DEFAULT '{}'
);

CREATE INDEX idx_cp_patient ON care_plans(patient_id);
CREATE INDEX idx_cp_active ON care_plans(patient_id) WHERE status = 'active';

-- ════════════════════════════════════════════════════════════
-- GENOMIC VARIANTS
-- Sources: 23andMe, Illumina, Foundation Medicine — once
-- ════════════════════════════════════════════════════════════

CREATE TABLE genomic_variants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id             UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  recorded_at           DATE NOT NULL,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  gene                  TEXT NOT NULL,
  rsid                  TEXT,
  chromosome            TEXT CHECK (chromosome ~ '^chr([1-9]|1[0-9]|2[0-2]|X|Y|M)$'),
  position              BIGINT,
  ref_allele            TEXT,
  alt_allele            TEXT,
  genotype              TEXT,                         -- AG, CC, CT
  zygosity              zygosity_enum,

  clinical_significance clinical_significance_enum,
  condition             TEXT,
  inheritance           TEXT,
  is_pharmacogenomic    BOOLEAN DEFAULT FALSE,

  metadata              JSONB DEFAULT '{}'
);

CREATE INDEX idx_gen_patient ON genomic_variants(patient_id);
CREATE INDEX idx_gen_gene ON genomic_variants(gene);
CREATE INDEX idx_gen_pathogenic ON genomic_variants(patient_id)
  WHERE clinical_significance IN ('pathogenic', 'likely_pathogenic');
CREATE INDEX idx_gen_pgx ON genomic_variants(patient_id) WHERE is_pharmacogenomic = TRUE;

-- ════════════════════════════════════════════════════════════
-- MICROBIOME
-- Sources: Viome, Gut.id, ZOE, Tiny Health — 1-4x/year
-- ════════════════════════════════════════════════════════════

CREATE TABLE microbiome (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  source_id             UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  recorded_at           DATE NOT NULL,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  sample_type           TEXT CHECK (sample_type IN ('stool', 'oral', 'vaginal', 'skin')),
  test_type             TEXT CHECK (test_type IN ('16S', 'shotgun', 'metatranscriptomics')),

  shannon_diversity     REAL CHECK (shannon_diversity >= 0),
  simpson_diversity     REAL CHECK (simpson_diversity BETWEEN 0 AND 1),
  firmicutes_pct        REAL CHECK (firmicutes_pct BETWEEN 0 AND 100),
  bacteroidetes_pct     REAL CHECK (bacteroidetes_pct BETWEEN 0 AND 100),
  fb_ratio              REAL CHECK (fb_ratio >= 0),

  gut_health_score      SMALLINT CHECK (gut_health_score BETWEEN 0 AND 100),
  inflammation_score    REAL,
  metabolic_fitness     REAL,

  top_species           JSONB DEFAULT '[]',           -- [{name, abundance_pct}]
  top_genera            JSONB DEFAULT '[]',
  missing_beneficial    JSONB DEFAULT '[]',
  elevated_pathogenic   JSONB DEFAULT '[]',

  metadata              JSONB DEFAULT '{}'
);

CREATE INDEX idx_micro_patient ON microbiome(patient_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- DAILY SNAPSHOT (materialized aggregation)
-- Populated by a daily cron / trigger
-- ════════════════════════════════════════════════════════════

CREATE TABLE daily_snapshot (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id            UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  date                  DATE NOT NULL,

  -- Vitals
  resting_hr            REAL,
  hrv                   REAL,
  bp_systolic           REAL,
  bp_diastolic          REAL,
  spo2                  REAL,
  respiratory_rate      REAL,
  body_temp             REAL,

  -- Body
  weight_kg             REAL,
  bmi                   REAL,
  body_fat_pct          REAL,

  -- Sleep
  sleep_duration_min    SMALLINT,
  sleep_efficiency      REAL,
  sleep_score           SMALLINT,
  deep_sleep_min        SMALLINT,
  rem_sleep_min         SMALLINT,

  -- Activity
  steps                 INTEGER,
  active_calories       INTEGER,
  active_minutes        SMALLINT,
  strain                REAL,
  recovery              SMALLINT,
  readiness             SMALLINT,

  -- Metabolic (CGM)
  avg_glucose           REAL,
  glucose_variability   REAL,                         -- CV%
  time_in_range_pct     REAL,                         -- % time 70-180

  -- Sources present
  sources               TEXT[] DEFAULT '{}',          -- {'apple_health', 'oura', 'dexcom'}

  -- Agent-computed composite scores
  cardiovascular_score  SMALLINT CHECK (cardiovascular_score BETWEEN 0 AND 100),
  metabolic_score       SMALLINT CHECK (metabolic_score BETWEEN 0 AND 100),
  sleep_score_composite SMALLINT CHECK (sleep_score_composite BETWEEN 0 AND 100),
  activity_score_comp   SMALLINT CHECK (activity_score_comp BETWEEN 0 AND 100),
  overall_health_score  SMALLINT CHECK (overall_health_score BETWEEN 0 AND 100),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(patient_id, date)
);

CREATE INDEX idx_snap_patient_date ON daily_snapshot(patient_id, date DESC);

-- ════════════════════════════════════════════════════════════
-- BASELINES & DRIFT DETECTION
-- ════════════════════════════════════════════════════════════

CREATE TABLE baselines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL,                     -- 'resting_hr', 'hrv', 'weight_kg', etc.
  baseline_value  REAL NOT NULL,
  baseline_stddev REAL,
  window_days     SMALLINT DEFAULT 30,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_count    INTEGER,

  UNIQUE(patient_id, metric)
);

CREATE TABLE drift_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id      UUID NOT NULL REFERENCES patient(id) ON DELETE CASCADE,
  metric          TEXT NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  baseline_value  REAL,
  current_value   REAL,
  pct_change      REAL,
  severity        drift_severity_enum NOT NULL,
  direction       drift_direction_enum NOT NULL,
  message         TEXT,
  acknowledged    BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_drift_patient ON drift_alerts(patient_id, detected_at DESC);
CREATE INDEX idx_drift_unacked ON drift_alerts(patient_id) WHERE acknowledged = FALSE;

-- ════════════════════════════════════════════════════════════
-- SYNC LOG
-- ════════════════════════════════════════════════════════════

CREATE TABLE sync_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id       UUID NOT NULL REFERENCES data_source(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          sync_status_enum DEFAULT 'running',
  records_fetched INTEGER DEFAULT 0,
  records_stored  INTEGER DEFAULT 0,
  error_message   TEXT,
  duration_ms     INTEGER GENERATED ALWAYS AS (
                    CASE WHEN completed_at IS NOT NULL
                      THEN EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
                      ELSE NULL END
                  ) STORED
);

CREATE INDEX idx_sync_source ON sync_log(source_id, started_at DESC);
CREATE INDEX idx_sync_failures ON sync_log(source_id) WHERE status = 'failed';

-- ════════════════════════════════════════════════════════════
-- USEFUL VIEWS FOR APPLICATION LAYER
-- ════════════════════════════════════════════════════════════

-- Active medications with details
CREATE VIEW v_active_medications AS
SELECT m.*, ds.provider, ds.provider_name
FROM medications m
JOIN data_source ds ON m.source_id = ds.id
WHERE m.status = 'active';

-- Active conditions
CREATE VIEW v_active_conditions AS
SELECT c.*, ds.provider, ds.provider_name
FROM conditions c
JOIN data_source ds ON c.source_id = ds.id
WHERE c.clinical_status = 'active';

-- Active allergies
CREATE VIEW v_active_allergies AS
SELECT a.*, ds.provider, ds.provider_name
FROM allergies a
JOIN data_source ds ON a.source_id = ds.id
WHERE a.clinical_status = 'active';

-- Latest vitals per patient (most recent of each type)
CREATE VIEW v_latest_vitals AS
SELECT DISTINCT ON (patient_id)
  patient_id, recorded_at,
  heart_rate_resting, hrv_rmssd, bp_systolic, bp_diastolic,
  spo2, respiratory_rate, body_temperature, blood_glucose
FROM vital_signs
ORDER BY patient_id, recorded_at DESC;

-- Abnormal labs (for alerts)
CREATE VIEW v_abnormal_labs AS
SELECT lr.*, lr2.test_name AS ref_name, lr2.optimal_low, lr2.optimal_high
FROM lab_results lr
LEFT JOIN lab_reference lr2 ON lr.loinc_code = lr2.loinc_code
WHERE lr.interpretation IN ('abnormal', 'critical', 'high', 'low', 'very_high', 'very_low');

-- Unacknowledged drift alerts
CREATE VIEW v_pending_alerts AS
SELECT da.*, b.baseline_value AS current_baseline, b.baseline_stddev
FROM drift_alerts da
LEFT JOIN baselines b ON da.patient_id = b.patient_id AND da.metric = b.metric
WHERE da.acknowledged = FALSE
ORDER BY da.detected_at DESC;

-- Pathogenic genomic variants
CREATE VIEW v_pathogenic_variants AS
SELECT gv.*, ds.provider
FROM genomic_variants gv
JOIN data_source ds ON gv.source_id = ds.id
WHERE gv.clinical_significance IN ('pathogenic', 'likely_pathogenic');

-- Daily health trend (last 90 days) — main chart data source
CREATE VIEW v_health_trend_90d AS
SELECT * FROM daily_snapshot
WHERE date >= CURRENT_DATE - INTERVAL '90 days'
ORDER BY patient_id, date DESC;

-- ════════════════════════════════════════════════════════════
-- COMMENTS (for engineer documentation)
-- ════════════════════════════════════════════════════════════

COMMENT ON TABLE patient IS 'Single user profile per agent installation';
COMMENT ON TABLE data_source IS 'Connected health data providers (EHR, wearable, lab). FK to patient.';
COMMENT ON TABLE vital_signs IS 'High-frequency vitals: HR, HRV, BP, SpO2, temp, glucose. Up to every 5 min.';
COMMENT ON TABLE body_measurements IS 'Weight, height, BMI (auto-computed), body composition. Daily from smart scale.';
COMMENT ON TABLE sleep IS 'Nightly sleep records: duration, stages, quality scores, biometrics during sleep.';
COMMENT ON TABLE activity IS 'Daily activity summaries: steps, calories, active time, device scores (WHOOP strain, Oura readiness).';
COMMENT ON TABLE lab_reference IS 'Lookup table: 60+ common lab tests with LOINC codes, units, normal ranges, optimal ranges.';
COMMENT ON TABLE lab_results IS 'Individual lab test results. FK to lab_reference via loinc_code (auto-linked by trigger).';
COMMENT ON TABLE conditions IS 'Diagnoses from EHR. ICD-10 + SNOMED coded. Partial index on active conditions.';
COMMENT ON TABLE medications IS 'Prescriptions: drug name, dose, frequency, route, status. Partial index on active meds.';
COMMENT ON TABLE allergies IS 'Allergy/intolerance records. Manifestation stored as TEXT[] array.';
COMMENT ON TABLE immunizations IS 'Vaccination records with CVX codes, dose numbers, manufacturer.';
COMMENT ON TABLE encounters IS 'Clinical visits: type, class, reason, provider, facility. Diagnoses/procedures as JSONB.';
COMMENT ON TABLE procedures IS 'Medical procedures with CPT/SNOMED codes. Optional FK to encounters.';
COMMENT ON TABLE care_plans IS 'Active care plans: goals, activities, care team as JSONB arrays.';
COMMENT ON TABLE genomic_variants IS 'Genetic variants: gene, rsID, genotype, clinical significance. Partial index on pathogenic.';
COMMENT ON TABLE microbiome IS 'Gut microbiome results: diversity scores, taxa abundance, health scores.';
COMMENT ON TABLE daily_snapshot IS 'Materialized daily aggregation of all sources. Powers the dashboard charts.';
COMMENT ON TABLE baselines IS '30-day rolling averages per metric. Used for drift detection.';
COMMENT ON TABLE drift_alerts IS 'Generated when a metric deviates from baseline. Severity: info/warning/critical.';
COMMENT ON TABLE sync_log IS 'Audit trail: every data fetch operation. Duration auto-computed.';

COMMENT ON VIEW v_active_medications IS 'Currently active medications with source provider info.';
COMMENT ON VIEW v_active_conditions IS 'Currently active diagnoses/conditions.';
COMMENT ON VIEW v_latest_vitals IS 'Most recent vital signs per patient (single row).';
COMMENT ON VIEW v_abnormal_labs IS 'Lab results flagged as abnormal/critical with reference ranges.';
COMMENT ON VIEW v_pending_alerts IS 'Unacknowledged drift alerts with current baseline context.';
COMMENT ON VIEW v_health_trend_90d IS 'Last 90 days of daily snapshots — primary data source for dashboard charts.';
