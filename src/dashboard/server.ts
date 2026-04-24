import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig } from '../types/index.js';
import type { LocalStore } from '../storage/local-store.js';
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
  { name: 'Epic Sandbox (Test)', ehr: 'epic', region: 'Test Environment — limited to identity only', fhirUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4', portalUrl: 'https://fhir.epic.com/', authUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize', tokenUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token', clientId: '2a44a85d-ddf3-4b74-b17b-4c5844408f89' },
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

// ── Auth State ───────────────────────────────────────────────

let currentUser: { email: string; name: string; apiKey: string; token: string; tier: string } | null = null;

// ── Login / Signup Page ─────────────────────────────────────

function renderAuthPage(apiUrl: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XSpan HealthAI Agent — Sign In</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, 'Inter', sans-serif; background: #0B0F1A; color: #E2E8F0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.auth-container { width: 100%; max-width: 420px; padding: 20px; }
.logo { text-align: center; margin-bottom: 32px; }
.logo h1 { font-size: 28px; font-weight: 800; color: #fff; }
.logo h1 span { color: #E8751A; }
.logo p { color: #64748B; font-size: 13px; margin-top: 8px; }
.auth-card { background: #1E293B; border: 1px solid #334155; border-radius: 16px; padding: 32px; }
.tabs { display: flex; margin-bottom: 24px; border-bottom: 1px solid #334155; }
.tab-btn { flex: 1; padding: 12px; text-align: center; font-size: 14px; font-weight: 600; color: #64748B; cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
.tab-btn.active { color: #E8751A; border-bottom-color: #E8751A; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 600; color: #CBD5E1; margin-bottom: 6px; }
.form-group input { width: 100%; padding: 12px 14px; background: #0F172A; border: 1px solid #334155; border-radius: 8px; color: #E2E8F0; font-size: 14px; }
.form-group input:focus { outline: none; border-color: #E8751A; }
.auth-btn { width: 100%; padding: 14px; background: #E8751A; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.15s; margin-top: 8px; }
.auth-btn:hover { background: #D06A15; }
.auth-btn:disabled { background: #334155; color: #64748B; cursor: not-allowed; }
.error-msg { background: #DC262622; border: 1px solid #DC262644; color: #FCA5A5; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; display: ${error ? 'block' : 'none'}; }
.divider { text-align: center; color: #475569; font-size: 12px; margin: 20px 0; position: relative; }
.divider::before, .divider::after { content: ''; position: absolute; top: 50%; width: 40%; height: 1px; background: #334155; }
.divider::before { left: 0; }
.divider::after { right: 0; }
.hipaa-badge { text-align: center; margin-top: 24px; font-size: 11px; color: #64748B; display: flex; align-items: center; justify-content: center; gap: 6px; }
.signup-form { display: none; }
.signin-form { display: block; }
</style>
</head>
<body>
<div class="auth-container">
  <div class="logo">
    <h1><span>XSpan</span> HealthAI</h1>
    <p>Your Personal Health Intelligence Agent</p>
  </div>

  <div class="auth-card">
    <div class="tabs">
      <button class="tab-btn active" onclick="showTab('signin',this)">Sign In</button>
      <button class="tab-btn" onclick="showTab('signup',this)">Create Account</button>
    </div>

    <div class="error-msg" id="error-msg">${error || ''}</div>

    <!-- Sign In Form -->
    <div id="form-signin" class="signin-form">
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="signin-email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="signin-password" placeholder="Your password">
      </div>
      <button class="auth-btn" onclick="doSignIn()">Sign In</button>
    </div>

    <!-- Sign Up Form -->
    <div id="form-signup" class="signup-form">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" id="signup-name" placeholder="Jane Smith">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="signup-email" placeholder="you@example.com">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="signup-password" placeholder="Minimum 8 characters">
      </div>
      <button class="auth-btn" onclick="doSignUp()">Create Account</button>

      <div class="divider">then</div>
      <p style="text-align:center;font-size:12px;color:#94A3B8">Free: EHR sync, Apple Health, wearables, labs, genomics, 100+ biomarker synthesis, insights, and Contribute &amp; Earn. <a href="https://xspan.ai/developer" target="_blank" style="color:#E8751A">Learn more</a></p>
    </div>
  </div>

  <div class="hipaa-badge">
    🔒 All health data encrypted &amp; stored locally on your device
  </div>
</div>

<script>
function showTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('form-signin').style.display = tab === 'signin' ? 'block' : 'none';
  document.getElementById('form-signup').style.display = tab === 'signup' ? 'block' : 'none';
  document.getElementById('error-msg').style.display = 'none';
}

function showError(msg) {
  var el = document.getElementById('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doSignIn() {
  var email = document.getElementById('signin-email').value;
  var password = document.getElementById('signin-password').value;
  if (!email || !password) { showError('Please enter email and password'); return; }

  var btn = document.querySelector('#form-signin .auth-btn');
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  try {
    var res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();
    if (data.success) {
      window.location.href = '/dashboard';
    } else {
      showError(data.error || 'Invalid email or password');
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  } catch (e) {
    showError('Cannot connect to XSpan Cloud. Is the server running?');
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

async function doSignUp() {
  var name = document.getElementById('signup-name').value;
  var email = document.getElementById('signup-email').value;
  var password = document.getElementById('signup-password').value;
  if (!name || !email || !password) { showError('Please fill in all fields'); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters'); return; }

  var btn = document.querySelector('#form-signup .auth-btn');
  btn.textContent = 'Creating account...';
  btn.disabled = true;

  try {
    var res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, password: password }),
    });
    var data = await res.json();
    if (data.success) {
      window.location.href = '/dashboard';
    } else {
      showError(data.error || 'Could not create account');
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  } catch (e) {
    showError('Cannot connect to XSpan Cloud. Is the server running?');
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
}

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
<title>MyHealthSpan Agent</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
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
  <div style="display:flex;align-items:center;gap:4px"><img src="/logo.png" alt="XSpan.ai" style="height:36px"></div>
  <div class="status">
    <div class="status-dot on"></div>
    <span style="color:#22C55E">Running</span>
    <span style="color:#64748B;margin-left:8px">|</span>
    <span style="color:#fff;margin-left:8px">${currentUser?.name || config.xspan.userId}</span>
    <span style="color:#64748B;margin-left:4px">(${currentUser?.tier || 'free'})</span>
    <a href="/api/auth/logout" style="color:#64748B;margin-left:12px;font-size:12px;text-decoration:underline">Sign Out</a>
  </div>
</div>

<div class="nav">
  <a class="active" onclick="showPage('home',this)" style="display:flex;align-items:center;gap:4px">Insights <sup style="font-size:9px;font-weight:700;color:#6EE7B7;background:#05966922;padding:1px 5px;border-radius:4px;margin-top:-4px">FREE</sup></a>
  <a onclick="showPage('connect',this)">Connect</a>
  <a onclick="showPage('contribute',this)" style="display:flex;align-items:center;gap:4px">Contribute <sup style="font-size:9px;font-weight:700;color:#FBBF24;background:#FBBF2422;padding:1px 5px;border-radius:4px;margin-top:-4px">EARN</sup></a>
  <a onclick="showPage('subscription',this)">Premium</a>
</div>

<div class="main">

  <!-- ═══ INSIGHTS ═══ -->
  <div class="page active" id="page-home">
    ${(() => {
      return `

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h2 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Health Insights</h2>
        <p style="font-size:12px;color:#64748B">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#64748B">
        <span style="width:6px;height:6px;border-radius:50%;background:#22C55E;display:inline-block"></span> AES-256 encrypted locally
      </div>
    </div>

    <!-- Trend Charts — always visible, greyed out placeholders when no data -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:24px">

      <div class="card" style="grid-column:span 2">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">&#x2764;&#xFE0F; Cardiovascular</h3>
          <span style="font-size:10px;color:#64748B">HR + HRV + Blood Pressure</span>
        </div>
        <canvas id="chart-cardio" height="140"></canvas>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">&#x1F634; Sleep & Recovery</h3>
          <span style="font-size:10px;color:#64748B">Duration + Stages + HRV</span>
        </div>
        <canvas id="chart-sleep" height="160"></canvas>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">&#x1F525; Metabolic</h3>
          <span style="font-size:10px;color:#64748B">Glucose + HbA1c + Weight</span>
        </div>
        <canvas id="chart-metabolic" height="160"></canvas>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">&#x1F3C3; Activity</h3>
          <span style="font-size:10px;color:#64748B">Steps + Active Min + Calories</span>
        </div>
        <canvas id="chart-activity" height="160"></canvas>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">&#x2696;&#xFE0F; Body Composition</h3>
          <span style="font-size:10px;color:#64748B">Weight + BMI</span>
        </div>
        <canvas id="chart-body" height="160"></canvas>
      </div>
    </div>

    <!-- Recent Health Records from EHR (b.well) -->
    <div class="card" style="margin-bottom:20px" id="ehr-records-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:16px">Health Records</h3>
        <span style="font-size:10px;color:#64748B">From connected EHR + wearables</span>
      </div>
      <div id="ehr-records-content" style="font-size:13px;color:#94A3B8">Loading records...</div>
    </div>

    <!-- Drift Detection -->
    <div class="card" style="margin-bottom:20px" id="drift-section">
      <h3 style="font-size:16px;margin-bottom:12px">Changes from Baseline</h3>
      <div id="drift-content" style="font-size:13px;color:#94A3B8">Monitoring trends...</div>
    </div>

    `;
    })()}
  </div>

  <!-- ═══ CONNECT (wrapper for all data sources) ═══ -->
  <div class="page" id="page-connect">
    <div class="section-title">Connect Your Health Data Sources</div>
    <p style="font-size:13px;color:#94A3B8;margin-bottom:12px">The more sources you connect, the better your synthesized health insights. All data stored locally on your device.</p>

    <!-- Country Selector -->
    <div style="margin-bottom:12px">
      <p style="font-size:12px;color:#64748B;margin-bottom:8px;font-weight:600">Select your country to see available health data sources:</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="country-btn active" onclick="selectCountry('us', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:#2A8A6E;color:#fff;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇺🇸 United States</button>
        <button class="country-btn" onclick="selectCountry('india', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇮🇳 India</button>
        <button class="country-btn" onclick="selectCountry('korea', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇰🇷 South Korea</button>
        <button class="country-btn" onclick="selectCountry('canada', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇨🇦 Canada</button>
        <button class="country-btn" onclick="selectCountry('uk', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇬🇧 United Kingdom</button>
        <button class="country-btn" onclick="selectCountry('eu', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇪🇺 Europe</button>
        <button class="country-btn" onclick="selectCountry('israel', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇮🇱 Israel</button>
        <button class="country-btn" onclick="selectCountry('australia', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🇦🇺 Australia</button>
        <button class="country-btn" onclick="selectCountry('global', this)" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94A3B8;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px">🌍 Global</button>
      </div>
    </div>

    <div style="display:flex;gap:24px;min-height:600px;align-items:flex-start">
    <!-- Left Sidebar -->
    <div style="width:200px;flex-shrink:0;position:sticky;top:20px" id="connect-sidebar">
      <div onclick="showConnectTab('health-systems',this)" class="connect-nav-item" data-countries="us" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;background:#E8751A22;color:#E8751A">
        <span>🏥</span> Health Systems (Epic/Cerner)
      </div>
      <div onclick="showConnectTab('wearables',this)" class="connect-nav-item" data-countries="us,india,korea,canada,uk,eu,israel,australia,global" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>⌚</span> Wearables (150+ devices)
      </div>
      <div onclick="showConnectTab('labs',this)" class="connect-nav-item" data-countries="us,uk,global" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🧪</span> Labs
      </div>
      <div onclick="showConnectTab('genomics',this)" class="connect-nav-item" data-countries="us,uk,global" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🧬</span> Genomics
      </div>
      <div onclick="showConnectTab('microbiome',this)" class="connect-nav-item" data-countries="us,global" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🦠</span> Microbiome
      </div>
      <div onclick="showConnectTab('abdm',this)" class="connect-nav-item" data-countries="india" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇮🇳</span> ABDM (Ayushman Bharat)
      </div>
      <div onclick="showConnectTab('myhealthway',this)" class="connect-nav-item" data-countries="korea" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇰🇷</span> MyHealthWay
      </div>
      <div onclick="showConnectTab('nhs',this)" class="connect-nav-item" data-countries="uk" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇬🇧</span> NHS (GP Connect)
      </div>
      <div onclick="showConnectTab('eu-ehds',this)" class="connect-nav-item" data-countries="eu" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇪🇺</span> EU Health Data Space
      </div>
      <div onclick="showConnectTab('canada-health',this)" class="connect-nav-item" data-countries="canada" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇨🇦</span> Provincial Health
      </div>
      <div onclick="showConnectTab('clalit',this)" class="connect-nav-item" data-countries="israel" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇮🇱</span> Health Funds (Clalit/Maccabi)
      </div>
      <div onclick="showConnectTab('myhealthrecord',this)" class="connect-nav-item" data-countries="australia" style="padding:10px 14px;cursor:pointer;border-radius:8px;margin-bottom:3px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8;display:none">
        <span>🇦🇺</span> My Health Record
      </div>
    </div>
    <!-- Right Content -->
    <div style="flex:1;min-width:0;overflow:hidden">

    <!-- ── HEALTH SYSTEMS ── -->
    <div class="connect-sub active" id="connect-health-systems">
    <div class="section-title">Connect to Your Health System</div>
    <p style="font-size:12px;color:#94A3B8;margin-bottom:16px">Connect to 2.4M+ healthcare providers via b.well Connected Health. Your data is retrieved securely and stored locally.</p>

    <!-- b.well Connect (Primary) -->
    <div id="bwell-connect-panel" style="background:#0F172A;border:2px solid #22C55E44;border-radius:12px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:44px;height:44px;border-radius:10px;background:#22C55E22;display:flex;align-items:center;justify-content:center;font-size:22px">&#x1F3E5;</div>
        <div>
          <h3 style="font-size:16px;margin:0;color:#fff">Connect via b.well <span style="font-size:10px;color:#22C55E;background:#22C55E22;padding:2px 8px;border-radius:4px;margin-left:8px">RECOMMENDED</span></h3>
          <div style="font-size:11px;color:#94A3B8">2.4M+ providers — Epic, Cerner, Allscripts, athenahealth and more</div>
        </div>
      </div>

      <div id="bwell-login-form" style="display:flex;flex-direction:column;gap:10px;max-width:400px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Sign in with your b.well account to link your health records:</div>
        <input type="email" id="bwell-email" placeholder="Email address" value="" style="padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#1E293B;color:#fff;font-size:13px">
        <input type="password" id="bwell-password" placeholder="Password" value="" style="padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#1E293B;color:#fff;font-size:13px">
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn btn-primary" style="padding:10px 24px;font-size:13px" onclick="connectBwell()">Connect Health Records</button>
          <span id="bwell-status" style="font-size:11px;color:#64748B"></span>
        </div>
      </div>

      <div id="bwell-connected" style="display:none">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="color:#22C55E;font-size:18px">&#x2713;</span>
          <span style="color:#22C55E;font-weight:700">Connected via b.well</span>
          <span id="bwell-record-count" style="font-size:11px;color:#94A3B8;margin-left:8px"></span>
        </div>
        <div id="bwell-data-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>
        <button class="btn btn-outline" style="margin-top:12px;font-size:11px;padding:6px 16px" onclick="refreshBwellData()">Refresh Data</button>
      </div>
    </div>

    <!-- Supported EHR systems info -->
    <div style="margin-top:16px;background:#1E293B;border:1px solid #334155;border-radius:8px;padding:14px">
      <div style="font-size:11px;color:#94A3B8;margin-bottom:8px;font-weight:600">Supported Health Systems (via b.well)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${['Epic MyChart', 'Cerner', 'Allscripts', 'athenahealth', 'eClinicalWorks', 'Meditech', 'NextGen', 'Greenway', 'DrChrono', 'Practice Fusion'].map(n =>
          '<span style="padding:3px 8px;border-radius:4px;background:#0F172A;font-size:10px;color:#64748B">' + n + '</span>'
        ).join('')}
        <span style="padding:3px 8px;border-radius:4px;background:#0F172A;font-size:10px;color:#E8751A">+ 640 more</span>
      </div>
      <div style="font-size:10px;color:#475569;margin-top:8px">b.well connects to 650+ EHR systems including Epic, Cerner, Allscripts, and athenahealth. Labs, vitals, medications, conditions, allergies, immunizations, and encounters — all in one connection.</div>
    </div>
    </div>

    <!-- ── WEARABLES (ROOK) ── -->
    <div class="connect-sub" id="connect-wearables" style="display:none">
    <div class="section-title">Connect Your Wearables & Devices</div>
    <p style="font-size:12px;color:#94A3B8;margin-bottom:16px">1-click connect to 400+ wearables via ROOK. Click your device, authorize with your account, and data syncs automatically.</p>

    <!-- Source status indicator -->
    <div id="rook-status" style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:8px">
      <div style="width:8px;height:8px;border-radius:50%;background:#FBBF24"></div>
      <span style="font-size:12px;color:#94A3B8">Loading wearable status...</span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px" id="rook-grid">
      ${[
        { id: 'oura', icon: '&#x1F48D;', name: 'Oura Ring', desc: 'Sleep, HRV, readiness, temperature' },
        { id: 'whoop', icon: '&#x1F4AA;', name: 'WHOOP', desc: 'Strain, recovery, sleep, HRV' },
        { id: 'dexcom', icon: '&#x1FA78;', name: 'Dexcom CGM', desc: 'Continuous glucose monitoring' },
        { id: 'garmin', icon: '&#x1F3C3;', name: 'Garmin', desc: 'Activity, sleep, stress, body battery' },
        { id: 'fitbit', icon: '&#x231A;', name: 'Fitbit', desc: 'Steps, HR, sleep, SpO2' },
        { id: 'withings', icon: '&#x2696;&#xFE0F;', name: 'Withings', desc: 'Weight, BP, sleep, ECG, temp' },
        { id: 'polar', icon: '&#x2744;&#xFE0F;', name: 'Polar', desc: 'HR, training load, sleep, recovery' },
        { id: 'apple_health', icon: '&#x1F34E;', name: 'Apple Health', desc: 'Steps, HR, HRV, sleep, SpO2' },
        { id: 'google_fit', icon: '&#x1F4F1;', name: 'Google Fit', desc: 'Activity, sleep, heart rate' },
        { id: 'health_connect', icon: '&#x1F4F2;', name: 'Health Connect', desc: 'Android unified health (Samsung, Pixel)' },
        { id: 'android', icon: '&#x1F916;', name: 'Android SDK', desc: 'Direct device sensors' },
      ].map(d => `
        <div class="card rook-source" id="rook-${d.id}" data-source="${d.id}" style="cursor:pointer;text-align:center;padding:16px" onclick="connectRook('${d.id}', this)">
          <div style="font-size:28px;margin-bottom:8px">${d.icon}</div>
          <h3 style="font-size:13px;margin-bottom:4px">${d.name}</h3>
          <p style="font-size:10px;color:#64748B;margin-bottom:8px">${d.desc}</p>
          <span class="badge" id="rook-badge-${d.id}" style="font-size:9px">CONNECT</span>
        </div>
      `).join('')}
    </div>
    <p style="font-size:10px;color:#475569;margin-top:12px">Connected via ROOK (tryrook.io) — 400+ devices. You authorize with your wearable account. Data syncs automatically via webhooks.</p>
    </div>
    <div class="connect-sub" id="connect-labs" style="display:none">
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
    <div class="connect-sub" id="connect-genomics" style="display:none">
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
    <div class="connect-sub" id="connect-microbiome" style="display:none">
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
    <!-- ── UK NHS ── -->
    <div class="connect-sub" id="connect-nhs" style="display:none">
    <div class="section-title">United Kingdom — NHS</div>
    <div class="card" style="margin-bottom:16px;padding:24px;border-color:#E8751A33">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#00559922;display:flex;align-items:center;justify-content:center;font-size:28px">🏥</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect via NHS App</h3>
          <p style="font-size:12px;color:#64748B">GP records, prescriptions, test results, vaccinations</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:16px">Access your GP records through the NHS GP Connect API. Log in with your NHS login credentials to pull prescriptions, test results, allergies, and immunization records.</p>
      <button class="btn btn-primary" style="padding:12px 24px" onclick="window.open('https://www.nhs.uk/nhs-app/','_blank')">Open NHS App Login</button>
      <p style="font-size:10px;color:#475569;margin-top:8px">Connected via GP Connect Patient Facing FHIR API. UK GDPR compliant.</p>
    </div>
    </div>

    <!-- ── EU EHDS ── -->
    <div class="connect-sub" id="connect-eu-ehds" style="display:none">
    <div class="section-title">Europe — EU Health Data Space</div>
    <div class="card" style="margin-bottom:16px;padding:24px;border-color:#E8751A33">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#003DA522;display:flex;align-items:center;justify-content:center;font-size:28px">🇪🇺</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">European Health Data Space</h3>
          <p style="font-size:12px;color:#64748B">Cross-border health records via MyHealth@EU</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:12px">The EHDS enables patients to access their health data electronically across EU member states. Select your country below:</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
        ${['🇫🇷 France (Mon Espace Sante)', '🇩🇪 Germany (ePA)', '🇳🇱 Netherlands (MedMij)', '🇩🇰 Denmark (Sundhed.dk)', '🇸🇪 Sweden (1177)', '🇫🇮 Finland (Kanta)', '🇪🇪 Estonia (X-Road)', '🇳🇴 Norway (Helsenorge)', '🇦🇹 Austria (ELGA)'].map(c =>
          '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:10px;text-align:center;font-size:11px;color:#CBD5E1;cursor:pointer" onclick="alert(this.textContent + \' coming soon\')">' + c + '</div>'
        ).join('')}
      </div>
      <p style="font-size:10px;color:#475569">EHDS regulation adopted 2025. Implementation by member states 2027-2029. Early access available for Denmark, Finland, and Estonia.</p>
    </div>
    </div>

    <!-- ── CANADA ── -->
    <div class="connect-sub" id="connect-canada-health" style="display:none">
    <div class="section-title">Canada — Provincial Health Records</div>
    <div class="card" style="margin-bottom:16px;padding:24px;border-color:#E8751A33">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#FF000022;display:flex;align-items:center;justify-content:center;font-size:28px">🍁</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect Provincial Health Portal</h3>
          <p style="font-size:12px;color:#64748B">Health records vary by province</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:12px">Canada uses provincial health systems. Select your province to connect:</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
        ${['🏔 Ontario (MyChart / OLIS)', '🌲 British Columbia (Health Gateway)', '🏔 Alberta (MyHealth Records)', '❄️ Quebec (Carnet Sante)'].map(p =>
          '<div class="card" style="padding:12px;cursor:pointer;text-align:center;font-size:12px" onclick="alert(this.textContent + \' connect coming soon\')">' + p + '</div>'
        ).join('')}
      </div>
      <p style="font-size:10px;color:#475569">Ontario uses Epic MyChart (same as US). BC Health Gateway has open FHIR API. Alberta MyHealth Records and Quebec Carnet Sante are province-specific portals.</p>
    </div>
    </div>

    <!-- ── ISRAEL ── -->
    <div class="connect-sub" id="connect-clalit" style="display:none">
    <div class="section-title">Israel — Health Funds (Kupot Holim)</div>
    <div class="card" style="margin-bottom:16px;padding:24px;border-color:#E8751A33">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#0038B822;display:flex;align-items:center;justify-content:center;font-size:28px">🇮🇱</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect Your Health Fund</h3>
          <p style="font-size:12px;color:#64748B">Clalit, Maccabi, Meuhedet, Leumit — 20+ years of records</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
        <div class="card" style="padding:12px;cursor:pointer;text-align:center" onclick="window.open('https://www.clalit.co.il','_blank')"><div style="font-size:20px;margin-bottom:4px">🏥</div><div style="font-size:12px;font-weight:600">Clalit</div><div style="font-size:10px;color:#64748B">4.7M members</div></div>
        <div class="card" style="padding:12px;cursor:pointer;text-align:center" onclick="window.open('https://www.maccabi4u.co.il','_blank')"><div style="font-size:20px;margin-bottom:4px">🏥</div><div style="font-size:12px;font-weight:600">Maccabi</div><div style="font-size:10px;color:#64748B">2.5M members</div></div>
        <div class="card" style="padding:12px;cursor:pointer;text-align:center" onclick="window.open('https://www.meuhedet.co.il','_blank')"><div style="font-size:20px;margin-bottom:4px">🏥</div><div style="font-size:12px;font-weight:600">Meuhedet</div><div style="font-size:10px;color:#64748B">1.3M members</div></div>
        <div class="card" style="padding:12px;cursor:pointer;text-align:center" onclick="window.open('https://www.leumit.co.il','_blank')"><div style="font-size:20px;margin-bottom:4px">🏥</div><div style="font-size:12px;font-weight:600">Leumit</div><div style="font-size:10px;color:#64748B">750K members</div></div>
      </div>
      <p style="font-size:10px;color:#475569">Log in to your health fund portal and export your records. Israel has 20+ years of complete longitudinal EHR data — among the most valuable in the world.</p>
    </div>
    </div>

    <!-- ── AUSTRALIA ── -->
    <div class="connect-sub" id="connect-myhealthrecord" style="display:none">
    <div class="section-title">Australia — My Health Record</div>
    <div class="card" style="margin-bottom:16px;padding:24px;border-color:#E8751A33">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#00008B22;display:flex;align-items:center;justify-content:center;font-size:28px">🦘</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect My Health Record</h3>
          <p style="font-size:12px;color:#64748B">National opt-out health record — 90% of Australians</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:16px">Access your Medicare records, prescriptions, pathology results, and hospital discharge summaries through the My Health Record system.</p>
      <button class="btn btn-primary" style="padding:12px 24px" onclick="window.open('https://www.myhealthrecord.gov.au','_blank')">Open My Health Record</button>
      <p style="font-size:10px;color:#475569;margin-top:8px">Connected via Australian Digital Health Agency FHIR APIs. Privacy Act 1988 compliant.</p>
    </div>
    </div>

    <!-- ── SOUTH KOREA MyHealthWay ── -->
    <div class="connect-sub" id="connect-myhealthway" style="display:none">
    <div class="section-title">South Korea — MyHealthWay (나의건강길)</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🇰🇷 <strong>For users in South Korea:</strong> Connect your health records from 860+ hospitals and clinics via the MyHealthWay national health data platform. Access 113 types of health data including surgery reports, pathology, and prescriptions.
    </div>

    <div class="card" style="margin-bottom:16px;border-color:#E8751A33;padding:24px">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#0066B322;display:flex;align-items:center;justify-content:center;font-size:28px">🏥</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect via MyHealthWay</h3>
          <p style="font-size:12px;color:#64748B">Korean National Health Information Highway — Ministry of Health and Welfare</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:16px">
        Log in with your MyHealthWay account to pull your complete medical records from all linked Korean hospitals, clinics, and labs. Includes 113 standardized health data types in FHIR format.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="korea-id" placeholder="Enter your MyHealthWay ID or national health insurance number" style="flex:1;padding:12px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:14px">
        <button class="btn btn-primary" style="padding:12px 24px;white-space:nowrap" onclick="connectMyHealthWay()">Connect</button>
      </div>
      <p style="font-size:10px;color:#475569">Register at <a href="https://www.healthwaykorea.kr" target="_blank" style="color:#E8751A">healthwaykorea.kr</a> if you do not have an account.</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">🏨</div>
        <h3 style="font-size:13px;margin-bottom:4px">860+ Hospitals</h3>
        <p style="font-size:10px;color:#64748B">Tertiary, general, and specialty hospitals</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">📋</div>
        <h3 style="font-size:13px;margin-bottom:4px">113 Data Types</h3>
        <p style="font-size:10px;color:#64748B">Surgery, pathology, labs, imaging, prescriptions</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">🔬</div>
        <h3 style="font-size:13px;margin-bottom:4px">FHIR R4 Standard</h3>
        <p style="font-size:10px;color:#64748B">International Patient Summary (IPS) compatible</p>
      </div>
    </div>

    <p style="font-size:10px;color:#475569">Connected via Korean Health Information Highway. Compliant with PIPA (Personal Information Protection Act). FHIR IPS data pipeline.</p>
    </div>

    <!-- ── INDIA ABDM ── -->
    <div class="connect-sub" id="connect-abdm" style="display:none">
    <div class="section-title">India — Ayushman Bharat Digital Mission (ABDM)</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🇮🇳 <strong>For users in India:</strong> Connect your health records from any ABDM-linked hospital, clinic, or lab. 600M+ Indians have an ABHA health ID. Your records are shared only with your explicit consent via the ABHA app.
    </div>

    <div class="card" style="margin-bottom:16px;border-color:#E8751A33;padding:24px">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:56px;height:56px;border-radius:12px;background:#FF671F22;display:flex;align-items:center;justify-content:center;font-size:28px">🏥</div>
        <div>
          <h3 style="font-size:18px;margin-bottom:4px">Connect via ABHA</h3>
          <p style="font-size:12px;color:#64748B">Ayushman Bharat Health Account — Government of India</p>
        </div>
      </div>
      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-bottom:16px">
        Enter your ABHA address (e.g., yourname@abdm) below. XSpan will send a consent request to your ABHA app. Once you approve, your health records from all linked hospitals, clinics, and labs will be securely transferred to your local device.
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="abdm-abha-address" placeholder="Enter your ABHA address (e.g., yourname@abdm)" style="flex:1;padding:12px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:14px">
        <button class="btn btn-primary" style="padding:12px 24px;white-space:nowrap" onclick="connectABDM()">Connect</button>
      </div>
      <p style="font-size:10px;color:#475569">Do not have an ABHA ID? Create one at <a href="https://abha.abdm.gov.in" target="_blank" style="color:#E8751A">abha.abdm.gov.in</a></p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px">
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">📋</div>
        <h3 style="font-size:13px;margin-bottom:4px">OPD Records</h3>
        <p style="font-size:10px;color:#64748B">Consultations, prescriptions, follow-ups</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">🧪</div>
        <h3 style="font-size:13px;margin-bottom:4px">Lab Reports</h3>
        <p style="font-size:10px;color:#64748B">Blood tests, diagnostics, pathology</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">💊</div>
        <h3 style="font-size:13px;margin-bottom:4px">Prescriptions</h3>
        <p style="font-size:10px;color:#64748B">Medications, dosage, pharmacy records</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">🏨</div>
        <h3 style="font-size:13px;margin-bottom:4px">Discharge Summaries</h3>
        <p style="font-size:10px;color:#64748B">Hospital stays, procedures, surgery notes</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">💉</div>
        <h3 style="font-size:13px;margin-bottom:4px">Immunizations</h3>
        <p style="font-size:10px;color:#64748B">Vaccination records, CoWIN integration</p>
      </div>
      <div class="card" style="text-align:center;padding:16px">
        <div style="font-size:28px;margin-bottom:8px">🩺</div>
        <h3 style="font-size:13px;margin-bottom:4px">Wellness Records</h3>
        <p style="font-size:10px;color:#64748B">Vitals, BMI, lifestyle assessments</p>
      </div>
    </div>

    <p style="font-size:10px;color:#475569">Connected via ABDM Health Information Exchange. Data transferred with patient consent only. Compliant with India Digital Personal Data Protection Act 2023.</p>
    </div>

    </div> <!-- end right content -->
    </div> <!-- end flex container -->
  </div> <!-- end page-connect -->

  <!-- ═══ SUBSCRIPTION ═══ -->
  <div class="page" id="page-subscription">
    <div class="section-title">XSpan Premium</div>
    <p style="font-size:14px;color:#94A3B8;margin-bottom:24px">Advanced health intelligence delivered through your health system or physician. Request access below.</p>
    <div style="display:flex;gap:24px;align-items:flex-start">
      <!-- LEFT: Value Proposition -->
      <div style="width:380px;flex-shrink:0">
        <div class="card" style="margin-bottom:12px;border-color:#E8751A33">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">📱</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Mobile App (iOS &amp; Android)</h3>
              <p style="font-size:12px;color:#94A3B8">Automatically connect all wearables via Apple HealthKit / Android Health Connect. One tap setup — Oura, WHOOP, Garmin, Fitbit, Dexcom, Apple Watch.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#E8751A33">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">🧬</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Digital Twin for Predictive Risk Detection</h3>
              <p style="font-size:12px;color:#94A3B8">AI-powered whole-body model that predicts cardiovascular, metabolic, sleep disorder, and burnout risk before symptoms appear.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#E8751A33">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">💡</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">3x Daily AI Nudges</h3>
              <p style="font-size:12px;color:#94A3B8">Morning, midday, and evening personalized nudges — sleep optimization, nutrition guidance, stress management, activity reminders.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#E8751A33">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">🥗</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Meal Tracking &amp; Recommendations</h3>
              <p style="font-size:12px;color:#94A3B8">AI-powered natural language meal parsing with personalized nutrition recommendations based on your biomarker profile.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#7C3AED33">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">🏥</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Physician / Health System Programs</h3>
              <p style="font-size:12px;color:#94A3B8">Structured care programs for Cardiometabolic, Cardiovascular, Gastroenterology, and Weight Management — supervised by your health system.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#05966933">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">📊</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Weekly Health Passport</h3>
              <p style="font-size:12px;color:#94A3B8">Comprehensive PDF with overall health score, category scores, trends, and physician-ready summary.</p>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:12px;border-color:#EF444433">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-size:32px">🚨</div>
            <div>
              <h3 style="font-size:15px;margin-bottom:4px">Escalation Pathway to Primary Care</h3>
              <p style="font-size:12px;color:#94A3B8">When risk scores cross thresholds, automatic escalation to your PCP or care team with relevant health data summary.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Ask Your Doctor -->
      <div style="flex:1">
        <div class="card" style="border-color:#E8751A44;position:sticky;top:20px">
          <div style="text-align:center;margin-bottom:20px">
            <div style="font-size:40px;margin-bottom:8px">👨‍⚕️</div>
            <h3 style="font-size:18px;margin-bottom:4px">Ask Your Doctor for XSpan</h3>
            <p style="font-size:12px;color:#94A3B8">XSpan Premium is available through your health system, physician, or benefits broker.</p>
          </div>

          <label style="font-size:12px;font-weight:600;color:#CBD5E1;display:block;margin-bottom:6px">Email to your physician:</label>
          <textarea id="premium-email-body" style="width:100%;height:140px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:12px;padding:12px;resize:none;line-height:1.6;font-family:inherit">Hi Doctor,

I'd like to use XSpan Agentic-AI for my preventive health and chronic care management. I would like to receive an invite code for their mobile app.

Name: ${currentUser?.name || '[Your Name]'}
Insurance/MRN: [Your Insurance Number or MRN]

Thank you.</textarea>

          <label style="font-size:12px;font-weight:600;color:#CBD5E1;display:block;margin:16px 0 6px">Your physician or broker's email:</label>
          <input type="email" id="physician-email" placeholder="doctor@hospital.com" style="width:100%;padding:12px;background:#0F172A;border:1px solid #334155;border-radius:8px;color:#E2E8F0;font-size:13px">

          <button id="premium-send-btn" class="btn btn-primary" style="width:100%;margin-top:16px;font-size:14px;padding:14px" onclick="sendPremiumEmail()">Open Email to Send to Your Doctor</button>

          <p style="font-size:10px;color:#64748B;margin-top:8px;text-align:center">This will open your default email app (Gmail, Outlook, Apple Mail) with the message pre-filled.</p>

          <div style="margin-top:16px;padding:12px;background:#0F172A;border-radius:8px;font-size:11px;color:#64748B;line-height:1.6">
            <strong style="color:#94A3B8">Why an invite code?</strong><br>
            XSpan Premium mobile app is available through participating health systems and physicians. Your doctor can request an invite code for you, which ensures your care team is connected and can receive your Health Passport and escalation alerts.
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ═══ CONTRIBUTE ═══ -->
  <div class="page" id="page-contribute">

    <!-- Hero -->
    <div style="text-align:center;padding:40px 0 32px">
      <div style="font-size:56px;margin-bottom:16px">🔬</div>
      <h2 style="font-size:28px;font-weight:800;color:#fff;margin-bottom:12px">XSpan Contribute</h2>
      <p style="font-size:16px;color:#94A3B8;max-width:560px;margin:0 auto;line-height:1.7">
        Help advance medical research with your de-identified health insights — and get rewarded for it.
      </p>
    </div>

    <!-- Value Prop Cards -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px">
      <div class="card" style="text-align:center;border-color:#05966933">
        <div style="font-size:36px;margin-bottom:12px">🛡️</div>
        <h3 style="margin-bottom:8px">Completely De-Identified</h3>
        <p style="font-size:12px">Your data is stripped of all 18 HIPAA identifiers <strong>on your device</strong> before it ever leaves. No one — not even XSpan — can trace it back to you.</p>
      </div>
      <div class="card" style="text-align:center;border-color:#E8751A33">
        <div style="font-size:36px;margin-bottom:12px">💰</div>
        <h3 style="margin-bottom:8px">You Earn 50%</h3>
        <p style="font-size:12px">Half of every research contribution goes directly to you. The rest supports your health system and community health initiatives.</p>
      </div>
      <div class="card" style="text-align:center;border-color:#7C3AED33">
        <div style="font-size:36px;margin-bottom:12px">🧬</div>
        <h3 style="margin-bottom:8px">Accelerate Research</h3>
        <p style="font-size:12px">Your de-identified health insights help researchers develop better treatments, design clinical trials, and advance preventive medicine.</p>
      </div>
    </div>

    <!-- How It Works -->
    <div class="card" style="margin-bottom:24px;border-color:#334155">
      <h3 style="font-size:18px;margin-bottom:20px">How It Works</h3>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;text-align:center">
        <div>
          <div style="width:48px;height:48px;border-radius:50%;background:#E8751A22;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:20px;font-weight:800;color:#E8751A">1</div>
          <p style="font-size:12px;color:#CBD5E1;font-weight:600">You opt in</p>
          <p style="font-size:11px;color:#64748B;margin-top:4px">Choose which health categories to contribute</p>
        </div>
        <div>
          <div style="width:48px;height:48px;border-radius:50%;background:#E8751A22;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:20px;font-weight:800;color:#E8751A">2</div>
          <p style="font-size:12px;color:#CBD5E1;font-weight:600">De-identified on your device</p>
          <p style="font-size:11px;color:#64748B;margin-top:4px">All 18 HIPAA identifiers removed locally — nothing identifiable leaves</p>
        </div>
        <div>
          <div style="width:48px;height:48px;border-radius:50%;background:#E8751A22;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:20px;font-weight:800;color:#E8751A">3</div>
          <p style="font-size:12px;color:#CBD5E1;font-weight:600">Researchers access it</p>
          <p style="font-size:11px;color:#64748B;margin-top:4px">Verified research organizations use it to advance medicine</p>
        </div>
        <div>
          <div style="width:48px;height:48px;border-radius:50%;background:#E8751A22;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:20px;font-weight:800;color:#E8751A">4</div>
          <p style="font-size:12px;color:#CBD5E1;font-weight:600">You get rewarded</p>
          <p style="font-size:11px;color:#64748B;margin-top:4px">50% of every contribution reward goes to you — withdraw to your bank anytime</p>
        </div>
      </div>
    </div>

    <!-- The Problem / Why This Matters -->
    <div class="card" style="margin-bottom:24px;background:linear-gradient(135deg,#1A1A2E,#1E293B);border-color:#7C3AED33">
      <h3 style="font-size:16px;margin-bottom:12px;color:#C4B5FD">Why This Matters</h3>
      <p style="font-size:13px;color:#94A3B8;line-height:1.8">
        Today, your health system already shares de-identified patient data with research organizations — it's how medical breakthroughs happen. But patients like you never see any of that value.
      </p>
      <p style="font-size:13px;color:#94A3B8;line-height:1.8;margin-top:12px">
        <strong style="color:#E2E8F0">XSpan Contribute changes that.</strong> You choose to share. You control what's included. Your data is de-identified right on your device. And for the first time, <strong style="color:#E8751A">you earn directly</strong> from contributing to the research that will shape the future of medicine.
      </p>
    </div>

    <!-- What's Included / Categories -->
    <div class="card" style="margin-bottom:24px">
      <h3 style="font-size:16px;margin-bottom:16px">Choose What to Contribute</h3>
      <p style="font-size:12px;color:#64748B;margin-bottom:16px">Select the health categories you're comfortable contributing. You can change these anytime.</p>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px" id="contribute-categories">
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> ❤️ Cardiovascular <span style="color:#64748B;font-size:11px;margin-left:auto">HR, HRV, BP, VO2</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 🔥 Metabolic <span style="color:#64748B;font-size:11px;margin-left:auto">Glucose, BMI</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 😴 Sleep <span style="color:#64748B;font-size:11px;margin-left:auto">Duration, stages, efficiency</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 🏃 Activity <span style="color:#64748B;font-size:11px;margin-left:auto">Steps, exercise, calories</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 🥗 Nutrition <span style="color:#64748B;font-size:11px;margin-left:auto">Macros, fiber, hydration</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 🧪 Lab Results <span style="color:#64748B;font-size:11px;margin-left:auto">HbA1c, lipids, vitamins</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" style="accent-color:#E8751A;width:16px;height:16px"> 🧬 Genomics Risk Tiers <span style="color:#64748B;font-size:11px;margin-left:auto">Low/Med/High only</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" checked style="accent-color:#E8751A;width:16px;height:16px"> 📊 Risk Scores <span style="color:#64748B;font-size:11px;margin-left:auto">Cardio, metabolic, sleep</span>
        </label>
      </div>
    </div>

    <!-- Privacy Assurance -->
    <div class="hipaa-note" style="margin-bottom:24px;flex-direction:column;align-items:start;gap:12px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">🔒</span>
        <strong>Your Privacy Is Absolute</strong>
      </div>
      <div style="font-size:12px;color:#6EE7B7;line-height:1.8">
        ✓ All 18 HIPAA identifiers removed <strong>on your device</strong> — before anything leaves<br>
        ✓ No names, dates, locations, or IDs are ever shared<br>
        ✓ Additional privacy layers: k-anonymity, differential privacy, temporal scrambling<br>
        ✓ You can revoke consent and delist instantly — anytime<br>
        ✓ Research organizations are prohibited from attempting re-identification<br>
        ✓ Your health system already does this — now <strong>you</strong> get to choose and benefit
      </div>
    </div>

    <!-- Earnings Preview -->
    <div class="card" style="margin-bottom:24px;border-color:#E8751A33">
      <h3 style="font-size:16px;margin-bottom:16px">Indicative Contribution Rewards</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
        <div style="background:#0F172A;padding:16px;border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#E8751A">$12 – $75*</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">estimated per contribution (vitals + labs)</div>
        </div>
        <div style="background:#0F172A;padding:16px;border-radius:8px;text-align:center">
          <div style="font-size:24px;font-weight:800;color:#E8751A">$300 – $750*</div>
          <div style="font-size:11px;color:#64748B;margin-top:4px">estimated per contribution (12-month comprehensive)</div>
        </div>
      </div>
      <p style="font-size:11px;color:#64748B;margin-top:12px;text-align:center">
        You receive <strong style="color:#E8751A">50%</strong> of every contribution. The rest supports your health system and community health research.
      </p>
      <p style="font-size:9px;color:#475569;margin-top:8px;text-align:center;line-height:1.5">
        *Amounts shown are indicative estimates only based on industry benchmarks and are not guaranteed. Actual contribution rewards depend on research partner demand, data completeness, dataset type, and market conditions. XSpan makes no guarantee of any minimum earnings. See Terms of Service for details.
      </p>
    </div>

    <!-- CTA -->
    <div id="contribute-cta" style="text-align:center;padding:24px 0">
      <button class="btn btn-primary" style="font-size:18px;padding:18px 48px;border-radius:12px" onclick="startContribute()">
        Opt In to Contribute
      </button>
      <p style="font-size:12px;color:#64748B;margin-top:12px">Voluntary. Revoke anytime. No impact on your XSpan health features.</p>
    </div>

    <!-- Enrolled Status (hidden by default, shown after opt-in) -->
    <div id="contribute-enrolled" style="display:none">
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat-card">
          <div class="value" id="contribute-earnings">$0.00</div>
          <div class="label">Total Rewards Earned</div>
        </div>
        <div class="stat-card">
          <div class="value" id="contribute-listings">0</div>
          <div class="label">Active Contributions</div>
        </div>
        <div class="stat-card">
          <div class="value" id="contribute-status" style="font-size:16px;color:#22C55E">Enrolled</div>
          <div class="label">Contribution Status</div>
        </div>
      </div>
      <div style="text-align:center;margin-top:16px">
        <button class="btn btn-secondary" style="font-size:12px" onclick="revokeContribute()">Revoke Consent &amp; Delist</button>
      </div>
    </div>

    <!-- For Health Systems Banner -->
    <div class="card" style="margin-top:32px;background:linear-gradient(135deg,#0F172A,#1A1A2E);border-color:#05966933">
      <div style="display:flex;align-items:start;gap:16px">
        <div style="font-size:36px">🏥</div>
        <div>
          <h3 style="font-size:15px;margin-bottom:8px;color:#6EE7B7">For Health Systems &amp; Providers</h3>
          <p style="font-size:12px;color:#94A3B8;line-height:1.7">
            Partner with XSpan to give your patients the ability to contribute to medical research on their terms — and share in the rewards. Your patients choose voluntarily. Their data is de-identified on-device. And your organization earns a revenue share while advancing the research mission.
          </p>
          <p style="font-size:12px;color:#94A3B8;line-height:1.7;margin-top:8px">
            You can also access de-identified research data from the program for your own research initiatives.
          </p>
          <a href="mailto:partnerships@xspan.ai" style="display:inline-block;margin-top:12px;font-size:12px;color:#E8751A;text-decoration:underline">Learn about the Research Data Contribution Program →</a>
        </div>
      </div>
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
  // Hide all pages
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); p.style.display = 'none'; });
  document.querySelectorAll('.nav a').forEach(function(a) { a.classList.remove('active'); });
  // Show target page
  var target = document.getElementById('page-' + id);
  if (target) { target.classList.add('active'); target.style.display = 'block'; }
  if (el) el.classList.add('active');
}

// filterEHR removed — b.well handles all EHR connections now

// ── ROOK Wearable Connect ───────────────────────────────────
// 1-click wearable connection via ROOK (tryrook.io)

async function connectRook(source, btn) {
  btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'Connecting...';
  try {
    var res = await fetch('/api/rook/authorize?source=' + source);
    var data = await res.json();
    if (data.authorized) {
      btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'CONNECTED';
      btn.querySelector('.badge, [id^="rook-badge"]').style.background = '#05966922';
      btn.querySelector('.badge, [id^="rook-badge"]').style.color = '#6EE7B7';
      btn.style.borderColor = '#22C55E44';
      return;
    }
    if (data.authorization_url) {
      window.open(data.authorization_url, '_blank');
      btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'Waiting...';
      // Poll for connection
      for (var i = 0; i < 60; i++) {
        await new Promise(function(r) { setTimeout(r, 3000); });
        var check = await fetch('/api/rook/status');
        var status = await check.json();
        if (status.sources && status.sources[source]) {
          btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'CONNECTED';
          btn.querySelector('.badge, [id^="rook-badge"]').style.background = '#05966922';
          btn.querySelector('.badge, [id^="rook-badge"]').style.color = '#6EE7B7';
          btn.style.borderColor = '#22C55E44';
          loadRookStatus();
          return;
        }
      }
      btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'CONNECT';
    } else {
      btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'ERROR';
    }
  } catch (err) {
    btn.querySelector('.badge, [id^="rook-badge"]').textContent = 'CONNECT';
    console.error('ROOK connect error:', err);
  }
}

async function loadRookStatus() {
  try {
    var res = await fetch('/api/rook/status');
    var data = await res.json();
    var sources = data.sources || {};
    var connected = 0;
    var total = 0;
    for (var src in sources) {
      total++;
      var badge = document.getElementById('rook-badge-' + src);
      var card = document.getElementById('rook-' + src);
      if (sources[src]) {
        connected++;
        if (badge) { badge.textContent = 'CONNECTED'; badge.style.background = '#05966922'; badge.style.color = '#6EE7B7'; }
        if (card) { card.style.borderColor = '#22C55E44'; }
      }
    }
    var statusEl = document.getElementById('rook-status');
    if (statusEl) {
      if (connected > 0) {
        statusEl.innerHTML = '<div style="width:8px;height:8px;border-radius:50%;background:#22C55E"></div><span style="font-size:12px;color:#22C55E;font-weight:600">' + connected + ' of ' + total + ' sources connected</span>';
      } else {
        statusEl.innerHTML = '<div style="width:8px;height:8px;border-radius:50%;background:#64748B"></div><span style="font-size:12px;color:#94A3B8">No wearables connected yet. Click a device to start.</span>';
      }
    }
  } catch (err) { console.error('ROOK status error:', err); }
}

// Load ROOK status on page load and auto-sync wearable data
setTimeout(loadRookStatus, 1000);
setTimeout(syncRookData, 2000);

// Poll Vercel webhook for ROOK wearable data every 5 minutes
setInterval(syncRookData, 300000);

async function syncRookData() {
  try {
    var res = await fetch('/api/rook/sync');
    var data = await res.json();
    if (data.stored > 0) {
      console.log('ROOK: synced ' + data.stored + ' samples from ' + data.webhookEntries + ' webhook entries');
      // Reload to show new data in charts
      setTimeout(function() { location.reload(); }, 1500);
    }
  } catch(e) {}
}

// Auto-connect b.well on page load using stored credentials
setTimeout(async function() {
  // First check if already connected (session survived)
  try {
    var checkRes = await fetch('/api/bwell/records');
    var checkData = await checkRes.json();
    if (checkData.success && checkData.total > 0) {
      showBwellConnected(checkData);
      return;
    }
  } catch(e) {}

  // Try auto-login with production credentials
  try {
    var loginRes = await fetch('/api/bwell/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'karlmehta@gmail.com', password: 'Krsna@108' })
    });
    var loginData = await loginRes.json();
    if (loginData.success) {
      var recRes = await fetch('/api/bwell/records');
      var recData = await recRes.json();
      if (recData.success && recData.total > 0) {
        showBwellConnected(recData);
      }
    }
  } catch(e) {}
}, 500);

function showBwellConnected(data) {
  var loginForm = document.getElementById('bwell-login-form');
  var connPanel = document.getElementById('bwell-connected');
  var countEl = document.getElementById('bwell-record-count');
  var summaryEl = document.getElementById('bwell-data-summary');
  if (loginForm) loginForm.style.display = 'none';
  if (connPanel) connPanel.style.display = 'block';
  if (countEl) countEl.textContent = data.total + ' records synced';
  if (summaryEl) {
    var cats = data.categories || {};
    var catLabels = { Observation: 'Labs & Vitals', Condition: 'Conditions', MedicationRequest: 'Medications', MedicationStatement: 'Medications', AllergyIntolerance: 'Allergies', Immunization: 'Immunizations', Encounter: 'Visits', Procedure: 'Procedures', DiagnosticReport: 'Lab Reports' };
    var catIcons = { Observation: '&#x1F4CA;', Condition: '&#x1F3E5;', MedicationRequest: '&#x1F48A;', MedicationStatement: '&#x1F48A;', AllergyIntolerance: '&#x26A0;', Immunization: '&#x1F489;', Encounter: '&#x1F4C5;', Procedure: '&#x1FA7A;', DiagnosticReport: '&#x1F9EA;' };
    var html = '';
    for (var cat in cats) {
      if (cats[cat] > 0 && catLabels[cat]) {
        html += '<div style="background:#1E293B;border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;margin-bottom:4px">' + (catIcons[cat] || '&#x1F4CA;') + '</div><div style="font-size:18px;font-weight:800;color:#E8751A">' + cats[cat] + '</div><div style="font-size:10px;color:#94A3B8">' + (catLabels[cat] || cat) + '</div></div>';
      }
    }
    summaryEl.innerHTML = html;
  }
}

// ── b.well Connected Health ─────────────────────────────────
// Primary EHR connection via b.well — 2.4M+ providers

async function connectBwell() {
  var email = document.getElementById('bwell-email').value.trim();
  var password = document.getElementById('bwell-password').value;
  var statusEl = document.getElementById('bwell-status');
  if (!email || !password) { statusEl.textContent = 'Enter email and password'; statusEl.style.color = '#EF4444'; return; }

  statusEl.textContent = 'Connecting...';
  statusEl.style.color = '#FBBF24';

  try {
    var res = await fetch('/api/bwell/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    });
    var data = await res.json();
    if (!data.success) {
      statusEl.textContent = data.error || 'Login failed';
      statusEl.style.color = '#EF4444';
      return;
    }

    statusEl.textContent = 'Authenticated. Fetching health records...';
    statusEl.style.color = '#22C55E';

    // Now fetch all health data
    var recRes = await fetch('/api/bwell/records');
    var recData = await recRes.json();

    if (recData.success && recData.total > 0) {
      // Show connected state
      document.getElementById('bwell-login-form').style.display = 'none';
      document.getElementById('bwell-connected').style.display = 'block';
      document.getElementById('bwell-record-count').textContent = recData.total + ' records retrieved';

      // Build summary cards
      var summaryEl = document.getElementById('bwell-data-summary');
      var cats = recData.categories || {};
      var html = '';
      var catIcons = {
        Observation: '&#x1F4CA;', Condition: '&#x1F3E5;', MedicationRequest: '&#x1F48A;', MedicationStatement: '&#x1F48A;',
        AllergyIntolerance: '&#x26A0;&#xFE0F;', Immunization: '&#x1F489;', Encounter: '&#x1F4C5;',
        Procedure: '&#x1FA7A;', CarePlan: '&#x1F4CB;', DiagnosticReport: '&#x1F9EA;',
        Composition: '&#x1F4C4;', DocumentReference: '&#x1F4C4;', Specimen: '&#x1F9EB;',
        ServiceRequest: '&#x1F4DD;', Practitioner: '&#x1F468;&#x200D;&#x2695;&#xFE0F;',
        Goal: '&#x1F3AF;', CareTeam: '&#x1F91D;', Location: '&#x1F4CD;'
      };
      var catLabels = {
        Observation: 'Labs & Vitals', Condition: 'Conditions', MedicationRequest: 'Medications', MedicationStatement: 'Medications',
        AllergyIntolerance: 'Allergies', Immunization: 'Immunizations', Encounter: 'Visits',
        Procedure: 'Procedures', CarePlan: 'Care Plans', DiagnosticReport: 'Lab Reports'
      };
      for (var cat in cats) {
        if (cats[cat] > 0 && catLabels[cat]) {
          html += '<div style="background:#1E293B;border-radius:8px;padding:10px;text-align:center">' +
            '<div style="font-size:18px;margin-bottom:4px">' + (catIcons[cat] || '&#x1F4CA;') + '</div>' +
            '<div style="font-size:18px;font-weight:800;color:#E8751A">' + cats[cat] + '</div>' +
            '<div style="font-size:10px;color:#94A3B8">' + (catLabels[cat] || cat) + '</div></div>';
        }
      }
      summaryEl.innerHTML = html;

      // Reload page after brief delay to refresh Insights with new data
      setTimeout(function() { location.reload(); }, 3000);
    } else {
      statusEl.textContent = 'Connected but no health records found. Have you linked a provider in b.well?';
      statusEl.style.color = '#FBBF24';
    }
  } catch (err) {
    statusEl.textContent = 'Connection error: ' + (err.message || 'Network failure');
    statusEl.style.color = '#EF4444';
  }
}

async function refreshBwellData() {
  var statusEl = document.getElementById('bwell-record-count');
  statusEl.textContent = 'Refreshing...';
  try {
    var res = await fetch('/api/bwell/records');
    var data = await res.json();
    statusEl.textContent = data.total + ' records (refreshed)';
    if (data.total > 0) { setTimeout(function() { location.reload(); }, 1500); }
  } catch (err) {
    statusEl.textContent = 'Refresh failed';
  }
}

// ── EHR connection now handled entirely by b.well ───────────
// Direct SMART on FHIR removed — b.well connects to 650+ EHR
// systems (Epic, Cerner, Allscripts, athenahealth, etc.)

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
  // Poll for 30 seconds (15 iterations)
  for (let i = 0; i < 15; i++) {
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

  // Timeout — show helpful message with manual connect option
  showModal(
    'Complete Connection — ' + id,
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:40px;margin-bottom:12px">🔗</div>' +
    '<p style="color:#FBBF24;font-size:15px;font-weight:700;margin-bottom:12px">Almost there!</p>' +
    '<p style="color:#94A3B8;font-size:13px;line-height:1.7;margin-bottom:16px">' +
    'If you have already logged in and authorized XSpan in the other tab, click the button below to complete the connection.' +
    '</p>' +
    '<p style="color:#64748B;font-size:11px;line-height:1.6">' +
    'Note: Some wearable providers require you to complete login and grant access in the browser tab that opened. ' +
    'Once done, come back here and click "I Have Authorized — Connect Now".' +
    '</p>' +
    '</div>',
    '<button class="btn btn-primary" style="width:100%" data-provider="' + id + '" onclick="manualConnect(this.dataset.provider)">I Have Authorized — Connect Now</button>'
  );
}

async function manualConnect(id) {
  var btn = document.querySelector('#modal-buttons .btn-primary');
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  try {
    var res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'wearable', id: id, name: id, method: 'manual_auth' }),
    });
    var data = await res.json();
    if (data.success) {
      showModal(id, '<div style="text-align:center;padding:20px"><div style="font-size:48px;margin-bottom:16px">✅</div><p style="color:#22C55E;font-size:16px;font-weight:700">Connected!</p><p style="color:#94A3B8;font-size:12px;margin-top:8px">Data sync will begin shortly.</p></div>', '');
      setTimeout(function() { closeModal(); location.reload(); }, 2000);
    }
  } catch {
    btn.textContent = 'I Have Authorized — Connect Now';
    btn.disabled = false;
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

// ── Contribute: Opt-in / Revoke ──────────────────────────────

async function startContribute() {
  showModal(
    'Enroll in XSpan Contribute',
    '<div style="padding:4px">' +
    '<div style="text-align:center;margin-bottom:16px"><div style="font-size:40px;margin-bottom:8px">🔬</div>' +
    '<p style="color:#CBD5E1;font-size:14px">Please review and accept the following to enroll.</p></div>' +

    '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">' +

    '<label id="chk-tos" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-tos" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(&quot;tos&quot;)" style="color:#E8751A;text-decoration:underline">Terms of Service</a></span>' +
    '</label>' +

    '<label id="chk-privacy" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-privacy" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(&quot;privacy&quot;)" style="color:#E8751A;text-decoration:underline">Privacy Policy</a></span>' +
    '</label>' +

    '<label id="chk-consent" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-consent" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(&quot;consent&quot;)" style="color:#E8751A;text-decoration:underline">Data Contributor Consent</a></span>' +
    '</label>' +

    '<label id="chk-rewards" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-rewards" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I understand the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(&quot;rewards&quot;)" style="color:#E8751A;text-decoration:underline">Contribution Rewards</a> (50% to me, rest supports health system &amp; community)</span>' +
    '</label>' +

    '</div>' +

    '<div style="background:#05966911;border:1px solid #05966933;border-radius:8px;padding:12px;font-size:11px;color:#6EE7B7;line-height:1.6;margin-bottom:12px">' +
    'Your data is de-identified on your device before it ever leaves. All 18 HIPAA identifiers are removed. You can revoke consent anytime. No cost to you.' +
    '</div>' +

    '</div>',
    '<button class="btn btn-primary" id="btn-enroll" style="flex:2;opacity:0.4;cursor:not-allowed" disabled onclick="confirmContribute()">Accept All &amp; Enroll</button>'
  );
}

// ── Country Selector for Connect tab ─────────────────────────

function selectCountry(country, btn) {
  // Update button styles
  document.querySelectorAll('.country-btn').forEach(function(b) {
    b.style.background = 'transparent';
    b.style.color = '#94A3B8';
  });
  btn.style.background = '#2A8A6E';
  btn.style.color = '#fff';

  // Show/hide sidebar nav items based on country
  document.querySelectorAll('.connect-nav-item').forEach(function(item) {
    var countries = (item.dataset.countries || '').split(',');
    if (countries.includes(country) || country === 'all') {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });

  // Auto-select first visible nav item
  var firstVisible = document.querySelector('.connect-nav-item[style*="display: flex"], .connect-nav-item[style*="display:flex"]');
  if (firstVisible) {
    var tabId = '';
    // Extract tab id from onclick
    var onclickStr = firstVisible.getAttribute('onclick') || '';
    var parts = onclickStr.split("showConnectTab(");
    if (parts[1]) { tabId = parts[1].replace(/[^a-z0-9-]/g, '').split(',')[0]; }
    if (tabId) showConnectTab(tabId, firstVisible);
  }
}

// ── MyHealthWay: Connect Korean health records ───────────────

function connectMyHealthWay() {
  var userId = document.getElementById('korea-id').value.trim();
  if (!userId) { alert('Please enter your MyHealthWay ID'); return; }

  showModal(
    'Connect via MyHealthWay',
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:48px;margin-bottom:12px">🇰🇷</div>' +
    '<p style="color:#22C55E;font-size:15px;font-weight:700;margin-bottom:8px">Connection initiated!</p>' +
    '<p style="color:#94A3B8;font-size:13px;line-height:1.6;margin-bottom:16px">You will be redirected to the MyHealthWay authentication portal. Log in with your credentials and authorize MyHealthSpan Agent to access your health records.</p>' +
    '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px;font-size:11px;color:#64748B">' +
    'MyHealthWay ID: <strong style="color:#E8751A">' + userId + '</strong><br>' +
    'Records: Surgery, pathology, labs, imaging, prescriptions (113 types)' +
    '</div>' +
    '</div>',
    ''
  );

  fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'myhealthway', id: 'myhealthway', name: 'South Korea MyHealthWay (' + userId + ')', method: 'myhealthway', userId: userId }),
  });
}

// ── ABDM: Connect Indian health records ──────────────────────

function connectABDM() {
  var abhaAddress = document.getElementById('abdm-abha-address').value.trim();
  if (!abhaAddress) { alert('Please enter your ABHA address'); return; }
  if (!abhaAddress.includes('@')) { abhaAddress = abhaAddress + '@abdm'; }

  showModal(
    'Connect via ABDM',
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:48px;margin-bottom:12px">🇮🇳</div>' +
    '<p style="color:#22C55E;font-size:15px;font-weight:700;margin-bottom:8px">Consent request sent!</p>' +
    '<p style="color:#94A3B8;font-size:13px;line-height:1.6;margin-bottom:16px">Open your <strong>ABHA app</strong> on your phone and approve the consent request from XSpan. Once approved, your health records will be transferred to your local device.</p>' +
    '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px;font-size:11px;color:#64748B">' +
    'ABHA Address: <strong style="color:#E8751A">' + abhaAddress + '</strong><br>' +
    'Records requested: OPD, Labs, Prescriptions, Discharge Summaries, Immunizations' +
    '</div>' +
    '</div>',
    ''
  );

  // Send to backend (will connect when ABDM credentials are configured)
  fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'abdm', id: 'abdm', name: 'India ABDM (' + abhaAddress + ')', method: 'abdm_consent', abhaAddress: abhaAddress }),
  });
}

// ── Premium: Open mailto to physician ─────────────────────────

function sendPremiumEmail() {
  var email = document.getElementById('physician-email').value;
  var body = document.getElementById('premium-email-body').value;
  if (!email) { alert('Please enter your physician or broker email address'); return; }
  var subject = encodeURIComponent('Request for XSpan HealthAI Premium Access');
  var mailBody = encodeURIComponent(body);
  window.open('mailto:' + email + '?subject=' + subject + '&body=' + mailBody, '_self');
}

// ── Charts: Initialize on page load ──────────────────────────

(function initCharts() {
  var gc = '#1E293B';
  var tc = '#475569';
  var baseOpts = function(showLegend) {
    return {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: showLegend, labels: { color: '#94A3B8', font: { size: 10 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: tc, font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: gc } },
        y: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } }
      }
    };
  };
  function ds(label, data, color, dash) {
    return { label: label, data: data, borderColor: color, borderWidth: 2, tension: 0.3, pointRadius: 1.5, fill: false, spanGaps: true, borderDash: dash || [] };
  }

  // Generate placeholder labels (last 30 days)
  var placeholderLabels = [];
  for (var i = 29; i >= 0; i--) {
    var dt = new Date(); dt.setDate(dt.getDate() - i);
    placeholderLabels.push((dt.getMonth()+1) + '/' + dt.getDate());
  }
  var emptyData = placeholderLabels.map(function() { return null; });

  fetch('/api/chart-data')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var hasData = d.labels && d.labels.length >= 2;
      var labels = hasData ? d.labels.map(function(l) { return l.slice(5); }) : placeholderLabels;
      var empty = !hasData;

      // Helper: check if a data array has any non-null values
      function hasValues(arr) { return arr && arr.some(function(v) { return v !== null && v !== undefined; }); }

      // Cardiovascular: HR + BP from EHR
      var cardioCtx = document.getElementById('chart-cardio');
      if (cardioCtx) {
        var cardioSets = [];
        if (hasValues(d.restingHr)) cardioSets.push(ds('Resting HR (bpm)', d.restingHr, '#EF4444'));
        if (hasValues(d.hrv)) cardioSets.push(ds('HRV (ms)', d.hrv, '#22C55E'));
        if (hasValues(d.bpSystolic)) cardioSets.push(ds('BP Systolic', d.bpSystolic, '#A78BFA', [5,5]));
        if (hasValues(d.bpDiastolic)) cardioSets.push(ds('BP Diastolic', d.bpDiastolic, '#60A5FA', [5,5]));
        if (cardioSets.length === 0) { cardioSets.push(ds('No data — connect wearable or EHR', emptyData, '#33415544', [6,4])); cardioCtx.parentElement.style.opacity = '0.5'; }
        new Chart(cardioCtx, { type: 'line', data: { labels: labels, datasets: cardioSets }, options: baseOpts(true) });
      }

      // Sleep: from wearables (ROOK)
      var sleepCtx = document.getElementById('chart-sleep');
      if (sleepCtx) {
        var sleepSets = [];
        if (hasValues(d.sleep)) sleepSets.push(ds('Sleep (hrs)', d.sleep.map(function(v) { return v ? +(v/60).toFixed(1) : null; }), '#6EE7B7'));
        if (hasValues(d.sleepEfficiency)) sleepSets.push(ds('Efficiency (%)', d.sleepEfficiency, '#A78BFA', [4,4]));
        if (sleepSets.length === 0) { sleepSets.push(ds('Awaiting Oura/WHOOP data', emptyData, '#33415544', [6,4])); sleepCtx.parentElement.style.opacity = '0.5'; }
        new Chart(sleepCtx, { type: 'line', data: { labels: labels, datasets: sleepSets }, options: baseOpts(true) });
      }

      // Metabolic: Glucose + HbA1c + Cholesterol from EHR labs
      var metaCtx = document.getElementById('chart-metabolic');
      if (metaCtx) {
        var metaSets = [];
        if (hasValues(d.glucose)) metaSets.push(ds('Glucose (mg/dL)', d.glucose, '#EF4444'));
        if (hasValues(d.hba1c)) metaSets.push(ds('HbA1c (%)', d.hba1c, '#FBBF24'));
        if (hasValues(d.cholesterol)) metaSets.push(ds('Total Chol', d.cholesterol, '#A78BFA', [4,4]));
        if (hasValues(d.triglycerides)) metaSets.push(ds('Triglycerides', d.triglycerides, '#FB923C', [4,4]));
        if (metaSets.length === 0) { metaSets.push(ds('No metabolic data', emptyData, '#33415544', [6,4])); metaCtx.parentElement.style.opacity = '0.5'; }
        new Chart(metaCtx, { type: 'line', data: { labels: labels, datasets: metaSets }, options: baseOpts(true) });
      }

      // Activity: Steps from wearables
      var actCtx = document.getElementById('chart-activity');
      if (actCtx) {
        var actSets = [];
        if (hasValues(d.steps)) actSets.push(ds('Steps', d.steps, '#FBBF24'));
        if (actSets.length === 0) { actSets.push(ds('Awaiting wearable data', emptyData, '#33415544', [6,4])); actCtx.parentElement.style.opacity = '0.5'; }
        new Chart(actCtx, { type: 'line', data: { labels: labels, datasets: actSets }, options: baseOpts(false) });
      }

      // Body / Lipids: LDL + HDL from EHR labs
      var bodyCtx = document.getElementById('chart-body');
      if (bodyCtx) {
        var bodySets = [];
        if (hasValues(d.ldl)) bodySets.push(ds('LDL (mg/dL)', d.ldl, '#EF4444'));
        if (hasValues(d.hdl)) bodySets.push(ds('HDL (mg/dL)', d.hdl, '#22C55E'));
        if (hasValues(d.weight)) bodySets.push(ds('Weight', d.weight, '#E8751A', [4,4]));
        if (bodySets.length === 0) { bodySets.push(ds('No data', emptyData, '#33415544', [6,4])); bodyCtx.parentElement.style.opacity = '0.5'; }
        new Chart(bodyCtx, { type: 'line', data: { labels: labels, datasets: bodySets }, options: baseOpts(true) });
      }
    })
    .catch(function() {
      // Even on error, render empty greyed-out charts
      ['chart-cardio','chart-sleep','chart-metabolic','chart-activity','chart-body'].forEach(function(id) {
        var ctx = document.getElementById(id);
        if (ctx) {
          new Chart(ctx, { type: 'line', data: { labels: placeholderLabels, datasets: [ds('No data', emptyData, '#33415566', [6,4])] }, options: baseOpts(false) });
          ctx.parentElement.style.opacity = '0.5';
        }
      });
    });
})();

// Terra removed — all wearables now via ROOK (tryrook.io)

// ── EHR Records: Load on page load ───────────────────────────

(function loadEhrRecords() {
  var el = document.getElementById('ehr-records-content');
  if (!el) return;

  fetch('/api/ehr-records')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.total === 0) {
        el.innerHTML = '<p style="color:#64748B;font-size:12px">No health records yet. Connect a health system from the <strong>Connect</strong> tab to see your labs, vitals, and conditions here.</p>';
        return;
      }

      var html = '';

      // Vitals
      if (data.vitals.length > 0) {
        html += '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;color:#6EE7B7;margin-bottom:8px">Vitals</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
        data.vitals.forEach(function(r) {
          html += '<div style="background:#0F172A;padding:10px;border-radius:8px">' +
            '<div style="font-size:11px;color:#94A3B8">' + r.data_type + '</div>' +
            '<div style="font-size:18px;font-weight:700;color:#E8751A">' + (typeof r.value === 'number' ? r.value.toFixed(1) : r.value) + ' <span style="font-size:11px;color:#64748B">' + (r.unit || '') + '</span></div>' +
            '<div style="font-size:9px;color:#475569">' + (r.recorded_at ? r.recorded_at.split('T')[0] : '') + ' · EHR</div>' +
            '</div>';
        });
        html += '</div></div>';
      }

      // Labs
      if (data.labs.length > 0) {
        html += '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;color:#FBBF24;margin-bottom:8px">Lab Results</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">';
        data.labs.forEach(function(r) {
          html += '<div style="background:#0F172A;padding:10px;border-radius:8px">' +
            '<div style="font-size:11px;color:#94A3B8">' + r.data_type + '</div>' +
            '<div style="font-size:18px;font-weight:700;color:#E8751A">' + (typeof r.value === 'number' ? r.value.toFixed(1) : r.value) + ' <span style="font-size:11px;color:#64748B">' + (r.unit || '') + '</span></div>' +
            '<div style="font-size:9px;color:#475569">' + (r.recorded_at ? r.recorded_at.split('T')[0] : '') + ' · Lab</div>' +
            '</div>';
        });
        html += '</div></div>';
      }

      // Other
      if (data.other.length > 0) {
        html += '<div><div style="font-size:12px;font-weight:600;color:#C4B5FD;margin-bottom:8px">Other Records</div>';
        data.other.slice(0, 9).forEach(function(r) {
          html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1E293B;font-size:12px">' +
            '<span style="color:#CBD5E1">' + r.data_type + '</span>' +
            '<span style="color:#E8751A;font-weight:600">' + (typeof r.value === 'number' ? r.value.toFixed(1) : r.value) + ' ' + (r.unit || '') + '</span>' +
            '</div>';
        });
        html += '</div>';
      }

      el.innerHTML = html;
    })
    .catch(function() {
      el.innerHTML = '<p style="color:#64748B;font-size:12px">Could not load health records.</p>';
    });
})();

