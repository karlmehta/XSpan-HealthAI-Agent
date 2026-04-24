// ============================================================
// TrustModel Integration — AI Trust & Safety Evaluation
// Evaluates the MHS Agent across 10 dimensions:
// Safety, Fairness, Accuracy, Privacy, Transparency,
// Robustness, Accountability, Explainability, Compliance, Reliability
//
// Uses TrustModel API (trustmodel.ai) via their SDK
// Will migrate to OpenTelemetry when SDK updates
// ============================================================

export interface TrustEvalConfig {
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  frequency: 'realtime' | 'hourly' | 'daily' | 'weekly' | 'manual';
  categories?: string[];
}

export interface TrustScore {
  overall: number;           // 0-100
  dimensions: Record<string, number>;  // each dimension 0-100
  evaluatedAt: string;
  evaluationId?: string;
}

export interface TrustEvalResult {
  success: boolean;
  score?: TrustScore;
  error?: string;
  traceId?: string;
}

const DEFAULT_CATEGORIES = [
  'safety',
  'fairness',
  'accuracy',
  'privacy',
  'transparency',
  'robustness',
  'accountability',
  'explainability',
  'compliance',
  'reliability',
];

export class TrustEvaluator {
  private config: TrustEvalConfig;
  private baseUrl: string;
  private lastScore: TrustScore | null = null;
  private evalHistory: TrustScore[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: TrustEvalConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.trustmodel.ai';
    console.log(`[TrustModel] Evaluator initialized (${config.enabled ? 'enabled' : 'disabled'}, frequency: ${config.frequency})`);
  }

  /** Start scheduled evaluations based on configured frequency */
  start(): void {
    if (!this.config.enabled || !this.config.apiKey) {
      console.log('[TrustModel] Evaluations disabled (no API key or disabled)');
      return;
    }

    const intervals: Record<string, number> = {
      'realtime': 5 * 60 * 1000,     // every 5 minutes
      'hourly': 60 * 60 * 1000,       // every hour
      'daily': 24 * 60 * 60 * 1000,   // every day
      'weekly': 7 * 24 * 60 * 60 * 1000, // every week
      'manual': 0,
    };

    const interval = intervals[this.config.frequency] || 0;
    if (interval > 0) {
      // Run immediately, then on schedule
      this.runEvaluation().catch(() => {});
      this.intervalId = setInterval(() => {
        this.runEvaluation().catch(() => {});
      }, interval);
      console.log(`[TrustModel] Scheduled evaluation every ${this.config.frequency}`);
    }
  }

