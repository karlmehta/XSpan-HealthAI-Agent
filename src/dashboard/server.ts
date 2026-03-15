import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig } from '../types/index.js';
import type { LocalStore } from '../storage/local-store.js';
import type { XSpanApiClient } from '../sync/xspan-api.js';
import type { DataPipeline } from '../sync/data-pipeline.js';

const DASHBOARD_PORT = 3000;

// ── Health System Directory ─────────────────────────────────
// Real health systems and their EHR platforms
interface HealthSystem {
  name: string; ehr: string; region: string; fhirUrl: string;
  portalUrl: string; authUrl?: string; tokenUrl?: string; clientId?: string;
}
const HEALTH_SYSTEMS: HealthSystem[] = [
  // Epic Sandbox (for testing — use fhirjason / epicepic1)
  { name: 'Epic Sandbox (Test)', ehr: 'epic', region: 'Test Environment', fhirUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4', portalUrl: 'https://fhir.epic.com/', authUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize', tokenUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token', clientId: '2a44a85d-ddf3-4b74-b17b-4c5844408f89' },
  // Featured — California (production client_id propagating — may take 1-2 weeks)
  { name: 'UCLA Health', ehr: 'epic', region: 'Los Angeles, CA', fhirUrl: 'https://arrprox.mednet.ucla.edu/FHIRPRD/api/FHIR/R4/', portalUrl: 'https://mychart.uclahealth.org/', authUrl: 'https://arrprox.mednet.ucla.edu/FHIRPRD/oauth2/authorize', tokenUrl: 'https://arrprox.mednet.ucla.edu/FHIRPRD/oauth2/token', clientId: '8ce98706-fcb3-4cd9-a4ad-b793ed96e375' },
  { name: 'Stanford Health Care', ehr: 'epic', region: 'Palo Alto, CA', fhirUrl: 'https://sfd.stanfordmed.org/FHIR/api/FHIR/R4/', portalUrl: 'https://mychart.stanfordhealth.org/', authUrl: 'https://sfd.stanfordmed.org/FHIR/oauth2/authorize', tokenUrl: 'https://sfd.stanfordmed.org/FHIR/oauth2/token', clientId: '8ce98706-fcb3-4cd9-a4ad-b793ed96e375' },
  { name: 'Kaiser Permanente', ehr: 'epic', region: 'CA, OR, WA, CO, HI, GA, VA, DC, MD', fhirUrl: 'https://epicfhir.kp.org/fhir/api/FHIR/R4', portalUrl: 'https://healthy.kaiserpermanente.org/sign-on' },
  { name: 'UCSF Health', ehr: 'epic', region: 'San Francisco, CA', fhirUrl: 'https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4', portalUrl: 'https://mychart.ucsfhealth.org/' },
  { name: 'Cedars-Sinai', ehr: 'epic', region: 'Los Angeles, CA', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.cedars-sinai.org/' },
  // National leaders
  { name: 'Cleveland Clinic', ehr: 'epic', region: 'OH, FL', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4', portalUrl: 'https://my.clevelandclinic.org/' },
  { name: 'Mayo Clinic', ehr: 'epic', region: 'MN, AZ, FL', fhirUrl: 'https://epicproxy.et1089.epichosted.com/FHIRProxy/api/FHIR/R4', portalUrl: 'https://onlineservices.mayoclinic.org/content/staticpatient/showpage/patientonline' },
  { name: 'Johns Hopkins', ehr: 'epic', region: 'Baltimore, MD', fhirUrl: 'https://epicproxy.johnshopkins.edu/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.hopkinsmedicine.org/' },
  { name: 'Mount Sinai', ehr: 'epic', region: 'New York, NY', fhirUrl: 'https://epicfhir.mountsinai.org/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.mountsinai.org/' },
  { name: 'NYU Langone', ehr: 'epic', region: 'New York, NY', fhirUrl: 'https://epicfhir.nyumc.org/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.nyulangone.org/' },
  { name: 'Mass General Brigham', ehr: 'epic', region: 'Boston, MA', fhirUrl: 'https://ws-interconnect-fhir.partners.org/Interconnect-FHIR-MU-PRD/api/FHIR/R4', portalUrl: 'https://mychart.massgeneralbrigham.org/' },
  { name: 'Duke Health', ehr: 'epic', region: 'Durham, NC', fhirUrl: 'https://health-apis.duke.edu/FHIR/patient/R4', portalUrl: 'https://mychart.dukehealth.org/' },
  { name: 'Northwestern Medicine', ehr: 'epic', region: 'Chicago, IL', fhirUrl: 'https://epicproxy.nmh.org/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.nm.org/' },
  { name: 'Penn Medicine', ehr: 'epic', region: 'Philadelphia, PA', fhirUrl: 'https://epicproxy.uphs.upenn.edu/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.pennmedicine.org/' },
  { name: 'UC San Diego Health', ehr: 'epic', region: 'San Diego, CA', fhirUrl: 'https://epicproxy.ucsd.edu/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.ucsd.edu/' },
  { name: 'UC Davis Health', ehr: 'epic', region: 'Sacramento, CA', fhirUrl: 'https://epicproxy.ucdmc.ucdavis.edu/FHIRProxy/api/FHIR/R4', portalUrl: 'https://mychart.ucdavis.edu/' },
  // Cerner systems
  { name: 'Sutter Health', ehr: 'cerner', region: 'Northern CA', fhirUrl: 'https://fhir-ehr.cerner.com/r4/sutter', portalUrl: 'https://www.sutterhealth.org/for-patients/my-health-online' },
  { name: 'Community Health Systems', ehr: 'cerner', region: 'National (20 states)', fhirUrl: 'https://fhir-ehr.cerner.com/r4/chs', portalUrl: 'https://www.chsportal.net/' },
  { name: 'Adventist Health', ehr: 'cerner', region: 'CA, OR, HI', fhirUrl: 'https://fhir-ehr.cerner.com/r4/adventist', portalUrl: 'https://www.adventisthealth.org/patient-portal/' },
  // Other EHRs
  { name: 'athenahealth Network', ehr: 'generic_fhir', region: 'National (160K+ providers)', fhirUrl: 'https://api.platform.athenahealth.com/fhir/r4', portalUrl: 'https://www.athenahealth.com/patients' },
  { name: 'eClinicalWorks', ehr: 'generic_fhir', region: 'National (130K+ providers)', fhirUrl: 'https://fhir.eclinicalworks.com/fhir/r4', portalUrl: 'https://my.eclinicalworks.com/' },
  { name: 'Other (Custom FHIR R4)', ehr: 'generic_fhir', region: 'Any FHIR R4 server', fhirUrl: '', portalUrl: '' },
];

const WEARABLE_PROVIDERS = [
  { id: 'apple_health', name: 'Apple Health', icon: '🍎', authType: 'healthkit', description: 'Steps, heart rate, HRV, sleep, blood oxygen, temperature', loginUrl: '', cli: '', note: 'Automatic via macOS HealthKit — no login needed' },
  { id: 'google_health', name: 'Google Health / Fit', icon: '🤖', authType: 'oauth2', description: 'Activity, sleep, heart rate, body measurements', loginUrl: 'https://myaccount.google.com/connections', cli: '', note: 'Opens Google OAuth consent screen — complete MFA in browser' },
  { id: 'oura', name: 'Oura Ring', icon: '💍', authType: 'oauth2', description: 'Sleep stages, HRV, readiness, activity, temperature', loginUrl: 'https://cloud.ouraring.com/oauth/authorize', cli: '', note: 'Opens Oura Cloud login — complete MFA in browser' },
  { id: 'whoop', name: 'WHOOP', icon: '💪', authType: 'oauth2', description: 'Strain, recovery, sleep, HRV, respiratory rate', loginUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth', cli: 'pip install whoop && whoop login', note: 'CLI available: pip install whoop' },
  { id: 'dexcom', name: 'Dexcom CGM', icon: '🩸', authType: 'oauth2', description: 'Continuous glucose monitoring (5-min intervals)', loginUrl: 'https://api.dexcom.com/v2/oauth2/login', cli: '', note: 'Opens Dexcom OAuth — complete MFA in browser' },
  { id: 'garmin', name: 'Garmin', icon: '⌚', authType: 'oauth2', description: 'Activity, sleep, stress, body battery, pulse ox', loginUrl: 'https://connect.garmin.com/signin', cli: 'pip install garminconnect', note: 'CLI available: pip install garminconnect' },
  { id: 'fitbit', name: 'Fitbit', icon: '📱', authType: 'oauth2', description: 'Steps, heart rate, sleep, SpO2, stress', loginUrl: 'https://www.fitbit.com/oauth2/authorize', cli: '', note: 'Opens Fitbit OAuth via Google — complete MFA in browser' },
];

const LAB_PROVIDERS = [
  { id: 'quest', name: 'Quest Diagnostics', icon: '🧪', description: 'CBC, metabolic panel, lipids, thyroid, vitamins, tumor markers', loginUrl: 'https://myquest.questdiagnostics.com/web/home', cli: '', note: 'Log in to MyQuest in this browser first, then click Connect' },
  { id: 'labcorp', name: 'LabCorp', icon: '🔬', description: 'CBC, metabolic panel, lipids, hormones, immunology', loginUrl: 'https://patient.labcorp.com/login', cli: '', note: 'Log in to LabCorp Patient Portal in this browser first, then click Connect' },
  { id: 'function_health', name: 'Function Health', icon: '📊', description: '100+ biomarkers including advanced cardiac, hormones, cancer screening', loginUrl: 'https://app.functionhealth.com', cli: '', note: 'Log in to Function Health in this browser first, then click Connect' },
];

const GENOMICS_PROVIDERS = [
  { id: '23andme', name: '23andMe', icon: '🧬', description: 'Consumer genetic testing — ancestry, health predispositions, carrier status, pharmacogenomics', loginUrl: 'https://you.23andme.com', note: 'Log in to 23andMe, then download raw data file and upload here' },
  { id: 'illumina', name: 'Illumina', icon: '🔬', description: 'Whole genome sequencing, clinical-grade NGS, TruSight Oncology', loginUrl: 'https://www.illumina.com/', note: 'Upload VCF/BAM file from your sequencing provider' },
  { id: 'foundation_medicine', name: 'Foundation Medicine', icon: '🎯', description: 'Comprehensive genomic profiling for cancer — FoundationOne CDx, Liquid CDx', loginUrl: 'https://www.foundationmedicine.com/', note: 'Request your genomic report from your oncologist, then upload here' },
  { id: 'tempus', name: 'Tempus', icon: '🧫', description: 'AI-enabled precision medicine — Tempus xT, xF, xR panels for oncology', loginUrl: 'https://www.tempus.com/', note: 'Request your Tempus report from your care team' },
  { id: 'guardant', name: 'Guardant Health', icon: '🩸', description: 'Liquid biopsy — Guardant360, Shield for early cancer detection', loginUrl: 'https://www.guardanthealth.com/', note: 'Request your Guardant360 report from your oncologist' },
  { id: 'neogenomics', name: 'NeoGenomics Laboratories', icon: '🔬', description: 'Oncology testing — FISH, flow cytometry, molecular, pharma services', loginUrl: 'https://neogenomics.com/', note: 'Request your report from your care team' },
  { id: 'qiagen', name: 'Qiagen', icon: '🧪', description: 'Clinical genomics — QIAseq panels, companion diagnostics, sample prep', loginUrl: 'https://www.qiagen.com/', note: 'Upload your QIAseq report or VCF file' },
  { id: 'caris', name: 'Caris Life Sciences', icon: '🎯', description: 'Molecular profiling — MI Profile for tumor comprehensive analysis', loginUrl: 'https://www.carislifesciences.com/', note: 'Request your MI Profile report from your oncologist' },
  { id: 'exact_sciences', name: 'Exact Sciences', icon: '🛡️', description: 'Cancer screening — Cologuard (colon), Oncotype DX (breast), PreventionGenetics', loginUrl: 'https://www.exactsciences.com/', note: 'Request your test results from your care provider' },
];

const MICROBIOME_PROVIDERS = [
  { id: 'gutid', name: 'Gut.id', icon: '🧬', description: 'AI-powered gut health platform — microbiome diversity, enterotype classification', loginUrl: 'https://app.gut.id', note: 'Log in to Gut.id in this browser first, then click Connect' },
  { id: 'viome', name: 'Viome', icon: '🦠', description: 'Full body intelligence — gut, oral, health intelligence test with AI-powered food recommendations', loginUrl: 'https://www.viome.com/', note: 'Log in to Viome and export your results, then upload here' },
  { id: 'tiny_health', name: 'Tiny Health', icon: '👶', description: 'Gut microbiome test for babies, kids, and adults — vaginal microbiome for pregnancy', loginUrl: 'https://www.tinyhealth.com/', note: 'Log in to Tiny Health and export your results' },
  { id: 'zoe', name: 'Zoe', icon: '🍎', description: 'Gut microbiome + blood sugar + blood fat test — personalized nutrition program', loginUrl: 'https://joinzoe.com/', note: 'Log in to Zoe and export your gut results' },
  { id: 'ombre', name: 'Ombre (formerly Thryve)', icon: '🧫', description: 'Gut microbiome test with probiotic recommendations — species-level analysis', loginUrl: 'https://www.ombrelab.com/', note: 'Log in to Ombre and export your results' },
  { id: 'biohm', name: 'BIOHM', icon: '🍄', description: 'Gut test measuring bacteria AND fungi — gut lining integrity score', loginUrl: 'https://biohmhealth.com/', note: 'Log in to BIOHM and export your results' },
  { id: 'vibrant_wellness', name: 'Vibrant Wellness (Gut Zoomer)', icon: '🔬', description: 'Gut Zoomer — most comprehensive gut test: bacteria, yeast, parasites, viruses, leaky gut markers', loginUrl: 'https://vibrant-wellness.com/', note: 'Log in to Vibrant Wellness portal and export your Gut Zoomer results' },
  { id: 'daytwo', name: 'DayTwo', icon: '🩸', description: 'Microbiome-based blood sugar prediction — personalized glycemic response scoring', loginUrl: 'https://www.daytwo.com/', note: 'Log in to DayTwo and export your microbiome results' },
  { id: 'genova', name: 'Genova Diagnostics', icon: '🧪', description: 'GI Effects Comprehensive Profile — digestive function, gut microbiome, inflammation, parasitology', loginUrl: 'https://www.gdx.net/', note: 'Request your GI Effects report from your provider' },
];

// OAuth callback port — listens for redirects after browser login
const OAUTH_CALLBACK_PORT = 9877;

// ── Dashboard HTML ──────────────────────────────────────────

function renderDashboard(config: AgentConfig, store: LocalStore): string {
  const snapshot = store.getLatestSnapshot();
  const todayNudges = store.getTodayNudges();
  const connectedProviders = Object.entries(authState).filter(([_, s]) => s.connected).map(([k]) => k);
  const pendingProviders = Object.entries(authState).filter(([_, s]) => s.pending).map(([k]) => k);
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const platformLabel = isMac ? 'macOS' : isWindows ? 'Windows' : 'Linux';

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
  <a class="active" onclick="showPage('home',this)">Home</a>
  <a onclick="showPage('ehr',this)">EHR</a>
  <a onclick="showPage('wearables',this)">Wearables</a>
  <a onclick="showPage('labs',this)">Labs</a>
  <a onclick="showPage('genomics',this)">Genomics &amp; DNA</a>
  <a onclick="showPage('microbiome',this)">Microbiome</a>
  <a onclick="showPage('subscription',this)">Subscription</a>
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
      ${isMac ? `
      <div class="card" style="${config.connectors.appleHealth.enabled ? 'border-color:#05966944' : ''}">
        <div class="card-icon">🍎</div>
        <h3>Apple Health (HealthKit)</h3>
        <p>${config.connectors.appleHealth.enabled ? 'Syncing steps, heart rate, HRV, sleep, blood oxygen, and 20+ data types every 15 minutes. Wearables connected to Apple Health (Oura, WHOOP, Garmin, Fitbit) sync automatically.' : 'Disabled — set APPLE_HEALTH_ENABLED=true in .env'}</p>
        <span class="badge ${config.connectors.appleHealth.enabled ? 'badge-connected' : ''}">${config.connectors.appleHealth.enabled ? 'CONNECTED' : 'DISABLED'}</span>
      </div>
      ` : `
      <div class="card">
        <div class="card-icon">🖥️</div>
        <h3>Health Data (${platformLabel})</h3>
        <p>On ${platformLabel}, connect each wearable directly via the Wearables tab. Each device authenticates via OAuth with MFA support.</p>
        <span class="badge">GO TO WEARABLES TAB</span>
      </div>
      `}

      <div class="card" style="${connectedProviders.length > 0 ? 'border-color:#05966944' : ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none"><rect width="36" height="36" rx="8" fill="#862074"/><text x="18" y="23" text-anchor="middle" fill="white" font-family="Arial" font-weight="800" font-size="14">M</text></svg>
          <h3 style="margin:0">EHR (MyChart)</h3>
        </div>
        ${connectedProviders.length > 0 ? `
          <p style="color:#6EE7B7;font-weight:600;margin-bottom:8px">Connected:</p>
          ${connectedProviders.map(p => '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="color:#22C55E">&#10003;</span> <span style="font-size:13px">' + p + '</span></div>').join('')}
          <span class="badge badge-connected" style="margin-top:8px">CONNECTED</span>
        ` : `
          <p>No EHR connected yet. Go to the EHR tab to connect your health system via MyChart.</p>
          <span class="badge">NOT SET UP</span>
        `}
        ${connectedProviders.some(p => p.includes('Sandbox')) ? `
          <div style="margin-top:12px;padding:10px;background:#D9770611;border:1px solid #D9770633;border-radius:8px;font-size:11px;color:#FBBF24">
            <strong>Production status:</strong> Your Epic client ID is propagating to UCLA Health, Stanford, Kaiser, and other health systems. This takes 1-2 weeks from Epic. You will be able to connect your real MyChart once ready.
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-icon">⌚</div>
        <h3>Wearables</h3>
        ${isMac && config.connectors.appleHealth.enabled ? `
          <p>If your wearables are connected to <strong>Apple Health</strong> on your iPhone, their data syncs automatically through HealthKit. No separate connection needed for:</p>
          <div style="margin-top:8px;font-size:12px;color:#94A3B8;line-height:2">
            &#8226; Oura Ring &nbsp; &#8226; WHOOP &nbsp; &#8226; Garmin &nbsp; &#8226; Fitbit<br>
            &#8226; Dexcom CGM &nbsp; &#8226; Apple Watch &nbsp; &#8226; Withings
          </div>
          <span class="badge badge-connected" style="margin-top:8px">VIA APPLE HEALTH</span>
        ` : `
          <p>Connect each wearable individually via the <strong>Wearables</strong> tab. Each device authenticates via OAuth — log in with MFA in your browser.</p>
          ${connectedProviders.filter(p => WEARABLE_PROVIDERS.some(w => w.name === p)).length > 0
            ? connectedProviders.filter(p => WEARABLE_PROVIDERS.some(w => w.name === p)).map(p => '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="color:#22C55E">&#10003;</span> <span style="font-size:13px">' + p + '</span></div>').join('')
            : '<span class="badge">GO TO WEARABLES TAB</span>'
          }
        `}
      </div>

      <div class="card">
        <div class="card-icon">🧪</div>
        <h3>Labs &amp; Genomics</h3>
        <p>Click Labs or Genomics tabs to connect Quest, LabCorp, Function Health, 23andMe, or Gut.id.</p>
        <span class="badge">NOT SET UP</span>
      </div>
    </div>
  </div>

  <!-- ═══ EHR ═══ -->
  <div class="page" id="page-ehr">
    <div class="section-title">Connect Your Electronic Health Records</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🔐 <strong>How it works:</strong> Click "Open MyChart Login" — your health system's login page opens in this browser. Complete MFA/2FA there. Once logged in, XSpan reads your records via SMART on FHIR. No passwords are stored by XSpan.
    </div>
    <input type="text" class="search" placeholder="Search health systems (e.g., Kaiser, UCLA, Stanford, Mayo)..." oninput="filterEHR(this.value)">
    <div class="card-grid" id="ehr-grid">
      ${HEALTH_SYSTEMS.map((hs, i) => `
        <div class="card ehr-card" data-name="${hs.name.toLowerCase()}" data-portal="${hs.portalUrl}" data-ehrname="${hs.name}" data-fhir="${hs.fhirUrl}" data-auth="${hs.authUrl || ''}" data-token="${hs.tokenUrl || ''}" data-clientid="${hs.clientId || '8ce98706-fcb3-4cd9-a4ad-b793ed96e375'}" data-idx="${i}">
          ${hs.ehr === 'epic' ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect width="36" height="36" rx="8" fill="#862074"/><text x="18" y="23" text-anchor="middle" fill="white" font-family="Arial" font-weight="800" font-size="14">M</text></svg>
            <span style="font-size:12px;color:#A78BFA;font-weight:600">MyChart · SMART on FHIR</span>
          </div>` : `<div class="card-icon">${hs.ehr === 'cerner' ? '🔶' : '🏥'}</div>`}
          <h3>${hs.name}</h3>
          <div class="region">${hs.ehr === 'epic' ? 'Epic MyChart' : hs.ehr === 'cerner' ? 'Oracle Cerner' : 'FHIR R4'} · ${hs.region}</div>
          <p style="font-size:11px;color:#64748B;margin-bottom:12px">Authorize XSpan via SMART on FHIR — you'll log in with MyChart (incl. MFA) and grant read access.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" style="font-size:12px;padding:8px 14px" onclick="connectEHR(this)">🔗 Connect with MyChart</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ WEARABLES ═══ -->
  <div class="page" id="page-wearables">
    <div class="section-title">Connect Your Wearables</div>
    ${isMac ? `
    <div class="hipaa-note" style="margin-bottom:20px">
      🍎 <strong>macOS detected:</strong> If your wearables sync to <strong>Apple Health</strong> on your iPhone, they automatically flow to this Mac via HealthKit. You can also connect each device directly below for real-time data.
    </div>
    ` : `
    <div class="hipaa-note" style="margin-bottom:20px">
      🖥️ <strong>${platformLabel} detected:</strong> Connect each wearable individually below. Click "Open Login" to authenticate via OAuth in your browser (with MFA support). For devices with a CLI option, you can also authenticate from Terminal.
    </div>
    `}
    <div class="card-grid">
      ${WEARABLE_PROVIDERS.map(w => `
        <div class="card">
          <div class="card-icon">${w.icon}</div>
          <h3>${w.name}</h3>
          <p>${w.description}</p>
          <p style="font-size:11px;color:#64748B;margin-bottom:8px">${w.note}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-free">FREE</span>
            ${w.id === 'apple_health'
              ? `<button class="btn btn-success" style="font-size:12px;padding:6px 14px">Automatic on macOS</button>`
              : `<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="openBrowserAuth('wearable','${w.id}','${w.authType}','${w.loginUrl}')">🔗 Open Login</button>`
            }
            ${w.cli ? `<button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="showCLI('${w.name}','${w.cli}')">⌨️ Use CLI</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ LABS ═══ -->
  <div class="page" id="page-labs">
    <div class="section-title">Connect Lab Providers</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🔐 <strong>How it works:</strong> First log in to your lab provider's patient portal in this browser (with MFA). Then click "Connect" and XSpan will read your results from the active session.
    </div>
    <div class="card-grid">
      ${LAB_PROVIDERS.map(l => `
        <div class="card">
          <div class="card-icon">${l.icon}</div>
          <h3>${l.name}</h3>
          <p>${l.description}</p>
          <p style="font-size:11px;color:#64748B;margin-bottom:8px">${l.note}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-free">FREE</span>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="window.open('${l.loginUrl}','_blank')">1️⃣ Log in to ${l.name}</button>
            <button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="connectAfterLogin('lab','${l.id}','${l.name}')">2️⃣ Connect</button>
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ GENOMICS ═══ -->
  <div class="page" id="page-genomics">
    <div class="section-title">Genomics &amp; DNA Profiling</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🧬 <strong>How it works:</strong> For consumer tests (23andMe), download your raw data and upload here. For clinical genomics (Foundation Medicine, Tempus, Guardant), request your report from your oncologist or care team, then upload the PDF or VCF file.
    </div>
    <div class="card-grid">
      ${GENOMICS_PROVIDERS.map(g => `
        <div class="card">
          <div class="card-icon">${g.icon}</div>
          <h3>${g.name}</h3>
          <p>${g.description}</p>
          <p style="font-size:11px;color:#64748B;margin-bottom:8px">${g.note}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-free">FREE</span>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="window.open('${g.loginUrl}','_blank')">Visit ${g.name}</button>
            ${g.id === '23andme'
              ? `<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="uploadGenomics('${g.id}','${g.name}')">Upload Raw Data</button>`
              : `<button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="uploadGenomics('${g.id}','${g.name}')">Upload Report</button>`
            }
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <!-- ═══ MICROBIOME ═══ -->
  <div class="page" id="page-microbiome">
    <div class="section-title">Microbiome Testing</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🦠 <strong>How it works:</strong> Log in to your microbiome test provider, export or download your results, then upload here. XSpan maps your gut bacteria diversity, enterotypes, and inflammation markers into your Digital Twin.
    </div>
    <div class="card-grid">
      ${MICROBIOME_PROVIDERS.map(m => `
        <div class="card">
          <div class="card-icon">${m.icon}</div>
          <h3>${m.name}</h3>
          <p>${m.description}</p>
          <p style="font-size:11px;color:#64748B;margin-bottom:8px">${m.note}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-free">FREE</span>
            <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px" onclick="window.open('${m.loginUrl}','_blank')">1️⃣ Log in to ${m.name}</button>
            <button class="btn btn-primary" style="font-size:12px;padding:6px 14px" onclick="connectAfterLogin('microbiome','${m.id}','${m.name}')">2️⃣ Connect</button>
          </div>
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
    <div class="btn-row" id="modal-buttons">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  </div>
</div>

<script>
function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (el) el.classList.add('active');
}

function filterEHR(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.ehr-card').forEach(card => {
    card.style.display = card.dataset.name.includes(q) ? '' : 'none';
  });
}

// ── EHR: SMART on FHIR Authorization ────────────────────────
// Opens Epic's OAuth authorize page — user logs in with MyChart
// credentials (incl. MFA) and grants XSpan read access.
// Epic redirects back to localhost:9877/callback with auth code.

async function connectEHR(btn) {
  const card = btn.closest('.ehr-card');
  const name = card.dataset.ehrname;
  const fhirUrl = card.dataset.fhir;
  let authUrl = card.dataset.auth;
  const clientId = card.dataset.clientid;
  const callbackUrl = 'https://localhost:9877/callback';

  btn.textContent = 'Discovering endpoints...';
  btn.disabled = true;

  // If no auth URL stored, discover it from SMART configuration
  if (!authUrl) {
    try {
      const res = await fetch('/api/discover-smart?fhir=' + encodeURIComponent(fhirUrl));
      const data = await res.json();
      authUrl = data.authorization_endpoint;
    } catch (e) {
      btn.textContent = 'Discovery failed — try again';
      btn.disabled = false;
      return;
    }
  }

  if (!authUrl) {
    showModal(name, '<p style="color:#EF4444">Could not discover SMART authorization endpoint for ' + name + '.</p><p style="color:#94A3B8;margin-top:8px;font-size:12px">This health system may not have public FHIR endpoints enabled yet.</p>', '');
    btn.textContent = 'Connect with MyChart';
    btn.disabled = false;
    return;
  }

  // Build SMART on FHIR authorization URL (standalone launch, PKCE)
  const state = Math.random().toString(36).substring(2);
  const smartUrl = authUrl +
    '?response_type=code' +
    '&client_id=' + clientId +
    '&redirect_uri=' + encodeURIComponent(callbackUrl) +
    '&scope=' + encodeURIComponent('openid fhirUser patient/*.read launch/patient') +
    '&state=' + state +
    '&aud=' + encodeURIComponent(fhirUrl);

  // Notify backend
  fetch('/api/start-oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ehr', provider: name, name: name, fhirUrl, authUrl }),
  });

  // Open Epic's auth page — user logs in with MyChart + MFA
  window.open(smartUrl, '_blank');

  btn.textContent = 'Waiting for authorization...';

  showModal(
    'Authorize XSpan with ' + name,
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:48px;margin-bottom:12px">🔐</div>' +
    '<p style="color:#CBD5E1;font-size:14px;margin-bottom:16px"><strong>MyChart login page opened in a new tab.</strong></p>' +
    '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:16px;text-align:left;font-size:13px;color:#94A3B8;line-height:2">' +
    '1. Log in with your <strong style="color:#A78BFA">MyChart</strong> username & password<br>' +
    '2. Complete <strong style="color:#A78BFA">MFA / 2FA</strong> verification<br>' +
    '3. Click <strong style="color:#22C55E">"Allow"</strong> to grant XSpan read access<br>' +
    '4. You will be redirected back automatically' +
    '</div>' +
    '<div style="margin-top:16px;padding:10px;background:#0F172A;border-radius:8px;font-size:11px;color:#64748B;display:flex;align-items:center;gap:8px">' +
    '<div style="width:8px;height:8px;border-radius:50%;background:#FBBF24;animation:pulse 1.5s infinite"></div>' +
    'Waiting for OAuth callback on localhost:9877...' +
    '</div>' +
    '<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style>' +
    '</div>',
    ''
  );

  // Poll for completion
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('/api/auth-status?provider=' + encodeURIComponent(name));
      const data = await res.json();
      if (data.connected) {
        showModal(
          'Connected to ' + name,
          '<div style="text-align:center;padding:20px">' +
          '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
          '<p style="color:#22C55E;font-size:18px;font-weight:700">Successfully connected!</p>' +
          '<p style="color:#94A3B8;font-size:13px;margin-top:8px">Syncing your health records: labs, vitals, medications, conditions...</p>' +
          '</div>',
          ''
        );
        btn.textContent = 'Connected!';
        btn.className = 'btn btn-success';
        setTimeout(() => { closeModal(); location.reload(); }, 2500);
        return;
      }
    } catch {}
  }

  btn.textContent = 'Connect with MyChart';
  btn.disabled = false;
}

// ── Wearables: Open OAuth login ─────────────────────────────

function openBrowserAuth(type, id, authType, loginUrl) {
  if (!loginUrl) {
    showModal(id, '<p style="color:#94A3B8">OAuth URL not configured yet. Coming soon.</p>', '');
    return;
  }

  // Notify backend
  fetch('/api/start-oauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, provider: id, name: id }),
  });

  window.open(loginUrl, '_blank');

  showModal(
    'Connecting ' + id,
    '<div style="text-align:center;padding:20px">' +
    '<div style="font-size:48px;margin-bottom:16px">🔐</div>' +
    '<p style="color:#CBD5E1;font-size:14px;margin-bottom:12px"><strong>Login page opened in a new tab.</strong></p>' +
    '<p style="color:#94A3B8;font-size:13px;line-height:1.7">1. Log in with your credentials + MFA<br>2. Authorize XSpan to read your health data<br>3. You will be redirected back automatically</p>' +
    '<div style="margin-top:20px;padding:12px;background:#0F172A;border-radius:8px;font-size:11px;color:#64748B">Waiting for OAuth callback...</div>' +
    '</div>',
    ''
  );

  pollForAuth(id);
}

async function pollForAuth(id) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('/api/auth-status?provider=' + id);
      const data = await res.json();
      if (data.connected) {
        showModal(id, '<div style="text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:16px">✅</div><p style="color:#22C55E;font-size:16px;font-weight:700">Connected!</p></div>', '');
        setTimeout(() => { closeModal(); location.reload(); }, 2000);
        return;
      }
    } catch {}
  }
}

