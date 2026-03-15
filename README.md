# XSpan HealthAI Agent

**Your Personal Health Intelligence — Running Locally, Protected by HIPAA**

XSpan HealthAI Agent is an open-source health data collector that runs on your desktop. It connects to your Electronic Health Records (Epic, Cerner, eClinicalWorks), Apple Health / Google Health, wearables (Oura, WHOOP, Dexcom, Garmin, Fitbit), lab providers (Quest, LabCorp, Function Health), and genomics profiles (23andMe, Gut.id) — then syncs your data securely to XSpan's HIPAA-compliant cloud for AI-powered health intelligence.

**Your health data is never sent to third-party AI tools.** All AI processing happens exclusively on XSpan's HIPAA-compliant H-LLM infrastructure.

---

## What It Does

| Feature | Tier | Description |
|---|---|---|
| Apple Health Sync | Free | Reads activity, sleep, HRV, vitals from macOS HealthKit |
| Google Health Sync | Free | Reads Fit/Health data via OAuth2 |
| EHR Connection | Free | Connects to Epic, Cerner, Redox via SMART on FHIR R4 |
| Wearables | Free | Oura, WHOOP, Dexcom CGM, Garmin, Fitbit |
| Lab Results | Free | Quest Diagnostics, LabCorp, Function Health |
| Genomics | Free | 23andMe genetic variants, Gut.id microbiome |
| Local Biomarker Synthesis | Free | 100+ biomarkers synthesized locally |
| Encrypted Local Storage | Free | AES-256 encrypted SQLite at ~/.xspan/data |
| AI Health Nudges | **Pro $20/mo** | 3 personalized nudges/day from XSpan H-LLM |
| Weekly Health Passport | **Pro $20/mo** | Comprehensive PDF report every Sunday |
| Predictive Risk Scores | **Pro $20/mo** | Cardiovascular, metabolic, sleep disorder risk |
| AI Health Q&A | **Pro $20/mo** | Ask anything about your health via XSpan H-LLM |
| Cloud Digital Twin | **Pro $20/mo** | Full Digital Twin synthesis on XSpan cloud |
| AI Meal Parsing | **Pro $20/mo** | Natural language nutrition logging |

