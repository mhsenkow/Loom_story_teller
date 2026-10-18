// Analysis layers use the line renderer's exact domains and plotting rectangle.
import { forecastSeries, detectSeriesAnomalies, eventPosition, type AnalysisPoint, type TimeSeriesAnalysis } from "../timeSeriesAnalysis";
import type { ChartRenderOpts } from "../chartRenderTypes";
import type { PlotRect } from "../chartLooks";
import { chartFont } from "../chartType";
import { pushHit } from "./plumbing";

export function computeAnalysis(points: AnalysisPoint[], config?: TimeSeriesAnalysis) {
  return {
    forecast: config?.forecast?.enabled ? forecastSeries(points, config.forecast.horizon, config.forecast.method ?? "line", config.forecast.season ?? 12) : null,
    anomalies: config?.anomaly?.enabled ? detectSeriesAnomalies(points, config.anomaly.window, config.anomaly.threshold) : [],
  };
}

export function drawAnalysisLayers(ctx: CanvasRenderingContext2D, result: ReturnType<typeof computeAnalysis>, config: TimeSeriesAnalysis, kind: "time" | "number" | "band", X: (x: number) => number, Y: (y: number) => number, rect: PlotRect, opts: ChartRenderOpts) {
  const forecastColor = opts.colors[1] ?? opts.themeText ?? opts.colors[0];
  const anomalyColor = opts.colors[2] ?? forecastColor;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  ctx.clip();
  ctx.font = chartFont(opts.axisFontSize ?? 12, opts.fontFamily);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (const [index, event] of (config.events ?? []).filter(e => e.visible).entries()) {
    const start = eventPosition(event.start, kind);
    const end = event.end ? eventPosition(event.end, kind) : start;
    if (start == null || end == null || end < start) continue;
    const left = X(start), right = X(end);
    if (right < rect.left || left > rect.right) continue;
    ctx.fillStyle = opts.themeText ?? forecastColor;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(left, rect.top, Math.max(2, right - left), rect.bottom - rect.top);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = opts.themeText ?? forecastColor;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(left, rect.top); ctx.lineTo(left, rect.bottom); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const labelX = Math.max(rect.left + 4, Math.min(left + 6, rect.right - 100));
    const labelY = rect.top + 8 + (index % 3) * 18;
    let label = event.label;
    while (label.length > 1 && ctx.measureText(label + "…").width > rect.right - labelX - 4) label = label.slice(0, -1);
    ctx.fillText(label === event.label ? label : label + "…", labelX, labelY);
    pushHit(opts, { shape: "rect", x: Math.max(rect.left, left - 5), y: rect.top, w: Math.max(10, Math.min(rect.right, right) - Math.max(rect.left, left)), h: rect.bottom - rect.top, match: [], summary: { columns: ["Event", "Start", "End"], row: [event.label, event.start, event.end || event.start] } });
  }
  if (result.forecast) {
    const { points, anchor } = result.forecast;
    ctx.fillStyle = forecastColor;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.moveTo(X(anchor.x), Y(anchor.y));
    for (const p of points) ctx.lineTo(X(p.x), Y(p.upper));
    for (const p of [...points].reverse()) ctx.lineTo(X(p.x), Y(p.lower));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = forecastColor; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(X(anchor.x), Y(anchor.y));
    for (const p of points) ctx.lineTo(X(p.x), Y(p.y));
    ctx.stroke(); ctx.setLineDash([]);
    for (const p of points) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); ctx.fill();
      pushHit(opts, { shape: "circle", cx: X(p.x), cy: Y(p.y), r: 7, match: [], summary: { columns: ["Forecast", "Estimate", "Lower (approx. 95%)", "Upper (approx. 95%)"], row: [kind === "time" ? new Date(p.x).toISOString() : p.x, p.y, p.lower, p.upper] } });
    }
  }
  ctx.strokeStyle = anomalyColor; ctx.lineWidth = 2;
  for (const p of result.anomalies) {
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 7, 0, Math.PI * 2); ctx.stroke();
    pushHit(opts, { shape: "circle", cx: X(p.x), cy: Y(p.y), r: 9, match: [], summary: { columns: ["Unusual point", "Value", "Trailing median"], row: [kind === "time" ? new Date(p.x).toISOString() : p.x, p.y, p.baseline] } });
  }
  ctx.restore();
}