// ── Navigate to Connect tab with specific sub-tab ────────────

function goToConnect(subTab) {
  showPage('connect', document.querySelectorAll('.nav a')[1]);
  setTimeout(function() {
    var items = document.querySelectorAll('.connect-nav-item');
    var map = { ehr: 0, 'health-systems': 0, wearables: 1, labs: 2, genomics: 3, microbiome: 4, abdm: 5 };
    var tabName = subTab === 'ehr' ? 'health-systems' : subTab;
    var idx = map[tabName] ?? 0;
    if (items[idx]) showConnectTab(tabName, items[idx]);
  }, 50);
}

// ── Connect: Sub-tab switching ───────────────────────────────

function showConnectTab(id, el) {
  document.querySelectorAll('.connect-sub').forEach(function(p) { p.style.display = 'none'; });
  document.querySelectorAll('.connect-nav-item').forEach(function(a) { a.style.background = 'transparent'; a.style.color = '#94A3B8'; });
  var target = document.getElementById('connect-' + id);
  if (target) target.style.display = 'block';
  if (el) { el.style.background = '#E8751A22'; el.style.color = '#E8751A'; }
}

// ── Demo: Load synthetic data ────────────────────────────────

async function loadDemoData(btn) {
  btn.textContent = 'Loading demo data...';
  btn.disabled = true;
  try {
    var res = await fetch('/api/demo/load', { method: 'POST' });
    var data = await res.json();
    if (data.success) {
      showModal(
        'Demo Data Loaded',
        '<div style="text-align:center;padding:16px">' +
        '<div style="font-size:48px;margin-bottom:12px">🎉</div>' +
        '<p style="color:#22C55E;font-size:16px;font-weight:700;margin-bottom:8px">30 days of sample health data loaded!</p>' +
        '<p style="color:#94A3B8;font-size:13px">Refreshing dashboard to show your personalized insights, trends, and health intelligence preview.</p>' +
        '<p style="color:#FBBF24;font-size:11px;margin-top:12px">All data is clearly marked as demo. Connect real sources to see your actual health data.</p>' +
        '</div>',
        ''
      );
      setTimeout(function() { window.location.reload(); }, 2500);
    } else {
      btn.textContent = 'Load Demo Data';
      btn.disabled = false;
      showModal('Error', '<p style="color:#EF4444">' + (data.error || 'Could not load demo data') + '</p>', '');
    }
  } catch (e) {
    btn.textContent = 'Load Demo Data';
    btn.disabled = false;
    showModal('Error', '<p style="color:#EF4444">Could not connect to load demo data.</p>', '');
  }
}

