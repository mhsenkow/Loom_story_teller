// =================================================================
// Loom — Dive: Scuba-style slice-and-dice over in-memory rows
// =================================================================
// A query = time window + filters + group-by + metrics (+ compare
// period). runDive() evaluates it in JS so it behaves identically on
// web (no SQL engine) and desktop (rows pre-sampled by DuckDB).
// diveToSql() shows the equivalent DuckDB SQL; encode/decode put the
// whole query in the URL hash so a dive can be shared as a link.
// Derived columns (diveExpr.ts) are appended to rows before profiling,
// so filters / group by / metrics treat them like real columns.
// =================================================================

import { formatExprTime, type DiveDerived } from "./diveExpr";

type Cell = string | number | boolean | null;

export type DiveOp = "=" | "!=" | "contains" | "!contains" | "~" | "!~" | "like" | ">" | ">=" | "<" | "<=" | "is null" | "not null";
export const DIVE_OPS: DiveOp[] = ["=", "!=", "contains", "!contains", "~", "!~", "like", ">", ">=", "<", "<=", "is null", "not null"];
export const DIVE_OP_LABELS: Record<DiveOp, string> = {
  "=": "is",
  "!=": "is not",
  contains: "contains",
  "!contains": "doesn’t contain",
  "~": "matches regex",
  "!~": "doesn’t match regex",
  like: "like (% _)",
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "is null": "is empty",
  "not null": "is not empty",
};

/** Operators that make sense for a column kind (text ops for categories, ranges for numbers / time). */
export function opsForKind(kind: DiveColumnKind): DiveOp[] {
  if (kind === "category") return ["=", "!=", "contains", "!contains", "~", "!~", "like", "is null", "not null"];
  return ["=", "!=", ">", ">=", "<", "<=", "is null", "not null"];
}

/** Ops that take a list of values (OR'd for positive ops, AND'd for negative ones). */
export function opTakesValues(op: DiveOp): boolean {
  return op !== "is null" && op !== "not null";
}

export type DiveAgg = "count" | "distinct" | "sum" | "avg" | "min" | "max" | "p5" | "p25" | "p50" | "p75" | "p90" | "p95" | "p99" | "p999";
/** `numeric`: needs a number column. `time`: also works on a time column (first / last seen, mean time). */
export const DIVE_AGGS: { value: DiveAgg; label: string; needsColumn: boolean; numeric: boolean; time?: boolean }[] = [
  { value: "count", label: "Count", needsColumn: false, numeric: false },
  { value: "distinct", label: "Count distinct", needsColumn: true, numeric: false },
  { value: "sum", label: "Sum", needsColumn: true, numeric: true },
  { value: "avg", label: "Average", needsColumn: true, numeric: true, time: true },
  { value: "min", label: "Min", needsColumn: true, numeric: true, time: true },
  { value: "max", label: "Max", needsColumn: true, numeric: true, time: true },
  { value: "p5", label: "p5", needsColumn: true, numeric: true },
  { value: "p25", label: "p25", needsColumn: true, numeric: true },
  { value: "p50", label: "p50 (median)", needsColumn: true, numeric: true },
  { value: "p75", label: "p75", needsColumn: true, numeric: true },
  { value: "p90", label: "p90", needsColumn: true, numeric: true },
  { value: "p95", label: "p95", needsColumn: true, numeric: true },
  { value: "p99", label: "p99", needsColumn: true, numeric: true },
  { value: "p999", label: "p99.9", needsColumn: true, numeric: true },
];

/** Quantile for a percentile aggregate (p999 → 0.999), else null. */
export function percentileOf(agg: DiveAgg): number | null {
  const m = /^p(\d+)$/.exec(agg);
  if (!m) return null;
  const digits = m[1]!;
  return Number(`0.${digits.padStart(2, "0")}`);
}

export type DiveRange = "all" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y" | "custom";
export const DIVE_RANGES: { value: DiveRange; label: string; ms: number }[] = [
  { value: "all", label: "All time", ms: Infinity },
  { value: "15m", label: "Last 15 min", ms: 15 * 60_000 },
  { value: "1h", label: "Last hour", ms: 3_600_000 },
  { value: "6h", label: "Last 6 hours", ms: 6 * 3_600_000 },
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { value: "90d", label: "Last 90 days", ms: 90 * 86_400_000 },
  { value: "1y", label: "Last year", ms: 365 * 86_400_000 },
  { value: "custom", label: "Custom…", ms: NaN },
];

/** Quick picks for custom start / end (relative ones count back from the newest row). */
export const DIVE_TIME_PRESETS = ["-15 minutes", "-1 hour", "-3 hours", "-12 hours", "-1 day", "-3 days", "-1 week", "-1 fortnight", "-30 days", "-90 days"];

