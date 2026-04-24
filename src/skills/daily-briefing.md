---
name: daily-briefing
agent: summary-agent
mcp_tool: mhs_health_status
cli_command: mhs status
---

# Daily Health Briefing

Generate a comprehensive health status summary from all connected data sources.

## Input
None required. Reads latest data from storage.

## Output Format
```
Health Status — {date}

Overall: {score}/100 — {headline}

CARDIOVASCULAR ({score}/100)
  {metric}: {value} {unit} ({date}, {source}) — {interpretation}
  ...

METABOLIC ({score}/100)
  ...

SLEEP ({score}/100)
  ...

ACTIVITY ({score}/100)
  ...

ALERTS
  {severity} {message}
  ...

Sources: {list}
Records: {count} analyzed
```

## Rules
1. Every value MUST include date and source
2. Every interpretation MUST use clinical reference ranges
3. If no data exists for a category, show "Awaiting data — connect {device type}"
4. Never extrapolate or guess values
5. Sort alerts by severity (critical > warning > info)
6. Headline must be factual, not motivational
