// ============================================================
// MyHealthSpan Agent — Orchestrator
// Master coordinator that delegates to sub-agents
// ============================================================

import type { SubAgent, AgentMessage, AgentStatus, NormalizedHealthData, DailyHealthSummary, ChartDataSet } from './types.js';
import type { LocalStore } from '../storage/local-store.js';

export class Orchestrator {
  private agents: Map<string, SubAgent> = new Map();
  private store: LocalStore;
  private traceCounter = 0;

  constructor(store: LocalStore) {
    this.store = store;
    console.log('[Orchestrator] Initialized');
  }

  /** Register a sub-agent */
  registerAgent(agent: SubAgent): void {
    this.agents.set(agent.name, agent);
    console.log(`[Orchestrator] Registered agent: ${agent.name} — ${agent.description}`);
  }

  /** Initialize all registered agents */
  async initialize(): Promise<void> {
    console.log(`[Orchestrator] Initializing ${this.agents.size} agents...`);
    const results = await Promise.allSettled(
      Array.from(this.agents.values()).map(async (agent) => {
        try {
          await agent.initialize();
          console.log(`  [${agent.name}] initialized`);
        } catch (err) {
          console.error(`  [${agent.name}] init failed:`, err);
        }
      })
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[Orchestrator] ${ok}/${this.agents.size} agents ready`);
  }

  /** Send a message to a specific agent */
  async sendMessage(to: string, action: string, payload: Record<string, unknown> = {}): Promise<AgentMessage> {
    const agent = this.agents.get(to);
    if (!agent) {
      return this.createMessage('orchestrator', to, 'error', action, { error: `Agent '${to}' not found` });
    }

    const msg = this.createMessage('orchestrator', to, 'command', action, payload);

    try {
      const result = await agent.handleMessage(msg);
      return result;
    } catch (err) {
      console.error(`[Orchestrator] Agent '${to}' failed on '${action}':`, err);
      return this.createMessage(to, 'orchestrator', 'error', action, { error: String(err) });
    }
  }

  /** Run full sync: wearables + EHR + analyze + summarize */
  async runFullSync(): Promise<{ wearables: number; ehr: number; summary: DailyHealthSummary | null }> {
    console.log('[Orchestrator] Running full sync...');
    const startTime = Date.now();

    // 1. Sync wearables and EHR in parallel
    const [wearableResult, ehrResult] = await Promise.allSettled([
      this.sendMessage('wearable-agent', 'sync'),
      this.sendMessage('ehr-agent', 'sync'),
    ]);

    const wearableCount = wearableResult.status === 'fulfilled' ? (wearableResult.value.payload.stored as number || 0) : 0;
    const ehrCount = ehrResult.status === 'fulfilled' ? (ehrResult.value.payload.stored as number || 0) : 0;

    console.log(`[Orchestrator] Sync complete: ${wearableCount} wearable + ${ehrCount} EHR records (${Date.now() - startTime}ms)`);

    // 2. Run analytics
    await this.sendMessage('analytics-agent', 'analyze');

    // 3. Generate daily summary
    let summary: DailyHealthSummary | null = null;
    const summaryResult = await this.sendMessage('summary-agent', 'generate-daily');
    if (summaryResult.type === 'result') {
      summary = summaryResult.payload.summary as DailyHealthSummary;
    }

    return { wearables: wearableCount, ehr: ehrCount, summary };
  }

  /** Get chart data for the Insights dashboard */
  async getChartData(): Promise<ChartDataSet> {
    const result = await this.sendMessage('analytics-agent', 'chart-data');
    return (result.payload.chartData as ChartDataSet) || { labels: [], series: {} };
  }

  /** Get the latest daily summary */
  async getDailySummary(): Promise<DailyHealthSummary | null> {
    const result = await this.sendMessage('summary-agent', 'get-latest');
    return (result.payload.summary as DailyHealthSummary) || null;
  }

  /** Get all health data normalized */
  async getAllHealthData(): Promise<NormalizedHealthData> {
    const result = await this.sendMessage('analytics-agent', 'get-all-data');
    return (result.payload.data as NormalizedHealthData) || {
      vitals: [], sleep: [], activity: [], labs: [],
      conditions: [], medications: [], allergies: [], immunizations: [],
    };
  }

  /** Get status of all agents */
  getAgentStatuses(): Array<{ name: string; status: AgentStatus; description: string }> {
    return Array.from(this.agents.values()).map(a => ({
      name: a.name,
      status: a.getStatus(),
      description: a.description,
    }));
  }

  /** Shutdown all agents */
  async shutdown(): Promise<void> {
    console.log('[Orchestrator] Shutting down all agents...');
    await Promise.allSettled(
      Array.from(this.agents.values()).map(a => a.shutdown())
    );
    console.log('[Orchestrator] All agents stopped');
  }

  private createMessage(
    from: string, to: string,
    type: AgentMessage['type'],
    action: string,
    payload: Record<string, unknown>
  ): AgentMessage {
    return {
      id: `msg-${++this.traceCounter}`,
      from, to, type, action, payload,
      timestamp: new Date(),
      traceId: `trace-${this.traceCounter}`,
    };
  }
}
