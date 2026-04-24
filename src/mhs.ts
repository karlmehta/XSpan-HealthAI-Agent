#!/usr/bin/env node
// ============================================================
// MyHealthSpan CLI — `mhs` command
// Beautiful terminal health dashboard
// ============================================================

import { config as loadDotenv } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
import { LocalStore } from './storage/local-store.js';
import { Orchestrator } from './agents/orchestrator.js';
import { SummaryAgent } from './agents/summary-agent.js';
import { AnalyticsAgent } from './agents/analytics-agent.js';
import { WearableAgent } from './agents/wearable-agent.js';
import { EhrAgent } from './agents/ehr-agent.js';
import type { DailyHealthSummary } from './agents/types.js';
import { computeBaseline, detectDrift, getTopDrifts, formatDriftInsight } from './engine/baseline.js';

// Load environment
loadDotenv();

// ── ANSI Color Helpers ──────────────────────────────────────

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const WHITE = `${ESC}37m`;
const GRAY = `${ESC}90m`;
const BG_GREEN = `${ESC}42m`;
const BG_YELLOW = `${ESC}43m`;
const BG_RED = `${ESC}41m`;

function colorForStatus(status: 'good' | 'warning' | 'concern'): string {
  switch (status) {
    case 'good': return GREEN;
    case 'warning': return YELLOW;
    case 'concern': return RED;
  }
}

function colorForSeverity(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'info': return CYAN;
    case 'warning': return YELLOW;
    case 'critical': return RED;
  }
}

function statusDot(status: 'good' | 'warning' | 'concern'): string {
  const c = colorForStatus(status);
  return `${c}\u25CF${RESET}`;
}

function severityIcon(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'info': return `${CYAN}\u2139${RESET}`;
    case 'warning': return `${YELLOW}\u26A0${RESET}`;
    case 'critical': return `${RED}\u2716${RESET}`;
  }
}

function padRight(str: string, len: number): string {
  // Strip ANSI for length calc
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - plain.length);
  return str + ' '.repeat(pad);
}

function padLeft(str: string, len: number): string {
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - plain.length);
  return ' '.repeat(pad) + str;
}

// ── Box Drawing ─────────────────────────────────────────────

const BOX_WIDTH = 50;

function boxTop(): string {
  return `${CYAN}\u2554${'═'.repeat(BOX_WIDTH)}\u2557${RESET}`;
}

function boxBottom(): string {
  return `${CYAN}\u255A${'═'.repeat(BOX_WIDTH)}\u255D${RESET}`;
}

function boxLine(text: string): string {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, BOX_WIDTH - plain.length - 2);
  return `${CYAN}\u2551${RESET}  ${text}${' '.repeat(pad)}${CYAN}\u2551${RESET}`;
}

function separator(): string {
  return `${DIM}${'─'.repeat(BOX_WIDTH + 2)}${RESET}`;
}

function sectionHeader(title: string, score?: number): string {
  if (score !== undefined && score >= 0) {
    const c = score >= 75 ? GREEN : score >= 50 ? YELLOW : RED;
    return `\n${BOLD}${title}${RESET}${padLeft(`${c}${score}/100${RESET}`, BOX_WIDTH + 2 - title.length)}`;
  }
  if (score === -1) {
    return `\n${BOLD}${title}${RESET}${padLeft(`${DIM}Awaiting data${RESET}`, BOX_WIDTH + 2 - title.length)}`;
  }
  return `\n${BOLD}${title}${RESET}`;
}

// ── Formatting Helpers ──────────────────────────────────────

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function interpretStatus(status: 'good' | 'warning' | 'concern'): string {
  switch (status) {
    case 'good': return 'Normal';
    case 'warning': return 'Borderline';
    case 'concern': return 'Flagged';
  }
}

// ── Initialize System ───────────────────────────────────────

