// =================================================================
// Discover quality checks — prevent unlike units sharing a comparison
// axis or a delta. Independent mirror profiles remain useful, with an
// explicit explanation of their separate units and scales.
// =================================================================

import type { ChartRecommendation } from "./recommendations";
import { SOURCE_BY_KIND, type SourceKind } from "./sourceRegistry";
import { PART_TO_WHOLE_KINDS } from "./recs/createChartRec";
import { isRateLikeField } from "./recs/columns";
import { parseChartEmojiMap } from "./chartEmoji";
import { fieldLooksMonthGrain } from "./chartTime";

/** Shares and stacked totals require quantities that can sensibly be added. */
export function isAdditiveDiscoverMeasure(kind: string, field: string): boolean {
  if (isRateLikeField(field)) return false;
  // A median / average / per-person / price is a typical value, not a quantity: summing
  // states' median incomes into a treemap or pie means nothing, even though the unit is USD.
  if (/(^|_)(median|mean|avg|average|per|price|index|age)($|_)/i.test(field)) return false;
  // Rolling / to-date totals overlap from row to row — summing them counts each month 12 times.
  if (/(^|_)(ttm|rolling|cumulative|ytd|fytd)($|_)/i.test(field)) return false;
  const unit = SOURCE_BY_KIND[kind as SourceKind]?.units?.[field];
  return unit ? /^(count|people|players|views|reviews|owners|USD|USD (billions|millions|thousands)|BTC|MW|km²|transactions|stations)$/.test(unit)
    : /(count|total|volume|population|amount|sales|views|comments|points|players|bytes|revenue)/i.test(field);
}

/** Kinds whose X and Y (and Z) are both measures — a derived pair there is circular. */
const XY_MEASURE_KINDS = new Set<string>(["scatter", "bubble", "hexbin", "contour", "voronoi", "isoScatter", "scatter3d", "connectedScatter", "firefly"]);

/** Kinds that count rows per category when no measure is set (or the aggregate is count). */
const COUNTS_ROWS_KINDS = new Set<string>([
  "bar", "lollipop", "pie", "funnel", "waffle", "isotype", "isoBars", "treemap", "sunburst",
  "radialBar", "forceBubble", "wordCloud", "pareto", "rose",
]);

export function qualifyDiscoverChart(
  kind: string,
  chart: ChartRecommendation,
): ChartRecommendation | null {
  if (chart.emojiMap && (chart.emojiMap.field !== chart.emojiField || !parseChartEmojiMap(chart.emojiMap))) return null;
  if (kind === "wiki") return chart;
  // A column against the column it's computed from (real vs nominal income) only shows the formula.
  const derived = SOURCE_BY_KIND[kind as SourceKind]?.derivedFrom;
  if (derived && XY_MEASURE_KINDS.has(chart.kind)) {
    const pair = [chart.xField, chart.yField, chart.zField ?? null];
    for (const [col, sources] of Object.entries(derived)) {
      if (pair.includes(col) && (typeof sources === "string" ? [sources] : sources).some((src) => pair.includes(src))) return null;
    }
  }
  // On a monthly / yearly series or panel (one row per period, per entity), counting rows per
  // group only measures coverage: "South leads with 3825" is 17 states × 225 months, not a finding.
  // (Day-grain feeds can be draws or filings — Powerball's number counts are the point.)
  const grain = SOURCE_BY_KIND[kind as SourceKind]?.grain;
  if ((grain === "month" || grain === "year") && COUNTS_ROWS_KINDS.has(chart.kind)
    && (chart.yAggregate === "count" || !chart.yField)) return null;
  if ((chart.kind === "globeTrail" || chart.kind === "arcMap") && chart.trailId && chart.colorField !== chart.trailId)
    chart = { ...chart, colorField: chart.trailId };
  const sumsGroups = PART_TO_WHOLE_KINDS.has(chart.kind)
    || ((chart.kind === "area" || chart.kind === "stream") && !!chart.colorField)
    || chart.barStackMode === "percent" || chart.barStackMode === "stacked";
  // A rolling 12-month total may be summed across lines within one month (the newest), never across months.
  const onePeriod = !!chart.timeWindowField && fieldLooksMonthGrain(chart.timeWindowField) && (chart.timeWindow === "30d" || chart.timeWindow === "7d");
  const rollingOk = onePeriod && !!chart.yField && /(^|_)ttm($|_)/i.test(chart.yField);
  if (sumsGroups && chart.yField && chart.yAggregate !== "count" && !rollingOk && !isAdditiveDiscoverMeasure(kind, chart.yField)) return null;
  const dual = ["pyramid", "dumbbell", "slope"].includes(chart.kind);
  const other = dual ? chart.sizeField : chart.y2Field;
  if (dual && (!chart.yField || !other)) return null;
  if (!chart.yField || !other) return chart;
  if (other === chart.yField) return null;
  const nonMeasure =
    /^(latitude|longitude|lat|lon|lng|id|rank|ts|time|timestamp|year|yr|month|epoch)$|(^|_)(id|code|key|rank)($|_)/i;
  if (
    nonMeasure.test(chart.yField) ||
    nonMeasure.test(other) ||
    (kind === "bitcoin" && [chart.yField, other].includes("height"))
  )
    return null;
  const units = SOURCE_BY_KIND[kind as SourceKind]?.units;
  const left = units?.[chart.yField];
  const right = units?.[other];
  if (!dual && chart.seriesNormalize) return chart;
  if (!left || !right) return null;
  if (left === right) return chart;
  if (chart.kind !== "pyramid") return null;
  return {
    ...chart,
    pyramidScaleMode: "independent",
    deltaDisplay: "off",
    title: `${chart.yField} ↔ ${other} by ${chart.xField}`,
    subtitle: `Separate scales · ${left} / ${right}. Compare profiles; bar lengths use different units.`,
  };
}
