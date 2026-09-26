import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import {
  recommend,
  createChartRec,
  CHART_KIND_OPTIONS,
  chartKindDataSupport,
  getRecommendationReason,
  type ChartKind,
} from "../../src/lib/recommendations";
import type { QueryResult } from "../../src/lib/store";
import { profilePayload } from "./profile";
// @ts-expect-error wrangler Text module rule
import widgetHtmlRaw from "./widget.html";
// @ts-expect-error wrangler Text module rule
import demoHtml from "./demo.html";
// @ts-expect-error wrangler Text module rule
import demoChatHtml from "./demo-chat.html";
// @ts-expect-error wrangler Text module rule
import privacyHtml from "./privacy.html";
// @ts-expect-error wrangler Text module rule
import termsHtml from "./terms.html";

const LOOM_URL = "https://loom.ibm.io/";
const WIDGET_URI = "ui://widget/loom-charts-v1.html";
const WIDGET_MIME = "text/html+skybridge";

const widgetHtml = String(widgetHtmlRaw);

function widgetDocument(seed?: Record<string, unknown>) {
  let seedScript = "";
  if (seed) {
    const escaped = JSON.stringify(seed);
    seedScript =
      "<script>window.openai={toolInput:" +
      escaped +
      ",toolOutput:" +
      escaped +
      "};<\/script>";
  }
  // Strip outer html shell if present — inject into body
  const bodyMatch = widgetHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const inner = bodyMatch ? bodyMatch[1] : widgetHtml;
  const styleMatch = widgetHtml.match(/<style>([\s\S]*?)<\/style>/i);
  const style = styleMatch ? "<style>" + styleMatch[1] + "</style>" : "";
  return (
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    style +
    "</head><body>" +
    seedScript +
    inner +
    "</body></html>"
  );
}

function toQueryResult(profile: ReturnType<typeof profilePayload>): QueryResult | null {
  if (!profile.sampleRows.length) return null;
  return {
    columns: profile.columnNames,
    types: profile.columns.map((c) => c.data_type),
    rows: profile.sampleRows,
    total_rows: profile.rowCount,
  };
}

function slimRec(r: {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  score: number;
  xField: string;
  yField: string | null;
  colorField: string | null;
  sizeField?: string | null;
  spec: object;
}) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    subtitle: r.subtitle,
    score: r.score,
    xField: r.xField,
    yField: r.yField,
    colorField: r.colorField,
    sizeField: r.sizeField ?? null,
    reason: getRecommendationReason(r as Parameters<typeof getRecommendationReason>[0]),
    spec: r.spec,
  };
}

function resolveProfile(args: {
  csv?: string;
  json?: string;
  columns?: { name: string; data_type?: string; distinct_count?: number }[];
}) {
  return profilePayload({
    csv: args.csv,
    json: args.json,
    columns: args.columns,
  });
}

const dataInputFields = {
  csv: z
    .string()
    .optional()
    .describe("CSV text with header row (preferred for pasted tables; capped ~500 rows)"),
  json: z
    .string()
    .optional()
    .describe("JSON array of objects (alternative to csv)"),
  columns: z
    .array(
      z.object({
        name: z.string(),
        data_type: z.string().optional().describe("INTEGER | DOUBLE | VARCHAR | DATE | …"),
        distinct_count: z.number().int().positive().optional(),
      }),
    )
    .optional()
    .describe("Schema-only mode when you already know columns (no raw rows)"),
};