function initSystem(): { orchestrator: Orchestrator; store: LocalStore } {
  const dataDir = process.env.DATA_DIR || join(homedir(), '.xspan', 'data');
  const store = new LocalStore(dataDir);

  const orchestrator = new Orchestrator(store);

  // Register summary agent
  orchestrator.registerAgent(new SummaryAgent(store));

  // Register analytics agent
  orchestrator.registerAgent(new AnalyticsAgent(store));

  // Register wearable agent (if configured)
  const rookClientUuid = process.env.ROOK_CLIENT_UUID;
  const rookSecretKey = process.env.ROOK_SECRET_KEY;
  if (rookClientUuid && rookSecretKey) {
    orchestrator.registerAgent(new WearableAgent(store, {
      clientUuid: rookClientUuid,
      secretKey: rookSecretKey,
      environment: (process.env.ROOK_ENV as 'sandbox' | 'production') || 'sandbox',
      userId: process.env.XSPAN_USER_ID || 'default-user',
    }));
  }

  // Register EHR agent (if configured)
  const bwellClientKey = process.env.BWELL_CLIENT_KEY;
  if (bwellClientKey) {
    orchestrator.registerAgent(new EhrAgent(store, {
      clientKey: bwellClientKey,
      environment: (process.env.BWELL_ENV as 'sandbox' | 'production') || 'sandbox',
    }));
  }

  return { orchestrator, store };
}

// ── Commands ────────────────────────────────────────────────

async function cmdStatus(orchestrator: Orchestrator, store: LocalStore): Promise<void> {
  // Suppress agent registration logs for clean CLI output
  const result = await orchestrator.sendMessage('summary-agent', 'generate-daily');
  const summary = result.payload.summary as DailyHealthSummary | undefined;

  const today = formatDate(new Date());

  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Health Status${RESET}`));
  console.log(boxLine(`${DIM}${today}${RESET}`));
  console.log(boxBottom());

  if (!summary) {
    console.log(`\n${DIM}No health data available. Connect a device or health system.${RESET}`);
    console.log(`${DIM}Run: mhs connect ehr${RESET}\n`);
    return;
  }

  // Overall score
  const oc = summary.overallScore >= 75 ? GREEN : summary.overallScore >= 50 ? YELLOW : RED;
  console.log(`\n${DIM}Overall:${RESET} ${BOLD}${oc}${summary.overallScore}/100${RESET}`);

  if (summary.headline) {
    console.log(`${DIM}${summary.headline}${RESET}`);
  }

  // Cardiovascular
  printCategorySection('CARDIOVASCULAR', summary.cardiovascular, summary.keyMetrics.filter(m =>
    ['Resting HR', 'HRV', 'Systolic BP', 'Diastolic BP', 'SpO2', 'LDL Cholesterol', 'HDL Cholesterol', 'Triglycerides'].includes(m.label)
  ));

  // Metabolic
  printCategorySection('METABOLIC', summary.metabolic, summary.keyMetrics.filter(m =>
    ['HbA1c', 'Glucose', 'Creatinine', 'TSH'].includes(m.label)
  ));

  // Sleep
  printCategorySection('SLEEP', summary.sleep, summary.keyMetrics.filter(m =>
    ['Sleep Duration', 'Deep Sleep', 'REM Sleep', 'Sleep Score', 'Sleep Efficiency'].includes(m.label)
  ));

  // Activity
  printCategorySection('ACTIVITY', summary.activity, summary.keyMetrics.filter(m =>
    ['Steps', 'Recovery', 'Strain', 'VO2 Max', 'Active Calories'].includes(m.label)
  ));

  // Alerts
  if (summary.alerts.length > 0) {
    console.log(sectionHeader('ALERTS'));
    for (const alert of summary.alerts) {
      console.log(`  ${severityIcon(alert.severity)} ${alert.message}`);
    }
  }

  // Sources & record count
  console.log('');
  console.log(separator());
  const sourceStr = summary.sources.length > 0 ? summary.sources.join(', ') : 'None';
  console.log(`${DIM}Sources: ${sourceStr}${RESET}`);

  // Count total records
  const countRow = (store as unknown as { db: { prepare: (sql: string) => { get: () => { cnt: number } | undefined } } })
    .db.prepare('SELECT COUNT(*) as cnt FROM health_samples').get();
  const totalRecords = countRow?.cnt ?? 0;
  console.log(`${DIM}Records: ${totalRecords} analyzed | Last sync: just now${RESET}`);
  console.log('');
}

function printCategorySection(
  title: string,
  category: { score: number; summary: string; dataPoints: string[] },
  metrics: Array<{ label: string; value: string; unit: string; trend: string; status: 'good' | 'warning' | 'concern' }>,
): void {
  console.log(sectionHeader(title, category.score));

  if (category.score < 0) {
    console.log(`  ${DIM}Connect a device or health system for ${title.toLowerCase()} insights${RESET}`);
    return;
  }

  for (const m of metrics) {
    const valueStr = `${m.value} ${m.unit}`;
    const interpStr = interpretStatus(m.status);
    const dot = statusDot(m.status);
    const statusColor = colorForStatus(m.status);

    // Format: label (left aligned) + value + interpretation (right aligned)
    const labelPart = `  ${padRight(m.label, 18)}`;
    const valuePart = padRight(valueStr, 14);
    const statusPart = `${dot} ${statusColor}${interpStr}${RESET}`;

    console.log(`${labelPart}${valuePart}${statusPart}`);
  }
}

async function cmdLabs(orchestrator: Orchestrator, category?: string): Promise<void> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-lab-summary');
  const labs = (result.payload.labs as Array<{
    date: string; testName: string; value: number; unit: string;
    category: string; interpretation?: string; source: string;
  }>) || [];

  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Lab Results${RESET}`));
  console.log(boxBottom());

  if (labs.length === 0) {
    console.log(`\n${DIM}No lab data available. Connect your health records.${RESET}`);
    console.log(`${DIM}Run: mhs connect ehr${RESET}\n`);
    return;
  }

  const filtered = category ? labs.filter(l => l.category.toLowerCase() === category.toLowerCase()) : labs;

  // Group by category
  const grouped: Record<string, typeof filtered> = {};
  for (const lab of filtered) {
    const cat = lab.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(lab);
  }

  for (const [cat, items] of Object.entries(grouped)) {
    console.log(`\n${BOLD}${cat.toUpperCase()}${RESET}`);
    for (const lab of items!) {
      const date = lab.date.split('T')[0] ?? lab.date;
      const interp = lab.interpretation || 'normal';
      const c = interp === 'normal' ? GREEN : interp === 'high' ? RED : YELLOW;
      console.log(`  ${padRight(lab.testName, 30)} ${padRight(`${lab.value} ${lab.unit}`, 16)} ${DIM}(${date})${RESET}  ${c}${interp}${RESET}`);
    }
  }
  console.log('');
}

