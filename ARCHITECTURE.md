# MyHealthSpan (MHS) Agent — Agentic Architecture v2

## Design Principles

1. **LLM-agnostic** — orchestrator works with any LLM (Claude, GPT, Llama, Gemini) or no LLM (rule-based fallback)
2. **MCP-native** — every agent exposes MCP tools; the whole system IS an MCP server
3. **Zero hallucination** — all insights are data-grounded; every claim cites the source record
4. **Portable** — runs on any system with Node.js; publishable to OpenClaw, MCP directories, npm
5. **Autonomous** — once configured, syncs, analyzes, earns USDC, and serves insights without user intervention
6. **Multi-interface** — CLI (`/mhs`), web browser (localhost:3000), mobile browser, MCP client (Claude Desktop)
7. **Supplier-invisible** — user never sees "ROOK" or "b.well"; they see "Oura", "WHOOP", "Health Records"

## Agent Tree

```
MHS Orchestrator
│
├── Wearable Agent
│   ├── skill: connect-device     (OAuth flow for Oura, WHOOP, Fitbit, etc.)
│   ├── skill: sync-wearables     (poll webhook relay for new data)
│   ├── skill: get-sources        (list connected/available devices)
│   └── memory: last_sync, device_status
│
├── EHR Agent
│   ├── skill: connect-ehr        (authenticate with health record provider)
│   ├── skill: sync-records       (fetch $everything FHIR bundle)
│   ├── skill: get-conditions     (active diagnoses)
│   ├── skill: get-medications    (current prescriptions)
│   ├── skill: get-allergies      (known allergies)
│   └── memory: session_token, person_id, last_sync
│
├── Analytics Agent
│   ├── skill: build-charts       (time-series from all sources)
│   ├── skill: score-health       (cardiovascular, metabolic, sleep, activity scores)
│   ├── skill: detect-drift       (baseline deviation alerts)
│   ├── skill: interpret-labs     (clinical range interpretation)
│   └── memory: baselines, alert_history
│
├── Summary Agent
│   ├── skill: daily-briefing     (synthesized natural-language summary)
│   ├── skill: weekly-report      (week-over-week comparison)
│   ├── skill: answer-question    (data-grounded Q&A, zero hallucination)
│   └── memory: recent_summaries, user_preferences
│
├── Contribute Agent
│   ├── skill: de-identify        (HIPAA Safe Harbor on-device)
│   ├── skill: publish-to-ipfs    (Pinata upload)
│   ├── skill: register-on-chain  (Base mainnet DataRegistry)
│   ├── skill: check-earnings     (USDC balance from DataExchange)
│   └── memory: consent_status, contribution_history, wallet_address
│
└── Storage Agent
    ├── skill: read-samples       (query health_samples)
    ├── skill: write-samples      (insert normalized data)
    ├── skill: read-snapshots     (daily aggregated snapshots)
    ├── skill: export-data        (full data export for user)
    └── memory: db_path, encryption_key
```

## File Structure

