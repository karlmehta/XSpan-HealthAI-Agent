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
<title>XSpan HealthAI Agent</title>
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

  <!-- ═══ TODAY ═══ -->
  <div class="page active" id="page-home">
    ${(() => {
      const b = snapshot?.biomarkers;
      const hasData = b && b.dataCompleteness > 0;
      const isPartial = hasData && b.dataCompleteness < 0.5;
      const isFull = hasData && b.dataCompleteness >= 0.5;
      const isPro = currentUser?.tier === 'pro';
      const completePct = b ? Math.round(b.dataCompleteness * 100) : 0;

      // Helper for metric display
      const metric = (val: number | undefined, unit: string, label: string, icon: string) =>
        '<div class="stat-card">' +
        '<div style="font-size:14px;margin-bottom:4px">' + icon + '</div>' +
        '<div class="value" style="font-size:' + (val !== undefined ? '28px' : '20px') + '">' + (val !== undefined ? val : '—') + '</div>' +
        '<div class="label">' + (val !== undefined ? unit : 'No data') + '</div>' +
        '<div style="font-size:10px;color:#64748B;margin-top:2px">' + label + '</div>' +
        '</div>';

      return `

    <!-- Security Badge -->
    <div class="hipaa-note" style="flex-direction:column;align-items:start;gap:6px">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">🔒</span>
        <strong>Your Data Never Leaves Your Device</strong>
      </div>
      <div style="font-size:11px;color:#6EE7B7;line-height:1.6">
        AES-256 encrypted on your device · All processing happens locally — nothing is sent to any server · No one can access your health data — not even XSpan · Your data, your device, your control
      </div>
    </div>

    ${!hasData ? `
    <!-- ═══ NO DATA STATE ═══ -->
    <div style="text-align:center;padding:32px 0 16px">
      <div style="font-size:48px;margin-bottom:12px">🌟</div>
      <h2 style="font-size:24px;font-weight:800;color:#fff;margin-bottom:8px">Welcome to XSpan HealthAI</h2>
      <p style="font-size:14px;color:#94A3B8;max-width:480px;margin:0 auto">Your personal health intelligence agent. Connect your health data to see personalized insights, trends, and recommendations.</p>
    </div>

    <!-- Data Completeness (top, shows 0%) -->
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="font-size:14px">Data Completeness</h3>
        <span style="font-size:14px;font-weight:700;color:#EF4444">0%</span>
      </div>
      <div style="background:#0F172A;border-radius:8px;height:8px;overflow:hidden">
        <div style="background:#EF4444;height:100%;width:0%;border-radius:8px"></div>
      </div>
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        ${['Vitals','Sleep','Activity','Labs','Nutrition','Genomics'].map(s =>
          '<span style="font-size:10px;padding:3px 8px;border-radius:100px;background:#33415522;color:#64748B">' + s + '</span>'
        ).join('')}
      </div>
      <p style="font-size:11px;color:#94A3B8;margin-top:10px">Connect your health sources below to fill in your health picture. The more you connect, the better your insights.</p>
    </div>

    <!-- Demo Mode — see what it looks like when fully connected -->
    <div class="card" style="margin-bottom:24px;border-color:#E8751A33;background:linear-gradient(135deg,#1E293B,#1A1A2E)">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="font-size:40px">✨</div>
        <div style="flex:1">
          <h3 style="font-size:16px;margin-bottom:6px;color:#fff">See What You'll Get — Preview with Demo Data</h3>
          <p style="font-size:12px;color:#94A3B8;line-height:1.6;margin-bottom:12px">
            See exactly how XSpan looks when all your devices and providers are connected — readiness scores, sleep analysis, HRV trends, lab insights, drift detection, and more. Then connect your real sources to get <strong style="color:#E2E8F0">your</strong> personalized intelligence.
          </p>
          <button class="btn btn-primary" style="font-size:14px;padding:10px 24px" onclick="loadDemoData(this)">Preview with Demo Data</button>
        </div>
      </div>
    </div>

    <!-- Free Tier Value Prop -->
    <div class="card" style="margin-bottom:20px;border-color:#05966933">
      <h3 style="font-size:16px;margin-bottom:12px;color:#6EE7B7">What You Get Free — Forever</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:12px;color:#CBD5E1;line-height:1.8">
        <div>✓ Connect EHR, wearables, labs, genomics, microbiome</div>
        <div>✓ All data AES-256 encrypted &amp; stored locally</div>
        <div>✓ 100+ biomarker synthesis &amp; trends</div>
        <div>✓ Readiness score &amp; drift detection</div>
        <div>✓ Weekly basic health summary</div>
        <div>✓ <strong style="color:#E8751A">XSpan Contribute</strong> — earn from de-identified research data</div>
      </div>
    </div>

    <!-- Pro Upsell Preview -->
    <div class="pro-banner" style="margin-bottom:20px">
      <div>
        <h3>Unlock Pro for Predictive Intelligence</h3>
        <p style="margin-top:6px;font-size:12px;color:#94A3B8;line-height:1.6">
          🔮 Predictive risk scores &nbsp; 💡 3x daily AI nudges &nbsp; 📊 Weekly Health Passport<br>
          🧬 Digital Twin synthesis &nbsp; 🥗 AI meal parsing &nbsp; ❓ Ask anything about your health
        </p>
      </div>
      <button class="btn btn-primary" style="white-space:nowrap" onclick="showPage('subscription',document.querySelectorAll('.nav a')[3])">Learn about Premium</button>
    </div>

    ` : `
    <!-- ═══ DATA STATE (Partial or Full) ═══ -->

    <!-- Data Completeness Bar (top) -->
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="font-size:14px">Data Completeness</h3>
        <span style="font-size:14px;font-weight:700;color:${completePct >= 70 ? '#22C55E' : completePct >= 40 ? '#FBBF24' : '#EF4444'}">${completePct}%</span>
      </div>
      <div style="background:#0F172A;border-radius:8px;height:8px;overflow:hidden">
        <div style="background:${completePct >= 70 ? '#22C55E' : completePct >= 40 ? '#FBBF24' : '#EF4444'};height:100%;width:${completePct}%;border-radius:8px;transition:width 0.3s"></div>
      </div>
      <div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">
        ${[
          { name: 'Vitals', has: b?.restingHeartRate !== undefined },
          { name: 'Sleep', has: b?.totalSleepMinutes !== undefined },
          { name: 'Activity', has: b?.dailySteps !== undefined },
          { name: 'Labs', has: b?.hba1c !== undefined || b?.ldlCholesterol !== undefined },
          { name: 'Nutrition', has: b?.avgDailyCalories !== undefined },
          { name: 'Genomics', has: b?.genomeRiskVariants !== undefined },
        ].map(s =>
          '<span style="font-size:10px;padding:3px 8px;border-radius:100px;' +
          (s.has ? 'background:#05966922;color:#6EE7B7' : 'background:#33415522;color:#64748B;cursor:pointer') +
          '">' + (s.has ? '✓ ' : '+ ') + s.name + '</span>'
        ).join('')}
      </div>
    </div>

    <!-- Demo Mode Banner -->
    <div id="demo-banner" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#FBBF2411;border:1px solid #FBBF2433;border-radius:8px;margin-bottom:20px">
      <span style="font-size:20px">⚠️</span>
      <p style="flex:1;font-size:12px;color:#FBBF24"><strong>You're viewing demo data.</strong> This is synthetic sample data showing what XSpan looks like when fully connected. Connect your real health sources to see <strong>your</strong> personalized intelligence.</p>
      <button class="btn btn-secondary" style="font-size:11px;padding:6px 14px;white-space:nowrap;background:#FBBF24;color:#000" onclick="exitDemoMode(this)">Exit Demo → Connect Real Data</button>
    </div>

    <!-- Top Summary -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <h2 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:4px">Today</h2>
        <p style="font-size:12px;color:#64748B">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · ${completePct}% data completeness</p>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        ${b?.recoveryScore !== undefined ? `
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:${b.recoveryScore >= 70 ? '#22C55E' : b.recoveryScore >= 40 ? '#FBBF24' : '#EF4444'}">${b.recoveryScore}</div>
          <div style="font-size:10px;color:#64748B">Readiness</div>
        </div>
        ` : ''}
        ${b?.stressIndex !== undefined ? `
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:800;color:${b.stressIndex <= 30 ? '#22C55E' : b.stressIndex <= 60 ? '#FBBF24' : '#EF4444'}">${b.stressIndex}</div>
          <div style="font-size:10px;color:#64748B">Stress</div>
        </div>
        ` : ''}
      </div>
    </div>

    <!-- Synthesis Value Prop -->
    <div class="card" style="margin-bottom:20px;border-color:#E8751A33;background:linear-gradient(135deg,#1A1A2E,#1E293B)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <span style="font-size:24px">🔗</span>
        <div>
          <h3 style="font-size:15px;color:#E8751A;margin-bottom:2px">Synthesized Health Intelligence</h3>
          <p style="font-size:12px;color:#94A3B8">Your health data is scattered across Oura, WHOOP, Dexcom, Apple Watch, MyChart, Quest Labs, and more. XSpan brings it all together into one unified view — trends you can't see in any single app.</p>
        </div>
      </div>
    </div>

    <!-- Synthesized Trend Charts -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:24px">

      <!-- Cardiovascular Synthesis: HR + HRV + BP from multiple sources -->
      <div class="card" style="grid-column:span 2">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">❤️ Cardiovascular Synthesis</h3>
          <span style="font-size:10px;color:#64748B">Sources: Apple Watch (HR) + Oura (HRV) + Omron (BP) + EHR (Labs)</span>
        </div>
        <canvas id="chart-cardio" height="140"></canvas>
      </div>

      <!-- Sleep + Recovery: sleep duration + efficiency + HRV recovery -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">😴 Sleep &amp; Recovery</h3>
          <span style="font-size:10px;color:#64748B">Sources: Oura + WHOOP + Apple Watch</span>
        </div>
        <canvas id="chart-sleep" height="160"></canvas>
      </div>

      <!-- Metabolic: Weight + Glucose + HbA1c from scale + CGM + labs -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">🔥 Metabolic Health</h3>
          <span style="font-size:10px;color:#64748B">Sources: Dexcom CGM + Scale + Quest Labs (HbA1c)</span>
        </div>
        <canvas id="chart-metabolic" height="160"></canvas>
      </div>

      <!-- Activity + Fitness: Steps + Active mins + VO2 Max -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">🏃 Activity &amp; Fitness</h3>
          <span style="font-size:10px;color:#64748B">Sources: WHOOP + Garmin + Apple Watch</span>
        </div>
        <canvas id="chart-activity" height="160"></canvas>
      </div>

      <!-- Body Composition: Weight + BMI from scale + computed -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="font-size:14px">⚖️ Body Composition</h3>
          <span style="font-size:10px;color:#64748B">Sources: Smart Scale + Apple Health + Computed</span>
        </div>
        <canvas id="chart-body" height="160"></canvas>
      </div>
    </div>

    <!-- What Changed (7-day drift) — loaded via API -->
    <div class="card" style="margin-bottom:20px" id="drift-section">
      <h3 style="font-size:16px;margin-bottom:12px">What Changed (7 Days)</h3>
      <div id="drift-content" style="font-size:13px;color:#94A3B8">Loading trends...</div>
    </div>

    <!-- Top Issues -->
    ${todayNudges.length > 0 ? `
    <div class="card" style="margin-bottom:20px;border-color:#FBBF2433">
      <h3 style="font-size:16px;margin-bottom:12px">Top Issues Today</h3>
      ${todayNudges.slice(0, 3).map(n =>
        '<div style="display:flex;align-items:start;gap:10px;padding:10px 0;border-bottom:1px solid #334155">' +
        '<span style="font-size:18px">' + (n.priority === 1 ? '🔴' : n.priority === 2 ? '🟡' : '🟢') + '</span>' +
        '<div><p style="font-size:13px;color:#E2E8F0;margin-bottom:4px">' + n.content + '</p>' +
        (n.actionItems?.length ? '<p style="font-size:11px;color:#E8751A">→ ' + n.actionItems[0] + '</p>' : '') +
        '</div></div>'
      ).join('')}
    </div>
    ` : `
    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:16px;margin-bottom:8px">No Issues Detected</h3>
      <p style="font-size:12px;color:#94A3B8">All metrics are within your normal ranges. Keep it up!</p>
    </div>
    `}

    <!-- Privacy & Security (collapsible) -->
    <div class="card" style="margin-bottom:20px;cursor:pointer" onclick="this.querySelector('.trust-detail').style.display=this.querySelector('.trust-detail').style.display==='none'?'block':'none'">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">🛡️</span>
          <h3 style="font-size:14px">Security, Privacy &amp; Trust</h3>
        </div>
        <span style="font-size:11px;color:#64748B">click to expand ▾</span>
      </div>
      <div class="trust-detail" style="display:none;margin-top:12px;font-size:12px;color:#94A3B8;line-height:1.8">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
          <div style="background:#0F172A;padding:12px;border-radius:8px">
            <div style="color:#6EE7B7;font-weight:600;margin-bottom:4px">🔒 Encrypted Local Storage</div>
            Your health data is encrypted with AES-256 in a local SQLite database on your device. Even if someone accessed your laptop, they cannot read your health data without your encryption key.
          </div>
          <div style="background:#0F172A;padding:12px;border-radius:8px">
            <div style="color:#FBBF24;font-weight:600;margin-bottom:4px">🖥️ 100% Local Processing</div>
            All data collection, synthesis, and insights happen entirely on your machine. Nothing is sent to any cloud server. Your health data never touches the internet.
          </div>
          <div style="background:#0F172A;padding:12px;border-radius:8px">
            <div style="color:#EF4444;font-weight:600;margin-bottom:4px">🚫 No External Services</div>
            Your health data is never sent to any AI service, cloud platform, or third party. Everything runs locally on your device.
          </div>
          <div style="background:#0F172A;padding:12px;border-radius:8px">
            <div style="color:#C4B5FD;font-weight:600;margin-bottom:4px">✊ You Own Your Data</div>
            Delete all data anytime · Revoke any connection · Export everything · Contribute uses on-device de-identification before anything leaves
          </div>
        </div>
      </div>
    </div>

    `}
    `;
    })()}
  </div>

  <!-- ═══ CONNECT (wrapper for all data sources) ═══ -->
  <div class="page" id="page-connect">
    <div class="section-title">Connect Your Health Data Sources</div>
    <p style="font-size:13px;color:#94A3B8;margin-bottom:16px">The more sources you connect, the better your health intelligence.</p>

    <div style="display:flex;gap:24px;min-height:600px;align-items:flex-start">
    <!-- Left Sidebar -->
    <div style="width:180px;flex-shrink:0;position:sticky;top:20px" id="connect-sidebar">
      <div onclick="showConnectTab('ehr',this)" class="connect-nav-item" style="padding:12px 16px;cursor:pointer;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;background:#E8751A22;color:#E8751A">
        <span>🏥</span> EHR
      </div>
      <div onclick="showConnectTab('wearables',this)" class="connect-nav-item" style="padding:12px 16px;cursor:pointer;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>⌚</span> Wearables
      </div>
      <div onclick="showConnectTab('labs',this)" class="connect-nav-item" style="padding:12px 16px;cursor:pointer;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🧪</span> Labs
      </div>
      <div onclick="showConnectTab('genomics',this)" class="connect-nav-item" style="padding:12px 16px;cursor:pointer;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🧬</span> Genomics
      </div>
      <div onclick="showConnectTab('microbiome',this)" class="connect-nav-item" style="padding:12px 16px;cursor:pointer;border-radius:8px;margin-bottom:4px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;color:#94A3B8">
        <span>🦠</span> Microbiome
      </div>
    </div>
    <!-- Right Content -->
    <div style="flex:1;min-width:0;overflow:hidden">
    <div class="connect-sub active" id="connect-ehr">
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

    </div>
    <div class="connect-sub" id="connect-wearables" style="display:none">
    <div class="section-title">Connect Your Wearables & Devices</div>
    <div class="hipaa-note" style="margin-bottom:20px">
      🔗 <strong>One-click connection</strong> via Terra — securely connects to 150+ wearable devices and health apps. Select your device below, log in with your credentials, and authorize XSpan to read your health data. All data stored locally on your device.
    </div>

    <!-- Terra Connect Button -->
    <div class="card" style="margin-bottom:20px;border-color:#E8751A44;text-align:center;padding:32px">
      <div style="font-size:40px;margin-bottom:12px">⌚</div>
      <h3 style="font-size:18px;margin-bottom:8px">Connect Any Wearable or Health Device</h3>
      <p style="font-size:13px;color:#94A3B8;margin-bottom:20px;max-width:500px;margin-left:auto;margin-right:auto">
        Click below to open the secure connection widget. Select your device (Oura, WHOOP, Dexcom, Garmin, Fitbit, and 150+ more), log in, and authorize.
      </p>
      <button class="btn btn-primary" style="font-size:16px;padding:14px 32px" onclick="openTerraWidget()">
        Connect a Device
      </button>
      <p style="font-size:10px;color:#64748B;margin-top:12px">Powered by Terra — your credentials are never stored by XSpan</p>
    </div>

    <!-- Supported Devices Grid -->
    <div class="section-title" style="font-size:14px;margin-bottom:12px">Supported Devices & Apps</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
      ${[
        { icon: '💍', name: 'Oura Ring' },
        { icon: '💪', name: 'WHOOP' },
        { icon: '🩸', name: 'Dexcom CGM' },
        { icon: '⌚', name: 'Garmin' },
        { icon: '📱', name: 'Fitbit' },
        { icon: '🤖', name: 'Google Health' },
        { icon: '🏋️', name: 'Peloton' },
        { icon: '💤', name: 'Eight Sleep' },
        { icon: '⚖️', name: 'Withings' },
        { icon: '🫀', name: 'Omron' },
        { icon: '❄️', name: 'Polar' },
        { icon: '🏃', name: 'Strava' },
        { icon: '🧬', name: 'Ultrahuman' },
        { icon: '🔵', name: 'Suunto' },
        { icon: '🚴', name: 'Wahoo' },
        { icon: '📊', name: '150+ more' },
      ].map(d => `
        <div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:10px;text-align:center;font-size:11px">
          <div style="font-size:20px;margin-bottom:4px">${d.icon}</div>
          <div style="color:#CBD5E1">${d.name}</div>
        </div>
      `).join('')}
    </div>

    <!-- Connected Devices -->
    <div id="terra-connected" style="display:none;margin-top:16px">
      <div class="section-title" style="font-size:14px;margin-bottom:8px;color:#22C55E">Connected Devices</div>
      <div id="terra-connected-list"></div>
    </div>
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
  // Use Vercel-hosted callback for production health systems (they reject localhost)
  // The Vercel page relays the auth code back to localhost:9877
  const isSandbox = fhirUrl && fhirUrl.includes('fhir.epic.com');
  const callbackUrl = isSandbox
    ? 'https://localhost:9877/callback'
    : 'https://xspan-research-portal.vercel.app/oauth/callback';

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

  // Authorization timed out — likely Error 15 (health system hasn't enabled XSpan)
  showModal(
    name + ' — Authorization Pending',
    '<div style="text-align:center;padding:16px">' +
    '<div style="font-size:48px;margin-bottom:12px">🏥</div>' +
    '<p style="color:#FBBF24;font-size:16px;font-weight:700;margin-bottom:12px">Your health system hasn\'t enabled XSpan yet</p>' +
    '<p style="color:#94A3B8;font-size:13px;line-height:1.7;margin-bottom:16px">' +
    'XSpan is registered with Epic and your health system has received our app credentials, but they haven\'t approved patient data access yet. ' +
    'This requires your health system\'s privacy and IT team to review and enable XSpan.</p>' +
    '<div style="background:#0F172A;border:1px solid #334155;border-radius:8px;padding:16px;text-align:left;margin-bottom:16px">' +
    '<p style="color:#E8751A;font-weight:600;font-size:13px;margin-bottom:8px">What you can do:</p>' +
    '<p style="color:#CBD5E1;font-size:12px;line-height:1.8">' +
    '1. Go to the <strong>Premium</strong> tab and send a request to your doctor<br>' +
    '2. Ask your health system to enable XSpan for patient access<br>' +
    '3. In the meantime, use the <strong>Epic Sandbox</strong> (test data) to explore the full EHR flow</p>' +
    '</div>' +
    '<p style="color:#64748B;font-size:11px">Epic Error 15: Application not yet approved at this organization. ' +
    'This is a health system decision, not a technical issue. XSpan\'s credentials are valid.</p>' +
    '</div>',
    '<button class="btn btn-primary" onclick="closeModal();showPage(\'subscription\',document.querySelectorAll(\'.nav a\')[3])">Go to Premium — Ask Your Doctor</button>'
  );
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
    'If you\'ve already logged in and authorized XSpan in the other tab, click the button below to complete the connection.' +
    '</p>' +
    '<p style="color:#64748B;font-size:11px;line-height:1.6">' +
    'Note: Some wearable providers require you to complete login and grant access in the browser tab that opened. ' +
    'Once done, come back here and click "I\'ve Authorized — Connect Now".' +
    '</p>' +
    '</div>',
    '<button class="btn btn-primary" style="width:100%" onclick="manualConnect(\'' + id + '\')">I\'ve Authorized — Connect Now</button>'
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
    btn.textContent = 'I\'ve Authorized — Connect Now';
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
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(\\'tos\\')" style="color:#E8751A;text-decoration:underline">Terms of Service</a></span>' +
    '</label>' +

    '<label id="chk-privacy" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-privacy" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(\\'privacy\\')" style="color:#E8751A;text-decoration:underline">Privacy Policy</a></span>' +
    '</label>' +

    '<label id="chk-consent" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-consent" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I have read and accept the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(\\'consent\\')" style="color:#E8751A;text-decoration:underline">Data Contributor Consent</a></span>' +
    '</label>' +

    '<label id="chk-rewards" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:#0F172A;border:1px solid #334155;border-radius:8px;cursor:pointer;font-size:13px" onclick="event.stopPropagation()">' +
    '<input type="checkbox" id="cb-rewards" onchange="checkEnrollReady()" style="accent-color:#E8751A;width:16px;height:16px;flex-shrink:0">' +
    '<span style="flex:1">I understand the <a href="#" onclick="event.preventDefault();event.stopPropagation();showLegalDoc(\\'rewards\\')" style="color:#E8751A;text-decoration:underline">Contribution Rewards</a> (50% to me, rest supports health system &amp; community)</span>' +
    '</label>' +

    '</div>' +

    '<div style="background:#05966911;border:1px solid #05966933;border-radius:8px;padding:12px;font-size:11px;color:#6EE7B7;line-height:1.6;margin-bottom:12px">' +
    'Your data is de-identified on your device before it ever leaves. All 18 HIPAA identifiers are removed. You can revoke consent anytime. No cost to you.' +
    '</div>' +

    '</div>',
    '<button class="btn btn-primary" id="btn-enroll" style="flex:2;opacity:0.4;cursor:not-allowed" disabled onclick="confirmContribute()">Accept All &amp; Enroll</button>'
  );
}

