// =================================================================
// Axis, gutter, reference-line and scatter-extra helpers shared by renderers.
// (extracted from ChartView.tsx — LOOM-141 / LOOM-142)
// =================================================================

import { type XModel, classifyKeys, formatDataValue, timeTicks } from "../chartAxes";
import { roundedBox } from "../chartLegend";
import { type PlotRect, drawBandAxisX, drawChartTicks, drawPositionedLabelsX } from "../chartLooks";
import { type ChartRenderOpts } from "../chartRenderTypes";
import { roundedRect } from "./primitives";
import { DEFAULT_COLORS } from "./shared";
import { chartFont, chartTypeRamp } from "../chartType";

export function widestText(ctx: CanvasRenderingContext2D, labels: string[], font: string): number {
  ctx.save();
  ctx.font = font;
  let m = 0;
  for (const l of labels) m = Math.max(m, ctx.measureText(l).width);
  ctx.restore();
  return m;
}

export function axisFont(opts: ChartRenderOpts | undefined, size?: number): string {
  const type = chartTypeRamp(opts?.axisFontSize);
  return chartFont(size == null ? type.tick : Math.max(type.mark, size), opts?.fontFamily);
}

/** Category label gutter for horizontal-band charts: room for the widest label, capped. */
export function labelGutter(ctx: CanvasRenderingContext2D, labels: string[], w: number, pad: number, opts?: ChartRenderOpts): number {
  const widest = widestText(ctx, labels, axisFont(opts));
  return Math.min((w - 2 * pad) * 0.36, widest + 12);
}

/** Bar path with rounded corners on the free end only. */
export function barPath(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, r: number, dir: "up" | "down" | "right" | "left") {
  const rr = Math.max(0, Math.min(r, bw / 2, bh / 2));
  if (rr <= 0.5) {
    ctx.rect(x, y, bw, bh);
    return;
  }
  if (dir === "up") {
    roundedRect(ctx, x, y, bw, bh, rr);
  } else if (dir === "down") {
    ctx.moveTo(x, y);
    ctx.lineTo(x + bw, y);
    ctx.lineTo(x + bw, y + bh - rr);
    ctx.arcTo(x + bw, y + bh, x + bw - rr, y + bh, rr);
    ctx.lineTo(x + rr, y + bh);
    ctx.arcTo(x, y + bh, x, y + bh - rr, rr);
    ctx.closePath();
  } else if (dir === "left") {
    // Round the left (growing) end
    ctx.moveTo(x + bw, y);
    ctx.lineTo(x + rr, y);
    ctx.arcTo(x, y, x, y + rr, rr);
    ctx.lineTo(x, y + bh - rr);
    ctx.arcTo(x, y + bh, x + rr, y + bh, rr);
    ctx.lineTo(x + bw, y + bh);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + bw - rr, y);
    ctx.arcTo(x + bw, y, x + bw, y + rr, rr);
    ctx.lineTo(x + bw, y + bh - rr);
    ctx.arcTo(x + bw, y + bh, x + bw - rr, y + bh, rr);
    ctx.lineTo(x, y + bh);
    ctx.closePath();
  }
}