async function cmdVitals(orchestrator: Orchestrator): Promise<void> {
  const result = await orchestrator.sendMessage('analytics-agent', 'get-lab-summary');
  const vitals = (result.payload.vitals as Array<{
    date: string; heartRate?: number; bpSystolic?: number; bpDiastolic?: number; spo2?: number; source: string;
  }>) || [];

  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Vitals${RESET}`));
  console.log(boxBottom());

  if (vitals.length === 0) {
    console.log(`\n${DIM}No vital data available. Connect a wearable or health system.${RESET}\n`);
    return;
  }

  for (const v of vitals.slice(0, 20)) {
    const date = v.date.split('T')[0] ?? v.date;
    const parts: string[] = [];
    if (v.heartRate) parts.push(`HR: ${v.heartRate} bpm`);
    if (v.bpSystolic) parts.push(`BP: ${v.bpSystolic} mmHg`);
    if (v.bpDiastolic) parts.push(`BP(d): ${v.bpDiastolic} mmHg`);
    if (v.spo2) parts.push(`SpO2: ${v.spo2}%`);
    console.log(`  ${DIM}${date}${RESET}  ${parts.join('  |  ')}`);
  }
  console.log('');
}

async function cmdSleep(orchestrator: Orchestrator, days?: number): Promise<void> {
  const result = await orchestrator.sendMessage('summary-agent', 'generate-daily');
  const summary = result.payload.summary as DailyHealthSummary | undefined;

  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Sleep${RESET}`));
  console.log(boxBottom());

  if (!summary || summary.sleep.score < 0) {
    console.log(`\n${DIM}No sleep data available. Connect Oura, WHOOP, or Apple Watch.${RESET}`);
    console.log(`${DIM}Run: mhs connect oura${RESET}\n`);
    return;
  }

  const sc = summary.sleep.score >= 75 ? GREEN : summary.sleep.score >= 50 ? YELLOW : RED;
  console.log(`\n${DIM}Sleep Score:${RESET} ${BOLD}${sc}${summary.sleep.score}/100${RESET}`);
  console.log(`${DIM}${summary.sleep.summary}${RESET}`);

  if (summary.sleep.dataPoints.length > 0) {
    console.log('');
    for (const dp of summary.sleep.dataPoints) {
      console.log(`  ${dp}`);
    }
  }
  console.log('');
}

