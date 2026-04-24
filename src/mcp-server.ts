// ============================================================
// MyHealthSpan Agent v2 — MCP Server
// Exposes 14 health tools via Model Context Protocol
//
// Start: node dist/mcp-server.js
// Or via MCP client config:
//   { "mcpServers": { "myhealthspan": { "command": "npx", "args": ["@myhealthspan/agent", "mcp"] } } }
//
// All supplier names (ROOK, b.well) are internal only.
// User-facing descriptions say "wearable devices", "health records", "hospitals".
// ============================================================

import { homedir } from 'os';
import { join } from 'path';

// Graceful import of MCP SDK — helpful error if not installed
let Server: typeof import('@modelcontextprotocol/sdk/server/index.js').Server;
let StdioServerTransport: typeof import('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport;
let CallToolRequestSchema: typeof import('@modelcontextprotocol/sdk/types.js').CallToolRequestSchema;
let ListToolsRequestSchema: typeof import('@modelcontextprotocol/sdk/types.js').ListToolsRequestSchema;

try {
  const serverMod = await import('@modelcontextprotocol/sdk/server/index.js');
  const stdioMod = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const typesMod = await import('@modelcontextprotocol/sdk/types.js');
  Server = serverMod.Server;
  StdioServerTransport = stdioMod.StdioServerTransport;
  CallToolRequestSchema = typesMod.CallToolRequestSchema;
  ListToolsRequestSchema = typesMod.ListToolsRequestSchema;
} catch {
  console.error(
    '[MyHealthSpan MCP] Failed to load @modelcontextprotocol/sdk.\n' +
    'Install it with: npm install @modelcontextprotocol/sdk\n' +
    'Then rebuild: npm run build',
  );
  process.exit(1);
}

import { Orchestrator } from './agents/orchestrator.js';
import { LocalStore } from './storage/local-store.js';
import { WearableAgent } from './agents/wearable-agent.js';
import { EhrAgent } from './agents/ehr-agent.js';
import { AnalyticsAgent } from './agents/analytics-agent.js';
// SummaryAgent is dispatched via the orchestrator; it may not have a
// dedicated file yet — the orchestrator already routes 'summary-agent'
// messages. We register a lightweight shim if no concrete class exists.
let SummaryAgent: (new (store: LocalStore) => import('./agents/types.js').SubAgent) | null = null;
try {
  const mod = await import('./agents/summary-agent.js');
  SummaryAgent = mod.SummaryAgent ?? mod.default ?? null;
} catch {
  // summary-agent module not yet built — will skip registration
}

import { ContributeManager } from './contribute/index.js';
import type { EarningsSummary } from './contribute/types.js';
import type { DailyHealthSummary, ChartDataSet } from './agents/types.js';

// ── Tool Definitions ────────────────────────────────────────────

const TOOLS = [
  // Health Status
  {
    name: 'mhs_health_status',
    description: "Get today's health briefing — sleep quality, heart rate, activity, key metrics, and any alerts.",
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'mhs_ask',
    description: 'Ask a health question. The answer is grounded in your actual health data only — no speculation.',
    inputSchema: {
      type: 'object' as const,
      required: ['question'],
      properties: {
        question: { type: 'string', description: 'Your health question in natural language' },
      },
    },
  },

  // Data Retrieval
  {
    name: 'mhs_get_labs',
    description: 'Get recent lab results with clinical interpretation (lipids, metabolic, thyroid, kidney, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Filter by category: metabolic, lipids, thyroid, kidney, vitals, or all (default: all)' },
        days: { type: 'number', description: 'Number of days of history (default: 90)' },
      },
    },
  },
  {
    name: 'mhs_get_vitals',
    description: 'Get recent vital signs — heart rate, blood pressure, SpO2, HRV, respiratory rate.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Number of days of history (default: 7)' },
      },
    },
  },
  {
    name: 'mhs_get_sleep',
    description: 'Get sleep data — total duration, deep/REM/light stages, sleep score, overnight HRV.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Number of days of history (default: 7)' },
      },
    },
  },
  {
    name: 'mhs_get_activity',
    description: 'Get activity data — steps, calories, active minutes, strain, recovery, VO2 max.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Number of days of history (default: 7)' },
      },
    },
  },
  {
    name: 'mhs_get_conditions',
    description: 'Get active medical conditions from your health records.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'mhs_get_medications',
    description: 'Get current medications, dosages, and frequency from your health records.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'mhs_get_allergies',
    description: 'Get known allergies (food, medication, environmental) from your health records.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // Analysis
  {
    name: 'mhs_detect_drift',
    description: 'Detect metrics that have drifted from your personal 30-day baseline. Highlights significant changes.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'mhs_chart_data',
    description: 'Get time-series data suitable for charts — heart rate, HRV, sleep, steps, glucose, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Number of days of history (default: 90)' },
      },
    },
  },

  // Connection
  {
    name: 'mhs_connect_device',
    description: 'Get an authorization link to connect a wearable device (Oura, WHOOP, Fitbit, Garmin, Dexcom, Apple Health, etc.).',
    inputSchema: {
      type: 'object' as const,
      required: ['device'],
      properties: {
        device: {
          type: 'string',
          enum: ['oura', 'whoop', 'fitbit', 'garmin', 'dexcom', 'withings', 'polar', 'apple_health', 'google_fit', 'health_connect'],
          description: 'The wearable device to connect',
        },
      },
    },
  },
  {
    name: 'mhs_connect_ehr',
    description: 'Connect your health records from hospitals and clinics (supports 650+ health systems).',
    inputSchema: {
      type: 'object' as const,
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', description: 'Your health records account email' },
        password: { type: 'string', description: 'Your health records account password' },
      },
    },
  },

  // Contribute
  {
    name: 'mhs_earnings',
    description: 'Check your USDC earnings from contributing de-identified health data to research.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

// ── Response Helpers ────────────────────────────────────────────

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResponse(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().split('T')[0]!;
}

function cite(source: string, date?: string | Date): string {
  const dateStr = date ? ` (${formatDate(date)})` : '';
  return `[${source}${dateStr}]`;
}

// ── Tool Handlers ───────────────────────────────────────────────

async function handleHealthStatus(orchestrator: Orchestrator): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('summary-agent', 'generate-daily');

  if (result.type === 'error') {
    // Fall back to analytics data if summary agent unavailable
    const analysisResult = await orchestrator.sendMessage('analytics-agent', 'analyze');
    const payload = analysisResult.payload;
    const scores = payload.scores as Record<string, number> | undefined;
    const alerts = payload.alerts as Array<{ severity: string; message: string }> | undefined;

    const lines: string[] = [];
    lines.push(`--- Health Briefing (${formatDate(new Date())}) ---\n`);

    if (scores) {
      lines.push('Category Scores:');
      for (const [cat, score] of Object.entries(scores)) {
        if (typeof score === 'number' && score >= 0) {
          lines.push(`  ${cat}: ${score}/100`);
        }
      }
      lines.push('');
    }

    if (alerts && alerts.length > 0) {
      lines.push('Alerts:');
      for (const alert of alerts) {
        const icon = alert.severity === 'critical' ? '[!]' : '[*]';
        lines.push(`  ${icon} ${alert.message}`);
      }
    } else {
      lines.push('No alerts today.');
    }

    lines.push(`\nData source: local health database ${cite('analytics-agent', new Date())}`);
    return textResponse(lines.join('\n'));
  }

  const summary = result.payload.summary as DailyHealthSummary;
  const lines: string[] = [];
  lines.push(`--- Health Briefing (${summary.date}) ---\n`);
  lines.push(`${summary.headline}`);
  lines.push(`Overall Score: ${summary.overallScore}/100\n`);

  // Category scores
  for (const cat of ['cardiovascular', 'metabolic', 'sleep', 'activity'] as const) {
    const section = summary[cat];
    if (section) {
      lines.push(`${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${section.score}/100 — ${section.summary}`);
      if (section.dataPoints.length > 0) {
        for (const dp of section.dataPoints) {
          lines.push(`  - ${dp}`);
        }
      }
    }
  }

  // Key metrics
  if (summary.keyMetrics.length > 0) {
    lines.push('\nKey Metrics:');
    for (const m of summary.keyMetrics) {
      const trendArrow = m.trend === 'up' ? '^' : m.trend === 'down' ? 'v' : '=';
      lines.push(`  ${m.label}: ${m.value} ${m.unit} (${trendArrow}, ${m.status})`);
    }
  }

  // Alerts
  if (summary.alerts.length > 0) {
    lines.push('\nAlerts:');
    for (const a of summary.alerts) {
      const icon = a.severity === 'critical' ? '[!]' : a.severity === 'warning' ? '[*]' : '[i]';
      lines.push(`  ${icon} ${a.message}`);
      if (a.action) lines.push(`      Action: ${a.action}`);
    }
  }

  lines.push(`\nSources: ${summary.sources.join(', ')} ${cite('summary-agent', summary.generatedAt)}`);
  return textResponse(lines.join('\n'));
}

