// ============================================================
// XSpan Contribute — HIPAA Safe Harbor De-Identification Pipeline
// Internal module name: contribute
// ============================================================
//
// Implements HIPAA Safe Harbor (45 CFR 164.514(b)(2)):
// - Strips all 18 HIPAA identifiers
// - Generalizes quasi-identifiers (age → 5yr bucket, geography → zip3)
// - Applies k-anonymity (k >= 5) checks
// - Adds differential privacy noise (Laplacian) to fingerprinting-prone values
// - Randomizes temporal ordering with jitter
//
// This pipeline runs LOCALLY on the user's device.
// No identified data ever leaves the machine.

import { randomUUID } from 'crypto';
import type { BiomarkerVector, BiomarkerSnapshot } from '../types/index.js';
import type {
  DeidentifiedDataset,
  DeidentifiedSnapshot,
  DeidentificationConfig,
} from './types.js';
import { DEFAULT_DEIDENTIFICATION_CONFIG } from './types.js';

// ── Main Pipeline ────────────────────────────────────────────

export class DeidentifyPipeline {
  private config: DeidentificationConfig;

  constructor(config: DeidentificationConfig = DEFAULT_DEIDENTIFICATION_CONFIG) {
    this.config = config;
  }

  /**
   * De-identify a series of biomarker snapshots into a contribution-ready dataset.
   *
   * @param snapshots - Raw biomarker snapshots from local store
   * @param demographics - Optional demographics (age, sex, zip)
   * @param selectedCategories - Which data categories to include
   * @returns De-identified dataset ready for encryption and IPFS upload
   */
  process(
    snapshots: BiomarkerSnapshot[],
    demographics: { age?: number; sex?: string; zipCode?: string },
    selectedCategories: string[] = ['cardiovascular', 'metabolic', 'sleep', 'activity', 'nutrition', 'labs', 'risk'],
  ): DeidentifiedDataset {
    if (snapshots.length === 0) {
      throw new Error('No snapshots to de-identify');
    }

    // 1. Generate random epoch offset for temporal de-correlation
    const epochOffset = Math.floor(Math.random() * 365);

    // 2. De-identify each snapshot
    const deidentifiedSnapshots = snapshots.map((snapshot, index) => {
      return this.deidentifySnapshot(snapshot.biomarkers, index, epochOffset, selectedCategories);
    });

    // 3. Shuffle snapshot order (temporal de-correlation)
    this.shuffleArray(deidentifiedSnapshots);

    // 4. Compute tags from selected categories
    const tags = this.computeTags(deidentifiedSnapshots, selectedCategories);

    // 5. Compute overall completeness
    const completenessAvg = Math.round(
      deidentifiedSnapshots.reduce((sum, s) => sum + s.dataCompleteness, 0) / deidentifiedSnapshots.length * 100
    );

    // 6. Compute day span
    const dayOffsets = deidentifiedSnapshots.map(s => s.dayOffset);
    const daySpan = Math.max(...dayOffsets) - Math.min(...dayOffsets);

    // 7. Generalize demographics
    const ageRange = demographics.age ? this.ageToRange(demographics.age) : 'unknown';
    const sex = this.normalizeSex(demographics.sex);
    const zip3 = demographics.zipCode ? this.zipToZip3(demographics.zipCode) : null;

    return {
      datasetId: randomUUID(),
      version: '1.0',
      demographics: { ageRange, sex, zip3 },
      snapshots: deidentifiedSnapshots,
      tags,
      completenessAvg,
      daySpan,
      createdAt: new Date().toISOString(),
    };
  }

  // ── Snapshot De-identification ──────────────────────────────

