/** Plain-language facts computed only from exact values registered by the current paint. */
import type { ChartRecommendation } from "./recommendations";
import type { HitTarget } from "./chartTooltip";

export type ChartReadingFact = { title: string; label: string; value: string; hit: HitTarget };
export type ChartReading = { headline: string; context: string; guide: string; facts: ChartReadingFact[] };
type Observation = { hit: HitTarget; data: NonNullable<HitTarget["reading"]> };
const number = (value: number) => value.toLocaleString(undefined, Math.abs(value) > 0 && Math.abs(value) < 0.01
  ? { maximumSignificantDigits: 5 } : { maximumFractionDigits: 2 });
const fact = (title: string, point: Observation): ChartReadingFact => ({ title, label: point.data.label, value: number(point.data.value), hit: point.hit });
const extrema = (points: Observation[]) => {
  let high = points[0], low = points[0];
  let tied = 1;
  for (const p of points.slice(1)) {
    if (p.data.value > high.data.value) { high = p; tied = 1; }
    else if (p.data.value === high.data.value) tied++;
    if (p.data.value < low.data.value) low = p;
  }
  return { high, low, tied };
};

export function buildChartReading(chart: ChartRecommendation | null, targets: HitTarget[] | undefined): ChartReading | null {
  if (!chart || chart.rowField || chart.comparePrevious || chart.y2Field) return null;
  const supported = ["bar", "line", "area", "pie", "histogram"];
  if (!supported.includes(chart.kind)) return null;
  const points: Observation[] = [];
  for (const hit of targets ?? []) {
    if (!hit.auxiliary && hit.reading && Number.isFinite(hit.reading.value)) points.push({ hit, data: hit.reading });
  }
  if (!points.length || points.some(p => p.data.measure !== points[0].data.measure)) return null;
  const measure = points[0].data.measure;
  if (chart.kind === "line" || chart.kind === "area") {
    const groups = new Map<string, Observation[]>();
    for (const p of points) {
      if (!Number.isFinite(p.data.order)) return null;
      const key = p.data.series ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    for (const group of groups.values()) group.sort((a, b) => a.data.order! - b.data.order!);
    const context = `${measure} · ${points.length.toLocaleString()} plotted values. Based on the visible chart, after filters and transformations.`;
    const guide = `Read ${chart.xField} from left to right. Higher positions mean larger values. A change between the first and last points does not describe every change in between.`;
    if (groups.size > 1) {
      const ends = [...groups.values()].map(group => group.at(-1)!);
      const aligned = ends.every(p => p.data.order === ends[0].data.order && p.data.label === ends[0].data.label);
      const { high, tied } = extrema(ends);
      return {
        headline: aligned
          ? tied === 1 ? `${high.data.series} finishes highest at ${number(high.data.value)} (${high.data.label}).` : `${tied} series share the highest final value: ${number(high.data.value)} (${high.data.label}).`
          : `${groups.size} series are shown, with different ending ${chart.xField} values.`,
        context, guide,
        facts: (aligned ? [...ends].sort((a, b) => b.data.value - a.data.value) : ends).slice(0, 3).map(p => ({ ...fact(p.data.series || "Series", p), label: `Last shown: ${p.data.label}` })),
      };
    }
    const ordered = [...groups.values()][0];
    const first = ordered[0], last = ordered.at(-1)!;
    const { high } = extrema(ordered);
    const delta = last.data.value - first.data.value;
    const direction = delta > 0 ? "rose" : "fell";
    const percent = chart.seriesNormalize !== "zscore" && first.data.value > 0 && last.data.value >= 0 && delta !== 0 && Number.isFinite(delta / first.data.value * 100)
      ? ` (${number(Math.abs(delta / first.data.value * 100))}% ${delta > 0 ? "higher" : "lower"})` : "";
    const headline = ordered.length === 1 ? `One plotted value: ${number(first.data.value)} at ${first.data.label}.`
      : delta === 0 ? `${measure} starts and ends at ${number(first.data.value)}.`
      : `${measure} ${direction} from ${number(first.data.value)} to ${number(last.data.value)}${percent}.`;
    return { headline, context, guide, facts: ordered.length === 1 ? [fact("Shown value", first)] : [fact("First shown", first), fact("Last shown", last), fact("Highest point", high)] };
  }
  const { high, low, tied } = extrema(points);
  const noun = chart.kind === "pie" ? "slices" : chart.kind === "histogram" ? "occupied ranges" : "categories";
  let headline = tied === points.length && points.length > 1 ? `All ${points.length} ${noun} have the same value: ${number(high.data.value)}.`
    : tied > 1 ? `${tied} ${noun} share the highest value: ${number(high.data.value)}.`
    : `${high.data.label} is highest at ${number(high.data.value)}.`;
  let guide = "Compare the ends of the bars. The values describe the categories shown, which may be a subset of your data.";
  if (chart.kind === "pie") {
    const total = points.reduce((sum, p) => sum + p.data.value, 0);
    if (total > 0 && Number.isFinite(total) && tied === 1) headline = `${high.data.label} is the largest slice: ${number(high.data.value / total * 100)}% of the displayed total.`;
    guide = "Each slice is part of the displayed total. Other combines smaller categories. Only positive slice values are included.";
  } else if (chart.kind === "histogram") {
    headline = tied === 1 ? `${high.data.label} is the busiest range, with ${number(high.data.value)} observations.` : `${tied} ranges tie for the most observations: ${number(high.data.value)} each.`;
    guide = "Each bar counts observations in a range. Taller bars mean more observations, not larger individual values.";
  }
  return {
    headline,
    context: `${measure} · ${points.length.toLocaleString()} ${noun} shown. Based on the visible chart, after filters and aggregation.`,
    guide,
    facts: [fact(tied > 1 ? "Joint highest" : chart.kind === "histogram" ? "Busiest range" : "Highest", high), ...(low !== high ? [fact("Lowest", low)] : [])],
  };
}
