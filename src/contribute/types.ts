// ============================================================
// XSpan Contribute — Research Data Contribution Program Types
// Internal module name: contribute
// User-facing name: "XSpan Contribute"
// ============================================================

// ── De-Identified Dataset ────────────────────────────────────

export interface DeidentifiedDataset {
  datasetId: string;                    // Random UUID (no link to user)
  version: string;                      // Schema version
  demographics: {
    ageRange: string;                   // "30-34", "35-39", etc.
    sex: 'M' | 'F' | 'unknown';
    zip3: string | null;                // First 3 digits of ZIP, null if pop < 20K
  };
  snapshots: DeidentifiedSnapshot[];
  tags: string[];                       // ["cardiovascular", "metabolic", "sleep"]
  completenessAvg: number;              // 0-100
  daySpan: number;                      // Total days covered
  createdAt: string;                    // ISO timestamp of de-identification run
}

export interface DeidentifiedSnapshot {
  dayOffset: number;                    // Relative day from random epoch (+ jitter)

  // Cardiovascular
  restingHeartRate?: number;
  heartRateVariability?: number;        // With Laplacian noise
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  vo2Max?: number;

  // Metabolic
  bloodGlucoseFasting?: number;
  bodyMassIndex?: number;               // Rounded to nearest 0.5
  bodyFatPercentage?: number;           // Rounded to nearest 2%

  // Sleep
  totalSleepMinutes?: number;
  deepSleepMinutes?: number;
  remSleepMinutes?: number;
  sleepEfficiency?: number;

  // Activity
  dailySteps?: number;                  // Rounded to nearest 500
  activeMinutes?: number;
  activeCalories?: number;              // Rounded to nearest 50

  // Nutrition (7-day averages)
  avgDailyCalories?: number;            // Rounded to nearest 50
  avgProteinGrams?: number;
  avgCarbGrams?: number;
  avgFatGrams?: number;
  avgFiberGrams?: number;

  // Labs
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
  crp?: number;
  homocysteine?: number;

  // Risk Scores (0-100)
  cardiovascularRisk?: number;
  metabolicRisk?: number;
  sleepDisorderRisk?: number;
  burnoutRisk?: number;

  // Genomics Risk Tiers (NOT raw variants)
  genomicsRiskTiers?: Record<string, 'low' | 'medium' | 'high'>;

  dataCompleteness: number;             // 0-1
}

// ── Contribution Listing ──────────────────────────────────────

export interface ContributionListing {
  datasetId: string;                    // On-chain bytes32
  seller: string;                       // Wallet address
  partner: string | null;               // Health System Partner wallet (null if direct)
  ipfsCid: string;                      // IPFS content identifier
  contentHash: string;                  // SHA-256 of unencrypted data
  priceUsdc: number;                    // Price in USDC (human-readable, not 6-decimal)
  tags: string[];
  snapshotCount: number;
  daySpan: number;
  completenessAvg: number;
  demographicBucket: string;            // "30-34_M_972"
  active: boolean;
  listedAt: string;
  updatedAt: string;
}

// ── Purchase ─────────────────────────────────────────────────

export type PurchaseStatus = 'pending' | 'delivered' | 'disputed' | 'refunded';

export interface ContributionAccessGrant {
  purchaseId: string;
  datasetId: string;
  buyer: string;
  amountUsdc: number;
  status: PurchaseStatus;
  purchasedAt: string;
  deliveredAt: string | null;
}

// ── Revenue Split ────────────────────────────────────────────

export interface RevenueSplit {
  sellerAmount: number;
  partnerAmount: number;
  protocolAmount: number;
  communityAmount: number;
  totalAmount: number;
}

export const REVENUE_SPLIT = {
  SELLER_BPS: 5000,                     // 50%
  PARTNER_BPS: 2000,                    // 20%
  PROTOCOL_BPS_WITH_PARTNER: 2500,      // 25%
  PROTOCOL_BPS_NO_PARTNER: 4500,        // 45%
  COMMUNITY_BPS: 500,                   // 5%
} as const;

export function calculateRevenueSplit(amountUsdc: number, hasPartner: boolean): RevenueSplit {
  const seller = (amountUsdc * REVENUE_SPLIT.SELLER_BPS) / 10_000;
  const community = (amountUsdc * REVENUE_SPLIT.COMMUNITY_BPS) / 10_000;
  const partner = hasPartner ? (amountUsdc * REVENUE_SPLIT.PARTNER_BPS) / 10_000 : 0;
  const protocol = amountUsdc - seller - partner - community;

  return {
    sellerAmount: seller,
    partnerAmount: partner,
    protocolAmount: protocol,
    communityAmount: community,
    totalAmount: amountUsdc,
  };
}

// ── Consent ──────────────────────────────────────────────────

export interface ContributeConsent {
  version: number;
  consentHash: string;                  // SHA-256 of consent document
  grantedAt: string;
  revokedAt: string | null;
  active: boolean;
  txHash: string;                       // On-chain transaction hash
}

// ── Earnings ─────────────────────────────────────────────────

export interface EarningsSummary {
  totalEarningsUsdc: number;
  totalSales: number;
  activeListings: number;
  pendingPayouts: number;
  lastSaleAt: string | null;
}

// ── Contribute Configuration ─────────────────────────────────

export interface ContributeConfig {
  enabled: boolean;
  walletPath: string;                   // ~/.xspan/wallet/
  baseRpcUrl: string;
  paymasterUrl: string;
  ipfsGatewayUrl: string;
  ipfsApiKey: string;
  ipfsApiSecret: string;
  contracts: {
    consentRegistry: string;
    buyerAccessControl: string;
    dataRegistry: string;
    dataExchange: string;
    usdc: string;
  };
  consentVersion: number;
  partnerAddress: string | null;        // Health System Partner wallet
  autoListEnabled: boolean;             // Auto-list monthly
  defaultPriceUsdc: number;
  selectedCategories: string[];
}

// ── De-identification Config ──────────────────────────────────

export interface DeidentificationConfig {
  kAnonymityThreshold: number;          // Default: 5
  differentialPrivacyEpsilon: number;   // Default: 1.0
  temporalJitterDays: number;           // Default: 3
  roundingConfig: {
    steps: number;                      // Round to nearest N (default: 500)
    calories: number;                   // Round to nearest N (default: 50)
    bmi: number;                        // Round to nearest N (default: 0.5)
    bodyFat: number;                    // Round to nearest N (default: 2)
    weight: number;                     // Round to nearest N kg (default: 5)
  };
}

export const DEFAULT_DEIDENTIFICATION_CONFIG: DeidentificationConfig = {
  kAnonymityThreshold: 5,
  differentialPrivacyEpsilon: 1.0,
  temporalJitterDays: 3,
  roundingConfig: {
    steps: 500,
    calories: 50,
    bmi: 0.5,
    bodyFat: 2,
    weight: 5,
  },
};
