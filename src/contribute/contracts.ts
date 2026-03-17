// ============================================================
// XSpan Contribute — Smart Contract Bindings (ethers.js v6)
// ============================================================

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { ContributeConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load ABIs ────────────────────────────────────────────────

function loadAbi(name: string): ethers.InterfaceAbi {
  const path = join(__dirname, 'abi', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const CONSENT_ABI = loadAbi('ConsentRegistry');
const BUYER_ABI = loadAbi('BuyerAccessControl');
const REGISTRY_ABI = loadAbi('DataRegistry');
const EXCHANGE_ABI = loadAbi('DataExchange');

// ── Contract Clients ─────────────────────────────────────────

export class ContractClient {
  public provider: ethers.JsonRpcProvider;
  public signer: ethers.Wallet;

  public consent: ethers.Contract;
  public buyerAccess: ethers.Contract;
  public registry: ethers.Contract;
  public exchange: ethers.Contract;

  constructor(config: ContributeConfig, privateKey: string) {
    this.provider = new ethers.JsonRpcProvider(config.baseRpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);

    this.consent = new ethers.Contract(config.contracts.consentRegistry, CONSENT_ABI, this.signer);
    this.buyerAccess = new ethers.Contract(config.contracts.buyerAccessControl, BUYER_ABI, this.signer);
    this.registry = new ethers.Contract(config.contracts.dataRegistry, REGISTRY_ABI, this.signer);
    this.exchange = new ethers.Contract(config.contracts.dataExchange, EXCHANGE_ABI, this.signer);
  }

  // ── Consent ────────────────────────────────────────────────

  async grantConsent(consentHash: string, version: number): Promise<ethers.TransactionReceipt> {
    const tx = await this.consent.grantConsent(consentHash, version);
    console.log(`[Contribute] Consent tx: ${tx.hash}`);
    return tx.wait();
  }

  async revokeConsent(): Promise<ethers.TransactionReceipt> {
    const tx = await this.consent.revokeConsent();
    return tx.wait();
  }

  async hasActiveConsent(address: string): Promise<boolean> {
    return this.consent.hasActiveConsent(address);
  }

  // ── Data Registry ──────────────────────────────────────────

  async listDataset(
    ipfsCid: string,
    contentHash: string,
    priceUsdc: bigint,
    tags: string[],
    snapshotCount: number,
    daySpan: number,
    completenessAvg: number,
    demographicBucket: string,
    partnerAddress: string,
  ): Promise<{ receipt: ethers.TransactionReceipt; datasetId: string }> {
    const tx = await this.registry.listDataset(
      ipfsCid, contentHash, priceUsdc, tags, snapshotCount,
      daySpan, completenessAvg, demographicBucket, partnerAddress,
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((log: ethers.Log) => {
        try { return this.registry.interface.parseLog(log); } catch { return null; }
      })
      .find((e: ethers.LogDescription | null) => e?.name === 'DatasetListed');

    const datasetId = event?.args?.datasetId ?? '';
    console.log(`[Contribute] Listed dataset: ${datasetId}`);
    return { receipt, datasetId };
  }

  async updateListing(
    datasetId: string, ipfsCid: string, contentHash: string,
    priceUsdc: bigint, snapshotCount: number, completenessAvg: number,
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.registry.updateListing(
      datasetId, ipfsCid, contentHash, priceUsdc, snapshotCount, completenessAvg,
    );
    return tx.wait();
  }

  async delistDataset(datasetId: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.registry.delistDataset(datasetId);
    return tx.wait();
  }

  async getListing(datasetId: string): Promise<Record<string, unknown>> {
    return this.registry.getListing(datasetId);
  }

  async getSellerListings(address: string): Promise<string[]> {
    return this.registry.getSellerListings(address);
  }

  // ── Earnings ───────────────────────────────────────────────

  async getContributorEarnings(address: string): Promise<bigint> {
    return this.exchange.sellerEarnings(address);
  }

  async getTotalVolume(): Promise<bigint> {
    return this.exchange.totalVolume();
  }

  async getTotalAccessGrants(): Promise<bigint> {
    return this.exchange.totalPurchases();
  }

  // ── Utility ────────────────────────────────────────────────

  getSignerAddress(): string {
    return this.signer.address;
  }

  async getBalance(): Promise<string> {
    const balance = await this.provider.getBalance(this.signer.address);
    return ethers.formatEther(balance);
  }
}
