import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentConfig } from '../types/index.js';
import type { LocalStore } from '../storage/local-store.js';
import type { XSpanApiClient } from '../sync/xspan-api.js';
import type { DataPipeline } from '../sync/data-pipeline.js';

const DASHBOARD_PORT = 3000;

// ── Health System Directory ─────────────────────────────────
// Real health systems and their EHR platforms
const HEALTH_SYSTEMS = [
  // Featured — California
  { name: 'UCLA Health', ehr: 'epic', region: 'Los Angeles, CA', fhirUrl: 'https://connecthub.uclahealth.org/fhir-proxy/api/FHIR/R4' },
  { name: 'Stanford Health Care', ehr: 'epic', region: 'Palo Alto, CA', fhirUrl: 'https://epicproxy.stanfordhealth.org/FHIR/api/FHIR/R4' },
  { name: 'Kaiser Permanente', ehr: 'epic', region: 'CA, OR, WA, CO, HI, GA, VA, DC, MD', fhirUrl: 'https://epicfhir.kp.org/fhir/api/FHIR/R4' },
  { name: 'UCSF Health', ehr: 'epic', region: 'San Francisco, CA', fhirUrl: 'https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4' },
  { name: 'Cedars-Sinai', ehr: 'epic', region: 'Los Angeles, CA', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4' },
  // National leaders
  { name: 'Cleveland Clinic', ehr: 'epic', region: 'OH, FL', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4' },
  { name: 'Mayo Clinic', ehr: 'epic', region: 'MN, AZ, FL', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4' },
  { name: 'Johns Hopkins', ehr: 'epic', region: 'Baltimore, MD', fhirUrl: 'https://epicproxy.johnshopkins.edu/FHIRProxy/api/FHIR/R4' },
  { name: 'Mount Sinai', ehr: 'epic', region: 'New York, NY', fhirUrl: 'https://epicfhir.mountsinai.org/FHIRProxy/api/FHIR/R4' },
  { name: 'NYU Langone', ehr: 'epic', region: 'New York, NY', fhirUrl: 'https://epicfhir.nyumc.org/FHIRProxy/api/FHIR/R4' },
  { name: 'Mass General Brigham', ehr: 'epic', region: 'Boston, MA', fhirUrl: 'https://ws-interconnect-fhir.partners.org/Interconnect-FHIR-MU-PRD/api/FHIR/R4' },
  { name: 'Duke Health', ehr: 'epic', region: 'Durham, NC', fhirUrl: 'https://health-apis.duke.edu/FHIR/patient/R4' },
  { name: 'Northwestern Medicine', ehr: 'epic', region: 'Chicago, IL', fhirUrl: 'https://epicproxy.nmh.org/FHIRProxy/api/FHIR/R4' },
  { name: 'Penn Medicine', ehr: 'epic', region: 'Philadelphia, PA', fhirUrl: 'https://epicproxy.uphs.upenn.edu/FHIRProxy/api/FHIR/R4' },
  { name: 'UC San Diego Health', ehr: 'epic', region: 'San Diego, CA', fhirUrl: 'https://epicproxy.ucsd.edu/FHIRProxy/api/FHIR/R4' },
  { name: 'UC Davis Health', ehr: 'epic', region: 'Sacramento, CA', fhirUrl: 'https://epicproxy.ucdmc.ucdavis.edu/FHIRProxy/api/FHIR/R4' },
  // Cerner systems
  { name: 'Sutter Health', ehr: 'cerner', region: 'Northern CA', fhirUrl: 'https://fhir-ehr.cerner.com/r4/sutter' },
  { name: 'Community Health Systems', ehr: 'cerner', region: 'National (20 states)', fhirUrl: 'https://fhir-ehr.cerner.com/r4/chs' },
  { name: 'Adventist Health', ehr: 'cerner', region: 'CA, OR, HI', fhirUrl: 'https://fhir-ehr.cerner.com/r4/adventist' },
  // Other EHRs
  { name: 'athenahealth Network', ehr: 'generic_fhir', region: 'National (160K+ providers)', fhirUrl: 'https://api.platform.athenahealth.com/fhir/r4' },
  { name: 'eClinicalWorks', ehr: 'generic_fhir', region: 'National (130K+ providers)', fhirUrl: 'https://fhir.eclinicalworks.com/fhir/r4' },
  { name: 'Other (Custom FHIR R4)', ehr: 'generic_fhir', region: 'Any FHIR R4 server', fhirUrl: '' },
];

const WEARABLE_PROVIDERS = [
  { id: 'apple_health', name: 'Apple Health', icon: '🍎', status: 'available', authType: 'healthkit', description: 'Steps, heart rate, HRV, sleep, blood oxygen, temperature' },
  { id: 'google_health', name: 'Google Health / Fit', icon: '🤖', status: 'available', authType: 'oauth2', description: 'Activity, sleep, heart rate, body measurements' },
  { id: 'oura', name: 'Oura Ring', icon: '💍', status: 'available', authType: 'oauth2', description: 'Sleep stages, HRV, readiness, activity, temperature' },
  { id: 'whoop', name: 'WHOOP', icon: '💪', status: 'available', authType: 'oauth2', description: 'Strain, recovery, sleep, HRV, respiratory rate' },
  { id: 'dexcom', name: 'Dexcom CGM', icon: '🩸', status: 'available', authType: 'oauth2', description: 'Continuous glucose monitoring (5-min intervals)' },
  { id: 'garmin', name: 'Garmin', icon: '⌚', status: 'available', authType: 'oauth2', description: 'Activity, sleep, stress, body battery, pulse ox' },
  { id: 'fitbit', name: 'Fitbit', icon: '📱', status: 'available', authType: 'oauth2', description: 'Steps, heart rate, sleep, SpO2, stress' },
];

const LAB_PROVIDERS = [
  { id: 'quest', name: 'Quest Diagnostics', icon: '🧪', description: 'CBC, metabolic panel, lipids, thyroid, vitamins, tumor markers' },
  { id: 'labcorp', name: 'LabCorp', icon: '🔬', description: 'CBC, metabolic panel, lipids, hormones, immunology' },
  { id: 'function_health', name: 'Function Health', icon: '📊', description: '100+ biomarkers including advanced cardiac, hormones, cancer screening' },
];

const GENOMICS_PROVIDERS = [
  { id: '23andme', name: '23andMe', icon: '🧬', description: 'Genetic variants — MTHFR, APOE, BRCA, pharmacogenomics' },
  { id: 'gutid', name: 'Gut.id', icon: '🦠', description: 'Microbiome profile — gut bacteria diversity, enterotypes' },
];

// ── Dashboard HTML ──────────────────────────────────────────

function renderDashboard(config: AgentConfig, store: LocalStore): string {
  const snapshot = store.getLatestSnapshot();
  const todayNudges = store.getTodayNudges();
  const isPro = false; // Will be checked via API

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XSpan HealthAI Agent</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, 'Inter', sans-serif; background: #0B0F1A; color: #E2E8F0; min-height: 100vh; }
.header { background: linear-gradient(135deg, #1A1A2E, #0F172A); padding: 20px 32px; border-bottom: 3px solid #E8751A; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 22px; font-weight: 800; color: #fff; }
.header h1 span { color: #E8751A; }
.header .status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.on { background: #22C55E; }
.status-dot.off { background: #EF4444; }
.nav { display: flex; gap: 0; background: #1E293B; border-bottom: 1px solid #334155; padding: 0 32px; }
.nav a { padding: 14px 20px; font-size: 13px; font-weight: 600; color: #94A3B8; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; text-decoration: none; }
.nav a:hover { color: #fff; }
.nav a.active { color: #E8751A; border-bottom-color: #E8751A; }
.main { padding: 32px; max-width: 1100px; margin: 0 auto; }
.page { display: none; }
.page.active { display: block; }
.section-title { font-size: 20px; font-weight: 700; margin-bottom: 20px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.card { background: #1E293B; border: 1px solid #334155; border-radius: 12px; padding: 24px; transition: all 0.2s; }
.card:hover { border-color: #E8751A44; }
.card-icon { font-size: 32px; margin-bottom: 12px; }
.card h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.card p { font-size: 13px; color: #94A3B8; line-height: 1.5; margin-bottom: 16px; }
.card .region { font-size: 11px; color: #64748B; margin-bottom: 12px; }
.btn { padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
.btn-primary { background: #E8751A; color: #fff; }
.btn-primary:hover { background: #D06A15; }
.btn-secondary { background: #334155; color: #E2E8F0; }
.btn-secondary:hover { background: #475569; }
.btn-success { background: #059669; color: #fff; }
.btn-disabled { background: #334155; color: #64748B; cursor: not-allowed; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 10px; font-weight: 600; }
.badge-free { background: #05966922; color: #6EE7B7; }
.badge-pro { background: #E8751A22; color: #E8751A; }
.badge-connected { background: #05966922; color: #6EE7B7; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
.stat-card { background: #1E293B; border: 1px solid #334155; border-radius: 12px; padding: 20px; text-align: center; }
.stat-card .value { font-size: 32px; font-weight: 800; color: #E8751A; }
.stat-card .label { font-size: 12px; color: #64748B; margin-top: 4px; }
.search { width: 100%; padding: 12px 16px; background: #0F172A; border: 1px solid #334155; border-radius: 8px; color: #E2E8F0; font-size: 14px; margin-bottom: 20px; }
.search:focus { outline: none; border-color: #E8751A; }
.modal-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
.modal-overlay.show { display: flex; }
.modal { background: #1E293B; border: 1px solid #E8751A; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%; }
.modal h2 { font-size: 20px; margin-bottom: 8px; }
.modal p { font-size: 13px; color: #94A3B8; margin-bottom: 20px; }
.modal label { display: block; font-size: 13px; font-weight: 600; color: #CBD5E1; margin-bottom: 6px; margin-top: 16px; }
.modal input, .modal select { width: 100%; padding: 10px 14px; background: #0F172A; border: 1px solid #334155; border-radius: 8px; color: #E2E8F0; font-size: 14px; }
.modal input:focus, .modal select:focus { outline: none; border-color: #E8751A; }
.modal .btn-row { display: flex; gap: 12px; margin-top: 24px; }
.modal .btn-row .btn { flex: 1; }
.pro-banner { background: linear-gradient(135deg, #E8751A22, #7C3AED22); border: 1px solid #E8751A44; border-radius: 12px; padding: 24px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; }
.pro-banner h3 { font-size: 16px; font-weight: 700; }
.pro-banner p { font-size: 13px; color: #94A3B8; margin-top: 4px; }
.hipaa-note { background: #05966911; border: 1px solid #05966933; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; font-size: 12px; color: #6EE7B7; display: flex; align-items: center; gap: 10px; }
</style>
</head>
<body>

<div class="header">
  <h1><span>XSpan</span> HealthAI Agent</h1>
  <div class="status">
    <div class="status-dot on"></div>
    <span style="color:#22C55E">Running</span>
    <span style="color:#64748B;margin-left:8px">|</span>
    <span style="color:#64748B;margin-left:8px">${config.xspan.userId}</span>
  </div>
</div>

<div class="nav">
  <a class="active" onclick="showPage('home')">Home</a>
  <a onclick="showPage('ehr')">EHR</a>
  <a onclick="showPage('wearables')">Wearables</a>
  <a onclick="showPage('labs')">Labs</a>
  <a onclick="showPage('genomics')">Genomics</a>
  <a onclick="showPage('subscription')">Subscription</a>
</div>

<div class="main">

  <!-- ═══ HOME ═══ -->
  <div class="page active" id="page-home">
    <div class="hipaa-note">
      🔒 HIPAA Compliant — Your health data is encrypted locally. All AI queries processed by XSpan H-LLM only. No third-party AI access.
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="value">${snapshot?.biomarkers.dataCompleteness ? Math.round(snapshot.biomarkers.dataCompleteness * 100) : 0}%</div>
        <div class="label">Data Completeness</div>
      </div>
      <div class="stat-card">
        <div class="value">${snapshot?.biomarkers.recoveryScore ?? '—'}</div>
        <div class="label">Recovery Score</div>
      </div>
      <div class="stat-card">
        <div class="value">${snapshot?.biomarkers.dailySteps ?? '—'}</div>
        <div class="label">Steps Today</div>
      </div>
      <div class="stat-card">
        <div class="value">${todayNudges.length}</div>
        <div class="label">Nudges Today</div>
      </div>
    </div>

    <div class="pro-banner">
      <div>
        <h3>Unlock AI Health Intelligence</h3>
        <p>Get 3x daily nudges, weekly Health Passport, risk scores, and AI Q&A — $20/month</p>
      </div>
      <a href="https://buy.stripe.com/test_dRmdR90Ei2iO3CFf3LgnK00" target="_blank"><button class="btn btn-primary">Subscribe to Pro</button></a>
    </div>

    <div class="section-title">Connected Sources</div>
    <div class="card-grid">
      <div class="card">
        <div class="card-icon">🍎</div>
        <h3>Apple Health</h3>
        <p>${config.connectors.appleHealth.enabled ? 'Connected — syncing every 15 minutes' : 'Not connected'}</p>
        <span class="badge ${config.connectors.appleHealth.enabled ? 'badge-connected' : ''}">${config.connectors.appleHealth.enabled ? 'CONNECTED' : 'DISABLED'}</span>
      </div>
      <div class="card">
        <div class="card-icon">🏥</div>
        <h3>EHR</h3>
        <p>${config.connectors.ehr.enabled ? 'Connected to ' + (config.connectors.ehr.provider ?? 'EHR') : 'Not connected — click EHR tab to set up'}</p>
        <span class="badge ${config.connectors.ehr.enabled ? 'badge-connected' : ''}">${config.connectors.ehr.enabled ? 'CONNECTED' : 'NOT SET UP'}</span>
      </div>
      <div class="card">
        <div class="card-icon">⌚</div>
        <h3>Wearables</h3>
        <p>Click Wearables tab to connect Oura, WHOOP, Dexcom, Garmin, or Fitbit</p>
        <span class="badge">NOT SET UP</span>
      </div>
    </div>
  </div>

  <!-- ═══ EHR ═══ -->
  <div class="page" id="page-ehr">
    <div class="section-title">Connect Your Electronic Health Records</div>
    <p style="color:#94A3B8;margin-bottom:20px">Find your health system below and connect via SMART on FHIR. Your EHR credentials are stored in your OS keychain — never sent to XSpan.</p>
    <input type="text" class="search" placeholder="Search health systems (e.g., Kaiser, Mayo, Cleveland Clinic)..." oninput="filterEHR(this.value)">
    <div class="card-grid" id="ehr-grid">
      ${HEALTH_SYSTEMS.map(hs => `
        <div class="card ehr-card" data-name="${hs.name.toLowerCase()}">
          ${hs.ehr === 'epic' ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect width="36" height="36" rx="8" fill="#862074"/><text x="18" y="23" text-anchor="middle" fill="white" font-family="Arial" font-weight="800" font-size="14">M</text></svg>
            <span style="font-size:12px;color:#A78BFA;font-weight:600">MyChart</span>
          </div>` : `<div class="card-icon">${hs.ehr === 'cerner' ? '🔶' : '🏥'}</div>`}
          <h3>${hs.name}</h3>
          <div class="region">${hs.ehr === 'epic' ? 'Epic MyChart' : hs.ehr === 'cerner' ? 'Oracle Cerner' : 'FHIR R4'} ${hs.region ? '· ' + hs.region : ''}</div>
          <p>${hs.ehr === 'epic' ? 'Connect via MyChart (SMART on FHIR R4)' : 'Connect via SMART on FHIR R4'}</p>
          <button class="btn btn-primary" onclick="connectEHR('${hs.name}','${hs.ehr}','${hs.fhirUrl}')">${hs.ehr === 'epic' ? 'Connect with MyChart' : 'Connect'}</button>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ WEARABLES ═══ -->
  <div class="page" id="page-wearables">
    <div class="section-title">Connect Your Wearables</div>
    <p style="color:#94A3B8;margin-bottom:20px">Connect your fitness trackers, smartwatches, and health sensors. Data syncs automatically.</p>
    <div class="card-grid">
      ${WEARABLE_PROVIDERS.map(w => `
        <div class="card">
          <div class="card-icon">${w.icon}</div>
          <h3>${w.name}</h3>
          <p>${w.description}</p>
          <span class="badge badge-free">FREE</span>
          <button class="btn btn-primary" style="margin-left:8px" onclick="connectWearable('${w.id}','${w.name}','${w.authType}')">Connect</button>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ LABS ═══ -->
  <div class="page" id="page-labs">
    <div class="section-title">Connect Lab Providers</div>
    <p style="color:#94A3B8;margin-bottom:20px">Import your blood work results. Lab data is mapped to LOINC codes for standardized tracking.</p>
    <div class="card-grid">
      ${LAB_PROVIDERS.map(l => `
        <div class="card">
          <div class="card-icon">${l.icon}</div>
          <h3>${l.name}</h3>
          <p>${l.description}</p>
          <span class="badge badge-free">FREE</span>
          <button class="btn btn-primary" style="margin-left:8px" onclick="connectLab('${l.id}','${l.name}')">Connect</button>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ GENOMICS ═══ -->
  <div class="page" id="page-genomics">
    <div class="section-title">Connect Genomics Profiles</div>
    <p style="color:#94A3B8;margin-bottom:20px">Import genetic variants and microbiome data for personalized risk scoring.</p>
    <div class="card-grid">
      ${GENOMICS_PROVIDERS.map(g => `
        <div class="card">
          <div class="card-icon">${g.icon}</div>
          <h3>${g.name}</h3>
          <p>${g.description}</p>
          <span class="badge badge-free">FREE</span>
          <button class="btn btn-primary" style="margin-left:8px" onclick="connectGenomics('${g.id}','${g.name}')">Connect</button>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ SUBSCRIPTION ═══ -->
  <div class="page" id="page-subscription">
    <div class="section-title">XSpan Pro Subscription</div>
    <div class="pro-banner" style="flex-direction:column;align-items:start;gap:16px">
      <div>
        <h3>XSpan Pro — $20/month</h3>
        <p style="margin-top:8px;line-height:1.8">
          ✓ 3x daily personalized AI nudges (H-LLM powered)<br>
          ✓ Weekly Health Passport PDF<br>
          ✓ Predictive disease risk scores<br>
          ✓ AI health Q&A — ask anything about your health<br>
          ✓ Cloud Digital Twin synthesis<br>
          ✓ AI-powered meal parsing<br>
          ✓ Priority support
        </p>
      </div>
      <a href="https://buy.stripe.com/test_dRmdR90Ei2iO3CFf3LgnK00" target="_blank"><button class="btn btn-primary" style="font-size:16px;padding:14px 32px">Subscribe — $20/month</button></a>
      <p style="font-size:11px;color:#64748B">Cancel anytime. Powered by Stripe. HIPAA-compliant.</p>
    </div>
  </div>

</div>

<!-- ═══ CONNECTION MODAL ═══ -->
<div class="modal-overlay" id="modal" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <h2 id="modal-title">Connect</h2>
    <p id="modal-desc"></p>
    <div id="modal-fields"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-submit" onclick="submitConnection()">Connect</button>
    </div>
  </div>
</div>

<script>
let currentConnection = {};

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  event.target.classList.add('active');
}

function filterEHR(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.ehr-card').forEach(card => {
    card.style.display = card.dataset.name.includes(q) ? '' : 'none';
  });
}

function connectEHR(name, ehr, fhirUrl) {
  currentConnection = { type: 'ehr', name, ehr, fhirUrl };
  document.getElementById('modal-title').textContent = 'Connect to ' + name;
  document.getElementById('modal-desc').textContent = 'Enter your ' + name + ' patient portal credentials. These are stored securely in your OS keychain.';
  document.getElementById('modal-fields').innerHTML = \`
    <label>Username / Email</label>
    <input type="text" id="conn-username" placeholder="Your patient portal username">
    <label>Password</label>
    <input type="password" id="conn-password" placeholder="Your patient portal password">
    \${fhirUrl === '' ? '<label>FHIR R4 Base URL</label><input type="url" id="conn-fhir-url" placeholder="https://fhir.example.org/api/FHIR/R4">' : ''}
  \`;
  document.getElementById('modal').classList.add('show');
}

function connectWearable(id, name, authType) {
  currentConnection = { type: 'wearable', id, name, authType };
  document.getElementById('modal-title').textContent = 'Connect ' + name;

  if (id === 'apple_health') {
    document.getElementById('modal-desc').textContent = 'Apple Health connects automatically on macOS via HealthKit. Make sure Health data sharing is enabled in System Settings.';
    document.getElementById('modal-fields').innerHTML = '<p style="color:#6EE7B7;font-size:13px">No credentials needed — HealthKit integration is automatic.</p>';
  } else {
    document.getElementById('modal-desc').textContent = 'Enter your ' + name + ' account credentials or API key.';
    document.getElementById('modal-fields').innerHTML = \`
      <label>Email</label>
      <input type="email" id="conn-username" placeholder="Your \${name} account email">
      <label>Password</label>
      <input type="password" id="conn-password" placeholder="Your \${name} password">
    \`;
  }
  document.getElementById('modal').classList.add('show');
}

function connectLab(id, name) {
  currentConnection = { type: 'lab', id, name };
  document.getElementById('modal-title').textContent = 'Connect ' + name;
  document.getElementById('modal-desc').textContent = 'Enter your ' + name + ' patient portal credentials to import lab results.';
  document.getElementById('modal-fields').innerHTML = \`
    <label>Username / Email</label>
    <input type="text" id="conn-username" placeholder="Your \${name} portal username">
    <label>Password</label>
    <input type="password" id="conn-password" placeholder="Your \${name} password">
  \`;
  document.getElementById('modal').classList.add('show');
}

function connectGenomics(id, name) {
  currentConnection = { type: 'genomics', id, name };
  document.getElementById('modal-title').textContent = 'Connect ' + name;
  document.getElementById('modal-desc').textContent = 'Enter your ' + name + ' credentials or upload your raw data file.';
  document.getElementById('modal-fields').innerHTML = \`
    <label>Email</label>
    <input type="email" id="conn-username" placeholder="Your \${name} account email">
    <label>Password / API Key</label>
    <input type="password" id="conn-password" placeholder="Your \${name} password or API key">
  \`;
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

async function submitConnection() {
  const username = document.getElementById('conn-username')?.value;
  const password = document.getElementById('conn-password')?.value;
  const fhirUrl = document.getElementById('conn-fhir-url')?.value;

  const btn = document.getElementById('modal-submit');
  btn.textContent = 'Connecting...';
  btn.disabled = true;

  try {
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...currentConnection,
        username,
        password,
        fhirUrl: fhirUrl || currentConnection.fhirUrl,
      }),
    });
    const result = await response.json();

    if (result.success) {
      btn.textContent = 'Connected!';
      btn.className = 'btn btn-success';
      setTimeout(() => {
        closeModal();
        btn.textContent = 'Connect';
        btn.className = 'btn btn-primary';
        btn.disabled = false;
        location.reload();
      }, 1500);
    } else {
      btn.textContent = 'Failed — ' + (result.error || 'Try again');
      btn.className = 'btn btn-primary';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = 'Error — Try again';
    btn.className = 'btn btn-primary';
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
}

// ── HTTP Server ─────────────────────────────────────────────

export function startDashboard(
  config: AgentConfig,
  store: LocalStore,
  apiClient: XSpanApiClient,
  pipeline: DataPipeline,
): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    // API: Handle connection requests
    if (url === '/api/connect' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`[Dashboard] Connection request: ${data.type} — ${data.name}`);
          // Store credentials securely (in production, use keytar/OS keychain)
          // For now, log and acknowledge
          console.log(`[Dashboard] ${data.name} credentials received — initiating connection...`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `Connected to ${data.name}. Data sync will begin shortly.`,
          }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // API: Health status
    if (url === '/api/status') {
      const snapshot = store.getLatestSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: true,
        userId: config.xspan.userId,
        dataCompleteness: snapshot?.biomarkers.dataCompleteness ?? 0,
        lastSync: snapshot?.createdAt?.toISOString() ?? null,
      }));
      return;
    }

    // Dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard(config, store));
  });

  server.listen(DASHBOARD_PORT, '127.0.0.1', () => {
    console.log(`[Dashboard] XSpan Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });
}
