# XSpan HealthAI Agent

**Own Your Health Data. Get Synthesized Insights. Contribute & Earn.**

Your health data is scattered across Oura, WHOOP, Dexcom, Apple Watch, MyChart, Quest Labs, 23andMe, and more. No single app gives you the full picture. XSpan brings it all together — synthesized, encrypted, and running 100% on your machine.

```
Install → Connect → Insights → Contribute & Earn
```

**Zero cloud dependency. Zero cost. Your data never leaves your device.**

---

## Why XSpan?

Your wearable shows you sleep. Your CGM shows glucose. Your lab portal shows HbA1c. But none of them show you **how they connect**.

XSpan synthesizes data from **all** your health sources into unified trend charts that no single app can provide:

### Synthesized Insights (Free)

| Chart | What You See | Sources Combined |
|-------|-------------|-----------------|
| **Cardiovascular Synthesis** | Resting HR + HRV + Blood Pressure on one timeline | Apple Watch + Oura + Omron + EHR Labs |
| **Sleep & Recovery** | Sleep duration + efficiency + overnight HRV recovery | Oura + WHOOP + Apple Watch |
| **Metabolic Health** | Fasting glucose + weight + HbA1c trends | Dexcom CGM + Smart Scale + Quest Labs |
| **Activity & Fitness** | Steps + active minutes + exercise sessions | WHOOP + Garmin + Fitbit + Apple Watch |
| **Body Composition** | Weight (lbs) + BMI over time | Smart Scale + Apple Health |

**Plus:** 7-day drift detection ("HRV down 14% from your 30-day average"), weekly health summaries, and 100+ biomarker synthesis.

> You can't get these synthesized views from Oura, WHOOP, Apple Health, or MyChart alone. That's why XSpan exists.

---

## Quick Start

```bash
git clone https://github.com/karlmehta/XSpan-HealthAI-Agent.git
cd XSpan-HealthAI-Agent
npm install
npm run dev
```

Open **http://localhost:3000** — click **"Preview with Demo Data"** to see synthesized charts with 30 days of sample data.

No accounts needed. No API keys. No cloud services. Just clone and run.

---

## What You Get (All Free)

### 1. Own Your Data
- All health data AES-256 encrypted in a local SQLite database on your device
- No data is ever sent to any server — not even XSpan
- Connect once, own forever — export anytime

### 2. Synthesized Insights
- Unified trend charts combining data from multiple devices, labs, and EHR
- Personal baseline computation with drift detection
- Weekly health summaries with top positives and concerns
- 100+ biomarkers synthesized from all connected sources

### 3. Contribute & Earn
- Opt-in to contribute de-identified health data to advance medical research
- All 18 identifiers removed **on your device** before anything leaves
- You earn 50% of every research contribution
- Researchers get consented, de-identified data — patients get rewarded for the first time

### 4. Connect to Premium (via your doctor)
- Request XSpan Premium access through your physician or health system
- Premium includes: mobile app, Digital Twin, AI nudges, meal tracking, Health Passport
- Your doctor gets the request and can issue an invite code

---

## Dashboard

The agent runs a localhost dashboard (port 3000) with 4 tabs:

| Tab | What It Does |
|-----|-------------|
| **Insights** ^FREE^ | Synthesized trend charts, drift detection, weekly summaries, data completeness |
| **Connect** | Link EHR (MyChart), wearables, labs, genomics, microbiome — left sidebar navigation |
| **Contribute & Earn** | Opt-in to research data contribution, see earnings, manage consent |
| **Premium** | Request access via your doctor — value proposition + email form |

---

## Supported Sources

| Category | Providers |
|----------|----------|
| **EHR** | Epic MyChart, Cerner, eClinicalWorks (SMART on FHIR R4) |
| **Apple Health** | Steps, HR, HRV, sleep, SpO2, temperature, blood pressure |
| **Google Health** | Activity, sleep, heart rate (OAuth2) |
| **Wearables** | Oura, WHOOP, Dexcom CGM, Garmin, Fitbit |
| **Labs** | Quest Diagnostics, LabCorp, Function Health |
| **Genomics** | 23andMe, Illumina, Foundation Medicine, Tempus, Guardant Health |
| **Microbiome** | Gut.id, Viome, Zoe, BIOHM, Tiny Health, Ombre |

---

## Platform Support

| Platform | Health Data | Wearables | EHR / Labs / Genomics |
|----------|-----------|-----------|----------------------|
| **macOS** | Apple HealthKit (automatic) | Via Apple Health or direct OAuth | Full support |
| **Windows** | Direct OAuth per device | Direct OAuth per device | Full support |
| **Linux** | Direct OAuth per device | Direct OAuth per device | Full support |

---

## Architecture

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
|                    |     Agent       |                |
|                    +-------+--------+                |
|                            |                         |
|                  +---------v----------+              |
|                  |  Local Data Store  |  AES-256     |
|                  |  (~/.xspan/data)   |  ENCRYPTED   |
|                  +---------+----------+              |
|                            |                         |
|              +-------------+-------------+           |
|              |             |             |           |
|     +--------v---+ +------v------+ +----v-------+   |
|     | Synthesized| | Baseline &  | | Contribute |   |
|     | Insights   | | Drift Engine| | & Earn     |   |
|     +------------+ +-------------+ +------------+   |
+-----------------------------------------------------+
     100% local · Zero cloud dependency · Your device
```

---

## Privacy & Security

- **AES-256 encrypted** local SQLite database
- **Zero cloud dependency** — nothing is sent to any server
- **No AI services** — no ChatGPT, Claude, Gemini, or any third-party AI
- **100% local processing** — all synthesis and insights run on your machine
- **Contribute is opt-in** — de-identification happens on-device before anything leaves
- **You control everything** — delete, export, or revoke anytime

---

## Extending the Agent

XSpan uses a plugin architecture. Build custom data sources and analyzers:

```typescript
// Example: Custom analyzer plugin
const myAnalyzer: Plugin = {
  name: 'my-sleep-analyzer',
  version: '1.0.0',
  type: 'analyzer',
  async init() { /* setup */ },
  async execute(ctx) { /* analyze snapshots, return insights */ },
};
```

See `src/plugins/examples/` for working examples.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0 |
| npm | >= 9.0 |
| macOS / Windows / Linux | Any modern version |

---

## Contributing

We welcome contributions! This project uses **AGPL-3.0** — all modifications must be shared back.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

**AGPL-3.0** — see [LICENSE](LICENSE)

- You can use, modify, and distribute this software
- Modifications must be shared under the same license
- Extensions/plugins via the documented API can use different licenses
- Network use (SaaS) triggers the share-alike requirement

---

*Built by [XSpan.ai](https://xspan.ai) — The Physics of Biology*
