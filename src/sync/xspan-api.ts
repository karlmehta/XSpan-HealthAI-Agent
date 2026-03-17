// Cloud API client — used only with XSpan Premium (via health system invite)
// This module is NOT imported by the local-only agent. It is retained for future
// Premium tier integration when users are onboarded through a health system.

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  AgentConfig,
  BiomarkerVector,
  XSpanSyncResponse,
  XSpanNudge,
  HealthPassport,
  HealthAnswer,
  RiskScore,
  NutritionEntry,
} from '../types/index.js';
import { SubscriptionManager } from '../billing/subscription.js';

// ── XSpan API Client ─────────────────────────────────────────

export class XSpanApiClient {
  private client: AxiosInstance;
  private userId: string;
  public subscription: SubscriptionManager;

  constructor(config: AgentConfig) {
    this.userId = config.xspan.userId;
    this.subscription = new SubscriptionManager(config);

    this.client = axios.create({
      baseURL: config.xspan.apiUrl,
      timeout: 30_000,
      headers: {
        'Authorization': `Bearer ${config.xspan.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `xspan-agent/1.0.0 node/${process.version} ${process.platform}`,
      },
    });

    // Response interceptor: log errors
    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        const status = error.response?.status;
        const url = error.config?.url;
        console.error(`[XSpan API] ${status ?? 'NETWORK'} error on ${url}:`, error.message);
        return Promise.reject(error);
      }
    );
  }

  // ── Connectivity Check ──────────────────────────────────────

  async checkConnectivity(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch {
      return false;
    }
  }

  // ── Subscription Check ─────────────────────────────────────

  private async requirePro(method: string): Promise<void> {
    const gate = await this.subscription.gateCloudCall(method);
    if (!gate.allowed) {
      throw new SubscriptionRequiredError(gate.message ?? 'XSpan Pro subscription required');
    }
  }

  // ── Biomarker Sync ──────────────────────────────────────────

  async syncBiomarkers(vector: BiomarkerVector): Promise<XSpanSyncResponse | null> {
    await this.requirePro('syncBiomarkers');
    return this.withRetry(async () => {
      const response = await this.client.post<XSpanSyncResponse>('/sync', {
        userId: this.userId,
        biomarkers: vector,
        clientVersion: '1.0.0',
      });
      return response.data;
    });
  }

  // ── Nudges ───────────────────────────────────────────────────

  async getNudges(since?: Date, limit = 10): Promise<XSpanNudge[]> {
    await this.requirePro('getNudges');
    const result = await this.withRetry(async () => {
      const params: Record<string, string | number> = { limit };
      if (since) params['since'] = since.toISOString();

      const response = await this.client.get<{ nudges: XSpanNudge[] }>('/nudges', { params });
      return response.data.nudges;
    });
    return result ?? [];
  }

  // ── Health Passport ──────────────────────────────────────────

  async getHealthPassport(weekEnding?: string): Promise<HealthPassport | null> {
    await this.requirePro('getHealthPassport');
    return this.withRetry(async () => {
      const url = weekEnding ? `/passport/${weekEnding}` : '/passport/latest';
      const response = await this.client.get<HealthPassport>(url);
      return response.data;
    });
  }

  // ── Natural Language Health Q&A ──────────────────────────────

  async askHealth(question: string, context?: BiomarkerVector): Promise<HealthAnswer | null> {
    await this.requirePro('askHealth');
    return this.withRetry(async () => {
      const response = await this.client.post<HealthAnswer>('/ask', {
        userId: this.userId,
        question,
        context,
      });
      return response.data;
    });
  }

  // ── Digital Twin ─────────────────────────────────────────────

  async synthesizeDigitalTwin(): Promise<void> {
    await this.requirePro('synthesizeDigitalTwin');
    await this.withRetry(async () => {
      await this.client.post('/digital-twin/synthesize', {
        userId: this.userId,
      });
    });
  }

  // ── Risk Scores ──────────────────────────────────────────────

  async getRiskScores(): Promise<RiskScore[]> {
    await this.requirePro('getRiskScores');
    const result = await this.withRetry(async () => {
      const response = await this.client.get<{ scores: RiskScore[] }>('/risk-scores');
      return response.data.scores;
    });
    return result ?? [];
  }

  // ── Nutrition Parsing ─────────────────────────────────────────

  async parseNutrition(description: string): Promise<NutritionEntry | null> {
    await this.requirePro('parseNutrition');
    return this.withRetry(async () => {
      const response = await this.client.post<NutritionEntry>('/nutrition/parse', {
        userId: this.userId,
        description,
      });
      return response.data;
    });
  }

  // ── Retry Logic ───────────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
  ): Promise<T | null> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          // Don't retry 4xx (except 429)
          if (status && status >= 400 && status < 500 && status !== 429) {
            console.error(`[XSpan API] Non-retryable error ${status}`);
            return null;
          }

          // Respect Retry-After header for 429
          if (status === 429) {
            const retryAfter = parseInt(error.response?.headers['retry-after'] ?? '5', 10);
            await sleep(retryAfter * 1000);
            continue;
          }
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
          console.warn(`[XSpan API] Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
          await sleep(delay);
        }
      }
    }

    console.error('[XSpan API] All retries exhausted:', lastError);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Subscription Error ──────────────────────────────────────

export class SubscriptionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionRequiredError';
  }
}