async function handleAsk(orchestrator: Orchestrator, question: string): Promise<ReturnType<typeof textResponse>> {
  // Gather all health data to ground the answer
  const dataResult = await orchestrator.sendMessage('analytics-agent', 'get-all-data');
  const data = dataResult.payload.data as Record<string, unknown[]> | undefined;

  if (!data || dataResult.type === 'error') {
    return textResponse(
      'I don\'t have enough health data to answer that question yet. ' +
      'Connect a wearable device or health records first using mhs_connect_device or mhs_connect_ehr.',
    );
  }

  // Build a data-grounded context
  const analysisResult = await orchestrator.sendMessage('analytics-agent', 'analyze');
  const scores = analysisResult.payload.scores as Record<string, number> | undefined;
  const alerts = analysisResult.payload.alerts as Array<{ severity: string; message: string; metric: string }> | undefined;

  const lines: string[] = [];
  lines.push(`Question: ${question}\n`);
  lines.push('Based on your health data:\n');

  // Provide relevant data context based on question keywords
  const q = question.toLowerCase();

  if (q.includes('sleep')) {
    const sleepData = (data.sleep || []) as Array<Record<string, unknown>>;
    if (sleepData.length > 0) {
      lines.push('Recent sleep data:');
      for (const s of sleepData.slice(0, 5)) {
        lines.push(`  ${s.date}: ${s.totalMin ?? s.totalMinutes ?? 'N/A'} min ${cite('wearable', s.date as string)}`);
      }
    }
    if (scores?.sleep !== undefined && scores.sleep >= 0) {
      lines.push(`  Sleep score: ${scores.sleep}/100`);
    }
  }

  if (q.includes('heart') || q.includes('cardio') || q.includes('hrv') || q.includes('blood pressure')) {
    const vitals = (data.vitals || []) as Array<Record<string, unknown>>;
    if (vitals.length > 0) {
      lines.push('Recent vitals:');
      for (const v of vitals.slice(0, 5)) {
        const parts: string[] = [];
        if (v.heartRate) parts.push(`HR: ${v.heartRate} bpm`);
        if (v.bpSystolic) parts.push(`BP: ${v.bpSystolic}/${v.bpDiastolic} mmHg`);
        if (v.spo2) parts.push(`SpO2: ${v.spo2}%`);
        if (parts.length > 0) {
          lines.push(`  ${v.date}: ${parts.join(', ')} ${cite(v.source as string || 'health-data', v.date as string)}`);
        }
      }
    }
    if (scores?.cardiovascular !== undefined) {
      lines.push(`  Cardiovascular score: ${scores.cardiovascular}/100`);
    }
  }

  if (q.includes('lab') || q.includes('cholesterol') || q.includes('glucose') || q.includes('a1c') || q.includes('thyroid')) {
    const labs = (data.labs || []) as Array<Record<string, unknown>>;
    if (labs.length > 0) {
      lines.push('Recent labs:');
      for (const l of labs.slice(0, 10)) {
        const interp = l.interpretation ? ` (${l.interpretation})` : '';
        lines.push(`  ${l.testName}: ${l.value} ${l.unit}${interp} ${cite(l.source as string || 'lab', l.date as string)}`);
      }
    }
  }

  if (q.includes('step') || q.includes('activity') || q.includes('exercise') || q.includes('walk') || q.includes('run')) {
    if (scores?.activity !== undefined && scores.activity >= 0) {
      lines.push(`  Activity score: ${scores.activity}/100`);
    }
  }

  if (q.includes('weight') || q.includes('metaboli') || q.includes('bmi')) {
    if (scores?.metabolic !== undefined) {
      lines.push(`  Metabolic score: ${scores.metabolic}/100`);
    }
  }

  // Include relevant alerts
  if (alerts && alerts.length > 0) {
    const relevant = alerts.filter(a => {
      if (q.includes(a.metric)) return true;
      if (q.includes('health') || q.includes('overall') || q.includes('concern') || q.includes('worry')) return true;
      return false;
    });
    if (relevant.length > 0) {
      lines.push('\nRelevant alerts:');
      for (const a of relevant) {
        lines.push(`  - ${a.message}`);
      }
    }
  }

  if (lines.length <= 3) {
    lines.push('I found your health data but no specific records related to this question.');
    lines.push('Try asking about sleep, heart rate, labs, activity, or overall health.');
  }

  lines.push(`\nNote: This is based on your personal health data only, not medical advice. ${cite('analytics-agent', new Date())}`);
  return textResponse(lines.join('\n'));
}