export type DiveBucket = "auto" | "fine" | "1s" | "10s" | "30s" | "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "3h" | "6h" | "1d" | "1w" | "30d";
export const DIVE_BUCKETS: { value: DiveBucket; label: string; ms: number }[] = [
  { value: "auto", label: "Auto", ms: 0 },
  { value: "fine", label: "Fine", ms: 0 },
  { value: "1s", label: "1 sec", ms: 1_000 },
  { value: "10s", label: "10 sec", ms: 10_000 },
  { value: "30s", label: "30 sec", ms: 30_000 },
  { value: "1m", label: "1 min", ms: 60_000 },
  { value: "5m", label: "5 min", ms: 5 * 60_000 },
  { value: "10m", label: "10 min", ms: 10 * 60_000 },
  { value: "15m", label: "15 min", ms: 15 * 60_000 },
  { value: "30m", label: "30 min", ms: 30 * 60_000 },
  { value: "1h", label: "1 hour", ms: 3_600_000 },
  { value: "3h", label: "3 hours", ms: 3 * 3_600_000 },
  { value: "6h", label: "6 hours", ms: 6 * 3_600_000 },
  { value: "1d", label: "1 day", ms: 86_400_000 },
  { value: "1w", label: "1 week", ms: 7 * 86_400_000 },
  { value: "30d", label: "30 days", ms: 30 * 86_400_000 },
];

export type DiveCompare = "none" | "previous" | "1d" | "1w" | "4w";
export const DIVE_COMPARES: { value: DiveCompare; label: string }[] = [
  { value: "none", label: "No comparison" },
  { value: "previous", label: "Previous period" },
  { value: "1d", label: "1 day earlier" },
  { value: "1w", label: "1 week earlier" },
  { value: "4w", label: "4 weeks earlier" },
];

/** Empty buckets: auto = 0 for counts, gap otherwise; connect = draw straight through gaps. */
export type DiveFill = "auto" | "zero" | "connect" | "blank";
export const DIVE_FILLS: { value: DiveFill; label: string }[] = [
  { value: "auto", label: "Auto (0 for counts)" },
  { value: "zero", label: "Fill with 0" },
  { value: "connect", label: "Connect points" },
  { value: "blank", label: "Leave gaps" },
];

export type DiveViewKind = "table" | "timeseries" | "samples";

export interface DiveFilter {
  column: string;
  op: DiveOp;
  /** Any of these (= / contains / ~ / like) — none of these for the negated ops. */
  values: string[];
  /** Legacy single value from older links; folded into `values` by sanitizeDiveQuery. */
  value?: string;
}

export interface DiveMetric {
  agg: DiveAgg;
  column: string | null;
}

export interface DiveQuery {
  timeColumn: string | null;
  range: DiveRange;
  /** Custom window (range = "custom"): absolute ("2026-09-01", "yesterday") or relative ("-3 hours", counts back from the newest row). Blank = open. */
  start?: string;
  end?: string;
  bucket: DiveBucket;
  fill?: DiveFill;
  filters: DiveFilter[];
  groupBy: string[];
  metrics: DiveMetric[];
  compare: DiveCompare;
  /** Max groups in the table / series in the time series. */
  limit: number;
  /** Metric index that ranks groups (and is plotted). */
  orderBy: number;
  orderDir?: "desc" | "asc";
  /** Show a Hits (row count + share) column in the table. */
  hits?: boolean;
  /** Computed columns (see diveExpr.ts); applied before the query runs. */
  derived?: DiveDerived[];
  /** Columns shown in Samples (null / absent = all). */
  columns?: string[] | null;
  view: DiveViewKind;
}

export type DiveColumnKind = "time" | "number" | "category";

export interface DiveColumnProfile {
  name: string;
  kind: DiveColumnKind;
  distinct: number;
  /** Most common values (for filter suggestions). */
  top: string[];
}

export interface DiveData {
  columns: string[];
  rows: Cell[][];
  /** Source column types when known (kept for handing rows back to charts). */
  types?: string[];
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

const DATE_LIKE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$|^\d{1,2}\/\d{1,2}\/\d{2,4}/;

/**
 * Parse a timestamp cell → epoch ms. ISO strings (naive = local time),
 * and epoch numbers in s / ms / µs / ns — told apart by magnitude, which
 * is unambiguous for dates between ~2001 and ~5000.
 */
export function toTime(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 1e17 && v < 1e20) return v / 1e6; // epoch ns
    if (v > 1e14 && v < 1e17) return v / 1e3; // epoch µs
    if (v > 1e11 && v < 1e14) return v; // epoch ms
    if (v > 1e9 && v < 1e11) return v * 1000; // epoch s
    return NaN;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!DATE_LIKE.test(s)) return NaN;
    // Date-only ISO parses as UTC midnight; keep it on local midnight like every other naive time.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

const REL_TIME = /^([+-]?\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|weeks?|fortnights?|mo|months?|y|yr|years?)(\s+ago)?$/i;

/**
 * Parse a custom window bound. Relative values ("-3 hours", "-1w", "2 days ago")
 * count back from `anchor` (the newest row) so they work on historical files;
 * "now" is the wall clock, "latest" the newest row; anything else is a date.
 */