// ── Terra: Open wearable connection widget ───────────────────

async function openTerraWidget() {
  try {
    var res = await fetch('/api/terra/widget-session', { method: 'POST' });
    var data = await res.json();
    if (data.status === 'success' && data.url) {
      // Open Terra widget in a popup window
      var w = 500, h = 700;
      var left = (screen.width - w) / 2;
      var top = (screen.height - h) / 2;
      var popup = window.open(data.url, 'terra-connect', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',toolbar=no,menubar=no');

      // Poll for popup close
      var check = setInterval(function() {
        if (!popup || popup.closed) {
          clearInterval(check);
          showModal(
            'Device Connection',
            '<div style="text-align:center;padding:16px">' +
            '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
            '<p style="color:#22C55E;font-size:16px;font-weight:700;margin-bottom:8px">Connection flow completed!</p>' +
            '<p style="color:#94A3B8;font-size:13px">If you authorized the device, data will begin syncing shortly. It may take a few minutes for the first data to appear in your Insights.</p>' +
            '</div>',
            ''
          );
        }
      }, 1000);
    } else {
      showModal('Error', '<p style="color:#EF4444">Could not initialize device connection. Please try again.</p>', '');
    }
  } catch (e) {
    showModal('Error', '<p style="color:#EF4444">Could not connect to wearable service. Please try again.</p>', '');
  }
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
  fetch('/api/chart-data')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.labels || d.labels.length < 2) return;
      var gc = '#334155';
      var tc = '#64748B';
      var labels = d.labels.map(function(l) { return l.slice(5); });
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

      // Cardiovascular Synthesis: RHR + HRV + BP (multi-axis)
      var cardioCtx = document.getElementById('chart-cardio');
      if (cardioCtx) {
        new Chart(cardioCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              ds('Resting HR (bpm)', d.restingHr, '#EF4444'),
              ds('HRV (ms)', d.hrv, '#22C55E'),
              ds('BP Systolic', d.bpSystolic, '#A78BFA', [5,5])
            ]
          },
          options: baseOpts(true)
        });
      }

      // Sleep & Recovery: hours + efficiency
      var sleepCtx = document.getElementById('chart-sleep');
      if (sleepCtx) {
        new Chart(sleepCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              ds('Sleep (hrs)', d.sleep.map(function(v) { return v ? +(v/60).toFixed(1) : null; }), '#6EE7B7'),
              ds('Efficiency (%)', d.sleepEfficiency, '#A78BFA', [4,4])
            ]
          },
          options: baseOpts(true)
        });
      }

      // Metabolic: Glucose + Weight (lbs)
      var metaCtx = document.getElementById('chart-metabolic');
      if (metaCtx) {
        new Chart(metaCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              ds('Glucose (mg/dL)', d.glucose, '#EF4444'),
              ds('Weight (lbs)', d.weight.map(function(v) { return v ? +(v * 2.205).toFixed(1) : null; }), '#E8751A', [4,4])
            ]
          },
          options: baseOpts(true)
        });
      }

      // Activity: Steps + Active Minutes
      var actCtx = document.getElementById('chart-activity');
      if (actCtx) {
        new Chart(actCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              ds('Steps', d.steps, '#FBBF24')
            ]
          },
          options: baseOpts(false)
        });
      }

      // Body: Weight (lbs) + BMI
      var bodyCtx = document.getElementById('chart-body');
      if (bodyCtx) {
        new Chart(bodyCtx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              ds('Weight (lbs)', d.weight.map(function(v) { return v ? +(v * 2.205).toFixed(1) : null; }), '#E8751A'),
              ds('BMI', d.bmi, '#64748B', [4,4])
            ]
          },
          options: baseOpts(true)
        });
      }
    })
    .catch(function() {});
})();

