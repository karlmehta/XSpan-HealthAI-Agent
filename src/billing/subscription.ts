import { execSync } from 'child_process';
import type { AgentConfig } from '../types/index.js';

// ── Subscription Tiers ──────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro';

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  active: boolean;
  customerId?: string;
  subscriptionId?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

// Features available per tier
export const TIER_FEATURES = {
  free: [
    'apple_health_sync',
    'google_health_sync',
    'ehr_sync',
    'wearable_sync',
    'local_biomarker_synthesis',
    'local_data_storage',
    'mcp_server_local_tools',
  ],
  pro: [
    // All free features, plus:
    'cloud_nudges',             // 3x daily personalized nudges from H-LLM
    'health_passport',          // Weekly Health Passport PDF
    'risk_scores',              // Predictive disease risk scores
    'ai_health_qa',             // Natural language health Q&A
    'digital_twin_cloud_sync',  // Cloud Digital Twin synthesis
    'nutrition_ai_parsing',     // AI-powered meal parsing
    'priority_support',
  ],
} as const;

// Cloud API methods that require Pro subscription
export const PRO_REQUIRED_METHODS = new Set([
  'syncBiomarkers',
  'getNudges',
  'getHealthPassport',
  'askHealth',
  'synthesizeDigitalTwin',
  'getRiskScores',
  'parseNutrition',
]);

// MCP tools that require Pro subscription
export const PRO_REQUIRED_TOOLS = new Set([
  'xspan_get_nudges',
  'xspan_get_health_passport',
  'xspan_get_risk_scores',
  'xspan_ask_health',
  'xspan_log_nutrition',
]);

// ── Stripe Configuration ────────────────────────────────────

const STRIPE_CHECKOUT_BASE = 'https://xspan.ai/subscribe';
const SUBSCRIPTION_CHECK_URL = '/subscription/status';

// ── Subscription Manager ────────────────────────────────────

export class SubscriptionManager {
  private status: SubscriptionStatus | null = null;
  private apiUrl: string;
  private apiKey: string;
  private userId: string;
  private lastChecked: number = 0;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // Cache for 5 minutes

  constructor(config: AgentConfig) {
    this.apiUrl = config.xspan.apiUrl;
    this.apiKey = config.xspan.apiKey;
    this.userId = config.xspan.userId;
  }

  // ── Check Subscription Status ─────────────────────────────