```
src/
├── mhs.ts                        # CLI entry: /mhs command
├── server.ts                     # Web server (localhost:3000)
├── mcp-server.ts                 # MCP server (tools for Claude Desktop, OpenClaw, etc.)
│
├── agents/
│   ├── types.ts                  # AgentMessage, SubAgent interface, health data types
│   ├── orchestrator.ts           # Master coordinator
│   ├── wearable-agent.ts         # ROOK integration (invisible to user)
│   ├── ehr-agent.ts              # b.well integration (invisible to user)
│   ├── analytics-agent.ts        # Charts, scores, drift, interpretation
│   ├── summary-agent.ts          # Daily briefing, Q&A, weekly report
│   ├── contribute-agent.ts       # Blockchain: de-identify → IPFS → Base → USDC
│   └── storage-agent.ts          # SQLite read/write abstraction
│
├── skills/                       # Each skill is a standalone function
│   ├── connect-device.md         # Skill definition (MCP-compatible)
│   ├── sync-wearables.md
│   ├── daily-briefing.md
│   ├── answer-question.md
│   ├── interpret-labs.md
│   └── ...
│
├── memory/                       # Persistent agent memory
│   ├── MEMORY.md                 # Memory index
│   ├── device-status.md          # Which devices are connected
│   ├── baselines.md              # 30-day rolling averages
│   ├── user-profile.md           # User health context
│   └── contribution-history.md   # Blockchain contribution log
│
├── harness/                      # Agent execution framework
│   ├── harness.ts                # LLM-agnostic execution engine
│   ├── llm-adapters/
│   │   ├── claude.ts             # Anthropic Claude adapter
│   │   ├── openai.ts             # OpenAI GPT adapter
│   │   ├── local.ts              # Local/Ollama adapter
│   │   └── rule-based.ts         # No-LLM fallback (deterministic)
│   ├── prompt-templates/
│   │   ├── daily-briefing.md     # Template for daily summary
│   │   ├── lab-interpretation.md # Template for lab analysis
│   │   └── health-qa.md          # Template for Q&A
│   └── guardrails.ts             # Zero-hallucination enforcement
│
├── storage/
│   └── local-store.ts            # SQLite (existing, enhanced)
│
├── contribute/                   # Blockchain (existing)
│   ├── deidentify.ts
│   ├── contracts.ts
│   └── ipfs-client.ts
│
└── dashboard/                    # Web UI (rewritten, clean)
    ├── server.ts                 # Express/Hono server
    ├── pages/
    │   ├── insights.html         # Charts + summary
    │   ├── connect.html          # Device + EHR connection
    │   ├── contribute.html       # Blockchain earnings
    │   └── settings.html         # Configuration
    └── api/                      # REST endpoints (thin, delegates to orchestrator)
```

## MCP Server — Tool Registry

Every agent skill becomes an MCP tool. Any MCP client (Claude Desktop, Cursor, OpenClaw) can call them.

```json
{
  "tools": [
    {
      "name": "mhs_health_status",
      "description": "Get today's health status summary with scores and alerts",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_get_labs",
      "description": "Get recent lab results with clinical interpretation",
      "input_schema": {
        "type": "object",
        "properties": {
          "category": { "type": "string", "enum": ["all", "metabolic", "lipids", "thyroid", "kidney", "liver"] },
          "days": { "type": "number", "default": 90 }
        }
      }
    },
    {
      "name": "mhs_get_vitals",
      "description": "Get recent vital signs (HR, BP, SpO2, temperature)",
      "input_schema": { "type": "object", "properties": { "days": { "type": "number", "default": 30 } } }
    },
    {
      "name": "mhs_get_sleep",
      "description": "Get sleep data from connected wearables",
      "input_schema": { "type": "object", "properties": { "days": { "type": "number", "default": 7 } } }
    },
    {
      "name": "mhs_get_activity",
      "description": "Get activity data (steps, calories, strain, recovery)",
      "input_schema": { "type": "object", "properties": { "days": { "type": "number", "default": 7 } } }
    },
    {
      "name": "mhs_get_conditions",
      "description": "Get active medical conditions/diagnoses",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_get_medications",
      "description": "Get current medications",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_detect_drift",
      "description": "Detect metrics that have drifted from 30-day baseline",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_chart_data",
      "description": "Get time-series chart data for all health metrics",
      "input_schema": { "type": "object", "properties": { "days": { "type": "number", "default": 90 } } }
    },
    {
      "name": "mhs_connect_device",
      "description": "Get authorization URL to connect a wearable device",
      "input_schema": {
        "type": "object",
        "properties": {
          "device": { "type": "string", "enum": ["oura", "whoop", "fitbit", "garmin", "dexcom", "withings", "polar"] }
        },
        "required": ["device"]
      }
    },
    {
      "name": "mhs_connect_ehr",
      "description": "Connect to health records from your hospital/doctor",
      "input_schema": {
        "type": "object",
        "properties": { "email": { "type": "string" }, "password": { "type": "string" } },
        "required": ["email", "password"]
      }
    },
    {
      "name": "mhs_contribute",
      "description": "De-identify health data and publish for research (earn USDC)",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_earnings",
      "description": "Check USDC earnings from health data contributions",
      "input_schema": { "type": "object", "properties": {} }
    },
    {
      "name": "mhs_ask",
      "description": "Ask any health question — answered from YOUR data only, zero hallucination",
      "input_schema": {
        "type": "object",
        "properties": { "question": { "type": "string" } },
        "required": ["question"]
      }
    }
  ]
}
```

## CLI Interface