async function cmdActivity(orchestrator: Orchestrator, days?: number): Promise<void> {
  const result = await orchestrator.sendMessage('summary-agent', 'generate-daily');
  const summary = result.payload.summary as DailyHealthSummary | undefined;

  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Activity${RESET}`));
  console.log(boxBottom());

  if (!summary || summary.activity.score < 0) {
    console.log(`\n${DIM}No activity data available. Connect a wearable.${RESET}`);
    console.log(`${DIM}Run: mhs connect fitbit${RESET}\n`);
    return;
  }

  const ac = summary.activity.score >= 75 ? GREEN : summary.activity.score >= 50 ? YELLOW : RED;
  console.log(`\n${DIM}Activity Score:${RESET} ${BOLD}${ac}${summary.activity.score}/100${RESET}`);
  console.log(`${DIM}${summary.activity.summary}${RESET}`);

  if (summary.activity.dataPoints.length > 0) {
    console.log('');
    for (const dp of summary.activity.dataPoints) {
      console.log(`  ${dp}`);
    }
  }
  console.log('');
}

async function cmdConditions(store: LocalStore): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Conditions${RESET}`));
  console.log(boxBottom());

  // Query conditions from health samples metadata
  const rows = (store as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ data_type: string; value: number; recorded_at: string }> } } })
    .db.prepare(
      "SELECT DISTINCT data_type, value, recorded_at FROM health_samples WHERE data_type LIKE '%condition%' OR data_type LIKE '%diagnosis%' ORDER BY recorded_at DESC LIMIT 20"
    ).all();

  if (rows.length === 0) {
    console.log(`\n${DIM}No conditions on record. Connect your health records for diagnoses.${RESET}`);
    console.log(`${DIM}Run: mhs connect ehr${RESET}\n`);
    return;
  }

  for (const row of rows) {
    const date = row.recorded_at.split('T')[0] ?? row.recorded_at;
    console.log(`  ${GREEN}\u25CF${RESET} ${row.data_type}  ${DIM}(${date})${RESET}`);
  }
  console.log('');
}

