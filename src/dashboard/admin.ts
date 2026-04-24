// ============================================================
// MyHealthSpan Agent — Admin Dashboard (admin.ts)
// Developer control plane for managing the agent
// Single-file Node.js HTTP server — no Express
// Port 3001 (configurable via ADMIN_PORT env var)
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { LocalStore } from '../storage/local-store.js';

loadDotenv();

// ── Configuration ────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.xspan', 'data');
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '3001', 10);
const PROJECT_ROOT = resolve(process.cwd());
const ENV_PATH = join(PROJECT_ROOT, '.env');
const SKILLS_DIR = join(PROJECT_ROOT, 'src', 'skills');
const MEMORY_DIR = join(PROJECT_ROOT, 'src', 'memory');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'src', 'harness', 'prompt-templates');

const store = new LocalStore(DATA_DIR);
const START_TIME = Date.now();

// ── Webhook + API Key State ──────────────────────────────────

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  addedAt: string;
}

interface WebhookLogEntry {
  id: string;
  webhookId: string;
  event: string;
  status: number;
  timestamp: string;
  responseTime: number;
}

interface ApiKeyEntry {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

let webhooks: WebhookEntry[] = [];
let webhookLog: WebhookLogEntry[] = [];
let apiKeys: ApiKeyEntry[] = [];

// ── Adapter Definitions ──────────────────────────────────────

const ADAPTER_DEFS = [
  { id: 'claude', name: 'Claude (Anthropic)', envKey: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-20250514' },
  { id: 'gemini', name: 'Gemini (Google)', envKey: 'GOOGLE_AI_API_KEY', model: 'gemini-2.0-flash' },
  { id: 'gpt4', name: 'GPT-4 (OpenAI)', envKey: 'OPENAI_API_KEY', model: 'gpt-4o' },
  { id: 'ollama', name: 'Ollama (Local)', envKey: 'OLLAMA_BASE_URL', model: 'llama3' },
  { id: 'rule-based', name: 'Rule-based (No LLM)', envKey: '', model: '' },
];

// ── Helpers ──────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function routePath(url: string): string {
  const idx = url.indexOf('?');
  return idx >= 0 ? url.slice(0, idx) : url;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function generateApiKey(): string {
  const segments: string[] = [];
  for (let i = 0; i < 4; i++) {
    segments.push(Math.random().toString(36).slice(2, 10));
  }
  return 'xspan_' + segments.join('');
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return days + 'd ' + (hours % 24) + 'h ' + (minutes % 60) + 'm';
  if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
  return minutes + 'm ' + (seconds % 60) + 's';
}

function readEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(ENV_PATH)) return env;
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

function writeEnvFile(env: Record<string, string>): void {
  // Read existing file to preserve comments and order
  const existingLines: string[] = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8').split('\n') : [];
  const written = new Set<string>();
  const newLines: string[] = [];

  for (const line of existingLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) { newLines.push(line); continue; }
    const key = trimmed.slice(0, eqIdx).trim();
    if (env[key] !== undefined) {
      newLines.push(`${key}=${env[key]}`);
      written.add(key);
    } else {
      newLines.push(line);
    }
  }

  // Append new keys that were not in the original file
  for (const [key, val] of Object.entries(env)) {
    if (!written.has(key)) {
      newLines.push(`${key}=${val}`);
    }
  }

  writeFileSync(ENV_PATH, newLines.join('\n'));
  console.log(`[Admin] .env updated: ${Object.keys(env).filter(k => env[k]).length} keys`);
}

function writeEnvValue(key: string, value: string): void {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, key + '=' + value + '\n', 'utf-8');
    return;
  }
  const content = readFileSync(ENV_PATH, 'utf-8');
  const lines = content.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(key + '=')) {
      lines[i] = key + '=' + value;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push(key + '=' + value);
  }
  writeFileSync(ENV_PATH, lines.join('\n'), 'utf-8');
}

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
}

function safeReadFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function safeWriteFile(filePath: string, content: string): boolean {
  try {
    writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// ── API Handler ──────────────────────────────────────────────

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = routePath(req.url || '/');
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // ── Status ──────────────────────────────────────────────
    if (path === '/api/admin/status') {
      const db = (store as any).db;

      let sampleCount = 0;
      try {
        const row = db.prepare('SELECT COUNT(*) as cnt FROM health_samples').get() as any;
        sampleCount = row?.cnt || 0;
      } catch {}

      let lastSync: string | null = null;
      try {
        const row = db.prepare('SELECT started_at FROM sync_log ORDER BY started_at DESC LIMIT 1').get() as any;
        lastSync = row?.started_at || null;
      } catch {}

      let syncLogCount = 0;
      try {
        const row = db.prepare('SELECT COUNT(*) as cnt FROM sync_log').get() as any;
        syncLogCount = row?.cnt || 0;
      } catch {}

      // Count distinct sources
      let sources = { wearables: 0, ehr: 0, genomics: 0, labs: 0 };
      try {
        const rows = db.prepare('SELECT DISTINCT source FROM health_samples').all() as any[];
        for (const r of rows) {
          const s = String(r.source).toLowerCase();
          if (s === 'wearable' || s === 'apple_health' || s === 'oura' || s === 'whoop' || s === 'garmin' || s === 'fitbit' || s === 'dexcom') sources.wearables++;
          else if (s === 'ehr' || s === 'fhir' || s === 'bwell') sources.ehr++;
          else if (s === 'genomics' || s === '23andme') sources.genomics++;
          else if (s === 'lab' || s === 'quest' || s === 'labcorp' || s === 'manual') sources.labs++;
        }
      } catch {}

      // Get agent statuses by checking env vars for which are configured
      const env = readEnvFile();
      const agentStatuses = [
        { name: 'wearable-agent', status: (env.ROOK_CLIENT_UUID || env.APPLE_HEALTH_ENABLED === 'true') ? 'active' : 'idle', description: 'Wearable data ingestion (Oura, Apple Health, WHOOP, etc.)' },
        { name: 'ehr-agent', status: env.BWELL_CLIENT_KEY ? 'active' : 'idle', description: 'Electronic health records via b.well / FHIR' },
        { name: 'analytics-agent', status: 'active', description: 'Health data analysis and scoring' },
        { name: 'summary-agent', status: 'active', description: 'Daily briefing and Q&A generation' },
        { name: 'storage-agent', status: 'active', description: 'Local SQLite persistence and sync' },
      ];

      const currentAdapter = env.LLM_ADAPTER || 'rule-based';

      json(res, {
        ok: true,
        agentRunning: true,
        uptime: formatUptime(Date.now() - START_TIME),
        uptimeMs: Date.now() - START_TIME,
        totalSamples: sampleCount,
        lastSync,
        syncLogCount,
        sources,
        connectedSourcesCount: sources.wearables + sources.ehr + sources.genomics + sources.labs,
        agents: agentStatuses,
        currentAdapter,
        version: '1.0.0',
      });
      return;
    }

    // ── Skills ──────────────────────────────────────────────
    if (path === '/api/admin/skills' && method === 'GET') {
      const files = listMdFiles(SKILLS_DIR);
      json(res, { ok: true, files, dir: 'src/skills' });
      return;
    }

    if (path.startsWith('/api/admin/skills/') && method === 'GET') {
      const name = decodeURIComponent(path.slice('/api/admin/skills/'.length));
      const filePath = join(SKILLS_DIR, name);
      const content = safeReadFile(filePath);
      if (content === null) {
        json(res, { ok: false, error: 'File not found' }, 404);
      } else {
        json(res, { ok: true, name, content });
      }
      return;
    }

    if (path.startsWith('/api/admin/skills/') && method === 'POST') {
      const name = decodeURIComponent(path.slice('/api/admin/skills/'.length));
      const body = await parseBody(req);
      const content = body.content as string;
      if (typeof content !== 'string') {
        json(res, { ok: false, error: 'Content required' }, 400);
        return;
      }
      const filePath = join(SKILLS_DIR, name);
      if (safeWriteFile(filePath, content)) {
        json(res, { ok: true, saved: name });
      } else {
        json(res, { ok: false, error: 'Failed to write file' }, 500);
      }
      return;
    }

    // ── Memory ──────────────────────────────────────────────
    if (path === '/api/admin/memory' && method === 'GET') {
      const files = listMdFiles(MEMORY_DIR);
      json(res, { ok: true, files, dir: 'src/memory' });
      return;
    }

    if (path.startsWith('/api/admin/memory/') && method === 'GET') {
      const name = decodeURIComponent(path.slice('/api/admin/memory/'.length));
      const filePath = join(MEMORY_DIR, name);
      const content = safeReadFile(filePath);
      if (content === null) {
        json(res, { ok: false, error: 'File not found' }, 404);
      } else {
        json(res, { ok: true, name, content });
      }
      return;
    }

    if (path.startsWith('/api/admin/memory/') && method === 'POST') {
      const name = decodeURIComponent(path.slice('/api/admin/memory/'.length));
      const body = await parseBody(req);
      const content = body.content as string;
      if (typeof content !== 'string') {
        json(res, { ok: false, error: 'Content required' }, 400);
        return;
      }
      const filePath = join(MEMORY_DIR, name);
      if (safeWriteFile(filePath, content)) {
        json(res, { ok: true, saved: name });
      } else {
        json(res, { ok: false, error: 'Failed to write file' }, 500);
      }
      return;
    }

    // ── Prompt Templates ────────────────────────────────────
    if (path === '/api/admin/templates' && method === 'GET') {
      const files = listMdFiles(TEMPLATES_DIR);
      json(res, { ok: true, files, dir: 'src/harness/prompt-templates' });
      return;
    }

    if (path.startsWith('/api/admin/templates/') && method === 'GET') {
      const name = decodeURIComponent(path.slice('/api/admin/templates/'.length));
      const filePath = join(TEMPLATES_DIR, name);
      const content = safeReadFile(filePath);
      if (content === null) {
        json(res, { ok: false, error: 'File not found' }, 404);
      } else {
        json(res, { ok: true, name, content });
      }
      return;
    }

    if (path.startsWith('/api/admin/templates/') && method === 'POST') {
      const name = decodeURIComponent(path.slice('/api/admin/templates/'.length));
      const body = await parseBody(req);
      const content = body.content as string;
      if (typeof content !== 'string') {
        json(res, { ok: false, error: 'Content required' }, 400);
        return;
      }
      const filePath = join(TEMPLATES_DIR, name);
      if (safeWriteFile(filePath, content)) {
        json(res, { ok: true, saved: name });
      } else {
        json(res, { ok: false, error: 'Failed to write file' }, 500);
      }
      return;
    }

    // ── Adapters ────────────────────────────────────────────
    if (path === '/api/admin/adapters' && method === 'GET') {
      const env = readEnvFile();
      const current = env.LLM_ADAPTER || 'rule-based';
      const adapters = ADAPTER_DEFS.map(a => ({
        id: a.id,
        name: a.name,
        model: a.model,
        active: a.id === current,
        configured: a.envKey ? !!env[a.envKey] : true,
        keyMasked: a.envKey && env[a.envKey] ? maskKey(env[a.envKey]) : null,
      }));
      json(res, { ok: true, current, adapters });
      return;
    }

    if (path === '/api/admin/adapters' && method === 'POST') {
      const body = await parseBody(req);
      const adapterId = body.adapter as string;
      const apiKey = body.apiKey as string;

      const def = ADAPTER_DEFS.find(a => a.id === adapterId);
      if (!def) {
        json(res, { ok: false, error: 'Unknown adapter: ' + adapterId }, 400);
        return;
      }

      writeEnvValue('LLM_ADAPTER', adapterId);
      if (def.envKey && apiKey) {
        writeEnvValue(def.envKey, apiKey);
      }

      json(res, { ok: true, adapter: adapterId, message: 'Adapter switched. Restart agent to apply.' });
      return;
    }

    if (path === '/api/admin/test-adapter' && method === 'POST') {
      const body = await parseBody(req);
      const prompt = (body.prompt as string) || 'What are the key biomarkers for cardiovascular health?';
      const env = readEnvFile();
      const current = env.LLM_ADAPTER || 'rule-based';

      if (current === 'rule-based') {
        json(res, {
          ok: true,
          adapter: 'rule-based',
          response: 'Rule-based adapter does not support free-form prompts. It generates structured health summaries from data using deterministic templates. Key cardiovascular biomarkers tracked: Resting Heart Rate, HRV, Blood Pressure (Systolic/Diastolic), SpO2, LDL, HDL, Triglycerides, CRP.',
          latency: 1,
        });
        return;
      }

      // For LLM adapters, attempt a real call
      const startMs = Date.now();
      try {
        let response = '';
        if (current === 'claude' && env.ANTHROPIC_API_KEY) {
          const payload = JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          });
          const { default: https } = await import('https');
          response = await new Promise<string>((resolve, reject) => {
            const httpReq = https.request({
              hostname: 'api.anthropic.com',
              path: '/v1/messages',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
              },
            }, (httpRes) => {
              const chunks: Buffer[] = [];
              httpRes.on('data', (c: Buffer) => chunks.push(c));
              httpRes.on('end', () => {
                try {
                  const body = JSON.parse(Buffer.concat(chunks).toString());
                  resolve(body.content?.[0]?.text || JSON.stringify(body));
                } catch (e) {
                  resolve(Buffer.concat(chunks).toString());
                }
              });
            });
            httpReq.on('error', reject);
            httpReq.write(payload);
            httpReq.end();
          });
        } else if (current === 'gpt4' && env.OPENAI_API_KEY) {
          const payload = JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          });
          const { default: https } = await import('https');
          response = await new Promise<string>((resolve, reject) => {
            const httpReq = https.request({
              hostname: 'api.openai.com',
              path: '/v1/chat/completions',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
              },
            }, (httpRes) => {
              const chunks: Buffer[] = [];
              httpRes.on('data', (c: Buffer) => chunks.push(c));
              httpRes.on('end', () => {
                try {
                  const body = JSON.parse(Buffer.concat(chunks).toString());
                  resolve(body.choices?.[0]?.message?.content || JSON.stringify(body));
                } catch (e) {
                  resolve(Buffer.concat(chunks).toString());
                }
              });
            });
            httpReq.on('error', reject);
            httpReq.write(payload);
            httpReq.end();
          });
        } else if (current === 'gemini' && env.GOOGLE_AI_API_KEY) {
          const payload = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          });
          const { default: https } = await import('https');
          response = await new Promise<string>((resolve, reject) => {
            const httpReq = https.request({
              hostname: 'generativelanguage.googleapis.com',
              path: '/v1beta/models/gemini-2.0-flash:generateContent?key=' + env.GOOGLE_AI_API_KEY,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }, (httpRes) => {
              const chunks: Buffer[] = [];
              httpRes.on('data', (c: Buffer) => chunks.push(c));
              httpRes.on('end', () => {
                try {
                  const body = JSON.parse(Buffer.concat(chunks).toString());
                  resolve(body.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(body));
                } catch (e) {
                  resolve(Buffer.concat(chunks).toString());
                }
              });
            });
            httpReq.on('error', reject);
            httpReq.write(payload);
            httpReq.end();
          });
        } else if (current === 'ollama') {
          const ollamaUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434';
          const payload = JSON.stringify({
            model: 'llama3',
            prompt: prompt,
            stream: false,
          });
          const { default: http } = await import('http');
          const url = new URL(ollamaUrl + '/api/generate');
          response = await new Promise<string>((resolve, reject) => {
            const httpReq = http.request({
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }, (httpRes) => {
              const chunks: Buffer[] = [];
              httpRes.on('data', (c: Buffer) => chunks.push(c));
              httpRes.on('end', () => {
                try {
                  const body = JSON.parse(Buffer.concat(chunks).toString());
                  resolve(body.response || JSON.stringify(body));
                } catch (e) {
                  resolve(Buffer.concat(chunks).toString());
                }
              });
            });
            httpReq.on('error', reject);
            httpReq.write(payload);
            httpReq.end();
          });
        } else {
          response = 'Adapter "' + current + '" is not configured. Set the API key first.';
        }

        json(res, {
          ok: true,
          adapter: current,
          response,
          latency: Date.now() - startMs,
        });
      } catch (err) {
        json(res, {
          ok: false,
          adapter: current,
          error: String(err),
          latency: Date.now() - startMs,
        }, 500);
      }
      return;
    }

    // ── Webhooks ────────────────────────────────────────────
    if (path === '/api/admin/webhooks' && method === 'GET') {
      json(res, { ok: true, webhooks, log: webhookLog.slice(-50) });
      return;
    }

    if (path === '/api/admin/webhooks' && method === 'POST') {
      const body = await parseBody(req);
      const url = body.url as string;
      const events = (body.events as string[]) || ['sync.complete', 'alert.triggered', 'nudge.delivered'];
      if (!url) {
        json(res, { ok: false, error: 'URL required' }, 400);
        return;
      }
      const entry: WebhookEntry = {
        id: generateId(),
        url,
        events,
        addedAt: new Date().toISOString(),
      };
      webhooks.push(entry);
      json(res, { ok: true, webhook: entry });
      return;
    }

    if (path === '/api/admin/webhooks' && method === 'DELETE') {
      const body = await parseBody(req);
      const id = body.id as string;
      if (!id) {
        json(res, { ok: false, error: 'Webhook ID required' }, 400);
        return;
      }
      webhooks = webhooks.filter(w => w.id !== id);
      json(res, { ok: true, removed: id });
      return;
    }

    // ── API Keys ────────────────────────────────────────────
    if (path === '/api/admin/api-keys' && method === 'GET') {
      const safe = apiKeys.map(k => ({
        id: k.id,
        name: k.name,
        keyMasked: maskKey(k.key),
        createdAt: k.createdAt,
        lastUsed: k.lastUsed,
      }));
      json(res, { ok: true, keys: safe });
      return;
    }

    if (path === '/api/admin/api-keys' && method === 'POST') {
      const body = await parseBody(req);
      const name = (body.name as string) || 'Unnamed Key';
      const entry: ApiKeyEntry = {
        id: generateId(),
        name,
        key: generateApiKey(),
        createdAt: new Date().toISOString(),
        lastUsed: null,
      };
      apiKeys.push(entry);
      // Return full key only on creation
      json(res, { ok: true, apiKey: entry });
      return;
    }

    if (path === '/api/admin/api-keys' && method === 'DELETE') {
      const body = await parseBody(req);
      const id = body.id as string;
      if (!id) {
        json(res, { ok: false, error: 'Key ID required' }, 400);
        return;
      }
      apiKeys = apiKeys.filter(k => k.id !== id);
      json(res, { ok: true, removed: id });
      return;
    }

    // ── Logs ────────────────────────────────────────────────
    if (path === '/api/admin/logs' && method === 'GET') {
      const db = (store as any).db;
      let logs: any[] = [];
      try {
        logs = db.prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 100').all();
      } catch {}
      json(res, { ok: true, logs });
      return;
    }

    // ── Distribution ────────────────────────────────────────
    if (path === '/api/admin/distribution' && method === 'GET') {
      let packageJson: any = {};
      try {
        packageJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8'));
      } catch {}

      json(res, {
        ok: true,
        name: packageJson.name || '@myhealthspan/agent',
        version: packageJson.version || '0.0.0',
        description: packageJson.description || '',
        npmPublished: false,
        openClawListed: false,
        githubMarketplace: false,
        links: {
          npm: 'https://www.npmjs.com/package/' + (packageJson.name || '@myhealthspan/agent'),
          openclaw: 'https://openclaw.com/agents/myhealthspan',
          github: 'https://github.com/xspan-health/myhealthspan-agent',
        },
      });
      return;
    }

    if (path === '/api/admin/publish' && method === 'POST') {
      // Execute npm publish in background
      const { exec } = await import('child_process');
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        exec('npm publish --access public', { cwd: PROJECT_ROOT, timeout: 30000 }, (err, stdout, stderr) => {
          resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? 1 : 0 });
        });
      });
      json(res, { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr });
      return;
    }

    // ── Trust & Safety (TrustModel.ai) ─────────────────────
    if (path === '/api/admin/trust/evaluate' && method === 'POST') {
      try {
        const { TrustEvaluator } = await import('../trust/evaluator.js');
        const env = readEnvFile();
        const evaluator = new TrustEvaluator({
          apiKey: env.TRUSTMODEL_API_KEY || '',
          enabled: true,
          frequency: 'manual',
        });
        const result = await evaluator.runEvaluation();
        json(res, result);
      } catch (err) {
        json(res, { success: false, error: String(err) });
      }
      return;
    }

    if (path === '/api/admin/trust/config' && method === 'POST') {
      const body = await parseBody(req);
      const env = readEnvFile();
      if (body.apiKey) env.TRUSTMODEL_API_KEY = body.apiKey as string;
      if (body.frequency) env.TRUSTMODEL_FREQUENCY = body.frequency as string;
      if (body.enabled !== undefined) env.TRUSTMODEL_ENABLED = String(body.enabled);
      writeEnvFile(env);
      json(res, { ok: true });
      return;
    }

    if (path === '/api/admin/trust/status' && method === 'GET') {
      const env = readEnvFile();
      json(res, {
        ok: true,
        configured: !!env.TRUSTMODEL_API_KEY,
        enabled: env.TRUSTMODEL_ENABLED === 'true',
        frequency: env.TRUSTMODEL_FREQUENCY || 'daily',
      });
      return;
    }

    // ── Platform Integration ────────────────────────────────
    if (path === '/api/admin/platform' && method === 'GET') {
      const env = readEnvFile();
      json(res, {
        ok: true,
        mobile: {
          iosUrl: env.IOS_APP_URL || 'https://xspan.ai/app/ios',
          androidUrl: env.ANDROID_APP_URL || 'https://xspan.ai/app/android',
          status: 'endpoints-configured',
        },
        premium: {
          tier: env.XSPAN_TIER || 'free',
          upgradeUrl: 'https://xspan.ai/pricing',
        },
        careHub: {
          status: env.CAREHUB_API_KEY ? 'connected' : 'disconnected',
          endpoint: env.CAREHUB_URL || 'https://api.xspan.ai/carehub',
        },
        dataSync: {
          cloudSyncEnabled: env.CLOUD_SYNC_INTERVAL_MINUTES ? true : false,
          intervalMinutes: parseInt(env.CLOUD_SYNC_INTERVAL_MINUTES || '60', 10),
          lastSync: null,
        },
      });
      return;
    }

    // ── MCP Connections ─────────────────────────────────────
    if (path === '/api/admin/mcp' && method === 'GET') {
      const env = readEnvFile();
      json(res, {
        ok: true,
        transport: env.MCP_TRANSPORT || 'stdio',
        port: env.MCP_PORT || '3456',
        connections: [
          { name: 'Claude Desktop', status: 'configured', transport: 'stdio' },
          { name: 'VS Code Extension', status: 'available', transport: 'stdio' },
        ],
      });
      return;
    }

    json(res, { error: 'Not found', path }, 404);
  } catch (err) {
    console.error('[Admin] API error:', err);
    json(res, { error: String(err) }, 500);
  }
}

