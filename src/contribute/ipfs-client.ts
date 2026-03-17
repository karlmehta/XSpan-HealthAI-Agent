// ============================================================
// XSpan Contribute — IPFS Client (Mock for Development)
// Swap to Pinata SDK when API keys are available
// ============================================================

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export interface UploadResult {
  cid: string;
  contentHash: string;        // SHA-256 of unencrypted data
  encryptionKey: string;      // Hex-encoded AES-256 key (stored locally, shared per-buyer)
  size: number;
}

export interface DownloadResult {
  data: string;               // Decrypted JSON string
  verified: boolean;          // contentHash matches
}

// ── Mock IPFS Storage (in-memory for dev) ────────────────────

const mockStorage = new Map<string, Buffer>();

export class IpfsClient {
  private useMock: boolean;
  private pinataApiKey?: string;
  private pinataApiSecret?: string;

  constructor(config?: { pinataApiKey?: string; pinataApiSecret?: string }) {
    this.pinataApiKey = config?.pinataApiKey;
    this.pinataApiSecret = config?.pinataApiSecret;
    this.useMock = !this.pinataApiKey;

    if (this.useMock) {
      console.log('[IPFS] Using mock storage (in-memory). Set PINATA_API_KEY to use Pinata.');
    }
  }

  /**
   * Encrypt and upload a de-identified dataset to IPFS.
   * Returns the CID, content hash, and encryption key.
   */
  async upload(data: string): Promise<UploadResult> {
    // 1. Compute content hash of unencrypted data (for on-chain verification)
    const contentHash = '0x' + createHash('sha256').update(data).digest('hex');

    // 2. Generate AES-256 encryption key
    const key = randomBytes(32);
    const iv = randomBytes(16);

    // 3. Encrypt
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(data, 'utf8'), cipher.final()]);

    // 4. Upload to storage
    let cid: string;

    if (this.useMock) {
      cid = 'Qm' + randomBytes(22).toString('hex'); // Mock CID
      mockStorage.set(cid, encrypted);
      console.log(`[IPFS] Mock upload: ${cid} (${encrypted.length} bytes)`);
    } else {
      cid = await this.pinataUpload(encrypted);
    }

    return {
      cid,
      contentHash,
      encryptionKey: key.toString('hex'),
      size: encrypted.length,
    };
  }

  /**
   * Download and decrypt a dataset from IPFS.
   */
  async download(cid: string, encryptionKey: string, expectedHash: string): Promise<DownloadResult> {
    let encrypted: Buffer;

    if (this.useMock) {
      const stored = mockStorage.get(cid);
      if (!stored) throw new Error(`[IPFS] CID not found in mock storage: ${cid}`);
      encrypted = stored;
    } else {
      encrypted = await this.pinataDownload(cid);
    }

    // 1. Extract IV and decrypt
    const iv = encrypted.subarray(0, 16);
    const ciphertext = encrypted.subarray(16);
    const key = Buffer.from(encryptionKey, 'hex');

    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');

    // 2. Verify content hash
    const actualHash = '0x' + createHash('sha256').update(decrypted).digest('hex');
    const verified = actualHash === expectedHash;

    if (!verified) {
      console.warn(`[IPFS] Content hash mismatch! Expected ${expectedHash}, got ${actualHash}`);
    }

    return { data: decrypted, verified };
  }

  // ── Pinata Integration (activated when API keys provided) ──

  private async pinataUpload(encrypted: Buffer): Promise<string> {
    const FormData = (await import('node:buffer')).Blob;

    const boundary = '----XSpanBoundary' + randomBytes(8).toString('hex');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dataset.enc"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      encrypted,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'pinata_api_key': this.pinataApiKey!,
        'pinata_secret_api_key': this.pinataApiSecret!,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`[IPFS] Pinata upload failed: ${response.status} ${await response.text()}`);
    }

    const result = await response.json() as { IpfsHash: string };
    console.log(`[IPFS] Pinata upload: ${result.IpfsHash} (${encrypted.length} bytes)`);
    return result.IpfsHash;
  }

  private async pinataDownload(cid: string): Promise<Buffer> {
    const response = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`[IPFS] Pinata download failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
