---
name: answer-question
agent: summary-agent
mcp_tool: mhs_ask
cli_command: mhs ask
---

# Health Question Answering

Answer any health question using ONLY the user's actual data. Zero hallucination.

## Input
- `question`: string — natural language question (e.g., "How is my cholesterol trending?")

## Process
1. Parse question for relevant health domains (cardiovascular, metabolic, sleep, etc.)
2. Query storage for matching data types
3. If data exists: build answer citing specific values, dates, sources
4. If no data: say "I don't have data for that. Connect {relevant device/provider}."
5. Never use general medical knowledge — only the user's own data

## Output Format
```
{direct answer to the question}

Based on your data:
- {metric}: {value} {unit} on {date} from {source}
- {metric}: {value} {unit} on {date} from {source}

{interpretation using clinical reference ranges}

{trend if multiple data points exist: "Trending {up/down/stable} over {period}"}
```

## Guardrails
- NEVER say "likely", "probably", "may indicate" without data
- ALWAYS cite the specific record: value + date + source
- If only 1 data point: say "Based on a single measurement on {date}"
- If multiple: say "Based on {N} measurements from {date range}"
- For trending questions: need at least 2 data points on different dates
- If asked about something not in data: "I don't have {X} data. To track this, connect {device}."
