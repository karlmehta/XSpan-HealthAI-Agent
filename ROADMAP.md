# MHS Agent — Remaining Build Items

## 1. Stripe Subscription ($5.99/mo)
- Settings page: CC form via Stripe Checkout / Payment Link
- Cancel subscription button
- Stripe webhook for payment events
- Trial management (3-day free, then gate)
- **Needs:** Stripe account + API keys from Karl

## 2. Logo Fix
- Replace current logo with XSpan.ai orange X logo
- Icon (app icon): assets/logo-icon.png
- Full logo (nav): assets/logo-full.png
- Update dashboard nav, CLI header, marketplace listings

## 3. Desktop App Packaging (Mac + Windows)
- Electron wrapper for the web dashboard
- Mac: .dmg installer (Apple Silicon + Intel)
- Windows: .exe installer (NSIS)
- Auto-update mechanism
- Menu bar / system tray icon
- **Tech:** Electron + electron-builder

## 4. Developer Dashboard (Karl's Admin Panel)
Separate admin interface at /admin or localhost:3001:

### 4a. Agent Training
- Edit skills.md files (syntax-highlighted editor)
- Edit memory.md files
- Edit prompt templates
- View/edit guardrails

### 4b. LLM Adapter Switch
- Dropdown: Claude / Gemini / GPT / Local (Ollama) / Rule-based
- API key input per adapter
- Test prompt to verify adapter works
- Hot-swap without restart

### 4c. Webhooks & MCP
- Configure outbound webhooks (Slack, Discord, email, custom)
- MCP connection manager (list connected clients)
- API key management for external access
- Webhook event log

### 4d. Distribution Management
- Publish to marketplace (OpenClaw, GitHub, npm) from one screen
- Version management
- Download/install stats
- Revenue tracking per channel

### 4e. Performance Monitoring
- Agent health dashboard
- Sync success/failure rates per source
- Response latency
- Data freshness per source
- Error logs

## 5. XSpan Platform Integration Endpoints
APIs for the main XSpan mobile app + CareHub to seamlessly co-exist:

### 5a. Mobile App Endpoints
```
POST /api/v1/mobile/sync       — receive Apple Health / Google Health data from mobile app
POST /api/v1/mobile/nudge-ack  — acknowledge nudge from mobile
GET  /api/v1/mobile/status     — health status for mobile widget
GET  /api/v1/mobile/summary    — daily summary for mobile display
```

### 5b. Premium Upgrade Path
```
POST /api/v1/upgrade           — upgrade from $5.99 agent to $19.99 premium
GET  /api/v1/premium/features  — list premium features (Digital Twin, Nudges, etc.)
GET  /api/v1/premium/status    — check if user has premium access
```

### 5c. CareHub Provider Endpoints
```
GET  /api/v1/provider/patient-summary  — for physician view (requires provider auth)
GET  /api/v1/provider/alerts           — patient alerts for care team
POST /api/v1/provider/care-plan        — assign care plan from CareHub
```

### 5d. Shared Data Layer
Both products read from the same patient data:
- Agent stores locally → syncs to XSpan cloud on premium
- Mobile app pushes to XSpan cloud → agent can pull
- Interpretation Service ensures consistent clinical interpretation
