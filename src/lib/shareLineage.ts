// =================================================================
// Share lineage — freeze the rows that built a shared chart
// =================================================================
// "Get link" publishes a PNG story page. Without a data companion, the
// recipient's #chart= reopen re-fetches live/catalog data and the picture
// can drift. This module builds a capped JSON snapshot (columns + rows +
// source + chart encodings) that the Worker stores beside the HTML.
// =================================================================

import type { ChartLink } from "./chartLink";
import type { ColumnInfo, FileEntry, QueryResult } from "./store";

export const SHARE_DATA_VERSION = 1;

/** Soft cap so Cache API + Worker body stay comfortable (~800KB JSON). */
export const SHARE_DATA_MAX_BYTES = 800_000;
export const SHARE_DATA_MAX_ROWS = 2_500;

export interface ShareDataSnapshot {
  v: typeof SHARE_DATA_VERSION;
  capturedAt: string;
  source: {
    label: string;
    path: string;
    url?: string;
  };
  columns: string[];
  types: string[];
  /** Column stats when available (min/max/distinct) — governance, not required to redraw. */
  stats?: ColumnInfo[];
  rows: (string | number | boolean | null)[][];
  /** Rows in the full table at capture time (may exceed `rows.length`). */
  totalRows: number;
  truncated: boolean;
  /** Chart setup so "Open with shared data" rebuilds the same encoding. */
  chart?: ChartLink;
}

/** Field names encoded on the chart link (x/y/color/…). */
export function chartEncodedColumnNames(chart: ChartLink | null | undefined): string[] {
  const c = chart?.chart;
  if (!c) return [];
  const names = [
    c.xField,
    c.yField,
    c.colorField,
    c.sizeField,
    c.zField,
    c.timeField,
    c.trailId,
    c.rowField,
    c.glowField,
    c.outlineField,
    c.opacityField,
    c.shapeField,
    c.emojiField,
    c.y2Field,
    c.timeWindowField,
    c.tooltipKeyField,
    ...(c.tooltipFields ?? []),
  ].filter((n): n is string => typeof n === "string" && n.length > 0);
  return [...new Set(names)];
}

/**
 * Local / uploaded files default to image-only publish; public streams and
 * https catalog sources may default to including a data snapshot.
 */
export function defaultIncludeShareData(
  file: Pick<FileEntry, "path" | "sourceUrl"> | null | undefined,
): boolean {
  if (!file?.path) return false;
  if (file.path.startsWith("stream://")) return true;
  if (file.path.startsWith("mock://")) return true;
  const url = file.sourceUrl?.trim() ?? "";
  if (/^https?:\/\//i.test(url)) return true;
  return false;
}

export function buildShareDataSnapshot(input: {
  sample: QueryResult | null | undefined;
  file: Pick<FileEntry, "path" | "name" | "sourceUrl"> | null | undefined;
  stats?: ColumnInfo[] | null;
  chart?: ChartLink | null;
  capturedAt?: Date;
  /** When set, keep only these columns (and matching stats/types/cells). */
  columns?: string[] | null;
}): ShareDataSnapshot | null {
  const sample = input.sample;
  if (!sample?.columns?.length || !sample.rows?.length) return null;
  const file = input.file;
  const label = file?.name?.trim() || "dataset";
  const path = file?.path || `web://shared/${label}`;
  const url = file?.sourceUrl;

  let colIdx = sample.columns.map((_, i) => i);
  if (input.columns?.length) {
    const want = new Set(input.columns);
    colIdx = sample.columns
      .map((name, i) => (want.has(name) ? i : -1))
      .filter((i) => i >= 0);
    if (!colIdx.length) return null;
  }
  const columns = colIdx.map((i) => sample.columns[i]!);
  const types =
    sample.types?.length === sample.columns.length
      ? colIdx.map((i) => sample.types[i] || "VARCHAR")
      : columns.map(() => "VARCHAR");

  let rows = sample.rows.map((row) => colIdx.map((i) => row[i] ?? null));
  let truncated = rows.length > SHARE_DATA_MAX_ROWS || rows.length < (sample.total_rows || rows.length);
  if (rows.length > SHARE_DATA_MAX_ROWS) {
    // Even stride so we don't only keep the head of a sorted file.
    const stride = Math.ceil(rows.length / SHARE_DATA_MAX_ROWS);
    rows = rows.filter((_, i) => i % stride === 0).slice(0, SHARE_DATA_MAX_ROWS);
    truncated = true;
  }

  const stats =
    input.stats?.length
      ? input.stats.filter((s) => columns.includes(s.name))
      : undefined;

  const base: ShareDataSnapshot = {
    v: SHARE_DATA_VERSION,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    source: {
      label,
      path,
      ...(url && isSafeShareSourceUrl(url) ? { url } : {}),
    },
    columns,
    types,
    ...(stats?.length ? { stats } : {}),
    rows,
    totalRows: sample.total_rows || sample.rows.length,
    truncated,
    ...(input.chart ? { chart: input.chart } : {}),
  };

  // Shrink until under byte budget (drop rows from the end of the sampled set).
  const json = JSON.stringify(base);
  if (json.length <= SHARE_DATA_MAX_BYTES) return base;

  // Drop column stats first — they're nice-to-have for provenance, not for redraw.
  const withoutStats: ShareDataSnapshot = { ...base, stats: undefined };
  if (JSON.stringify(withoutStats).length <= SHARE_DATA_MAX_BYTES) {
    return { ...withoutStats, truncated: true };
  }

  let lo = 1;
  let hi = withoutStats.rows.length;
  let best: ShareDataSnapshot | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate: ShareDataSnapshot = {
      ...withoutStats,
      rows: withoutStats.rows.slice(0, mid),
      truncated: true,
    };
    const size = JSON.stringify(candidate).length;
    if (size <= SHARE_DATA_MAX_BYTES) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Only http(s) source URLs may travel with a shared snapshot (provenance / refetch). */
export function isSafeShareSourceUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function isSharePrimitive(cell: unknown): cell is string | number | boolean | null {
  return (
    cell === null ||
    typeof cell === "string" ||
    typeof cell === "boolean" ||
    (typeof cell === "number" && Number.isFinite(cell))
  );
}

function parseShareStats(raw: unknown, columns: string[]): ColumnInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const colSet = new Set(columns);
  const out: ColumnInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.name !== "string" || !colSet.has(s.name)) continue;
    if (typeof s.data_type !== "string") continue;
    out.push({
      name: s.name,
      data_type: s.data_type,
      null_count: typeof s.null_count === "number" ? s.null_count : 0,
      distinct_count: typeof s.distinct_count === "number" ? s.distinct_count : 0,
      min_value: typeof s.min_value === "string" || s.min_value === null ? (s.min_value as string | null) : null,
      max_value: typeof s.max_value === "string" || s.max_value === null ? (s.max_value as string | null) : null,
    });
  }
  return out.length ? out : undefined;
}