export function parseDiveTime(text: string | undefined, anchor: number, now = Date.now()): number {
  const s = (text ?? "").trim();
  if (!s) return NaN;
  const low = s.toLowerCase();
  if (low === "now") return now;
  if (low === "latest" || low === "end") return anchor;
  if (low === "today" || low === "yesterday") {
    const d = new Date(anchor);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (low === "yesterday" ? 1 : 0)).getTime();
  }
  const m = REL_TIME.exec(s);
  if (m) {
    let qty = Number(m[1]);
    if (m[3]) qty = -Math.abs(qty);
    const u = m[2]!.toLowerCase();
    if (u.startsWith("mo")) return new Date(anchor).setMonth(new Date(anchor).getMonth() + qty);
    if (u.startsWith("y")) return new Date(anchor).setFullYear(new Date(anchor).getFullYear() + qty);
    const unit = u.startsWith("f")
      ? 14 * 86_400_000
      : u.startsWith("w")
        ? 7 * 86_400_000
        : u.startsWith("d")
          ? 86_400_000
          : u.startsWith("h")
            ? 3_600_000
            : u.startsWith("m")
              ? 60_000
              : 1000;
    return anchor + qty * unit;
  }
  const t = toTime(s);
  if (Number.isFinite(t)) return t;
  const loose = Date.parse(s);
  return Number.isFinite(loose) ? loose : NaN;
}

function cellString(v: unknown): string {
  return v == null ? "∅" : String(v);
}

// ---------------------------------------------------------------------------
// Profiling + defaults
// ---------------------------------------------------------------------------

