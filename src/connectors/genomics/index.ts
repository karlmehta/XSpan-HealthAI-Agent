import { randomUUID } from 'crypto';
import type { HealthSample, BiomarkerVector } from '../../types/index.js';

// ── Genomics Connector Interface ────────────────────────────────

export interface GenomicsCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: Date;
}

export interface GeneticVariant {
  rsid: string;            // e.g., "rs1801133"
  gene: string;            // e.g., "MTHFR"
  genotype: string;        // e.g., "CT"
  riskAllele?: string;     // e.g., "T"
  riskScore: number;       // 0-1 (0 = no risk allele, 1 = homozygous risk)
  category: string;        // e.g., "methylation", "cardiovascular", "metabolism"
  description?: string;
}

export interface GenomicsConnector {
  readonly name: string;
  connect(credentials: GenomicsCredentials): Promise<void>;
  getVariants(): Promise<GeneticVariant[]>;
  getRiskVariants(): Promise<Record<string, number>>;
  disconnect(): Promise<void>;
}

// ── Well-Known Genetic Risk Variants ────────────────────────────

/**
 * Clinically relevant SNPs that we map to health risk categories.
 * Each entry maps an rsID to its gene, risk allele, and category.
 */
const KNOWN_VARIANTS: Array<{
  rsid: string;
  gene: string;
  riskAllele: string;
  category: string;
  description: string;
}> = [
  // Methylation & B-Vitamins
  { rsid: 'rs1801133', gene: 'MTHFR', riskAllele: 'T', category: 'methylation', description: 'MTHFR C677T — reduced folate metabolism' },
  { rsid: 'rs1801131', gene: 'MTHFR', riskAllele: 'C', category: 'methylation', description: 'MTHFR A1298C — reduced folate metabolism' },

  // Cardiovascular
  { rsid: 'rs1333049', gene: '9p21', riskAllele: 'C', category: 'cardiovascular', description: '9p21 region — coronary artery disease risk' },
  { rsid: 'rs10757274', gene: '9p21', riskAllele: 'G', category: 'cardiovascular', description: '9p21 variant — MI risk' },
  { rsid: 'rs6025', gene: 'F5', riskAllele: 'A', category: 'cardiovascular', description: 'Factor V Leiden — thrombophilia risk' },

  // Lipid Metabolism
  { rsid: 'rs429358', gene: 'APOE', riskAllele: 'C', category: 'lipid_metabolism', description: 'APOE e4 allele — lipid and Alzheimer risk' },
  { rsid: 'rs7412', gene: 'APOE', riskAllele: 'C', category: 'lipid_metabolism', description: 'APOE variant — lipid metabolism' },

  // Glucose Metabolism
  { rsid: 'rs7903146', gene: 'TCF7L2', riskAllele: 'T', category: 'glucose_metabolism', description: 'TCF7L2 — type 2 diabetes risk' },
  { rsid: 'rs1801282', gene: 'PPARG', riskAllele: 'G', category: 'glucose_metabolism', description: 'PPARG Pro12Ala — insulin sensitivity' },

  // Caffeine Metabolism
  { rsid: 'rs762551', gene: 'CYP1A2', riskAllele: 'C', category: 'metabolism', description: 'CYP1A2 — slow caffeine metabolizer' },

  // Vitamin D
  { rsid: 'rs2282679', gene: 'GC', riskAllele: 'C', category: 'vitamin_d', description: 'GC protein — vitamin D binding and transport' },

  // Iron Metabolism
  { rsid: 'rs1800562', gene: 'HFE', riskAllele: 'A', category: 'iron_metabolism', description: 'HFE C282Y — hereditary hemochromatosis risk' },

  // Inflammation
  { rsid: 'rs1205', gene: 'CRP', riskAllele: 'T', category: 'inflammation', description: 'CRP variant — baseline inflammation levels' },

  // Sleep
  { rsid: 'rs73598374', gene: 'ADA', riskAllele: 'T', category: 'sleep', description: 'ADA — deep sleep duration' },
];

// ── 23andMe Connector ───────────────────────────────────────────

export class TwentyThreeAndMeConnector implements GenomicsConnector {
  readonly name = '23andMe';
  private credentials: GenomicsCredentials | null = null;
  private variants: GeneticVariant[] = [];

  async connect(credentials: GenomicsCredentials): Promise<void> {
    console.warn('[23andMe] 23andMe API integration coming in v1.2');
    console.warn('[23andMe] Requires 23andMe developer API access (OAuth2)');
    console.warn('[23andMe] Alternative: import raw data file via CLI');
    this.credentials = credentials;
  }

