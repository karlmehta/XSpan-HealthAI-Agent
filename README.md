# XSpan HealthAI Agent

**Your Personal Health Intelligence — Running Locally, Thinking Globally**

XSpan HealthAI Agent is an open-source, autonomous health agent that runs on your desktop. It connects to your Electronic Health Records (Epic, Cerner, eClinicalWorks), Apple Health / Google Health, wearables (Oura, WHOOP, Dexcom, Garmin, Fitbit), lab providers (Quest, LabCorp, Function Health), and genomics profiles (23andMe, Gut.id) — then builds your **Digital Twin** and delivers personalized health nudges and a weekly Health Passport.

No mobile app required. No data locked in a black box. **You own your health data locally.**

---

## What It Does

| Feature | Description |
|---|---|
| Apple Health Sync | Reads activity, sleep, HRV, vitals from macOS HealthKit |
| Google Health Sync | Reads Fit/Health data via OAuth2 |
| EHR Connection | Connects to Epic, Cerner, Redox via SMART on FHIR R4 |
| Wearables | Oura, WHOOP, Dexcom CGM, Garmin, Fitbit |
| Lab Results | Quest Diagnostics, LabCorp, Function Health |
| Genomics | 23andMe genetic variants, Gut.id microbiome profile |
| Nutrition Logging | Log meals via natural language |
| Digital Twin | Synthesizes 100+ biomarkers into your health profile |
| Smart Nudges | 3 personalized health nudges/day from XSpan H-LLM |
| Weekly Report | Full Health Passport PDF every Sunday |
| MCP Server | Plug into Claude Desktop, Cursor, or Windsurf |
| Local First | All raw data stored locally; only synthesized insights sent to cloud |

---

## Quick Install

### Option A — Clone from GitHub (Recommended)
```bash
git clone https://github.com/karlmehta/XSpan-HealthAI-Agent.git
cd XSpan-HealthAI-Agent
npm install
cp .env.example .env
# Edit .env with your credentials
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
| XSpan API Key | Get yours at [xspan.ai/api](https://xspan.ai/api) |

---

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# XSpan Cloud (Required)
XSPAN_API_KEY=your_api_key_here
XSPAN_USER_ID=your_user_id
XSPAN_API_URL=https://api.xspan.ai/v1

# For QA/testing, use:
# XSPAN_API_URL=https://api-qa.xspan.ai/v1
# XSPAN_USER_ID=beth.porter@xspan.health

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
2. The agent opens the XSpan MCP connection page
3. Browse **Health System Options** to find yours (lookup available via Apple Health directory and web registries)
4. Select your health system and its EHR (Epic MyChart, Cerner, eClinicalWorks, etc.)
5. Enter your EHR portal credentials (username/password)
6. Authorize XSpan to read your health records via SMART on FHIR

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

## MCP Server (Claude Desktop / Cursor / Windsurf)

XSpan Agent ships with a **Model Context Protocol (MCP) server**, so you can plug it into Claude Desktop or any MCP-compatible AI assistant.

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xspan-health": {
      "command": "node",
      "args": ["/path/to/XSpan-HealthAI-Agent/dist/mcp/index.js"],
      "env": {
        "XSPAN_API_KEY": "your_api_key_here",
        "XSPAN_USER_ID": "your_user_id"
      }
    }
  }
}
```

### Available MCP Tools (10)

| Tool | Description |
|---|---|
| `xspan_get_health_summary` | Today's health metrics snapshot |
| `xspan_get_biomarkers` | Latest biomarker readings by category |
| `xspan_get_digital_twin` | Full Digital Twin health profile |
| `xspan_log_nutrition` | Log a meal via natural language |
| `xspan_get_nudges` | Today's personalized health nudges |
| `xspan_get_health_passport` | Latest weekly Health Passport |
| `xspan_get_risk_scores` | Predictive health risk scores |
| `xspan_ask_health` | Natural language health Q&A (XSpan H-LLM) |
| `xspan_sync_apple_health` | Trigger Apple Health sync |
| `xspan_sync_ehr` | Trigger EHR data sync |

### Example Queries in Claude Desktop

> "What were my sleep patterns this week and how do they compare to my HRV trends?"

> "I just ate a chicken burrito bowl with guac. Log it and tell me how it fits my macros."

> "What does my health passport say about my cardiovascular risk?"

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
|                    |     Agent       |<-- Nutrition   |
|                    +-------+--------+    23andMe     |
|                            |             Gut.id      |
|                  +---------v----------+              |
|                  |  Local Data Store  |              |
|                  |  (~/.xspan/data)   |              |
|                  +---------+----------+              |
|                            |                         |
|                  +---------v----------+              |
|                  |   MCP Server       |<--- Claude   |
|                  |   (stdio/tcp)      |    Desktop   |
|                  +--------------------+              |
+------------------------+----------------------------+
                         | HTTPS (TLS 1.3)
                         v
          +------------------------------+
          |       XSpan Cloud            |
          |   api.xspan.ai/v1           |
          |                              |
          |  +--------+  +-----------+  |
          |  | H-LLM  |  | Digital   |  |
          |  | Engine  |  | Twin      |  |
          |  +--------+  +-----------+  |
          |  +--------+  +-----------+  |
          |  | Nudge  |  | Health    |  |
          |  | Engine |  | Passport  |  |
          |  +--------+  +-----------+  |
          +------------------------------+
```

---

## Project Structure

```
XSpan-HealthAI-Agent/
  src/
    agent/
      index.ts              # Main daemon orchestrator
    mcp/
      server.ts             # MCP server (10 tools)
      index.ts              # MCP standalone entry point
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
      xspan-api.ts          # XSpan cloud API client
      data-pipeline.ts      # ETL + biomarker synthesis
    storage/
      local-store.ts        # SQLite encrypted local store
    config/
      index.ts              # Config loader + Zod validation
    types/
      index.ts              # TypeScript interfaces
  docs/
    EHR_SETUP.md
    MCP_SETUP.md
    SPEC.md
  .env.example
  package.json
  tsconfig.json
  README.md
  LICENSE
```

---

## Privacy & Data

- **Raw health data never leaves your machine** — only normalized biomarker vectors are synced to XSpan cloud
- All local data is AES-256 encrypted in `~/.xspan/data`
- OAuth2 tokens stored in OS keychain (macOS Keychain / Windows Credential Manager)
- You can export all your data as JSON or delete everything at any time
- HIPAA-compliant cloud infrastructure

---

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Run just the MCP server
npm run mcp:dev

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

**QA Test Account:**
- User ID: `beth.porter@xspan.health`
- Password: `bethporter2026`

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Support

- **Docs:** [wiki.xspan.ai](https://wiki.xspan.ai)
- **Issues:** [github.com/karlmehta/XSpan-HealthAI-Agent/issues](https://github.com/karlmehta/XSpan-HealthAI-Agent/issues)

---

*Built by [XSpan.ai](https://xspan.ai) — Whole Body Intelligence*
