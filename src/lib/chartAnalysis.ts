// Chart-aware statistical units. Pure, deterministic, and shared by evidence and paint.
import { chartDefinition } from "./chartDefinitions";
import type { ChartRecommendation, YAggregateOption } from "./recommendations";
import { chartNumber } from "./chartNumbers";
import { computeBarModel } from "./canvasCharts/bar";
import { aggregateValues } from "./canvasCharts/plumbing";
import { timeBuckets } from "./canvasCharts/axisHelpers";
import { buildBarFacetGrid } from "./chartTooltip";
import { buildXModel } from "./chartAxes";
import { groupChartChannels } from "./channelGroups";
import { partitionRowsByFacet } from "./chartFacets";
import { buildDataCube, binRows, CUBE_MAX_BINS } from "./dataCube";
import { calendarStepMonths, detectSeriesAnomalies, forecastCalendar, type ForecastMethod } from "./timeSeriesAnalysis";
import { rollingMean, normalizeSeriesValues } from "./dsTransforms";

export type ChartAnomalyMethod = "mad" | "iqr" | "z-score" | "trailing";
export interface ChartAnomalyConfig {
  scope: string;
  enabled: boolean;
  method: ChartAnomalyMethod;
  threshold: number;
  window: number;
  /** An explicit field selects source-row analysis, overriding chart units. */
  field?: string;
}
export interface ChartObservation {
  label: string;
  values: number[];
  rows: number[];
  cohort: string;
  order?: number;
  cell?: string;
  markKey?: string;
}
export interface ChartAnalysisData {
  observations: ChartObservation[];
  fields: string[];
  description: string;
  overlay: "marks" | "cube" | "none";
  reason: string | null;
}
export interface ChartAnomalyReport extends ChartAnalysisData {
  flagged: (ChartObservation & { score: number; dimension: string })[];
  rowIndices: number[];
  cells: Set<string>;
}

export function chartAnalysisScope(chart: ChartRecommendation): string {
  // Recipe changes re-evaluate the analysis; identity changes require an explicit new run.
  return JSON.stringify([chart.id, chart.kind]);
}
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Scores are descriptive flags, not probabilities. Flat samples use relative numerical tolerance. */
export function outlierScores(values: number[], method: Exclude<ChartAnomalyMethod, "trailing">): number[] {
  if (values.length < 4 || !values.every(Number.isFinite)) return values.map(() => 0);
  const center = method === "z-score" ? values.reduce((a, b) => a + b / values.length, 0) : median(values);
  let scale: number, lo = center, hi = center;
  if (method === "iqr") {
    const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    lo = median(sorted.slice(0, mid)); hi = median(sorted.slice(Math.ceil(sorted.length / 2)));
    scale = hi - lo;
  } else if (method === "mad") scale = median(values.map(v => Math.abs(v - center))) / 0.67448975;
  else scale = Math.sqrt(values.reduce((sum, v) => sum + (v - center) ** 2 / (values.length - 1), 0));
  const tolerance = values.reduce((max, v) => Math.max(max, Math.abs(v)), 1) * Number.EPSILON * 32;
  return values.map(value => {
    const distance = method === "iqr" ? Math.max(lo - value, value - hi, 0) : Math.abs(value - center);
    return scale > tolerance ? distance / scale : distance > tolerance ? Infinity : 0;
  });
}

