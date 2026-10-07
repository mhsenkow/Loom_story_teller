// =================================================================
// Loom — Chart time windows (filter rows by a timestamp column)
// =================================================================
// Encoding Time is a data slice, not an axis. "Last Nh" for live feeds
// anchors on the wall clock so a lagging sample still means calendar
// time. Historical files (newest row far in the past) count back from
// the newest parseable value — same idea as Dive. Future-dated columns
// (approach_ts, launch net) use a forward window from now.
// =================================================================

import type { ColumnInfo } from "./store";

export type ChartTimeRange = "all" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y";

export const CHART_TIME_RANGES: { value: ChartTimeRange; label: string; short: string; ms: number }[] = [
  { value: "all", label: "All time", short: "All", ms: Infinity },
  { value: "1h", label: "Last hour", short: "1h", ms: 3_600_000 },
  { value: "6h", label: "Last 6 hours", short: "6h", ms: 6 * 3_600_000 },
  { value: "24h", label: "Last 24 hours", short: "24h", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", short: "7d", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", short: "30d", ms: 30 * 86_400_000 },
  { value: "90d", label: "Last 90 days", short: "90d", ms: 90 * 86_400_000 },
  { value: "1y", label: "Last year", short: "1y", ms: 365 * 86_400_000 },
];

/** How far ahead of wall clock counts as a "future" column (approaches, launches). */
const FUTURE_SLACK_MS = 60 * 60 * 1000;
/** Newest sample within this of now → treat as live (wall-clock windows). */
const LIVE_LOOKBACK_MS = 14 * 86_400_000;

const TIME_NAME = /(_at$|_date$|Date$|_ts$|^ts$|^time$|^date$|timestamp|created|updated|datetime|epoch|as_of|year|^yr$|^day$|declaration)/i;

export function columnLooksTemporal(dataType: string, name: string): boolean {
  const t = (dataType ?? "").toUpperCase();
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some((n) => t.includes(n))) return true;
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT"].some((n) => t.includes(n))) {
    return /^(ts|time|epoch|year|yr)$/i.test(name) || /(_at|_ts|_date)$/i.test(name);
  }
  return TIME_NAME.test(name);
}

export function temporalColumnNames(columns: ColumnInfo[]): string[] {
  return columns.filter((c) => columnLooksTemporal(c.data_type, c.name)).map((c) => c.name);
}

