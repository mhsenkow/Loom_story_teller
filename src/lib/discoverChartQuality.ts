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

/** Shares and stacked totals require quantities that can sensibly be added. */
export function isAdditiveDiscoverMeasure(kind: string, field: string): boolean {
  if (isRateLikeField(field)) return false;
  const unit = SOURCE_BY_KIND[kind as SourceKind]?.units?.[field];
  return unit ? /^(count|people|players|views|reviews|owners|USD|BTC|MW|km²|transactions|stations)$/.test(unit)
    : /(count|total|volume|population|amount|sales|views|comments|points|players|bytes|revenue)/i.test(field);
}

export function qualifyDiscoverChart(
  kind: SourceKind | "wiki",
  chart: ChartRecommendation,
): ChartRecommendation | null {
  if (chart.emojiMap && (chart.emojiMap.field !== chart.emojiField || !parseChartEmojiMap(chart.emojiMap))) return null;
  if (kind === "wiki") return chart;
  if ((chart.kind === "globeTrail" || chart.kind === "arcMap") && chart.trailId && chart.colorField !== chart.trailId)
    chart = { ...chart, colorField: chart.trailId };
  const sumsGroups = PART_TO_WHOLE_KINDS.has(chart.kind)
    || ((chart.kind === "area" || chart.kind === "stream") && !!chart.colorField)
    || chart.barStackMode === "percent" || chart.barStackMode === "stacked";
  if (sumsGroups && chart.yField && chart.yAggregate !== "count" && !isAdditiveDiscoverMeasure(kind, chart.yField)) return null;
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
  const units = SOURCE_BY_KIND[kind].units;
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