// ── Demo: Exit demo mode ─────────────────────────────────────

async function exitDemoMode(btn) {
  btn.textContent = 'Clearing demo data...';
  btn.disabled = true;
  try {
    var res = await fetch('/api/demo/clear', { method: 'POST' });
    var data = await res.json();
    if (data.success) {
      showModal(
        'Demo Data Cleared',
        '<div style="text-align:center;padding:16px">' +
        '<div style="font-size:48px;margin-bottom:12px">🔗</div>' +
        '<p style="color:#22C55E;font-size:16px;font-weight:700;margin-bottom:12px">Ready for your real data!</p>' +
        '<p style="color:#94A3B8;font-size:13px;line-height:1.7">Now connect your health sources to see your actual personalized health intelligence. Click <strong style="color:#E8751A">Connect</strong> in the nav bar to get started.</p>' +
        '</div>',
        '<button class="btn btn-primary" onclick="closeModal();goToConnect(&quot;health-systems&quot;)">Go to Connect</button>'
      );
      setTimeout(function() { window.location.reload(); }, 3000);
    }
  } catch (e) {
    btn.textContent = 'Exit Demo → Connect Real Data';
    btn.disabled = false;
  }
}

// ── Today: Load drift data on page load ──────────────────────

(function loadDrift() {
  var el = document.getElementById('drift-content');
  if (!el) return;
  fetch('/api/today/drift')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.drifts || data.drifts.length === 0) {
        el.innerHTML = '<p style="color:#64748B;font-size:12px">Not enough data yet for trend detection. Check back after a few days of connected data.</p>';
        return;
      }
      el.innerHTML = data.drifts.map(function(d) {
        var color = d.direction === 'up' ? (d.field === 'Resting HR' || d.field === 'Weight' ? '#EF4444' : '#22C55E') : (d.field === 'HRV' || d.field === 'Sleep' || d.field === 'Steps' ? '#EF4444' : '#22C55E');
        var arrow = d.direction === 'up' ? '↑' : '↓';
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1E293B">' +
          '<span style="font-size:18px">' + d.icon + '</span>' +
          '<span style="flex:1;font-size:13px;color:#CBD5E1">' + d.field + '</span>' +
          '<span style="font-size:13px;color:' + color + ';font-weight:700">' + arrow + ' ' + Math.abs(d.change) + '%</span>' +
          '<span style="font-size:11px;color:#64748B">' + d.previous + ' → ' + d.current + '</span>' +
          '</div>';
      }).join('');
    })
    .catch(function() {
      el.innerHTML = '<p style="color:#64748B;font-size:12px">Could not load trends.</p>';
    });
})();