async function handleGetLabs(orchestrator: Orchestrator, category?: string, days?: number): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-lab-summary');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const labs = (result.payload.labs || []) as Array<{
    date: string; testName: string; value: number; unit: string;
    category: string; interpretation?: string; source: string;
  }>;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days ?? 90));

  let filtered = labs.filter(l => new Date(l.date) >= cutoff);
  if (category && category !== 'all') {
    filtered = filtered.filter(l => l.category === category);
  }

  if (filtered.length === 0) {
    return textResponse(`No lab results found${category ? ` for category "${category}"` : ''} in the last ${days ?? 90} days.`);
  }

  const lines: string[] = [];
  lines.push(`--- Lab Results (last ${days ?? 90} days) ---\n`);

  // Group by category
  const byCategory: Record<string, typeof filtered> = {};
  for (const l of filtered) {
    if (!byCategory[l.category]) byCategory[l.category] = [];
    byCategory[l.category].push(l);
  }

  for (const [cat, catLabs] of Object.entries(byCategory)) {
    lines.push(`${cat.toUpperCase()}:`);
    for (const l of catLabs) {
      const interpStr = l.interpretation && l.interpretation !== 'normal' ? ` ** ${l.interpretation.toUpperCase()} **` : '';
      lines.push(`  ${l.testName}: ${l.value} ${l.unit}${interpStr} ${cite(l.source, l.date)}`);
    }
    lines.push('');
  }

  return textResponse(lines.join('\n'));
}

