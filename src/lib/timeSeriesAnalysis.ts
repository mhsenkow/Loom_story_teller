// Chart analysis operates on the displayed, aggregated series, after filtering.
// Each numerical method is self-contained so its executed code can be inspected.
import type { ChartRecommendation } from "./recommendations";

export interface AnalysisPoint { x: number; y: number }
export interface AnalysisEvent { id: string; label: string; start: string; end: string; visible: boolean }
/** Inspectable forecasts. None is best for every series. */
export type ForecastMethod = "naive" | "line" | "holt" | "seasonal";

export const FORECAST_METHOD_LABEL: Record<ForecastMethod, string> = {
  naive: "Last value",
  line: "Straight line",
  holt: "Recent trend",
  seasonal: "Repeat the cycle",
};

export interface TimeSeriesAnalysis {
  scope: string;
  forecast?: { enabled: boolean; horizon: number; method?: ForecastMethod; season?: number };
  anomaly?: { enabled: boolean; window: number; threshold: number };
  events?: AnalysisEvent[];
}

export function analysisScope(chart: ChartRecommendation): string {
  return JSON.stringify([chart.id, chart.kind, chart.xField, chart.yField, chart.yAggregate, chart.colorField, chart.rowField]);
}

export function analysisUnavailable(chart: ChartRecommendation | null): string | null {
  if (!chart || chart.kind !== "line") return "Choose a line chart with a date or numeric X axis to add analysis.";
  if (chart.colorField || chart.rowField || chart.shapeField || chart.emojiField || chart.y2Field || chart.comparePrevious)
    return "Use a single series: remove color, split, shape, and comparison fields first.";
  if (chart.rollingWindow || chart.seriesNormalize || (chart.yScale && chart.yScale !== "linear"))
    return "Use an unnormalized series with a linear Y axis for this first draft.";
  return null;
}

export interface ForecastResult {
  points: { x: number; y: number; lower: number; upper: number }[];
  anchor: AnalysisPoint;
  step: number;
  observations: number;
  method: ForecastMethod;
}

function prepareForecast(input: AnalysisPoint[], horizon: number) {
  const points = input.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  if (points.length < 8 || !Number.isInteger(horizon) || horizon < 1 || horizon > 50) return null;
  const n = points.length;
  const gaps = points.slice(1).map((p, i) => p.x - points[i].x).filter(g => g > 0).sort((a, b) => a - b);
  if (gaps.length !== n - 1) return null;
  const step = gaps[Math.floor(gaps.length / 2)];
  const last = points[n - 1];
  return { points, step, last, n };
}

function finishForecast(method: ForecastMethod, prepared: NonNullable<ReturnType<typeof prepareForecast>>, points: ForecastResult["points"]): ForecastResult | null {
  if (points.some(p => ![p.x, p.y, p.lower, p.upper].every(Number.isFinite))) return null;
  return { points, anchor: prepared.last, step: prepared.step, observations: prepared.n, method };
}

/** Repeat the latest point. The band widens like a random walk. */
export function forecastNaive(input: AnalysisPoint[], horizon: number) {
  const prepared = prepareForecast(input, horizon);
  if (!prepared) return null;
  const { points, step, last, n } = prepared;
  const diffs = points.slice(1).map((p, i) => p.y - points[i].y);
  const sigma = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / (n - 1));
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const spread = 1.96 * sigma * Math.sqrt(h);
    return { x: last.x + step * h, y: last.y, lower: last.y - spread, upper: last.y + spread };
  });
  return finishForecast("naive", prepared, forecast);
}