export function chartAnalysisData(chart: ChartRecommendation, source: unknown[][], columns: string[], field?: string): ChartAnalysisData {
  const policy = chartDefinition(chart.kind).analysis;
  const base: ChartAnalysisData = { observations: [], fields: [], description: "", overlay: policy.overlay, reason: null };
  const grouped = groupChartChannels(source, columns, chart);
  const rows = grouped.rows, cols = grouped.columns;
  const xi = cols.indexOf(chart.xField), yi = cols.indexOf(chart.yField ?? "");
  const ci = cols.indexOf(grouped.colorField ?? chart.emojiField ?? grouped.shapeField ?? "");
  const fi = cols.indexOf(chart.rowField ?? "");
  const agg = yi < 0 ? "count" : chart.yAggregate ?? chartDefinition(chart.kind).defaultAggregate;
  const indices = new Map(rows.map((r, i) => [r, i]));
  const panels = fi < 0 ? [{ key: "", rows }] : partitionRowsByFacet(rows, fi);
  if (field || policy.basis === "rows") {
    const name = field ?? [chart.yField, chart.sizeField, chart.xField, ...columns].find(name => name && source.some(r => Number.isFinite(chartNumber(r[columns.indexOf(name)]))));
    const idx = columns.indexOf(name ?? "");
    base.fields = name ? [name] : [];
    base.description = `Underlying rows · ${name ?? "choose a numeric measure"}. Derived bins, ranks and layout positions are not observations.`;
    base.overlay = "none";
    base.observations = source.flatMap((r, i) => { const value = chartNumber(r[idx]); return Number.isFinite(value) ? [{ label: `Row ${i + 1}`, values: [value], rows: [i], cohort: "" }] : []; });
    if (!name && xi >= 0 && !field) {
      const counts = new Map<string, number[]>();
      source.forEach((r, i) => { if (r[xi] == null || r[xi] === "") return; const key = String(r[xi]); if (!counts.has(key)) counts.set(key, []); counts.get(key)!.push(i); });
      base.fields = ["Row count"];
      base.description = `Source category frequencies · ${chart.xField}. Counts are not layout positions or derived chart bins.`;
      base.observations = [...counts].map(([label, ids]) => ({ label, values: [ids.length], rows: ids, cohort: "" }));
    }
  } else if (policy.basis === "coordinates") {
    const fields = [chart.xField, chart.yField, ...(chart.kind === "scatter3d" && chart.zField ? [chart.zField] : [])].filter((x): x is string => !!x);
    base.fields = [...new Set(fields)];
    base.description = `Coordinate outliers · ${base.fields.join(" × ")}. Each axis is scored separately; the largest score flags the point. Correlated or local-density anomalies need a different model.`;
    base.observations = source.flatMap((r, i) => {
      const values = base.fields.map(f => chartNumber(r[columns.indexOf(f)]));
      return values.length && values.every(Number.isFinite) ? [{ label: `Row ${i + 1}`, values, rows: [i], cohort: fi >= 0 ? String(r[fi]) : "" }] : [];
    });
  } else if (policy.basis === "cells") {
    const enc = { xField: chart.xField, yField: chart.yField, zField: chart.zField, valueField: chart.sizeField, aggregate: chart.yAggregate };
    const cube = buildDataCube(source, columns, enc), bins = binRows(source, columns, enc, CUBE_MAX_BINS);
    base.fields = [cube?.valueLabel ?? "Cell value"];
    base.description = "Voxel aggregates · comparing all non-empty cells, across all depth slices.";
    if (cube && bins) {
      const members = new Map<string, number[]>();
      source.forEach((_, i) => { const key = `${bins.bx[i]}:${bins.by[i]}:${bins.bz[i]}`; if (!members.has(key)) members.set(key, []); members.get(key)!.push(i); });
      base.observations = cube.cells.map(c => ({ label: `${cube.x.labels[c.xi]} · ${cube.y.labels[c.yi]} · ${cube.z.labels[c.zi]}`, values: [c.value], rows: members.get(`${c.xi}:${c.yi}:${c.zi}`) ?? [], cohort: "", cell: `${c.xi}:${c.yi}:${c.zi}` }));
    }
  } else {
    base.fields = [`${agg}(${chart.yField ?? "rows"})`];
    base.description = policy.basis === "bars" ? "Displayed bar aggregates · each color series and facet is compared separately; Top N and percent stacking are respected." : "Series values · each color series and facet is compared separately, after aggregation, rolling and normalization. Comparison overlays are excluded.";
    for (const panel of panels) {
      const memberMap = new Map<string, number[]>();
      const bucket = policy.basis === "series" ? timeBuckets(panel.rows, xi) : null;
      const keyOf = (r: unknown[]) => bucket ? bucket.keyOf(r) : String(r[xi]);
      panel.rows.forEach(r => { const key = JSON.stringify([keyOf(r), ci >= 0 ? String(r[ci]) : ""]); if (!memberMap.has(key)) memberMap.set(key, []); memberMap.get(key)!.push(indices.get(r)!); });
      const add = (label: string, value: number, series = "", order?: number) => base.observations.push({ label: [panel.key, series, label].filter(Boolean).join(" · "), values: [value], rows: memberMap.get(JSON.stringify([label, series])) ?? [], cohort: JSON.stringify([panel.key, series]), markKey: JSON.stringify([panel.key, series, label]), order });
      if (policy.basis === "bars") {
        const facet = ci >= 0 && ci !== xi ? buildBarFacetGrid(panel.rows, xi, yi, ci, agg, chart.barStackMode ?? "grouped", chart.topN) : null;
        if (facet) facet.xLabels.forEach((label, x) => {
          const total = facet.grid[x].reduce((a, b) => a + Math.abs(b), 0) || 1;
          facet.subLabels.forEach((series, s) => { if (memberMap.has(JSON.stringify([label, series]))) add(label, chart.barStackMode === "percent" ? facet.grid[x][s] / total * 100 : facet.grid[x][s], series); });
        });
        else {
          // Color on the same field is category color, not a second series.
          for (const [label, value] of computeBarModel(panel.rows, xi, yi, agg, chart.topN ?? undefined).entries) {
            const members = panel.rows.filter(r => String(r[xi]) === label).map(r => indices.get(r)!);
            base.observations.push({ label: [panel.key, label].filter(Boolean).join(" · "), values: [value], rows: members, cohort: panel.key });
          }
        }
      } else {
        const model = buildXModel([...new Set(panel.rows.map(keyOf))]);
        const counts = new Map<string, number>();
        panel.rows.forEach(r => { const s = ci >= 0 ? String(r[ci]) : ""; counts.set(s, (counts.get(s) ?? 0) + 1); });
        const series = [...counts].sort((a, b) => b[1] - a[1]).slice(0, chart.kind === "area" ? 8 : 10).map(([s]) => s);
        for (const s of series) {
          const points = model.keys.flatMap((key, i) => {
            const ids = memberMap.get(JSON.stringify([key, s]));
            const values = (ids ?? []).map(id => agg === "count" ? 1 : chartNumber(rows[id][yi])).filter(Number.isFinite);
            return values.length || chart.kind === "area" ? [{ key, value: values.length ? aggregateValues(values, agg) : 0, order: model.kind === "band" ? undefined : model.pos[i] }] : [];
          });
          let values = points.map(p => p.value);
          if (chart.rollingWindow) values = rollingMean(values, chart.rollingWindow);
          if (chart.seriesNormalize) values = normalizeSeriesValues(values, chart.seriesNormalize);
          points.forEach((p, i) => add(p.key, values[i], s, p.order));
        }
      }
    }
  }
  if (!base.observations.length) base.reason = "No finite observations for these fields. Choose a numeric measure or change the filters.";
  return base;
}

