// =================================================================
// Loom — Chart time windows (filter rows by a timestamp column)
// =================================================================
// Encoding Time is a data slice, not an axis: bar maps and scatters can
// still be “last 24h” even when X is a category. Windows count back from
// the newest parseable value in the sample (same idea as Dive).
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

const TIME_NAME = /(_at$|_date$|_ts$|^ts$|^time$|^date$|timestamp|created|updated|datetime|epoch|as_of|year|^yr$|^day$)/i;

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
        : 2;
    return score(a) - score(b) || a.localeCompare(b);
  });
  return ranked[0] ?? null;
}

/**
 * Windows worth suggesting when we only know the column name (Discover /
 * Suggestions) — not the sample span. Year columns skip short windows.
 */
export function suggestedChartTimeWindows(fieldName: string): Exclude<ChartTimeRange, "all">[] {
  if (/^(yr|year)$/i.test(fieldName) || /_year$/i.test(fieldName)) return ["1y"];
  if (
    /^(ts|time|timestamp|acq_ts|epoch|created_at)$/i.test(fieldName) ||
    /(_at|_ts)$/i.test(fieldName)
  ) {
    return ["1h", "6h", "24h"];
  }
  if (/date|day|as_of|effective|expires|declaration/i.test(fieldName)) {
    return ["7d", "30d", "90d"];
  }
  return ["24h", "7d"];
}

export function chartTimeWindowLabel(range: ChartTimeRange | null | undefined): string | null {
  if (!range || range === "all") return null;
  return CHART_TIME_RANGES.find((r) => r.value === range)?.label ?? range;
}

export function applyChartTimeWindow<T extends unknown[]>(
  rows: T[],
  columns: string[],
  rec: { timeWindowField?: string | null; timeWindow?: ChartTimeRange | string | null } | null | undefined,
): { rows: T[]; filtered: boolean; kept: number; total: number } {
  const total = rows.length;
  const field = rec?.timeWindowField;
  const range = rec?.timeWindow;
  if (!field || !range || range === "all") {
    return { rows, filtered: false, kept: total, total };
  }
  const spec = CHART_TIME_RANGES.find((r) => r.value === range);
  if (!spec || !Number.isFinite(spec.ms)) {
    return { rows, filtered: false, kept: total, total };
  }
  const idx = columns.indexOf(field);
  if (idx < 0) return { rows, filtered: false, kept: total, total };

  let max = -Infinity;
  const times = rows.map((r) => {
    const t = parseChartTime(r[idx]);
    if (t != null && t > max) max = t;
    return t;
  });
  if (!Number.isFinite(max)) return { rows, filtered: false, kept: total, total };
  const cutoff = max - spec.ms;
  const next = rows.filter((_, i) => {
    const t = times[i];
    return t != null && t >= cutoff && t <= max;
  });
  return { rows: next, filtered: true, kept: next.length, total };
}