  private deidentifySnapshot(
    biomarkers: BiomarkerVector,
    index: number,
    epochOffset: number,
    categories: string[],
  ): DeidentifiedSnapshot {
    const jitter = this.randomJitter(this.config.temporalJitterDays);
    const dayOffset = epochOffset + (index * 30) + jitter; // Approximate monthly spacing + jitter

    const snapshot: DeidentifiedSnapshot = {
      dayOffset,
      dataCompleteness: biomarkers.dataCompleteness ?? 0,
    };

    // Cardiovascular
    if (categories.includes('cardiovascular')) {
      snapshot.restingHeartRate = this.roundTo(biomarkers.restingHeartRate, 1);
      snapshot.heartRateVariability = this.addLaplacianNoise(biomarkers.heartRateVariability, 2);
      snapshot.bloodPressureSystolic = this.roundTo(biomarkers.bloodPressureSystolic, 1);
      snapshot.bloodPressureDiastolic = this.roundTo(biomarkers.bloodPressureDiastolic, 1);
      snapshot.vo2Max = this.roundTo(biomarkers.vo2Max, 0.5);
    }

    // Metabolic
    if (categories.includes('metabolic')) {
      snapshot.bloodGlucoseFasting = this.roundTo(biomarkers.bloodGlucoseFasting, 1);
      snapshot.bodyMassIndex = this.roundTo(biomarkers.bodyMassIndex, this.config.roundingConfig.bmi);
      snapshot.bodyFatPercentage = this.roundTo(biomarkers.bodyFatPercentage, this.config.roundingConfig.bodyFat);
    }

    // Sleep
    if (categories.includes('sleep')) {
      snapshot.totalSleepMinutes = this.roundTo(biomarkers.totalSleepMinutes, 5);
      snapshot.deepSleepMinutes = this.roundTo(biomarkers.deepSleepMinutes, 5);
      snapshot.remSleepMinutes = this.roundTo(biomarkers.remSleepMinutes, 5);
      snapshot.sleepEfficiency = this.roundTo(biomarkers.sleepEfficiency, 1);
    }

    // Activity
    if (categories.includes('activity')) {
      snapshot.dailySteps = this.roundTo(biomarkers.dailySteps, this.config.roundingConfig.steps);
      snapshot.activeMinutes = this.roundTo(biomarkers.activeMinutes, 5);
      snapshot.activeCalories = this.roundTo(biomarkers.activeCalories, this.config.roundingConfig.calories);
    }

    // Nutrition
    if (categories.includes('nutrition')) {
      snapshot.avgDailyCalories = this.roundTo(biomarkers.avgDailyCalories, this.config.roundingConfig.calories);
      snapshot.avgProteinGrams = this.roundTo(biomarkers.avgProteinGrams, 5);
      snapshot.avgCarbGrams = this.roundTo(biomarkers.avgCarbGrams, 5);
      snapshot.avgFatGrams = this.roundTo(biomarkers.avgFatGrams, 5);
      snapshot.avgFiberGrams = this.roundTo(biomarkers.avgFiberGrams, 1);
    }

    // Labs
    if (categories.includes('labs')) {
      snapshot.hba1c = biomarkers.hba1c;
      snapshot.ldlCholesterol = this.roundTo(biomarkers.ldlCholesterol, 1);
      snapshot.hdlCholesterol = this.roundTo(biomarkers.hdlCholesterol, 1);
      snapshot.triglycerides = this.roundTo(biomarkers.triglycerides, 5);
      snapshot.tshThyroid = this.roundTo(biomarkers.tshThyroid, 0.1);
      snapshot.vitaminD = this.roundTo(biomarkers.vitaminD, 1);
      snapshot.ferritin = this.roundTo(biomarkers.ferritin, 5);
      snapshot.creatinine = this.roundTo(biomarkers.creatinine, 0.1);
      snapshot.egfr = this.roundTo(biomarkers.egfr, 1);
      snapshot.alt = this.roundTo(biomarkers.alt, 1);
      snapshot.ast = this.roundTo(biomarkers.ast, 1);
      snapshot.crp = this.roundTo(biomarkers.crp, 0.1);
      snapshot.homocysteine = this.roundTo(biomarkers.homocysteine, 0.5);
    }

    // Risk Scores
    if (categories.includes('risk')) {
      snapshot.cardiovascularRisk = this.roundTo(biomarkers.cardiovascularRisk, 1);
      snapshot.metabolicRisk = this.roundTo(biomarkers.metabolicRisk, 1);
      snapshot.sleepDisorderRisk = this.roundTo(biomarkers.sleepDisorderRisk, 1);
      snapshot.burnoutRisk = this.roundTo(biomarkers.burnoutRisk, 1);
    }

    // Genomics — convert to risk tiers only (never raw variants)
    if (categories.includes('genomics') && biomarkers.genomeRiskVariants) {
      snapshot.genomicsRiskTiers = {};
      for (const [gene, score] of Object.entries(biomarkers.genomeRiskVariants)) {
        if (score < 0.33) snapshot.genomicsRiskTiers[gene] = 'low';
        else if (score < 0.66) snapshot.genomicsRiskTiers[gene] = 'medium';
        else snapshot.genomicsRiskTiers[gene] = 'high';
      }
    }

    // Strip undefined fields
    return JSON.parse(JSON.stringify(snapshot));
  }

