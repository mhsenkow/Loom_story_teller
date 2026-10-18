// Chart analysis operates on the displayed, aggregated series, after filtering.
// Each numerical method is self-contained so its executed code can be inspected.
import type { ChartRecommendation } from "./recommendations";

export interface AnalysisPoint { x: number; y: number }
export interface AnalysisEvent { id: string; label: string; start: string; end: string; visible: boolean }
export interface TimeSeriesAnalysis {
  scope: string;
  forecast?: { enabled: boolean; horizon: number };
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

/** Baseline OLS forecast. Approximate 95% prediction interval; no seasonality. */
export function forecastSeries(input: AnalysisPoint[], horizon: number) {
  const points = input.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  if (points.length < 8 || !Number.isInteger(horizon) || horizon < 1 || horizon > 50) return null;
  const n = points.length;
  const origin = points[0].x;
  const gaps = points.slice(1).map((p, i) => p.x - points[i].x).filter(g => g > 0).sort((a, b) => a - b);
  if (gaps.length !== n - 1) return null;
  const step = gaps[Math.floor(gaps.length / 2)];
  const xs = points.map(p => (p.x - origin) / step);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (points[i].y - my), 0) / sxx;
  const predict = (x: number) => my + slope * (x - mx);
  const sigma = Math.sqrt(points.reduce((a, p, i) => a + (p.y - predict(xs[i])) ** 2, 0) / (n - 2));
  const last = points[n - 1];
  const forecast = Array.from({ length: horizon }, (_, i) => {
    const x = last.x + step * (i + 1);
    const t = (x - origin) / step;
    const y = predict(t);
    const spread = 1.96 * sigma * Math.sqrt(1 + 1 / n + (t - mx) ** 2 / sxx);
    return { x, y, lower: y - spread, upper: y + spread };
  });
  if (forecast.some(p => ![p.x, p.y, p.lower, p.upper].every(Number.isFinite))) return null;
  return { points: forecast, anchor: last, step, observations: n };
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
