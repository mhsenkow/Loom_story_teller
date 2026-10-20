// =================================================================
// Loom — Monitoring engine (pure)
// =================================================================
// snapshot rows → one metric value → rule verdict → check record +
// alert lifecycle. No DOM, no store: the in-app runner and the Worker
// cron call the same functions so a monitor behaves identically.
//
// "Anomaly" here means: far from what is normal *for this moment*,
// after removing known causes. Concretely:
//   1. checks inside an expected window (maintenance, planned events,
//      deliberate tests, learned "expected" reviews) never alert;
//   2. the baseline is the trailing median of earlier checks — only the
//      same hour (or weekday + hour) when `seasonal` is set — and never
//      includes the value being tested;
//   3. distance is a robust z-score (0.6745·|x − median| / MAD) so one
//      past spike cannot widen the band;
//   4. it must hold for `confirmChecks` consecutive checks.
// =================================================================

import type { QueryResult } from "../queryTypes";
import type {
  AlertOutcome,
  CheckRecord,
  CheckStatus,
  ExpectedWindow,
  MetricFilter,
  MetricSpec,
  Monitor,
  MonitorAlert,
  MonitorRule,
} from "./types";

export const MAX_HISTORY_PER_MONITOR = 500;
const MIN_ANOMALY_BASELINE = 5;

// ---- Metric ----

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function timeMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1e11 ? v : v * 1000;
  const s = String(v);
  // DuckDB "YYYY-MM-DD HH:MM:SS" is UTC in Loom tables.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T")}Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function matches(cell: unknown, f: MetricFilter): boolean {
  if (f.op === "contains") return String(cell ?? "").toLowerCase().includes(f.value.toLowerCase());
  const a = num(cell);
  const b = num(f.value);
  if (a != null && b != null) {
    switch (f.op) {
      case "=": return a === b;
      case "!=": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
    }
  }
  const s = String(cell ?? "");
  if (f.op === "=") return s.toLowerCase() === f.value.toLowerCase();
  if (f.op === "!=") return s.toLowerCase() !== f.value.toLowerCase();
  return false;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export interface MetricResult {
  value: number | null;
  rowsSeen: number;
  /** Newest timestamp in `timeColumn` (for staleness), when known. */
  newestAt: number | null;
  error?: string;
}

export function computeMetric(spec: MetricSpec, sample: QueryResult, now: number): MetricResult {
  const idx = (name?: string) => (name ? sample.columns.indexOf(name) : -1);
  const colIdx = idx(spec.column);
  const timeIdx = idx(spec.timeColumn);
  if (spec.agg !== "count" && colIdx < 0) {
    return { value: null, rowsSeen: 0, newestAt: null, error: `Column "${spec.column ?? ""}" is not in this feed` };
  }
  const filters = (spec.filters ?? []).map((f) => ({ f, i: idx(f.column) }));
  const missing = filters.find((x) => x.i < 0);
  if (missing) return { value: null, rowsSeen: 0, newestAt: null, error: `Filter column "${missing.f.column}" is not in this feed` };

  let newestAt: number | null = null;
  const cutoff = timeIdx >= 0 && spec.lookbackMinutes ? now - spec.lookbackMinutes * 60_000 : null;
  const rows = sample.rows.filter((r) => {
    if (timeIdx >= 0) {
      const t = timeMs(r[timeIdx]);
      if (t != null && (newestAt == null || t > newestAt)) newestAt = t;
      if (cutoff != null && (t == null || t < cutoff)) return false;
    }
    return filters.every(({ f, i }) => matches(r[i], f));
  });

  if (spec.agg === "count") return { value: rows.length, rowsSeen: rows.length, newestAt };
  if (spec.agg === "distinct") {
    return { value: new Set(rows.map((r) => String(r[colIdx] ?? ""))).size, rowsSeen: rows.length, newestAt };
  }
  if (spec.agg === "latest") {
    // Newest by time column when present, else first row (snapshots follow the feed's ORDER BY).
    let best: (typeof rows)[number] | undefined;
    if (timeIdx >= 0) {
      let bestT = -Infinity;
      for (const r of rows) {
        const t = timeMs(r[timeIdx]) ?? -Infinity;
        if (num(r[colIdx]) != null && t > bestT) { bestT = t; best = r; }
      }
    } else {
      best = rows.find((r) => num(r[colIdx]) != null);
    }
    return { value: best ? num(best[colIdx]) : null, rowsSeen: rows.length, newestAt };
  }
  const values = rows.map((r) => num(r[colIdx])).filter((v): v is number => v != null);
  if (!values.length) return { value: null, rowsSeen: rows.length, newestAt };
  const sorted = [...values].sort((a, b) => a - b);
  let value: number;
  switch (spec.agg) {
    case "sum": value = values.reduce((a, b) => a + b, 0); break;
    case "avg": value = values.reduce((a, b) => a + b, 0) / values.length; break;
    case "min": value = sorted[0]!; break;
    case "max": value = sorted[sorted.length - 1]!; break;
    case "median": value = quantile(sorted, 0.5); break;
    case "p95": value = quantile(sorted, 0.95); break;
  }
  return { value, rowsSeen: rows.length, newestAt };
}