  async getVariants(): Promise<GeneticVariant[]> {
    if (!this.credentials) {
      throw new Error('23andMe connector not connected. Call connect() first.');
    }

    console.warn('[23andMe] Direct API variant fetch not yet implemented');

    // TODO v1.2: Call 23andMe API
    // OAuth2 flow: https://api.23andme.com/authorize
    // GET https://api.23andme.com/3/profile/{profile_id}/markers/
    // GET https://api.23andme.com/3/profile/{profile_id}/report/{report_id}/
    //
    // For raw data import (offline):
    // Parse the 23andMe raw data text file (tab-separated: rsid, chromosome, position, genotype)
    // Map rsIDs to our KNOWN_VARIANTS list

    return this.variants;
  }

  async getRiskVariants(): Promise<Record<string, number>> {
    const variants = await this.getVariants();
    return variantsToRiskMap(variants);
  }

  /**
   * Import variants from a 23andMe raw data file.
   * The file format is tab-separated: rsid, chromosome, position, genotype
   * Lines starting with # are comments.
   */
  async importRawDataFile(filePath: string): Promise<number> {
    console.warn(`[23andMe] Raw data import from ${filePath} coming in v1.2`);

    // TODO v1.2: Parse raw data file
    // const content = await fs.readFile(filePath, 'utf-8');
    // const lines = content.split('\n').filter(l => !l.startsWith('#') && l.trim());
    // for (const line of lines) {
    //   const [rsid, , , genotype] = line.split('\t');
    //   const known = KNOWN_VARIANTS.find(v => v.rsid === rsid);
    //   if (known) {
    //     const riskCount = countRiskAlleles(genotype, known.riskAllele);
    //     this.variants.push({ rsid, gene: known.gene, genotype, riskAllele: known.riskAllele,
    //       riskScore: riskCount / 2, category: known.category, description: known.description });
    //   }
    // }

    return 0;
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    this.variants = [];
    console.log('[23andMe] Disconnected');
  }
}

// ── Gut.id Connector ────────────────────────────────────────────

export class GutIdConnector implements GenomicsConnector {
  readonly name = 'Gut.id';
  private credentials: GenomicsCredentials | null = null;

  async connect(credentials: GenomicsCredentials): Promise<void> {
    console.warn('[Gut.id] Gut.id microbiome integration coming in v1.2');
    console.warn('[Gut.id] Will support gut microbiome diversity scores and species abundance');
    this.credentials = credentials;
  }

  async getVariants(): Promise<GeneticVariant[]> {
    if (!this.credentials) {
      throw new Error('Gut.id connector not connected. Call connect() first.');
    }

    console.warn('[Gut.id] Microbiome variant fetch not yet implemented');

    // TODO v1.2: Call Gut.id API
    // Gut.id provides microbiome sequencing data, not SNP genotyping.
    // We map microbiome diversity and species abundance to risk scores.
    //
    // Expected data:
    // - Alpha diversity (Shannon index)
    // - Firmicutes/Bacteroidetes ratio
    // - Key species abundance (Akkermansia, Faecalibacterium, etc.)
    // - Pathogen markers

    return [];
  }

  async getRiskVariants(): Promise<Record<string, number>> {
    const variants = await this.getVariants();
    return variantsToRiskMap(variants);
  }

  async disconnect(): Promise<void> {
    this.credentials = null;
    console.log('[Gut.id] Disconnected');
  }
}

// ── Utility Functions ───────────────────────────────────────────

/**
 * Convert a list of genetic variants to the genomeRiskVariants map
 * used by BiomarkerVector.
 *
 * Keys are "{gene}_{category}" (e.g., "MTHFR_methylation"),
 * values are risk scores (0-1).
 */
function variantsToRiskMap(variants: GeneticVariant[]): Record<string, number> {
  const riskMap: Record<string, number> = {};

  for (const v of variants) {
    const key = `${v.gene}_${v.category}`;
    // If multiple variants in same gene/category, take the max risk
    riskMap[key] = Math.max(riskMap[key] ?? 0, v.riskScore);
  }

  return riskMap;
}

/**
 * Merge genomics risk variants into a BiomarkerVector.
 * Call this after syncing genomics data to update the vector.
 */
export function mergeGenomicsIntoBiomarkers(
  vector: BiomarkerVector,
  riskVariants: Record<string, number>,
): BiomarkerVector {
  return {
    ...vector,
    genomeRiskVariants: {
      ...vector.genomeRiskVariants,
      ...riskVariants,
    },
  };
}

// ── Factory ─────────────────────────────────────────────────────

export type GenomicsProvider = '23andme' | 'gutid';

export function createGenomicsConnector(provider: GenomicsProvider): GenomicsConnector {
  switch (provider) {
    case '23andme':
      return new TwentyThreeAndMeConnector();
    case 'gutid':
      return new GutIdConnector();
    default:
      throw new Error(`Unknown genomics provider: ${provider}`);
  }
}

export { KNOWN_VARIANTS };
