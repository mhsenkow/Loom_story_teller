# ChatGPT plugin submission — Loom

Use with the [OpenAI plugin submission portal](https://developers.openai.com/apps-sdk/deploy/submission).

## URLs

| Field | URL |
|---|---|
| Website | `https://loom.ibm.io/` |
| Support | `https://loom.ibm.io/` |
| Privacy policy | `https://loom-mcp.mhsenkow.workers.dev/privacy` |
| Terms | `https://loom-mcp.mhsenkow.workers.dev/terms` |
| Demo | `https://loom-mcp.mhsenkow.workers.dev/demo/chat` |
| Demo (MCP API) | `https://loom-mcp.mhsenkow.workers.dev/demo` |

## Domain verification

```bash
cd mcp
npx wrangler secret put OPENAI_APPS_CHALLENGE
npm run deploy
```

Challenge URL: `https://loom-mcp.mhsenkow.workers.dev/.well-known/openai-apps-challenge`

## MCP server URL

```
https://loom-mcp.mhsenkow.workers.dev/mcp
```

Authless — no OAuth unless review requires it.

## Listing copy

### Name

```
Loom
```

Alternative: `Loom Storyteller`

### Short description (≈80 chars)

```
Turn CSV into chart stories — recommendations + Vega-Lite specs. Data is not stored.
```

### Long description

```
Loom suggests how to visualize a table: scatter, bar, line, pie, heatmap, and more — using the same recommendation engine as loom.ibm.io.

• Paste CSV or JSON and get ranked chart ideas with Vega-Lite specs
• See which chart types your columns can support
• Build a specific chart from kind + field encodings
• Open the full Loom app for local DuckDB / WebGPU storytelling

Samples are processed in memory and discarded. For private multi-million-row work, use the desktop or web app where data stays on your device.
```

### Tags

- data visualization
- charts
- vega-lite
- analytics
- csv
- storytelling

## Privacy blurb

```
The MCP server receives CSV/JSON or column schemas only when a user (or the model) calls a Loom tool. Payloads are profiled in memory and discarded after the response. No accounts, no persistent storage of table contents. The full Loom app keeps data local (desktop DuckDB / browser session).
```

## Pre-submission test

1. ChatGPT Developer Mode → connect `https://loom-mcp.mhsenkow.workers.dev/mcp`
2. *“Recommend charts for: category,value\\nA,10\\nB,20\\nA,15”* → bar/pie-style suggestions
3. Widget lists top ideas
4. *“Open Loom”* → loom.ibm.io link
