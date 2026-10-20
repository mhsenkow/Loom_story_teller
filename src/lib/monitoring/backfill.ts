// =================================================================
// Loom — Monitor backfill ("what would this have looked like?")
// =================================================================
// Replays a monitor's metric over the feed rows already loaded, so the
// editor and cards can show the number with its rule drawn on top before
// a single scheduled check has run — and say how often it would have
// alerted. Pure; same engine as live checks.
// =================================================================

import type { QueryResult } from "../queryTypes";
import { computeMetric, runCheck, timeMs } from "./engine";
import type { CheckRecord, MetricSpec, Monitor } from "./types";

export interface BackfillPoint { at: number; value: number }

const MAX_POINTS = 72;

/** Metric value at evenly spaced moments across the rows' time span (oldest → newest). */
export function metricSeries(spec: MetricSpec, sample: QueryResult, points = MAX_POINTS): BackfillPoint[] {
  const ti = spec.timeColumn ? sample.columns.indexOf(spec.timeColumn) : -1;
  if (ti < 0) return [];
  const timed = sample.rows
    .map((r) => [timeMs(r[ti]), r] as const)
    .filter((x): x is readonly [number, (typeof sample.rows)[number]] => x[0] != null)
    .sort((a, b) => a[0] - b[0]);
  if (timed.length < 2) return [];
  const t0 = timed[0]![0];
  const t1 = timed[timed.length - 1]![0];
  if (t1 <= t0) return [];
  const n = Math.max(2, Math.min(points, timed.length));
  const step = (t1 - t0) / (n - 1);
  // With no lookback, each point summarises its own step so values stay comparable.
  const lookbackMinutes = spec.lookbackMinutes ?? Math.max(1, Math.round(step / 60_000));
  const windowSpec: MetricSpec = { ...spec, lookbackMinutes };
  const out: BackfillPoint[] = [];
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const at = i === n - 1 ? t1 : t0 + step * i;
    while (hi < timed.length && timed[hi]![0] <= at) hi++;
    const lo = at - lookbackMinutes * 60_000;
    // Only rows known at `at` (binary-ish scan is fine at ≤8k rows × 72 points).
    const rows = timed.slice(0, hi).filter(([t]) => t >= lo).map(([, r]) => r);
    if (!rows.length && spec.agg !== "count") continue;
    const m = computeMetric(windowSpec, { ...sample, rows, total_rows: rows.length }, at);
    if (m.value != null && Number.isFinite(m.value)) out.push({ at, value: m.value });
  }
  return out;
}

export interface Simulation {
  records: CheckRecord[];
  /** Distinct alerts the rule would have opened. */
  alerts: number;
  /** Checks that breached but were suppressed by expected windows. */
  suppressed: number;
  span: { from: number; to: number } | null;
}

/** Run the monitor's rule over a backfilled series, as if it had been checking all along. */
export function simulate(m: Pick<Monitor, "id" | "rule" | "confirmChecks" | "expected" | "notify" | "severity" | "metric">, series: BackfillPoint[]): Simulation {
  const records: CheckRecord[] = [];
  let open: ReturnType<typeof runCheck>["alert"];
  let alerts = 0;
  let suppressed = 0;
  const mon = { ...m, name: "", decision: "", schedule: { kind: "interval", minutes: 60 }, enabled: true, createdAt: 0 } as Monitor;
  for (const p of series) {
    const out = runCheck(mon, { value: p.value, rowsSeen: 1, newestAt: p.at }, records, open, p.at, () => `sim${alerts}`);
    if (out.alert && !open) alerts++;
    open = out.alert && !out.alert.closedAt ? out.alert : undefined;
    if (out.record.status === "expected" && /expected:/.test(out.record.reason)) suppressed++;
    records.push(out.record);
  }
  return { records, alerts, suppressed, span: series.length ? { from: series[0]!.at, to: series[series.length - 1]!.at } : null };
}

/** "2 days", "5 hours" — for "would have alerted N times in the last …". */
export function spanLabel(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1.5) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${Math.round(h)} hours`;
  return `${Math.round(h / 24)} days`;
}