// ---- Expected context ----

export function expectedWindowAt(windows: ExpectedWindow[], at: number): ExpectedWindow | null {
  const d = new Date(at);
  const wd = d.getDay();
  const hour = d.getHours() + d.getMinutes() / 60;
  for (const w of windows) {
    if (w.start != null && w.end != null) {
      if (at >= w.start && at < w.end) return w;
      continue;
    }
    if (w.weekdays?.length && !w.weekdays.includes(wd)) continue;
    if (w.fromHour == null || w.toHour == null) {
      if (w.weekdays?.length) return w;
      continue;
    }
    const inside = w.fromHour <= w.toHour ? hour >= w.fromHour && hour < w.toHour : hour >= w.fromHour || hour < w.toHour;
    if (inside) return w;
  }
  return null;
}

/** An "expected" review becomes a recurring window at that weekday and hour. */
export function windowFromReview(alert: MonitorAlert, id: string, label?: string): ExpectedWindow {
  const d = new Date(alert.openedAt);
  const h = d.getHours();
  return {
    id,
    label: label?.trim() || `Normal on ${d.toLocaleDateString(undefined, { weekday: "long" })}s around ${h}:00`,
    weekdays: [d.getDay()],
    fromHour: h,
    toHour: (h + 1) % 24 || 24,
    origin: "review",
  };
}

// ---- Rule ----

export interface RuleVerdict {
  breach: boolean;
  reason: string;
  baseline?: number;
  score?: number;
  /** Anomaly: MAD of the baseline (normal band = baseline ± sensitivity · spread / 0.6745). */
  spread?: number;
  /** Not enough history yet to judge (anomaly / baseline change). */
  warmingUp?: boolean;
}

export function fmtValue(v: number | null | undefined, unit?: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return unit ? `0 ${unit}` : "0";
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? v.toExponential(2) : abs >= 100 ? v.toFixed(0) : abs >= 1 ? v.toFixed(2).replace(/\.?0+$/, "") : v.toPrecision(3);
  return unit ? `${s} ${unit}` : s;
}

function sameSlot(a: number, b: number, seasonal: "none" | "hour" | "weekday-hour"): boolean {
  if (seasonal === "none") return true;
  const da = new Date(a);
  const db = new Date(b);
  if (da.getHours() !== db.getHours()) return false;
  return seasonal === "hour" || da.getDay() === db.getDay();
}

/** Prior values that may serve as a baseline: real readings, not expected / errored checks. */
function baselineValues(history: CheckRecord[], at: number, seasonal: "none" | "hour" | "weekday-hour", window: number): number[] {
  const out: number[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < window; i--) {
    const h = history[i]!;
    if (h.value == null || h.status === "expected" || h.status === "error" || h.status === "no-data") continue;
    if (!sameSlot(h.at, at, seasonal)) continue;
    out.push(h.value);
  }
  return out;
}

