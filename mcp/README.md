# Loom MCP server

Remote MCP for [loom.ibm.io](https://loom.ibm.io/) — same chart recommendation brain as the app, for ChatGPT / Claude / Cursor.

**Live endpoint:** `https://loom-mcp.mhsenkow.workers.dev/mcp`

## Tools

| Tool | Description |
|---|---|
| `profile_data` | Infer columns / types from CSV or JSON |
| `recommend_charts` | Ranked chart ideas + Vega-Lite specs (+ ChatGPT widget) |
| `list_chart_kinds` | Which of the 24 Loom kinds this schema can support |
| `build_chart` | Build one chart for kind + encodings |
| `open_loom` | Deep link to the full Loom app |

CSV/JSON is processed in memory for the request only (capped ~500 rows / 400 KB) — nothing is stored.

Shared logic: [`../src/lib/recommendations.ts`](../src/lib/recommendations.ts).

## Develop

```bash
cd mcp
npm install
npm run dev          # http://127.0.0.1:8787/mcp
```

## Deploy

```bash
cd mcp
npm run deploy       # → loom-mcp.mhsenkow.workers.dev
```

Or from repo root: `make loft-mcp`

## Verify

```bash
curl -sS https://loom-mcp.mhsenkow.workers.dev/

curl -sS -X POST https://loom-mcp.mhsenkow.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"recommend_charts","arguments":{"csv":"x,y,cat\n1,2,a\n3,4,b\n5,1,a","limit":4}}}'
```

## ChatGPT (plugin / Apps SDK)

1. Enable **Developer Mode** in ChatGPT settings.
2. Add MCP server: `https://loom-mcp.mhsenkow.workers.dev/mcp`
3. Prompt: *“Recommend charts for this CSV: …”*
4. Expect `recommend_charts` + suggestion widget.

**Directory submission:** see [SUBMISSION.md](./SUBMISSION.md).

## Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "loom": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://loom-mcp.mhsenkow.workers.dev/mcp"]
    }
  }
}
```
