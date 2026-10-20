// =================================================================
// Loom — Monitor suggestions for the data you're looking at
// =================================================================
// From the open feed's own columns and values: the main measures with a
// limit near the top of what they've shown, a row-count "unusual" watch
// for event feeds, and a "feed went quiet" check when rows are timestamped.
// Decisions are left blank on purpose — only the person knows them.
// =================================================================

import type { QueryResult } from "../queryTypes";
import { SOURCE_BY_KIND, type SourceKind } from "../sourceRegistry";
import { computeMetric } from "./engine";
import type { MonitorDraft } from "./templates";

const SKIP = /^(id|.*_id|lat|lon|lng|latitude|longitude|rank|yr|year|height)$/i;
const NUMERIC = new Set(["DOUBLE", "INTEGER", "BIGINT"]);
const TIME = new Set(["TIMESTAMP", "DATE"]);

export interface MonitorSuggestion { id: string; title: string; blurb: string; draft: MonitorDraft }

function p(vals: number[], q: number): number {
  const s = [...vals].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.round((s.length - 1) * q))]!.toPrecision(3));
}

export function suggestMonitorsForFeed(kind: SourceKind, sample: QueryResult, max = 4): MonitorSuggestion[] {
  const def = SOURCE_BY_KIND[kind];
  const timeColumn = def.columns.find((_, i) => TIME.has(def.types[i]!));
  const eventLike = def.grain === "event";
  const base = {
    decision: "",
    confirmChecks: 1,
    severity: "warning" as const,
    schedule: { kind: "interval" as const, minutes: Math.max(15, Math.round((def.pollMs || 3_600_000) / 60_000)) },
    notify: { inApp: true, system: true, cooldownMinutes: 120 },
    expected: [],
    enabled: true,
  };
  const out: MonitorSuggestion[] = [];
  const lookbackMinutes = timeColumn ? (eventLike ? 60 : def.grain === "reading" ? 60 : undefined) : undefined;

  const measures = def.columns
    .map((c, i) => ({ c, t: def.types[i]! }))
    .filter(({ c, t }) => NUMERIC.has(t) && !SKIP.test(c))
    // Prefer columns with units (real measurements) and spread.
    .map(({ c }) => {
      const ci = sample.columns.indexOf(c);
      const vals = sample.rows.map((r) => Number(r[ci])).filter(Number.isFinite);
      const spread = vals.length ? p(vals, 0.95) - p(vals, 0.05) : 0;
      return { c, vals, score: (def.units?.[c] ? 2 : 0) + (spread > 0 ? 1 : 0) + Math.min(1, vals.length / 50) };
    })
    .filter((m) => m.vals.length >= 3)
    .sort((a, b) => b.score - a.score);

  for (const m of measures.slice(0, 2)) {
    const agg = eventLike ? "max" : "latest";
    const above = p(m.vals, 0.98);
    const unit = def.units?.[m.c];
    out.push({
      id: `${kind}-${m.c}-limit`,
      title: `${eventLike ? "Highest" : "Latest"} ${m.c.replace(/_/g, " ")} too high`,
      blurb: `Alert above ${above}${unit ? ` ${unit}` : ""}, near the top 2% of what ${def.label} has shown.`,
      draft: { ...base, name: `${def.label}: ${m.c.replace(/_/g, " ")} above ${above}`, metric: { source: kind, agg, column: m.c, timeColumn, lookbackMinutes, unit }, rule: { kind: "threshold", above } },
    });
  }
  if (timeColumn && eventLike) {
    const now = computeMetric({ source: kind, agg: "count", timeColumn, lookbackMinutes: 60 }, sample, Date.now()).value;
    out.push({
      id: `${kind}-count-anomaly`,
      title: "Unusual number of new rows",
      blurb: `Rows per hour far from normal for this hour of day${now != null ? ` (now ${now})` : ""}.`,
      draft: { ...base, name: `${def.label}: unusual activity`, metric: { source: kind, agg: "count", timeColumn, lookbackMinutes: 60 }, rule: { kind: "anomaly", sensitivity: 3.5, window: 30, seasonal: "hour" }, confirmChecks: 2 },
    });
  }
  if (measures[0] && !eventLike && timeColumn) {
    const m = measures[0];
    out.push({
      id: `${kind}-${m.c}-anomaly`,
      title: `${m.c.replace(/_/g, " ")} unusual for now`,
      blurb: "Compared with the same hour on earlier checks, so daily cycles don't alert.",
      draft: { ...base, name: `${def.label}: ${m.c.replace(/_/g, " ")} unusual`, metric: { source: kind, agg: "latest", column: m.c, timeColumn, unit: def.units?.[m.c] }, rule: { kind: "anomaly", sensitivity: 3.5, window: 30, seasonal: "hour" }, confirmChecks: 2 },
    });
  }
  if (timeColumn && def.pollMs > 0) {
    const mins = Math.max(60, Math.round((def.pollMs * 6) / 60_000));
    out.push({
      id: `${kind}-stale`,
      title: "Feed went quiet",
      blurb: `No new rows for ${mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} min`}: is the source down?`,
      draft: { ...base, name: `${def.label} stopped updating`, metric: { source: kind, agg: "count", timeColumn }, rule: { kind: "stale", maxAgeMinutes: mins }, confirmChecks: 2 },
    });
  }
  return out.slice(0, max);
}