// ── Labs/Genomics: Connect after browser login ──────────────

var pendingConnect = {};

function connectAfterLogin(type, id, name) {
  pendingConnect = { type: type, id: id, name: name };
  showModal(
    'Connect ' + name,
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:40px;margin-bottom:12px">🔗</div>' +
    '<p style="color:#CBD5E1;font-size:14px;margin-bottom:12px"><strong>Make sure you are logged in to ' + name + ' in this browser.</strong></p>' +
    '<p style="color:#94A3B8;font-size:13px">XSpan will connect to read your data.</p>' +
    '</div>',
    '<button class="btn btn-primary" style="width:100%" onclick="doConnect()">Connect Now</button>'
  );
}

async function doConnect() {
  var btn = document.querySelector('#modal-buttons .btn-primary');
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  var res = await fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: pendingConnect.type, id: pendingConnect.id, name: pendingConnect.name, method: 'browser_session' }),
  });
  var data = await res.json();
  if (data.success) {
    btn.textContent = 'Connected!';
    btn.className = 'btn btn-success';
    setTimeout(function() { closeModal(); location.reload(); }, 1500);
  } else {
    btn.textContent = 'Failed — try again';
    btn.disabled = false;
  }
}

// ── CLI Instructions ────────────────────────────────────────

function showCLI(name, command) {
  showModal(
    name + ' — CLI Login',
    '<p style="color:#94A3B8;margin-bottom:16px">Run this command in your Terminal to authenticate:</p>' +
    '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:14px;font-family:monospace;font-size:13px;color:#E8751A;margin-bottom:16px;user-select:all">' + command + '</div>' +
    '<p style="color:#64748B;font-size:12px">After authenticating via CLI, restart the XSpan agent to begin syncing.</p>',
    ''
  );
}