async function cmdMedications(store: LocalStore): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Medications${RESET}`));
  console.log(boxBottom());

  const rows = (store as unknown as { db: { prepare: (sql: string) => { all: () => Array<{ data_type: string; value: number; recorded_at: string }> } } })
    .db.prepare(
      "SELECT DISTINCT data_type, value, recorded_at FROM health_samples WHERE data_type LIKE '%medication%' OR data_type LIKE '%prescription%' ORDER BY recorded_at DESC LIMIT 20"
    ).all();

  if (rows.length === 0) {
    console.log(`\n${DIM}No medications on record. Connect your health records.${RESET}`);
    console.log(`${DIM}Run: mhs connect ehr${RESET}\n`);
    return;
  }

  for (const row of rows) {
    const date = row.recorded_at.split('T')[0] ?? row.recorded_at;
    console.log(`  ${CYAN}\u25CF${RESET} ${row.data_type}  ${DIM}(since ${date})${RESET}`);
  }
  console.log('');
}

async function cmdDrift(store: LocalStore): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Baseline Drift${RESET}`));
  console.log(boxBottom());

  const snapshots = store.getSnapshots(60);

  if (snapshots.length < 2) {
    console.log(`\n${DIM}Not enough data for drift detection. Need at least 7 days of biomarker snapshots.${RESET}\n`);
    return;
  }

  const baseline = computeBaseline(snapshots, 30);
  const latest = snapshots[0]!;
  const drifts = detectDrift(latest.biomarkers, baseline);
  const topDrifts = getTopDrifts(drifts, 10);

  if (topDrifts.length === 0) {
    console.log(`\n${GREEN}\u2714${RESET} No significant drift from your 30-day baselines.\n`);
    return;
  }

  console.log('');
  for (const drift of topDrifts) {
    const insight = formatDriftInsight(drift, '30-day');
    const icon = drift.severity === 'significant' ? `${RED}\u25B2${RESET}` :
                 drift.severity === 'notable' ? `${YELLOW}\u25B3${RESET}` :
                 `${GREEN}\u25CB${RESET}`;
    const sevLabel = drift.severity === 'significant' ? `${RED}${drift.severity}${RESET}` :
                     drift.severity === 'notable' ? `${YELLOW}${drift.severity}${RESET}` :
                     `${DIM}${drift.severity}${RESET}`;
    console.log(`  ${icon} ${insight}  ${DIM}[${sevLabel}${DIM}]${RESET}`);
  }
  console.log('');
}

async function cmdConnect(device: string): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Connect${RESET}`));
  console.log(boxBottom());

  const deviceLower = device.toLowerCase();

  if (deviceLower === 'ehr' || deviceLower === 'health-records') {
    console.log(`
${BOLD}Connect Health Records${RESET}

  MyHealthSpan connects to 650+ hospitals and clinics via b.well.

  ${CYAN}Steps:${RESET}
  1. Set BWELL_CLIENT_KEY in your .env file
  2. Run: ${BOLD}mhs connect ehr${RESET}
  3. Log in with your health system credentials
  4. Your records sync automatically

  ${DIM}Supported: Epic MyChart, Cerner, Allscripts, and 650+ more${RESET}
`);
  } else {
    const wearableNames: Record<string, string> = {
      oura: 'Oura Ring', whoop: 'WHOOP', fitbit: 'Fitbit',
      garmin: 'Garmin', dexcom: 'Dexcom CGM', withings: 'Withings',
      polar: 'Polar', apple: 'Apple Health', google: 'Google Fit',
    };

    const displayName = wearableNames[deviceLower] || device;

    console.log(`
${BOLD}Connect ${displayName}${RESET}

  MyHealthSpan connects wearables via the ROOK platform.

  ${CYAN}Steps:${RESET}
  1. Set ROOK_CLIENT_UUID and ROOK_SECRET_KEY in your .env file
  2. Run: ${BOLD}mhs connect ${deviceLower}${RESET}
  3. Authorize access to your ${displayName} data
  4. Data syncs automatically every ${process.env.SYNC_INTERVAL_MINUTES || '15'} minutes

  ${DIM}Need a ROOK account? Visit https://dashboard.tryrook.io${RESET}