// ── Admin Dashboard Page ─────────────────────────────────────

function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyHealthSpan Admin</title>
<style>
/* ── Reset + Base ─────────────────────────────── */
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Inter','Segoe UI',sans-serif;background:#0B0F1A;color:#E2E8F0;min-height:100vh;display:flex}
a{color:#E8751A;text-decoration:none}
button{cursor:pointer;font-family:inherit}
input,textarea,select{font-family:inherit}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:#0B0F1A}
::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}

/* ── Sidebar ─────────────────────────────────── */
.sidebar{width:240px;background:#0F1420;border-right:1px solid #1E293B;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:100}
.sidebar-header{padding:20px;border-bottom:1px solid #1E293B}
.sidebar-header .logo{display:flex;align-items:center;gap:10px}
.sidebar-header .logo img{height:28px}
.sidebar-header .logo-text{font-size:16px;font-weight:800;color:#fff}
.sidebar-header .logo-text span{color:#E8751A}
.sidebar-header .badge{display:inline-block;margin-top:6px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;background:#E8751A20;color:#E8751A;letter-spacing:.5px}
.sidebar-nav{flex:1;padding:12px 0;overflow-y:auto}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 20px;color:#94A3B8;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;border:none;background:none;width:100%;text-align:left}
.nav-item:hover{color:#E2E8F0;background:#1E293B}
.nav-item.active{color:#E8751A;background:#E8751A10;border-right:3px solid #E8751A}
.nav-item .nav-icon{width:18px;text-align:center;font-size:14px}
.sidebar-footer{padding:16px 20px;border-top:1px solid #1E293B;font-size:11px;color:#475569}

/* ── Main Content ────────────────────────────── */
.main{margin-left:240px;flex:1;min-height:100vh}
.topbar{position:sticky;top:0;z-index:50;background:#0B0F1A;border-bottom:1px solid #1E293B;padding:0 28px;height:52px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:16px;font-weight:700;color:#fff}
.topbar .status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle}
.topbar .status-dot.running{background:#22C55E;box-shadow:0 0 6px #22C55E60}
.topbar .status-dot.stopped{background:#EF4444;box-shadow:0 0 6px #EF444460}
.content{padding:24px 28px 60px}

/* ── Section Panels ──────────────────────────── */
.section{display:none}
.section.visible{display:block}

/* ── Cards ───────────────────────────────────── */
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px}
.card h3{font-size:13px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px}

/* ── Stat Grid ───────────────────────────────── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.stat-tile{background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:16px}
.stat-tile .label{font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
.stat-tile .value{font-size:22px;font-weight:800;color:#fff}
.stat-tile .value.accent{color:#E8751A}
.stat-tile .sub{font-size:11px;color:#475569;margin-top:4px}

/* ── Agent Status ────────────────────────────── */
.agent-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #1E293B}
.agent-row:last-child{border-bottom:none}
.agent-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.agent-dot.active{background:#22C55E}
.agent-dot.idle{background:#F59E0B}
.agent-dot.error{background:#EF4444}
.agent-name{font-size:13px;font-weight:600;color:#E2E8F0;min-width:140px}
.agent-desc{font-size:12px;color:#64748B;flex:1}
.agent-badge{padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase}
.agent-badge.active{background:#22C55E20;color:#22C55E}
.agent-badge.idle{background:#F59E0B20;color:#F59E0B}

/* ── File List ───────────────────────────────── */
.file-list{list-style:none}
.file-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background .15s;font-size:13px;color:#CBD5E1}
.file-item:hover{background:#0F172A}
.file-item.selected{background:#E8751A15;color:#E8751A}
.file-icon{font-size:14px;color:#64748B;width:18px;text-align:center}

/* ── Editor ──────────────────────────────────── */
.editor-area{width:100%;min-height:400px;background:#0F172A;border:1px solid #334155;border-radius:8px;padding:14px;font-family:'JetBrains Mono','Fira Code','SF Mono',monospace;font-size:13px;line-height:1.6;color:#E2E8F0;resize:vertical;tab-size:2}
.editor-area:focus{outline:none;border-color:#E8751A60}
.editor-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.editor-filename{font-size:14px;font-weight:600;color:#E8751A}
.editor-dir{font-size:11px;color:#475569}

/* ── Buttons ─────────────────────────────────── */
.btn{padding:8px 16px;border:none;border-radius:6px;font-size:13px;font-weight:600;transition:all .15s}
.btn-primary{background:#E8751A;color:#fff}
.btn-primary:hover{background:#D4681A}
.btn-secondary{background:#1E293B;color:#CBD5E1;border:1px solid #334155}
.btn-secondary:hover{background:#334155}
.btn-danger{background:#EF444420;color:#F87171;border:1px solid #EF444440}
.btn-danger:hover{background:#EF444440}
.btn-sm{padding:5px 10px;font-size:11px}
.btn-group{display:flex;gap:8px;margin-top:12px}

/* ── Form Controls ───────────────────────────── */
.form-group{margin-bottom:14px}
.form-label{display:block;font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
.form-input{width:100%;padding:8px 12px;background:#0F172A;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:13px}
.form-input:focus{outline:none;border-color:#E8751A60}

/* ── Radio Cards ─────────────────────────────── */
.radio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px}
.radio-card{background:#0F172A;border:2px solid #1E293B;border-radius:10px;padding:14px;cursor:pointer;transition:all .15s}
.radio-card:hover{border-color:#334155}
.radio-card.selected{border-color:#E8751A;background:#E8751A08}
.radio-card .rc-name{font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:2px}
.radio-card .rc-model{font-size:11px;color:#64748B}
.radio-card .rc-status{margin-top:6px;font-size:10px;font-weight:600;text-transform:uppercase}
.rc-status.configured{color:#22C55E}
.rc-status.not-configured{color:#F59E0B}
.rc-status.active{color:#E8751A}

/* ── Webhook Table ───────────────────────────── */
.wh-table{width:100%;border-collapse:collapse;font-size:12px}
.wh-table th{text-align:left;padding:8px 10px;color:#64748B;font-weight:600;border-bottom:1px solid #334155;font-size:11px;text-transform:uppercase}
.wh-table td{padding:8px 10px;border-bottom:1px solid #1E293B;color:#CBD5E1}
.wh-table tr:hover td{background:#0F172A}

/* ── Log Entries ─────────────────────────────── */
.log-entry{padding:8px 12px;border-bottom:1px solid #1E293B;font-size:12px;font-family:'JetBrains Mono','Fira Code',monospace;color:#94A3B8}
.log-entry .log-time{color:#475569;margin-right:10px}
.log-entry .log-type{font-weight:700;margin-right:8px}
.log-type.success{color:#22C55E}
.log-type.error{color:#EF4444}
.log-type.info{color:#3B82F6}

/* ── Test Response ───────────────────────────── */
.test-response{background:#0F172A;border:1px solid #334155;border-radius:8px;padding:14px;font-size:13px;color:#CBD5E1;line-height:1.6;margin-top:12px;white-space:pre-wrap;max-height:300px;overflow-y:auto}
.test-meta{font-size:11px;color:#475569;margin-top:6px}

/* ── Distribution Cards ──────────────────────── */
.dist-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.dist-card{background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:16px}
.dist-card .dist-name{font-size:14px;font-weight:700;color:#E2E8F0;margin-bottom:4px}
.dist-card .dist-status{font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:8px}
.dist-status.published{color:#22C55E}
.dist-status.not-published{color:#475569}
.dist-card a{font-size:12px}

/* ── Toast ───────────────────────────────────── */
.toast{position:fixed;bottom:24px;right:24px;background:#22C55E;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:1000;opacity:0;transition:opacity .3s;pointer-events:none}
.toast.error{background:#EF4444}
.toast.visible{opacity:1}

/* ── Responsive ──────────────────────────────── */
@media(max-width:768px){
  .sidebar{width:56px;overflow:hidden}
  .sidebar .logo-text,.sidebar .badge,.sidebar-footer,.nav-item span:not(.nav-icon){display:none}
  .nav-item{justify-content:center;padding:12px 0}
  .main{margin-left:56px}
  .stat-grid{grid-template-columns:1fr 1fr}
  .radio-grid{grid-template-columns:1fr}
  .dist-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>

<!-- ── Sidebar ───────────────────────────────── -->
<aside class="sidebar">
  <div class="sidebar-header">
    <div class="logo">
      <img src="/assets/logo-icon.png" alt="XSpan" onerror="this.style.display='none'">
      <div class="logo-text">My<span>Health</span>Span</div>
    </div>
    <div class="badge">Admin</div>
  </div>
  <nav class="sidebar-nav">
    <button class="nav-item active" onclick="showSection('overview',this)">
      <span class="nav-icon">&#9673;</span>
      <span>Agent Overview</span>
    </button>
    <button class="nav-item" onclick="showSection('skills',this)">
      <span class="nav-icon">&#9998;</span>
      <span>Skills Editor</span>
    </button>
    <button class="nav-item" onclick="showSection('adapter',this)">
      <span class="nav-icon">&#9881;</span>
      <span>LLM Adapter</span>
    </button>
    <button class="nav-item" onclick="showSection('webhooks',this)">
      <span class="nav-icon">&#8631;</span>
      <span>Webhooks &amp; MCP</span>
    </button>
    <button class="nav-item" onclick="showSection('distribution',this)">
      <span class="nav-icon">&#9656;</span>
      <span>Distribution</span>
    </button>
    <button class="nav-item" onclick="showSection('trust',this)">
      <span class="nav-icon">&#x1F6E1;</span>
      <span>Trust &amp; Safety</span>
    </button>
    <button class="nav-item" onclick="showSection('platform',this)">
      <span class="nav-icon">&#9634;</span>
      <span>Platform</span>
    </button>
  </nav>
  <div class="sidebar-footer">
    Agent v1.0.0<br>Port ${ADMIN_PORT}
  </div>
</aside>

<!-- ── Main Content ──────────────────────────── -->
<div class="main">
  <div class="topbar">
    <h1><span class="status-dot running" id="topStatusDot"></span> Admin Control Plane</h1>
    <div style="font-size:12px;color:#64748B" id="topUptime"></div>
  </div>

  <div class="content">
    <!-- Toast -->
    <div class="toast" id="toast"></div>

    <!-- ═══════ Section 1: Agent Overview ═══════ -->
    <div class="section visible" id="sec-overview">
      <div class="stat-grid" id="overviewStats"></div>
      <div class="card">
        <h3>Sub-Agent Status</h3>
        <div id="agentList"></div>
      </div>
    </div>

    <!-- ═══════ Section 2: Skills Editor ═══════ -->
    <div class="section" id="sec-skills">
      <div style="display:flex;gap:20px">
        <div style="width:240px;flex-shrink:0">
          <div class="card">
            <h3>Skills</h3>
            <ul class="file-list" id="skillFiles"></ul>
          </div>
          <div class="card">
            <h3>Memory</h3>
            <ul class="file-list" id="memoryFiles"></ul>
          </div>
          <div class="card">
            <h3>Prompt Templates</h3>
            <ul class="file-list" id="templateFiles"></ul>
          </div>
        </div>
        <div style="flex:1">
          <div class="card" id="editorCard" style="display:none">
            <div class="editor-header">
              <div>
                <div class="editor-filename" id="editorFilename"></div>
                <div class="editor-dir" id="editorDir"></div>
              </div>
              <div class="btn-group" style="margin-top:0">
                <button class="btn btn-primary" onclick="saveCurrentFile()">Save</button>
              </div>
            </div>
            <textarea class="editor-area" id="editorArea" spellcheck="false"></textarea>
          </div>
          <div class="card" id="editorPlaceholder">
            <div style="text-align:center;padding:60px 20px;color:#475569">
              <div style="font-size:32px;margin-bottom:12px">&#9998;</div>
              <div style="font-size:14px;font-weight:600;margin-bottom:4px">Select a file to edit</div>
              <div style="font-size:12px">Skills, memory, and prompt templates are editable Markdown files</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════ Section 3: LLM Adapter ═══════ -->
    <div class="section" id="sec-adapter">
      <div class="card">
        <h3>Active LLM Adapter</h3>
        <div class="radio-grid" id="adapterGrid"></div>
      </div>
      <div class="card" id="adapterConfig" style="display:none">
        <h3>Configuration</h3>
        <div class="form-group">
          <label class="form-label" id="apiKeyLabel">API Key</label>
          <input class="form-input" type="password" id="apiKeyInput" placeholder="Enter API key...">
        </div>
        <div class="btn-group">
          <button class="btn btn-primary" onclick="saveAdapter()">Save &amp; Switch</button>
          <button class="btn btn-secondary" onclick="testAdapter()">Test Adapter</button>
        </div>
      </div>
      <div class="card">
        <h3>Test Adapter</h3>
        <div class="form-group">
          <label class="form-label">Prompt</label>
          <input class="form-input" type="text" id="testPrompt" value="What are the key biomarkers for cardiovascular health?" placeholder="Enter a health question...">
        </div>
        <button class="btn btn-secondary" onclick="testAdapter()">Send Test</button>
        <div class="test-response" id="testResponse" style="display:none"></div>
        <div class="test-meta" id="testMeta" style="display:none"></div>
      </div>
    </div>

    <!-- ═══════ Section 4: Webhooks & MCP ═══════ -->
    <div class="section" id="sec-webhooks">
      <div class="card">
        <h3>Webhooks</h3>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input class="form-input" type="url" id="webhookUrlInput" placeholder="https://hooks.slack.com/..." style="flex:1">
          <button class="btn btn-primary" onclick="addWebhook()">Add</button>
        </div>
        <table class="wh-table" id="webhookTable">
          <thead>
            <tr><th>URL</th><th>Events</th><th>Added</th><th></th></tr>
          </thead>
          <tbody id="webhookBody"></tbody>
        </table>
      </div>
      <div class="card">
        <h3>API Keys</h3>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <input class="form-input" type="text" id="apiKeyNameInput" placeholder="Key name (e.g. Mobile App)" style="flex:1">
          <button class="btn btn-primary" onclick="generateApiKey()">Generate</button>
        </div>
        <table class="wh-table">
          <thead>
            <tr><th>Name</th><th>Key</th><th>Created</th><th></th></tr>
          </thead>
          <tbody id="apiKeyBody"></tbody>
        </table>
      </div>
      <div class="card">
        <h3>MCP Connections</h3>
        <div id="mcpList"></div>
      </div>
      <div class="card">
        <h3>Webhook Event Log (Last 50)</h3>
        <div id="webhookLogList" style="max-height:300px;overflow-y:auto">
          <div style="text-align:center;padding:20px;color:#475569;font-size:13px">No events recorded yet</div>
        </div>
      </div>
    </div>

    <!-- ═══════ Section 5: Distribution ═══════ -->
    <div class="section" id="sec-distribution">
      <div class="card">
        <h3>Package Information</h3>
        <div class="stat-grid" id="distStats"></div>
      </div>
      <div class="card">
        <h3>Marketplace Listings</h3>
        <div class="dist-grid" id="distGrid"></div>
      </div>
      <div class="card">
        <h3>Publish</h3>
        <p style="font-size:13px;color:#94A3B8;margin-bottom:12px">Run <code style="background:#0F172A;padding:2px 6px;border-radius:4px;font-size:12px">npm publish --access public</code> to publish the agent to npm.</p>
        <button class="btn btn-primary" onclick="publishPackage()">Publish to npm</button>
        <pre class="test-response" id="publishOutput" style="display:none;margin-top:12px"></pre>
      </div>
    </div>

    <!-- ═══════ Section: Trust & Safety (TrustModel.ai) ═══════ -->
    <div class="section" id="sec-trust">
      <div class="card">
        <h3>&#x1F6E1; TrustModel.ai — AI Trust &amp; Safety Evaluation</h3>
        <p style="color:#94A3B8;font-size:12px;margin-bottom:16px">Evaluate the MHS Agent across 10 trust dimensions. Powered by <a href="https://trustmodel.ai" target="_blank" style="color:#E8751A">trustmodel.ai</a></p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px">
            <div style="font-size:11px;color:#64748B;margin-bottom:4px">API Key</div>
            <input type="password" id="trust-api-key" placeholder="tm-..." style="width:100%;padding:8px;background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:12px;font-family:monospace">
            <div style="font-size:10px;color:#475569;margin-top:4px">Get key at <a href="https://app.trustmodel.ai/settings/api-keys" target="_blank" style="color:#E8751A">app.trustmodel.ai</a></div>
          </div>
          <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px">
            <div style="font-size:11px;color:#64748B;margin-bottom:4px">Evaluation Frequency</div>
            <select id="trust-frequency" style="width:100%;padding:8px;background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-size:12px">
              <option value="manual">Manual Only</option>
              <option value="daily" selected>Daily</option>
              <option value="hourly">Hourly</option>
              <option value="weekly">Weekly</option>
              <option value="realtime">Real-time (every 5 min)</option>
            </select>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn btn-primary" onclick="runTrustEval()">Run Evaluation Now</button>
          <button class="btn btn-secondary" onclick="saveTrustConfig()">Save Config</button>
          <button class="btn btn-secondary" id="trust-toggle-btn" onclick="toggleTrustEval()">Enable</button>
        </div>

        <!-- Score Display -->
        <div id="trust-score-panel" style="display:none;background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:16px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
            <div style="width:64px;height:64px;border-radius:50%;background:#22C55E22;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#22C55E" id="trust-overall-score">--</div>
            <div>
              <div style="font-size:16px;font-weight:700;color:#fff">Overall Trust Score</div>
              <div style="font-size:11px;color:#64748B" id="trust-eval-time">Not evaluated yet</div>
            </div>
          </div>
          <div id="trust-dimensions" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px"></div>
        </div>

        <!-- 10 Trust Dimensions -->
        <div style="margin-bottom:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:8px;font-weight:600">10 EVALUATION DIMENSIONS</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F6E1; Safety</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x2696; Fairness</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F3AF; Accuracy</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F512; Privacy</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F50D; Transparency</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F6E0; Robustness</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F4CB; Accountability</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x1F4A1; Explainability</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x2705; Compliance</div>
            <div style="background:#1E293B;padding:8px;border-radius:6px;text-align:center;font-size:10px;color:#94A3B8">&#x2699; Reliability</div>
          </div>
        </div>

        <!-- Guardrails -->
        <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;font-weight:600">ACTIVE GUARDRAILS</div>
          <div style="font-size:12px;color:#CBD5E1;line-height:1.8">
            &#x2713; No medical diagnosis (only data interpretation)<br>
            &#x2713; Cite data sources for every claim<br>
            &#x2713; No hallucination (zero extrapolation)<br>
            &#x2713; HIPAA compliant (all data local)<br>
            &#x2713; No PII in agent output<br>
            &#x2713; OpenTelemetry tracing (coming soon)
          </div>
        </div>

        <!-- Eval History -->
        <div style="margin-top:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:6px;font-weight:600">EVALUATION HISTORY</div>
          <div id="trust-history" style="font-size:12px;color:#94A3B8">No evaluations yet. Click "Run Evaluation Now" to start.</div>
        </div>
      </div>
    </div>

    <!-- ═══════ Section 6: Platform Integration ═══════ -->
    <div class="section" id="sec-platform">
      <div class="card">
        <h3>Mobile App Endpoints</h3>
        <div id="mobileEndpoints"></div>
      </div>
      <div class="card">
        <h3>Premium Upgrade Path</h3>
        <div id="premiumConfig"></div>
      </div>
      <div class="card">
        <h3>CareHub Connection</h3>
        <div id="careHubStatus"></div>
      </div>
      <div class="card">
        <h3>Shared Data Sync</h3>
        <div id="dataSyncStatus"></div>
      </div>
      <div class="card">
        <h3>&#x1F4B0; Treasury &amp; Payouts</h3>
        <p style="color:#94A3B8;font-size:12px;margin-bottom:12px">Manage XSpan treasury wallet and user USDC payouts from research data contributions.</p>
        <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:4px">Treasury Wallet (Base L2)</div>
          <input type="text" id="treasury-wallet" placeholder="0x... XSpan treasury wallet address" style="width:100%;padding:8px 10px;background:#1E293B;border:1px solid #334155;border-radius:6px;color:#E2E8F0;font-family:monospace;font-size:12px" value="">
          <button class="btn-primary" style="margin-top:8px;font-size:12px;padding:8px 16px" onclick="saveTreasuryWallet()">Save Treasury Wallet</button>
        </div>
        <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:4px">Revenue Split</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#CBD5E1">
            <div>Contributor (user): <strong style="color:#22C55E">50%</strong></div>
            <div>Health System: <strong style="color:#60A5FA">20%</strong></div>
            <div>XSpan: <strong style="color:#E8751A">25%</strong></div>
            <div>Community Fund: <strong style="color:#A78BFA">5%</strong></div>
          </div>
        </div>
        <div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:#64748B;margin-bottom:4px">Payout Queue</div>
          <div id="payout-queue" style="font-size:12px;color:#94A3B8">No pending payouts</div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
// ── No contractions, use var not const/let ──

var currentSection = "overview";
var currentEditFile = null;
var currentEditType = null;
var selectedAdapter = null;

// ── Navigation ──────────────────────────────────

function showSection(id, btn) {
  var sections = document.querySelectorAll(".section");
  for (var i = 0; i < sections.length; i++) {
    sections[i].classList.remove("visible");
  }
  document.getElementById("sec-" + id).classList.add("visible");

  var navItems = document.querySelectorAll(".nav-item");
  for (var j = 0; j < navItems.length; j++) {
    navItems[j].classList.remove("active");
  }
  if (btn) btn.classList.add("active");
  currentSection = id;

  if (id === "overview") loadOverview();
  if (id === "skills") loadSkillsEditor();
  if (id === "adapter") loadAdapters();
  if (id === "webhooks") loadWebhooks();
  if (id === "distribution") loadDistribution();
  if (id === "trust") loadTrustStatus();
  if (id === "platform") loadPlatform();
}

function loadTrustStatus() {
  apiFetch("/api/admin/trust/status").then(function(data) {
    if (data.configured) {
      document.getElementById("trust-api-key").value = "***configured***";
      trustEnabled = data.enabled;
      var btn = document.getElementById("trust-toggle-btn");
      btn.textContent = trustEnabled ? "Disable" : "Enable";
      btn.className = trustEnabled ? "btn btn-danger" : "btn btn-secondary";
      if (data.frequency) {
        document.getElementById("trust-frequency").value = data.frequency;
      }
    }
  }).catch(function() {});
}

// ── Toast ───────────────────────────────────────

function showToast(msg, isError) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast visible" + (isError ? " error" : "");
  setTimeout(function() { t.classList.remove("visible"); }, 3000);
}

// ── API Fetch ───────────────────────────────────

function apiFetch(path, opts) {
  opts = opts || {};
  return fetch(path, opts).then(function(r) { return r.json(); });
}

// ── Section 1: Overview ─────────────────────────

function loadOverview() {
  apiFetch("/api/admin/status").then(function(data) {
    if (!data.ok) return;

    var dot = document.getElementById("topStatusDot");
    dot.className = "status-dot " + (data.agentRunning ? "running" : "stopped");
    document.getElementById("topUptime").textContent = "Uptime: " + data.uptime;

    var statsHtml = "";
    statsHtml += '<div class="stat-tile"><div class="label">Status</div><div class="value accent">' + (data.agentRunning ? "Running" : "Stopped") + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">Uptime</div><div class="value">' + escapeHtml(data.uptime) + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">Connected Sources</div><div class="value accent">' + data.connectedSourcesCount + '</div>';
    statsHtml += '<div class="sub">Wearables: ' + data.sources.wearables + ' | EHR: ' + data.sources.ehr + ' | Labs: ' + data.sources.labs + ' | Genomics: ' + data.sources.genomics + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">Health Samples</div><div class="value">' + data.totalSamples.toLocaleString() + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">Last Sync</div><div class="value" style="font-size:14px">' + (data.lastSync ? formatDate(data.lastSync) : "Never") + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">LLM Adapter</div><div class="value" style="font-size:14px">' + escapeHtml(data.currentAdapter) + '</div></div>';
    document.getElementById("overviewStats").innerHTML = statsHtml;

    var agentHtml = "";
    for (var i = 0; i < data.agents.length; i++) {
      var a = data.agents[i];
      agentHtml += '<div class="agent-row">';
      agentHtml += '<div class="agent-dot ' + escapeHtml(a.status) + '"></div>';
      agentHtml += '<div class="agent-name">' + escapeHtml(a.name) + '</div>';
      agentHtml += '<div class="agent-desc">' + escapeHtml(a.description) + '</div>';
      agentHtml += '<div class="agent-badge ' + escapeHtml(a.status) + '">' + escapeHtml(a.status) + '</div>';
      agentHtml += '</div>';
    }
    document.getElementById("agentList").innerHTML = agentHtml;
  });
}

// ── Section 2: Skills Editor ────────────────────

function loadSkillsEditor() {
  loadFileList("/api/admin/skills", "skillFiles", "skills");
  loadFileList("/api/admin/memory", "memoryFiles", "memory");
  loadFileList("/api/admin/templates", "templateFiles", "templates");
}

function loadFileList(endpoint, containerId, fileType) {
  apiFetch(endpoint).then(function(data) {
    if (!data.ok) return;
    var el = document.getElementById(containerId);
    var html = "";
    for (var i = 0; i < data.files.length; i++) {
      var f = data.files[i];
      var isSelected = (currentEditFile === f && currentEditType === fileType);
      html += '<li class="file-item' + (isSelected ? ' selected' : '') + '" data-fname="' + escapeHtml(f) + '" data-ftype="' + fileType + '" onclick="openFile(this.dataset.fname,this.dataset.ftype)">';
      html += '<span class="file-icon">&#9776;</span>';
      html += escapeHtml(f);
      html += '</li>';
    }
    el.innerHTML = html || '<li style="padding:8px 12px;color:#475569;font-size:12px">No files found</li>';
  });
}

function openFile(name, type) {
  var endpoints = { skills: "/api/admin/skills/", memory: "/api/admin/memory/", templates: "/api/admin/templates/" };
  var dirs = { skills: "src/skills/", memory: "src/memory/", templates: "src/harness/prompt-templates/" };
  var endpoint = endpoints[type] + encodeURIComponent(name);

  apiFetch(endpoint).then(function(data) {
    if (!data.ok) return;
    currentEditFile = name;
    currentEditType = type;
    document.getElementById("editorFilename").textContent = name;
    document.getElementById("editorDir").textContent = dirs[type] + name;
    document.getElementById("editorArea").value = data.content;
    document.getElementById("editorCard").style.display = "block";
    document.getElementById("editorPlaceholder").style.display = "none";

    // Refresh file lists to show selection
    loadSkillsEditor();
  });
}

function saveCurrentFile() {
  if (!currentEditFile || !currentEditType) return;
  var endpoints = { skills: "/api/admin/skills/", memory: "/api/admin/memory/", templates: "/api/admin/templates/" };
  var endpoint = endpoints[currentEditType] + encodeURIComponent(currentEditFile);
  var content = document.getElementById("editorArea").value;

  apiFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content }),
  }).then(function(data) {
    if (data.ok) {
      showToast("Saved " + currentEditFile);
    } else {
      showToast("Failed to save: " + (data.error || "Unknown error"), true);
    }
  });
}

// ── Section 3: LLM Adapter ─────────────────────

function loadAdapters() {
  apiFetch("/api/admin/adapters").then(function(data) {
    if (!data.ok) return;
    var html = "";
    for (var i = 0; i < data.adapters.length; i++) {
      var a = data.adapters[i];
      var isActive = a.active;
      var isSelected = selectedAdapter === a.id || (!selectedAdapter && isActive);
      html += '<div class="radio-card' + (isSelected ? ' selected' : '') + '" data-adapter="' + escapeHtml(a.id) + '" onclick="selectAdapter(this.dataset.adapter)">';
      html += '<div class="rc-name">' + escapeHtml(a.name) + '</div>';
      if (a.model) html += '<div class="rc-model">Model: ' + escapeHtml(a.model) + '</div>';
      if (isActive) {
        html += '<div class="rc-status active">Active</div>';
      } else if (a.configured) {
        html += '<div class="rc-status configured">Configured</div>';
      } else {
        html += '<div class="rc-status not-configured">Not Configured</div>';
      }
      if (a.keyMasked) {
        html += '<div style="font-size:10px;color:#475569;margin-top:2px">Key: ' + escapeHtml(a.keyMasked) + '</div>';
      }
      html += '</div>';
    }
    document.getElementById("adapterGrid").innerHTML = html;

    // Show config panel if a non-rule-based adapter is selected
    var sel = selectedAdapter || data.current;
    if (sel && sel !== "rule-based") {
      document.getElementById("adapterConfig").style.display = "block";
      var def = data.adapters.find(function(a) { return a.id === sel; });
      if (def) {
        document.getElementById("apiKeyLabel").textContent = def.name + " API Key";
      }
    } else {
      document.getElementById("adapterConfig").style.display = "none";
    }
  });
}

function selectAdapter(id) {
  selectedAdapter = id;
  var cards = document.querySelectorAll(".radio-card");
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.remove("selected");
    if (cards[i].getAttribute("data-adapter") === id) {
      cards[i].classList.add("selected");
    }
  }
  if (id === "rule-based") {
    document.getElementById("adapterConfig").style.display = "none";
  } else {
    document.getElementById("adapterConfig").style.display = "block";
  }
}

function saveAdapter() {
  if (!selectedAdapter) return;
  var apiKey = document.getElementById("apiKeyInput").value;
  apiFetch("/api/admin/adapters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adapter: selectedAdapter, apiKey: apiKey }),
  }).then(function(data) {
    if (data.ok) {
      showToast("Adapter switched to " + selectedAdapter + ". Restart agent to apply.");
      document.getElementById("apiKeyInput").value = "";
      loadAdapters();
    } else {
      showToast(data.error || "Failed to save adapter", true);
    }
  });
}

function testAdapter() {
  var prompt = document.getElementById("testPrompt").value;
  var respEl = document.getElementById("testResponse");
  var metaEl = document.getElementById("testMeta");
  respEl.style.display = "block";
  respEl.textContent = "Testing...";
  metaEl.style.display = "none";

  apiFetch("/api/admin/test-adapter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt }),
  }).then(function(data) {
    if (data.ok) {
      respEl.textContent = data.response;
      metaEl.style.display = "block";
      metaEl.textContent = "Adapter: " + data.adapter + " | Latency: " + data.latency + "ms";
    } else {
      respEl.textContent = "Error: " + (data.error || "Unknown error");
    }
  }).catch(function(err) {
    respEl.textContent = "Network error: " + err;
  });
}

// ── Section 4: Webhooks & MCP ───────────────────

function loadWebhooks() {
  apiFetch("/api/admin/webhooks").then(function(data) {
    if (!data.ok) return;
    var body = document.getElementById("webhookBody");
    var html = "";
    for (var i = 0; i < data.webhooks.length; i++) {
      var w = data.webhooks[i];
      html += "<tr>";
      html += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(w.url) + "</td>";
      html += "<td>" + escapeHtml(w.events.join(", ")) + "</td>";
      html += "<td>" + formatDate(w.addedAt) + "</td>";
      html += '<td><button class="btn btn-danger btn-sm" data-wid="' + escapeHtml(w.id) + '" onclick="removeWebhook(this.dataset.wid)">Remove</button></td>';
      html += "</tr>";
    }
    body.innerHTML = html || '<tr><td colspan="4" style="text-align:center;color:#475569;padding:16px">No webhooks configured</td></tr>';

    // Webhook log
    var logEl = document.getElementById("webhookLogList");
    if (data.log && data.log.length > 0) {
      var logHtml = "";
      for (var j = 0; j < data.log.length; j++) {
        var l = data.log[j];
        logHtml += '<div class="log-entry">';
        logHtml += '<span class="log-time">' + formatDate(l.timestamp) + '</span>';
        logHtml += '<span class="log-type ' + (l.status < 400 ? 'success' : 'error') + '">' + l.status + '</span>';
        logHtml += escapeHtml(l.event) + " -> " + escapeHtml(l.webhookId);
        logHtml += '</div>';
      }
      logEl.innerHTML = logHtml;
    }
  });

  loadApiKeys();
  loadMcp();
}

function addWebhook() {
  var url = document.getElementById("webhookUrlInput").value.trim();
  if (!url) return;
  apiFetch("/api/admin/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url }),
  }).then(function(data) {
    if (data.ok) {
      showToast("Webhook added");
      document.getElementById("webhookUrlInput").value = "";
      loadWebhooks();
    } else {
      showToast(data.error || "Failed to add webhook", true);
    }
  });
}

function removeWebhook(id) {
  apiFetch("/api/admin/webhooks", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: id }),
  }).then(function(data) {
    if (data.ok) {
      showToast("Webhook removed");
      loadWebhooks();
    }
  });
}

function loadApiKeys() {
  apiFetch("/api/admin/api-keys").then(function(data) {
    if (!data.ok) return;
    var body = document.getElementById("apiKeyBody");
    var html = "";
    for (var i = 0; i < data.keys.length; i++) {
      var k = data.keys[i];
      html += "<tr>";
      html += "<td>" + escapeHtml(k.name) + "</td>";
      html += '<td><code style="background:#0F172A;padding:2px 6px;border-radius:4px;font-size:11px">' + escapeHtml(k.keyMasked) + "</code></td>";
      html += "<td>" + formatDate(k.createdAt) + "</td>";
      html += '<td><button class="btn btn-danger btn-sm" data-kid="' + escapeHtml(k.id) + '" onclick="revokeApiKey(this.dataset.kid)">Revoke</button></td>';
      html += "</tr>";
    }
    body.innerHTML = html || '<tr><td colspan="4" style="text-align:center;color:#475569;padding:16px">No API keys generated</td></tr>';
  });
}

function generateApiKey() {
  var name = document.getElementById("apiKeyNameInput").value.trim() || "Unnamed Key";
  apiFetch("/api/admin/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name }),
  }).then(function(data) {
    if (data.ok) {
      showToast("API key generated: " + data.apiKey.key);
      document.getElementById("apiKeyNameInput").value = "";
      loadApiKeys();
    }
  });
}

function revokeApiKey(id) {
  apiFetch("/api/admin/api-keys", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: id }),
  }).then(function(data) {
    if (data.ok) {
      showToast("API key revoked");
      loadApiKeys();
    }
  });
}

function loadMcp() {
  apiFetch("/api/admin/mcp").then(function(data) {
    if (!data.ok) return;
    var html = "";
    html += '<div style="margin-bottom:10px;font-size:12px;color:#94A3B8">Transport: <strong style="color:#E2E8F0">' + escapeHtml(data.transport) + '</strong> | Port: <strong style="color:#E2E8F0">' + escapeHtml(data.port) + '</strong></div>';
    for (var i = 0; i < data.connections.length; i++) {
      var c = data.connections[i];
      html += '<div class="agent-row">';
      html += '<div class="agent-dot ' + (c.status === "configured" ? "active" : "idle") + '"></div>';
      html += '<div class="agent-name">' + escapeHtml(c.name) + '</div>';
      html += '<div class="agent-desc">Transport: ' + escapeHtml(c.transport) + '</div>';
      html += '<div class="agent-badge ' + (c.status === "configured" ? "active" : "idle") + '">' + escapeHtml(c.status) + '</div>';
      html += '</div>';
    }
    document.getElementById("mcpList").innerHTML = html;
  });
}

// ── Section 5: Distribution ─────────────────────

function loadDistribution() {
  apiFetch("/api/admin/distribution").then(function(data) {
    if (!data.ok) return;

    var statsHtml = "";
    statsHtml += '<div class="stat-tile"><div class="label">Package Name</div><div class="value" style="font-size:14px">' + escapeHtml(data.name) + '</div></div>';
    statsHtml += '<div class="stat-tile"><div class="label">Version</div><div class="value accent">' + escapeHtml(data.version) + '</div></div>';
    document.getElementById("distStats").innerHTML = statsHtml;

    var gridHtml = "";
    gridHtml += '<div class="dist-card">';
    gridHtml += '<div class="dist-name">npm Registry</div>';
    gridHtml += '<div class="dist-status ' + (data.npmPublished ? "published" : "not-published") + '">' + (data.npmPublished ? "Published" : "Not Published") + '</div>';
    gridHtml += '<a href="' + escapeHtml(data.links.npm) + '" target="_blank">View on npm</a>';
    gridHtml += '</div>';

    gridHtml += '<div class="dist-card">';
    gridHtml += '<div class="dist-name">OpenClaw</div>';
    gridHtml += '<div class="dist-status ' + (data.openClawListed ? "published" : "not-published") + '">' + (data.openClawListed ? "Listed" : "Not Listed") + '</div>';
    gridHtml += '<a href="' + escapeHtml(data.links.openclaw) + '" target="_blank">View on OpenClaw</a>';
    gridHtml += '</div>';

    gridHtml += '<div class="dist-card">';
    gridHtml += '<div class="dist-name">GitHub Marketplace</div>';
    gridHtml += '<div class="dist-status ' + (data.githubMarketplace ? "published" : "not-published") + '">' + (data.githubMarketplace ? "Listed" : "Not Listed") + '</div>';
    gridHtml += '<a href="' + escapeHtml(data.links.github) + '" target="_blank">View on GitHub</a>';
    gridHtml += '</div>';

    document.getElementById("distGrid").innerHTML = gridHtml;
  });
}

function publishPackage() {
  var output = document.getElementById("publishOutput");
  output.style.display = "block";
  output.textContent = "Publishing...";

  apiFetch("/api/admin/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }).then(function(data) {
    if (data.ok) {
      output.textContent = data.stdout || "Published successfully.";
      showToast("Published to npm");
    } else {
      output.textContent = "Error:\\n" + (data.stderr || data.stdout || "Unknown error");
      showToast("Publish failed", true);
    }
  }).catch(function(err) {
    output.textContent = "Network error: " + err;
  });
}

// ── Section 6: Platform ─────────────────────────

function loadPlatform() {
  apiFetch("/api/admin/platform").then(function(data) {
    if (!data.ok) return;

    // Mobile
    var mobileHtml = "";
    mobileHtml += '<div class="agent-row">';
    mobileHtml += '<div class="agent-dot active"></div>';
    mobileHtml += '<div class="agent-name">iOS App</div>';
    mobileHtml += '<div class="agent-desc">' + escapeHtml(data.mobile.iosUrl) + '</div>';
    mobileHtml += '<div class="agent-badge active">Configured</div>';
    mobileHtml += '</div>';
    mobileHtml += '<div class="agent-row">';
    mobileHtml += '<div class="agent-dot active"></div>';
    mobileHtml += '<div class="agent-name">Android App</div>';
    mobileHtml += '<div class="agent-desc">' + escapeHtml(data.mobile.androidUrl) + '</div>';
    mobileHtml += '<div class="agent-badge active">Configured</div>';
    mobileHtml += '</div>';
    document.getElementById("mobileEndpoints").innerHTML = mobileHtml;

    // Premium
    var premiumHtml = "";
    premiumHtml += '<div class="stat-grid">';
    premiumHtml += '<div class="stat-tile"><div class="label">Current Tier</div><div class="value accent">' + escapeHtml(data.premium.tier) + '</div></div>';
    premiumHtml += '<div class="stat-tile"><div class="label">Upgrade URL</div><div class="value" style="font-size:12px"><a href="' + escapeHtml(data.premium.upgradeUrl) + '" target="_blank">' + escapeHtml(data.premium.upgradeUrl) + '</a></div></div>';
    premiumHtml += '</div>';
    document.getElementById("premiumConfig").innerHTML = premiumHtml;

    // CareHub
    var careHtml = "";
    careHtml += '<div class="agent-row">';
    careHtml += '<div class="agent-dot ' + (data.careHub.status === "connected" ? "active" : "idle") + '"></div>';
    careHtml += '<div class="agent-name">CareHub API</div>';
    careHtml += '<div class="agent-desc">' + escapeHtml(data.careHub.endpoint) + '</div>';
    careHtml += '<div class="agent-badge ' + (data.careHub.status === "connected" ? "active" : "idle") + '">' + escapeHtml(data.careHub.status) + '</div>';
    careHtml += '</div>';
    document.getElementById("careHubStatus").innerHTML = careHtml;

    // Data Sync
    var syncHtml = "";
    syncHtml += '<div class="stat-grid">';
    syncHtml += '<div class="stat-tile"><div class="label">Cloud Sync</div><div class="value">' + (data.dataSync.cloudSyncEnabled ? "Enabled" : "Disabled") + '</div></div>';
    syncHtml += '<div class="stat-tile"><div class="label">Interval</div><div class="value">' + data.dataSync.intervalMinutes + ' min</div></div>';
    syncHtml += '<div class="stat-tile"><div class="label">Last Sync</div><div class="value" style="font-size:14px">' + (data.dataSync.lastSync ? formatDate(data.dataSync.lastSync) : "Never") + '</div></div>';
    syncHtml += '</div>';
    document.getElementById("dataSyncStatus").innerHTML = syncHtml;
  });
}

// ── Trust & Safety ──────────────────────────────

var trustEnabled = false;

function runTrustEval() {
  var scorePanel = document.getElementById("trust-score-panel");
  scorePanel.style.display = "block";
  document.getElementById("trust-overall-score").textContent = "...";
  document.getElementById("trust-eval-time").textContent = "Evaluating...";

  apiFetch("/api/admin/trust/evaluate", { method: "POST" })
    .then(function(data) {
      if (data.success && data.score) {
        var s = data.score;
        var scoreEl = document.getElementById("trust-overall-score");
        scoreEl.textContent = Math.round(s.overall);
        scoreEl.style.color = s.overall >= 75 ? "#22C55E" : s.overall >= 50 ? "#FBBF24" : "#EF4444";
        scoreEl.style.background = (s.overall >= 75 ? "#22C55E" : s.overall >= 50 ? "#FBBF24" : "#EF4444") + "22";
        document.getElementById("trust-eval-time").textContent = "Evaluated: " + new Date(s.evaluatedAt).toLocaleString();

        // Show dimension scores
        var dimEl = document.getElementById("trust-dimensions");
        var html = "";
        for (var dim in s.dimensions) {
          var val = s.dimensions[dim];
          var col = val >= 75 ? "#22C55E" : val >= 50 ? "#FBBF24" : "#EF4444";
          html += '<div style="background:#1E293B;padding:6px;border-radius:4px;text-align:center">';
          html += '<div style="font-size:16px;font-weight:700;color:' + col + '">' + Math.round(val) + '</div>';
          html += '<div style="font-size:9px;color:#64748B">' + dim + '</div>';
          html += '</div>';
        }
        dimEl.innerHTML = html;
      } else {
        document.getElementById("trust-overall-score").textContent = "N/A";
        document.getElementById("trust-eval-time").textContent = data.error || "Evaluation failed — check API key";
      }
    })
    .catch(function() {
      document.getElementById("trust-overall-score").textContent = "ERR";
      document.getElementById("trust-eval-time").textContent = "Network error";
    });
}

function saveTrustConfig() {
  var apiKey = document.getElementById("trust-api-key").value;
  var frequency = document.getElementById("trust-frequency").value;
  apiFetch("/api/admin/trust/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: apiKey, frequency: frequency, enabled: trustEnabled })
  }).then(function() {
    alert("TrustModel config saved");
  });
}

function toggleTrustEval() {
  trustEnabled = !trustEnabled;
  var btn = document.getElementById("trust-toggle-btn");
  btn.textContent = trustEnabled ? "Disable" : "Enable";
  btn.className = trustEnabled ? "btn btn-danger" : "btn btn-secondary";
}

// ── Treasury ────────────────────────────────────

function saveTreasuryWallet() {
  var addr = document.getElementById("treasury-wallet").value.trim();
  if (!addr || !addr.startsWith("0x")) {
    alert("Enter a valid wallet address starting with 0x");
    return;
  }
  apiFetch("/api/admin/adapters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "TREASURY_WALLET", value: addr })
  }).then(function() {
    alert("Treasury wallet saved: " + addr.substring(0, 6) + "..." + addr.substring(addr.length - 4));
  });
}

// ── Utilities ───────────────────────────────────

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(isoStr) {
  if (!isoStr) return "N/A";
  try {
    var d = new Date(isoStr);
    var now = new Date();
    var diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + " min ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " hr ago";
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return String(isoStr);
  }
}

// ── Init ────────────────────────────────────────

loadOverview();
</script>
</body>
</html>`;
}

// ── Server ───────────────────────────────────────────────────

async function startAdmin(): Promise<void> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = routePath(req.url || '/');

    // API routes
    if (path.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }

    // Serve static assets
    if (path.startsWith('/assets/')) {
      const assetPath = join(PROJECT_ROOT, path);
      if (existsSync(assetPath)) {
        const ext = path.split('.').pop() || '';
        const mimeTypes: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          svg: 'image/svg+xml',
          ico: 'image/x-icon',
          gif: 'image/gif',
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(readFileSync(assetPath));
        return;
      }
    }

    // Serve the admin SPA
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAdminPage());
  });

  server.listen(ADMIN_PORT, () => {
    console.log(`[Admin] MyHealthSpan Admin Dashboard running at http://localhost:${ADMIN_PORT}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Admin] Shutting down...');
    store.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startAdmin().catch((err) => {
  console.error('[Admin] Fatal error:', err);
  process.exit(1);
});