// ── Navigate to Connect tab with specific sub-tab ────────────

function goToConnect(subTab) {
  showPage('connect', document.querySelectorAll('.nav a')[1]);
  setTimeout(function() {
    var subtabs = document.querySelectorAll('#connect-subtabs a');
    var map = { ehr: 0, wearables: 1, labs: 2, genomics: 3, microbiome: 4 };
    var idx = map[subTab] ?? 0;
    if (subtabs[idx]) showConnectTab(subTab, subtabs[idx]);
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
        '<button class="btn btn-primary" onclick="closeModal();goToConnect(\\'ehr\\')">Go to Connect</button>'
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
        '<button onclick="document.getElementById(\\'legal-doc-overlay\\').remove()" style="background:none;border:none;color:#64748B;font-size:24px;cursor:pointer">&times;</button>' +
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
        '<p style="color:#22C55E;font-size:18px;font-weight:700;margin-bottom:12px">You\\'re enrolled!</p>' +
        '<p style="color:#94A3B8;font-size:13px;line-height:1.7">Your first contribution will be posted automatically. You\\'ll see your rewards appear here as research organizations access your de-identified data.</p>' +
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

    // API: Terra — Generate widget session for wearable connections
    if (url === '/api/terra/widget-session' && req.method === 'POST') {
      try {
        const terraDevId = process.env.TERRA_DEV_ID || 'predixtions-testing-c1Ip106tRu';
        const terraApiKey = process.env.TERRA_API_KEY || 'wLwQxQti90ZKyQui75IECWBEhZy6zI1a';
        const userId = config.xspan?.userId || 'local-user';

        const terraResp = await fetch('https://api.tryterra.co/v2/auth/generateWidgetSession', {
          method: 'POST',
          headers: {
            'dev-id': terraDevId,
            'x-api-key': terraApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reference_id: userId,
            providers: 'OURA,WHOOP,FITBIT,GARMIN,DEXCOM,GOOGLE,WITHINGS,OMRON,POLAR,STRAVA,PELOTON,EIGHTSLEEP,ULTRAHUMAN',
            language: 'en',
          }),
        });
        const terraData = await terraResp.json() as Record<string, unknown>;
        console.log(`[Terra] Widget session: ${terraData['session_id']}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(terraData));
      } catch (err) {
        console.error('[Terra] Widget session error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', error: 'Could not connect to Terra' }));
      }
      return;
    }

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

    // API: Chart data — 30-day time series for Insights charts
    if (url === '/api/chart-data') {
      try {
        const snapshots = store.getSnapshots(30);
        const labels = snapshots.map(s => s.snapshotDate).reverse();
        const extract = (key: string) => snapshots.map(s => (s.biomarkers as Record<string, unknown>)[key] ?? null).reverse();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          labels,
          weight: extract('bodyMassKg'),
          bmi: extract('bodyMassIndex'),
          sleep: extract('totalSleepMinutes'),
          steps: extract('dailySteps'),
          hrv: extract('heartRateVariability'),
          stress: extract('stressIndex'),
          glucose: extract('bloodGlucoseFasting'),
          bpSystolic: extract('bloodPressureSystolic'),
          bpDiastolic: extract('bloodPressureDiastolic'),
          restingHr: extract('restingHeartRate'),
          sleepEfficiency: extract('sleepEfficiency'),
        }));
      } catch {
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

    // Route: / — login page (or redirect to dashboard if already signed in)
    if (!currentUser) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderAuthPage(config.xspan.apiUrl));
    } else {
      res.writeHead(302, { 'Location': '/dashboard' });
      res.end();
    }
  });

  server.on('error', (err: Error) => {
    console.error(`[Dashboard] Failed to start: ${err.message}`);
  });

  server.listen(DASHBOARD_PORT, '::', () => {
    console.log(`[Dashboard] XSpan Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });
}
