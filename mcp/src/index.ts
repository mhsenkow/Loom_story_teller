import type { ExportedHandler } from "@cloudflare/workers-types";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { CHART_KIND_OPTIONS, chartKindDataSupport } from "../../src/lib/recommendations";
import {
  LOOM_URL,
  CHART_KIND_VALUES,
  resolveProfile,
  profileToolError,
  recommendChartsResult,
  buildChartResult,
} from "./tools";
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

const WIDGET_URI = "ui://widget/loom-charts-v1.html";
const WIDGET_MIME = "text/html+skybridge";

const widgetHtml = String(widgetHtmlRaw);

/** Escape JSON for safe embedding inside a `<script>` element. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizePreviewSeed(seed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...seed };
  if (typeof out.loomUrl === "string") {
    try {
      const u = new URL(out.loomUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") delete out.loomUrl;
      else out.loomUrl = u.href;
    } catch {
      delete out.loomUrl;
    }
  }
  return out;
}

function widgetDocument(seed?: Record<string, unknown>) {
  let seedScript = "";
  if (seed) {
    const safe = sanitizePreviewSeed(seed);
    const escaped = jsonForScript(safe);
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
      inputSchema: z.object(dataInputFields),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      let profile;
      try {
        profile = resolveProfile(args);
      } catch (e) {
        return profileToolError(e instanceof Error ? e.message : "Invalid input");
      }
      const summary = profile.columns
        .map((c) => `${c.name}:${c.data_type}(n≈${c.distinct_count})`)
        .join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Profiled ${profile.rowCount} rows × ${profile.columns.length} cols` +
              (profile.sampledRows < profile.rowCount ? ` (sampled ${profile.sampledRows})` : "") +
              (profile.truncated ? " (truncated)" : "") +
              `: ${summary || "(empty)"}`,
          },
        ],
        structuredContent: {
          columns: profile.columns,
          rowCount: profile.rowCount,
          sampledRows: profile.sampledRows,
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
        "Suggest Loom chart types (classic: scatter, bar, line, pie, heatmap, …; odd charts; geo maps; GPU scenes) from CSV, JSON, or a column schema. " +
        "Returns kinds and field encodings — call build_chart for a Vega-Lite spec. " +
        "Use when the user asks what to chart, how to visualize a table, or wants data story ideas. Opens an in-chat widget of top suggestions.",
      inputSchema: z.object({
        ...dataInputFields,
        fileName: z.string().optional().describe("Optional label for the dataset"),
        limit: z.number().int().min(1).max(12).optional().describe("Max suggestions (default 6)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: widgetToolMeta,
    },
    async (args) => recommendChartsResult(args, WIDGET_URI),
  );

  server.registerTool(
    "list_chart_kinds",
    {
      title: "List chart kinds",
      description:
        "List which Loom chart kinds (classic, odd charts, geo maps, GPU scenes) the current schema can support (and why others are blocked). " +
        "Use when choosing among pie vs bar vs scatter, etc.",
      inputSchema: z.object(dataInputFields),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      let profile;
      try {
        profile = resolveProfile(args);
      } catch (e) {
        return profileToolError(e instanceof Error ? e.message : "Invalid input");
      }
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
        "Build a Loom/Vega-Lite chart for a specific kind and encodings (x, y, color, size), with sample rows inlined as data. " +
        "Kinds cover classic charts plus odd charts, geo maps and GPU scenes. Use after recommend_charts when the user picks a type or fields.",
      inputSchema: z.object({
        ...dataInputFields,
        kind: z.enum(CHART_KIND_VALUES).describe("Loom chart kind"),
        xField: z.string(),
        yField: z.string().nullable().optional(),
        colorField: z.string().nullable().optional(),
        sizeField: z
          .string()
          .nullable()
          .optional()
          .describe("Omit to let bubble/dumbbell pick a size column; null to clear"),
        fileName: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => buildChartResult(args),
  );

  server.registerTool(
    "open_loom",
    {
      title: "Open Loom",
      description:
        "Return a deep link to the Loom data storyteller at loom.ibm.io for full local/web exploration " +
        "(DuckDB, WebGPU charts, live sources). Use when the user wants the full app.",
      inputSchema: z.object({
        note: z.string().optional().describe("Optional short note to include in the reply"),
      }),
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
} satisfies ExportedHandler<Env>;

interface Env {
  OPENAI_APPS_CHALLENGE?: string;
}
