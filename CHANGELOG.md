# Changelog

All notable changes to XSpan Agent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2025

### Added

- **Apple Health connector** — Reads 25+ data types from macOS HealthKit via bundled Swift bridge
- **Google Health connector** — Reads activity, sleep, vitals via Google Fit REST API with OAuth2 PKCE
- **EHR connector** — SMART on FHIR R4 support for Epic, Cerner, Redox, and generic FHIR endpoints
- **Nutrition logging** — Natural language meal logging powered by XSpan H-LLM + USDA FoodData Central
- **Digital Twin** — Synthesizes 100+ biomarkers into a unified health profile
- **MCP server** — 10 MCP tools for integration with Claude Desktop, Cursor, Windsurf
- **Nudge scheduler** — 3× daily personalized health nudges via macOS system notifications
- **Health Passport** — Weekly PDF + JSON health report generated every Sunday
- **Local-first storage** — Encrypted SQLite database at `~/.xspan/data/`
- **Interactive setup wizard** — `npx @xspan/agent setup` for guided configuration
- **CLI** — `xspan-agent start | mcp | sync | status | export | connect` commands
- **macOS LaunchAgent** — Background daemon with auto-start on login
- **GitHub Actions** — CI (multi-node testing) + automated npm publish on tag
