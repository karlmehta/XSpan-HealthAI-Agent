// ============================================================
// MyHealthSpan Agent — Dashboard (app.ts)
// Clean single-file web server delegating to Orchestrator
// No Express — just built-in http module
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { LocalStore } from '../storage/local-store.js';
import { Orchestrator } from '../agents/orchestrator.js';
import { WearableAgent } from '../agents/wearable-agent.js';
import { EhrAgent } from '../agents/ehr-agent.js';
import { AnalyticsAgent } from '../agents/analytics-agent.js';
import { SummaryAgent } from '../agents/summary-agent.js';
import { StorageAgent } from '../agents/storage-agent.js';

loadDotenv();

// 

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.xspan', 'data');
const PORT = 3000;

const store = new LocalStore(DATA_DIR);
const orchestrator = new Orchestrator(store);

// Register agents
orchestrator.registerAgent(new SummaryAgent(store));
orchestrator.registerAgent(new AnalyticsAgent(store));
orchestrator.registerAgent(new StorageAgent(store));

const rookClientUuid = process.env.ROOK_CLIENT_UUID;
const rookSecretKey = process.env.ROOK_SECRET_KEY;
if (rookClientUuid && rookSecretKey) {
  orchestrator.registerAgent(new WearableAgent(store, {
    clientUuid: rookClientUuid,
    secretKey: rookSecretKey,
    environment: (process.env.ROOK_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    userId: process.env.ROOK_USER_ID || 'karl001',
  }));
}

const bwellClientKey = process.env.BWELL_CLIENT_KEY;
let ehrAgent: EhrAgent | null = null;
if (bwellClientKey) {
  ehrAgent = new EhrAgent(store, {
    clientKey: bwellClientKey,
    environment: (process.env.BWELL_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
  });
  orchestrator.registerAgent(ehrAgent);
}

// 

let sessionUser: { email: string; loggedIn: boolean } | null = null;

// 

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: string): Record<string, string> {
  const q: Record<string, string> = {};
  const idx = url.indexOf('?');
  if (idx < 0) return q;
  const params = url.slice(idx + 1).split('&');
  for (const p of params) {
    const [k, v] = p.split('=');
    if (k) q[k] = decodeURIComponent(v || '');
  }
  return q;
}

function routePath(url: string): string {
  const idx = url.indexOf('?');
  return idx >= 0 ? url.slice(0, idx) : url;
}

// 

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = routePath(req.url || '/');
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    switch (path) {
      case '/api/status': {
        const summary = await orchestrator.getDailySummary();
        json(res, { ok: true, summary });
        return;
      }

      case '/api/charts': {
        // Clinical synthesis panels — query SQLite directly
        const db = (store as any).db;

        interface PanelDef {
          id: string;
          title: string;
          subtitle: string;
          likePatterns: string[];
          refLines?: Record<string, { high?: number; low?: number }>;
        }

        const panelDefs: PanelDef[] = [
          {
            id: 'diabetes',
            title: 'Diabetes Synthesis',
            subtitle: 'HbA1c + Glucose + Insulin &#x2014; the complete picture',
            likePatterns: ['%a1c%', '%glucose%', '%insulin%'],
            refLines: { 'HbA1c': { high: 5.7 } },
          },
          {
            id: 'thyroid',
            title: 'Thyroid Synthesis',
            subtitle: 'TSH + Free T4 + Free T3',
            likePatterns: ['%thyrotropin%', '%thyroxine%', '%triiodothyronine%'],
            refLines: { 'TSH': { high: 4.5 } },
          },
          {
            id: 'lipid',
            title: 'Lipid Synthesis',
            subtitle: 'Total Cholesterol + LDL + HDL + Triglycerides',
            likePatterns: ['%cholesterol [mass%', '%cholesterol in hdl%', '%cholesterol in ldl%', '%triglyceride%'],
          },
          {
            id: 'kidney',
            title: 'Kidney Function',
            subtitle: 'Creatinine + eGFR',
            likePatterns: ['%creatinine [mass%', '%glomerular%'],
          },
          {
            id: 'inflammation',
            title: 'Inflammation',
            subtitle: 'CRP + Homocysteine + ESR',
            likePatterns: ['%c reactive%', '%homocyst%', '%sedimentation%'],
          },
          {
            id: 'vitamins',
            title: 'Vitamins &amp; Minerals',
            subtitle: 'Vitamin D + B12 + Ferritin + Iron',
            likePatterns: ['%hydroxyvitamin%', '%cobalamin%', '%ferritin%', '%iron [mass%'],
          },
          {
            id: 'liver',
            title: 'Liver Function',
            subtitle: 'ALT + AST + Bilirubin',
            likePatterns: ['%alanine amino%', '%aspartate amino%', '%bilirubin%'],
          },
          {
            id: 'hormones',
            title: 'Hormones',
            subtitle: 'Testosterone + Cortisol + DHEA-S — key markers that change with age',
            likePatterns: ['%testosterone%', '%cortisol%', '%dhea%', '%estradiol%', '%igf%', '%shbg%', '%prolactin%', '%follicle stim%', '%luteinizing%'],
            refLines: { 'Testosterone': { low: 264 } },
          },
          {
            id: 'body',
            title: 'Body Composition',
            subtitle: 'Weight + Height + BMI trend across clinical visits',
            likePatterns: ['%weight%', '%height%', '%body mass index%', '%bmi%'],
          },
          {
            id: 'vitals',
            title: 'Vitals',
            subtitle: 'Heart Rate + SpO2 + Temperature + Respirations',
            likePatterns: ['%pulse%', '%spo2%', '%temperature%', '%respiration%'],
          },
          {
            id: 'prostate',
            title: 'Prostate &amp; Urology',
            subtitle: 'PSA + Uric Acid — screening markers',
            likePatterns: ['%prostate specific%', '%urate%', '%uric acid%'],
            refLines: { 'Prostate': { high: 4.0 } },
          },
          {
            id: 'thyroid-antibodies',
            title: 'Thyroid Antibodies',
            subtitle: 'Thyroglobulin Ab + TPO Ab — autoimmune thyroid markers',
            likePatterns: ['%thyroglobulin ab%', '%thyroperoxidase%'],
          },
          {
            id: 'advanced-lipid',
            title: 'Advanced Lipid',
            subtitle: 'ApoB + ApoA-I + Lp(a) — beyond standard lipid panel',
            likePatterns: ['%apolipoprotein a%', '%apolipoprotein b%', '%lipoprotein a%'],
          },
        ];

        // Add clinical education context to insights for specific panels
        const panelContext: Record<string, string> = {
          'hormones': ' Note: Testosterone naturally declines ~1% per year after age 30. Cortisol follows a diurnal pattern (highest in morning). These values should be interpreted in context of age, time of draw, and symptoms.',
          'diabetes': ' Clinical context: A1c alone does not tell the full story. Seeing glucose trend, insulin level, and A1c together reveals insulin resistance patterns that a single A1c reading misses. ADA guidelines use A1c >= 5.7% as prediabetes threshold, but fasting insulin < 10 uU/mL with normal glucose suggests good insulin sensitivity.',
          'thyroid': ' Clinical context: TSH alone is insufficient. Free T4 and Free T3 show how much active thyroid hormone is available. TSH can be elevated while T4 is normal (subclinical hypothyroidism). Thyroid antibodies (separate panel) indicate autoimmune cause.',
          'lipid': ' Clinical context: Total cholesterol alone is misleading. The LDL/HDL ratio and triglyceride level matter more. HDL < 40 mg/dL in men is a cardiovascular risk factor independent of LDL. Triglycerides > 150 suggest metabolic issues.',
          'kidney': ' Clinical context: eGFR is calculated from creatinine adjusted for age, sex, and race. eGFR > 90 is normal. A declining trend even within normal range warrants monitoring. Creatinine alone can be misleading — muscle mass affects it.',
          'advanced-lipid': ' Clinical context: ApoB is considered a better predictor of cardiovascular risk than LDL-C. Each atherogenic particle carries one ApoB molecule. Lp(a) is genetically determined and an independent CV risk factor — values > 50 mg/dL or > 75 nmol/L are considered elevated.',
          'body': ' Clinical context: BMI is a screening tool, not a diagnostic measure. Body composition (muscle vs fat) matters more. Weight trends over time are more informative than a single measurement.',
        };

        const COLORS = ['#EF4444', '#FBBF24', '#22C55E', '#3B82F6', '#A78BFA', '#06B6D4', '#F97316', '#EC4899'];

        const panels: any[] = [];

        for (const def of panelDefs) {
          // Build WHERE clause with OR conditions for LIKE patterns
          const whereClauses = def.likePatterns.map((_p, i) => `LOWER(data_type) LIKE ?`).join(' OR ');
          const sql = `SELECT data_type, value, unit, date(recorded_at) as date FROM health_samples WHERE (${whereClauses}) ORDER BY date ASC`;

          let rows: any[] = [];
          try {
            rows = db.prepare(sql).all(...def.likePatterns);
          } catch (_e) {
            // Table may not exist or query fails
          }

          if (rows.length === 0) {
            panels.push({
              id: def.id,
              title: def.title,
              subtitle: def.subtitle,
              insight: '',
              labels: [],
              datasets: [],
              status: 'empty',
              alerts: [],
            });
            continue;
          }

          // Group by data_type, deduplicate by date (first value per date per metric)
          const metricMap: Record<string, { values: Map<string, number>; unit: string }> = {};
          for (const row of rows) {
            const dtype = String(row.data_type);
            if (!metricMap[dtype]) {
              metricMap[dtype] = { values: new Map(), unit: String(row.unit || '') };
            }
            const dateKey = String(row.date || '').split('T')[0];
            if (dateKey && !metricMap[dtype].values.has(dateKey)) {
              const numVal = parseFloat(String(row.value));
              if (!isNaN(numVal)) {
                metricMap[dtype].values.set(dateKey, numVal);
              }
            }
          }

          // Collect all unique dates across metrics and sort
          const allDates = new Set<string>();
          for (const m of Object.values(metricMap)) {
            for (const d of m.values.keys()) allDates.add(d);
          }
          const sortedDates = Array.from(allDates).sort();

          // Format labels as "Mon YY"
          const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const labels = sortedDates.map(d => {
            const parts = d.split('-');
            const monthIdx = parseInt(parts[1], 10) - 1;
            const yr = parts[0].slice(2);
            return MONTHS[monthIdx] + ' ' + yr;
          });

          // Build datasets
          const metricNames = Object.keys(metricMap);
          const datasets: any[] = [];
          // Determine if we need dual axes (different units)
          const units = Array.from(new Set(metricNames.map(n => metricMap[n].unit)));
          const needsDualAxis = units.length > 1;

          for (let mi = 0; mi < metricNames.length; mi++) {
            const mName = metricNames[mi];
            const mData = metricMap[mName];
            // Shorten label: take first meaningful part of LOINC name
            const shortLabel = mName.length > 40 ? mName.slice(0, 38) + '..' : mName;
            const displayLabel = shortLabel + (mData.unit ? ' (' + mData.unit + ')' : '');

            const dataArr = sortedDates.map(d => {
              const v = mData.values.get(d);
              return v !== undefined ? v : null;
            });

            const dsObj: any = {
              label: displayLabel,
              data: dataArr,
              color: COLORS[mi % COLORS.length],
            };

            // Assign second y-axis for metrics with a different unit
            if (needsDualAxis && mi > 0 && mData.unit !== metricMap[metricNames[0]].unit) {
              dsObj.yAxisID = 'y1';
            }

            // Reference lines from panel definition
            if (def.refLines) {
              for (const [refKey, refVal] of Object.entries(def.refLines)) {
                if (mName.toLowerCase().includes(refKey.toLowerCase())) {
                  if (refVal.high !== undefined) dsObj.refHigh = refVal.high;
                  if (refVal.low !== undefined) dsObj.refLow = refVal.low;
                }
              }
            }

            datasets.push(dsObj);
          }

          // Generate insight string automatically from data
          const insightParts: string[] = [];
          for (const mName of metricNames) {
            const mData = metricMap[mName];
            const vals = Array.from(mData.values.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            if (vals.length === 0) continue;
            const shortName = mName.length > 30 ? mName.slice(0, 28) + '..' : mName;
            if (vals.length === 1) {
              insightParts.push(shortName + ': ' + vals[0][1] + ' ' + mData.unit + ' on ' + vals[0][0]);
            } else {
              const first = vals[0];
              const last = vals[vals.length - 1];
              const allVals = vals.map(v => v[1]);
              const minV = Math.min(...allVals);
              const maxV = Math.max(...allVals);
              if (minV === maxV) {
                insightParts.push(shortName + ': stable at ' + first[1] + ' ' + mData.unit);
              } else {
                const trend = last[1] > first[1] ? 'rising' : last[1] < first[1] ? 'declining' : 'stable';
                insightParts.push(shortName + ': ' + trend + ' from ' + first[1] + ' to ' + last[1] + ' ' + mData.unit + ' (range ' + minV + '-' + maxV + ')');
              }
            }
          }
          let insight = insightParts.join('. ') + '.';
          // Add clinical education context if available
          if (panelContext[def.id]) {
            insight += panelContext[def.id];
          }

          // Generate alerts based on latest values and reference ranges
          const alerts: string[] = [];
          for (const mName of metricNames) {
            const mData = metricMap[mName];
            const vals = Array.from(mData.values.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            if (vals.length === 0) continue;
            const latest = vals[vals.length - 1][1];
            if (def.refLines) {
              for (const [refKey, refVal] of Object.entries(def.refLines)) {
                if (mName.toLowerCase().includes(refKey.toLowerCase())) {
                  if (refVal.high !== undefined && latest > refVal.high) {
                    alerts.push(mName.slice(0, 30) + ' ' + latest + ' ' + mData.unit + ' is above reference (' + refVal.high + ')');
                  }
                }
              }
            }
          }

          // Determine status
          let status = 'normal';
          if (alerts.length > 0) status = 'warning';

          panels.push({
            id: def.id,
            title: def.title,
            subtitle: def.subtitle,
            insight,
            labels,
            datasets,
            status,
            alerts,
          });
        }

        json(res, { ok: true, panels });
        return;
      }

      case '/api/records': {
        const result = await orchestrator.sendMessage('analytics-agent', 'get-lab-summary');
        json(res, { ok: true, vitals: result.payload.vitals, labs: result.payload.labs });
        return;
      }

      case '/api/auth/login': {
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }
        const body = await parseBody(req);
        const email = body.email as string;
        const password = body.password as string;
        if (!email || !password) { json(res, { error: 'Email and password required' }, 400); return; }

        // Authenticate via EHR agent (b.well)
        if (ehrAgent) {
          const result = await orchestrator.sendMessage('ehr-agent', 'login', { email, password });
          if (result.type === 'error') {
            json(res, { ok: false, error: result.payload.error }, 401);
            return;
          }
          sessionUser = { email, loggedIn: true };
          json(res, { ok: true, email, personId: result.payload.personId });
        } else {
          // No EHR configured -- accept login for session tracking only
          sessionUser = { email, loggedIn: true };
          json(res, { ok: true, email, note: 'EHR not configured -- session only' });
        }
        return;
      }

      case '/api/connect/sources': {
        const result = await orchestrator.sendMessage('wearable-agent', 'get-sources');
        if (result.type === 'error') {
          json(res, { ok: true, sources: [] });
        } else {
          json(res, { ok: true, sources: result.payload.sources });
        }
        return;
      }

      case '/api/connect/health-systems': {
        const ehrResult = await orchestrator.sendMessage('ehr-agent', 'get-connected-systems');
        json(res, { ok: true, ...ehrResult.payload as Record<string, unknown> });
        return;
      }

      case '/api/connect/wearable': {
        const query = parseQuery(req.url || '');
        const device = query.device || 'oura';
        const result = await orchestrator.sendMessage('wearable-agent', 'authorize', { source: device });
        json(res, { ok: true, ...result.payload as Record<string, unknown> });
        return;
      }

      case '/api/connect/ehr': {
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }
        const body = await parseBody(req);
        const result = await orchestrator.sendMessage('ehr-agent', 'login', body);
        json(res, { ok: result.type !== 'error', ...result.payload as Record<string, unknown> });
        return;
      }

      case '/api/agents': {
        const statuses = orchestrator.getAgentStatuses();
        json(res, { ok: true, agents: statuses });
        return;
      }

      case '/api/pdf/upload': {
        // Upload any health PDF (lab report, genomics report, etc.)
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }

        const pdfChunks: Buffer[] = [];
        req.on('data', (c: Buffer) => pdfChunks.push(c));
        req.on('end', async () => {
          try {
            const pdfBuffer = Buffer.concat(pdfChunks);
            console.log(`[PDF] Received upload: ${pdfBuffer.length} bytes`);

            const { extractFromPdf } = await import('../connectors/pdf-extractor.js');
            const results = await extractFromPdf(pdfBuffer);

            // Store extracted results as health samples
            let stored = 0;
            for (const r of results) {
              // Convert string values to numeric for storage
              let numValue: number;
              if (typeof r.value === 'number') {
                numValue = r.value;
              } else if (r.value === 'Increased likelihood') {
                numValue = 1; // risk flag
              } else if (typeof r.value === 'string' && r.value.match(/^\d+\.?\d*$/)) {
                numValue = parseFloat(r.value);
              } else {
                numValue = 0; // store as 0 for string results (genotypes, haplogroups, traits)
              }

              try {
                const isGenomics = r.category.startsWith('genomics');
                store.insertSample({
                  id: Math.random().toString(36).slice(2),
                  source: isGenomics ? 'genomics' as any : 'manual' as any,
                  dataType: r.testName,
                  value: numValue,
                  unit: r.unit || (typeof r.value === 'string' ? r.value : ''),
                  metadata: {
                    originalValue: r.value,
                    referenceRange: r.referenceRange,
                    category: r.category,
                    source: r.source || 'PDF Upload',
                    confidence: r.confidence,
                  },
                  recordedAt: new Date(),
                  syncedAt: new Date(),
                });
                stored++;
              } catch {}
            }

            console.log(`[PDF] Extracted ${results.length} results, stored ${stored}`);

            json(res, {
              ok: true,
              totalExtracted: results.length,
              stored,
              results: results.map(r => ({
                testName: r.testName,
                value: r.value,
                unit: r.unit,
                category: r.category,
                referenceRange: r.referenceRange,
                confidence: r.confidence,
              })),
            });
          } catch (err) {
            console.error('[PDF] Upload error:', err);
            json(res, { ok: false, error: String(err) });
          }
        });
        return;
      }

      case '/api/genomics/upload': {
        // Upload 23andMe raw data file (text content in POST body)
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }

        // Read raw body as text (23andMe files are plain text, tab-separated)
        const rawChunks: Buffer[] = [];
        req.on('data', (c: Buffer) => rawChunks.push(c));
        req.on('end', async () => {
          try {
            const rawContent = Buffer.concat(rawChunks).toString('utf-8');
            console.log(`[Genomics] Received upload: ${rawContent.length} bytes`);

            // Parse the 23andMe format
            const { TwentyThreeAndMeConnector } = await import('../connectors/genomics/index.js');
            const connector = new TwentyThreeAndMeConnector();
            await connector.connect({});
            const matchedCount = connector.parseRawData(rawContent);

            // Get the parsed variants
            const variants = await connector.getVariants();

            // Store each variant as a health sample
            let stored = 0;
            for (const v of variants) {
              try {
                store.insertSample({
                  id: Math.random().toString(36).slice(2),
                  source: 'genomics' as any,
                  dataType: `${v.gene} (${v.rsid})`,
                  value: v.riskScore,
                  unit: 'risk_score',
                  metadata: {
                    rsid: v.rsid,
                    gene: v.gene,
                    genotype: v.genotype,
                    riskAllele: v.riskAllele,
                    category: v.category,
                    description: v.description,
                  },
                  recordedAt: new Date(),
                  syncedAt: new Date(),
                });
                stored++;
              } catch {}
            }

            console.log(`[Genomics] Stored ${stored} variants from ${matchedCount} matches`);

            json(res, {
              ok: true,
              totalSnps: rawContent.split('\n').filter((l: string) => !l.startsWith('#') && l.trim()).length,
              matchedVariants: matchedCount,
              stored,
              variants: variants.map(v => ({
                rsid: v.rsid,
                gene: v.gene,
                genotype: v.genotype,
                riskScore: v.riskScore,
                category: v.category,
                description: v.description,
              })),
            });
          } catch (err) {
            console.error('[Genomics] Upload error:', err);
            json(res, { ok: false, error: String(err) });
          }
        });
        return;
      }

      case '/api/genomics/variants': {
        // Return stored genomic variants
        try {
          const db = (store as any).db;
          const rows = db.prepare(
            "SELECT data_type, value, unit, metadata, recorded_at FROM health_samples WHERE source = 'genomics' ORDER BY data_type"
          ).all() as Array<{ data_type: string; value: number; unit: string; metadata: string; recorded_at: string }>;

          const variants = rows.map((r: any) => {
            const meta = r.metadata ? JSON.parse(r.metadata) : {};
            return {
              rsid: meta.rsid || r.data_type,
              gene: meta.gene || '',
              genotype: meta.genotype || '',
              riskScore: r.value,
              category: meta.category || '',
              description: meta.description || r.data_type,
            };
          });

          json(res, { ok: true, variants, count: variants.length });
        } catch {
          json(res, { ok: true, variants: [], count: 0 });
        }
        return;
      }

      case '/api/subscription/status': {
        // Check subscription status (calls xspan.ai or uses local state)
        const trialStart = process.env.TRIAL_START || new Date().toISOString();
        const trialDays = 3;
        const trialEnd = new Date(new Date(trialStart).getTime() + trialDays * 86400000);
        const now = new Date();
        const inTrial = now < trialEnd;
        const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000));

        json(res, {
          ok: true,
          tier: process.env.STRIPE_SUBSCRIPTION_ID ? 'paid' : inTrial ? 'trial' : 'expired',
          trialDaysLeft: daysLeft,
          renewsAt: process.env.STRIPE_SUBSCRIPTION_ID ? 'monthly' : undefined,
        });
        return;
      }

      case '/api/subscription/cancel': {
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }
        // Cancel via Stripe API (stub for now)
        console.log('[Stripe] Subscription cancel requested');
        json(res, { ok: true, endsAt: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0] });
        return;
      }

      // Platform integration endpoints for XSpan mobile app
      case '/api/v1/mobile/status': {
        const summary = await orchestrator.getDailySummary();
        json(res, { ok: true, summary });
        return;
      }

      case '/api/v1/mobile/summary': {
        const summary = await orchestrator.getDailySummary();
        json(res, { ok: true, summary });
        return;
      }

      case '/api/v1/wallet/save': {
        if (method !== 'POST') { json(res, { error: 'POST required' }, 405); return; }
        const walletBody = await parseBody(req);
        const walletAddr = walletBody.address as string;
        if (!walletAddr || !walletAddr.startsWith('0x')) {
          json(res, { ok: false, error: 'Invalid wallet address' });
          return;
        }
        // Store wallet in local config
        process.env.USER_WALLET = walletAddr;
        console.log(`[Wallet] Saved wallet: ${walletAddr.substring(0, 6)}...${walletAddr.substring(walletAddr.length - 4)}`);
        json(res, { ok: true, address: walletAddr });
        return;
      }

      case '/api/v1/earnings': {
        // Return earnings data (from Contribute agent / Base L2)
        json(res, {
          ok: true,
          wallet: process.env.USER_WALLET || null,
          totalEarned: 0,
          pendingPayout: 0,
          currency: 'USDC',
          contributions: 0,
          lastPayout: null,
        });
        return;
      }

      case '/api/v1/premium/features': {
        json(res, {
          ok: true,
          features: [
            { id: 'digital_twin', name: 'Digital Twin', available: false },
            { id: 'ai_nudges', name: '3x Daily AI Nudges', available: false },
            { id: 'meal_tracking', name: 'Meal Tracking + Camera', available: false },
            { id: 'health_passport', name: 'Weekly Health Passport', available: false },
            { id: 'care_programs', name: 'Structured Care Programs', available: false },
            { id: 'pcp_escalation', name: 'PCP Escalation Pathway', available: false },
          ],
          upgradeUrl: 'https://xspan.ai/premium',
        });
        return;
      }

      default: {
        // Serve static assets (logos, images)
        if (path.startsWith('/assets/')) {
          const { readFileSync, existsSync } = await import('fs');
          const { join } = await import('path');
          const assetPath = join(process.cwd(), path);
          if (existsSync(assetPath)) {
            const ext = path.split('.').pop() || '';
            const mimeTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon' };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
            res.end(readFileSync(assetPath));
            return;
          }
        }
        json(res, { error: 'Not found' }, 404);
      }
    }
  } catch (err) {
    console.error('[Dashboard API] Error:', err);
    json(res, { error: String(err) }, 500);
  }
}

