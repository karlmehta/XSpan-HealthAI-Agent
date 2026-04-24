# MyHealthSpan Agent — Personal Health Intelligence

> See your complete health picture. Wearables + medical records + labs — synthesized with clinical-grade insights.

---

## Overview

MyHealthSpan Agent is an AI-powered personal health intelligence platform that connects all your health data sources — wearable devices (Oura, WHOOP, Dexcom, Apple Watch, Garmin), electronic health records, and lab results — into a single unified view. It runs locally on your machine, keeping your data private and under your control.

Built by [XSpan.ai](https://xspan.ai), the agent synthesizes raw health signals into actionable insights using clinical-grade analysis, baseline drift detection, and longitudinal trend monitoring.

---

## Features

- **Unified Health Dashboard** — One view across all wearables, EHR systems, and lab results. No more switching between five apps to understand your health.
- **Clinical-Grade Insights** — AI analysis grounded in medical literature. Biomarker trends, sleep architecture, HRV patterns, and glucose variability interpreted in clinical context.
- **Baseline Drift Detection** — Automatically establishes your personal baselines and alerts you when metrics drift outside your normal range, catching changes before they become problems.
- **Natural Language Health Q&A** — Ask questions like "How has my sleep changed since I started exercising more?" and get answers backed by your actual data.
- **Privacy-First Architecture** — Your health data stays on your machine. Local SQLite storage, encrypted at rest, no cloud dependency required. HIPAA-aligned by design.
- **MCP Integration** — Works natively with Claude Desktop, Cursor, and any MCP-compatible AI assistant. Your health context available inside your AI workflow.
- **Multi-Source EHR Connection** — Connect to hospitals and health systems via FHIR/SMART, pulling conditions, medications, allergies, immunizations, and clinical notes.
- **Earnings & Contribution** — Opt-in to contribute anonymized, de-identified health research data and earn revenue through the XSpan Contribute marketplace on Base L2.

---

## Screenshots

1. **CLI Health Dashboard** — Terminal-based health status showing today's vitals, sleep score, activity metrics, and drift alerts in a color-coded layout.
2. **Web Dashboard** — Browser-based dashboard at localhost:3000 with interactive charts for HRV trends, sleep stages, glucose curves, and biomarker panels.
3. **MCP in Claude Desktop** — The agent running inside Claude Desktop, answering a health question with data pulled from connected wearables and EHR.
4. **Drift Detection Alert** — A notification showing baseline drift detected in resting heart rate with a 14-day trend overlay and clinical context.

---

## Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **MyHealthSpan Pro** | **$5.99/mo** | All features, unlimited data sources, drift alerts, AI insights |
| **Free Trial** | **3 days** | Full access, no credit card required to start |

Annual plan available at $59.99/year (save 17%).

---

## Supported Platforms

| Platform | How |
|----------|-----|
| **CLI** | `npx @myhealthspan/agent` or `npm install -g @myhealthspan/agent` |
| **Web Dashboard** | `mhs serve` — opens at http://localhost:3000 |
| **MCP (Claude Desktop)** | Add to claude_desktop_config.json — see mcp-config.json |
| **MCP (Cursor)** | Add to Cursor MCP settings — see mcp-config.json |
| **Docker** | `docker run -p 3000:3000 myhealthspan/agent` |
| **iOS** | Coming soon — companion app for mobile health sync |
| **Android** | Coming soon — companion app for mobile health sync |

---

## Requirements

- Node.js 18+ (22 recommended)
- macOS, Linux, or Windows (WSL2)
- At least one connected data source (wearable device or health system)

---

## Quick Start

```bash
# Install globally
npm install -g @myhealthspan/agent

# Run setup wizard
mhs setup

# View your health dashboard
mhs

# Start web dashboard
mhs serve

# Use with Claude Desktop — add to your MCP config:
# See mcp-config.json in the repo
```

---

## Category

Health & Wellness

## Tags

`health` `wearables` `EHR` `medical-records` `AI-agent` `health-data` `biometrics` `sleep` `HRV` `glucose` `FHIR` `MCP` `privacy-first` `digital-health`

---

## Support

- Documentation: https://xspan.ai/docs/agent
- Issues: https://github.com/karlmehta/XSpan-HealthAI-Agent/issues
- Email: support@xspan.ai

## Publisher

**XSpan.ai** — Health intelligence infrastructure
https://xspan.ai
