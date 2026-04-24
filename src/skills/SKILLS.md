# MHS Agent — Skill Registry

Each skill is a discrete capability that an agent can execute.
Skills map 1:1 to MCP tools and CLI commands.

## Wearable Agent Skills
- [connect-device](connect-device.md) — OAuth flow to link a wearable (Oura, WHOOP, Fitbit, etc.)
- [sync-wearables](sync-wearables.md) — Poll for new wearable data and store locally
- [get-sources](get-sources.md) — List connected and available devices

## EHR Agent Skills
- [connect-ehr](connect-ehr.md) — Authenticate and link health records
- [sync-records](sync-records.md) — Fetch FHIR health records bundle
- [get-conditions](get-conditions.md) — Return active diagnoses
- [get-medications](get-medications.md) — Return current prescriptions
- [get-allergies](get-allergies.md) — Return known allergies

## Analytics Agent Skills
- [build-charts](build-charts.md) — Generate time-series chart data from all sources
- [score-health](score-health.md) — Compute cardiovascular, metabolic, sleep, activity scores
- [detect-drift](detect-drift.md) — Compare current metrics to 30-day baseline
- [interpret-labs](interpret-labs.md) — Clinical range interpretation for lab values

## Summary Agent Skills
- [daily-briefing](daily-briefing.md) — Synthesized natural-language health summary
- [weekly-report](weekly-report.md) — Week-over-week comparison
- [answer-question](answer-question.md) — Data-grounded Q&A (zero hallucination)

## Contribute Agent Skills
- [de-identify](de-identify.md) — HIPAA Safe Harbor de-identification on-device
- [publish-to-ipfs](publish-to-ipfs.md) — Upload to Pinata IPFS
- [register-on-chain](register-on-chain.md) — Register dataset on Base mainnet
- [check-earnings](check-earnings.md) — Query USDC balance from DataExchange contract