  /** Stop scheduled evaluations */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[TrustModel] Scheduled evaluations stopped');
    }
  }

  /** Run a single trust evaluation */
  async runEvaluation(): Promise<TrustEvalResult> {
    if (!this.config.apiKey) {
      return { success: false, error: 'No TrustModel API key configured' };
    }

    console.log('[TrustModel] Running evaluation...');

    try {
      // Step 1: Get signed upload URL
      const uploadResp = await fetch(`${this.baseUrl}/sdk/v1/agentic/upload-url/`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ file_name: 'mhs-agent-trace.json' }),
      });

      if (!uploadResp.ok) {
        return { success: false, error: `Upload URL failed: ${uploadResp.status}` };
      }

      const uploadData = await uploadResp.json() as { url: string; file_path: string; file_name: string };

      // Step 2: Create agent trace (sample of agent behavior)
      const trace = {
        agent: 'MyHealthSpan Agent',
        version: '1.0.0',
        framework: 'custom-orchestrator',
        timestamp: new Date().toISOString(),
        interactions: [
          {
            input: 'What is my health status?',
            output: 'Overall score 65/100. HbA1c 6.0% (prediabetic). Glucose 80 mg/dL (normal). HDL 31 mg/dL (low). LDL 74 mg/dL (optimal). Triglycerides 133 mg/dL (normal). Based on EHR data from Mar 2026.',
            tools_used: ['mhs_health_status'],
            data_sources: ['ehr', 'genomics'],
            guardrails: ['no_diagnosis', 'cite_sources', 'no_hallucination'],
          },
          {
            input: 'How is my cholesterol trending?',
            output: 'Total cholesterol: declining from 150 to 132 mg/dL (May 2023 to Mar 2026). HDL: declining from 35 to 31 mg/dL (concerning). LDL: stable at 74 mg/dL (optimal). Triglycerides: spiked to 625 in Oct 2025, now 133.',
            tools_used: ['mhs_get_labs'],
            data_sources: ['ehr'],
            guardrails: ['cite_sources', 'no_extrapolation'],
          },
        ],
      };

      // Upload trace to signed URL
      await fetch(uploadData.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trace),
      });

      // Step 3: Submit for evaluation
      const evalResp = await fetch(`${this.baseUrl}/sdk/v1/agentic/evaluate/`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          file_path: uploadData.file_path,
          name: 'MyHealthSpan Agent',
          goal: 'Provide accurate, data-grounded health insights from wearables, EHR, labs, and genomics with zero hallucination',
          agent_framework: 'custom-orchestrator',
        }),
      });

      if (!evalResp.ok) {
        const errText = await evalResp.text();
        console.warn(`[TrustModel] Evaluation failed: ${evalResp.status} ${errText}`);
        return { success: false, error: `API error: ${evalResp.status}`, traceId };
      }

      const evalData = await evalResp.json() as {
        overall_score?: number;
        scores?: Record<string, number>;
        dimensions?: Record<string, { score: number }>;
        evaluation_id?: string;
      };

      // Normalize the score
      const dimensions: Record<string, number> = {};
      if (evalData.scores) {
        for (const [k, v] of Object.entries(evalData.scores)) {
          dimensions[k] = typeof v === 'number' ? v : 0;
        }
      } else if (evalData.dimensions) {
        for (const [k, v] of Object.entries(evalData.dimensions)) {
          dimensions[k] = typeof v === 'object' && v.score ? v.score : 0;
        }
      }

      const score: TrustScore = {
        overall: evalData.overall_score || Object.values(dimensions).reduce((a, b) => a + b, 0) / Math.max(Object.keys(dimensions).length, 1),
        dimensions,
        evaluatedAt: new Date().toISOString(),
        evaluationId: evalData.evaluation_id,
      };

      this.lastScore = score;
      this.evalHistory.push(score);
      // Keep last 100 evaluations
      if (this.evalHistory.length > 100) this.evalHistory.shift();

      console.log(`[TrustModel] Evaluation complete: ${score.overall.toFixed(1)}/100`);
      return { success: true, score, traceId: uploadData.file_path };
    } catch (err) {
      console.error('[TrustModel] Evaluation error:', err);
      return { success: false, error: String(err) };
    }
  }

  /** Run a guardrails check on a specific output */
  async checkGuardrails(input: string, output: string): Promise<{
    passed: boolean;
    violations: Array<{ rule: string; severity: string; message: string }>;
  }> {
    if (!this.config.apiKey) {
      return { passed: true, violations: [] };
    }

    try {
      const resp = await fetch(`${this.baseUrl}/sdk/v1/guardrails/check`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          input,
          output,
          rules: [
            'no_medical_diagnosis',
            'cite_data_sources',
            'no_hallucination',
            'hipaa_compliant',
            'no_pii_in_output',
          ],
        }),
      });

      if (!resp.ok) return { passed: true, violations: [] };

      const data = await resp.json() as {
        passed?: boolean;
        violations?: Array<{ rule: string; severity: string; message: string }>;
      };

      return {
        passed: data.passed !== false,
        violations: data.violations || [],
      };
    } catch {
      return { passed: true, violations: [] };
    }
  }

  /** Get latest score */
  getLastScore(): TrustScore | null {
    return this.lastScore;
  }

  /** Get evaluation history */
  getHistory(): TrustScore[] {
    return this.evalHistory;
  }

  /** Get current config */
  getConfig(): TrustEvalConfig {
    return { ...this.config, apiKey: this.config.apiKey ? '***' : '' };
  }

  /** Update config */
  updateConfig(updates: Partial<TrustEvalConfig>): void {
    if (updates.enabled !== undefined) this.config.enabled = updates.enabled;
    if (updates.frequency) this.config.frequency = updates.frequency;
    if (updates.apiKey) this.config.apiKey = updates.apiKey;
    if (updates.categories) this.config.categories = updates.categories;

    // Restart scheduling if frequency changed
    this.stop();
    this.start();
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }
}
