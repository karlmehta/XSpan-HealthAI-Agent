# MyHealthSpan Agent — Distribution & Monetization Strategy

## Pricing
- **$5.99/month** — card payment via Stripe
- **3-day free trial** — no credit card required to start
- Not free. Not open source. Proprietary.

## 4-Step Setup (for all distribution channels)

```
Step 1: Create Account      → xspan.ai/signup (email + password)
Step 2: Install XSpan App   → iOS App Store / Google Play
        ├── Grant Apple Health / Google Health permissions
        └── This replaces the ROOK Extraction App
Step 3: Connect Wearables   → In the agent: Oura, WHOOP, Fitbit, Garmin, Dexcom, etc.
Step 4: Connect Health Records → In the agent: 650+ hospitals (Epic, Cerner, etc.)
```

After setup: Agent runs autonomously. Daily briefings. Insights via web, mobile, CLI, or MCP.

## Distribution Channels

### 1. xspan.ai (Primary — own website)
- URL: xspan.ai/agent
- Sign up → 3-day trial → $5.99/mo via Stripe
- Web-based agent dashboard (no install needed)
- Also offers download for CLI/desktop use
- XSpan mobile app handles Apple Health / Google Health extraction

### 2. Agent Marketplaces ($5.99/mo listing)

| Marketplace | Format | Status |
|-------------|--------|--------|
| **Salesforce AgentExchange** | MCP server / Slack app | To list |
| **Monday.com Apps** | Widget / integration | To list |
| **OpenClaw** | MCP server listing | To list |
| **AgentMP.ai** | Agent listing | To list |
| **AgentSMP.com** | Agent listing | To list |
| **GitHub Marketplace** | GitHub App | To list |
| **npm** | `npx @myhealthspan/agent` | To publish |
| **VS Code Marketplace** | Extension | To list |
| **Claude MCP Directory** | MCP server | To list |
| **Cursor MCP** | MCP server | To list |
| **Raycast Store** | Extension | To list |
| **Zapier** | Integration | To list |
| **Make.com** | Module | To list |

### 3. Embeddable Widget
Any website can embed the MHS agent:
```html
<script src="https://xspan.ai/agent/embed.js"></script>
<div id="mhs-agent" data-key="user-api-key"></div>
```

### 4. API Access
For developers building on top of MHS:
```
POST https://api.xspan.ai/agent/v1/status
Authorization: Bearer <user-api-key>
```

## Authentication Flow (all channels)

Every distribution channel requires an xspan.ai account:

```
Any Marketplace / Website / CLI / MCP Client
            │
            ▼
    ┌─────────────────┐
    │  xspan.ai Login  │  ← email/password or OAuth
    │  (API key issued) │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  License Check   │  ← $5.99/mo active?
    │  (Stripe status)  │  ← 3-day trial active?
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  Agent Activated │  ← all features unlocked
    └─────────────────┘
```

API endpoint: `POST https://api.xspan.ai/auth/verify`
- Input: `{ email, password }` or `{ api_key }`
- Output: `{ valid: true, tier: 'trial|paid', expires: '2026-05-19' }`

## Revenue Model

| Channel | Revenue Share | Net to XSpan |
|---------|-------------|-------------|
| xspan.ai direct | 100% | $5.99/mo |
| npm / CLI | 100% (auth via xspan.ai) | $5.99/mo |
| GitHub Marketplace | 75% (GitHub takes 25%) | ~$4.49/mo |
| Salesforce AppExchange | 85% | ~$5.09/mo |
| All other marketplaces | Varies (auth still via xspan.ai) | $4-5.99/mo |

All channels authenticate via xspan.ai → Stripe subscription.
Marketplace listing is for discovery. Payment always through XSpan.

## Mobile App Role

The XSpan mobile app (iOS + Android) serves as:
1. **Health data extractor** — reads Apple Health / Google Health
2. **Push notifications** — daily briefing, alerts, drift warnings
3. **Mobile dashboard** — view insights on phone
4. **Authentication** — biometric login (Face ID / fingerprint)

The mobile app is FREE to download. It requires an active $5.99/mo agent subscription.

The mobile app replaces the need for:
- ROOK Extraction App (we build ROOK SDK into our app)
- Separate Apple Health bridge
- Any third-party health sync app

## What Ships

### v1.0 (MVP for marketplace listing)
- [ ] CLI: `mhs status`, `mhs labs`, `mhs ask`
- [ ] MCP server: 14 tools (Claude Desktop, Cursor, OpenClaw)
- [ ] Web dashboard: localhost:3000
- [ ] Auth: xspan.ai login required
- [ ] Stripe: $5.99/mo with 3-day trial
- [ ] EHR: 650+ hospitals via b.well (invisible)
- [ ] Wearables: Oura, WHOOP, Fitbit, Garmin, Dexcom via ROOK (invisible)
- [ ] npm package: `@myhealthspan/agent`

### v1.1 (Mobile + Embed)
- [ ] XSpan iOS app with ROOK SDK + Apple Health
- [ ] XSpan Android app with ROOK SDK + Health Connect
- [ ] Embeddable widget for any website
- [ ] API access for developers

### v1.2 (Contribute & Earn)
- [ ] HIPAA de-identification on-device
- [ ] IPFS publish via Pinata
- [ ] Base mainnet smart contracts
- [ ] USDC earnings via Coinbase wallet
