// =================================================================
// Series signals — records, "highest since", trend forecasts and
// anomalies for one measure over a month-start date column.
// =================================================================
// Discover hooks use these to say what's alarming about a feed in plain
// words, with the same inspectable methods the Analyze panel draws
// (forecastCalendar / detectSeriesAnomalies in timeSeriesAnalysis.ts).
// Pure: no store, no React.
// =================================================================

import type { QueryResult } from "./queryTypes";
import { calendarMonthIndex, detectSeriesAnomalies, forecastCalendar, type ForecastMethod } from "./timeSeriesAnalysis";

export interface SeriesPoint {
  /** "YYYY-MM-DD" (month start). */
  t: string;
  /** Epoch ms of `t` (UTC). */
  x: number;
  y: number;
}

/** One measure against a "YYYY-MM-01" date column, oldest first, nulls skipped. */
export function monthlySeries(sample: QueryResult, dateField: string, valueField: string): SeriesPoint[] {
  const di = sample.columns.indexOf(dateField);
  const vi = sample.columns.indexOf(valueField);
  if (di < 0 || vi < 0) return [];
  const out: SeriesPoint[] = [];
  for (const r of sample.rows) {
    const t = String(r[di] ?? "").slice(0, 10);
    const raw = r[vi];
    const y = typeof raw === "number" ? raw : raw == null || raw === "" ? NaN : Number(raw);
    const x = Date.parse(`${t}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    out.push({ t, x, y });
  }
  return out.sort((a, b) => a.x - b.x);
}

/** "Oct 2026" for a month-start date or epoch ms. */
export function monthName(t: string | number): string {
  const ms = typeof t === "number" ? t : Date.parse(`${t.slice(0, 7)}-15T00:00:00Z`);
  return new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export interface ExtremeSince {
  latest: SeriesPoint;
  /** True when no earlier point reaches the latest value (a record high / low). */
  record: boolean;
  /** The most recent earlier point at least as extreme, when not a record. */
  since: SeriesPoint | null;
  /** Months between `since` and the latest point (or the whole history for a record). */
  months: number;
}

/** How unusual the newest value is: a record, or the highest / lowest since some earlier month. */
export function extremeSince(points: SeriesPoint[], direction: "high" | "low"): ExtremeSince | null {
  if (points.length < 3) return null;
  const latest = points[points.length - 1]!;
  const beats = (p: SeriesPoint) => (direction === "high" ? p.y >= latest.y : p.y <= latest.y);
  let since: SeriesPoint | null = null;
  for (let i = points.length - 2; i >= 0; i--) {
    if (beats(points[i]!)) {
      since = points[i]!;
      break;
    }
  }
  const from = since ?? points[0]!;
  const months = monthsBetween(from.x, latest.x);
  return { latest, record: since == null, since, months };
}

function monthsBetween(a: number, b: number): number {
  const ia = calendarMonthIndex(a);
  const ib = calendarMonthIndex(b);
  return ia == null || ib == null ? Math.round((b - a) / (30.436875 * 86_400_000)) : ib - ia;
}

export interface TrendForecast {
  method: ForecastMethod;
  /** Month the forecast reaches (`monthsAhead` after the newest point). */
  t: string;
  y: number;
  lower: number;
  upper: number;
  /** Points the trend was fit on. */
  observations: number;
}

/**
 * Where the recent trend points `monthsAhead` from the newest value. Fits the last
 * `lookback` points with Loom's Holt ("Recent trend") or straight-line forecast.
 */
export function trendForecast(points: SeriesPoint[], monthsAhead: number, method: ForecastMethod = "holt", lookback = 60): TrendForecast | null {
  const recent = points.slice(-lookback);
  if (recent.length < 8) return null;
  const step = monthsBetween(recent[recent.length - 2]!.x, recent[recent.length - 1]!.x) || 1;
  const horizon = Math.max(1, Math.round(monthsAhead / step));
  if (horizon > 50) return null;
  const f = forecastCalendar(recent.map((p) => ({ x: p.x, y: p.y })), horizon, method);
  const last = f?.points[f.points.length - 1];
  if (!f || !last) return null;
  return { method, t: new Date(last.x).toISOString().slice(0, 10), y: last.y, lower: last.lower, upper: last.upper, observations: f.observations };
}

/** First forecast month when the recent trend crosses `threshold` (upward when `rising`), within `maxMonths`. */
export function trendCrossing(points: SeriesPoint[], threshold: number, rising: boolean, maxMonths = 48, method: ForecastMethod = "holt", lookback = 60): string | null {
  const recent = points.slice(-lookback);
  if (recent.length < 8) return null;
  const latest = recent[recent.length - 1]!;
  if (rising ? latest.y >= threshold : latest.y <= threshold) return null;
  const step = monthsBetween(recent[recent.length - 2]!.x, latest.x) || 1;
  const horizon = Math.min(50, Math.max(1, Math.floor(maxMonths / step)));
  const f = forecastCalendar(recent.map((p) => ({ x: p.x, y: p.y })), horizon, method);
  const hit = f?.points.find((p) => (rising ? p.y >= threshold : p.y <= threshold));
  return hit ? new Date(hit.x).toISOString().slice(0, 10) : null;
}

/** The most extreme anomaly (trailing median / MAD) within the last `withinLast` points, if any. */
export function recentAnomaly(points: SeriesPoint[], window = 12, threshold = 3.5, withinLast = 6): (SeriesPoint & { baseline: number; score: number }) | null {
  if (points.length <= window) return null;
  const flagged = detectSeriesAnomalies(points.map((p) => ({ x: p.x, y: p.y })), window, threshold);
  const cutoff = points[Math.max(0, points.length - withinLast)]!.x;
  // Largest break from the trailing pattern; an infinite score (flat baseline) ranks by size instead.
  const hit = flagged
    .filter((a) => a.x >= cutoff)
    .sort((a, b) => Math.abs(b.y - b.baseline) - Math.abs(a.y - a.baseline) || b.x - a.x)[0];
  if (!hit) return null;
  const p = points.find((q) => q.x === hit.x)!;
  return { ...p, baseline: hit.baseline, score: hit.score };
}

/** First month where series `a` rose above series `b` (both on the same dates), or null. */
export function firstCrossAbove(a: SeriesPoint[], b: SeriesPoint[]): string | null {
  const bAt = new Map(b.map((p) => [p.t, p.y]));
  for (const p of a) {
    const other = bAt.get(p.t);
    if (other != null && p.y > other) return p.t;
  }
  return null;
}
