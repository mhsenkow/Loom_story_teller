// =================================================================
// Loom — Monitor ⇄ chart
// =================================================================
// "Monitor this chart" turns the active chart's encoding into a monitor
// draft: same feed, same measure and aggregate, a lookback matching the
// chart's rolling window / time window, and — when anomaly rings are on —
// the same "unusual" rule (|z| > 2.5). The chart link is kept on the
// monitor so cards and alerts can reopen exactly that chart.
// =================================================================

import type { ChartRecommendation } from "../recs/types";
import type { ChartLink } from "../chartLink";
import { encodeChartLink } from "../chartLink";
import { SOURCE_BY_KIND, sourceKindFromPath, type SourceKind } from "../sourceRegistry";
import type { MonitorDraft } from "./templates";
import type { MonitorAgg } from "./types";

const TIME_WINDOW_MIN: Record<string, number> = { "1h": 60, "6h": 360, "24h": 1440, "7d": 10_080, "30d": 43_200, "90d": 129_600, "1y": 525_600 };
const DAILY_GRAINS = new Set(["day", "month", "year", "snapshot"]);

function aggFor(rec: ChartRecommendation): MonitorAgg {
  if (!rec.yField) return "count";
  switch (rec.yAggregate) {
    case "sum": return "sum";
    case "count": return "count";
    case "min": return "min";
    case "max": return "max";
    case "mean": return "avg";
    default: return "avg";
  }
}

export type ChartMonitorResult = { draft: MonitorDraft } | { error: string };

export function monitorDraftFromChart(rec: ChartRecommendation | null, filePath: string | null | undefined, link: ChartLink | null, title?: string): ChartMonitorResult {
  if (!rec) return { error: "Open a chart first" };
  const kind: SourceKind | null = sourceKindFromPath(filePath);
  if (!kind) return { error: "Monitors watch live feeds. Open a feed from Data & sources to monitor its charts." };
  const def = SOURCE_BY_KIND[kind];
  const typeOf = (c?: string | null) => (c ? def.types[def.columns.indexOf(c)] : undefined);
  const isTime = (c?: string | null) => typeOf(c) === "TIMESTAMP" || typeOf(c) === "DATE";
  const timeColumn = [rec.timeWindowField, rec.timeField, rec.xField].find((c) => isTime(c)) ?? def.columns.find((c) => isTime(c)) ?? undefined;

  // Time on x → the plotted y is the measure. Otherwise (maps, scatters, bars) y is often a
  // coordinate or category: prefer the chart's numeric size / color, else count rows.
  const numeric = (c?: string | null) => !!c && ["DOUBLE", "INTEGER", "BIGINT"].includes(typeOf(c) ?? "") && !/^(lat|lon|lng|latitude|longitude)$/i.test(c);
  let agg = aggFor(rec);
  let column: string | undefined = agg === "count" ? undefined : rec.yField ?? undefined;
  if (!isTime(rec.xField) && !numeric(column)) {
    const measure = [rec.sizeField, rec.colorField].find((c) => numeric(c)) ?? undefined;
    column = measure;
    agg = measure ? "max" : "count";
  }
  if (column && !def.columns.includes(column)) return { error: `“${column}” is a derived field; monitors need a column straight from the feed` };

  // Rolling N on a daily feed ≈ the last N days; otherwise honour the chart's time window.
  let lookbackMinutes: number | undefined;
  if (rec.rollingWindow && DAILY_GRAINS.has(def.grain)) lookbackMinutes = rec.rollingWindow * 1440;
  else if (rec.timeWindow && rec.timeWindow !== "all") lookbackMinutes = TIME_WINDOW_MIN[rec.timeWindow];
  else if (timeColumn) lookbackMinutes = DAILY_GRAINS.has(def.grain) ? 1440 * 2 : 60;

  const name = (title || rec.title || `${def.label} ${column ?? "rows"}`).slice(0, 80);
  const rolling = rec.rollingWindow ? `${rec.rollingWindow}-point rolling ` : "";
  return {
    draft: {
      name,
      decision: "",
      rationale: `From the chart “${name}”: ${rolling}${agg === "avg" ? "average" : agg} of ${column ?? "rows"}${lookbackMinutes ? ` over the last ${lookbackMinutes >= 1440 ? `${Math.round(lookbackMinutes / 1440)} days` : `${lookbackMinutes} min`}` : ""}.`,
      metric: { source: kind, agg, column, timeColumn, lookbackMinutes, unit: column ? def.units?.[column] : undefined },
      rule: rec.anomalyHighlight
        ? { kind: "anomaly", sensitivity: 2.5, window: 30, seasonal: "none" }
        : { kind: "anomaly", sensitivity: 3.5, window: 30, seasonal: DAILY_GRAINS.has(def.grain) ? "none" : "hour" },
      confirmChecks: 1,
      severity: "warning",
      schedule: { kind: "interval", minutes: Math.max(15, Math.round((def.pollMs || 3_600_000) / 60_000)) },
      notify: { inApp: true, system: true, cooldownMinutes: 120 },
      expected: [],
      chart: link ? { link: encodeChartLink(link), title: name } : undefined,
      enabled: true,
    },
  };
}