`);
  }
}

async function cmdEarnings(): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Earnings${RESET}`));
  console.log(boxBottom());

  const walletKey = process.env.XSPAN_WALLET_PRIVATE_KEY;
  if (!walletKey) {
    console.log(`
${DIM}XSpan Contribute is not configured.${RESET}

  Earn USDC by contributing de-identified health data to research.

  ${CYAN}Setup:${RESET}
  1. Set XSPAN_WALLET_PRIVATE_KEY in your .env
  2. Configure IPFS keys (PINATA_API_KEY, PINATA_API_SECRET)
  3. Run: ${BOLD}mhs earnings${RESET} to check your balance

  ${DIM}Your data is de-identified locally before any upload.${RESET}
  ${DIM}You control what categories to share and can revoke anytime.${RESET}
`);
    return;
  }

  // Dynamic import to avoid requiring ethers when not configured
  try {
    const { ContributeManager } = await import('./contribute/index.js');
    const contributeConfig = {
      enabled: true,
      walletPath: join(homedir(), '.xspan', 'wallet'),
      baseRpcUrl: process.env.BASE_RPC_URL || 'https://sepolia.base.org',
      paymasterUrl: process.env.PAYMASTER_URL || '',
      ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud',
      ipfsApiKey: process.env.PINATA_API_KEY || '',
      ipfsApiSecret: process.env.PINATA_API_SECRET || '',
      contracts: {
        consentRegistry: process.env.CONSENT_REGISTRY_ADDRESS || '',
        buyerAccessControl: process.env.BUYER_ACCESS_CONTROL_ADDRESS || '',
        dataRegistry: process.env.DATA_REGISTRY_ADDRESS || '',
        dataExchange: process.env.DATA_EXCHANGE_ADDRESS || '',
        usdc: process.env.USDC_ADDRESS || '',
      },
      consentVersion: 1,
      partnerAddress: process.env.PARTNER_ADDRESS || null,
      autoListEnabled: false,
      defaultPriceUsdc: 5,
      selectedCategories: ['cardiovascular', 'metabolic', 'sleep', 'activity'],
    };

    const manager = new ContributeManager(contributeConfig, walletKey);
    const status = await manager.getStatus();

    console.log(`
${BOLD}Wallet${RESET}
  Address:  ${DIM}${status.walletAddress}${RESET}
  Balance:  ${GREEN}${status.balance} ETH${RESET}
  Enrolled: ${status.enrolled ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}

${BOLD}Earnings${RESET}
  Total:    ${GREEN}$${status.earnings.totalEarningsUsdc.toFixed(2)} USDC${RESET}
  Sales:    ${status.earnings.totalSales}
  Active:   ${status.earnings.activeListings} listing${status.earnings.activeListings !== 1 ? 's' : ''}
  Pending:  $${status.earnings.pendingPayouts.toFixed(2)} USDC
`);
  } catch (err) {
    console.log(`\n${RED}Error loading earnings:${RESET} ${String(err)}\n`);
  }
}

async function cmdAsk(orchestrator: Orchestrator, question: string): Promise<void> {
  console.log('');

  const result = await orchestrator.sendMessage('summary-agent', 'answer-question', { question });

  if (result.type === 'error') {
    console.log(`${RED}Error:${RESET} ${result.payload.error}\n`);
    return;
  }

  const answer = result.payload.answer as string;
  const citations = (result.payload.citations as string[]) || [];

  console.log(`${BOLD}Q:${RESET} ${question}`);
  console.log('');

  // Format each line of the answer
  const lines = answer.split('\n');
  for (const line of lines) {
    console.log(`  ${line}`);
  }

  if (citations.length > 0) {
    console.log('');
    console.log(`${DIM}Sources:${RESET}`);
    for (const cite of citations) {
      console.log(`  ${DIM}\u2022 ${cite}${RESET}`);
    }
  }
  console.log('');
}

async function cmdServe(): Promise<void> {
  console.log('');
  console.log(boxTop());
  console.log(boxLine(`${BOLD}MyHealthSpan \u2014 Dashboard${RESET}`));
  console.log(boxBottom());
  console.log(`
${DIM}Starting web dashboard...${RESET}
`);

  // Import and start the dashboard server
  try {
    const { loadConfig } = await import('./config/index.js');
    const { startDashboard } = await import('./dashboard/server.js');
    const { DataPipeline } = await import('./sync/data-pipeline.js');

    const config = loadConfig();
    const store = new LocalStore(config.storage.dataDir);
    const pipeline = new DataPipeline(config);

    startDashboard(config, store, pipeline);

    console.log(`${GREEN}\u2714${RESET} Dashboard running at ${BOLD}http://localhost:3000${RESET}`);
    console.log(`${DIM}Press Ctrl+C to stop${RESET}\n`);

    // Open in browser
    try {
      const { execSync } = await import('child_process');
      if (process.platform === 'darwin') {
        execSync('open http://localhost:3000');
      } else if (process.platform === 'win32') {
        execSync('start http://localhost:3000');
      } else {
        execSync('xdg-open http://localhost:3000');
      }
    } catch {}

    // Keep alive
    await new Promise(() => {});
  } catch (err) {
    console.log(`${RED}Error starting dashboard:${RESET} ${String(err)}\n`);
  }
}

