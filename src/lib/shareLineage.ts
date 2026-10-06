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

export function buildShareDataSnapshot(input: {
  sample: QueryResult | null | undefined;
  file: Pick<FileEntry, "path" | "name" | "sourceUrl"> | null | undefined;
  stats?: ColumnInfo[] | null;
  chart?: ChartLink | null;
  capturedAt?: Date;
}): ShareDataSnapshot | null {
  const sample = input.sample;
  if (!sample?.columns?.length || !sample.rows?.length) return null;
  const file = input.file;
  const label = file?.name?.trim() || "dataset";
  const path = file?.path || `web://shared/${label}`;
  const url = file?.sourceUrl;

  let rows = sample.rows;
  let truncated = rows.length > SHARE_DATA_MAX_ROWS || rows.length < (sample.total_rows || rows.length);
  if (rows.length > SHARE_DATA_MAX_ROWS) {
    // Even stride so we don't only keep the head of a sorted file.
    const stride = Math.ceil(rows.length / SHARE_DATA_MAX_ROWS);
    rows = rows.filter((_, i) => i % stride === 0).slice(0, SHARE_DATA_MAX_ROWS);
    truncated = true;
  }

  const base: ShareDataSnapshot = {
    v: SHARE_DATA_VERSION,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    source: {
      label,
      path,
      ...(url ? { url } : {}),
    },
    columns: [...sample.columns],
    types: sample.types?.length === sample.columns.length ? [...sample.types] : sample.columns.map(() => "VARCHAR"),
    ...(input.stats?.length ? { stats: input.stats } : {}),
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

export function parseShareDataSnapshot(raw: unknown): ShareDataSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== SHARE_DATA_VERSION) return null;
  if (typeof o.capturedAt !== "string") return null;
  const source = o.source as ShareDataSnapshot["source"] | undefined;
  if (!source?.label || !source?.path) return null;
  if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return null;
  const columns = o.columns.filter((c): c is string => typeof c === "string");
  if (!columns.length) return null;
  const types = Array.isArray(o.types)
    ? o.types.map((t) => (typeof t === "string" ? t : "VARCHAR"))
    : columns.map(() => "VARCHAR");
  while (types.length < columns.length) types.push("VARCHAR");
  return {
    v: SHARE_DATA_VERSION,
    capturedAt: o.capturedAt,
    source: {
      label: source.label,
      path: source.path,
      ...(source.url ? { url: source.url } : {}),
    },
    columns,
    types: types.slice(0, columns.length),
    ...(Array.isArray(o.stats) ? { stats: o.stats as ColumnInfo[] } : {}),
    rows: o.rows as ShareDataSnapshot["rows"],
    totalRows: typeof o.totalRows === "number" ? o.totalRows : (o.rows as unknown[]).length,
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
  const m = path?.match(/^web:\/\/shared\/([a-z0-9]{8,16})$/i);
  return m?.[1] ?? null;
}