async function handleGetVitals(orchestrator: Orchestrator, days?: number): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-lab-summary');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const vitals = (result.payload.vitals || []) as Array<{
    date: string; heartRate?: number; bpSystolic?: number; bpDiastolic?: number; spo2?: number; source: string;
  }>;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days ?? 7));
  const filtered = vitals.filter(v => new Date(v.date) >= cutoff);

  if (filtered.length === 0) {
    return textResponse(`No vital signs found in the last ${days ?? 7} days.`);
  }

  const lines: string[] = [];
  lines.push(`--- Vitals (last ${days ?? 7} days) ---\n`);

  for (const v of filtered.slice(0, 30)) {
    const parts: string[] = [];
    if (v.heartRate) parts.push(`HR: ${v.heartRate} bpm`);
    if (v.bpSystolic && v.bpDiastolic) parts.push(`BP: ${v.bpSystolic}/${v.bpDiastolic} mmHg`);
    if (v.spo2) parts.push(`SpO2: ${v.spo2}%`);
    if (parts.length > 0) {
      lines.push(`  ${formatDate(v.date)}: ${parts.join('  |  ')} ${cite(v.source, v.date)}`);
    }
  }

  return textResponse(lines.join('\n'));
}

async function handleGetSleep(orchestrator: Orchestrator, days?: number): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'chart-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const chartData = result.payload.chartData as ChartDataSet;
  const limit = Math.min(days ?? 7, chartData.labels.length);
  const startIdx = Math.max(0, chartData.labels.length - limit);

  const lines: string[] = [];
  lines.push(`--- Sleep Data (last ${days ?? 7} days) ---\n`);

  let hasData = false;
  for (let i = startIdx; i < chartData.labels.length; i++) {
    const date = chartData.labels[i];
    const sleepMin = chartData.series.sleepMin?.[i];
    const sleepScore = chartData.series.sleepScore?.[i];

    if (sleepMin !== null && sleepMin !== undefined) {
      hasData = true;
      const hours = Math.floor(sleepMin / 60);
      const mins = Math.round(sleepMin % 60);
      const scoreStr = sleepScore !== null && sleepScore !== undefined ? ` | Score: ${sleepScore}` : '';
      lines.push(`  ${date}: ${hours}h ${mins}m${scoreStr} ${cite('wearable', date)}`);
    }
  }

  if (!hasData) {
    return textResponse(`No sleep data found in the last ${days ?? 7} days. Connect a sleep-tracking device using mhs_connect_device.`);
  }

  return textResponse(lines.join('\n'));
}