/** Parse a cell into epoch ms. Years 1900–2100 become Jan 1 UTC of that year. */
export function parseChartTime(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1900 && value <= 2100 && Number.isInteger(value)) return Date.UTC(value, 0, 1);
    if (value > 1e12) return value; // ms
    if (value > 1e9) return value * 1000; // seconds
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (y >= 1900 && y <= 2100) return Date.UTC(y, 0, 1);
  }
  const n = Number(s);
  if (Number.isFinite(n) && s !== "" && !/[^\d.eE+-]/.test(s)) {
    return parseChartTime(n);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function timeColumnSpanMs(rows: unknown[][], colIdx: number): number {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const t = parseChartTime(r[colIdx]);
    if (t == null) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return Math.max(0, max - min);
}

/** Presets that actually cut the sample (plus All). Hide windows wider than the span. */
export function chartTimeRangeOptions(spanMs: number): ChartTimeRange[] {
  const out: ChartTimeRange[] = ["all"];
  for (const r of CHART_TIME_RANGES) {
    if (r.value === "all") continue;
    if (!Number.isFinite(r.ms)) continue;
    if (spanMs <= 0 || r.ms < spanMs * 0.92) out.push(r.value);
  }
  return out.length > 1 ? out : ["all"];
}

type TimeFieldHints = {
  timeWindowField?: string | null;
  timeField?: string | null;
  xField?: string;
};

export function pickDefaultTimeField(
  columns: ColumnInfo[],
  rec?: TimeFieldHints | null,
): string | null {
  const names = temporalColumnNames(columns);
  if (!names.length) return null;
  const prefer = [rec?.timeWindowField, rec?.timeField, rec?.xField];
  for (const p of prefer) {
    if (p && names.includes(p)) return p;
  }
  const ranked = [...names].sort((a, b) => {
    const score = (n: string) =>
      /^(ts|time|timestamp|created_at|date_utc|acq_ts|as_of)$/i.test(n) ? 0
        : /^(created_date|record_date|declaration_date|effective)$/i.test(n) ? 1
        : /^(approach_ts|net|expires)$/i.test(n) ? 4
        : 2;
    return score(a) - score(b) || a.localeCompare(b);
  });
  return ranked[0] ?? null;
}

/** Columns that are mostly upcoming events — short "last Nh" suggestions mislead. */
export function fieldLooksFutureDated(fieldName: string): boolean {
  return /^(approach_ts|net|expires)$/i.test(fieldName) || /approach|launch.?net|expires/i.test(fieldName);
}

/**
 * Windows worth suggesting when we only know the column name (Discover /
 * Suggestions) — not the sample span. Year columns skip short windows;
 * future event times get forward-looking windows only.
 */
export function suggestedChartTimeWindows(fieldName: string): Exclude<ChartTimeRange, "all">[] {
  if (/^(yr|year)$/i.test(fieldName) || /_year$/i.test(fieldName)) return ["1y"];
  if (fieldLooksFutureDated(fieldName)) return ["24h", "7d", "30d"];
  if (
    /^(ts|time|timestamp|acq_ts|epoch|created_at)$/i.test(fieldName) ||
    /(_at|_ts)$/i.test(fieldName)
  ) {
    return ["1h", "6h", "24h"];
  }
  if (/date|day|as_of|effective|declaration/i.test(fieldName)) {
    return ["7d", "30d", "90d"];
  }
  return ["24h", "7d"];
}

export type ChartTimeAnchorMode = "wall" | "sample" | "forward";

/**
 * Pick the window anchor from the newest sample time vs wall clock.
 * - forward: sample is mostly in the future → window from now forward
 * - wall: live / recent data → "last Nh" is calendar time
 * - sample: historical files → count back from newest row
 */
export function chartTimeAnchorMode(sampleMax: number, now = Date.now()): ChartTimeAnchorMode {
  if (sampleMax > now + FUTURE_SLACK_MS) return "forward";
  if (sampleMax >= now - LIVE_LOOKBACK_MS) return "wall";
  return "sample";
}

export function chartTimeWindowLabel(
  range: ChartTimeRange | null | undefined,
  mode: ChartTimeAnchorMode = "wall",
): string | null {
  if (!range || range === "all") return null;
  const past = CHART_TIME_RANGES.find((r) => r.value === range)?.label ?? range;
  if (mode !== "forward") return past;
  switch (range) {
    case "1h":
      return "Next hour";
    case "6h":
      return "Next 6 hours";
    case "24h":
      return "Next 24 hours";
    case "7d":
      return "Next 7 days";
    case "30d":
      return "Next 30 days";
    case "90d":
      return "Next 90 days";
    case "1y":
      return "Next year";
    default:
      return past;
  }
}

export function applyChartTimeWindow<T extends unknown[]>(
  rows: T[],
  columns: string[],
  rec: { timeWindowField?: string | null; timeWindow?: ChartTimeRange | string | null } | null | undefined,
  now = Date.now(),
): { rows: T[]; filtered: boolean; kept: number; total: number; mode: ChartTimeAnchorMode | null } {
  const total = rows.length;
  const field = rec?.timeWindowField;
  const range = rec?.timeWindow;
  if (!field || !range || range === "all") {
    return { rows, filtered: false, kept: total, total, mode: null };
  }
  const spec = CHART_TIME_RANGES.find((r) => r.value === range);
  if (!spec || !Number.isFinite(spec.ms)) {
    return { rows, filtered: false, kept: total, total, mode: null };
  }
  const idx = columns.indexOf(field);
  if (idx < 0) return { rows, filtered: false, kept: total, total, mode: null };

  let max = -Infinity;
  const times = rows.map((r) => {
    const t = parseChartTime(r[idx]);
    if (t != null && t > max) max = t;
    return t;
  });
  if (!Number.isFinite(max)) return { rows, filtered: false, kept: total, total, mode: null };

  const mode = fieldLooksFutureDated(field) && max > now
    ? "forward"
    : chartTimeAnchorMode(max, now);

  let next: T[];
  if (mode === "forward") {
    const end = now + spec.ms;
    next = rows.filter((_, i) => {
      const t = times[i];
      return t != null && t >= now && t <= end;
    });
  } else if (mode === "wall") {
    const cutoff = now - spec.ms;
    next = rows.filter((_, i) => {
      const t = times[i];
      // Allow 2 min of clock skew / slightly-future telemetry
      return t != null && t >= cutoff && t <= now + 120_000;
    });
  } else {
    const cutoff = max - spec.ms;
    next = rows.filter((_, i) => {
      const t = times[i];
      return t != null && t >= cutoff && t <= max;
    });
  }
  return { rows: next, filtered: true, kept: next.length, total, mode };
}

/** Min/max parseable times for a column in the (already windowed) sample. */
export function chartDataTimeSpan(
  rows: unknown[][],
  columns: string[],
  field: string | null | undefined,
): { field: string; minMs: number; maxMs: number; count: number } | null {
  if (!field || !rows.length) return null;
  const idx = columns.indexOf(field);
  if (idx < 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const r of rows) {
    const t = parseChartTime(r[idx]);
    if (t == null) continue;
    count += 1;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!count || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { field, minMs: min, maxMs: max, count };
}

function utcYmd(ms: number): { y: number; m: number; d: number } {
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

function formatUtcDay(ms: number, withYear: boolean): string {
  const { y, m, d } = utcYmd(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]!;
  return withYear ? `${mon} ${d}, ${y}` : `${mon} ${d}`;
}

function formatUtcMonthYear(ms: number): string {
  const { y, m } = utcYmd(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]!;
  return `${mon} ${y}`;
}

function formatUtcTime(ms: number): string {
  const dt = new Date(ms);
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const mm = String(dt.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Human range for a span (UTC), e.g. "Jan 8, 2020 – Oct 6, 2026". */
export function formatChartTimeSpanRange(minMs: number, maxMs: number): string {
  if (minMs === maxMs) {
    const dt = new Date(minMs);
    const midnight =
      dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0;
    if (midnight) return formatUtcDay(minMs, true);
    return `${formatUtcDay(minMs, true)} ${formatUtcTime(minMs)} UTC`;
  }
  const a = utcYmd(minMs);
  const b = utcYmd(maxMs);
  const spanMs = maxMs - minMs;
  // Same calendar day and under 2 days → show clock times
  if (a.y === b.y && a.m === b.m && a.d === b.d && spanMs < 2 * 86_400_000) {
    return `${formatUtcDay(minMs, true)} · ${formatUtcTime(minMs)}–${formatUtcTime(maxMs)} UTC`;
  }
  // Multi-year with long span → month-year endpoints
  if (a.y !== b.y && spanMs > 400 * 86_400_000) {
    return `${formatUtcMonthYear(minMs)} – ${formatUtcMonthYear(maxMs)}`;
  }
  if (a.y === b.y) {
    return `${formatUtcDay(minMs, false)} – ${formatUtcDay(maxMs, true)}`;
  }
  return `${formatUtcDay(minMs, true)} – ${formatUtcDay(maxMs, true)}`;
}

/**
 * Footnote line for when the chart’s rows happen — window label + date range.
 * Uses Encoding Time field when set; otherwise the best temporal column.
 */
export function formatChartTimeFootnote(
  rows: unknown[][] | null | undefined,
  columns: string[] | null | undefined,
  rec: {
    timeWindowField?: string | null;
    timeWindow?: ChartTimeRange | string | null;
    timeField?: string | null;
    xField?: string;
  } | null | undefined,
  columnInfos?: ColumnInfo[] | null,
): string | null {
  if (!rows?.length || !columns?.length) return null;
  const field =
    (rec?.timeWindowField && columns.includes(rec.timeWindowField) ? rec.timeWindowField : null) ||
    (columnInfos?.length ? pickDefaultTimeField(columnInfos, rec) : null) ||
    (rec?.timeField && columns.includes(rec.timeField) ? rec.timeField : null) ||
    (rec?.xField && columns.includes(rec.xField) && columnLooksTemporal("TIMESTAMP", rec.xField)
      ? rec.xField
      : null) ||
    columns.find((c) => columnLooksTemporal("VARCHAR", c)) ||
    null;
  if (!field) return null;
  const span = chartDataTimeSpan(rows, columns, field);
  if (!span) return null;
  const range = formatChartTimeSpanRange(span.minMs, span.maxMs);
  const mode =
    fieldLooksFutureDated(field) && span.maxMs > Date.now()
      ? "forward"
      : chartTimeAnchorMode(span.maxMs);
  const windowBit = chartTimeWindowLabel(
    rec?.timeWindow && rec.timeWindow !== "all" ? (rec.timeWindow as ChartTimeRange) : null,
    mode,
  );
  if (windowBit) return `${windowBit} · ${range}`;
  // All-time / no window: still answer “when?”
  if (span.minMs === span.maxMs) return range;
  return `${range}`;
}

/** Source credit + optional time line (newline when both). */
export function composeChartFootnote(
  sourceLine: string | null | undefined,
  timeLine: string | null | undefined,
): string | null {
  const src = sourceLine?.trim() || null;
  const time = timeLine?.trim() || null;
  if (src && time) return `${src}\n${time}`;
  return src || time;
}