/** Classify each column (time / number / category) from up to 2,000 rows. */
export function profileDiveColumns(data: DiveData): DiveColumnProfile[] {
  const n = Math.min(data.rows.length, 2000);
  const step = Math.max(1, Math.floor(data.rows.length / Math.max(1, n)));
  return data.columns.map((name, ci) => {
    let present = 0;
    let nums = 0;
    let times = 0;
    const freq = new Map<string, number>();
    for (let r = 0; r < data.rows.length && present < n; r += step) {
      const v = data.rows[r]![ci];
      if (isBlank(v)) continue;
      present++;
      if (Number.isFinite(toNumber(v)) && typeof v !== "boolean") nums++;
      if (Number.isFinite(toTime(v))) times++;
      const k = String(v);
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    const nameLooksTime = /(^|_)(ts|time|timestamp|date|datetime|created_at|updated_at|sent|onset)$/i.test(name);
    let kind: DiveColumnKind = "category";
    if (present > 0 && times / present >= 0.9 && (typeof data.rows.find((r) => !isBlank(r[ci]))?.[ci] === "string" || nameLooksTime)) {
      kind = "time";
    } else if (present > 0 && nums / present >= 0.9) {
      kind = "number";
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
    return { name, kind, distinct: freq.size, top };
  });
}

export function pickTimeColumn(profiles: DiveColumnProfile[]): string | null {
  const times = profiles.filter((p) => p.kind === "time");
  return (times.find((p) => /^(ts|time|timestamp)$/i.test(p.name)) ?? times[0])?.name ?? null;
}

export function defaultDiveQuery(profiles: DiveColumnProfile[]): DiveQuery {
  const timeColumn = pickTimeColumn(profiles);
  return {
    timeColumn,
    range: "all",
    start: "",
    end: "",
    bucket: "auto",
    fill: "auto",
    filters: [],
    groupBy: [],
    metrics: [{ agg: "count", column: null }],
    compare: "none",
    limit: 10,
    orderBy: 0,
    orderDir: "desc",
    hits: true,
    derived: [],
    columns: null,
    view: timeColumn ? "timeseries" : "table",
  };
}

/** Keep a query valid after the dataset (and its columns) changes. */
/** Keep a query valid after the dataset (and its columns) changes; also upgrades older links. */
export function sanitizeDiveQuery(q: DiveQuery, profiles: DiveColumnProfile[]): DiveQuery {
  const has = new Set(profiles.map((p) => p.name));
  const kindOf = new Map(profiles.map((p) => [p.name, p.kind]));
  const timeOk = q.timeColumn && profiles.some((p) => p.name === q.timeColumn && p.kind === "time");
  const metrics = q.metrics.filter((m) => {
    if (!m.column) return m.agg === "count";
    const info = DIVE_AGGS.find((a) => a.value === m.agg);
    if (!info || !has.has(m.column)) return false;
    const k = kindOf.get(m.column);
    return !info.numeric || k === "number" || (info.time && k === "time");
  });
  const timeColumn = timeOk ? q.timeColumn : pickTimeColumn(profiles);
  const filters = (q.filters ?? [])
    .filter((f) => has.has(f.column) && DIVE_OPS.includes(f.op))
    .map(({ column, op, values, value }) => ({
      column,
      op,
      values: Array.isArray(values) ? values.map(String) : value != null && value !== "" ? [String(value)] : [],
    }));
  return {
    ...q,
    timeColumn,
    range: DIVE_RANGES.some((r) => r.value === q.range) ? q.range : "all",
    start: q.start ?? "",
    end: q.end ?? "",
    bucket: DIVE_BUCKETS.some((b) => b.value === q.bucket) ? q.bucket : "auto",
    fill: q.fill ?? "auto",
    filters,
    groupBy: q.groupBy.filter((g) => has.has(g)),
    metrics: metrics.length ? metrics : [{ agg: "count", column: null }],
    orderBy: Math.min(q.orderBy, Math.max(0, metrics.length - 1)),
    orderDir: q.orderDir === "asc" ? "asc" : "desc",
    hits: q.hits ?? true,
    derived: Array.isArray(q.derived) ? q.derived : [],
    columns: Array.isArray(q.columns) ? q.columns.filter((c) => has.has(c)) : null,
    view: q.view === "timeseries" && !timeColumn ? "table" : q.view,
  };
}

export function metricLabel(m: DiveMetric): string {
  if (m.agg === "count") return "count";
  const pct = percentileOf(m.agg);
  const name = pct != null ? `p${+(pct * 100).toFixed(1)}` : (DIVE_AGGS.find((a) => a.value === m.agg)?.label ?? m.agg);
  return `${name.toLowerCase()}(${m.column ?? "?"})`;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

class MetricAcc {
  count = 0;
  sum = 0;
  n = 0;
  min = Infinity;
  max = -Infinity;
  values: number[] | null;
  distinct: Set<string> | null;
  private q: number | null;
  constructor(
    readonly m: DiveMetric,
    private time = false,
  ) {
    this.q = percentileOf(m.agg);
    this.values = this.q != null ? [] : null;
    this.distinct = m.agg === "distinct" ? new Set() : null;
  }
  add(row: Cell[], ci: number) {
    this.count++;
    if (ci < 0) return;
    const v = row[ci];
    if (this.distinct) {
      if (!isBlank(v)) this.distinct.add(String(v));
      return;
    }
    const x = this.time ? toTime(v) : toNumber(v);
    if (!Number.isFinite(x)) return;
    this.n++;
    this.sum += x;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
    this.values?.push(x);
  }
  value(): number | null {
    switch (this.m.agg) {
      case "count":
        return this.count;
      case "distinct":
        return this.distinct!.size;
      case "sum":
        return this.n ? this.sum : null;
      case "avg":
        return this.n ? this.sum / this.n : null;
      case "min":
        return this.n ? this.min : null;
      case "max":
        return this.n ? this.max : null;
      default:
        return quantile(this.values!, this.q ?? 0.5);
    }
  }
}

/** Linear-interpolated quantile (matches DuckDB quantile_cont). */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** SQL LIKE pattern → anchored, case-insensitive regex (% = any run, _ = one char). */
function likeRegex(pat: string): RegExp {
  let re = "";
  for (const ch of pat) re += ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${re}$`, "is");
}

function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
}

function compileFilter(f: DiveFilter, columns: string[], profiles: DiveColumnProfile[]): ((row: Cell[]) => boolean) | null {
  const ci = columns.indexOf(f.column);
  if (ci < 0) return null;
  const kind = profiles.find((p) => p.name === f.column)?.kind ?? "category";
  if (f.op === "is null") return (r) => isBlank(r[ci]);
  if (f.op === "not null") return (r) => !isBlank(r[ci]);
  const raws = (f.values ?? (f.value != null ? [f.value] : [])).map((v) => v.trim()).filter((v) => v !== "");
  // A filter still being typed doesn't hide everything.
  if (!raws.length) return null;
  const negated = f.op === "!=" || f.op === "!contains" || f.op === "!~";

  const one = (raw: string): ((v: Cell) => boolean) | null => {
    const lower = raw.toLowerCase();
    const num = toNumber(raw);
    const time = toTime(raw);
    const cmp = (v: Cell): number => {
      if (kind === "time") {
        const t = toTime(v);
        return Number.isFinite(t) && Number.isFinite(time) ? t - time : NaN;
      }
      const x = toNumber(v);
      if (Number.isFinite(x) && Number.isFinite(num)) return x - num;
      return String(v ?? "").localeCompare(raw);
    };
    switch (f.op) {
      case "=":
      case "!=":
        if (raw === "∅") return (v) => isBlank(v);
        if (kind === "number" && Number.isFinite(num)) return (v) => toNumber(v) === num;
        if (kind === "time" && Number.isFinite(time)) return (v) => toTime(v) === time;
        return (v) => String(v ?? "").toLowerCase() === lower;
      case "contains":
      case "!contains":
        return (v) => String(v ?? "").toLowerCase().includes(lower);
      case "~":
      case "!~": {
        const re = safeRegex(raw);
        return re ? (v) => re.test(String(v ?? "")) : null;
      }
      case "like": {
        const re = likeRegex(raw);
        return (v) => re.test(String(v ?? ""));
      }
      case ">":
        return (v) => cmp(v) > 0;
      case ">=":
        return (v) => cmp(v) >= 0;
      case "<":
        return (v) => cmp(v) < 0;
      case "<=":
        return (v) => cmp(v) <= 0;
      default:
        return null;
    }
  };
  const tests = raws.map(one).filter((t): t is (v: Cell) => boolean => !!t);
  if (!tests.length) return null;
  if (negated) return (r) => !tests.some((t) => t(r[ci]!));
  return (r) => tests.some((t) => t(r[ci]!));
}

/** True when a regex filter value doesn't compile (shown inline in the builder). */
export function badFilterValue(f: DiveFilter): string | null {
  if (f.op !== "~" && f.op !== "!~") return null;
  for (const v of f.values ?? []) if (v.trim() && !safeRegex(v.trim())) return `Not a valid regex: ${v}`;
  return null;
}

export interface DiveGroupRow {
  key: string;
  /** Group-by values in groupBy order. */
  values: string[];
  metrics: (number | null)[];
  compare: (number | null)[] | null;
  /** Rows in this group. */
  hits: number;
}

export interface DiveSeries {
  key: string;
  label: string;
  /** Plotted metric per bucket (orderBy metric). */
  points: (number | null)[];
  compare: (number | null)[] | null;
  /** Every metric per bucket, in query.metrics order (small multiples). */
  byMetric: (number | null)[][];
  compareByMetric: (number | null)[][] | null;
}

export interface DiveResult {
  scanned: number;
  matched: number;
  compareMatched: number | null;
  /** [start, end] of the active window (epoch ms) when a time column is set. */
  window: [number, number] | null;
  compareWindow: [number, number] | null;
  /** Full time extent of the data (for zoom-out / range hints). */
  extent: [number, number] | null;
  metricLabels: string[];
  /** "time" when a metric's values are epoch ms (min / max / avg of a time column). */
  metricKinds: ("number" | "time")[];
  groups: DiveGroupRow[];
  /** Number of distinct groups before the limit. */
  groupCount: number;
  total: (number | null)[];
  totalCompare: (number | null)[] | null;
  bucketMs: number;
  buckets: number[];
  series: DiveSeries[];
  samples: Cell[][];
  /** Row indices (into data.rows) that matched filters + window. */
  matchedIndices: number[];
  /** Custom start / end text that couldn't be parsed. */
  timeErrors: string[];
  elapsedMs: number;
}

const NICE_BUCKETS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 3 * 3_600_000,
  6 * 3_600_000, 12 * 3_600_000, 86_400_000, 7 * 86_400_000, 30 * 86_400_000, 91 * 86_400_000, 365 * 86_400_000,
];

/** Smallest nice bucket that keeps the series ≤ ~target points. */
export function autoBucketMs(spanMs: number, target = 60): number {
  for (const b of NICE_BUCKETS) if (spanMs / b <= target) return b;
  return NICE_BUCKETS[NICE_BUCKETS.length - 1]!;
}

/** First bucket boundary ≤ t. Day-or-longer buckets start at local midnight. */
function bucketFloor(t: number, bucketMs: number): number {
  if (bucketMs < 86_400_000) return Math.floor(t / bucketMs) * bucketMs;
  const off = -new Date(t).getTimezoneOffset() * 60_000;
  return Math.floor((t + off) / bucketMs) * bucketMs - off;
}

function compareOffset(compare: DiveCompare, windowSpan: number): number {
  switch (compare) {
    case "previous":
      return windowSpan;
    case "1d":
      return 86_400_000;
    case "1w":
      return 7 * 86_400_000;
    case "4w":
      return 28 * 86_400_000;
    default:
      return 0;
  }
}

export function runDive(data: DiveData, q: DiveQuery, profiles: DiveColumnProfile[]): DiveResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { columns, rows } = data;
  const ti = q.timeColumn ? columns.indexOf(q.timeColumn) : -1;
  const times = ti >= 0 ? rows.map((r) => toTime(r[ti])) : null;
  const timeErrors: string[] = [];

  // Window anchored to the latest row (works for historical files and live streams alike).
  let window: [number, number] | null = null;
  let compareWindow: [number, number] | null = null;
  let extent: [number, number] | null = null;
  if (times) {
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const t of times) {
      if (!Number.isFinite(t)) continue;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    if (Number.isFinite(tMax)) {
      extent = [tMin, tMax];
      let start = tMin;
      let end = tMax;
      if (q.range === "custom") {
        const s = parseDiveTime(q.start, tMax);
        const e = parseDiveTime(q.end, tMax);
        if (q.start?.trim() && !Number.isFinite(s)) timeErrors.push(`Couldn’t read start “${q.start}”`);
        if (q.end?.trim() && !Number.isFinite(e)) timeErrors.push(`Couldn’t read end “${q.end}”`);
        if (Number.isFinite(s)) start = s;
        if (Number.isFinite(e)) end = e;
        if (end < start) [start, end] = [end, start];
      } else {
        const rangeMs = DIVE_RANGES.find((r) => r.value === q.range)?.ms ?? Infinity;
        if (Number.isFinite(rangeMs)) start = tMax - rangeMs;
      }
      window = [start, end];
      const off = compareOffset(q.compare, Math.max(1, end - start));
      if (off > 0) compareWindow = [start - off, end - off];
    }
  }

  const preds = q.filters.map((f) => compileFilter(f, columns, profiles)).filter((p): p is (r: Cell[]) => boolean => !!p);
  const passes = (r: Cell[]) => preds.every((p) => p(r));
  const inWin = (t: number, w: [number, number]) => Number.isFinite(t) && t >= w[0] && t <= w[1];

  const main: number[] = [];
  const comp: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!passes(r)) continue;
    if (!window || !times) main.push(i);
    else if (inWin(times[i]!, window)) main.push(i);
    else if (compareWindow && inWin(times[i]!, compareWindow)) comp.push(i);
  }

  const kindOf = (c: string | null) => (c ? profiles.find((p) => p.name === c)?.kind : undefined);
  const metricCols = q.metrics.map((m) => (m.column ? columns.indexOf(m.column) : -1));
  const metricTime = q.metrics.map((m) => kindOf(m.column) === "time" && m.agg !== "distinct" && m.agg !== "count");
  const newAccs = () => q.metrics.map((m, mi) => new MetricAcc(m, metricTime[mi]));
  const gIdx = q.groupBy.map((g) => columns.indexOf(g));
  const keyOf = (r: Cell[]) => gIdx.map((gi) => cellString(r[gi])).join("\u0001");

  const aggregate = (idx: number[]) => {
    const groups = new Map<string, { values: string[]; accs: MetricAcc[] }>();
    const total = newAccs();
    for (const i of idx) {
      const r = rows[i]!;
      const k = keyOf(r);
      let g = groups.get(k);
      if (!g) {
        g = { values: gIdx.map((gi) => cellString(r[gi])), accs: newAccs() };
        groups.set(k, g);
      }
      g.accs.forEach((a, mi) => a.add(r, metricCols[mi]!));
      total.forEach((a, mi) => a.add(r, metricCols[mi]!));
    }
    return { groups, total: total.map((a) => a.value()) };
  };

  const cur = aggregate(main);
  const prev = compareWindow ? aggregate(comp) : null;
  const ob = Math.min(Math.max(0, q.orderBy), q.metrics.length - 1);
  const dir = q.orderDir === "asc" ? 1 : -1;
  const ranked = [...cur.groups.entries()]
    .map(([key, g]) => ({ key, values: g.values, metrics: g.accs.map((a) => a.value()), hits: g.accs[0]?.count ?? 0 }))
    .sort((a, b) => {
      const x = a.metrics[ob];
      const y = b.metrics[ob];
      // Nulls sink to the bottom in both directions.
      if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0) || a.key.localeCompare(b.key);
      return dir * (x - y) || a.key.localeCompare(b.key);
    });
  const limit = Math.max(1, q.limit);
  const groups: DiveGroupRow[] = ranked.slice(0, limit).map((g) => ({
    ...g,
    compare: prev ? (prev.groups.get(g.key)?.accs.map((a) => a.value()) ?? q.metrics.map(() => null)) : null,
  }));

  // Time series for every metric, one line per top group.
  let bucketMs = 0;
  let buckets: number[] = [];
  let series: DiveSeries[] = [];
  if (window && times) {
    const span = Math.max(1, window[1] - window[0]);
    bucketMs =
      DIVE_BUCKETS.find((b) => b.value === q.bucket)?.ms || (q.bucket === "fine" ? autoBucketMs(span, 300) : autoBucketMs(span));
    // Never more than 500 points, whatever bucket was picked.
    if (span / bucketMs > 500) bucketMs = autoBucketMs(span, 500);
    const first = bucketFloor(window[0], bucketMs);
    const nB = Math.floor((window[1] - first) / bucketMs) + 1;
    buckets = Array.from({ length: nB }, (_, i) => first + i * bucketMs);
    const off = compareWindow ? window[0] - compareWindow[0] : 0;
    const top = q.groupBy.length ? groups.map((g) => g.key) : [""];
    const topSet = new Set(top);
    const grid = (idx: number[], shift: number) => {
      const accs = new Map<string, MetricAcc[][]>();
      for (const k of top) accs.set(k, Array.from({ length: nB }, newAccs));
      for (const i of idx) {
        const r = rows[i]!;
        const k = q.groupBy.length ? keyOf(r) : "";
        if (!topSet.has(k)) continue;
        const b = Math.floor((times[i]! + shift - first) / bucketMs);
        if (b < 0 || b >= nB) continue;
        accs.get(k)![b]!.forEach((a, mi) => a.add(r, metricCols[mi]!));
      }
      return accs;
    };
    const curGrid = grid(main, 0);
    const prevGrid = compareWindow ? grid(comp, off) : null;
    const fill = q.fill ?? "auto";
    // Empty buckets: 0 when filling (auto fills counts only), otherwise a gap.
    const val = (a: MetricAcc) => {
      if (a.count > 0) return a.value();
      const zero = fill === "zero" || (fill === "auto" && (a.m.agg === "count" || a.m.agg === "distinct"));
      return zero ? 0 : null;
    };
    const perMetric = (cells: MetricAcc[][]) => q.metrics.map((_, mi) => cells.map((accs) => val(accs[mi]!)));
    series = top.map((k) => {
      const g = groups.find((x) => x.key === k);
      const byMetric = perMetric(curGrid.get(k)!);
      const compareByMetric = prevGrid ? perMetric(prevGrid.get(k)!) : null;
      return {
        key: k,
        label: q.groupBy.length ? (g?.values.join(" · ") ?? k) : metricLabel(q.metrics[ob]!),
        points: byMetric[ob]!,
        compare: compareByMetric ? compareByMetric[ob]! : null,
        byMetric,
        compareByMetric,
      };
    });
  }

  const samples = (times ? [...main].sort((a, b) => (times[b]! || 0) - (times[a]! || 0)) : main)
    .slice(0, 200)
    .map((i) => rows[i]!);

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    scanned: rows.length,
    matched: main.length,
    compareMatched: compareWindow ? comp.length : null,
    window,
    compareWindow,
    extent,
    metricLabels: q.metrics.map(metricLabel),
    metricKinds: metricTime.map((t) => (t ? "time" : "number")),
    groups,
    groupCount: cur.groups.size,
    total: cur.total,
    totalCompare: prev ? prev.total : null,
    bucketMs,
    buckets,
    series,
    samples,
    matchedIndices: main,
    timeErrors,
    elapsedMs: t1 - t0,
  };
}

// ---------------------------------------------------------------------------
// SQL preview (DuckDB)
// ---------------------------------------------------------------------------

/** DuckDB interval literal in the largest whole unit, e.g. '90 days'. */
function sqlInterval(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000));
  for (const [unit, n] of [["day", 86_400], ["hour", 3_600], ["minute", 60]] as const) {
    if (secs % n === 0) return `INTERVAL '${secs / n} ${unit}${secs / n === 1 ? "" : "s"}'`;
  }
  return `INTERVAL '${secs} seconds'`;
}

function ident(name: string): string {
  return /^[a-z_][a-z0-9_]*$/i.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;

function lit(v: string, kind: DiveColumnKind): string {
  if (kind === "number" && Number.isFinite(toNumber(v))) return String(toNumber(v));
  if (kind === "time" && Number.isFinite(toTime(v))) return `TIMESTAMP ${quote(formatExprTime(toTime(v)))}`;
  return quote(v);
}

function sqlMetric(m: DiveMetric, kind: DiveColumnKind | undefined): string {
  const c = m.column ? ident(m.column) : "*";
  const q = percentileOf(m.agg);
  if (q != null) return `quantile_cont(${c}, ${q})`;
  switch (m.agg) {
    case "count":
      return "count(*)";
    case "distinct":
      return `count(DISTINCT ${c})`;
    case "avg":
      return kind === "time" ? `to_timestamp(avg(epoch(${c})))` : `avg(${c})`;
    default:
      return `${m.agg}(${c})`;
  }
}

/** SQL for one custom-window bound, mirroring parseDiveTime. */
function sqlTimeBound(text: string, latest: string): string | null {
  const s = text.trim();
  const low = s.toLowerCase();
  if (!s) return null;
  if (low === "now") return "now()";
  if (low === "latest" || low === "end") return latest;
  if (low === "today") return `date_trunc('day', ${latest})`;
  if (low === "yesterday") return `date_trunc('day', ${latest}) - INTERVAL '1 day'`;
  const m = REL_TIME.exec(s);
  if (m) {
    let qty = Number(m[1]);
    if (m[3]) qty = -Math.abs(qty);
    const u = m[2]!.toLowerCase();
    const [n, unit] = u.startsWith("f")
      ? [qty * 14, "day"]
      : u.startsWith("mo")
        ? [qty, "month"]
        : u.startsWith("y")
          ? [qty, "year"]
          : u.startsWith("w")
            ? [qty, "week"]
            : u.startsWith("d")
              ? [qty, "day"]
              : u.startsWith("h")
                ? [qty, "hour"]
                : u.startsWith("m")
                  ? [qty, "minute"]
                  : [qty, "second"];
    const abs = Math.abs(n);
    return `${latest} ${n < 0 ? "-" : "+"} INTERVAL '${abs} ${unit}${abs === 1 ? "" : "s"}'`;
  }
  const t = parseDiveTime(s, 0);
  return Number.isFinite(t) ? `TIMESTAMP ${quote(formatExprTime(t))}` : null;
}

function sqlFilter(f: DiveFilter, kind: DiveColumnKind): string | null {
  const c = ident(f.column);
  const vals = (f.values ?? []).map((v) => v.trim()).filter(Boolean);
  if (f.op === "is null") return `${c} IS NULL`;
  if (f.op === "not null") return `${c} IS NOT NULL`;
  if (!vals.length) return null;
  const any = (parts: string[], join: "OR" | "AND") => (parts.length === 1 ? parts[0]! : `(${parts.join(` ${join} `)})`);
  const v = `${c}::VARCHAR`;
  switch (f.op) {
    case "=":
    case "!=": {
      const nulls = vals.includes("∅");
      const rest = vals.filter((x) => x !== "∅").map((x) => lit(x, kind));
      const parts: string[] = [];
      const neg = f.op === "!=";
      if (rest.length === 1) parts.push(`${c} ${neg ? "<>" : "="} ${rest[0]}`);
      else if (rest.length > 1) parts.push(`${c} ${neg ? "NOT IN" : "IN"} (${rest.join(", ")})`);
      if (nulls) parts.push(`${c} IS ${neg ? "NOT " : ""}NULL`);
      return any(parts, neg ? "AND" : "OR");
    }
    case "contains":
      return any(vals.map((x) => `${v} ILIKE ${quote(`%${x}%`)}`), "OR");
    case "!contains":
      return any(vals.map((x) => `${v} NOT ILIKE ${quote(`%${x}%`)}`), "AND");
    case "~":
      return any(vals.map((x) => `regexp_matches(${v}, ${quote(x)}, 'i')`), "OR");
    case "!~":
      return any(vals.map((x) => `NOT regexp_matches(${v}, ${quote(x)}, 'i')`), "AND");
    case "like":
      return any(vals.map((x) => `${v} ILIKE ${quote(x)}`), "OR");
    default:
      return `${c} ${f.op} ${lit(vals[0]!, kind)}`;
  }
}

/** Equivalent DuckDB SQL for the current view (table / time series / samples). */
export function diveToSql(q: DiveQuery, table: string, profiles: DiveColumnProfile[], bucketMs = 0): string {
  const kindOf = (c: string) => profiles.find((p) => p.name === c)?.kind ?? "category";
  const derived = (q.derived ?? []).filter((d) => d.enabled && d.name.trim() && d.expr.trim());
  // Derived columns ride in a CTE so the rest of the query can group / filter on them.
  const cte = derived.length
    ? `WITH src AS (\n  SELECT *,\n    ${derived.map((d) => `${d.expr.trim()} AS ${ident(d.name.trim())}`).join(",\n    ")}\n  FROM ${table}\n)\n`
    : "";
  const from = derived.length ? "src" : table;
  const where: string[] = [];
  if (q.timeColumn) {
    const tc = ident(q.timeColumn);
    const latest = `(SELECT max(${tc}) FROM ${from})`;
    if (q.range === "custom") {
      const s = sqlTimeBound(q.start ?? "", latest);
      const e = sqlTimeBound(q.end ?? "", latest);
      if (s) where.push(`${tc} >= ${s}`);
      if (e) where.push(`${tc} <= ${e}`);
    } else if (q.range !== "all") {
      const ms = DIVE_RANGES.find((r) => r.value === q.range)!.ms;
      where.push(`${tc} >= ${latest} - ${sqlInterval(ms)}`);
    }
  }
  for (const f of q.filters) {
    const w = sqlFilter(f, kindOf(f.column));
    if (w) where.push(w);
  }
  const whereSql = where.length ? `\nWHERE ${where.join("\n  AND ")}` : "";
  if (q.view === "samples") {
    const cols = q.columns?.length ? q.columns.map(ident).join(", ") : "*";
    const order = q.timeColumn ? `\nORDER BY ${ident(q.timeColumn)} DESC` : "";
    return `${cte}SELECT ${cols}\nFROM ${from}${whereSql}${order}\nLIMIT 200`;
  }
  const alias = (m: DiveMetric) => ident(metricLabel(m).replace(/[().]/g, "_").replace(/_+$/, ""));
  const metrics = q.metrics.map((m) => `${sqlMetric(m, m.column ? kindOf(m.column) : undefined)} AS ${alias(m)}`);
  const groups = q.groupBy.map(ident);
  if (q.view === "timeseries" && q.timeColumn) {
    const bucket = `time_bucket(${sqlInterval(bucketMs || 3_600_000)}, ${ident(q.timeColumn)}::TIMESTAMP) AS bucket`;
    const sel = [bucket, ...groups, ...metrics].join(",\n  ");
    return `${cte}SELECT\n  ${sel}\nFROM ${from}${whereSql}\nGROUP BY ALL\nORDER BY bucket`;
  }
  const hits = q.hits !== false && groups.length && !q.metrics.some((m) => m.agg === "count") ? ["count(*) AS hits"] : [];
  const sel = [...groups, ...metrics, ...hits].join(",\n  ");
  const groupSql = groups.length ? "\nGROUP BY ALL" : "";
  const dir = q.orderDir === "asc" ? "ASC" : "DESC";
  const orderSql = groups.length ? `\nORDER BY ${q.orderBy + groups.length + 1} ${dir} NULLS LAST\nLIMIT ${q.limit}` : "";
  return `${cte}SELECT\n  ${sel}\nFROM ${from}${whereSql}${groupSql}${orderSql}`;
}

// ---------------------------------------------------------------------------
// Shareable links (#dive=…)
// ---------------------------------------------------------------------------

export interface DiveLink {
  /** Dataset path (e.g. stream://wiki, mock://sales.csv). */
  src: string;
  query: DiveQuery;
}

/** UTF-8 safe base64url (no padding) — shared by `#dive=` and `#chart=` links. */
export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeDiveLink(link: DiveLink): string {
  return `dive=${b64urlEncode(JSON.stringify({ v: 1, ...link }))}`;
}

/** Parse `#dive=…` (with or without the leading #). Returns null when absent or malformed. */
export function decodeDiveLink(hash: string): DiveLink | null {
  const m = hash.replace(/^#/, "").match(/(?:^|&)dive=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const obj = JSON.parse(b64urlDecode(m[1]!)) as Partial<DiveLink> & { v?: number };
    if (typeof obj.src !== "string" || !obj.query || !Array.isArray(obj.query.metrics)) return null;
    return { src: obj.src, query: obj.query as DiveQuery };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatDiveNumber(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 10_000) return compact.format(v);
  if (Number.isInteger(v)) return v.toLocaleString("en");
  return v.toFixed(Math.abs(v) < 1 ? 3 : 2).replace(/\.?0+$/, "");
}

/** Relative change, e.g. "+12%". Null when not comparable. */
export function formatDelta(cur: number | null, prev: number | null): { text: string; sign: -1 | 0 | 1 } | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? { text: "0%", sign: 0 } : { text: "new", sign: 1 };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0.05 ? 1 : pct < -0.05 ? -1 : 0;
  return { text: `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%`, sign };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Bucket timestamp label sized to the bucket width. */
export function formatBucket(ms: number, bucketMs: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (bucketMs < 60_000) return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, "0")}`;
  if (bucketMs < 86_400_000) return `${MONTHS[d.getMonth()]} ${d.getDate()} ${hh}:${mm}`;
  if (bucketMs < 30 * 86_400_000) return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
