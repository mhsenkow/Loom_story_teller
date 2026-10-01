// =================================================================
// Loom — Dive: Scuba-style slice-and-dice over in-memory rows
// =================================================================
// A query = time window + filters + group-by + metrics (+ compare
// period). runDive() evaluates it in JS so it behaves identically on
// web (no SQL engine) and desktop (rows pre-sampled by DuckDB).
// diveToSql() shows the equivalent DuckDB SQL; encode/decode put the
// whole query in the URL hash so a dive can be shared as a link.
// =================================================================

type Cell = string | number | boolean | null;

export type DiveOp = "=" | "!=" | "contains" | "!contains" | ">" | ">=" | "<" | "<=" | "is null" | "not null";
export const DIVE_OPS: DiveOp[] = ["=", "!=", "contains", "!contains", ">", ">=", "<", "<=", "is null", "not null"];

export type DiveAgg = "count" | "distinct" | "sum" | "avg" | "min" | "max" | "p50" | "p90" | "p99";
export const DIVE_AGGS: { value: DiveAgg; label: string; needsColumn: boolean; numeric: boolean }[] = [
  { value: "count", label: "Count", needsColumn: false, numeric: false },
  { value: "distinct", label: "Count distinct", needsColumn: true, numeric: false },
  { value: "sum", label: "Sum", needsColumn: true, numeric: true },
  { value: "avg", label: "Average", needsColumn: true, numeric: true },
  { value: "min", label: "Min", needsColumn: true, numeric: true },
  { value: "max", label: "Max", needsColumn: true, numeric: true },
  { value: "p50", label: "p50", needsColumn: true, numeric: true },
  { value: "p90", label: "p90", needsColumn: true, numeric: true },
  { value: "p99", label: "p99", needsColumn: true, numeric: true },
];

export type DiveRange = "all" | "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y";
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
];

export type DiveBucket = "auto" | "1m" | "5m" | "15m" | "1h" | "6h" | "1d" | "1w" | "30d";
export const DIVE_BUCKETS: { value: DiveBucket; label: string; ms: number }[] = [
  { value: "auto", label: "Auto", ms: 0 },
  { value: "1m", label: "1 min", ms: 60_000 },
  { value: "5m", label: "5 min", ms: 5 * 60_000 },
  { value: "15m", label: "15 min", ms: 15 * 60_000 },
  { value: "1h", label: "1 hour", ms: 3_600_000 },
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

export type DiveViewKind = "table" | "timeseries" | "samples";

export interface DiveFilter {
  column: string;
  op: DiveOp;
  value: string;
}

export interface DiveMetric {
  agg: DiveAgg;
  column: string | null;
}

export interface DiveQuery {
  timeColumn: string | null;
  range: DiveRange;
  bucket: DiveBucket;
  filters: DiveFilter[];
  groupBy: string[];
  metrics: DiveMetric[];
  compare: DiveCompare;
  /** Max groups in the table / series in the time series. */
  limit: number;
  /** Metric index that ranks groups (and is plotted). */
  orderBy: number;
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

/** Parse a timestamp cell → epoch ms (ISO strings, epoch s/ms numbers). */
export function toTime(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 1e11 && v < 1e14) return v; // epoch ms
    if (v > 1e9 && v < 1e11) return v * 1000; // epoch s
    return NaN;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!DATE_LIKE.test(s)) return NaN;
    const t = Date.parse(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s);
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
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
    bucket: "auto",
    filters: [],
    groupBy: [],
    metrics: [{ agg: "count", column: null }],
    compare: "none",
    limit: 10,
    orderBy: 0,
    view: timeColumn ? "timeseries" : "table",
  };
}