async function handleGetActivity(orchestrator: Orchestrator, days?: number): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'chart-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const chartData = result.payload.chartData as ChartDataSet;
  const limit = Math.min(days ?? 7, chartData.labels.length);
  const startIdx = Math.max(0, chartData.labels.length - limit);

  const lines: string[] = [];
  lines.push(`--- Activity Data (last ${days ?? 7} days) ---\n`);

  let hasData = false;
  for (let i = startIdx; i < chartData.labels.length; i++) {
    const date = chartData.labels[i];
    const steps = chartData.series.steps?.[i];
    const strain = chartData.series.strain?.[i];
    const recovery = chartData.series.recovery?.[i];

    if (steps !== null && steps !== undefined) {
      hasData = true;
      const parts: string[] = [`${Math.round(steps).toLocaleString()} steps`];
      if (strain !== null && strain !== undefined) parts.push(`strain: ${strain}`);
      if (recovery !== null && recovery !== undefined) parts.push(`recovery: ${recovery}%`);
      lines.push(`  ${date}: ${parts.join('  |  ')} ${cite('wearable', date)}`);
    }
  }

  if (!hasData) {
    return textResponse(`No activity data found in the last ${days ?? 7} days. Connect a fitness tracker using mhs_connect_device.`);
  }

  return textResponse(lines.join('\n'));
}

async function handleGetConditions(orchestrator: Orchestrator): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-all-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const data = result.payload.data as Record<string, unknown[]>;
  const conditions = (data.conditions || []) as Array<{ name: string; status: string; onsetDate?: string; source: string }>;

  if (conditions.length === 0) {
    return textResponse('No active conditions found in your health records. Connect health records using mhs_connect_ehr to import them.');
  }

  const lines: string[] = [];
  lines.push('--- Active Conditions ---\n');
  for (const c of conditions) {
    const onset = c.onsetDate ? ` (since ${formatDate(c.onsetDate)})` : '';
    lines.push(`  ${c.name} — ${c.status}${onset} ${cite(c.source)}`);
  }

  return textResponse(lines.join('\n'));
}

async function handleGetMedications(orchestrator: Orchestrator): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-all-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const data = result.payload.data as Record<string, unknown[]>;
  const meds = (data.medications || []) as Array<{ name: string; dose?: string; frequency?: string; status: string; source: string }>;

  if (meds.length === 0) {
    return textResponse('No medications found in your health records. Connect health records using mhs_connect_ehr to import them.');
  }

  const lines: string[] = [];
  lines.push('--- Current Medications ---\n');
  for (const m of meds) {
    const dose = m.dose ? ` ${m.dose}` : '';
    const freq = m.frequency ? ` (${m.frequency})` : '';
    lines.push(`  ${m.name}${dose}${freq} — ${m.status} ${cite(m.source)}`);
  }

  return textResponse(lines.join('\n'));
}