  async checkSubscription(forceRefresh = false): Promise<SubscriptionStatus> {
    const now = Date.now();

    // Return cached status if fresh
    if (!forceRefresh && this.status && (now - this.lastChecked) < this.CHECK_INTERVAL_MS) {
      return this.status;
    }

    try {
      const response = await fetch(`${this.apiUrl}${SUBSCRIPTION_CHECK_URL}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-User-Id': this.userId,
        },
      });

      if (response.ok) {
        const data = await response.json() as SubscriptionStatus;
        this.status = data;
        this.lastChecked = now;
        return data;
      }

      // If API unreachable, default to free tier
      console.warn('[Subscription] Could not verify subscription status — defaulting to free tier');
      this.status = { tier: 'free', active: true };
      this.lastChecked = now;
      return this.status;

    } catch {
      console.warn('[Subscription] Network error checking subscription — defaulting to free tier');
      this.status = { tier: 'free', active: true };
      this.lastChecked = now;
      return this.status;
    }
  }

  // ── Check if Feature is Available ─────────────────────────

  async isFeatureAvailable(feature: string): Promise<boolean> {
    const status = await this.checkSubscription();

    // Free features always available
    if (TIER_FEATURES.free.includes(feature as typeof TIER_FEATURES.free[number])) {
      return true;
    }

    // Pro features require active pro subscription
    return status.tier === 'pro' && status.active;
  }

  // ── Check if API Method Requires Subscription ─────────────

  async requiresSubscription(methodName: string): Promise<boolean> {
    return PRO_REQUIRED_METHODS.has(methodName);
  }

  // ── Gate a Cloud API Call ──────────────────────────────────

  async gateCloudCall(methodName: string): Promise<{ allowed: boolean; message?: string }> {
    if (!PRO_REQUIRED_METHODS.has(methodName)) {
      return { allowed: true };
    }

    const status = await this.checkSubscription();

    if (status.tier === 'pro' && status.active) {
      return { allowed: true };
    }

    // Not subscribed — return upgrade message
    return {
      allowed: false,
      message: this.getUpgradeMessage(methodName),
    };
  }

  // ── Gate an MCP Tool Call ─────────────────────────────────

  async gateMcpTool(toolName: string): Promise<{ allowed: boolean; message?: string }> {
    if (!PRO_REQUIRED_TOOLS.has(toolName)) {
      return { allowed: true };
    }

    const status = await this.checkSubscription();

    if (status.tier === 'pro' && status.active) {
      return { allowed: true };
    }

    return {
      allowed: false,
      message: this.getUpgradeMessage(toolName),
    };
  }

  // ── Open Stripe Checkout ──────────────────────────────────

  openCheckout(): void {
    const checkoutUrl = `${STRIPE_CHECKOUT_BASE}?` + new URLSearchParams({
      user_id: this.userId,
      email: this.userId, // userId is email in this system
      plan: 'pro_monthly',
    }).toString();

    console.log(`\n${'='.repeat(60)}`);
    console.log('  XSpan Pro — $20/month');
    console.log('  Unlock cloud-powered health intelligence:');
    console.log('');
    console.log('  - 3x daily personalized nudges (H-LLM powered)');
    console.log('  - Weekly Health Passport PDF');
    console.log('  - Predictive disease risk scores');
    console.log('  - AI health Q&A (ask anything about your health)');
    console.log('  - Cloud Digital Twin synthesis');
    console.log('  - AI-powered meal parsing');
    console.log(`${'='.repeat(60)}`);
    console.log(`\n  Subscribe: ${checkoutUrl}\n`);

    // Open in browser
    try {
      if (process.platform === 'darwin') {
        execSync(`open "${checkoutUrl}"`);
      } else if (process.platform === 'linux') {
        execSync(`xdg-open "${checkoutUrl}"`);
      } else if (process.platform === 'win32') {
        execSync(`start "${checkoutUrl}"`);
      }
    } catch {
      console.log('  Could not open browser. Please visit the URL above.');
    }
  }

  // ── Upgrade Message ───────────────────────────────────────

  private getUpgradeMessage(feature: string): string {
    const featureNames: Record<string, string> = {
      // API methods
      syncBiomarkers: 'Cloud Digital Twin sync',
      getNudges: 'Personalized health nudges',
      getHealthPassport: 'Weekly Health Passport',
      askHealth: 'AI health Q&A',
      synthesizeDigitalTwin: 'Digital Twin synthesis',
      getRiskScores: 'Predictive risk scores',
      parseNutrition: 'AI meal parsing',
      // MCP tools
      xspan_get_nudges: 'Personalized health nudges',
      xspan_get_health_passport: 'Weekly Health Passport',
      xspan_get_risk_scores: 'Predictive risk scores',
      xspan_ask_health: 'AI health Q&A',
      xspan_log_nutrition: 'AI meal parsing',
    };

    const name = featureNames[feature] ?? feature;
    const checkoutUrl = `${STRIPE_CHECKOUT_BASE}?user_id=${encodeURIComponent(this.userId)}&plan=pro_monthly`;

    return JSON.stringify({
      error: 'subscription_required',
      feature: name,
      message: `"${name}" requires XSpan Pro ($20/month). This covers cloud infrastructure costs for AI-powered health intelligence.`,
      plan: {
        name: 'XSpan Pro',
        price: '$20/month',
        features: [
          '3x daily personalized nudges (H-LLM powered)',
          'Weekly Health Passport PDF',
          'Predictive disease risk scores',
          'AI health Q&A — ask anything about your health',
          'Cloud Digital Twin synthesis',
          'AI-powered meal parsing',
        ],
      },
      subscribe_url: checkoutUrl,
      free_features: [
        'Apple Health / Google Health sync',
        'EHR connection (Epic, Cerner)',
        'Wearable sync (Oura, WHOOP, Dexcom, Garmin, Fitbit)',
        'Local biomarker synthesis (100+ metrics)',
        'Local encrypted data storage',
        'MCP server for local health data',
      ],
    }, null, 2);
  }

  // ── Get Current Status ────────────────────────────────────

  getStatus(): SubscriptionStatus | null {
    return this.status;
  }

  // ── Check if Pro ──────────────────────────────────────────

  async isPro(): Promise<boolean> {
    const status = await this.checkSubscription();
    return status.tier === 'pro' && status.active;
  }
}
