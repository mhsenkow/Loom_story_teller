// =================================================================
// Loom MCP — tool handlers (pure; no Worker or HTML imports so Vitest can load them)
// =================================================================

import {
  recommend,
  createChartRec,
  CHART_KIND_OPTIONS,
  chartKindDataSupport,
  getRecommendationReason,
  type ChartKind,
} from "../../src/lib/recommendations";
import type { QueryResult } from "../../src/lib/queryTypes";
import { profilePayloadSafe, type ProfileResult } from "./profile";

export const LOOM_URL = "https://loom.ibm.io/";

/** Every chart kind build_chart accepts — published as the `kind` enum in the input schema. */
export const CHART_KIND_VALUES = CHART_KIND_OPTIONS.map((o) => o.value) as [ChartKind, ...ChartKind[]];

/** Rows inlined into a build_chart spec's `data.values`. */
const SPEC_DATA_ROWS = 100;

export interface DataInput {
  csv?: string;
  json?: string;
  columns?: { name: string; data_type?: string; distinct_count?: number }[];
}

export function resolveProfile(args: DataInput): ProfileResult {
  const r = profilePayloadSafe({
    csv: args.csv,
    json: args.json,
    columns: args.columns,
  });
  if (!r.ok) {
    throw new Error(r.error);
  }
  return r.result;
}

export function profileToolError(message: string, structuredContent?: Record<string, unknown>) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function toQueryResult(profile: ProfileResult): QueryResult | null {
  if (!profile.sampleRows.length) return null;
  return {
    columns: profile.columnNames,
    types: profile.columns.map((c) => c.data_type),
    rows: profile.sampleRows,
    total_rows: profile.rowCount,
  };
}

/** Recommendation summary without the Loom-internal spec (the widget and model only need encodings). */
export function slimRec(r: {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  score: number;
  xField: string;
  yField: string | null;
  colorField: string | null;
  sizeField?: string | null;
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
  };
}

/** Exact column name, else a unique case-insensitive match, else undefined. */
function resolveField(names: string[], field: string): string | undefined {
  if (names.includes(field)) return field;
  const lower = field.toLowerCase();
  const hits = names.filter((n) => n.toLowerCase() === lower);
  return hits.length === 1 ? hits[0] : undefined;
}

/** Spec plus inline sample rows, so a client can render it without Loom. */
function standaloneSpec(spec: object, profile: ProfileResult) {
  // Schema-only input has no rows to inline, so the spec can't render on its own.
  if (Object.keys(spec).length === 0 || !profile.sampleRows.length) return { spec, renderable: false };
  // fromEntries defines own keys, so a column named "__proto__" stays a data field.
  const values = profile.sampleRows
    .slice(0, SPEC_DATA_ROWS)
    .map((row) => Object.fromEntries(profile.columnNames.map((name, i) => [name, row[i] ?? null])));
  return { spec: { ...spec, data: { values } }, renderable: true };
}

export function recommendChartsResult(
  args: DataInput & { fileName?: string; limit?: number },
  widgetUri: string,
) {
  let profile;
  try {
    profile = resolveProfile(args);
  } catch (e) {
    return profileToolError(e instanceof Error ? e.message : "Invalid input");
  }
  if (profile.columns.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No columns found — paste CSV with a header row." }],
      structuredContent: { recommendations: [], loomUrl: LOOM_URL },
      _meta: { ui: { resourceUri: widgetUri } },
    };
  }
  const data = toQueryResult(profile);
  const name = args.fileName ?? "data.csv";
  const recs = recommend(profile.columns, data, name)
    .slice(0, args.limit ?? 6)
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
          `:\n${lines}\n\nCall build_chart with a kind and fields for a Vega-Lite spec. Open full Loom: ${LOOM_URL}`,
      },
    ],
    structuredContent: structured,
    _meta: { ui: { resourceUri: widgetUri } },
  };
}

export function buildChartResult(
  args: DataInput & {
    kind: ChartKind;
    xField: string;
    yField?: string | null;
    colorField?: string | null;
    sizeField?: string | null;
    fileName?: string;
  },
) {
  let profile;
  try {
    profile = resolveProfile(args);
  } catch (e) {
    return profileToolError(e instanceof Error ? e.message : "Invalid input");
  }
  const { kind } = args;
  // Unknown or misspelled columns would otherwise build a spec that points at nothing.
  const fields: Record<"xField" | "yField" | "colorField" | "sizeField", string | null | undefined> = {
    xField: args.xField,
    yField: args.yField,
    colorField: args.colorField,
    sizeField: args.sizeField,
  };
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const f = fields[key];
    if (f == null) continue;
    const resolved = resolveField(profile.columnNames, f);
    if (resolved === undefined) {
      return profileToolError(
        `Unknown field “${f}”. Columns: ${profile.columnNames.join(", ")}`,
        { ok: false, reason: `unknown field ${f}` },
      );
    }
    fields[key] = resolved;
  }
  const support = chartKindDataSupport(profile.columns, kind);
  if (!support.ok) {
    return profileToolError(`Cannot build ${kind}: ${support.reason}`, { ok: false, reason: support.reason });
  }
  const rec = createChartRec(
    kind,
    profile.columns,
    fields.xField!,
    fields.yField ?? null,
    fields.colorField ?? null,
    args.fileName?.replace(/\.\w+$/, "") ?? "data",
    // Omit the key when unset so bubble/dumbbell can auto-pick a size column.
    fields.sizeField === undefined ? {} : { sizeField: fields.sizeField },
  );
  if (!rec) {
    return profileToolError(`Couldn't build ${kind} with those fields.`, { ok: false });
  }
  const slim = slimRec(rec);
  return {
    content: [
      {
        type: "text" as const,
        text: `Built ${slim.kind}: ${slim.title}. ${slim.reason}`,
      },
    ],
    structuredContent: { ok: true, chart: { ...slim, ...standaloneSpec(rec.spec, profile) } },
  };
}