/** Keep a query valid after the dataset (and its columns) changes. */
export function sanitizeDiveQuery(q: DiveQuery, profiles: DiveColumnProfile[]): DiveQuery {
  const has = new Set(profiles.map((p) => p.name));
  const timeOk = q.timeColumn && profiles.some((p) => p.name === q.timeColumn && p.kind === "time");
  const metrics = q.metrics.filter((m) => !m.column || has.has(m.column));
  const timeColumn = timeOk ? q.timeColumn : pickTimeColumn(profiles);
  return {
    ...q,
    timeColumn,
    filters: q.filters.filter((f) => has.has(f.column)),
    groupBy: q.groupBy.filter((g) => has.has(g)),
    metrics: metrics.length ? metrics : [{ agg: "count", column: null }],
    orderBy: Math.min(q.orderBy, Math.max(0, metrics.length - 1)),
    view: q.view === "timeseries" && !timeColumn ? "table" : q.view,
  };
}

export function metricLabel(m: DiveMetric): string {
  if (m.agg === "count") return "count";
  const name = DIVE_AGGS.find((a) => a.value === m.agg)?.label ?? m.agg;
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
  constructor(private m: DiveMetric) {
    this.values = m.agg === "p50" || m.agg === "p90" || m.agg === "p99" ? [] : null;
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
    const x = toNumber(v);
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
      default: {
        const q = this.m.agg === "p50" ? 0.5 : this.m.agg === "p90" ? 0.9 : 0.99;
        return quantile(this.values!, q);
      }
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

function compileFilter(f: DiveFilter, columns: string[], profiles: DiveColumnProfile[]): ((row: Cell[]) => boolean) | null {
  const ci = columns.indexOf(f.column);
  if (ci < 0) return null;
  const kind = profiles.find((p) => p.name === f.column)?.kind ?? "category";
  const raw = f.value.trim();
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
  const eq = (v: Cell) => {
    if (raw === "∅") return v == null;
    if (kind === "number" && Number.isFinite(num)) return toNumber(v) === num;
    return String(v ?? "").toLowerCase() === lower;
  };
  switch (f.op) {
    case "=":
      return (r) => eq(r[ci]!);
    case "!=":
      return (r) => !eq(r[ci]!);
    case "contains":
      return (r) => String(r[ci] ?? "").toLowerCase().includes(lower);
    case "!contains":
      return (r) => !String(r[ci] ?? "").toLowerCase().includes(lower);
    case ">":
      return (r) => cmp(r[ci]!) > 0;
    case ">=":
      return (r) => cmp(r[ci]!) >= 0;
    case "<":
      return (r) => cmp(r[ci]!) < 0;
    case "<=":
      return (r) => cmp(r[ci]!) <= 0;
    case "is null":
      return (r) => isBlank(r[ci]);
    case "not null":
      return (r) => !isBlank(r[ci]);
  }
}

export interface DiveGroupRow {
  key: string;
  /** Group-by values in groupBy order. */
  values: string[];
  metrics: (number | null)[];
  compare: (number | null)[] | null;
}

export interface DiveSeries {
  key: string;
  label: string;
  /** Plotted metric per bucket (orderBy metric). */
  points: (number | null)[];
  compare: (number | null)[] | null;
}

export interface DiveResult {
  scanned: number;
  matched: number;
  compareMatched: number | null;
  /** [start, end] of the active window (epoch ms) when a time column is set. */
  window: [number, number] | null;
  compareWindow: [number, number] | null;
  metricLabels: string[];
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

  // Window anchored to the latest row (works for historical files and live streams alike).
  let window: [number, number] | null = null;
  let compareWindow: [number, number] | null = null;
  if (times) {
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const t of times) {
      if (!Number.isFinite(t)) continue;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    if (Number.isFinite(tMax)) {
      const rangeMs = DIVE_RANGES.find((r) => r.value === q.range)?.ms ?? Infinity;
      const start = Number.isFinite(rangeMs) ? tMax - rangeMs : tMin;
      window = [start, tMax];
      const off = compareOffset(q.compare, Math.max(1, tMax - start));
      if (off > 0) compareWindow = [start - off, tMax - off];
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

  const metricCols = q.metrics.map((m) => (m.column ? columns.indexOf(m.column) : -1));
  const gIdx = q.groupBy.map((g) => columns.indexOf(g));
  const keyOf = (r: Cell[]) => gIdx.map((gi) => cellString(r[gi])).join("\u0001");

  const aggregate = (idx: number[]) => {
    const groups = new Map<string, { values: string[]; accs: MetricAcc[] }>();
    const total = q.metrics.map((m) => new MetricAcc(m));
    for (const i of idx) {
      const r = rows[i]!;
      const k = keyOf(r);
      let g = groups.get(k);
      if (!g) {
        g = { values: gIdx.map((gi) => cellString(r[gi])), accs: q.metrics.map((m) => new MetricAcc(m)) };
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
  const ranked = [...cur.groups.entries()]
    .map(([key, g]) => ({ key, values: g.values, metrics: g.accs.map((a) => a.value()) }))
    .sort((a, b) => (b.metrics[ob] ?? -Infinity) - (a.metrics[ob] ?? -Infinity) || a.key.localeCompare(b.key));
  const limit = Math.max(1, q.limit);
  const groups: DiveGroupRow[] = ranked.slice(0, limit).map((g) => ({
    ...g,
    compare: prev ? (prev.groups.get(g.key)?.accs.map((a) => a.value()) ?? q.metrics.map(() => null)) : null,
  }));

  // Time series for the ranking metric, one line per top group.
  let bucketMs = 0;
  let buckets: number[] = [];
  let series: DiveSeries[] = [];
  if (window && times) {
    const span = Math.max(1, window[1] - window[0]);
    bucketMs = DIVE_BUCKETS.find((b) => b.value === q.bucket)?.ms || autoBucketMs(span);
    // Never more than 500 points, whatever bucket was picked.
    if (span / bucketMs > 500) bucketMs = autoBucketMs(span, 500);
    const first = Math.floor(window[0] / bucketMs) * bucketMs;
    const nB = Math.floor((window[1] - first) / bucketMs) + 1;
    buckets = Array.from({ length: nB }, (_, i) => first + i * bucketMs);
    const off = compareWindow ? window[0] - compareWindow[0] : 0;
    const top = q.groupBy.length ? groups.map((g) => g.key) : [""];
    const topSet = new Set(top);
    const m = q.metrics[ob]!;
    const mc = metricCols[ob]!;
    const grid = (idx: number[], shift: number) => {
      const accs = new Map<string, MetricAcc[]>();
      for (const k of top) accs.set(k, Array.from({ length: nB }, () => new MetricAcc(m)));
      for (const i of idx) {
        const r = rows[i]!;
        const k = q.groupBy.length ? keyOf(r) : "";
        if (!topSet.has(k)) continue;
        const b = Math.floor((times[i]! + shift - first) / bucketMs);
        if (b < 0 || b >= nB) continue;
        accs.get(k)![b]!.add(r, mc);
      }
      return accs;
    };
    const curGrid = grid(main, 0);
    const prevGrid = compareWindow ? grid(comp, off) : null;
    // Counts are 0 in empty buckets; other aggregates are gaps.
    const val = (a: MetricAcc) => (a.count === 0 && m.agg !== "count" ? null : a.value());
    series = top.map((k) => {
      const g = groups.find((x) => x.key === k);
      return {
        key: k,
        label: q.groupBy.length ? (g?.values.join(" · ") ?? k) : metricLabel(m),
        points: curGrid.get(k)!.map(val),
        compare: prevGrid ? prevGrid.get(k)!.map(val) : null,
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
    metricLabels: q.metrics.map(metricLabel),
    groups,
    groupCount: cur.groups.size,
    total: cur.total,
    totalCompare: prev ? prev.total : null,
    bucketMs,
    buckets,
    series,
    samples,
    matchedIndices: main,
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

function lit(v: string, kind: DiveColumnKind): string {
  if (kind === "number" && Number.isFinite(toNumber(v))) return String(toNumber(v));
  return `'${v.replace(/'/g, "''")}'`;
}

function sqlMetric(m: DiveMetric): string {
  const c = m.column ? ident(m.column) : "*";
  switch (m.agg) {
    case "count":
      return "count(*)";
    case "distinct":
      return `count(DISTINCT ${c})`;
    case "avg":
      return `avg(${c})`;
    case "p50":
      return `quantile_cont(${c}, 0.5)`;
    case "p90":
      return `quantile_cont(${c}, 0.9)`;
    case "p99":
      return `quantile_cont(${c}, 0.99)`;
    default:
      return `${m.agg}(${c})`;
  }
}

/** Equivalent DuckDB SQL for the current view (table / time series / samples). */
export function diveToSql(q: DiveQuery, table: string, profiles: DiveColumnProfile[], bucketMs = 0): string {
  const kindOf = (c: string) => profiles.find((p) => p.name === c)?.kind ?? "category";
  const where: string[] = [];
  if (q.timeColumn && q.range !== "all") {
    const ms = DIVE_RANGES.find((r) => r.value === q.range)!.ms;
    where.push(`${ident(q.timeColumn)} >= (SELECT max(${ident(q.timeColumn)}) FROM ${table}) - ${sqlInterval(ms)}`);
  }
  for (const f of q.filters) {
    const c = ident(f.column);
    const k = kindOf(f.column);
    switch (f.op) {
      case "contains":
        where.push(`${c}::VARCHAR ILIKE '%${f.value.replace(/'/g, "''")}%'`);
        break;
      case "!contains":
        where.push(`${c}::VARCHAR NOT ILIKE '%${f.value.replace(/'/g, "''")}%'`);
        break;
      case "is null":
        where.push(`${c} IS NULL`);
        break;
      case "not null":
        where.push(`${c} IS NOT NULL`);
        break;
      default:
        where.push(`${c} ${f.op === "!=" ? "<>" : f.op} ${lit(f.value, k)}`);
    }
  }
  const whereSql = where.length ? `\nWHERE ${where.join("\n  AND ")}` : "";
  if (q.view === "samples") {
    const order = q.timeColumn ? `\nORDER BY ${ident(q.timeColumn)} DESC` : "";
    return `SELECT *\nFROM ${table}${whereSql}${order}\nLIMIT 200`;
  }
  const metrics = q.metrics.map((m) => `${sqlMetric(m)} AS ${ident(metricLabel(m).replace(/[()]/g, "_").replace(/_$/, ""))}`);
  const groups = q.groupBy.map(ident);
  if (q.view === "timeseries" && q.timeColumn) {
    const bucket = `time_bucket(${sqlInterval(bucketMs || 3_600_000)}, ${ident(q.timeColumn)}::TIMESTAMP) AS bucket`;
    const sel = [bucket, ...groups, metrics[q.orderBy] ?? metrics[0]!].join(",\n  ");
    return `SELECT\n  ${sel}\nFROM ${table}${whereSql}\nGROUP BY ALL\nORDER BY bucket`;
  }
  const sel = [...groups, ...metrics].join(",\n  ");
  const groupSql = groups.length ? "\nGROUP BY ALL" : "";
  const orderSql = groups.length ? `\nORDER BY ${q.orderBy + groups.length + 1} DESC\nLIMIT ${q.limit}` : "";
  return `SELECT\n  ${sel}\nFROM ${table}${whereSql}${groupSql}${orderSql}`;
}

// ---------------------------------------------------------------------------
// Shareable links (#dive=…)
// ---------------------------------------------------------------------------

export interface DiveLink {
  /** Dataset path (e.g. stream://wiki, mock://sales.csv). */
  src: string;
  query: DiveQuery;
}

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
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