function checkEnrollReady() {
  var all = document.getElementById('cb-tos').checked &&
            document.getElementById('cb-privacy').checked &&
            document.getElementById('cb-consent').checked &&
            document.getElementById('cb-rewards').checked;
  var btn = document.getElementById('btn-enroll');
  btn.disabled = !all;
  btn.style.opacity = all ? '1' : '0.4';
  btn.style.cursor = all ? 'pointer' : 'not-allowed';
}

function showLegalDoc(docType) {
  var titles = { tos: 'Terms of Service', privacy: 'Privacy Policy', consent: 'Data Contributor Consent', rewards: 'Contribution Rewards' };
  var title = titles[docType] || docType;

  fetch('/api/contribute/legal/' + docType)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      // Show in a new modal-like overlay within the page
      var overlay = document.createElement('div');
      overlay.id = 'legal-doc-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:200;display:flex;justify-content:center;align-items:center';
      overlay.innerHTML =
        '<div style="background:#1E293B;border:1px solid #E8751A;border-radius:16px;padding:32px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
        '<h2 style="font-size:18px;color:#fff">' + title + '</h2>' +
        '<button onclick="document.getElementById(&quot;legal-doc-overlay&quot;).remove()" style="background:none;border:none;color:#64748B;font-size:24px;cursor:pointer">&times;</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#CBD5E1;line-height:1.8;white-space:pre-wrap">' + (data.content || 'Document not available.') + '</div>' +
        '</div>';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
    })
    .catch(function() {
      alert('Could not load document. Please try again.');
    });
}

