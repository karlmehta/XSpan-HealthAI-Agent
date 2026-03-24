# CLAUDE.md — XSpan HealthAI Agent

## Project Overview

Proprietary health intelligence agent for developers (free to use, not open source). Runs locally on desktop (macOS/Windows/Linux). Aggregates health data from EHR, wearables, labs, genomics, microbiome. Synthesizes 100+ biomarkers. All data AES-256 encrypted locally. Zero cloud dependency. Positioned as "for developers" to preserve B2B channel with health systems.

**Active repo:** `/Users/karlmehta/Desktop/XSpan-HealthAI-Agent/`
**GitHub:** `karlmehta/XSpan-HealthAI-Agent` (public, AGPL-3.0)
**Research portal:** `karlmehta/xspan-research-portal` (private, Vercel)

## Stack

- **Runtime:** Node.js >= 18, TypeScript, tsx (dev), tsc (build)
- **Database:** better-sqlite3 (local SQLite at `~/.xspan/data/xspan.db`)
- **Dashboard:** Server-rendered HTML in `src/dashboard/server.ts` (port 3000)
- **Charts:** Chart.js via CDN (no npm dependency)
- **OAuth callback:** HTTPS server on port 9877 (self-signed certs)
- **Blockchain:** Solidity contracts on Base Sepolia (Foundry toolchain)
- **IPFS:** Pinata (mock client for dev, real keys in `.env.contribute`)
- **Wearables:** Terra API (direct provider OAuth, not widget)
- **Research portal:** Next.js 16 + Tailwind on Vercel

## Commands

```bash
npm run dev          # Start agent + dashboard (tsx watch)
npm run build        # TypeScript compile
npm run test         # Vitest
npm run gen-certs    # Generate self-signed SSL certs for OAuth callback
npm run dev:server   # Start mock XSpan cloud API on :8000 (dev only)
npm run dev:all      # Start mock server + agent together
```

### Foundry (smart contracts)
```bash
cd contracts && forge build    # Compile Solidity
cd contracts && forge test     # Run contract tests
```

## Architecture

```
src/
  agent/index.ts           # Main daemon — local-only, no cloud calls
  dashboard/server.ts      # THE BIG FILE — all dashboard HTML/CSS/JS/API routes
  dashboard/xspan-logo.png # XSpan logo served at /logo.png
  config/index.ts          # Zod schema, env vars (cloud fields optional)
  storage/local-store.ts   # SQLite CRUD — health_samples, biomarker_snapshots, nudges
  sync/data-pipeline.ts    # Apple Health + EHR sync, biomarker synthesis
  sync/xspan-api.ts        # Cloud API client — UNUSED in local mode, kept for Premium
  billing/subscription.ts  # Subscription mgmt — UNUSED in local mode, kept for Premium
  types/index.ts           # All TypeScript interfaces (BiomarkerVector, 40+ fields)
  contribute/              # XSpan Contribute (blockchain research data exchange)
    types.ts               # ContributeConfig, ContributionListing, RevenueSplit
    deidentify.ts          # HIPAA Safe Harbor pipeline (18 identifiers, k-anonymity)
    index.ts               # ContributeManager orchestrator
    contracts.ts           # ethers.js bindings to Base Sepolia contracts
    ipfs-client.ts         # Pinata upload/download (mock mode if no keys)
    abi/                   # Contract ABIs (DataRegistry, DataExchange, etc.)
  engine/
    baseline.ts            # Personal baseline + drift detection (rolling window)
    weekly-report.ts       # This week vs last week health summary
  demo/
    synthetic-data.ts      # 30 days of realistic demo data with drift patterns
  plugins/
    index.ts               # Plugin manager (source + analyzer types)
    examples/              # fitbit-source.ts, sleep-analyzer.ts
  mcp/                     # MCP server (optional, apiClient=null in local mode)
contracts/
  src/
    ConsentRegistry.sol    # On-chain consent records
    BuyerAccessControl.sol # KYC for research partners
    DataRegistry.sol       # Dataset listing, metadata, pricing
    DataExchange.sol       # Purchase, escrow, revenue distribution (50/20/25/5)
  script/Deploy.s.sol      # Deployment script
docs/
  legal/                   # TOS, Privacy, Consent, Partner Agreement, Revenue Split
```

