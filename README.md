# MyHealthSpan Agent

**For Developers — Own Your Health Data. Get Synthesized Insights. Contribute & Earn.**

A desktop health intelligence agent for developers and tech enthusiasts. Aggregates data from EHR, wearables, labs, genomics, and microbiome providers across the US, India, and South Korea. Synthesizes 100+ biomarkers locally. All data AES-256 encrypted on your device. Zero cloud dependency.

```
Install → Connect → Insights → Contribute & Earn
```

Developer Portal: [xspan.ai/developer](https://xspan.ai/developer)

---

## Why This Exists

Your health data is scattered across Oura, WHOOP, Dexcom, Apple Watch, MyChart, Quest Labs, 23andMe, and more. No single app gives you the full picture. XSpan brings it all together — synthesized trends that no single app can show you.

**Built for developers** who want to own their health data, see synthesized insights, and optionally contribute to medical research.

---

## Quick Start

```bash
git clone https://github.com/karlmehta/XSpan-HealthAI-Agent.git
cd XSpan-HealthAI-Agent
npm install
cp .env.example .env
npm run dev
```

Open **http://localhost:3000** — click **"Preview with Demo Data"** to see 30 days of synthesized health insights.

---

## What You Get (Free)

### Synthesized Health Insights

| Chart | Sources Combined |
|-------|-----------------|
| **Cardiovascular Synthesis** | Apple Watch (HR) + Oura (HRV) + Omron (BP) + EHR Labs |
| **Sleep & Recovery** | Oura + WHOOP + Apple Watch |
| **Metabolic Health** | Dexcom CGM + Smart Scale + Quest Labs (HbA1c) |
| **Activity & Fitness** | WHOOP + Garmin + Fitbit + Apple Watch |
| **Body Composition** | Smart Scale + Apple Health |

Plus: 7-day drift detection, weekly health summaries, 100+ biomarker synthesis.

### Connect Everything

| Category | Providers |
|----------|----------|
| **Health Systems** | Epic MyChart, Cerner (SMART on FHIR R4) |
| **India (ABDM)** | 600M+ ABHA users via Ayushman Bharat consent framework |
| **Wearables** | Oura, WHOOP, Dexcom CGM, Garmin, Fitbit (via Terra API, 150+ devices) |
| **Labs** | Quest Diagnostics, LabCorp, Function Health |
| **Genomics** | 23andMe, Illumina, Foundation Medicine |
| **Microbiome** | Gut.id, Viome, Zoe, BIOHM |

### Contribute & Earn

Opt-in to contribute de-identified health data to advance medical research:
- All 18 HIPAA identifiers removed **on your device**
- You earn 50% of every research contribution
- On-chain consent proof (Coinbase Base L2)
- Withdraw to bank via Coinbase Wallet

### Privacy & Security

- **AES-256 encrypted** local SQLite database
- **Zero cloud dependency** — nothing sent to any server
- **No AI services** — no ChatGPT, Claude, Gemini access to your data
- **100% local processing** — all synthesis runs on your machine
- **You control everything** — delete, export, or revoke anytime

---

## Supported Platforms

| Platform | Health Data | Wearables | EHR / Labs |
|----------|-----------|-----------|------------|
| **macOS** | Apple HealthKit (via companion app) | OAuth or Apple Health | Full support |
| **Windows** | Direct OAuth per device | Direct OAuth | Full support |
| **Linux** | Direct OAuth per device | Direct OAuth | Full support |

---

## Architecture

```
Your Desktop
├── Health System (FHIR) ──┐
├── Wearables (Terra) ─────┤→ XSpan Agent → SQLite (AES-256)
├── Labs (Quest, LabCorp) ──┤                    ↓
├── Genomics (23andMe) ────┤     Synthesized Insights Dashboard
├── Microbiome (Gut.id) ───┤                    ↓
├── India ABDM ────────────┘     Contribute & Earn (optional)
```

---

## Extending the Agent

Build plugins for custom data sources and health analyzers:

```typescript
const myPlugin: Plugin = {
  name: 'my-analyzer',
  type: 'analyzer',
  async execute(ctx) {
    return { score: analyze(ctx.snapshots) };
  }
};
```

See `src/plugins/examples/` for working examples.

---

## Premium (via your Health System)

XSpan Premium features — Digital Twin, AI Nudges, Meal Tracking, Health Passport, Structured Care Programs — are available through participating health systems and physicians. Ask your doctor for an invite code.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0 |
| npm | >= 9.0 |
| macOS / Windows / Linux | Any modern version |

---

## License

**Proprietary** — see [LICENSE](LICENSE)

Free to use for personal health data aggregation and insights. Not open source. See LICENSE for full terms.

For commercial licensing: licensing@xspan.ai

---

*Built by [XSpan.ai](https://xspan.ai) — The Physics of Biology*