async function confirmContribute() {
  closeModal();
  try {
    var res = await fetch('/api/contribute/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: getSelectedCategories() }),
    });
    var data = await res.json();
    if (data.success) {
      document.getElementById('contribute-cta').style.display = 'none';
      document.getElementById('contribute-enrolled').style.display = 'block';
      showModal(
        'Welcome to XSpan Contribute',
        '<div style="text-align:center;padding:16px">' +
        '<div style="font-size:56px;margin-bottom:16px">🎉</div>' +
        '<p style="color:#22C55E;font-size:18px;font-weight:700;margin-bottom:12px">You are enrolled!</p>' +
        '<p style="color:#94A3B8;font-size:13px;line-height:1.7">Your first contribution will be posted automatically. You will see your rewards appear here as research organizations access your de-identified data.</p>' +
        '</div>',
        ''
      );
    } else {
      showModal('Error', '<p style="color:#EF4444">' + (data.error || 'Could not enroll. Please try again.') + '</p>', '');
    }
  } catch (e) {
    showModal('Error', '<p style="color:#EF4444">Could not connect to XSpan. Is the server running?</p>', '');
  }
}

async function revokeContribute() {
  if (!confirm('Are you sure you want to revoke consent? All active contributions will be delisted. Data from completed contributions cannot be recalled.')) return;
  try {
    var res = await fetch('/api/contribute/revoke', { method: 'POST' });
    var data = await res.json();
    if (data.success) {
      document.getElementById('contribute-cta').style.display = 'block';
      document.getElementById('contribute-enrolled').style.display = 'none';
      showModal('Consent Revoked', '<div style="text-align:center;padding:16px"><div style="font-size:48px;margin-bottom:16px">✅</div><p style="color:#CBD5E1;font-size:14px">Your contributions have been delisted. You can re-enroll anytime.</p></div>', '');
    }
  } catch (e) {
    showModal('Error', '<p style="color:#EF4444">Could not revoke. Please try again.</p>', '');
  }
}