export function parseShareDataSnapshot(raw: unknown): ShareDataSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== SHARE_DATA_VERSION) return null;
  if (typeof o.capturedAt !== "string") return null;
  const source = o.source as ShareDataSnapshot["source"] | undefined;
  if (!source?.label || !source?.path) return null;
  if (typeof source.label !== "string" || typeof source.path !== "string") return null;
  if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return null;
  const columns = o.columns.filter((c): c is string => typeof c === "string");
  if (!columns.length || columns.length > 512) return null;
  if (o.rows.length > SHARE_DATA_MAX_ROWS) return null;
  const types = Array.isArray(o.types)
    ? o.types.map((t) => (typeof t === "string" ? t : "VARCHAR"))
    : columns.map(() => "VARCHAR");
  while (types.length < columns.length) types.push("VARCHAR");

  const rows: ShareDataSnapshot["rows"] = [];
  for (const row of o.rows) {
    if (!Array.isArray(row) || row.length < columns.length) return null;
    const cells: (string | number | boolean | null)[] = [];
    for (let i = 0; i < columns.length; i++) {
      const cell = row[i];
      if (!isSharePrimitive(cell)) return null;
      cells.push(cell);
    }
    rows.push(cells);
  }

  const sourceUrl =
    typeof source.url === "string" && isSafeShareSourceUrl(source.url) ? source.url : undefined;

  return {
    v: SHARE_DATA_VERSION,
    capturedAt: o.capturedAt,
    source: {
      label: source.label,
      path: source.path,
      ...(sourceUrl ? { url: sourceUrl } : {}),
    },
    columns,
    types: types.slice(0, columns.length),
    ...(Array.isArray(o.stats) ? { stats: parseShareStats(o.stats, columns) } : {}),
    rows,
    totalRows: typeof o.totalRows === "number" ? o.totalRows : rows.length,
    truncated: !!o.truncated,
    ...(o.chart && typeof o.chart === "object" ? { chart: o.chart as ChartLink } : {}),
  };
}

/** Path used when hydrating a published story snapshot into the web session. */
export function sharedStoryPath(storyId: string): string {
  return `web://shared/${storyId}`;
}

/** `web://shared/abcdefghijkl` → id, or null. */
export function storyIdFromSharedPath(path: string | null | undefined): string | null {
  const m = path?.match(/^web:\/\/shared\/([a-z0-9]{8,32})$/i);
  return m?.[1] ?? null;
}