## Dashboard (server.ts) — The Big File

This single file is ~2500 lines containing ALL dashboard UI. Key sections:

| Section | What |
|---------|------|
| Lines 1-90 | Health system definitions (HEALTH_SYSTEMS, WEARABLE_PROVIDERS, etc.) |
| Lines 90-270 | Login/signup page (auth via dev server or cloud API) |
| Lines 270-640 | **Insights tab** — 3-state (no data / partial / full), Chart.js canvases, demo mode |
| Lines 640-800 | **Connect tab** — left sidebar (Health Systems, Wearables, Labs, Genomics, Microbiome) |
| Lines 800-950 | **Premium tab** — value props + mailto doctor form |
| Lines 950-1100 | **Contribute & Earn tab** — consent checkboxes, enrollment, earnings |
| Lines 1100-1450 | JavaScript functions (showPage, connectEHR, connectWearable, charts, etc.) |
| Lines 1450-1700 | API routes (/api/terra/auth, /api/chart-data, /api/demo/load, etc.) |
| Lines 1700-1950 | OAuth HTTPS callback server (token exchange + FHIR data fetch) |
| Lines 1950-2100 | Main HTTP server (auth, dashboard, static routes) |

### CRITICAL: JavaScript String Escaping

**NEVER use apostrophes/contractions in JS strings built with single quotes.** The TypeScript template literal renders `\'` as literal `'` in HTML, breaking the JS parser and killing ALL nav buttons.

**BAD:** `'Your health system hasn\'t enabled XSpan'`
**GOOD:** `'Your health system has not enabled XSpan'`
**BAD:** `'onclick="showPage(\'subscription\')"'`
**GOOD:** `'onclick="showPage(&quot;subscription&quot;)"'`

For dynamic values in onclick, use `data-` attributes:
```html
<button data-provider="OURA" onclick="fn(this.dataset.provider)">
```

## Navigation Structure

**4 tabs:** Insights ^FREE^ | Connect | Contribute & Earn ^EARN^ | Premium

- Insights = `page-home` (id kept for backward compat)
- Connect = `page-connect` with sub-tabs via `showConnectTab(id, el)`
- Contribute = `page-contribute`
- Premium = `page-subscription` (id kept for backward compat)

## Smart Contracts (Base Sepolia Testnet)

| Contract | Address |
|----------|---------|
| ConsentRegistry | `0x7Ef9A0512412c1036601AcD86022655a13677775` |
| BuyerAccessControl | `0x60ADb21A97C53445d69A2aF05115f08310282312` |
| DataRegistry | `0xf35243ccd3Ba1Adc68Fedca4f550894AdA86B7e3` |
| DataExchange | `0x746FE3744D4Bb4D9fd0eB74D1815bc4251ef9FB6` |

Revenue split: 50% contributor / 20% health system partner / 25% XSpan / 5% community fund

## Environment Files

| File | Purpose | Gitignored? |
|------|---------|:-----------:|
| `.env` | Agent config (local-only, no cloud keys needed) | Yes |
| `.env.example` | Template — zero cloud config | No |
| `.env.contribute` | Coinbase CDP, Pinata, contract addresses, deployer keys | Yes |

## Key API Credentials (in .env.contribute)

- **Coinbase CDP:** API key + secret + project ID + Paymaster RPC
- **Pinata IPFS:** API key + secret + JWT
- **Terra API:** Dev ID + API key (for wearable OAuth)
- **Epic FHIR:** Production client ID `8ce98706-fcb3-4cd9-a4ad-b793ed96e375`

## EHR Connection — Known Issues

Epic production client ID is propagated but health systems issue tokens with ZERO FHIR scopes. UCLA Health confirmed: OAuth works, token exchange succeeds, but 403 `insufficient_scope` on all FHIR resources. This is an information blocking issue under the 21st Century Cures Act. Complaint drafted.