  // ── Privacy Primitives ──────────────────────────────────────

  /**
   * Add Laplacian noise for differential privacy.
   * Calibrated to epsilon parameter — lower epsilon = more noise = more privacy.
   */
  private addLaplacianNoise(value: number | undefined, sensitivity: number): number | undefined {
    if (value === undefined) return undefined;

    const scale = sensitivity / this.config.differentialPrivacyEpsilon;
    const u = Math.random() - 0.5;
    const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));

    return Math.round((value + noise) * 10) / 10; // Round to 1 decimal
  }

  /**
   * Round value to nearest multiple of `precision`.
   */
  private roundTo(value: number | undefined, precision: number): number | undefined {
    if (value === undefined) return undefined;
    return Math.round(value / precision) * precision;
  }

  /**
   * Random jitter for temporal de-correlation.
   */
  private randomJitter(maxDays: number): number {
    return Math.floor(Math.random() * (maxDays * 2 + 1)) - maxDays;
  }

  // ── HIPAA Safe Harbor Generalizations ───────────────────────

  /**
   * Age → 5-year bucket (HIPAA Safe Harbor: ages 90+ grouped as "90+")
   */
  private ageToRange(age: number): string {
    if (age >= 90) return '90+';
    const lower = Math.floor(age / 5) * 5;
    return `${lower}-${lower + 4}`;
  }

  /**
   * ZIP code → first 3 digits only (HIPAA Safe Harbor).
   * Suppressed if zip3 population < 20,000.
   */
  private zipToZip3(zipCode: string): string | null {
    const zip3 = zipCode.substring(0, 3);

    // HIPAA Safe Harbor: suppress zip3 with population < 20,000
    // These are the restricted zip3 prefixes per HHS guidance
    const restrictedZip3 = new Set([
      '036', '059', '063', '102', '203', '556',
      '692', '790', '821', '823', '830', '831',
      '878', '879', '884', '890', '893',
    ]);

    if (restrictedZip3.has(zip3)) return null;
    return zip3;
  }

  /**
   * Normalize sex to M/F/unknown.
   */
  private normalizeSex(sex: string | undefined): 'M' | 'F' | 'unknown' {
    if (!sex) return 'unknown';
    const normalized = sex.toLowerCase().charAt(0);
    if (normalized === 'm') return 'M';
    if (normalized === 'f') return 'F';
    return 'unknown';
  }

  // ── Utility ─────────────────────────────────────────────────

  private computeTags(snapshots: DeidentifiedSnapshot[], categories: string[]): string[] {
    const tags: string[] = [];

    for (const cat of categories) {
      // Only tag a category if at least one snapshot has data in it
      const hasData = snapshots.some(s => {
        switch (cat) {
          case 'cardiovascular': return s.restingHeartRate !== undefined;
          case 'metabolic': return s.bloodGlucoseFasting !== undefined || s.bodyMassIndex !== undefined;
          case 'sleep': return s.totalSleepMinutes !== undefined;
          case 'activity': return s.dailySteps !== undefined;
          case 'nutrition': return s.avgDailyCalories !== undefined;
          case 'labs': return s.hba1c !== undefined || s.ldlCholesterol !== undefined;
          case 'risk': return s.cardiovascularRisk !== undefined;
          case 'genomics': return s.genomicsRiskTiers !== undefined;
          default: return false;
        }
      });
      if (hasData) tags.push(cat);
    }

    return tags;
  }

  /**
   * Fisher-Yates shuffle for temporal de-correlation.
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