/** One slope through the whole history. Approximate 95% prediction interval; no seasonality. */
export function forecastLine(input: AnalysisPoint[], horizon: number) {
  const prepared = prepareForecast(input, horizon);
  if (!prepared) return null;
  const { points, step, last, n } = prepared;
  const origin = points[0].x;
  const xs = points.map(p => (p.x - origin) / step);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (points[i].y - my), 0) / sxx;
  const predict = (x: number) => my + slope * (x - mx);
  const sigma = Math.sqrt(points.reduce((a, p, i) => a + (p.y - predict(xs[i])) ** 2, 0) / (n - 2));
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const x = last.x + step * (i + 1);
    const t = (x - origin) / step;
    const y = predict(t);
    const spread = 1.96 * sigma * Math.sqrt(1 + 1 / n + (t - mx) ** 2 / sxx);
    return { x, y, lower: y - spread, upper: y + spread };
  });
  return finishForecast("line", prepared, forecast);
}

/** Holt level and slope. Newer points count more. Weights are fixed, not secretly fit. */
export function forecastHolt(input: AnalysisPoint[], horizon: number) {
  const prepared = prepareForecast(input, horizon);
  if (!prepared) return null;
  const { points, step, last } = prepared;
  const alpha = 0.4;
  const beta = 0.2;
  let level = points[0].y;
  let trend = points[1].y - points[0].y;
  const errors: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const oneStep = level + trend;
    errors.push(points[i].y - oneStep);
    const nextLevel = alpha * points[i].y + (1 - alpha) * oneStep;
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
  }
  const sigma = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / Math.max(1, errors.length - 1));
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const y = level + h * trend;
    const spread = 1.96 * sigma * Math.sqrt(h);
    return { x: last.x + step * h, y, lower: y - spread, upper: y + spread };
  });
  return finishForecast("holt", prepared, forecast);
}

/** Copy the last cycle forward. A wrong season length invents a rhythm. */
export function forecastSeasonal(input: AnalysisPoint[], horizon: number, season: number) {
  const prepared = prepareForecast(input, horizon);
  if (!prepared || !Number.isInteger(season) || season < 2 || season > 24 || prepared.n <= season) return null;
  const { points, step, last, n } = prepared;
  const diffs: number[] = [];
  for (let i = season; i < n; i++) diffs.push(points[i].y - points[i - season].y);
  const sigma = Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / diffs.length);
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    const y = points[n - season + ((h - 1) % season)].y;
    const spread = 1.96 * sigma * Math.sqrt(Math.ceil(h / season));
    return { x: last.x + step * h, y, lower: y - spread, upper: y + spread };
  });
  return finishForecast("seasonal", prepared, forecast);
}

export function forecastSeries(input: AnalysisPoint[], horizon: number, method: ForecastMethod = "line", season = 12) {
  if (method === "naive") return forecastNaive(input, horizon);
  if (method === "holt") return forecastHolt(input, horizon);
  if (method === "seasonal") return forecastSeasonal(input, horizon, season);
  return forecastLine(input, horizon);
}

/** Trailing median/MAD: the candidate never contributes to its own baseline. */
export function detectSeriesAnomalies(points: AnalysisPoint[], window: number, threshold: number) {
  if (!Number.isInteger(window) || window < 5 || window > 50 || !Number.isFinite(threshold) || threshold < 1 || threshold > 6) return [];
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const result: (AnalysisPoint & { baseline: number; score: number })[] = [];
  for (let i = window; i < points.length; i++) {
    const values = points.slice(i - window, i).map(p => p.y);
    if (!values.every(Number.isFinite) || !Number.isFinite(points[i].y)) continue;
    const baseline = median(values);
    const mad = median(values.map(v => Math.abs(v - baseline)));
    const deviation = Math.abs(points[i].y - baseline);
    const tolerance = Math.max(1, Math.abs(baseline)) * 1e-9;
    const score = mad > tolerance ? 0.67448975 * deviation / mad : deviation > tolerance ? Infinity : 0;
    if (score > threshold) result.push({ ...points[i], baseline, score });
  }
  return result;
}

export function eventPosition(value: string, kind: "number" | "time" | "band"): number | null {
  if (!value.trim() || kind === "band") return null;
  const n = kind === "time" ? Date.parse(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}