export function evaluateRule(
  rule: MonitorRule,
  value: number | null,
  history: CheckRecord[],
  at: number,
  unit?: string,
  newestAt?: number | null,
): RuleVerdict {
  if (rule.kind === "stale") {
    if (newestAt == null) return { breach: true, reason: "No timestamped rows in the feed" };
    const age = (at - newestAt) / 60_000;
    return age > rule.maxAgeMinutes
      ? { breach: true, reason: `Newest row is ${Math.round(age)} min old (limit ${rule.maxAgeMinutes} min)` }
      : { breach: false, reason: `Newest row is ${Math.round(age)} min old` };
  }
  if (value == null) return { breach: false, reason: "No value" };
  const v = fmtValue(value, unit);
  switch (rule.kind) {
    case "threshold": {
      if (rule.above != null && value > rule.above) return { breach: true, reason: `${v} is above ${fmtValue(rule.above, unit)}` };
      if (rule.below != null && value < rule.below) return { breach: true, reason: `${v} is below ${fmtValue(rule.below, unit)}` };
      return { breach: false, reason: `${v} is within limits` };
    }
    case "range": {
      if (value < rule.low || value > rule.high) {
        return { breach: true, reason: `${v} is outside ${fmtValue(rule.low, unit)}–${fmtValue(rule.high, unit)}` };
      }
      return { breach: false, reason: `${v} is inside ${fmtValue(rule.low, unit)}–${fmtValue(rule.high, unit)}` };
    }
    case "change": {
      const ref = rule.versus === "previous"
        ? baselineValues(history, at, "none", 1)[0]
        : (() => { const b = baselineValues(history, at, "none", 20); return b.length >= 3 ? median(b) : undefined; })();
      if (ref == null) return { breach: false, reason: "Waiting for an earlier check to compare with", warmingUp: true };
      const pct = ref === 0 ? (value === 0 ? 0 : Infinity) : ((value - ref) / Math.abs(ref)) * 100;
      const hit = (rule.direction === "up" && pct >= rule.pct)
        || (rule.direction === "down" && pct <= -rule.pct)
        || (rule.direction === "either" && Math.abs(pct) >= rule.pct);
      const vs = rule.versus === "previous" ? "the last check" : "the recent median";
      const pctLabel = Number.isFinite(pct) ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "∞%";
      return { breach: hit, reason: `${v} is ${pctLabel} vs ${vs} (${fmtValue(ref, unit)})`, baseline: ref };
    }
    case "anomaly": {
      const base = baselineValues(history, at, rule.seasonal, Math.max(5, Math.min(200, rule.window)));
      if (base.length < MIN_ANOMALY_BASELINE) {
        const slot = rule.seasonal === "none" ? "checks" : rule.seasonal === "hour" ? "checks at this hour" : "checks at this weekday and hour";
        return { breach: false, reason: `Learning normal: ${base.length}/${MIN_ANOMALY_BASELINE} ${slot}`, warmingUp: true };
      }
      const m = median(base);
      const mad = median(base.map((x) => Math.abs(x - m)));
      const dev = Math.abs(value - m);
      const tol = Math.max(1, Math.abs(m)) * 1e-9;
      const score = mad > tol ? (0.67448975 * dev) / mad : dev > tol ? Infinity : 0;
      const scoreLabel = Number.isFinite(score) ? score.toFixed(1) : "∞";
      return score > rule.sensitivity
        ? { breach: true, reason: `${v} is unusual (score ${scoreLabel}; normal ≈ ${fmtValue(m, unit)})`, baseline: m, score, spread: mad }
        : { breach: false, reason: `${v} is normal (score ${scoreLabel}; normal ≈ ${fmtValue(m, unit)})`, baseline: m, score, spread: mad };
    }
  }
}

// ---- Check + alert lifecycle ----

export interface CheckOutcome {
  record: CheckRecord;
  /** Updated (or newly opened) alert, if any changed. */
  alert?: MonitorAlert;
  /** True when a person should be told now. */
  notify: boolean;
}

function inQuietHours(m: Monitor, at: number): boolean {
  const { quietFromHour: f, quietToHour: t } = m.notify;
  if (f == null || t == null || f === t) return false;
  const h = new Date(at).getHours();
  return f < t ? h >= f && h < t : h >= f || h < t;
}

function consecutiveBreaches(history: CheckRecord[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i]!.status;
    if (s === "breach" || s === "firing") n++;
    else if (s === "ok" || s === "expected") break;
  }
  return n;
}

/**
 * Turn one metric reading into a record and alert transition.
 * `history` is this monitor's prior checks (oldest → newest); `open` its unresolved alert.
 */