async function handleGetAllergies(orchestrator: Orchestrator): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-all-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const data = result.payload.data as Record<string, unknown[]>;
  const allergies = (data.allergies || []) as Array<{ name: string; type?: string; severity?: string; source: string }>;

  if (allergies.length === 0) {
    return textResponse('No allergies found in your health records. Connect health records using mhs_connect_ehr to import them.');
  }

  const lines: string[] = [];
  lines.push('--- Known Allergies ---\n');
  for (const a of allergies) {
    const typeStr = a.type ? ` (${a.type})` : '';
    const sevStr = a.severity ? ` — severity: ${a.severity}` : '';
    lines.push(`  ${a.name}${typeStr}${sevStr} ${cite(a.source)}`);
  }

  return textResponse(lines.join('\n'));
}

async function handleDetectDrift(orchestrator: Orchestrator): Promise<ReturnType<typeof textResponse>> {
  // Use analytics-agent to analyze and detect drift from 30-day baseline
  const analysisResult = await orchestrator.sendMessage('analytics-agent', 'analyze');
  if (analysisResult.type === 'error') return errorResponse(analysisResult.payload.error as string);

  const alerts = (analysisResult.payload.alerts || []) as Array<{ severity: string; message: string; metric: string }>;
  const scores = analysisResult.payload.scores as Record<string, number> | undefined;

  const lines: string[] = [];
  lines.push(`--- Drift Detection (vs. 30-day baseline) ---\n`);

  if (alerts.length > 0) {
    lines.push('Metrics with meaningful changes:\n');
    for (const a of alerts) {
      const icon = a.severity === 'critical' ? '[!!]' : a.severity === 'warning' ? '[!]' : '[*]';
      lines.push(`  ${icon} ${a.message} ${cite('analytics-agent', new Date())}`);
    }
  } else {
    lines.push('All tracked metrics are within normal range of your 30-day baseline.');
  }

  if (scores) {
    lines.push('\nCurrent scores:');
    for (const [cat, score] of Object.entries(scores)) {
      if (typeof score === 'number' && score >= 0) {
        lines.push(`  ${cat}: ${score}/100`);
      }
    }
  }

  return textResponse(lines.join('\n'));
}

async function handleChartData(orchestrator: Orchestrator, days?: number): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('analytics-agent', 'chart-data');
  if (result.type === 'error') return errorResponse(result.payload.error as string);

  const chartData = result.payload.chartData as ChartDataSet;
  const limit = Math.min(days ?? 90, chartData.labels.length);
  const startIdx = Math.max(0, chartData.labels.length - limit);

  const lines: string[] = [];
  lines.push(`--- Chart Data (last ${days ?? 90} days, ${chartData.labels.length} data points) ---\n`);

  // List available metrics
  const availableMetrics = Object.entries(chartData.series)
    .filter(([, values]) => values.some(v => v !== null))
    .map(([key]) => key);

  lines.push(`Available metrics: ${availableMetrics.join(', ')}\n`);

  // Show recent values for each metric
  for (const metric of availableMetrics) {
    const values = chartData.series[metric]!;
    const recentVals: string[] = [];
    for (let i = Math.max(startIdx, values.length - 7); i < values.length; i++) {
      if (values[i] !== null) {
        recentVals.push(`${chartData.labels[i]}: ${values[i]}`);
      }
    }
    if (recentVals.length > 0) {
      lines.push(`${metric}:`);
      for (const v of recentVals) {
        lines.push(`  ${v}`);
      }
      lines.push('');
    }
  }

  lines.push(`Data source: local health database ${cite('analytics-agent', new Date())}`);
  return textResponse(lines.join('\n'));
}

async function handleConnectDevice(orchestrator: Orchestrator, device: string): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('wearable-agent', 'authorize', { source: device });

  if (result.type === 'error') {
    return errorResponse(`Could not generate authorization link for ${device}: ${result.payload.error}`);
  }

  const payload = result.payload as { authorized?: boolean; authorization_url?: string };

  if (payload.authorized) {
    return textResponse(`Your ${device} device is already connected and syncing data. ${cite('wearable-agent', new Date())}`);
  }

  if (payload.authorization_url) {
    const lines: string[] = [];
    lines.push(`--- Connect ${device} ---\n`);
    lines.push('Open the following link to authorize your device:\n');
    lines.push(payload.authorization_url);
    lines.push('\nOnce authorized, your health data will sync automatically.');
    lines.push(`${cite('wearable-agent', new Date())}`);
    return textResponse(lines.join('\n'));
  }

  return errorResponse(`Unexpected response when connecting ${device}. Please try again.`);
}