/** Zero rule for value axes that cross zero. */
export function drawZeroLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, opts?: ChartRenderOpts) {
  ctx.save();
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? "#6b6b78";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** Dashed user reference lines with a value pill; "y" lines sit on the chart's value axis. */
export function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  lines: { id: string; axis: "x" | "y"; value: number; label: string }[],
  scales: NonNullable<ChartRenderOpts["scales"]>,
  opts?: ChartRenderOpts,
) {
  const { rect } = scales;
  const font = axisFont(opts, 10);
  const pillH = chartTypeRamp(opts?.axisFontSize).mark + 6;
  ctx.save();
  for (const line of lines) {
    // "y" means the measure axis — which is X on horizontal bars / lollipops / strips
    const axis = line.axis === "y" ? (scales.valueAxis ?? "y") : scales.valueAxis === "x" ? "y" : "x";
    const scale = axis === "x" ? scales.x : scales.y;
    if (!scale || !Number.isFinite(line.value)) continue;
    const p = scale(line.value);
    const inside = axis === "x" ? p >= rect.left - 0.5 && p <= rect.right + 0.5 : p >= rect.top - 0.5 && p <= rect.bottom + 0.5;
    if (!inside) continue;
    ctx.strokeStyle = opts?.themeText ?? "#e8e8ec";
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (axis === "x") {
      ctx.moveTo(Math.round(p) + 0.5, rect.top);
      ctx.lineTo(Math.round(p) + 0.5, rect.bottom);
    } else {
      ctx.moveTo(rect.left, Math.round(p) + 0.5);
      ctx.lineTo(rect.right, Math.round(p) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Label pill at the far end of the line
    const text = `${line.label || "Ref"} · ${formatDataValue(line.value)}`;
    ctx.font = font;
    const tw = ctx.measureText(text).width + 10;
    const bx = axis === "x" ? Math.min(rect.right - tw, p + 4) : rect.right - tw;
    const by = axis === "x" ? rect.top + 2 : p - pillH - 2;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.beginPath();
    roundedBox(ctx, bx, by, tw, pillH, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 5, by + pillH / 2);
  }
  ctx.restore();
}

/** Scatter trail: points joined in row order (time order for feeds), one path per color group. */
export function drawScatterTrail(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  toSX: (v: number) => number,
  toSY: (v: number) => number,
  opts?: ChartRenderOpts,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const paths = new Map<string, { x: number; y: number }[]>();
  for (const r of rows) {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const k = ci >= 0 ? String(r[ci]) : "";
    if (!paths.has(k)) paths.set(k, []);
    paths.get(k)!.push({ x: toSX(x), y: toSY(y) });
  }
  ctx.save();
  ctx.lineWidth = 1;
  ctx.lineJoin = opts?.lineJoin ?? "round";
    ctx.lineCap = opts?.lineCap ?? "round";
  let i = 0;
  for (const pts of paths.values()) {
    ctx.strokeStyle = cols[i++ % cols.length]!;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.restore();
}

/** Marginal histograms hugging the bottom (x) and left (y) edges inside the plot. */
export function drawScatterMarginals(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const bins = 32;
  const cx = new Array<number>(bins).fill(0);
  const cy = new Array<number>(bins).fill(0);
  for (const r of rows) {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (Number.isFinite(x) && x >= xMin && x <= xMax) cx[Math.min(bins - 1, Math.floor(((x - xMin) / (xMax - xMin || 1)) * bins))]! += 1;
    if (Number.isFinite(y) && y >= yMin && y <= yMax) cy[Math.min(bins - 1, Math.floor(((y - yMin) / (yMax - yMin || 1)) * bins))]! += 1;
  }
  const depth = Math.min(36, (Math.min(w, h) - 2 * pad) * 0.12);
  const mx = Math.max(1, ...cx);
  const my = Math.max(1, ...cy);
  const plotW = w - 2 * pad;
  const plotH = h - 2 * pad;
  ctx.save();
  ctx.fillStyle = (opts?.colors ?? DEFAULT_COLORS)[0]!;
  ctx.globalAlpha = 0.28;
  for (let b = 0; b < bins; b++) {
    const bh = (cx[b]! / mx) * depth;
    ctx.fillRect(pad + (b / bins) * plotW + 0.5, h - pad - bh, plotW / bins - 1, bh);
    const bw = (cy[b]! / my) * depth;
    ctx.fillRect(pad, h - pad - ((b + 1) / bins) * plotH + 0.5, bw, plotH / bins - 1);
  }
  ctx.restore();
}

/** X axis for an ordered model: number ticks, calendar ticks, or thinned category labels. */
export function drawXModelAxis(ctx: CanvasRenderingContext2D, model: XModel, w: number, h: number, rect: PlotRect, opts?: ChartRenderOpts) {
  const span = rect.right - rect.left;
  if (model.kind === "number" && model.domain) {
    drawChartTicks(ctx, model.domain[0], model.domain[1], 0, 1, w, h, rect, opts, { y: false });
  } else if (model.kind === "time" && model.domain) {
    const [d0, d1] = model.domain;
    const tt = timeTicks(d0, d1, Math.max(2, Math.floor(span / 90)));
    drawPositionedLabelsX(
      ctx,
      tt.ticks.map((t) => ({ x: rect.left + ((t - d0) / (d1 - d0 || 1)) * span, label: tt.format(t) })),
      w,
      h,
      rect,
      opts,
    );
  } else {
    const n = Math.max(1, model.keys.length);
    drawBandAxisX(ctx, model.keys, model.pos.map((t) => rect.left + t * span), span / n, w, h, rect, opts, "ordered");
  }
}

/** Orient a sequential ramp so the high end contrasts most with the background (dark-on-light, light-on-dark). */
export function densityStops(stops: string[], themeBg?: string): string[] {
  if (stops.length < 2) return stops;
  const lum = (hex: string) => {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (!m) return 0.5;
    return (0.2126 * parseInt(m[1]!, 16) + 0.7152 * parseInt(m[2]!, 16) + 0.0722 * parseInt(m[3]!, 16)) / 255;
  };
  const bg = lum(themeBg ?? "#111114");
  const lo = Math.abs(lum(stops[0]!) - bg);
  const hi = Math.abs(lum(stops[stops.length - 1]!) - bg);
  return hi >= lo ? stops : [...stops].reverse();
}

/**
 * Long daily / hourly series turn into a wall of spikes. When a time axis has more
 * than ~90 distinct points, roll rows up to weeks or months (by span) so the trend
 * reads; keys become the bucket start ("2024-03-01"), which the time axis labels.
 */
export function timeBuckets(rows: unknown[][], xi: number): {
  keyOf: (r: unknown[]) => string;
  unit: "" | "hour" | "day" | "week" | "month" | "year";
  firstRow: Map<string, number>;
} {
  const raw = [...new Set(rows.map((r) => String(r[xi])))];
  const plain = { keyOf: (r: unknown[]) => String(r[xi]), unit: "" as const, firstRow: new Map<string, number>() };
  if (raw.length <= 90) return plain;
  const cls = classifyKeys(raw);
  if (cls.kind !== "time") return plain;
  const t0 = cls.values[0]!;
  const t1 = cls.values[cls.values.length - 1]!;
  const days = (t1 - t0) / 86_400_000;
  // Live feeds often span hours or a couple of days — day buckets would fold
  // them to one or two points. Short spans bucket by hour; very short spans
  // keep raw timestamps (the time axis spaces them continuously).
  if (days * 24 <= 8) return plain;
  const unit = days > 365 * 12 ? "year" : days > 540 ? "month" : days > 120 ? "week" : days > 4 ? "day" : "hour";
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const bucket = (ms: number) => {
    const d = new Date(ms);
    if (unit === "year") return `${d.getUTCFullYear()}-01-01`;
    if (unit === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    if (unit === "week") {
      const dow = (d.getUTCDay() + 6) % 7; // Monday-start weeks
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)));
    }
    if (unit === "hour") return `${iso(d)}T${String(d.getUTCHours()).padStart(2, "0")}:00:00Z`;
    return iso(d);
  };
  const cache = new Map<string, string>();
  const keyOf = (r: unknown[]) => {
    const k = String(r[xi]);
    let b = cache.get(k);
    if (b === undefined) {
      const ms = Date.parse(k);
      b = Number.isFinite(ms) ? bucket(ms) : k;
      cache.set(k, b);
    }
    return b;
  };
  const firstRow = new Map<string, number>();
  rows.forEach((r, i) => {
    const b = keyOf(r);
    if (!firstRow.has(b)) firstRow.set(b, i);
  });
  return { keyOf, unit, firstRow };
}

// --- Bars ---