**Registered Epic APIs (5):** AllergiesRead, MedicationRead, ObservationReadLabs, ObservationReadsVitals, PatientReadDiagnostics

**Sandbox:** Uses non-production client ID (`2a44a85d-ddf3-4b74-b17b-4c5844408f89`) which has no FHIR scopes. Cannot test FHIR data fetch on sandbox.

## Wearable Connection — Terra API

Each device card calls `/api/terra/auth` with the provider name (e.g., `OURA`). Terra returns a direct OAuth URL for that specific provider. User clicks link → opens provider login in new tab → comes back and confirms. No Terra widget is shown to the user.

## Branding Rules

- **User-facing name:** "XSpan Contribute" (never "marketplace" or "data selling")
- **Buyers:** "Research Partners" (never "buyers")
- **Purchases:** "Research Access Grants" (never "sales")
- **Earnings:** "Contribution rewards" (never "revenue")
- **Blockchain:** "Secure digital ledger" if must reference (never "blockchain" to users)
- **All earnings are "indicative estimates only"** — legal disclaimer required
- **No $20/month pricing or Stripe links anywhere**
- **No health system names in Premium tab**

## Forbidden Patterns

- Do NOT add cloud API dependencies to the agent — it runs 100% local
- Do NOT use `marketplace` in any file name, variable, or user-facing text
- Do NOT embed third-party widgets (Fasten Stitch, Terra widget) — use API + our own UI
- Do NOT use `window.open()` after `await fetch()` — browsers block it as popup
- Do NOT use contractions in JS template strings (see escaping section above)
- Do NOT commit `.env`, `.env.contribute`, `dev-server/`, `contracts/lib/`, `contracts/broadcast/`
- Do NOT reference Stripe, $20/month, or direct payment anywhere

## Testing

```bash
npm run test          # Vitest
npm run type-check    # tsc --noEmit
```

Dashboard JS syntax check (after changes to server.ts):
```bash
# Login, fetch dashboard HTML, extract script, verify syntax
curl -s -c /tmp/c.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -d '{"email":"beth.porter@xspan.health","password":"xspan2026"}'
curl -s -b /tmp/c.txt http://localhost:3000/dashboard | \
  python3 -c "import re,sys;h=sys.stdin.read();s=re.findall(r'<script>(.*?)</script>',h,re.DOTALL);open('/tmp/js.js','w').write(s[-1]) if s else None"
node -e "try{new Function(require('fs').readFileSync('/tmp/js.js','utf8'));console.log('OK')}catch(e){console.log('ERROR:',e.message)}"
```

## Test Credentials

| Service | Credentials |
|---------|------------|
| Dashboard login | `beth.porter@xspan.health` / `xspan2026` |
| Dev server (mock API :8000) | Same as above, or `admin@xspan.ai` / `admin` |
| Epic Sandbox | `fhirjason` / `epicepic1` (identity only, no FHIR data) |

## External Services

| Service | Purpose | Status |
|---------|---------|--------|
| **Coinbase Base Sepolia** | Smart contract deployment | Deployed, working |
| **Coinbase Paymaster** | Gas sponsorship for users | Configured, applying for $15K credits |
| **Pinata** | IPFS storage for encrypted datasets | Connected, working |
| **Terra API** | Wearable device OAuth (150+ devices) | Connected, working |
| **Vercel** | Research portal hosting | Deployed at research.xspan.ai |
| **Epic FHIR** | EHR connection | Auth works, data blocked (scope issue) |
| **Fasten Connect** | EHR aggregator (50K+ systems) | Test keys received, evaluating |
| **b.well** | EHR aggregator (2.4M providers, used by Perplexity) | Outreach sent |

## Jira

Project: `XSPAN` on `predixtions.atlassian.net`
Cloud ID: `2a60cf98-a27d-4ec6-aae6-775f5c4cb054`
Note: MCP integration currently cannot access tickets (permission issue)