```bash
# Install globally
npm install -g @myhealthspan/agent

# One-time setup
mhs setup

# Daily use
mhs status                    # Today's health briefing
mhs labs                      # Recent lab results with interpretation
mhs sleep 7                   # Last 7 days of sleep
mhs activity                  # Steps, strain, recovery
mhs conditions                # Active diagnoses
mhs medications               # Current meds
mhs drift                     # What changed from baseline
mhs connect oura              # Connect a wearable
mhs connect ehr               # Connect health records
mhs contribute                # Publish de-identified data, earn USDC
mhs earnings                  # Check USDC balance
mhs ask "How is my cholesterol trending?"
mhs serve                     # Start web dashboard on localhost:3000
```

## Zero-Hallucination Guardrails

Every insight produced by the Summary Agent follows these rules:

1. **Data citation required** — every claim must reference a specific health_sample record
2. **No extrapolation** — if data doesn't exist, say "No data available" not "likely normal"
3. **Clinical ranges only** — use established medical reference ranges, not opinions
4. **Source attribution** — "Your resting HR (from Oura, Apr 18) was 62 bpm — within normal range"
5. **Temporal precision** — always state when the data was recorded
6. **Uncertainty flagging** — if only 1 data point exists, note "single measurement" vs "7-day average"

Template for daily briefing:
```
## Health Status — {date}

**Overall: {score}/100** — {one-line headline based on data}

### Cardiovascular ({score}/100)
- Resting HR: {value} bpm ({date}, {source}) — {interpretation}
- Blood Pressure: {sys}/{dia} mmHg ({date}, {source}) — {interpretation}
- HRV: {value} ms ({date}, {source}) — {interpretation}

### Metabolic ({score}/100)
- HbA1c: {value}% ({date}, {source}) — {interpretation}
- Fasting Glucose: {value} mg/dL ({date}, {source}) — {interpretation}
- Cholesterol: {value} mg/dL ({date}, {source}) — {interpretation}

### Sleep ({score}/100)
- Last night: {hours}h {min}m ({source}) — {interpretation}
- Deep sleep: {min}m | REM: {min}m | Efficiency: {pct}%

### Activity ({score}/100)
- Steps: {value} ({source}) — {interpretation}
- Active calories: {value} kcal

### Alerts
{alerts with severity, based on drift detection + clinical ranges}

---
Sources: {list of devices and EHR systems used}
Data points: {count} records analyzed
Last sync: {timestamp}
```

## Autonomous Operation

Once configured, the agent runs autonomously:

```
Every 15 minutes:
  → Wearable Agent polls webhook relay for new ROOK data
  → Stores new samples in SQLite

Every 1 hour:
  → EHR Agent refreshes health records (if token valid)
  → Analytics Agent re-computes scores and drift

Every 24 hours (midnight):
  → Summary Agent generates daily briefing
  → Contribute Agent de-identifies new data
  → Contribute Agent publishes to IPFS via Pinata
  → Contribute Agent registers on Base mainnet
  → Contribute Agent checks USDC earnings

Web dashboard (always on):
  → localhost:3000 serves latest insights
  → Charts auto-refresh when new data arrives
  → Mobile-responsive (works on phone browser)

MCP server (always on):
  → Listens for tool calls from any MCP client
  → Claude Desktop, Cursor, OpenClaw can query health data
```

## Portability

### npm publish
```bash
npm publish --access public
# Package: @myhealthspan/agent
# Binary: mhs
```

### OpenClaw / MCP Directory
```json
{
  "name": "myhealthspan-agent",
  "description": "Personal health intelligence — connects wearables + EHR, synthesizes insights, earns USDC",
  "transport": "stdio",
  "command": "npx @myhealthspan/agent mcp",
  "tools": 14
}
```

### Docker
```dockerfile
FROM node:22-alpine
RUN npm install -g @myhealthspan/agent
EXPOSE 3000
CMD ["mhs", "serve"]
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ (ESM) |
| Language | TypeScript 5.x |
| Database | SQLite (better-sqlite3) + WAL mode |
| LLM (optional) | Any via harness adapters (Claude, GPT, Llama, rule-based) |
| MCP | @modelcontextprotocol/sdk |
| Blockchain | ethers.js v6 → Base mainnet |
| IPFS | Pinata SDK |
| Web server | Node http (zero dependencies) |
| CLI | Commander.js |
| Charts | Chart.js (CDN, client-side) |
