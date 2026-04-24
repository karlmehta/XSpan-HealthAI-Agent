# MHS Admin Dashboard

Karl's developer dashboard for managing the MyHealthSpan Agent.

## Deploy to Vercel

```bash
cd admin
vercel --prod
```

This gives you a URL like `mhs-admin-xxx.vercel.app` which you can alias to `admin.xspan.ai`.

## What it does

- **Agent Overview** — status, sample counts, connected sources
- **Skills Editor** — edit skills.md, memory.md, prompt templates
- **LLM Adapter** — switch between Claude / Gemini / GPT / Ollama / Rule-based
- **Webhooks & MCP** — configure webhook endpoints, manage API keys
- **Distribution** — publish to npm, OpenClaw, GitHub Marketplace
- **Platform Integration** — mobile app endpoints, premium upgrade, CareHub

## Local Development

```bash
npm run admin
# Opens at http://localhost:3001
```

## Note

The admin dashboard is NOT included in the user-facing agent download.
It runs separately for the developer/operator only.