// 

function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyHealthSpan</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>
<style>
/* ── Reset + Base ─────────────────────────────── */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Inter','Segoe UI',sans-serif;background:#0B0F1A;color:#E2E8F0;min-height:100vh}
a{color:#E8751A;text-decoration:none}
button{cursor:pointer;font-family:inherit}
input{font-family:inherit}

/* ── Nav ──────────────────────────────────────── */
.topnav{position:sticky;top:0;z-index:100;background:#0B0F1A;border-bottom:1px solid #1E293B;display:flex;align-items:center;padding:0 20px;height:56px}
.topnav .logo{font-size:18px;font-weight:800;color:#fff;margin-right:32px;white-space:nowrap}
.topnav .logo span{color:#E8751A}
.nav-links{display:flex;gap:4px}
.nav-btn{padding:8px 16px;border:none;background:none;color:#94A3B8;font-size:13px;font-weight:600;border-radius:6px;transition:all .15s}
.nav-btn:hover{color:#E2E8F0;background:#1E293B}
.nav-btn.active{color:#E8751A;background:#E8751A14}

/* ── Layout ───────────────────────────────────── */
.page{display:none;max-width:1100px;margin:0 auto;padding:24px 20px 60px}
.page.visible{display:block}

/* ── Cards ────────────────────────────────────── */
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
.card h3{font-size:14px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}

/* ── Header ───────────────────────────────────── */
.health-header{display:flex;align-items:center;gap:20px;margin-bottom:24px;flex-wrap:wrap}
.score-ring{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#fff;flex-shrink:0}
.header-text h2{font-size:22px;font-weight:700;color:#fff;margin-bottom:4px}
.header-text p{color:#64748B;font-size:13px}

/* ── Chart Grid ───────────────────────────────── */
.chart-grid{display:flex;flex-direction:column;gap:20px;margin-bottom:16px}
.chart-panel{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:16px}
.chart-panel h4{font-size:14px;font-weight:700;color:#E2E8F0;margin-bottom:2px}
.chart-panel .panel-subtitle{font-size:11px;color:#64748B;margin-bottom:12px}
.chart-row{display:flex;gap:12px;overflow-x:auto;padding-bottom:4px}
.chart-mini{flex:1;min-width:180px;background:#0F172A;border-radius:8px;padding:10px}
.chart-mini .mini-label{font-size:10px;color:#94A3B8;font-weight:600;margin-bottom:2px}
.chart-mini .mini-value{font-size:18px;font-weight:800;color:#E8751A;margin-bottom:4px}
.chart-mini .mini-unit{font-size:10px;color:#64748B}
.chart-mini canvas{width:100%!important;height:100px!important}
.chart-insight{margin-top:10px;padding:10px 12px;background:#0F172A;border-radius:8px;font-size:12px;color:#94A3B8;line-height:1.6}
.chart-placeholder{height:80px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:11px;background:#0F172A;border-radius:8px}

/* ── Metrics Grid ─────────────────────────────── */
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:16px}
.metric-tile{background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:14px}
.metric-tile .label{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
.metric-tile .value{font-size:20px;font-weight:700;color:#fff}
.metric-tile .unit{font-size:12px;color:#64748B;margin-left:2px}
.metric-tile .status{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}
.status-good{background:#22C55E}
.status-warning{background:#F59E0B}
.status-concern{background:#EF4444}

/* ── Alerts ───────────────────────────────────── */
.alert-item{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #1E293B}
.alert-item:last-child{border-bottom:none}
.alert-badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;flex-shrink:0;margin-top:2px}
.badge-info{background:#0EA5E914;color:#38BDF8}
.badge-warning{background:#F59E0B14;color:#FBBF24}
.badge-critical{background:#EF444414;color:#F87171}
.alert-msg{font-size:13px;color:#CBD5E1;line-height:1.5}

/* ── Records Table ────────────────────────────── */
.records-table{width:100%;border-collapse:collapse;font-size:13px}
.records-table th{text-align:left;padding:8px 10px;color:#64748B;font-weight:600;border-bottom:1px solid #334155;font-size:11px;text-transform:uppercase}
.records-table td{padding:8px 10px;border-bottom:1px solid #1E293B;color:#CBD5E1}
.records-table tr:hover td{background:#0F172A}
.interp-normal{color:#22C55E}
.interp-high{color:#EF4444}
.interp-low{color:#F59E0B}

/* ── Wizard ───────────────────────────────────── */
.wizard-steps{display:flex;gap:0;margin-bottom:28px;position:relative}
.wizard-step{flex:1;text-align:center;position:relative;padding-bottom:12px}
.wizard-step .step-num{width:32px;height:32px;border-radius:50%;background:#1E293B;border:2px solid #334155;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#64748B;margin-bottom:6px;transition:all .2s}
.wizard-step .step-label{font-size:11px;color:#64748B;display:block}
.wizard-step.active .step-num{background:#E8751A;border-color:#E8751A;color:#fff}
.wizard-step.active .step-label{color:#E8751A}
.wizard-step.done .step-num{background:#22C55E;border-color:#22C55E;color:#fff}
.wizard-step.done .step-label{color:#22C55E}
.wizard-content{min-height:280px}

/* ── Forms ────────────────────────────────────── */
.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:13px;font-weight:600;color:#CBD5E1;margin-bottom:6px}
.form-group input[type="email"],.form-group input[type="password"],.form-group input[type="text"]{width:100%;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:14px}
.form-group input:focus{outline:none;border-color:#E8751A}
.btn-primary{padding:12px 24px;background:#E8751A;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;transition:all .15s}
.btn-primary:hover{background:#D06A15}
.btn-primary:disabled{background:#334155;color:#64748B;cursor:not-allowed}
.btn-outline{padding:10px 20px;background:transparent;color:#E8751A;border:1px solid #E8751A;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s}
.btn-outline:hover{background:#E8751A14}

/* ── Device Grid ──────────────────────────────── */
.device-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.device-card{background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:16px;text-align:center;transition:border-color .15s}
.device-card:hover{border-color:#334155}
.device-name{font-size:14px;font-weight:600;color:#E2E8F0;margin:8px 0 4px}
.device-desc{font-size:11px;color:#64748B;margin-bottom:10px;line-height:1.4}
.device-icon{font-size:28px;margin-bottom:4px}
.connected-badge{display:inline-block;padding:2px 8px;background:#22C55E22;color:#22C55E;border-radius:4px;font-size:11px;font-weight:600}

/* ── Contribute ───────────────────────────────── */
.consent-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1E293B}
.consent-item:last-child{border:none}
.consent-item input[type="checkbox"]{width:18px;height:18px;accent-color:#E8751A}
.consent-label{font-size:14px;color:#CBD5E1}
.consent-desc{font-size:12px;color:#64748B;margin-top:2px}
.earnings-display{background:#0F172A;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px}
.earnings-amount{font-size:36px;font-weight:800;color:#22C55E}
.earnings-label{font-size:12px;color:#64748B;margin-top:4px}

/* ── Settings ─────────────────────────────────── */
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #1E293B}
.setting-row:last-child{border:none}
.setting-info h4{font-size:14px;font-weight:600;color:#E2E8F0}
.setting-info p{font-size:12px;color:#64748B;margin-top:2px}
.btn-danger{padding:8px 16px;background:#EF4444;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600}
.btn-danger:hover{background:#DC2626}

/* ── Mobile ───────────────────────────────────── */
@media(max-width:640px){
  .topnav{flex-wrap:wrap;height:auto;padding:10px 16px;gap:8px}
  .nav-links{width:100%;overflow-x:auto}
  .health-header{flex-direction:column;align-items:flex-start}
  .chart-grid{grid-template-columns:1fr}
  .metrics-grid{grid-template-columns:repeat(2,1fr)}
  .device-grid{grid-template-columns:1fr 1fr}
  .wizard-step .step-label{font-size:10px}
}
</style>
</head>
<body>

<!-- Navigation -->
<nav class="topnav">
  <div class="logo"><img src="/assets/logo-full.png" alt="XSpan.ai" style="height:28px"></div>
  <div class="nav-links">
    <button class="nav-btn active" onclick="showPage('insights',this)">Insights</button>
    <button class="nav-btn" onclick="showPage('connect',this)">Connect</button>
    <button class="nav-btn" onclick="showPage('contribute',this)">Contribute</button>
    <button class="nav-btn" onclick="showPage('settings',this)">Settings</button>
  </div>
</nav>

<!-- ═══════ INSIGHTS ═══════ -->
<div id="page-insights" class="page visible">
  <div class="health-header">
    <div class="score-ring" id="score-ring" style="background:conic-gradient(#334155 0deg,#334155 360deg)">--</div>
    <div class="header-text">
      <h2 id="headline">Loading...</h2>
      <p id="subheadline"></p>
    </div>
  </div>

  <div class="chart-grid" id="chart-grid">
    <!-- Panels rendered dynamically by initCharts() -->
  </div>

  <!-- Genomics Panel -->
  <div class="card" id="genomics-panel" style="display:none;margin-bottom:16px">
    <h3 style="margin-bottom:4px">&#x1F9EC; Genomics</h3>
    <div style="font-size:11px;color:#64748B;margin-bottom:12px">Genetic risk variants from 23andMe / genomics data</div>
    <div id="genomics-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px"></div>
    <div id="genomics-wellness" style="margin-top:12px"></div>
    <div id="genomics-ancestry" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h3>Key Metrics</h3>
    <div class="metrics-grid" id="metrics-grid"></div>
  </div>

  <div class="card" id="alerts-card" style="display:none">
    <h3>Alerts</h3>
    <div id="alerts-list"></div>
  </div>

  <div class="card">
    <h3>Health Records</h3>
    <div style="overflow-x:auto">
      <table class="records-table" id="records-table">
        <thead><tr><th>Test</th><th>Value</th><th>Date</th><th>Status</th></tr></thead>
        <tbody id="records-body"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══════ CONNECT ═══════ -->
<div id="page-connect" class="page">

  <!-- Connection Status Panel -->
  <div class="card" style="margin-bottom:20px;border-color:#22C55E33" id="connection-status-panel">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <h3 style="margin:0">Connected Sources</h3>
      <span id="conn-count-badge" style="background:#22C55E22;color:#22C55E;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700">0</span>
    </div>
    <div id="connected-sources-list" style="display:flex;flex-wrap:wrap;gap:8px">
      <span style="color:#475569;font-size:12px">Loading...</span>
    </div>
  </div>

  <!-- Wearable Devices -->
  <div class="card" style="margin-bottom:20px">
    <h3>Wearable Devices</h3>
    <p style="color:#94A3B8;font-size:13px;margin-bottom:16px">Click a device to connect. You will sign in with your device account.</p>
    <div class="device-grid" id="device-grid"></div>
  </div>

  <!-- Health Records (EHR) -->
  <div class="card" style="margin-bottom:20px">
    <h3>Health Records</h3>
    <p style="color:#94A3B8;font-size:13px;margin-bottom:16px">Search for your hospital or health system. 650+ supported including Epic MyChart, Cerner, Allscripts, and more.</p>

    <!-- Connected Health System (shown when connected) -->
    <div id="ehr-connected-banner" style="display:none;margin-bottom:16px">
      <div style="background:#22C55E08;border:1px solid #22C55E33;border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:8px;background:#22C55E22;display:flex;align-items:center;justify-content:center;font-size:20px">&#x1F3E5;</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="color:#22C55E;font-weight:700;font-size:14px" id="ehr-system-name">Health System</span>
              <span style="background:#22C55E22;color:#22C55E;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700">CONNECTED</span>
            </div>
            <div style="font-size:11px;color:#64748B;margin-top:2px" id="ehr-sync-info">Synced</div>
          </div>
          <span id="ehr-record-count" style="color:#94A3B8;font-size:12px"></span>
        </div>
      </div>
    </div>

    <!-- Health System Search -->
    <div id="ehr-search-section">
      <!-- Search Box -->
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <input type="text" id="ehr-search" class="form-input" placeholder="Search for your hospital or health system..." oninput="searchHealthSystems(this.value)" style="flex:1;padding:12px 16px;font-size:14px;background:#0F172A;border:1px solid #334155;border-radius:10px;color:#fff">
        <button class="btn-primary" style="padding:12px 20px;white-space:nowrap" onclick="searchHealthSystems(document.getElementById('ehr-search').value)">Search</button>
      </div>

      <!-- Health System Grid -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px" id="ehr-logos">
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('UCLA Health')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">UCLA Health</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Kaiser Permanente')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Kaiser Permanente</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Stanford Health Care')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Stanford Health</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Cleveland Clinic')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Cleveland Clinic</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Mayo Clinic')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Mayo Clinic</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Johns Hopkins')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Johns Hopkins</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Mount Sinai')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Mount Sinai</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
        <div class="device-card" style="cursor:pointer" onclick="selectHealthSystem('Cedars-Sinai')">
          <div style="font-size:24px;margin-bottom:6px">&#x1F3E5;</div>
          <div style="font-size:12px;font-weight:600;color:#fff">Cedars-Sinai</div>
          <div style="font-size:9px;color:#64748B">Epic MyChart</div>
        </div>
      </div>
      <div style="font-size:10px;color:#475569;margin-bottom:16px">Epic MyChart, Cerner, Allscripts, athenahealth, eClinicalWorks + 640 more health systems</div>

      <!-- Login Form (shown after selecting health system) -->
      <div id="ehr-login-form" style="display:none;background:#0F172A;border:2px solid #334155;border-radius:12px;padding:20px;position:relative">
        <button onclick="document.getElementById('ehr-login-form').style.display='none'" style="position:absolute;top:12px;right:12px;background:none;border:none;color:#64748B;font-size:18px;cursor:pointer;padding:4px 8px;line-height:1">&#x2715;</button>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="width:36px;height:36px;border-radius:8px;background:#E8751A22;display:flex;align-items:center;justify-content:center;font-size:18px">&#x1F3E5;</div>
          <div>
            <h4 id="ehr-selected-name" style="margin:0;color:#fff;font-size:15px">Selected Health System</h4>
            <div style="font-size:11px;color:#64748B">Sign in with your patient portal credentials</div>
          </div>
        </div>
        <p style="color:#94A3B8;font-size:12px;margin-bottom:14px;line-height:1.5">Enter the same email and password you use to log in to <strong style="color:#A78BFA">MyChart</strong> or your hospital patient portal. This connects your lab results, medications, conditions, and visit history.</p>
        <div class="form-group">
          <label>Patient Portal Email</label>
          <input type="email" id="ehr-email" placeholder="your.email@example.com" style="padding:12px 14px;font-size:14px">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="ehr-password" placeholder="Your MyChart / patient portal password" style="padding:12px 14px;font-size:14px">
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn-primary" style="padding:12px 24px;font-size:14px" onclick="connectEhr()">Connect Health Records</button>
          <button class="btn-outline" style="padding:12px 16px;font-size:13px" onclick="document.getElementById('ehr-login-form').style.display='none'">Cancel</button>
          <span id="ehr-connect-status" style="font-size:11px;color:#64748B"></span>
        </div>
      </div>
    </div>
  </div>

  <!-- Omics (Genomics + Microbiome) -->
  <div class="card" style="margin-bottom:20px">
    <h3>Omics — Genomics &amp; Microbiome</h3>
    <p style="color:#94A3B8;font-size:13px;margin-bottom:16px">Upload your genetic test or gut microbiome results for deeper health insights.</p>

    <!-- Upload Area (prominent) -->
    <div style="background:#0F172A;border:2px dashed #A78BFA44;border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;cursor:pointer" onclick="document.getElementById('genomics-file-input').click()">
      <div style="font-size:32px;margin-bottom:8px">&#x1F9EC;</div>
      <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:4px">Upload Genomics Data</div>
      <div style="font-size:12px;color:#94A3B8;margin-bottom:12px">23andMe raw data (.txt), AncestryDNA, or VCF file</div>
      <button class="btn-primary" style="padding:10px 24px;font-size:14px" onclick="event.stopPropagation();document.getElementById('genomics-file-input').click()">Choose File to Upload</button>
      <div style="font-size:10px;color:#475569;margin-top:10px">How to get your file: 23andMe &#x2192; Settings &#x2192; Download Raw Data &#x2192; Download .txt file</div>
    </div>
    <input type="file" id="genomics-file-input" accept=".txt,.csv,.vcf,.tsv,.pdf" style="display:none" onchange="uploadGenomicsFile(this)">
    <div id="genomics-upload-status" style="display:none;padding:12px;font-size:12px;border-radius:8px;margin-bottom:16px"></div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px">
      <!-- Genomics providers -->
      <div style="background:#0F172A;border:1px solid #334155;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#A78BFA;font-weight:700;margin-bottom:8px">GENOMICS PROVIDERS</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="device-card" style="padding:10px">
            <div style="font-size:16px;margin-bottom:4px">&#x1F9EC;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">23andMe</div>
            <div style="font-size:9px;color:#64748B">Download raw data &#x2192; Upload above</div>
          </div>
          <div class="device-card" style="padding:10px">
            <div style="font-size:16px;margin-bottom:4px">&#x1F9EC;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">AncestryDNA</div>
            <div style="font-size:9px;color:#64748B">Download DNA data &#x2192; Upload above</div>
          </div>
          <div class="device-card" style="padding:10px">
            <div style="font-size:16px;margin-bottom:4px">&#x1F9EC;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">Whole Genome Sequencing</div>
            <div style="font-size:9px;color:#64748B">Upload VCF file from any sequencing provider</div>
          </div>
        </div>
      </div>

      <!-- Microbiome -->
      <div style="background:#0F172A;border:1px solid #334155;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#22C55E;font-weight:700;margin-bottom:8px">MICROBIOME</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="device-card" style="cursor:pointer;padding:10px" onclick="window.open('https://app.gut.id','_blank')">
            <div style="font-size:16px;margin-bottom:4px">&#x1F9EC;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">Gut.id</div>
            <div style="font-size:9px;color:#64748B">AI gut health + microbiome diversity</div>
          </div>
          <div class="device-card" style="cursor:pointer;padding:10px" onclick="window.open('https://www.viome.com','_blank')">
            <div style="font-size:16px;margin-bottom:4px">&#x1F9A0;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">Viome</div>
            <div style="font-size:9px;color:#64748B">Full body intelligence + gut health</div>
          </div>
          <div class="device-card" style="cursor:pointer;padding:10px" onclick="window.open('https://joinzoe.com','_blank')">
            <div style="font-size:16px;margin-bottom:4px">&#x1F34E;</div>
            <div style="font-size:12px;font-weight:600;color:#fff">ZOE</div>
            <div style="font-size:9px;color:#64748B">Gut microbiome + blood sugar + nutrition</div>
          </div>
        </div>
      </div>
    </div>
    <!-- PDF Upload for any health report -->
    <div style="background:#0F172A;border:2px dashed #E8751A44;border-radius:12px;padding:20px;text-align:center;cursor:pointer" onclick="document.getElementById('pdf-file-input').click()">
      <div style="font-size:28px;margin-bottom:6px">&#x1F4C4;</div>
      <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px">Upload Any Health PDF</div>
      <div style="font-size:12px;color:#94A3B8;margin-bottom:10px">Lab reports, 23andMe reports, hospital summaries, imaging reports</div>
      <button class="btn-outline" style="padding:8px 20px;font-size:13px" onclick="event.stopPropagation();document.getElementById('pdf-file-input').click()">Choose PDF File</button>
      <div style="font-size:10px;color:#475569;margin-top:8px">We extract lab values, genomics findings, vitals, and conditions automatically.</div>
    </div>
    <input type="file" id="pdf-file-input" accept=".pdf" style="display:none" onchange="uploadPdfFile(this)">
    <div id="pdf-upload-status" style="display:none;padding:12px;font-size:12px;border-radius:8px;margin-top:8px"></div>

    <p style="font-size:10px;color:#475569;margin-top:12px">All data stays on your device. We never send your files to any server.</p>
  </div>

  <!-- Mobile App -->
  <div class="card" style="margin-bottom:20px">
    <h3>XSpan Mobile App</h3>
    <p style="color:#94A3B8;font-size:13px;margin-bottom:12px">Install the XSpan app to sync Apple Health and Google Health data automatically in the background.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <a href="https://apps.apple.com/app/xspan" class="btn-outline" target="_blank" style="font-size:12px">&#x1F34E; App Store (iOS)</a>
      <a href="https://play.google.com/store/apps/details?id=ai.xspan" class="btn-outline" target="_blank" style="font-size:12px">&#x1F4F1; Google Play</a>
    </div>
  </div>
</div>

<!-- ═══════ CONTRIBUTE ═══════ -->
<div id="page-contribute" class="page">
  <div class="card" style="max-width:600px">
    <h3>Earn from your health data</h3>
    <p style="color:#94A3B8;font-size:14px;margin-bottom:20px">De-identify and contribute your health data to research. Earn USDC for every approved dataset.</p>

    <div class="earnings-display">
      <div class="earnings-amount" id="earnings-amount">$0.00</div>
      <div class="earnings-label">USDC Balance</div>
    </div>

    <h3 style="margin-top:24px">Consent Categories</h3>
    <div style="margin-bottom:20px">
      <div class="consent-item">
        <input type="checkbox" id="consent-cardio" checked>
        <div><div class="consent-label">Cardiovascular Data</div><div class="consent-desc">Heart rate, HRV, blood pressure, lipid panels</div></div>
      </div>
      <div class="consent-item">
        <input type="checkbox" id="consent-metabolic" checked>
        <div><div class="consent-label">Metabolic Data</div><div class="consent-desc">Glucose, HbA1c, metabolic panel, kidney function</div></div>
      </div>
      <div class="consent-item">
        <input type="checkbox" id="consent-sleep" checked>
        <div><div class="consent-label">Sleep Data</div><div class="consent-desc">Sleep stages, duration, efficiency, scores</div></div>
      </div>
      <div class="consent-item">
        <input type="checkbox" id="consent-activity">
        <div><div class="consent-label">Activity Data</div><div class="consent-desc">Steps, calories, strain, recovery, VO2 max</div></div>
      </div>
    </div>

    <button class="btn-primary" id="enroll-btn" onclick="enrollContribute()">Enroll in XSpan Contribute</button>
    <p style="color:#475569;font-size:11px;margin-top:12px">All data is de-identified locally before upload. You can revoke consent at any time.</p>

    <div style="margin-top:20px">
      <a href="https://www.coinbase.com/wallet" class="btn-outline" target="_blank">Open Coinbase Wallet</a>
    </div>
  </div>
</div>

<!-- ═══════ SETTINGS ═══════ -->
<div id="page-settings" class="page">
  <div class="card" style="max-width:600px">
    <h3>Settings</h3>

    <div class="setting-row">
      <div class="setting-info">
        <h4>Connected Accounts</h4>
        <p id="connected-accounts-info">No accounts connected</p>
      </div>
      <button class="btn-outline" onclick="loadAgentStatuses()">Refresh</button>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <h4>Export Data</h4>
        <p>Download all stored health data as JSON</p>
      </div>
      <button class="btn-outline" onclick="exportData()">Export</button>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <h4>Delete All Data</h4>
        <p>Permanently remove all health data from this device</p>
      </div>
      <button class="btn-danger" onclick="confirmDelete()">Delete</button>
    </div>

    <!-- Subscription -->
    <div class="setting-row" style="flex-direction:column;align-items:stretch">
      <div id="sub-panel" style="background:#0F172A;border:1px solid #334155;border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <h4 style="margin-bottom:2px">Agent Pro</h4>
            <div style="font-size:22px;font-weight:800;color:#E8751A">$5.99<span style="font-size:12px;color:#64748B;font-weight:400">/month</span></div>
          </div>
          <div id="sub-badge" style="padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700;background:#FBBF2422;color:#FBBF24">TRIAL</div>
        </div>
        <p id="sub-status" style="font-size:12px;color:#94A3B8;margin-bottom:12px">3-day free trial active</p>
        <div style="font-size:12px;color:#CBD5E1;margin-bottom:12px;line-height:1.7">
          &#x2713; 13 clinical synthesis panels &#x2713; 650+ health systems &#x2713; Wearable data<br>
          &#x2713; Genomics insights &#x2713; Daily briefings &#x2713; Trend analysis &#x2713; Contribute &amp; Earn USDC
        </div>
        <div id="sub-actions">
          <button class="btn-primary" style="width:100%;margin-bottom:8px" onclick="subscribeStripe()">Subscribe with Card ($5.99/mo)</button>
          <button class="btn-outline" style="width:100%;font-size:12px;color:#64748B;border-color:#33415544" onclick="cancelSubscription()" id="cancel-sub-btn" disabled>Cancel Subscription</button>
        </div>
        <div style="font-size:10px;color:#475569;margin-top:8px">Powered by Stripe. Cancel anytime. Card details never stored on this device.</div>
      </div>
    </div>

    <!-- Coinbase Wallet -->
    <div class="setting-row" style="flex-direction:column;align-items:stretch">
      <div style="background:#0F172A;border:1px solid #334155;border-radius:10px;padding:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:32px;height:32px;border-radius:8px;background:#0052FF22;display:flex;align-items:center;justify-content:center;font-size:16px">&#x1F4B0;</div>
          <div>
            <h4 style="margin:0">Coinbase Wallet</h4>
            <div style="font-size:11px;color:#64748B">Earn USDC when your de-identified data is used in research</div>
          </div>
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Wallet Address (Coinbase Base L2)</label>
          <input type="text" id="wallet-address" placeholder="0x... or connect Coinbase Wallet" style="padding:10px 12px;font-size:13px;font-family:monospace">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" style="flex:1;font-size:12px;padding:10px" onclick="saveWallet()">Save Wallet</button>
          <a href="https://www.coinbase.com/wallet" class="btn-outline" target="_blank" style="flex:1;text-align:center;font-size:12px;padding:10px">Get Coinbase Wallet</a>
        </div>
        <div id="wallet-status" style="display:none;margin-top:8px;font-size:11px"></div>
        <div style="font-size:10px;color:#475569;margin-top:8px">You earn 50% of every research data contribution in USDC stablecoins. Withdraw to bank anytime via Coinbase.</div>
      </div>
    </div>

    <!-- XSpan Premium -->
    <div class="setting-row" style="flex-direction:column;align-items:stretch">
      <div style="background:#0F172A;border:1px solid #7C3AED33;border-radius:10px;padding:16px">
        <h4 style="color:#C4B5FD;margin-bottom:4px">XSpan Premium</h4>
        <div style="font-size:12px;color:#94A3B8;margin-bottom:10px;line-height:1.6">
          Digital Twin &#x2022; 3x Daily AI Nudges &#x2022; Meal Tracking &#x2022; Health Passport &#x2022; Physician-Connected Care Programs &#x2022; PCP Escalation
        </div>
        <div style="background:#7C3AED11;border:1px solid #7C3AED22;border-radius:8px;padding:10px;font-size:12px;color:#C4B5FD;line-height:1.5">
          Available through participating health systems.<br>
          <strong>Ask your doctor about XSpan Premium.</strong>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <a href="https://xspan.ai/premium" class="btn-outline" target="_blank" style="flex:1;text-align:center;font-size:12px;border-color:#7C3AED44;color:#C4B5FD">Learn More</a>
          <button class="btn-outline" style="flex:1;font-size:12px;border-color:#7C3AED44;color:#C4B5FD" onclick="emailDoctor()">Send Request to Your Doctor</button>
        </div>
      </div>
    </div>

    <!-- Agent Status -->
    <div class="setting-row">
      <div class="setting-info">
        <h4>Agent Status</h4>
        <div id="agent-status-list" style="margin-top:8px;font-size:13px;color:#94A3B8"></div>
      </div>
    </div>

    <!-- Version -->
    <div class="setting-row">
      <div class="setting-info">
        <h4>MyHealthSpan Agent v1.0.0</h4>
        <p>Built by <a href="https://xspan.ai" target="_blank">XSpan.ai</a> &mdash; The Physics of Biology</p>
      </div>
    </div>
  </div>
</div>

<script>
// Navigation

function showPage(pageId, btn) {
  var pages = document.querySelectorAll(".page");
  for (var i = 0; i < pages.length; i++) {
    pages[i].classList.remove("visible");
  }
  document.getElementById("page-" + pageId).classList.add("visible");

  var btns = document.querySelectorAll(".nav-btn");
  for (var j = 0; j < btns.length; j++) {
    btns[j].classList.remove("active");
  }
  if (btn) btn.classList.add("active");

  if (pageId === "insights") loadInsights();
  if (pageId === "connect") loadDevices();
  if (pageId === "settings") loadAgentStatuses();
}

// 

var chartInstances = {};

function initCharts() {
  fetch("/api/charts")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var grid = document.getElementById("chart-grid");
      if (!grid) return;
      grid.innerHTML = "";
      var panels = data.panels || [];

      for (var p = 0; p < panels.length; p++) {
        var panel = panels[p];
        var card = document.createElement("div");
        card.className = "chart-panel";

        if (panel.status === "empty" || !panel.datasets || panel.datasets.length === 0) {
          card.style.opacity = "0.4";
          card.innerHTML = '<h4>' + panel.title + '</h4>' +
            '<div class="panel-subtitle">' + panel.subtitle + '</div>' +
            '<div class="chart-placeholder">No data &#x2014; connect health records</div>';
          grid.appendChild(card);
          continue;
        }

        // Title
        var html = '<h4>' + panel.title + '</h4>';
        html += '<div class="panel-subtitle">' + panel.subtitle + '</div>';

        // Row of individual mini-charts (one per metric)
        html += '<div class="chart-row">';
        for (var d = 0; d < panel.datasets.length; d++) {
          var ds = panel.datasets[d];
          var vals = ds.data.filter(function(v) { return v !== null && v !== undefined; });
          var latest = vals.length > 0 ? vals[vals.length - 1] : null;
          var shortLabel = ds.label.split(" (")[0].split(" [")[0];
          if (shortLabel.length > 25) shortLabel = shortLabel.substring(0, 23) + "..";
          var unitMatch = ds.label.match(/\(([^)]+)\)/);
          var unit = unitMatch ? unitMatch[1] : "";

          var canvasId = "mini-" + panel.id + "-" + d;
          html += '<div class="chart-mini">';
          html += '<div class="mini-label">' + escapeHtml(shortLabel) + '</div>';
          html += '<div class="mini-value" style="color:' + ds.color + '">' + (latest !== null ? latest : "--") + ' <span class="mini-unit">' + escapeHtml(unit) + '</span></div>';
          html += '<canvas id="' + canvasId + '"></canvas>';
          html += '</div>';
        }
        html += '</div>';

        // Insight (2 sentences max)
        if (panel.insight) {
          // Trim insight to first 2 sentences of trend data, then add clinical context
          var sentences = panel.insight.split(". ");
          var trendSentences = [];
          var contextSentences = [];
          for (var si = 0; si < sentences.length; si++) {
            if (sentences[si].indexOf("Note:") === 0 || sentences[si].indexOf("Clinical") === 0) {
              contextSentences.push(sentences[si]);
            } else if (trendSentences.length < 2) {
              trendSentences.push(sentences[si]);
            }
          }
          var insightText = trendSentences.join(". ");
          if (insightText && insightText.charAt(insightText.length - 1) !== ".") insightText += ".";
          if (contextSentences.length > 0) {
            insightText += ' <span style="color:#64748B">' + contextSentences[0] + '.</span>';
          }
          html += '<div class="chart-insight">' + insightText + '</div>';
        }

        // Alerts
        if (panel.alerts && panel.alerts.length > 0) {
          html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">';
          for (var ai = 0; ai < panel.alerts.length; ai++) {
            html += '<span class="alert-badge badge-warning" style="font-size:10px">' + escapeHtml(panel.alerts[ai]) + '</span>';
          }
          html += '</div>';
        }

        card.innerHTML = html;
        grid.appendChild(card);

        // Build individual mini-charts
        for (var d2 = 0; d2 < panel.datasets.length; d2++) {
          buildMiniChart("mini-" + panel.id + "-" + d2, panel.labels, panel.datasets[d2]);
        }
      }
    })
    .catch(function(err) {
      console.error("Charts fetch error:", err);
    });
}

function buildMiniChart(canvasId, labels, ds) {
  var ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
  }

  // Build annotations: green band for normal range, red zones above/below
  var annotations = {};
  var hasRef = (ds.refHigh !== undefined && ds.refHigh !== null) || (ds.refLow !== undefined && ds.refLow !== null);

  if (hasRef) {
    // Green band for normal range
    var bandLow = ds.refLow !== undefined && ds.refLow !== null ? ds.refLow : 0;
    var bandHigh = ds.refHigh !== undefined && ds.refHigh !== null ? ds.refHigh : 99999;

    annotations.normalBand = {
      type: "box",
      yMin: bandLow,
      yMax: bandHigh,
      backgroundColor: "#22C55E0D",
      borderWidth: 0
    };

    // Red zone above high threshold
    if (ds.refHigh !== undefined && ds.refHigh !== null) {
      annotations.highZone = {
        type: "box",
        yMin: ds.refHigh,
        yMax: ds.refHigh * 2,
        backgroundColor: "#EF44440A",
        borderWidth: 0
      };
      annotations.highLine = {
        type: "line",
        yMin: ds.refHigh,
        yMax: ds.refHigh,
        borderColor: "#EF444455",
        borderWidth: 1,
        borderDash: [3, 3],
        label: { display: true, content: "High: " + ds.refHigh, position: "start", color: "#EF444488", font: { size: 8 }, padding: 2 }
      };
    }

    // Yellow zone below low threshold
    if (ds.refLow !== undefined && ds.refLow !== null) {
      annotations.lowZone = {
        type: "box",
        yMin: 0,
        yMax: ds.refLow,
        backgroundColor: "#FBBF240A",
        borderWidth: 0
      };
      annotations.lowLine = {
        type: "line",
        yMin: ds.refLow,
        yMax: ds.refLow,
        borderColor: "#FBBF2455",
        borderWidth: 1,
        borderDash: [3, 3],
        label: { display: true, content: "Low: " + ds.refLow, position: "start", color: "#FBBF2488", font: { size: 8 }, padding: 2 }
      };
    }
  }

  var pluginOpts = { legend: { display: false } };
  if (Object.keys(annotations).length > 0) {
    pluginOpts.annotation = { annotations: annotations };
  }

  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        data: ds.data,
        borderColor: ds.color,
        backgroundColor: ds.color + "15",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: ds.color,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: pluginOpts,
      scales: {
        x: { ticks: { color: "#64748B", font: { size: 8 }, maxRotation: 45, minRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: "#64748B", font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: "#1E293B44" } }
      }
    }
  });
}

// 

function loadInsights() {
  fetch("/api/status")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var s = data.summary;
      if (!s) {
        document.getElementById("headline").textContent = "No data yet";
        document.getElementById("subheadline").textContent = "Go to Connect to link a device or health system.";
        document.getElementById("score-ring").textContent = "--";
        return;
      }
      var score = s.overallScore || 0;
      var pct = Math.round(score * 3.6);
      var color = score >= 75 ? "#22C55E" : score >= 50 ? "#F59E0B" : "#EF4444";
      document.getElementById("score-ring").textContent = score;
      document.getElementById("score-ring").style.background = "conic-gradient(" + color + " 0deg," + color + " " + pct + "deg,#1E293B " + pct + "deg,#1E293B 360deg)";
      document.getElementById("headline").textContent = s.headline || "Health Status";
      document.getElementById("subheadline").textContent = s.date || "";

      // Key metrics
      var mg = document.getElementById("metrics-grid");
      mg.innerHTML = "";
      if (s.keyMetrics && s.keyMetrics.length > 0) {
        for (var i = 0; i < s.keyMetrics.length; i++) {
          var m = s.keyMetrics[i];
          var sc = m.status === "good" ? "status-good" : m.status === "warning" ? "status-warning" : "status-concern";
          var tile = document.createElement("div");
          tile.className = "metric-tile";
          tile.innerHTML = '<div class="label"><span class="status ' + sc + '"></span>' + escapeHtml(m.label) + '</div><div class="value">' + escapeHtml(m.value) + '<span class="unit">' + escapeHtml(m.unit) + '</span></div>';
          mg.appendChild(tile);
        }
      }

      // Alerts
      var ac = document.getElementById("alerts-card");
      var al = document.getElementById("alerts-list");
      if (s.alerts && s.alerts.length > 0) {
        ac.style.display = "block";
        al.innerHTML = "";
        for (var j = 0; j < s.alerts.length; j++) {
          var a = s.alerts[j];
          var bc = a.severity === "critical" ? "badge-critical" : a.severity === "warning" ? "badge-warning" : "badge-info";
          var item = document.createElement("div");
          item.className = "alert-item";
          item.innerHTML = '<span class="alert-badge ' + bc + '">' + escapeHtml(a.severity) + '</span><span class="alert-msg">' + escapeHtml(a.message) + '</span>';
          al.appendChild(item);
        }
      } else {
        ac.style.display = "none";
      }
    })
    .catch(function(err) {
      console.error("Status fetch error:", err);
    });

  // Clinical synthesis panels
  initCharts();
  loadGenomics();

  // Records
  fetch("/api/records")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var tb = document.getElementById("records-body");
      tb.innerHTML = "";
      var records = (data.labs || []).concat(data.vitals || []);
      if (records.length === 0) {
        tb.innerHTML = '<tr><td colspan="4" style="color:#475569;text-align:center;padding:20px">No records yet. Connect a device or health system.</td></tr>';
        return;
      }
      var shown = records.slice(0, 30);
      for (var i = 0; i < shown.length; i++) {
        var r = shown[i];
        var name = r.testName || r.data_type || "Vital";
        var val = "";
        if (r.value !== undefined) val = r.value + " " + (r.unit || "");
        if (r.heartRate) val = r.heartRate + " bpm";
        if (r.bpSystolic) val = r.bpSystolic + " mmHg";
        if (r.spo2) val = r.spo2 + " %";
        var dt = (r.date || "").split("T")[0] || "";
        var interp = r.interpretation || "normal";
        var ic = interp === "normal" ? "interp-normal" : interp === "high" ? "interp-high" : "interp-low";
        var tr = document.createElement("tr");
        tr.innerHTML = "<td>" + escapeHtml(name) + "</td><td>" + escapeHtml(val) + "</td><td>" + escapeHtml(dt) + '</td><td class="' + ic + '">' + escapeHtml(interp) + "</td>";
        tb.appendChild(tr);
      }
    })
    .catch(function(err) {
      console.error("Records fetch error:", err);
    });
}

// 

var wizardStep = 0;
var wizardDone = [false, false, false, false];

function wizardNext() {
  wizardDone[wizardStep] = true;
  wizardStep = Math.min(wizardStep + 1, 3);
  updateWizard();
}

function updateWizard() {
  var steps = document.querySelectorAll(".wizard-step");
  for (var i = 0; i < steps.length; i++) {
    steps[i].classList.remove("active", "done");
    if (i === wizardStep) steps[i].classList.add("active");
    if (wizardDone[i]) steps[i].classList.add("done");
  }
  for (var j = 0; j < 4; j++) {
    var el = document.getElementById("wiz-" + j);
    if (el) el.style.display = j === wizardStep ? "block" : "none";
  }
}

var DEVICES = [
  { id: "oura", name: "Oura Ring", icon: "&#x1F48D;", desc: "Sleep, HRV, readiness, temperature" },
  { id: "whoop", name: "WHOOP", icon: "&#x1F4AA;", desc: "Strain, recovery, sleep, HRV" },
  { id: "fitbit", name: "Fitbit", icon: "&#x231A;", desc: "Steps, heart rate, sleep, SpO2" },
  { id: "garmin", name: "Garmin", icon: "&#x231A;", desc: "Activity, sleep, stress, body battery" },
  { id: "dexcom", name: "Dexcom CGM", icon: "&#x1FA78;", desc: "Continuous glucose monitoring" },
  { id: "withings", name: "Withings", icon: "&#x2696;&#xFE0F;", desc: "Weight, BP, sleep, activity" },
  { id: "polar", name: "Polar", icon: "&#x2764;&#xFE0F;", desc: "Heart rate, training, sleep" },
  { id: "apple_health", name: "Apple Health", icon: "&#x1F34E;", desc: "Automatic via HealthKit" }
];

function loadDevices() {
  var grid = document.getElementById("device-grid");
  grid.innerHTML = "";

  fetch("/api/connect/sources")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var connectedIds = {};
      if (data.sources) {
        for (var s = 0; s < data.sources.length; s++) {
          if (data.sources[s].connected) connectedIds[data.sources[s].id] = true;
        }
      }
      renderDeviceGrid(grid, connectedIds);
    })
    .catch(function() {
      renderDeviceGrid(grid, {});
    });
}

function renderDeviceGrid(grid, connectedIds) {
  for (var i = 0; i < DEVICES.length; i++) {
    var d = DEVICES[i];
    var isConn = connectedIds[d.id] || false;
    var card = document.createElement("div");
    card.className = "device-card";
    card.innerHTML = '<div class="device-icon">' + d.icon + '</div>' +
      '<div class="device-name">' + escapeHtml(d.name) + '</div>' +
      '<div class="device-desc">' + escapeHtml(d.desc) + '</div>' +
      (isConn
        ? '<span class="connected-badge">Connected</span>'
        : '<button class="btn-outline" data-device="' + d.id + '" onclick="connectDevice(this.dataset.device)">Connect</button>');
    grid.appendChild(card);
  }
}

function connectDevice(deviceId) {
  fetch("/api/connect/wearable?device=" + encodeURIComponent(deviceId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.authorization_url) {
        window.open(data.authorization_url, "_blank");
        // Poll for connection completion
        var polls = 0;
        var pollTimer = setInterval(function() {
          polls++;
          if (polls > 60) { clearInterval(pollTimer); return; }
          loadConnectionStatus();
          loadDevices();
        }, 5000);
      } else if (data.authorized) {
        loadDevices();
        loadConnectionStatus();
      }
    })
    .catch(function() {});
}

// Load and display connection status panel
function loadConnectionStatus() {
  var panel = document.getElementById("connected-sources-list");
  var badge = document.getElementById("conn-count-badge");
  if (!panel) return;

  fetch("/api/connect/sources")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var sources = data.sources || [];
      var connected = sources.filter(function(s) { return s.connected; });

      badge.textContent = connected.length;
      if (connected.length === 0) {
        panel.innerHTML = '<span style="color:#475569;font-size:12px">No devices or health systems connected yet.</span>';
        return;
      }

      var html = '';
      for (var i = 0; i < connected.length; i++) {
        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:#22C55E11;border:1px solid #22C55E33;font-size:11px;color:#22C55E;font-weight:600">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:#22C55E"></span>' +
          escapeHtml(connected[i].name) + '</span>';
      }

      // Check EHR separately
      fetch("/api/status")
        .then(function(r2) { return r2.json(); })
        .then(function(statusData) {
          var s = statusData.summary;
          if (s && s.sources && s.sources.length > 0) {
            html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;background:#22C55E11;border:1px solid #22C55E33;font-size:11px;color:#22C55E;font-weight:600">' +
              '<span style="width:6px;height:6px;border-radius:50%;background:#22C55E"></span>Health Records</span>';
            badge.textContent = connected.length + 1;

            // Show EHR connected banner
            var ehrBanner = document.getElementById("ehr-connected-banner");
            if (ehrBanner) ehrBanner.style.display = "flex";
            var ehrCount = document.getElementById("ehr-record-count");
            if (ehrCount && s.keyMetrics) ehrCount.textContent = s.keyMetrics.length + " metrics synced";
          }
          panel.innerHTML = html;
        })
        .catch(function() { panel.innerHTML = html; });
    })
    .catch(function() {
      panel.innerHTML = '<span style="color:#475569;font-size:12px">Could not load status</span>';
    });
}

// Health system search
function searchHealthSystems(query) {
  var logos = document.getElementById("ehr-logos");
  if (!logos) return;
  var buttons = logos.querySelectorAll("button");
  var q = query.toLowerCase();
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].style.display = buttons[i].textContent.toLowerCase().indexOf(q) >= 0 || q === "" ? "" : "none";
  }
}

// Select a health system and show login form
function selectHealthSystem(name) {
  var form = document.getElementById("ehr-login-form");
  var nameEl = document.getElementById("ehr-selected-name");
  if (form) form.style.display = "block";
  if (nameEl) nameEl.textContent = name;
  var emailInput = document.getElementById("ehr-email");
  if (emailInput) emailInput.focus();
}

// Load connection status on page load
setTimeout(loadConnectionStatus, 500);
setTimeout(loadDevices, 600);
setTimeout(loadHealthSystems, 700);

// Load user's matched health systems from EHR agent
function loadHealthSystems() {
  fetch("/api/connect/health-systems")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var systems = data.systems || [];
      if (systems.length === 0 && !data.authenticated) return;

      for (var i = 0; i < systems.length; i++) {
        var s = systems[i];
        var isConnected = s.status === "CONNECTED";
        if (isConnected) {
          // Show the connected banner with health system name
          var banner = document.getElementById("ehr-connected-banner");
          if (banner) {
            banner.style.display = "block";
            var nameEl = document.getElementById("ehr-system-name");
            if (nameEl) nameEl.textContent = s.name || "Health Records";
            var syncEl = document.getElementById("ehr-sync-info");
            if (syncEl) {
              var syncText = "Connected";
              if (s.lastSynced) syncText += " - last synced " + s.lastSynced.split("T")[0];
              if (s.syncStatus) syncText += " (" + s.syncStatus.toLowerCase() + ")";
              syncEl.textContent = syncText;
            }
          }
        }
      }

      // If authenticated but no systems returned, still show connected
      if (systems.length === 0 && data.authenticated) {
        var banner2 = document.getElementById("ehr-connected-banner");
        if (banner2) {
          banner2.style.display = "block";
          var nameEl2 = document.getElementById("ehr-system-name");
          if (nameEl2) nameEl2.textContent = "Health Records";
          var syncEl2 = document.getElementById("ehr-sync-info");
          if (syncEl2) syncEl2.textContent = "Connected";
        }
      }
    })
    .catch(function() {});
}

// 

function doLogin() {
  var email = document.getElementById("login-email").value;
  var password = document.getElementById("login-password").value;
  var errEl = document.getElementById("login-error");
  var btn = document.getElementById("login-btn");

  if (!email || !password) {
    errEl.textContent = "Email and password are required.";
    errEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in...";
  errEl.style.display = "none";

  fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = "Sign In";
      if (data.ok) {
        wizardDone[0] = true;
        wizardNext();
      } else {
        errEl.textContent = data.error || "Login failed.";
        errEl.style.display = "block";
      }
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = "Sign In";
      errEl.textContent = "Network error: " + err;
      errEl.style.display = "block";
    });
}

function connectEhr() {
  var email = document.getElementById("ehr-email").value;
  var password = document.getElementById("ehr-password").value;
  var statusEl = document.getElementById("ehr-status");

  if (!email || !password) {
    statusEl.textContent = "Email and password required.";
    statusEl.style.display = "block";
    statusEl.style.color = "#FCA5A5";
    return;
  }

  statusEl.textContent = "Connecting...";
  statusEl.style.display = "block";
  statusEl.style.color = "#94A3B8";

  fetch("/api/connect/ehr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password })
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok && data.success) {
        statusEl.textContent = "Connected successfully. Records will sync shortly.";
        statusEl.style.color = "#22C55E";
        wizardDone[3] = true;
        updateWizard();
      } else {
        statusEl.textContent = data.error || "Connection failed.";
        statusEl.style.color = "#FCA5A5";
      }
    })
    .catch(function(err) {
      statusEl.textContent = "Error: " + err;
      statusEl.style.color = "#FCA5A5";
    });
}

// Genomics display in Insights

function loadGenomics() {
  fetch("/api/genomics/variants")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var variants = data.variants || [];
      if (variants.length === 0) return;

      var panel = document.getElementById("genomics-panel");
      if (panel) panel.style.display = "block";

      // Separate into risk variants, wellness, and ancestry
      var risks = [];
      var wellness = [];
      var ancestry = [];

      for (var i = 0; i < variants.length; i++) {
        var v = variants[i];
        var cat = v.category || "";
        if (cat.indexOf("ancestry") >= 0) {
          ancestry.push(v);
        } else if (cat.indexOf("wellness") >= 0) {
          wellness.push(v);
        } else {
          risks.push(v);
        }
      }

      // Render risk variants as cards
      var grid = document.getElementById("genomics-grid");
      if (grid && risks.length > 0) {
        var html = "";
        for (var r = 0; r < risks.length; r++) {
          var rv = risks[r];
          var isRisk = rv.riskScore > 0.5;
          var isCarrier = rv.riskScore > 0 && rv.riskScore <= 0.5;
          var bgColor = isRisk ? "#EF444410" : isCarrier ? "#FBBF2410" : "#22C55E10";
          var borderColor = isRisk ? "#EF444433" : isCarrier ? "#FBBF2433" : "#22C55E33";
          var statusColor = isRisk ? "#EF4444" : isCarrier ? "#FBBF24" : "#22C55E";
          var statusText = isRisk ? "INCREASED RISK" : isCarrier ? "CARRIER" : "NORMAL";
          var desc = rv.description || rv.rsid || "";

          html += '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:8px;padding:10px">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
          html += '<span style="font-size:13px;font-weight:700;color:#E2E8F0">' + escapeHtml(rv.gene || desc.split(" ")[0] || rv.rsid) + '</span>';
          html += '<span style="font-size:9px;font-weight:700;color:' + statusColor + ';background:' + statusColor + '15;padding:2px 6px;border-radius:3px">' + statusText + '</span>';
          html += '</div>';
          if (rv.genotype) {
            html += '<div style="font-size:10px;color:#94A3B8">Genotype: ' + escapeHtml(rv.genotype) + ' | ' + escapeHtml(rv.rsid) + '</div>';
          }
          html += '<div style="font-size:10px;color:#64748B;margin-top:2px">' + escapeHtml(desc) + '</div>';
          html += '</div>';
        }
        grid.innerHTML = html;
      }

      // Render wellness traits
      var wellnessEl = document.getElementById("genomics-wellness");
      if (wellnessEl && wellness.length > 0) {
        var wHtml = '<div style="font-size:11px;color:#A78BFA;font-weight:700;margin-bottom:6px">WELLNESS TRAITS</div>';
        wHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        for (var w = 0; w < wellness.length; w++) {
          var wv = wellness[w];
          var traitVal = wv.description || "";
          // The unit field holds the original string value for genomics
          if (!traitVal && wv.unit) traitVal = wv.unit;
          wHtml += '<div style="background:#0F172A;border:1px solid #1E293B;border-radius:6px;padding:6px 10px;font-size:11px">';
          wHtml += '<span style="color:#CBD5E1;font-weight:600">' + escapeHtml(wv.gene || wv.rsid) + ':</span> ';
          wHtml += '<span style="color:#94A3B8">' + escapeHtml(traitVal) + '</span>';
          wHtml += '</div>';
        }
        wHtml += '</div>';
        wellnessEl.innerHTML = wHtml;
      }

      // Render ancestry
      var ancestryEl = document.getElementById("genomics-ancestry");
      if (ancestryEl && ancestry.length > 0) {
        var aHtml = '<div style="font-size:11px;color:#22C55E;font-weight:700;margin-bottom:6px">ANCESTRY</div>';
        aHtml += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
        for (var a = 0; a < ancestry.length; a++) {
          var av = ancestry[a];
          var aVal = av.description || av.unit || "";
          aHtml += '<div style="background:#0F172A;border:1px solid #1E293B;border-radius:6px;padding:6px 10px;font-size:11px">';
          aHtml += '<span style="color:#CBD5E1;font-weight:600">' + escapeHtml(av.gene || av.rsid) + ':</span> ';
          aHtml += '<span style="color:#94A3B8">' + escapeHtml(aVal) + '</span>';
          aHtml += '</div>';
        }
        aHtml += '</div>';
        ancestryEl.innerHTML = aHtml;
      }
    })
    .catch(function() {});
}

// Genomics upload

function uploadGenomicsFile(input) {
  var file = input.files[0];
  if (!file) return;
  var statusEl = document.getElementById("genomics-upload-status");
  statusEl.style.display = "block";
  statusEl.style.background = "#FBBF2422";
  statusEl.style.color = "#FBBF24";
  statusEl.textContent = "Uploading " + file.name + " (" + Math.round(file.size / 1024) + " KB)...";

  var reader = new FileReader();
  reader.onload = function(e) {
    var content = e.target.result;
    statusEl.textContent = "Parsing genomics data...";

    fetch("/api/genomics/upload", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: content
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok) {
        statusEl.style.background = "#22C55E22";
        statusEl.style.color = "#22C55E";
        statusEl.textContent = "Parsed " + data.totalSnps + " SNPs, found " + data.matchedVariants + " clinically relevant variants. Stored " + data.stored + " results.";
        // Show variant details
        if (data.variants && data.variants.length > 0) {
          var html = statusEl.innerHTML;
          html += '<div style="margin-top:8px">';
          for (var i = 0; i < data.variants.length; i++) {
            var v = data.variants[i];
            var riskLabel = v.riskScore > 0.5 ? "HIGH RISK" : v.riskScore > 0 ? "CARRIER" : "NORMAL";
            var riskColor = v.riskScore > 0.5 ? "#EF4444" : v.riskScore > 0 ? "#FBBF24" : "#22C55E";
            html += '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1E293B;font-size:10px">';
            html += '<span>' + v.gene + ' (' + v.rsid + ') ' + v.genotype + '</span>';
            html += '<span style="color:' + riskColor + ';font-weight:600">' + riskLabel + '</span>';
            html += '</div>';
          }
          html += '</div>';
          statusEl.innerHTML = html;
        }
      } else {
        statusEl.style.background = "#EF444422";
        statusEl.style.color = "#FCA5A5";
        statusEl.textContent = "Upload failed: " + (data.error || "Unknown error");
      }
    })
    .catch(function(err) {
      statusEl.style.background = "#EF444422";
      statusEl.style.color = "#FCA5A5";
      statusEl.textContent = "Upload error: " + err;
    });
  };
  reader.readAsText(file);
}

// PDF upload

function uploadPdfFile(input) {
  var file = input.files[0];
  if (!file) return;
  var statusEl = document.getElementById("pdf-upload-status");
  statusEl.style.display = "block";
  statusEl.style.background = "#FBBF2422";
  statusEl.style.color = "#FBBF24";
  statusEl.textContent = "Uploading " + file.name + " (" + Math.round(file.size / 1024) + " KB)...";

  var reader = new FileReader();
  reader.onload = function(e) {
    var arrayBuffer = e.target.result;
    statusEl.textContent = "Extracting health data from PDF...";

    fetch("/api/pdf/upload", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: arrayBuffer
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.ok && data.totalExtracted > 0) {
        statusEl.style.background = "#22C55E22";
        statusEl.style.color = "#22C55E";
        var html = "Extracted " + data.totalExtracted + " health data points. Stored " + data.stored + " results.";
        html += '<div style="margin-top:8px;max-height:200px;overflow-y:auto">';
        for (var i = 0; i < data.results.length; i++) {
          var r = data.results[i];
          var conf = Math.round(r.confidence * 100);
          html += '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1E293B;font-size:10px">';
          html += '<span style="color:#E2E8F0">' + r.testName + '</span>';
          html += '<span><span style="color:#E8751A;font-weight:600">' + r.value + '</span> <span style="color:#64748B">' + r.unit + '</span>';
          if (r.referenceRange) html += ' <span style="color:#475569">(' + r.referenceRange + ')</span>';
          html += ' <span style="color:#475569">' + conf + '%</span></span>';
          html += '</div>';
        }
        html += '</div>';
        statusEl.innerHTML = html;
        // Reload insights after a moment
        setTimeout(function() { location.reload(); }, 3000);
      } else if (data.ok && data.totalExtracted === 0) {
        statusEl.style.background = "#FBBF2422";
        statusEl.style.color = "#FBBF24";
        statusEl.textContent = "No health data found in this PDF. Try a lab report or genomics report.";
      } else {
        statusEl.style.background = "#EF444422";
        statusEl.style.color = "#FCA5A5";
        statusEl.textContent = "Extraction failed: " + (data.error || "Unknown error");
      }
    })
    .catch(function(err) {
      statusEl.style.background = "#EF444422";
      statusEl.style.color = "#FCA5A5";
      statusEl.textContent = "Upload error: " + err;
    });
  };
  reader.readAsArrayBuffer(file);
}

// Contribute

function enrollContribute() {
  var btn = document.getElementById("enroll-btn");
  btn.disabled = true;
  btn.textContent = "Enrolling...";
  // In production this would call the blockchain contribute manager
  setTimeout(function() {
    btn.textContent = "Enrolled";
    btn.style.background = "#22C55E";
  }, 1500);
}

// 

function loadAgentStatuses() {
  fetch("/api/agents")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var list = document.getElementById("agent-status-list");
      list.innerHTML = "";
      var agents = data.agents || [];
      var connectedCount = 0;
      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];
        var color = a.status === "idle" ? "#22C55E" : a.status === "running" ? "#F59E0B" : a.status === "error" ? "#EF4444" : "#64748B";
        var div = document.createElement("div");
        div.style.marginBottom = "6px";
        div.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:8px"></span>' + escapeHtml(a.name) + ' <span style="color:#64748B">(' + escapeHtml(a.status) + ')</span>';
        list.appendChild(div);
        if (a.status !== "disabled") connectedCount++;
      }
      document.getElementById("connected-accounts-info").textContent = connectedCount + " agent" + (connectedCount !== 1 ? "s" : "") + " registered";
    })
    .catch(function() {});
}

function exportData() {
  fetch("/api/records")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "xspan-health-export-" + new Date().toISOString().split("T")[0] + ".json";
      a.click();
      URL.revokeObjectURL(url);
    });
}

function confirmDelete() {
  if (confirm("This will permanently delete all health data on this device. This action cannot be undone. Are you sure?")) {
    fetch("/api/admin/delete-data", { method: "POST" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) { alert("All data deleted."); location.reload(); }
        else { alert("Delete failed: " + (data.error || "unknown")); }
      });
  }
}

function subscribeStripe() {
  // Redirect to Stripe Checkout for $5.99/mo subscription
  var stripeUrl = "https://xspan.ai/subscribe?plan=agent&price=599";
  window.open(stripeUrl, "_blank");
  document.getElementById("sub-status").textContent = "Opening Stripe Checkout...";
}

function cancelSubscription() {
  if (confirm("Cancel your $5.99/month subscription? You will lose access when the current period ends.")) {
    fetch("/api/subscription/cancel", { method: "POST" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          document.getElementById("sub-status").textContent = "Subscription cancelled. Access until " + (data.endsAt || "end of period");
          document.getElementById("sub-badge").textContent = "CANCELLED";
          document.getElementById("sub-badge").style.background = "#EF444422";
          document.getElementById("sub-badge").style.color = "#EF4444";
        }
      });
  }
}

// Load subscription status on settings page
function loadSubscriptionStatus() {
  fetch("/api/subscription/status")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var statusEl = document.getElementById("sub-status");
      var badgeEl = document.getElementById("sub-badge");
      var cancelBtn = document.getElementById("cancel-sub-btn");
      if (data.tier === "paid") {
        statusEl.textContent = "Active subscription. Renews " + (data.renewsAt || "monthly");
        badgeEl.textContent = "ACTIVE";
        badgeEl.style.background = "#22C55E22";
        badgeEl.style.color = "#22C55E";
        cancelBtn.disabled = false;
      } else if (data.tier === "trial") {
        statusEl.textContent = "Free trial. " + (data.trialDaysLeft || 3) + " days remaining.";
        badgeEl.textContent = "TRIAL";
        badgeEl.style.background = "#FBBF2422";
        badgeEl.style.color = "#FBBF24";
      } else {
        statusEl.textContent = "No active subscription.";
        badgeEl.textContent = "EXPIRED";
        badgeEl.style.background = "#EF444422";
        badgeEl.style.color = "#EF4444";
      }
    })
    .catch(function() {
      document.getElementById("sub-status").textContent = "Free trial (3 days)";
    });
}

setTimeout(loadSubscriptionStatus, 800);

function saveWallet() {
  var addr = document.getElementById("wallet-address").value.trim();
  var statusEl = document.getElementById("wallet-status");
  if (!addr || (!addr.startsWith("0x") && addr.length < 10)) {
    statusEl.style.display = "block";
    statusEl.style.color = "#FCA5A5";
    statusEl.textContent = "Enter a valid wallet address (0x...)";
    return;
  }
  // Save to local storage
  localStorage.setItem("mhs_wallet", addr);
  statusEl.style.display = "block";
  statusEl.style.color = "#22C55E";
  statusEl.textContent = "Wallet saved: " + addr.substring(0, 6) + "..." + addr.substring(addr.length - 4);
}

// Load saved wallet on page load
setTimeout(function() {
  var saved = localStorage.getItem("mhs_wallet");
  if (saved) {
    var input = document.getElementById("wallet-address");
    if (input) input.value = saved;
  }
}, 500);

function emailDoctor() {
  var subject = encodeURIComponent("XSpan Premium - Patient Request");
  var body = "Dear%20Doctor%2C%20I%20am%20using%20the%20MyHealthSpan%20Agent.%20I%20would%20like%20to%20learn%20about%20XSpan%20Premium.%20More%20info%3A%20https%3A%2F%2Fxspan.ai%2Fpremium";
  window.open("mailto:?subject=" + subject + "&body=" + body, "_blank");
}

// 

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 

loadInsights();
</script>
</body>
</html>`;
}

// 

async function startApp(): Promise<void> {
  await orchestrator.initialize();

  // Auto-login if credentials are saved
  const savedEmail = process.env.BWELL_EMAIL;
  const savedPassword = process.env.BWELL_PASSWORD;
  if (savedEmail && savedPassword && ehrAgent) {
    console.log('[Dashboard] Auto-connecting health records...');
    const result = await orchestrator.sendMessage('ehr-agent', 'login', {
      email: savedEmail,
      password: savedPassword,
    });
    if (result.type === 'result') {
      sessionUser = { email: savedEmail, loggedIn: true };
      console.log('[Dashboard] Auto-login successful');
    } else {
      console.log('[Dashboard] Auto-login failed:', result.payload.error);
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = routePath(req.url || '/');

    if (path.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }

    // Serve the SPA for all other routes
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
  });

  server.listen(PORT, () => {
    console.log(`[Dashboard] MyHealthSpan running at http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Dashboard] Shutting down...');
    await orchestrator.shutdown();
    store.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startApp().catch((err) => {
  console.error('[Dashboard] Fatal error:', err);
  process.exit(1);
});