**[Subscribe to Pro — $20/month](https://buy.stripe.com/test_dRmdR90Ei2iO3CFf3LgnK00)**

---

## HIPAA Compliance & Data Privacy

> **Your health data is NEVER sent to ChatGPT, Claude, Gemini, or any third-party AI tool.**

Sending Protected Health Information (PHI) to general-purpose AI tools violates HIPAA. XSpan takes a different approach:

- Raw health data is **encrypted locally** (AES-256) on your machine
- Only **synthesized biomarker vectors** are sent to XSpan's cloud
- All AI queries are processed by **XSpan's HIPAA-compliant H-LLM**
- XSpan cloud runs on **BAA-covered infrastructure** (SOC 2 Type II)
- OAuth2 PKCE for all EHR connections
- Credentials stored in **OS keychain** (macOS Keychain / Windows Credential Manager)

**Do not pipe your local health database to third-party AI tools.** The `~/.xspan/data/xspan.db` file contains PHI that is protected under HIPAA. All health queries, nudges, risk scores, and Health Passport generation are processed exclusively through XSpan's cloud at `api.xspan.ai`.

---

## Quick Install

### Option A — Clone from GitHub (Recommended)
```bash
git clone https://github.com/karlmehta/XSpan-HealthAI-Agent.git
cd XSpan-HealthAI-Agent
npm install
cp .env.example .env
# Edit .env with your XSpan API key
npm run dev
```

### Option B — Install via npx
```bash
npx @xspan/agent setup
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 18.0 |
| npm | >= 9.0 |
| macOS (for Apple Health) | >= 13 Ventura |
| XSpan Account | [Sign up at xspan.ai](https://xspan.ai) |

---

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# XSpan Cloud (Required)
XSPAN_API_KEY=your_api_key_here
XSPAN_USER_ID=your_user_id
XSPAN_API_URL=https://api.xspan.ai/v1

# Apple Health (macOS only)
APPLE_HEALTH_ENABLED=true

# EHR Connection
EHR_ENABLED=false
EHR_PROVIDER=epic         # epic | cerner | redox | generic_fhir
EHR_FHIR_BASE_URL=https://fhir.example.org/api/FHIR/R4
EHR_CLIENT_ID=your_ehr_client_id
```

### Connecting Your EHR

1. Run the agent: `npm run dev`
2. Browse **Health System Options** to find yours (lookup available via Apple Health directory and web registries)
3. Select your health system and its EHR (Epic MyChart, Cerner, eClinicalWorks, etc.)
4. Enter your EHR portal credentials (username/password)
5. Authorize XSpan to read your health records via SMART on FHIR

See [docs/EHR_SETUP.md](docs/EHR_SETUP.md) for detailed per-provider instructions.

### Connecting Wearables, Labs & Genomics

| Provider | Auth Method | Status |
|---|---|---|
| Apple Health | macOS HealthKit (automatic) | Available |
| Google Health | OAuth2 | Available |
| Oura Ring | OAuth2 API key | v1.1 |
| WHOOP | OAuth2 | v1.1 |
| Dexcom CGM | OAuth2 | v1.1 |
| Garmin | OAuth2 | v1.1 |
| Fitbit | OAuth2 | v1.1 |
| Quest Diagnostics | Credential login | v1.2 |
| LabCorp | Credential login | v1.2 |
| Function Health | API key | v1.2 |
| 23andMe | OAuth2 + file import | v1.2 |
| Gut.id | API key | v1.2 |

---

## How It Works

```
+-----------------------------------------------------+
|                    Your Desktop                      |
|                                                      |
|  +----------+ +----------+ +---------+ +---------+  |
|  | Apple    | | EHR/FHIR | | Oura/   | | Quest/  |  |
|  | Health   | | (Epic..) | | WHOOP.. | | LabCorp |  |
|  +----+-----+ +----+-----+ +----+----+ +----+----+  |
|       |             |            |           |       |
|       +-------------+-----+-----+-----------+       |
|                            |                         |
|                    +-------v--------+                |
|                    |  XSpan HealthAI |                |
|                    |     Agent       |<-- Nutrition   |
|                    +-------+--------+    23andMe     |
|                            |             Gut.id      |
|                  +---------v----------+              |
|                  |  Local Data Store  |              |
|                  |  (~/.xspan/data)   |  ENCRYPTED   |
|                  |  AES-256 SQLite    |  LOCAL ONLY  |
|                  +---------+----------+              |
|                            |                         |
|                  +---------v----------+              |
|                  |  Biomarker Vectors |              |
|                  |  (synthesized only)|              |
|                  +--------------------+              |
+------------------------+----------------------------+
                         | HTTPS (TLS 1.3)
                         | Biomarker vectors only
                         | NO raw PHI leaves device
                         v
          +------------------------------+
          |  XSpan Cloud (HIPAA / BAA)   |
          |  api.xspan.ai/v1            |
          |                              |
          |  +--------+  +-----------+  |
          |  | H-LLM  |  | Digital   |  |
          |  | Engine  |  | Twin      |  |
          |  +--------+  +-----------+  |
          |  +--------+  +-----------+  |
          |  | Nudge  |  | Health    |  |
          |  | Engine |  | Passport  |  |
          |  +--------+  +-----------+  |
          |  +--------+  +-----------+  |
          |  | Risk   |  | AI Q&A    |  |
          |  | Scores |  | Engine    |  |
          |  +--------+  +-----------+  |
          +------------------------------+
              All AI processing here
              HIPAA compliant only
              No third-party AI access
```

---

## Pricing

### Free (Open Source)
- Data collection from all sources (EHR, Apple Health, wearables, labs, genomics)
- Local 100+ biomarker synthesis
- AES-256 encrypted local storage

### Pro — $20/month
- 3x daily personalized AI nudges (H-LLM powered)
- Weekly Health Passport PDF
- Predictive disease risk scores
- AI health Q&A — ask anything about your health
- Cloud Digital Twin synthesis
- AI-powered meal parsing

**[Subscribe to Pro](https://buy.stripe.com/test_dRmdR90Ei2iO3CFf3LgnK00)** | Cancel anytime. Powered by Stripe.

---

## Project Structure

```
XSpan-HealthAI-Agent/
  src/
    agent/
      index.ts              # Main daemon orchestrator
    billing/
      subscription.ts       # Stripe subscription gate (free vs pro)
    connectors/
      ehr/
        fhir-client.ts      # SMART on FHIR R4 (Epic, Cerner)
      wearables/
        index.ts             # Oura, WHOOP, Dexcom, Garmin, Fitbit
      labs/
        index.ts             # Quest, LabCorp, Function Health
      genomics/
        index.ts             # 23andMe, Gut.id
    sync/
      xspan-api.ts          # XSpan cloud API client (subscription-gated)
      data-pipeline.ts      # ETL + biomarker synthesis
    storage/
      local-store.ts        # SQLite encrypted local store
    config/
      index.ts              # Config loader + Zod validation
    types/
      index.ts              # TypeScript interfaces
  docs/
    EHR_SETUP.md
    SPEC.md
  .env.example
  package.json
  tsconfig.json
  README.md
  LICENSE
```

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type check
npm run type-check
```

---

## API Endpoints

| Environment | Base URL | Purpose |
|---|---|---|
| Production | `https://api.xspan.ai/v1` | Live environment |
| QA/Testing | `https://api-qa.xspan.ai/v1` | Test with demo data |
| Documentation | `https://wiki.xspan.ai` | API reference |

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Important:** Do not submit PRs that expose local health data to third-party AI tools. All health data queries must go through XSpan's HIPAA-compliant H-LLM at api.xspan.ai.

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Support

- **Docs:** [wiki.xspan.ai](https://wiki.xspan.ai)
- **Issues:** [github.com/karlmehta/XSpan-HealthAI-Agent/issues](https://github.com/karlmehta/XSpan-HealthAI-Agent/issues)
- **Subscribe:** [XSpan Pro — $20/month](https://buy.stripe.com/test_dRmdR90Ei2iO3CFf3LgnK00)

---

*Built by [XSpan.ai](https://xspan.ai) — Whole Body Intelligence*