function createServer() {
  const server = new McpServer({
    name: "loom-storyteller",
    version: "1.0.0",
  });

  server.registerResource(
    "loom-charts-widget",
    WIDGET_URI,
    {
      description: "Loom chart recommendation widget for ChatGPT Apps SDK",
      mimeType: WIDGET_MIME,
    },
    async () => ({
      contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: widgetHtml }],
    }),
  );

  const widgetToolMeta = {
    "openai/outputTemplate": WIDGET_URI,
    "openai/toolInvocation/invoking": "Finding chart stories…",
    "openai/toolInvocation/invoked": "Chart suggestions ready",
    "openai/widgetAccessible": true,
    ui: { resourceUri: WIDGET_URI, prefersBorder: true },
  };

  server.registerTool(
    "profile_data",
    {
      title: "Profile data",
      description:
        "Infer column names, types, distinct counts, and a small sample from CSV or JSON. " +
        "Use before recommending charts when the user pastes a table.",
      inputSchema: dataInputFields,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const profile = resolveProfile(args);
      const summary = profile.columns
        .map((c) => `${c.name}:${c.data_type}(n≈${c.distinct_count})`)
        .join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Profiled ${profile.rowCount} rows × ${profile.columns.length} cols` +
              (profile.truncated ? " (truncated)" : "") +
              `: ${summary || "(empty)"}`,
          },
        ],
        structuredContent: {
          columns: profile.columns,
          rowCount: profile.rowCount,
          truncated: profile.truncated,
          samplePreview: profile.sampleRows.slice(0, 5),
        },
      };
    },
  );

  server.registerTool(
    "recommend_charts",
    {
      title: "Recommend charts",
      description:
        "Suggest Loom chart types (scatter, bar, line, pie, heatmap, …) with Vega-Lite specs from CSV, JSON, or a column schema. " +
        "Use when the user asks what to chart, how to visualize a table, or wants data story ideas. Opens an in-chat widget of top suggestions.",
      inputSchema: {
        ...dataInputFields,
        fileName: z.string().optional().describe("Optional label for the dataset"),
        limit: z.number().int().min(1).max(12).optional().describe("Max suggestions (default 6)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: widgetToolMeta,
    },
    async ({ csv, json, columns, fileName, limit }) => {
      const profile = resolveProfile({ csv, json, columns });
      if (profile.columns.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No columns found — paste CSV with a header row." }],
          structuredContent: { recommendations: [], loomUrl: LOOM_URL },
          _meta: { ui: { resourceUri: WIDGET_URI } },
        };
      }
      const data = toQueryResult(profile);
      const name = fileName ?? "data.csv";
      const recs = recommend(profile.columns, data, name)
        .slice(0, limit ?? 6)
        .map(slimRec);
      const lines = recs
        .map((r, i) => `${i + 1}. [${r.kind}] ${r.title} — ${r.reason}`)
        .join("\n");
      const structured = {
        recommendations: recs,
        fileName: name,
        rowCount: profile.rowCount,
        columnCount: profile.columns.length,
        truncated: profile.truncated,
        loomUrl: LOOM_URL,
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Top ${recs.length} Loom chart ideas for “${name}”` +
              (profile.truncated ? " (sample truncated)" : "") +
              `:\n${lines}\n\nOpen full Loom: ${LOOM_URL}`,
          },
        ],
        structuredContent: structured,
        _meta: { ui: { resourceUri: WIDGET_URI } },
      };
    },
  );

  server.registerTool(
    "list_chart_kinds",
    {
      title: "List chart kinds",
      description:
        "List which Loom chart types the current schema can support (and why others are blocked). " +
        "Use when choosing among pie vs bar vs scatter, etc.",
      inputSchema: dataInputFields,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const profile = resolveProfile(args);
      const kinds = CHART_KIND_OPTIONS.map((opt) => {
        const support = chartKindDataSupport(profile.columns, opt.value);
        return { kind: opt.value, label: opt.label, ok: support.ok, reason: support.reason || null };
      });
      const ok = kinds.filter((k) => k.ok).map((k) => k.label);
      const no = kinds.filter((k) => !k.ok);
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Supported: ${ok.join(", ") || "none"}.` +
              (no.length
                ? ` Blocked: ${no
                    .slice(0, 6)
                    .map((k) => `${k.label} (${k.reason})`)
                    .join("; ")}`
                : ""),
          },
        ],
        structuredContent: { kinds, columns: profile.columns.map((c) => c.name) },
      };
    },
  );

  server.registerTool(
    "build_chart",
    {
      title: "Build chart spec",
      description:
        "Build a Loom/Vega-Lite chart recommendation for a specific kind and encodings (x, y, color, size). " +
        "Use after recommend_charts when the user picks a type or fields.",
      inputSchema: {
        ...dataInputFields,
        kind: z
          .string()
          .describe("Chart kind: scatter | bar | line | pie | heatmap | …"),
        xField: z.string(),
        yField: z.string().nullable().optional(),
        colorField: z.string().nullable().optional(),
        sizeField: z.string().nullable().optional(),
        fileName: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ csv, json, columns, kind, xField, yField, colorField, sizeField, fileName }) => {
      const profile = resolveProfile({ csv, json, columns });
      const kindOk = CHART_KIND_OPTIONS.some((o) => o.value === kind);
      if (!kindOk) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown kind “${kind}”. Valid: ${CHART_KIND_OPTIONS.map((o) => o.value).join(", ")}`,
            },
          ],
          structuredContent: { ok: false },
        };
      }
      const chartKind = kind as ChartKind;
      const support = chartKindDataSupport(profile.columns, chartKind);
      if (!support.ok) {
        return {
          content: [{ type: "text" as const, text: `Cannot build ${kind}: ${support.reason}` }],
          structuredContent: { ok: false, reason: support.reason },
        };
      }
      const rec = createChartRec(
        chartKind,
        profile.columns,
        xField,
        yField ?? null,
        colorField ?? null,
        fileName?.replace(/\.\w+$/, "") ?? "data",
        { sizeField: sizeField ?? null },
      );
      if (!rec) {
        return {
          content: [{ type: "text" as const, text: `createChartRec failed for ${kind} with those fields.` }],
          structuredContent: { ok: false },
        };
      }
      const slim = slimRec(rec);
      return {
        content: [
          {
            type: "text" as const,
            text: `Built ${slim.kind}: ${slim.title}. ${slim.reason}`,
          },
        ],
        structuredContent: { ok: true, chart: slim },
      };
    },
  );

  server.registerTool(
    "open_loom",
    {
      title: "Open Loom",
      description:
        "Return a deep link to the Loom data storyteller at loom.ibm.io for full local/web exploration " +
        "(DuckDB, WebGPU charts, live sources). Use when the user wants the full app.",
      inputSchema: {
        note: z.string().optional().describe("Optional short note to include in the reply"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ note }) => {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Open Loom: ${LOOM_URL}` +
              (note ? ` — ${note}` : " — mount data, pick a chart story, export PNG/SVG."),
          },
        ],
        structuredContent: { url: LOOM_URL },
      };
    },
  );

  return server;
}

const mcpHandler = createMcpHandler(createServer, {
  route: "/mcp",
  corsOptions: {
    origin: "*",
    methods: "GET, POST, OPTIONS",
    headers: "Content-Type, Authorization, Mcp-Session-Id",
  },
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/demo") {
      return new Response(demoHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/demo/chat") {
      return new Response(demoChatHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/preview") {
      let seed: Record<string, unknown> | undefined;
      const raw = url.searchParams.get("seed");
      if (raw) {
        try {
          seed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          seed = undefined;
        }
      }
      return new Response(widgetDocument(seed), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self' 'unsafe-inline'; connect-src *",
        },
      });
    }
    if (url.pathname === "/privacy") {
      return new Response(privacyHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/terms") {
      return new Response(termsHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/.well-known/openai-apps-challenge") {
      const token = env.OPENAI_APPS_CHALLENGE;
      if (!token) {
        return new Response(
          "Domain verification token not configured. Set OPENAI_APPS_CHALLENGE in wrangler.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }
      return new Response(token, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        JSON.stringify({
          name: "Loom Storyteller MCP",
          version: "1.0.0",
          mcp: `${url.origin}/mcp`,
          demo: `${url.origin}/demo`,
          demoChat: `${url.origin}/demo/chat`,
          preview: `${url.origin}/preview`,
          privacy: `${url.origin}/privacy`,
          terms: `${url.origin}/terms`,
          site: LOOM_URL,
          tools: [
            "profile_data",
            "recommend_charts",
            "list_chart_kinds",
            "build_chart",
            "open_loom",
          ],
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    return mcpHandler(request, env, ctx);
  },
} satisfies ExportedHandler;

interface Env {
  OPENAI_APPS_CHALLENGE?: string;
}