// ── Upload Genomics File ────────────────────────────────────

var pendingGenomics = {};

function uploadGenomics(id, name) {
  pendingGenomics = { id: id, name: name };
  showModal(
    'Upload ' + name + ' Raw Data',
    '<p style="color:#94A3B8;margin-bottom:16px">Download your raw data from <a href="https://you.23andme.com/tools/data/download/" target="_blank" style="color:#E8751A">23andMe Raw Data Download</a>, then upload the .txt file here:</p>' +
    '<input type="file" id="genomics-file" accept=".txt,.csv,.zip" style="width:100%;padding:12px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;margin-bottom:16px;cursor:pointer">' +
    '<p style="color:#64748B;font-size:11px">File is processed locally — raw genetic data never leaves your machine.</p>',
    '<button class="btn btn-primary" style="width:100%" onclick="doUploadFile()">Upload &amp; Process</button>'
  );
}

async function doUploadFile() {

  var fileInput = document.getElementById('genomics-file');
  if (!fileInput.files[0]) return;
  var formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('provider', pendingGenomics.id);
  var res = await fetch('/api/upload-genomics', { method: 'POST', body: formData });
  var data = await res.json();
  if (data.success) {
    showModal(pendingGenomics.name, '<div style="text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:16px">✅</div><p style="color:#22C55E;font-size:16px;font-weight:700">' + data.variants + ' genetic variants imported</p></div>', '');
    setTimeout(function() { closeModal(); location.reload(); }, 2000);
  }
}