function cmdHelp(): void {
  console.log(`
${BOLD}MyHealthSpan CLI${RESET} ${DIM}v2.0.0${RESET}
Own your health data. Get insights. Earn from research.

${BOLD}USAGE${RESET}
  mhs [command] [options]

${BOLD}COMMANDS${RESET}
  ${CYAN}status${RESET}              Daily health briefing (default)
  ${CYAN}labs${RESET} [category]      Recent lab results with interpretation
  ${CYAN}vitals${RESET}              Recent vital signs
  ${CYAN}sleep${RESET} [days]         Sleep data and scores
  ${CYAN}activity${RESET} [days]      Activity data and scores
  ${CYAN}conditions${RESET}          Active conditions from health records
  ${CYAN}medications${RESET}         Current medications
  ${CYAN}drift${RESET}               Baseline drift alerts
  ${CYAN}ask${RESET} "<question>"    Data-grounded health Q&A
  ${CYAN}connect${RESET} <device>    Connect a wearable device
  ${CYAN}connect ehr${RESET}         Connect health records (EHR)
  ${CYAN}earnings${RESET}            USDC earnings from XSpan Contribute
  ${CYAN}serve${RESET}               Start the web dashboard
  ${CYAN}help${RESET}                Show this help message

${BOLD}EXAMPLES${RESET}
  mhs                          Show daily health status
  mhs labs lipids              Show lipid panel results
  mhs sleep 7                  Sleep data for last 7 days
  mhs ask "What is my HbA1c?"  Ask about specific metrics
  mhs connect oura             Connect Oura Ring
  mhs drift                    Check for baseline changes

${BOLD}CONFIGURATION${RESET}
  Config file: ${DIM}~/.xspan/.env${RESET}
  Data store:  ${DIM}~/.xspan/data/xspan.db${RESET}

${DIM}All data stays local. Zero cloud dependencies.${RESET}
${DIM}https://github.com/karlmehta/XSpan-HealthAI-Agent${RESET}
`);
}

// ── Main Entry Point ────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() || 'status';

  // Handle help before initializing (fast path)
  if (command === 'help' || command === '--help' || command === '-h') {
    cmdHelp();
    return;
  }

  // Handle connect before full init
  if (command === 'connect') {
    const device = args[1] || 'ehr';
    await cmdConnect(device);
    return;
  }

  // Handle serve
  if (command === 'serve') {
    await cmdServe();
    return;
  }

  // Handle earnings
  if (command === 'earnings') {
    await cmdEarnings();
    return;
  }

  // Initialize for data-driven commands
  const { orchestrator, store } = initSystem();
  await orchestrator.initialize();

  try {
    switch (command) {
      case 'status':
        await cmdStatus(orchestrator, store);
        break;

      case 'labs':
        await cmdLabs(orchestrator, args[1]);
        break;

      case 'vitals':
        await cmdVitals(orchestrator);
        break;

      case 'sleep':
        await cmdSleep(orchestrator, args[1] ? parseInt(args[1], 10) : undefined);
        break;

      case 'activity':
        await cmdActivity(orchestrator, args[1] ? parseInt(args[1], 10) : undefined);
        break;

      case 'conditions':
        await cmdConditions(store);
        break;

      case 'medications':
        await cmdMedications(store);
        break;

      case 'drift':
        await cmdDrift(store);
        break;

      case 'ask':
        const question = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
        if (!question) {
          console.log(`\n${RED}Usage:${RESET} mhs ask "your question here"\n`);
          break;
        }
        await cmdAsk(orchestrator, question);
        break;

      default:
        console.log(`\n${RED}Unknown command:${RESET} ${command}`);
        console.log(`${DIM}Run: mhs help${RESET}\n`);
        break;
    }
  } finally {
    await orchestrator.shutdown();
    store.close();
  }
}

// ── Launch ──────────────────────────────────────────────────

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
