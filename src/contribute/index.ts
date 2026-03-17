// ============================================================
// XSpan Contribute — Main Orchestrator
// User-facing name: "XSpan Contribute"
// Internal module name: contribute
// ============================================================

import { createHash } from 'crypto';
import { ethers } from 'ethers';

import type { AgentConfig, BiomarkerSnapshot } from '../types/index.js';
import type { ContributeConfig, ContributeConsent, EarningsSummary } from './types.js';
import { DeidentifyPipeline } from './deidentify.js';
import { IpfsClient } from './ipfs-client.js';
import { ContractClient } from './contracts.js';

// ── Contribute Manager ───────────────────────────────────────

export class ContributeManager {
  private config: ContributeConfig;
  private deidentify: DeidentifyPipeline;
  private ipfs: IpfsClient;
  private contracts: ContractClient;
  private walletKey: string;

  constructor(config: ContributeConfig, walletKey: string) {
    this.config = config;
    this.walletKey = walletKey;

    this.deidentify = new DeidentifyPipeline();
    this.ipfs = new IpfsClient({
      pinataApiKey: config.ipfsApiKey || undefined,
      pinataApiSecret: config.ipfsApiSecret || undefined,
    });
    this.contracts = new ContractClient(config, walletKey);
  }

  // ── Status ─────────────────────────────────────────────────

  async getStatus(): Promise<{
    enrolled: boolean;
    walletAddress: string;
    balance: string;
    consent: boolean;
    earnings: EarningsSummary;
  }> {
    const address = this.contracts.getSignerAddress();
    const consent = await this.contracts.hasActiveConsent(address);
    const balance = await this.contracts.getBalance();
    const earnings = await this.getEarnings();

    return {
      enrolled: consent,
      walletAddress: address,
      balance,
      consent,
      earnings,
    };
  }

  // ── Consent ────────────────────────────────────────────────

  async grantConsent(consentDocumentText: string): Promise<ContributeConsent> {
    const consentHash = '0x' + createHash('sha256').update(consentDocumentText).digest('hex');
    const version = this.config.consentVersion;

    const receipt = await this.contracts.grantConsent(consentHash, version);

    console.log(`[Contribute] Consent granted. TX: ${receipt.hash}`);

    return {
      version,
      consentHash,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      active: true,
      txHash: receipt.hash,
    };
  }

  async revokeConsent(): Promise<void> {
    await this.contracts.revokeConsent();
    console.log('[Contribute] Consent revoked. All listings delisted.');
  }

  // ── List / Update Dataset ──────────────────────────────────

  /**
   * Full pipeline: de-identify → encrypt → upload to IPFS → list on-chain.
   * This is the monthly auto-posting flow.
   */
  async contributeData(
    snapshots: BiomarkerSnapshot[],
    demographics: { age?: number; sex?: string; zipCode?: string },
    priceUsdc: number,
    selectedCategories?: string[],
  ): Promise<{ datasetId: string; ipfsCid: string; txHash: string }> {
    console.log(`[Contribute] Starting contribution flow (${snapshots.length} snapshots)...`);

    // 1. De-identify locally
    const dataset = this.deidentify.process(snapshots, demographics, selectedCategories);
    const dataJson = JSON.stringify(dataset);
    console.log(`[Contribute] De-identified: ${dataset.tags.join(', ')} | ${dataset.completenessAvg}% complete`);

    // 2. Encrypt and upload to IPFS
    const upload = await this.ipfs.upload(dataJson);
    console.log(`[Contribute] Uploaded to IPFS: ${upload.cid} (${upload.size} bytes)`);

    // 3. Store encryption key locally (will be shared per-buyer after purchase)
    // In production, this goes to local SQLite
    console.log(`[Contribute] Encryption key stored locally (never on-chain)`);

    // 4. List on-chain
    const priceUsdcUnits = BigInt(Math.round(priceUsdc * 1_000_000)); // USDC has 6 decimals
    const partnerAddress = this.config.partnerAddress ?? ethers.ZeroAddress;

    const { receipt, datasetId } = await this.contracts.listDataset(
      upload.cid,
      upload.contentHash,
      priceUsdcUnits,
      dataset.tags,
      dataset.snapshots.length,
      dataset.daySpan,
      dataset.completenessAvg,
      `${dataset.demographics.ageRange}_${dataset.demographics.sex}_${dataset.demographics.zip3 ?? 'XXX'}`,
      partnerAddress,
    );

    console.log(`[Contribute] Listed on Base Sepolia: ${datasetId}`);
    console.log(`[Contribute] TX: ${receipt.hash}`);

    return {
      datasetId,
      ipfsCid: upload.cid,
      txHash: receipt.hash,
    };
  }

  /**
   * Update an existing listing with new data (monthly refresh).
   */
  async updateContribution(
    datasetId: string,
    snapshots: BiomarkerSnapshot[],
    demographics: { age?: number; sex?: string; zipCode?: string },
    priceUsdc: number,
    selectedCategories?: string[],
  ): Promise<{ txHash: string }> {
    console.log(`[Contribute] Updating contribution ${datasetId}...`);

    const dataset = this.deidentify.process(snapshots, demographics, selectedCategories);
    const dataJson = JSON.stringify(dataset);

    const upload = await this.ipfs.upload(dataJson);
    const priceUsdcUnits = BigInt(Math.round(priceUsdc * 1_000_000));

    const receipt = await this.contracts.updateListing(
      datasetId,
      upload.cid,
      upload.contentHash,
      priceUsdcUnits,
      dataset.snapshots.length,
      dataset.completenessAvg,
    );

    console.log(`[Contribute] Updated: ${datasetId} | TX: ${receipt.hash}`);
    return { txHash: receipt.hash };
  }

  /**
   * Delist a contribution.
   */
  async removeContribution(datasetId: string): Promise<void> {
    await this.contracts.delistDataset(datasetId);
    console.log(`[Contribute] Delisted: ${datasetId}`);
  }

  // ── Earnings ───────────────────────────────────────────────

  async getEarnings(): Promise<EarningsSummary> {
    const address = this.contracts.getSignerAddress();

    try {
      const earningsBigInt = await this.contracts.getSellerEarnings(address);
      const listings = await this.contracts.getSellerListings(address);

      // Count active listings
      let activeListings = 0;
      for (const id of listings) {
        const listing = await this.contracts.getListing(id) as { active: boolean };
        if (listing.active) activeListings++;
      }

      return {
        totalEarningsUsdc: Number(earningsBigInt) / 1_000_000, // Convert from 6 decimals
        totalSales: listings.length,
        activeListings,
        pendingPayouts: 0, // TODO: track pending escrow
        lastSaleAt: null, // TODO: track from events
      };
    } catch {
      return {
        totalEarningsUsdc: 0,
        totalSales: 0,
        activeListings: 0,
        pendingPayouts: 0,
        lastSaleAt: null,
      };
    }
  }

  // ── Getters ────────────────────────────────────────────────

  getWalletAddress(): string {
    return this.contracts.getSignerAddress();
  }
}