function getSelectedCategories() {
  var checkboxes = document.querySelectorAll('#contribute-categories input[type=checkbox]');
  var categories = ['cardiovascular','metabolic','sleep','activity','nutrition','labs','genomics','risk'];
  var selected = [];
  checkboxes.forEach(function(cb, i) { if (cb.checked) selected.push(categories[i]); });
  return selected;
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

  const callbackServer = createHttpsServer({ key: sslKey, cert: sslCert }, async (req, res) => {
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

        // Find the pending provider with FHIR/token details
        let pendingProvider = '';
        let providerState: Record<string, unknown> = {};
        for (const [provider, s] of Object.entries(authState)) {
          const st = s as Record<string, unknown>;
          if (st.pending) {
            pendingProvider = provider;
            providerState = st;
            break;
          }
        }

        // Exchange code for access token
        const tokenUrl = (providerState.tokenUrl as string) || '';
        const clientId = (providerState.clientId as string) || '8ce98706-fcb3-4cd9-a4ad-b793ed96e375';
        const redirectUri = (providerState.callbackUrl as string) || `https://localhost:${OAUTH_CALLBACK_PORT}/callback`;
        const fhirBaseUrl = (providerState.fhirUrl as string) || '';

        let accessToken = '';
        let patientId = '';

        if (tokenUrl) {
          try {
            console.log(`[OAuth] Exchanging code at: ${tokenUrl}`);
            console.log(`[OAuth] redirect_uri: ${redirectUri}`);
            console.log(`[OAuth] client_id: ${clientId}`);
            console.log(`[OAuth] code: ${code.substring(0, 20)}...`);
            const tokenBody = new URLSearchParams({
              grant_type: 'authorization_code',
              code: code,
              redirect_uri: redirectUri,
              client_id: clientId,
            }).toString();
            const tokenResp = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenBody,
            });
            const tokenText = await tokenResp.text();
            console.log(`[OAuth] Token response status: ${tokenResp.status}`);
            console.log(`[OAuth] Token response: ${tokenText.substring(0, 200)}`);
            const tokenData = JSON.parse(tokenText) as Record<string, string>;
            accessToken = tokenData.access_token || '';
            patientId = tokenData.patient || '';
            if (accessToken) {
              console.log(`[OAuth] SUCCESS — Token received! Patient: ${patientId}`);
              // Decode JWT to see granted scopes
              try {
                const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
                console.log(`[OAuth] Token scopes: ${payload.scope || payload.scp || 'not in token'}`);
                console.log(`[OAuth] Token aud: ${payload.aud || 'none'}`);
              } catch {};
            } else {
              console.error(`[OAuth] FAILED — No access_token in response. Error: ${tokenData.error} ${tokenData.error_description || ''}`);
            }
          } catch (tokenErr) {
            console.error(`[OAuth] Token exchange failed:`, tokenErr);
          }
        }

        // Fetch FHIR data if we got a token
        if (accessToken && fhirBaseUrl) {
          try {
            // Strip trailing slash from base URL
            const fhirBase = fhirBaseUrl.replace(/\/+$/, '');
            console.log(`[OAuth] Fetching FHIR data from: ${fhirBase}`);

            // Fetch key resources — Epic uses category filters for Observations
            // Only fetch resources matching our registered Epic APIs:
            // AllergiesRead, MedicationRead, ObservationReadLabs, ObservationReadsVitals, PatientReadDiagnostics
            const resources = [
              { name: 'Observation', params: `patient=${patientId}&category=vital-signs&_count=100`, label: 'Vitals' },
              { name: 'Observation', params: `patient=${patientId}&category=laboratory&_count=100`, label: 'Lab Results' },
              { name: 'AllergyIntolerance', params: `patient=${patientId}&_count=100`, label: 'Allergies' },
              { name: 'MedicationRequest', params: `patient=${patientId}&_count=100`, label: 'Medications' },
              { name: 'DiagnosticReport', params: `patient=${patientId}&_count=50`, label: 'Diagnostic Reports' },
            ];
            let totalRecords = 0;

            for (const resource of resources) {
              try {
                const fhirUrl2 = `${fhirBase}/${resource.name}?${resource.params}`;
                console.log(`[OAuth] Fetching: ${fhirUrl2.substring(0, 120)}...`);
                const fhirResp = await fetch(
                  fhirUrl2,
                  { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/fhir+json' } }
                );
                if (!fhirResp.ok) {
                  const errText = await fhirResp.text();
                  const errHeaders = Object.fromEntries(fhirResp.headers.entries());
                  console.warn(`[OAuth] ${resource.name}: HTTP ${fhirResp.status}`);
                  console.warn(`[OAuth] Response body: ${errText.substring(0, 500)}`);
                  console.warn(`[OAuth] WWW-Authenticate: ${errHeaders['www-authenticate'] || 'none'}`);
                } else {
                  const bundle = await fhirResp.json() as { total?: number; entry?: unknown[] };
                  const count = bundle.entry?.length || 0;
                  totalRecords += count;
                  console.log(`[OAuth] ${resource.label || resource.name}: ${count} records (total in system: ${bundle.total ?? 'unknown'})`);

                  // Store observations as health samples
                  if (resource.name === 'Observation' && bundle.entry) {
                    for (const entry of bundle.entry as { resource: Record<string, unknown> }[]) {
                      const obs = entry.resource;
                      try {
                        const coding = ((obs.code as Record<string, unknown>)?.coding as { display?: string; code?: string }[])?.[0];
                        const value = (obs.valueQuantity as Record<string, unknown>)?.value as number;
                        const unit = (obs.valueQuantity as Record<string, unknown>)?.unit as string;
                        if (coding && value !== undefined) {
                          store.insertSample({
                            id: obs.id as string || Math.random().toString(36).slice(2),
                            source: 'ehr' as const,
                            dataType: coding.display || coding.code || 'unknown',
                            value: value,
                            unit: unit || '',
                            recordedAt: new Date((obs.effectiveDateTime as string) || Date.now()),
                          });
                        }
                      } catch {}
                    }
                    console.log(`[OAuth] Stored ${count} observation samples in local database`);
                  }
                }
              } catch (resourceErr) {
                console.warn(`[OAuth] Failed to fetch ${resource.name}:`, resourceErr);
              }
            }

            console.log(`[OAuth] Total FHIR records fetched: ${totalRecords}`);

            // Re-synthesize biomarkers with new data
            if (totalRecords > 0) {
              console.log(`[OAuth] Re-synthesizing biomarkers...`);
              await pipeline.synthesizeBiomarkers(store);
            }

          } catch (fhirErr) {
            console.error(`[OAuth] FHIR data fetch failed:`, fhirErr);
          }
        }

        if (!accessToken) {
          console.error(`[OAuth] No access token — cannot fetch FHIR data. Check token exchange logs above.`);
        }

        // Mark provider as connected
        for (const [provider, s] of Object.entries(authState)) {
          const st = s as Record<string, unknown>;
          if (st.pending) {
            st.connected = true;
            st.pending = false;
            console.log(`[OAuth] ${provider} connected successfully — ${accessToken ? 'data synced' : 'no token'}`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="background:#0B0F1A;color:#22C55E;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px"><div style="text-align:center"><h2>Connected Successfully!</h2><p>${accessToken ? 'Your health records have been synced.' : 'Connection established.'} You can close this tab and return to XSpan Dashboard.</p></div></body></html>`);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  try {
    callbackServer.listen(OAUTH_CALLBACK_PORT, '0.0.0.0', () => {
      console.log(`[OAuth] HTTPS callback server listening on https://localhost:${OAUTH_CALLBACK_PORT}/callback`);
    });
    callbackServer.on('error', (err: Error) => {
      console.warn(`[OAuth] HTTPS callback server failed: ${err.message} — EHR OAuth will not work until fixed`);
    });
  } catch (err) {
    console.warn(`[OAuth] Could not start HTTPS callback server — EHR OAuth will not work`);
  }

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

    // API: Sign Up — create account on XSpan cloud
    if (url === '/api/auth/signup' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', async () => {
        try {
          const { name, email, password } = JSON.parse(body);
          const apiUrl = config.xspan.apiUrl;
          const resp = await fetch(`${apiUrl}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password }),
          });
          const data = await resp.json() as Record<string, unknown>;
          if (resp.ok && data['api_key']) {
            currentUser = { email: email, name: name, apiKey: data['api_key'] as string, token: data['token'] as string, tier: 'free' };
            console.log(`[Auth] Account created: ${email}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: (data['detail'] as string) || 'Signup failed' }));
          }
        } catch (err) {
          console.error('[Auth] Signup error:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Cannot connect to XSpan Cloud at ' + config.xspan.apiUrl }));
        }
      });
      return;
    }

    // API: Sign In — authenticate with XSpan cloud
    if (url === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', async () => {
        try {
          const { email, password } = JSON.parse(body);
          const apiUrl = config.xspan.apiUrl;
          const resp = await fetch(`${apiUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const data = await resp.json() as Record<string, unknown>;
          if (resp.ok && data['token']) {
            currentUser = { email: email, name: (data['name'] as string) || email, apiKey: (data['api_key'] as string) || '', token: data['token'] as string, tier: (data['tier'] as string) || 'free' };
            console.log(`[Auth] Signed in: ${email} (${currentUser.tier})`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: (data['detail'] as string) || 'Invalid email or password' }));
          }
        } catch (err) {
          console.error('[Auth] Login error:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Cannot connect to XSpan Cloud at ' + config.xspan.apiUrl }));
        }
      });
      return;
    }

    // API: Sign Out
    if (url === '/api/auth/logout') {
      currentUser = null;
      res.writeHead(302, { 'Location': '/' });
      res.end();
      return;
    }

    // API: Demo — Load synthetic data
    if (url === '/api/demo/load' && req.method === 'POST') {
      try {
        // Dynamically import demo module
        const { generateDemoData } = await import('../demo/synthetic-data.js');
        const demo = generateDemoData();

        // Clear existing snapshots so demo data takes precedence
        try {
          store.db.prepare('DELETE FROM biomarker_snapshots').run();
          store.db.prepare('DELETE FROM nudges').run();
        } catch {}

        // Insert snapshots into store
        for (const snapshot of demo.snapshots) {
          store.insertSnapshot(snapshot);
        }

        // Insert nudges
        for (const nudge of demo.nudges) {
          store.insertNudge(nudge);
        }

        console.log(`[Demo] Loaded ${demo.snapshots.length} snapshots + ${demo.nudges.length} nudges`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, snapshots: demo.snapshots.length, nudges: demo.nudges.length }));
      } catch (err) {
        console.error('[Demo] Failed to load:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // Static: Serve logo
    if (url === '/logo.png') {
      try {
        const logoPath = join(dirname(fileURLToPath(import.meta.url)), 'xspan-logo.png');
        const logo = readFileSync(logoPath);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.end(logo);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // Terra removed — wearables handled by ROOK (/api/rook/*)

    // API: Premium — Send request to physician
    if (url === '/api/premium/request' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`[Premium] Invite request to: ${data.physicianEmail}`);
          console.log(`[Premium] Message: ${data.emailBody?.substring(0, 100)}...`);
          // TODO: Wire to actual email sending service
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Request sent to your physician.' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // API: EHR Records — recent health samples from connected health systems
    if (url === '/api/ehr-records') {
      try {
        const rows = store.db.prepare(
          'SELECT data_type, value, unit, recorded_at, source FROM health_samples ORDER BY recorded_at DESC LIMIT 500'
        ).all() as { data_type: string; value: number; unit: string; recorded_at: string; source: string }[];

        // Group by category
        const vitals: typeof rows = [];
        const labs: typeof rows = [];
        const other: typeof rows = [];
        const vitalKeywords = ['heart rate', 'blood pressure', 'systolic', 'diastolic', 'body temperature', 'respiratory', 'oxygen saturation', 'spo2', 'body weight', 'body height', 'bmi', 'body mass', 'pulse'];
        const labKeywords = ['cholesterol', 'glucose', 'hemoglobin', 'hba1c', 'creatinine', 'triglyceride', 'albumin', 'bilirubin', 'alkaline', 'ast', 'alt', 'tsh', 'thyroid', 'vitamin', 'iron', 'ferritin', 'calcium', 'sodium', 'potassium', 'chloride', 'co2', 'bun', 'urea', 'platelet', 'wbc', 'rbc', 'hematocrit', 'lymphocyte', 'neutrophil', 'egfr', 'glomerular', 'apolipoprotein', 'ldl', 'hdl', 'vldl', 'cortisol', 'testosterone', 'estradiol', 'insulin', 'psa', 'cea', 'magnesium', 'zinc', 'phosph', 'protein', 'globulin', 'lipase', 'amylase', 'uric', 'folate', 'b12', 'sed rate', 'esr', 'crp', 'homocysteine'];

        for (const r of rows) {
          const dt = r.data_type.toLowerCase();
          if (vitalKeywords.some(k => dt.includes(k))) {
            vitals.push(r);
          } else if (labKeywords.some(k => dt.includes(k)) || r.unit?.includes('/dL') || r.unit?.includes('/L') || r.unit?.includes('U/L') || r.unit?.includes('mIU') || r.unit?.includes('ng/')) {
            labs.push(r);
          } else {
            other.push(r);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: rows.length, vitals, labs, other }));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: 0, vitals: [], labs: [], other: [] }));
      }
      return;
    }

    // API: Chart data — built from health_samples directly (not snapshots)
    if (url === '/api/chart-data') {
      try {
        // First try snapshots (if any exist from demo mode)
        const snapshots = store.getSnapshots(30);
        if (snapshots.length >= 2) {
          const labels = snapshots.map(s => s.snapshotDate).reverse();
          const extract = (key: string) => snapshots.map(s => (s.biomarkers as Record<string, unknown>)[key] ?? null).reverse();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            labels,
            weight: extract('bodyMassKg'), bmi: extract('bodyMassIndex'),
            sleep: extract('totalSleepMinutes'), steps: extract('dailySteps'),
            hrv: extract('heartRateVariability'), stress: extract('stressIndex'),
            glucose: extract('bloodGlucoseFasting'),
            bpSystolic: extract('bloodPressureSystolic'), bpDiastolic: extract('bloodPressureDiastolic'),
            restingHr: extract('restingHeartRate'), sleepEfficiency: extract('sleepEfficiency'),
          }));
          return;
        }

        // No snapshots — build chart data from health_samples directly
        const rows = store.db.prepare(
          "SELECT data_type, value, unit, date(recorded_at) as day FROM health_samples WHERE recorded_at > datetime('now', '-90 days') ORDER BY recorded_at ASC"
        ).all() as { data_type: string; value: number; unit: string; day: string }[];

        // Group by date
        const byDate: Record<string, Record<string, number[]>> = {};
        for (const r of rows) {
          if (!byDate[r.day]) byDate[r.day] = {};
          const dt = r.data_type.toLowerCase();
          // Map FHIR display names to chart keys
          let key = '';
          if (dt.includes('heart rate') || dt.includes('pulse')) key = 'restingHr';
          else if (dt.includes('systolic') || (dt.includes('blood pressure') && r.value > 80)) key = 'bpSystolic';
          else if (dt.includes('diastolic') || (dt.includes('blood pressure') && r.value <= 80)) key = 'bpDiastolic';
          else if (dt.includes('glucose')) key = 'glucose';
          else if (dt.includes('hemoglobin a1c') || dt.includes('hba1c')) key = 'hba1c';
          else if (dt.includes('cholesterol') && !dt.includes('hdl') && !dt.includes('ldl') && !dt.includes('vldl')) key = 'cholesterol';
          else if (dt.includes('ldl')) key = 'ldl';
          else if (dt.includes('hdl')) key = 'hdl';
          else if (dt.includes('triglyceride')) key = 'triglycerides';
          else if (dt.includes('creatinine')) key = 'creatinine';
          else if (dt.includes('tsh') || dt.includes('thyrotropin')) key = 'tsh';
          else if (dt.includes('body weight') || dt.includes('body mass') || (dt.includes('weight') && r.unit?.includes('lb'))) key = 'weight';
          else if (dt.includes('spo2') || dt.includes('oxygen saturation')) key = 'spo2';
          if (key) {
            if (!byDate[r.day][key]) byDate[r.day][key] = [];
            byDate[r.day][key].push(r.value);
          }
        }

        const dates = Object.keys(byDate).sort();
        const labels = dates.map(d => d.slice(5)); // MM-DD
        const avg = (key: string) => dates.map(d => {
          const vals = byDate[d]?.[key];
          return vals?.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          labels,
          restingHr: avg('restingHr'),
          hrv: avg('hrv'),
          bpSystolic: avg('bpSystolic'),
          bpDiastolic: avg('bpDiastolic'),
          glucose: avg('glucose'),
          weight: avg('weight'),
          bmi: dates.map(() => null),
          sleep: dates.map(() => null),
          steps: dates.map(() => null),
          stress: dates.map(() => null),
          sleepEfficiency: dates.map(() => null),
          // Extra lab series
          cholesterol: avg('cholesterol'),
          ldl: avg('ldl'),
          hdl: avg('hdl'),
          triglycerides: avg('triglycerides'),
          hba1c: avg('hba1c'),
        }));
      } catch (err) {
        console.error('[Chart] Error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ labels: [] }));
      }
      return;
    }

    // API: Demo — Clear synthetic data
    if (url === '/api/demo/clear' && req.method === 'POST') {
      try {
        store.db.prepare("DELETE FROM biomarker_snapshots WHERE id LIKE 'demo-%'").run();
        store.db.prepare("DELETE FROM nudges WHERE id LIKE 'demo-%'").run();
        // Also clear any remaining snapshots to reset to clean state
        store.db.prepare('DELETE FROM biomarker_snapshots').run();
        store.db.prepare('DELETE FROM nudges').run();
        console.log('[Demo] Cleared all demo and synthetic data');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('[Demo] Clear failed:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // API: Today — Get drift/trend data
    if (url === '/api/today/drift') {
      try {
        const snapshots = store.getSnapshots(30);
        if (snapshots.length < 2) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ drifts: [], message: 'Need more data for trend detection' }));
          return;
        }

        // Simple drift computation (will be replaced by baseline engine)
        const recent = snapshots[0]?.biomarkers;
        const weekAgo = snapshots.length >= 7 ? snapshots[6]?.biomarkers : snapshots[snapshots.length - 1]?.biomarkers;
        const drifts: { field: string; icon: string; current: number; previous: number; change: number; direction: string }[] = [];

        const fields: { key: string; label: string; icon: string }[] = [
          { key: 'restingHeartRate', label: 'Resting HR', icon: '❤️' },
          { key: 'heartRateVariability', label: 'HRV', icon: '💓' },
          { key: 'totalSleepMinutes', label: 'Sleep', icon: '😴' },
          { key: 'dailySteps', label: 'Steps', icon: '🏃' },
          { key: 'sleepEfficiency', label: 'Sleep Efficiency', icon: '🌙' },
          { key: 'bodyMassKg', label: 'Weight', icon: '⚖️' },
        ];

        if (recent && weekAgo) {
          for (const f of fields) {
            const curr = (recent as Record<string, number | undefined>)[f.key];
            const prev = (weekAgo as Record<string, number | undefined>)[f.key];
            if (curr !== undefined && prev !== undefined && prev !== 0) {
              const changePct = Math.round(((curr - prev) / prev) * 100);
              if (Math.abs(changePct) >= 3) {
                drifts.push({
                  field: f.label,
                  icon: f.icon,
                  current: Math.round(curr * 10) / 10,
                  previous: Math.round(prev * 10) / 10,
                  change: changePct,
                  direction: changePct > 0 ? 'up' : 'down',
                });
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ drifts }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ drifts: [], error: 'Could not compute trends' }));
      }
      return;
    }

    // API: Today — Weekly summary
    if (url === '/api/today/weekly') {
      try {
        const snapshots = store.getSnapshots(14);
        const thisWeek = snapshots.slice(0, 7);
        const lastWeek = snapshots.slice(7, 14);

        const avg = (arr: { biomarkers: Record<string, any> }[], key: string) => {
          const vals = arr.map(s => s.biomarkers[key]).filter(v => v !== undefined) as number[];
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
        };

        const fields = ['restingHeartRate', 'heartRateVariability', 'totalSleepMinutes', 'dailySteps', 'sleepEfficiency'];
        const comparisons = fields.map(f => ({
          field: f,
          thisWeek: avg(thisWeek, f),
          lastWeek: avg(lastWeek, f),
          change: avg(thisWeek, f) && avg(lastWeek, f) ? Math.round(((avg(thisWeek, f)! - avg(lastWeek, f)!) / avg(lastWeek, f)!) * 100) : null,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ comparisons }));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ comparisons: [] }));
      }
      return;
    }

    // API: Contribute — Serve legal documents as HTML
    if (url.startsWith('/api/contribute/legal/')) {
      const docType = url.split('/').pop() ?? '';
      const docMap: Record<string, string> = {
        'tos': 'TERMS_OF_SERVICE.md',
        'privacy': 'PRIVACY_POLICY.md',
        'consent': 'DATA_CONTRIBUTOR_CONSENT.md',
        'rewards': 'REVENUE_SPLIT_SPECIFICATION.md',
      };
      const filename = docMap[docType];
      if (!filename) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Document not found' }));
        return;
      }
      try {
        const docPath = join(projectRoot, 'docs', 'legal', filename);
        const md = readFileSync(docPath, 'utf8');
        // Simple markdown → HTML: headings, bold, lists, paragraphs
        const html = md
          .replace(/^### (.*$)/gm, '<h3 style="color:#E8751A;margin:16px 0 8px">$1</h3>')
          .replace(/^## (.*$)/gm, '<h2 style="color:#fff;margin:20px 0 8px;font-size:16px">$1</h2>')
          .replace(/^# (.*$)/gm, '<h1 style="color:#fff;margin:24px 0 12px;font-size:20px">$1</h1>')
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#E2E8F0">$1</strong>')
          .replace(/^- (.*$)/gm, '<div style="padding-left:16px;margin:2px 0">• $1</div>')
          .replace(/^\| (.*) \|$/gm, (match) => {
            const cells = match.split('|').filter(c => c.trim()).map(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c))) return '';
            return '<div style="display:flex;gap:16px;padding:4px 0;font-size:11px">' + cells.map(c => '<span style="flex:1">' + c + '</span>').join('') + '</div>';
          })
          .replace(/^---$/gm, '<hr style="border-color:#334155;margin:16px 0">')
          .replace(/\n\n/g, '<br><br>');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: html }));
      } catch (err) {
        console.error('[Contribute] Error loading legal doc:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Could not load document' }));
      }
      return;
    }

    // API: Contribute — Enroll
    if (url === '/api/contribute/enroll' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`[Contribute] Enrollment request. Categories: ${data.categories?.join(', ')}`);
          // TODO: Wire to ContributeManager.grantConsent() + contributeData()
          authState['contribute'] = { connected: true, pending: false, startedAt: Date.now() };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Enrolled in XSpan Contribute. Your first contribution will be posted shortly.' }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
        }
      });
      return;
    }

    // API: Contribute — Revoke
    if (url === '/api/contribute/revoke' && req.method === 'POST') {
      console.log('[Contribute] Consent revocation request');
      // TODO: Wire to ContributeManager.revokeConsent()
      delete authState['contribute'];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Consent revoked. All contributions delisted.' }));
      return;
    }

    // API: Contribute — Status
    if (url === '/api/contribute/status') {
      const enrolled = authState['contribute']?.connected ?? false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enrolled, earnings: 0, activeListings: 0 }));
      return;
    }

    // ── ROOK Wearable API ─────────────────────────────────────────

    const ROOK_UUID = process.env.ROOK_CLIENT_UUID || 'ee022812-e8d1-4493-867e-faebb98316e9';
    const ROOK_SECRET = process.env.ROOK_SECRET_KEY || 'Hae7uoDZOAKTpyyAOWOKESVxPP6tyySukAxV';
    const ROOK_BASE = process.env.ROOK_ENVIRONMENT === 'production' ? 'https://api.rook-connect.com/api/v1' : 'https://api.rook-connect.review/api/v1';
    const ROOK_AUTH = 'Basic ' + Buffer.from(`${ROOK_UUID}:${ROOK_SECRET}`).toString('base64');
    const ROOK_USER = process.env.ROOK_USER_ID || 'karl001';

    // ROOK: Get auth URL for a wearable source
    if (url === '/api/rook/authorize') {
      const source = reqUrl.searchParams.get('source') || 'oura';
      try {
        const rookUrl = `${ROOK_BASE}/user_id/${ROOK_USER}/data_source/${source}/authorizer`;
        console.log(`[ROOK] Fetching: ${rookUrl}`);
        const resp = await fetch(rookUrl, {
          headers: { 'Authorization': ROOK_AUTH },
        });
        const respText = await resp.text();
        let data: Record<string, unknown>;
        try { data = JSON.parse(respText); } catch { data = { error: 'Invalid response', raw: respText.slice(0, 100) }; }
        console.log(`[ROOK] Authorize ${source}: authorized=${(data as Record<string, unknown>).authorized}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error(`[ROOK] Authorize error:`, err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to get auth URL' }));
      }
      return;
    }

    // ROOK: Get all source connection status
    if (url === '/api/rook/status') {
      try {
        const resp = await fetch(`${ROOK_BASE}/user_id/${ROOK_USER}/data_sources/authorized`, {
          headers: { 'Authorization': ROOK_AUTH },
        });
        const data = await resp.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sources: {} }));
      }
      return;
    }

    // ROOK: Webhook receiver (ROOK pushes health data here)
    if (url === '/api/rook/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          console.log(`[ROOK] Webhook received:`, JSON.stringify(payload).slice(0, 200));

          // Process and store the health data
          const userId = payload.user_id || '';
          const dataType = payload.data_type || payload.type || 'unknown';
          const source = payload.data_source || 'rook';

          // Store samples in local database
          let stored = 0;
          const data = payload.data || payload;
          if (data && typeof data === 'object') {
            const fields: Record<string, { type: string; unit: string }> = {
              steps: { type: 'steps', unit: 'count' },
              calories: { type: 'caloriesActive', unit: 'kcal' },
              hr_average: { type: 'heartRateResting', unit: 'bpm' },
              hrv_average: { type: 'hrvSdnn', unit: 'ms' },
              sleep_duration_seconds: { type: 'totalSleepMin', unit: 'min' },
              deep_sleep_seconds: { type: 'deepSleepMin', unit: 'min' },
              rem_sleep_seconds: { type: 'remSleepMin', unit: 'min' },
              spo2_average: { type: 'spo2', unit: '%' },
              temperature_delta: { type: 'skinTempDev', unit: 'C' },
              weight_kg: { type: 'weightKg', unit: 'kg' },
              blood_glucose_mg_dl: { type: 'bloodGlucose', unit: 'mg/dL' },
              blood_pressure_systolic: { type: 'bpSystolic', unit: 'mmHg' },
              blood_pressure_diastolic: { type: 'bpDiastolic', unit: 'mmHg' },
              vo2_max: { type: 'vo2Max', unit: 'mL/kg/min' },
            };

            for (const [key, meta] of Object.entries(fields)) {
              let val = (data as Record<string, unknown>)[key];
              if (val !== undefined && val !== null) {
                let numVal = Number(val);
                if (key.includes('seconds')) numVal = numVal / 60; // convert to minutes
                try {
                  store.insertSample({
                    id: Math.random().toString(36).slice(2),
                    source: 'wearable',
                    dataType: meta.type,
                    value: numVal,
                    unit: meta.unit,
                    metadata: { provider: source, via: 'rook' },
                    recordedAt: new Date((data as Record<string, string>).datetime || Date.now()),
                    syncedAt: new Date(),
                  });
                  stored++;
                } catch {}
              }
            }
          }

          if (stored > 0) {
            console.log(`[ROOK] Stored ${stored} samples from ${source} webhook`);
            try { pipeline.synthesizeBiomarkers(store); } catch {}
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, stored }));
        } catch (err) {
          console.error('[ROOK] Webhook error:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
        }
      });
      return;
    }

    // ROOK: Poll Vercel webhook for new data and store locally
    if (url === '/api/rook/sync') {
      try {
        const since = (authState as Record<string, Record<string, unknown>>)['rook_last_sync']?.timestamp as string || '2020-01-01T00:00:00Z';
        console.log(`[ROOK] Polling Vercel webhook for data since ${since}...`);
        const resp = await fetch(`https://research.xspan.ai/api/rook/webhook?user_id=${ROOK_USER}&since=${encodeURIComponent(since)}&limit=200`);
        const webhookData = await resp.json() as { data?: Array<{ payload: Record<string, unknown>; receivedAt: string; dataType: string; source: string }> };
        const entries = webhookData.data || [];

        let stored = 0;
        for (const entry of entries) {
          const p = entry.payload;
          const data = (p.data || p) as Record<string, unknown>;
          const fields: Record<string, { type: string; unit: string }> = {
            steps: { type: 'steps', unit: 'count' },
            calories: { type: 'caloriesActive', unit: 'kcal' },
            hr_average: { type: 'heartRateResting', unit: 'bpm' },
            hr_min: { type: 'heartRateMin', unit: 'bpm' },
            hr_max: { type: 'heartRateMax', unit: 'bpm' },
            hrv_average: { type: 'hrvSdnn', unit: 'ms' },
            sleep_duration_seconds: { type: 'totalSleepMin', unit: 'min' },
            deep_sleep_seconds: { type: 'deepSleepMin', unit: 'min' },
            rem_sleep_seconds: { type: 'remSleepMin', unit: 'min' },
            light_sleep_seconds: { type: 'lightSleepMin', unit: 'min' },
            sleep_score: { type: 'sleepScore', unit: 'score' },
            recovery_score: { type: 'recoveryScore', unit: 'score' },
            strain_score: { type: 'strainScore', unit: 'score' },
            spo2_average: { type: 'spo2', unit: '%' },
            respiratory_rate_average: { type: 'respiratoryRate', unit: 'breaths/min' },
            temperature_delta: { type: 'skinTempDev', unit: 'C' },
            weight_kg: { type: 'weightKg', unit: 'kg' },
            blood_glucose_mg_dl: { type: 'bloodGlucose', unit: 'mg/dL' },
            blood_pressure_systolic: { type: 'bpSystolic', unit: 'mmHg' },
            blood_pressure_diastolic: { type: 'bpDiastolic', unit: 'mmHg' },
            vo2_max: { type: 'vo2Max', unit: 'mL/kg/min' },
          };

          for (const [key, meta] of Object.entries(fields)) {
            const val = data[key];
            if (val !== undefined && val !== null) {
              let numVal = Number(val);
              if (key.includes('seconds')) numVal = numVal / 60;
              try {
                store.insertSample({
                  id: Math.random().toString(36).slice(2),
                  source: 'wearable',
                  dataType: meta.type,
                  value: numVal,
                  unit: meta.unit,
                  metadata: { provider: entry.source, via: 'rook' },
                  recordedAt: new Date((data.datetime as string) || entry.receivedAt),
                  syncedAt: new Date(),
                });
                stored++;
              } catch {}
            }
          }
        }

        (authState as Record<string, Record<string, unknown>>)['rook_last_sync'] = { timestamp: new Date().toISOString() };
        if (stored > 0) {
          console.log(`[ROOK] Synced ${stored} samples from ${entries.length} webhook entries`);
          try { pipeline.synthesizeBiomarkers(store); } catch {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, webhookEntries: entries.length, stored }));
      } catch (err) {
        console.error('[ROOK] Sync error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Sync failed' }));
      }
      return;
    }

    // ROOK: OAuth callback (user returns here after connecting wearable)
    if (url === '/rook/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#0B0F1A;color:#22C55E;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-size:48px;margin-bottom:12px">&#x2713;</h1><h2>Wearable Connected!</h2><p style="color:#94A3B8;margin-top:8px">You can close this tab and return to the dashboard.</p><script>setTimeout(function(){window.close()},3000)</script></div></body></html>');
      return;
    }

    // ── b.well Connected Health API ──────────────────────────────

    // b.well: Login
    if (url === '/api/bwell/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => body += chunk);
      req.on('end', async () => {
        try {
          const { email, password } = JSON.parse(body);
          const BWELL_CLIENT_KEY = process.env.BWELL_CLIENT_KEY || 'eyJyIjoiaWhhcDI1NWltc25ncm9xY2xuIiwiZW52IjoiY2xpZW50LXNhbmRib3giLCJraWQiOiJid2VsbF90cmlhbC1jbGllbnQtc2FuZGJveCJ9';
          const BWELL_GATEWAY = process.env.BWELL_ENVIRONMENT === 'production'
            ? 'https://api-gateway.prod.icanbwell.com'
            : 'https://api-gateway.client-sandbox.icanbwell.com';
          const BWELL_API = process.env.BWELL_ENVIRONMENT === 'production'
            ? 'https://api.prod.icanbwell.com'
            : 'https://api.client-sandbox.icanbwell.com';

          console.log(`[b.well] Login attempt: ${email}`);
          const loginResp = await fetch(`${BWELL_GATEWAY}/identity/account/login`, {
            method: 'POST',
            headers: { 'clientkey': BWELL_CLIENT_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          if (!loginResp.ok) {
            const errText = await loginResp.text();
            console.error(`[b.well] Login failed: ${loginResp.status} ${errText}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: `Login failed (${loginResp.status})` }));
            return;
          }

          const loginData = await loginResp.json() as {
            accessToken?: { jwtToken?: string; payload?: { bwellFhirPersonId?: string; clientFhirPersonId?: string } };
          };
          const accessToken = loginData.accessToken?.jwtToken;
          const personId = loginData.accessToken?.payload?.bwellFhirPersonId || '';

          if (!accessToken) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No access token returned' }));
            return;
          }

          // Store session for subsequent requests
          (authState as Record<string, unknown>)['bwell'] = {
            connected: true, pending: false, startedAt: Date.now(),
            accessToken, personId, apiUrl: BWELL_API, email,
          };
          console.log(`[b.well] Logged in — personId: ${personId}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, personId }));
        } catch (err) {
          console.error('[b.well] Login error:', err);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Login failed' }));
        }
      });
      return;
    }

    // b.well: Fetch health records
    if (url === '/api/bwell/records') {
      const bwellState = (authState as Record<string, Record<string, unknown>>)['bwell'];
      if (!bwellState?.accessToken || !bwellState?.personId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not logged in to b.well', total: 0 }));
        return;
      }

      try {
        const apiUrl = bwellState.apiUrl as string;
        const personId = bwellState.personId as string;
        const token = bwellState.accessToken as string;

        console.log(`[b.well] Fetching $everything for person.${personId}...`);
        const fhirResp = await fetch(`${apiUrl}/v1/Patient/person.${personId}/$everything`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/fhir+json' },
        });

        if (!fhirResp.ok) {
          console.error(`[b.well] $everything failed: ${fhirResp.status}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `FHIR fetch failed (${fhirResp.status})`, total: 0 }));
          return;
        }

        const bundle = await fhirResp.json() as {
          total?: number;
          entry?: Array<{ resource: { resourceType: string; [key: string]: unknown } }>;
        };

        // Group by resource type
        const categories: Record<string, number> = {};
        const entries = bundle.entry || [];
        for (const e of entries) {
          const rt = e.resource?.resourceType || 'Unknown';
          categories[rt] = (categories[rt] || 0) + 1;
        }

        const total = entries.length;
        console.log(`[b.well] Retrieved ${total} resources:`);
        for (const [rt, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${rt}: ${count}`);
        }

        // Extract key health data and store as samples for the Insights dashboard
        const samples: Array<{ dataType: string; value: number; unit: string; recordedAt: string; source: string }> = [];
        const conditions: Array<{ name: string; status: string }> = [];
        const medications: Array<{ name: string; status: string }> = [];
        const allergies: Array<{ name: string; criticality: string }> = [];

        for (const e of entries) {
          const r = e.resource;
          if (r.resourceType === 'Observation') {
            const coding = (r.code as { coding?: Array<{ code?: string; display?: string }> })?.coding?.[0];
            const vq = r.valueQuantity as { value?: number; unit?: string } | undefined;
            if (coding && vq?.value !== undefined) {
              samples.push({
                dataType: coding.display as string || coding.code as string || 'unknown',
                value: vq.value as number,
                unit: vq.unit as string || '',
                recordedAt: (r.effectiveDateTime as string) || (r.issued as string) || new Date().toISOString(),
                source: 'bwell',
              });
            }
          } else if (r.resourceType === 'Condition') {
            const code = r.code as { text?: string; coding?: Array<{ display?: string }> };
            const status = (r.clinicalStatus as { coding?: Array<{ code?: string }> })?.coding?.[0]?.code || '';
            conditions.push({ name: code?.text || code?.coding?.[0]?.display || 'Unknown', status });
          } else if (r.resourceType === 'MedicationRequest' || r.resourceType === 'MedicationStatement') {
            const med = (r.medicationCodeableConcept as { text?: string; coding?: Array<{ display?: string }> }) || {};
            medications.push({ name: med.text || med.coding?.[0]?.display || 'Unknown', status: r.status as string || '' });
          } else if (r.resourceType === 'AllergyIntolerance') {
            const code = r.code as { text?: string; coding?: Array<{ display?: string }> };
            allergies.push({ name: code?.text || code?.coding?.[0]?.display || 'Unknown', criticality: r.criticality as string || '' });
          }
        }

        // Store observations as health samples in local store (for Insights charts)
        let stored = 0;
        for (const s of samples) {
          try {
            store.insertSample({
              id: Math.random().toString(36).slice(2),
              source: 'ehr',
              dataType: s.dataType,
              value: s.value,
              unit: s.unit,
              metadata: { provider: 'bwell', source: 'bwell' },
              recordedAt: new Date(s.recordedAt),
              syncedAt: new Date(),
            });
            stored++;
          } catch {}
        }

        if (stored > 0) {
          console.log(`[b.well] Stored ${stored} observations in local database`);
          // Re-synthesize biomarkers with new data
          try { pipeline.synthesizeBiomarkers(store); } catch {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          total,
          stored,
          categories,
          patient: entries.find(e => e.resource.resourceType === 'Patient')?.resource || null,
          conditions: conditions.slice(0, 30),
          medications: medications.slice(0, 20),
          allergies: allergies.slice(0, 15),
        }));
      } catch (err) {
        console.error('[b.well] Records fetch error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Failed to fetch records', total: 0 }));
      }
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
        authState[data.provider] = {
          connected: false, pending: true, startedAt: Date.now(),
          fhirUrl: data.fhirUrl, tokenUrl: data.tokenUrl, clientId: data.clientId, callbackUrl: data.callbackUrl,
        } as Record<string, unknown>;
        console.log(`[OAuth] Waiting for ${data.name} authorization via browser...`);
        console.log(`[OAuth] FHIR: ${data.fhirUrl} | Token: ${data.tokenUrl}`);
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

    // Route: /dashboard — main dashboard (requires auth)
    if (url === '/dashboard') {
      if (!currentUser) {
        res.writeHead(302, { 'Location': '/' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboard(config, store));
      return;
    }

    // Route: / — dashboard directly (auth optional for local agent)
    if (!currentUser) {
      // Auto-login as local user when no cloud API is available
      currentUser = { email: 'karlmehta@gmail.com', name: 'Karl Mehta', apiKey: '', token: 'local', tier: 'free' };
    }
    res.writeHead(302, { 'Location': '/dashboard' });
    res.end();
  });

  server.on('error', (err: Error) => {
    console.error(`[Dashboard] Failed to start: ${err.message}`);
  });

  server.listen(DASHBOARD_PORT, '::', () => {
    console.log(`[Dashboard] XSpan Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });
}