export function analyzeChart(chart: ChartRecommendation, rows: unknown[][], columns: string[], config: ChartAnomalyConfig): ChartAnomalyReport {
  const data = chartAnalysisData(chart, rows, columns, config.field);
  const report: ChartAnomalyReport = { ...data, flagged: [], rowIndices: [], cells: new Set() };
  if (!config.enabled || config.scope !== chartAnalysisScope(chart)) return report;
  if (!Number.isFinite(config.threshold) || config.threshold < 1 || config.threshold > 6) return { ...report, reason: "Sensitivity must be between 1 and 6." };
  const cohorts = new Map<string, ChartObservation[]>();
  for (const p of data.observations) { if (!cohorts.has(p.cohort)) cohorts.set(p.cohort, []); cohorts.get(p.cohort)!.push(p); }
  let eligible = 0;
  for (const points of cohorts.values()) {
    if (config.method === "trailing") {
      if (!Number.isInteger(config.window) || config.window < 5 || config.window > 50 || points.length <= config.window || points.some(p => p.order == null)) continue;
      eligible++;
      const ordered = [...points].sort((a, b) => a.order! - b.order!);
      for (const flag of detectSeriesAnomalies(ordered.map((p, i) => ({ x: i, y: p.values[0] })), config.window, config.threshold)) report.flagged.push({ ...ordered[flag.x], score: flag.score, dimension: data.fields[0] });
    } else {
      if (points.length < 4) continue;
      eligible++;
      const scores = data.fields.map((_, d) => outlierScores(points.map(p => p.values[d]), config.method as Exclude<ChartAnomalyMethod, "trailing">));
      points.forEach((p, i) => {
        let score = 0, dimension = data.fields[0];
        scores.forEach((values, d) => { if (values[i] > score) { score = values[i]; dimension = data.fields[d]; } });
        if (score > config.threshold) report.flagged.push({ ...p, score, dimension });
      });
    }
  }
  if (!eligible && !report.reason) report.reason = config.method === "trailing" ? "Trailing detection needs an ordered series and more points per series than the lookback (5–50)." : "Need at least 4 finite observations in a series or group for comparison.";
  report.rowIndices = [...new Set(report.flagged.flatMap(p => p.rows))].sort((a, b) => a - b);
  report.cells = new Set(report.flagged.flatMap(p => p.cell ? [p.cell] : []));
  return report;
}

/** Universal forecast preview: explicit ordered source + measure, never category positions. */
export function chartForecast(rows: unknown[][], columns: string[], xField: string, yField: string, agg: YAggregateOption, horizon: number, method: ForecastMethod, season: number, time = false) {
  const xi = columns.indexOf(xField), yi = columns.indexOf(yField);
  const groups = new Map<number, number[]>();
  for (const row of rows) {
    const raw = row[xi];
    const x = time && typeof raw === "string" && raw.trim() ? Date.parse(raw) : chartNumber(raw);
    const y = agg === "count" ? 1 : chartNumber(row[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!groups.has(x)) groups.set(x, []); groups.get(x)!.push(y);
  }
  const points = [...groups].sort((a, b) => a[0] - b[0]).map(([x, values]) => ({ x, y: aggregateValues(values, agg) }));
  let reason: string | null = points.length < 8 ? "Need at least 8 distinct ordered values with a finite measure." : null;
  if (!reason) {
    const gaps = points.slice(1).map((p, i) => p.x - points[i].x), step = median(gaps);
    // Calendar months / quarters / years are regular even though their lengths in days differ.
    const calendar = time && calendarStepMonths(points) != null;
    if (!calendar && gaps.some(g => Math.abs(g - step) > Math.max(step * 1e-6, 1e-9))) reason = "Intervals are irregular or missing. Aggregate to regular intervals before forecasting.";
    else if (method === "seasonal" && points.length < season * 2) reason = "Repeat the cycle needs at least two complete cycles.";
  }
  const forecast = reason ? null : forecastCalendar(points, horizon, method, season);
  if (time && forecast?.points.some(p => !Number.isFinite(new Date(p.x).getTime()))) return { points, forecast: null, reason: "Forecast dates exceed the supported calendar range.", time };
  return { points, forecast, reason: reason ?? (forecast ? null : "Choose valid forecast parameters."), time };
}