export function runCheck(
  monitor: Monitor,
  metric: MetricResult,
  history: CheckRecord[],
  open: MonitorAlert | undefined,
  at: number,
  newId: () => string,
): CheckOutcome {
  const base = { monitorId: monitor.id, at, value: metric.value, rowsSeen: metric.rowsSeen };
  if (metric.error) {
    return { record: { ...base, status: "error", reason: metric.error }, notify: false };
  }
  // Nothing in the lookback window is a real answer ("no M6+ quake this hour"), not missing data.
  if (metric.value == null && metric.rowsSeen === 0 && monitor.metric.lookbackMinutes && monitor.rule.kind !== "stale") {
    const mins = monitor.metric.lookbackMinutes;
    const span = mins >= 1440 ? `${Math.round(mins / 1440)} d` : mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`;
    const record: CheckRecord = { ...base, status: "ok", reason: `Nothing in the last ${span}` };
    return open ? { record, alert: { ...open, closedAt: at, lastAt: at }, notify: false } : { record, notify: false };
  }
  if (metric.value == null && monitor.rule.kind !== "stale") {
    return { record: { ...base, status: "no-data", reason: metric.rowsSeen ? "No numeric values matched" : "No rows matched" }, notify: false };
  }

  const verdict = evaluateRule(monitor.rule, metric.value, history, at, monitor.metric.unit, metric.newestAt);
  const expected = expectedWindowAt(monitor.expected, at);
  if (expected) {
    const record: CheckRecord = {
      ...base,
      status: "expected",
      reason: verdict.breach ? `${verdict.reason} — expected: ${expected.label}` : verdict.reason,
      baseline: verdict.baseline,
      score: verdict.score,
      spread: verdict.spread,
    };
    return { record, notify: false };
  }

  if (!verdict.breach) {
    const record: CheckRecord = { ...base, status: "ok", reason: verdict.reason, baseline: verdict.baseline, score: verdict.score, spread: verdict.spread };
    if (open) return { record, alert: { ...open, closedAt: at, lastAt: at }, notify: false };
    return { record, notify: false };
  }

  const streak = consecutiveBreaches(history) + 1;
  const needed = Math.max(1, monitor.confirmChecks);
  let status: CheckStatus = streak >= needed ? "firing" : "breach";
  const reason = status === "breach" ? `${verdict.reason} (${streak}/${needed} checks to confirm)` : verdict.reason;
  const record: CheckRecord = { ...base, status, reason, baseline: verdict.baseline, score: verdict.score, spread: verdict.spread };
  if (status !== "firing") return { record, notify: false };

  const peak = (prev: number | null) =>
    metric.value == null ? prev : prev == null ? metric.value : Math.abs(metric.value) > Math.abs(prev) ? metric.value : prev;
  const alert: MonitorAlert = open
    ? { ...open, lastAt: at, reason: verdict.reason, peakValue: peak(open.peakValue) }
    : { id: newId(), monitorId: monitor.id, openedAt: at, lastAt: at, peakValue: metric.value, reason: verdict.reason, severity: monitor.severity };

  const cooldown = Math.max(0, monitor.notify.cooldownMinutes) * 60_000;
  const due = alert.lastNotifiedAt == null || (!alert.acknowledgedAt && at - alert.lastNotifiedAt >= cooldown && cooldown > 0);
  const notify = due && !inQuietHours(monitor, at);
  if (notify) alert.lastNotifiedAt = at;
  status = "firing";
  return { record: { ...record, status }, alert, notify };
}

// ---- Usefulness ----

export interface MonitorUsefulness {
  alerts: number;
  reviewed: number;
  acted: number;
  noise: number;
  /** Share of reviewed alerts that led to action (null until something is reviewed). */
  actionRate: number | null;
  verdict: "new" | "useful" | "noisy" | "mixed";
}

const NOISE: AlertOutcome[] = ["false-alarm", "expected", "deliberate", "ignored"];

/** Monitoring that never changes a decision is just noise — say so. */
export function monitorUsefulness(alerts: MonitorAlert[]): MonitorUsefulness {
  const reviewed = alerts.filter((a) => a.outcome);
  const acted = reviewed.filter((a) => a.outcome === "acted").length;
  const noise = reviewed.filter((a) => a.outcome && NOISE.includes(a.outcome)).length;
  const actionRate = reviewed.length ? acted / reviewed.length : null;
  const verdict = reviewed.length < 3 ? "new" : actionRate! >= 0.5 ? "useful" : actionRate! <= 0.2 ? "noisy" : "mixed";
  return { alerts: alerts.length, reviewed: reviewed.length, acted, noise, actionRate, verdict };
}

/** Readable rule summary for cards and notifications. */
export function describeRule(rule: MonitorRule, unit?: string): string {
  switch (rule.kind) {
    case "threshold": {
      const parts = [];
      if (rule.above != null) parts.push(`above ${fmtValue(rule.above, unit)}`);
      if (rule.below != null) parts.push(`below ${fmtValue(rule.below, unit)}`);
      return parts.length ? `Alert when ${parts.join(" or ")}` : "No limit set";
    }
    case "range": return `Keep between ${fmtValue(rule.low, unit)} and ${fmtValue(rule.high, unit)}`;
    case "change": return `Alert on a ${rule.pct}% ${rule.direction === "either" ? "move" : rule.direction === "up" ? "rise" : "drop"} vs ${rule.versus === "previous" ? "the last check" : "the recent median"}`;
    case "anomaly": {
      const s = rule.sensitivity <= 2.5 ? "sensitive" : rule.sensitivity >= 5 ? "conservative" : "balanced";
      const slot = rule.seasonal === "none" ? "" : rule.seasonal === "hour" ? ", same hour of day" : ", same weekday and hour";
      return `Alert when unusual (${s}, last ${rule.window} checks${slot})`;
    }
    case "stale": return `Alert if no new rows for ${rule.maxAgeMinutes} min`;
  }
}