async function handleConnectEhr(orchestrator: Orchestrator, email: string, password: string): Promise<ReturnType<typeof textResponse>> {
  const result = await orchestrator.sendMessage('ehr-agent', 'login', { email, password });

  if (result.type === 'error') {
    return errorResponse(`Could not connect health records: ${result.payload.error}`);
  }

  const lines: string[] = [];
  lines.push('--- Health Records Connected ---\n');
  lines.push('Successfully authenticated with your health records provider.');
  lines.push('Your medical data (labs, conditions, medications, allergies) will now sync automatically.');
  lines.push(`\nPerson ID: ${result.payload.personId || 'assigned'}`);
  lines.push(`${cite('health-records', new Date())}`);
  return textResponse(lines.join('\n'));
}

async function handleEarnings(contributeManager: ContributeManager | null): Promise<ReturnType<typeof textResponse>> {
  if (!contributeManager) {
    return textResponse(
      'Data contribution is not configured.\n' +
      'Set CONTRIBUTE_ENABLED=true and configure your wallet in .env to start earning USDC from anonymized health data contributions.',
    );
  }

  try {
    const earnings: EarningsSummary = await contributeManager.getEarnings();
    const lines: string[] = [];
    lines.push('--- XSpan Contribute Earnings ---\n');
    lines.push(`Total Earnings: $${earnings.totalEarningsUsdc.toFixed(2)} USDC`);
    lines.push(`Total Sales: ${earnings.totalSales}`);
    lines.push(`Active Listings: ${earnings.activeListings}`);
    lines.push(`Pending Payouts: ${earnings.pendingPayouts}`);
    if (earnings.lastSaleAt) {
      lines.push(`Last Sale: ${formatDate(earnings.lastSaleAt)}`);
    }
    lines.push(`\n${cite('contribute', new Date())}`);
    return textResponse(lines.join('\n'));
  } catch (err) {
    return errorResponse(`Could not fetch earnings: ${err}`);
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.error('[MyHealthSpan MCP] Starting server...');

  // 1. Create local store
  const dataDir = process.env.DATA_DIR || join(homedir(), '.xspan', 'data');
  const store = new LocalStore(dataDir);
  console.error(`[MyHealthSpan MCP] LocalStore initialized at ${dataDir}`);

  // 2. Create orchestrator
  const orchestrator = new Orchestrator(store);

  // 3. Register agents
  const env = process.env;
  const runtimeEnv: 'sandbox' | 'production' = (env.XSPAN_ENV === 'production') ? 'production' : 'sandbox';

  // Wearable Agent
  const wearableAgent = new WearableAgent(store, {
    clientUuid: env.ROOK_CLIENT_UUID || '',
    secretKey: env.ROOK_SECRET_KEY || '',
    environment: runtimeEnv,
    userId: env.ROOK_USER_ID || env.XSPAN_USER_ID || 'default-user',
  });
  orchestrator.registerAgent(wearableAgent);

  // EHR Agent
  const ehrAgent = new EhrAgent(store, {
    clientKey: env.BWELL_CLIENT_KEY || '',
    environment: runtimeEnv,
  });
  orchestrator.registerAgent(ehrAgent);

  // Analytics Agent
  const analyticsAgent = new AnalyticsAgent(store);
  orchestrator.registerAgent(analyticsAgent);

  // Summary Agent (if available)
  if (SummaryAgent) {
    const summaryAgent = new SummaryAgent(store);
    orchestrator.registerAgent(summaryAgent);
    console.error('[MyHealthSpan MCP] Summary agent registered');
  } else {
    console.error('[MyHealthSpan MCP] Summary agent not found — health_status will use analytics fallback');
  }

  // 4. Initialize orchestrator
  await orchestrator.initialize();

  // 5. Contribute Manager (optional)
  let contributeManager: ContributeManager | null = null;
  if (env.CONTRIBUTE_ENABLED === 'true' && env.CONTRIBUTE_WALLET_KEY) {
    try {
      contributeManager = new ContributeManager(
        {
          enabled: true,
          walletPath: env.CONTRIBUTE_WALLET_PATH || join(homedir(), '.xspan', 'wallet'),
          baseRpcUrl: env.BASE_RPC_URL || 'https://sepolia.base.org',
          paymasterUrl: env.PAYMASTER_URL || '',
          ipfsGatewayUrl: env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud',
          ipfsApiKey: env.PINATA_API_KEY || '',
          ipfsApiSecret: env.PINATA_API_SECRET || '',
          contracts: {
            consentRegistry: env.CONTRACT_CONSENT_REGISTRY || '',
            buyerAccessControl: env.CONTRACT_BUYER_ACCESS || '',
            dataRegistry: env.CONTRACT_DATA_REGISTRY || '',
            dataExchange: env.CONTRACT_DATA_EXCHANGE || '',
            usdc: env.CONTRACT_USDC || '',
          },
          consentVersion: parseInt(env.CONSENT_VERSION || '1', 10),
          partnerAddress: env.PARTNER_ADDRESS || null,
          autoListEnabled: env.AUTO_LIST_ENABLED === 'true',
          defaultPriceUsdc: parseFloat(env.DEFAULT_PRICE_USDC || '5'),
          selectedCategories: (env.CONTRIBUTE_CATEGORIES || 'cardiovascular,metabolic,sleep,activity').split(','),
        },
        env.CONTRIBUTE_WALLET_KEY,
      );
      console.error('[MyHealthSpan MCP] Contribute manager initialized');
    } catch (err) {
      console.error('[MyHealthSpan MCP] Contribute manager failed to initialize:', err);
    }
  }

  // 6. Create MCP Server
  const server = new Server(
    { name: 'myhealthspan-agent', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );

  // Register tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  // Register tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // Health Status
        case 'mhs_health_status':
          return await handleHealthStatus(orchestrator);

        case 'mhs_ask':
          return await handleAsk(orchestrator, (args as { question: string }).question);

        // Data Retrieval
        case 'mhs_get_labs': {
          const a = args as { category?: string; days?: number };
          return await handleGetLabs(orchestrator, a.category, a.days);
        }

        case 'mhs_get_vitals':
          return await handleGetVitals(orchestrator, (args as { days?: number }).days);

        case 'mhs_get_sleep':
          return await handleGetSleep(orchestrator, (args as { days?: number }).days);

        case 'mhs_get_activity':
          return await handleGetActivity(orchestrator, (args as { days?: number }).days);

        case 'mhs_get_conditions':
          return await handleGetConditions(orchestrator);

        case 'mhs_get_medications':
          return await handleGetMedications(orchestrator);

        case 'mhs_get_allergies':
          return await handleGetAllergies(orchestrator);

        // Analysis
        case 'mhs_detect_drift':
          return await handleDetectDrift(orchestrator);

        case 'mhs_chart_data':
          return await handleChartData(orchestrator, (args as { days?: number }).days);

        // Connection
        case 'mhs_connect_device':
          return await handleConnectDevice(orchestrator, (args as { device: string }).device);

        case 'mhs_connect_ehr': {
          const a = args as { email: string; password: string };
          return await handleConnectEhr(orchestrator, a.email, a.password);
        }

        // Contribute
        case 'mhs_earnings':
          return await handleEarnings(contributeManager);

        default:
          return errorResponse(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[MyHealthSpan MCP] Tool "${name}" failed:`, message);
      return errorResponse(`Tool execution failed: ${message}`);
    }
  });

  // 7. Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MyHealthSpan MCP] Server started on stdio transport');
  console.error('[MyHealthSpan MCP] 14 tools registered');

  // 8. Graceful shutdown
  const shutdown = async () => {
    console.error('[MyHealthSpan MCP] Shutting down...');
    await orchestrator.shutdown();
    store.close();
    await server.close();
    console.error('[MyHealthSpan MCP] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

main().catch((err) => {
  console.error('[MyHealthSpan MCP] Fatal error:', err);
  process.exit(1);
});