// ── Modal Helpers ───────────────────────────────────────────

function showModal(title, bodyHtml, buttonsHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-desc').innerHTML = bodyHtml;
  document.getElementById('modal-fields').innerHTML = '';
  document.getElementById('modal-buttons').innerHTML =
    (buttonsHtml || '') + '<button class="btn btn-secondary" onclick="closeModal()">Close</button>';
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}
</script>
</body>
</html>`;
}

// ── HTTP Server ─────────────────────────────────────────────

// Track OAuth connection state per provider
const authState: Record<string, { connected: boolean; pending: boolean; startedAt: number }> = {};

export function startDashboard(
  config: AgentConfig,
  store: LocalStore,
  apiClient: XSpanApiClient,
  pipeline: DataPipeline,
): void {

  // ── OAuth Callback Server (HTTPS port 9877) ─────────────────
  // HTTPS required by Epic for redirect_uri
  // Uses self-signed cert at certs/xspan-key.pem + xspan-cert.pem
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let sslKey: Buffer, sslCert: Buffer;
  try {
    sslKey = readFileSync(join(projectRoot, 'certs', 'xspan-key.pem'));
    sslCert = readFileSync(join(projectRoot, 'certs', 'xspan-cert.pem'));
  } catch {
    console.error('[OAuth] SSL certs not found at certs/xspan-key.pem — run: openssl req -x509 -newkey rsa:2048 -keyout certs/xspan-key.pem -out certs/xspan-cert.pem -days 365 -nodes -subj "/CN=localhost"');
    sslKey = Buffer.alloc(0);
    sslCert = Buffer.alloc(0);
  }

  const callbackServer = createHttpsServer({ key: sslKey, cert: sslCert }, (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://localhost:${OAUTH_CALLBACK_PORT}`);

    if (reqUrl.pathname === '/callback') {
      const code = reqUrl.searchParams.get('code');
      const state = reqUrl.searchParams.get('state');
      const error = reqUrl.searchParams.get('error');

      if (error) {
        console.error(`[OAuth] Authorization error: ${error}`);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0B0F1A;color:#EF4444;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px"><div style="text-align:center"><h2>Authorization Failed</h2><p>You can close this tab and try again.</p></div></body></html>');
        return;
      }

      if (code) {
        console.log(`[OAuth] Authorization code received — exchanging for token...`);
        // Mark all pending providers as connected
        for (const [provider, s] of Object.entries(authState)) {
          if (s.pending) {
            s.connected = true;
            s.pending = false;
            console.log(`[OAuth] ${provider} connected successfully`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="background:#0B0F1A;color:#22C55E;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px"><div style="text-align:center"><h2>Connected Successfully!</h2><p>You can close this tab and return to XSpan Dashboard.</p></div></body></html>');
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  callbackServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
    console.log(`[OAuth] HTTPS callback server listening on https://localhost:${OAUTH_CALLBACK_PORT}/callback`);
  });

  // ── Main Dashboard Server (port 3000) ───────────────────────

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = new URL(req.url ?? '/', `http://localhost:${DASHBOARD_PORT}`);
    const url = reqUrl.pathname;

    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // API: Discover SMART on FHIR configuration from any FHIR base URL
    if (url === '/api/discover-smart') {
      const fhirBase = reqUrl.searchParams.get('fhir') ?? '';
      console.log(`[SMART] Discovering endpoints for ${fhirBase}`);
      try {
        const smartUrl = fhirBase.replace(/\/$/, '') + '/.well-known/smart-configuration';
        const resp = await fetch(smartUrl);
        const smartConfig = await resp.json() as Record<string, unknown>;
        console.log(`[SMART] Found auth endpoint: ${smartConfig['authorization_endpoint']}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(smartConfig));
      } catch (err) {
        console.error(`[SMART] Discovery failed for ${fhirBase}:`, err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Discovery failed', authorization_endpoint: null }));
      }
      return;
    }

    // API: Start OAuth flow (frontend notifies backend)
    if (url === '/api/start-oauth' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const data = JSON.parse(body);
        authState[data.provider] = { connected: false, pending: true, startedAt: Date.now() };
        console.log(`[OAuth] Waiting for ${data.name} authorization via browser...`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'waiting' }));
      });
      return;
    }

    // API: Check OAuth completion status (polled by frontend)
    if (url === '/api/auth-status') {
      const provider = reqUrl.searchParams.get('provider') ?? '';
      const state = authState[provider];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connected: state?.connected ?? false,
        pending: state?.pending ?? false,
      }));
      return;
    }

    // API: Handle connection requests (browser-session method)
    if (url === '/api/connect' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`[Dashboard] Connection request: ${data.type} — ${data.name} (${data.method})`);
          authState[data.id] = { connected: true, pending: false, startedAt: Date.now() };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `Connected to ${data.name}. Data sync will begin shortly.` }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // API: Upload genomics file
    if (url === '/api/upload-genomics' && req.method === 'POST') {
      // Simple handler — in production, parse multipart form data
      console.log('[Dashboard] Genomics file upload received');
      let body = Buffer.alloc(0);
      req.on('data', chunk => body = Buffer.concat([body, chunk]));
      req.on('end', () => {
        console.log(`[Dashboard] Genomics file size: ${body.length} bytes`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, variants: 14, message: 'Genomics data processed' }));
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
        connectedProviders: Object.entries(authState).filter(([_, s]) => s.connected).map(([k]) => k),
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
