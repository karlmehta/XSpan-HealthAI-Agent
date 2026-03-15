# MCP Setup Guide — XSpan Agent

Connect XSpan Agent to your AI assistant via the Model Context Protocol (MCP).

---

## Claude Desktop (Recommended)

### Step 1: Install XSpan Agent
```bash
npx @xspan/agent setup
```

### Step 2: Edit Claude Desktop Config

Open the config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the XSpan MCP server:

```json
{
  "mcpServers": {
    "xspan": {
      "command": "npx",
      "args": ["@xspan/agent", "mcp"],
      "env": {
        "XSPAN_API_KEY": "your_api_key_here",
        "XSPAN_USER_ID": "your_user_id"
      }
    }
  }
}
```

> **Tip:** If you installed via `npm install -g @xspan/agent`, use `"command": "xspan-agent"` and `"args": ["mcp"]` instead.

### Step 3: Restart Claude Desktop

Quit and reopen Claude Desktop. You'll see a 🔌 icon in the toolbar when XSpan is connected.

### Step 4: Try It

Ask Claude:
- *"What were my sleep patterns this week?"*
- *"I just had a grilled chicken salad for lunch, log it."*
- *"What does my health passport say about my cardiovascular risk?"*
- *"What's my recovery score today?"*

---

## Cursor IDE

1. Open Cursor Settings → Features → MCP
2. Click "Add Server"
3. Enter:
   - **Name:** XSpan Health
   - **Command:** `npx @xspan/agent mcp`
   - **Environment:** `XSPAN_API_KEY=your_key XSPAN_USER_ID=your_id`

---

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "xspan": {
      "command": "npx",
      "args": ["@xspan/agent", "mcp"]
    }
  }
}
```

---

## Smithery (Registry)

XSpan Agent is published to the [Smithery MCP Registry](https://smithery.ai):

```bash
npx @smithery/cli install @xspan/agent
```

---

## Available Tools

Once connected, your AI assistant has access to:

| Tool | What it does |
|---|---|
| `xspan_get_health_summary` | Today's key health metrics at a glance |
| `xspan_get_biomarkers` | Lab results, vitals, trends by category |
| `xspan_get_digital_twin` | Full Digital Twin biomarker profile |
| `xspan_log_nutrition` | Log meals in natural language |
| `xspan_get_nudges` | Today's personalized health nudges |
| `xspan_get_health_passport` | Weekly Health Passport report |
| `xspan_get_risk_scores` | Predictive risk across 6 health domains |
| `xspan_ask_health` | Ask any health question (uses XSpan H-LLM) |
| `xspan_sync_apple_health` | Trigger Apple Health sync manually |
| `xspan_sync_ehr` | Trigger EHR sync manually |

---

## Troubleshooting

**"Server not connected" in Claude Desktop**
- Check that `XSPAN_API_KEY` is set correctly in the config
- Run `npx @xspan/agent mcp` in your terminal to test — it should start without errors
- Make sure you've run `npx @xspan/agent setup` first

**"No data available" responses**
- Run `xspan-agent sync` to trigger an initial data sync
- Check `~/.xspan/data/xspan.db` exists and has content

**Apple Health not syncing**
- Ensure you're on macOS and ran `npm run build:swift` to compile the HealthKit bridge
- Open Health.app and verify data is present
- Check permissions in System Preferences → Privacy & Security → Health
