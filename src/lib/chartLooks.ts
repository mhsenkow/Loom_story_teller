// =================================================================
// Loom — Chart look chrome (axis frames, backgrounds, grid dialects)
// =================================================================
// Design systems (Tufte, Bauhaus, newspaper, military, …) only ring true
// when axis style + background + grid actually draw differently. These
// helpers are shared by every canvas chart kind.
// =================================================================

import {
  FOOTNOTE_BAND_PX,
  blendToward,
  fitTextEllipsis,
  isLightHex,
  titlePositions,
  titlePreferCenter,
} from "./chartLayout";
import { titleArrangementRect } from "./canvasArrangement";
import { formatAxisValue, layoutBandLabels, niceTicks } from "./chartAxes";
import {
  CHART_LABEL_FALLBACK,
  CHART_TEXT_FALLBACK,
  chartFont,
  chartTypeRamp,
  fitTextWrap,
} from "./chartType";

export type ChartBackgroundStyle =
  | "default"
  | "gradient"
  | "paper"
  | "transparent"
  | "newsprint"
  | "blueprint"
  | "bauhaus"
  | "tufte"
  | "carbon"
  | "ruled";

export type ChartAxisStyle = "rule" | "ladder" | "mercury" | "spine" | "index" | "tape";

export interface ChartLookOpts {
  plotBounds?: PlotRect;
  backgroundStyle?: string;
  axisStyle?: string;
  axisLineColor?: string;
  axisLineWidth?: number;
  axisLabelColor?: string;
  axisFontSize?: number;
  themeBg?: string;
  themeBorder?: string;
  themeMuted?: string;
  themeText?: string;
  showGrid?: boolean;
  gridStyle?: string;
  gridOpacity?: number;
  tickCount?: number;
  tickRotation?: number;
  fontFamily?: string;
  /** A source footnote owns the bottom band — X field title sits above it. */
  sourceFootnote?: boolean;
  /**
   * Value → pixel maps from the active renderer. When present, grid + ticks
   * follow them so Direction ↓ / ← (reversed measure) keeps labels aligned
   * with the bars (zero at top / right).
   */
  scales?: {
    x?: (v: number) => number;
    y?: (v: number) => number;
    valueAxis?: "x" | "y";
  } | null;
}

/** Plot area in canvas px. Pass instead of a uniform `pad` when a renderer shifts its plot (e.g. a category-label gutter). */
export type PlotRect = { left: number; top: number; right: number; bottom: number };

function plotRect(w: number, h: number, pad: number | PlotRect): PlotRect {
  return typeof pad === "number" ? { left: pad, top: pad, right: w - pad, bottom: h - pad } : pad;
}

/** Full-bleed atmosphere behind marks — must differ by design system. */
export function drawChartBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style?: string,
  themeBg?: string,
): void {
  const bg = themeBg ?? "#0a0a0c";
  const light = isLightHex(bg);

  switch (style) {
    case "gradient": {
      const grad = ctx.createRadialGradient(w / 2, h * 0.35, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
      grad.addColorStop(0, blendToward(bg, light ? 0.08 : 0.12, "white"));
      grad.addColorStop(1, blendToward(bg, light ? 0.14 : 0.45, "black"));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "paper":
    case "newsprint": {
      ctx.fillStyle = style === "newsprint"
        ? (light ? blendToward(bg, 0.04, "black") : blendToward(bg, 0.06, "white"))
        : bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = light ? 0.05 : 0.04;
      for (let i = 0; i < (style === "newsprint" ? 2200 : 1600); i++) {
        ctx.fillStyle = light ? "#000000" : "#ffffff";
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }
      ctx.globalAlpha = 1;
      if (style === "newsprint") {
        ctx.globalAlpha = light ? 0.06 : 0.05;
        ctx.strokeStyle = light ? "#000000" : "#ffffff";
        ctx.lineWidth = 0.5;
        for (let y = 18; y < h; y += 7) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "ruled": {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = light ? 0.08 : 0.1;
      ctx.strokeStyle = light ? "#3a5a9a" : "#5a7aba";
      ctx.lineWidth = 0.6;
      for (let y = 20; y < h; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = light ? 0.12 : 0.14;
      ctx.strokeStyle = light ? "#c05050" : "#e07070";
      ctx.beginPath();
      ctx.moveTo(48, 0);
      ctx.lineTo(48, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case "blueprint": {
      const base = light ? blendToward("#d6e4f5", 0.15, "white") : blendToward("#0b1c33", 0.1, "black");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = light ? 0.18 : 0.22;
      ctx.strokeStyle = light ? "#3d6ea8" : "#4a8fd4";
      ctx.lineWidth = 0.5;
      const step = 24;
      for (let x = 0; x <= w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = light ? 0.1 : 0.12;
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += step * 4) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += step * 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "bauhaus": {
      ctx.fillStyle = light ? "#f2efe8" : blendToward(bg, 0.08, "white");
      ctx.fillRect(0, 0, w, h);
      // Primary geometry accents — corner blocks, not decoration on marks
      const s = Math.min(56, w * 0.08, h * 0.1);
      ctx.fillStyle = "#e23d28";
      ctx.fillRect(0, 0, s, s * 0.35);
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(w - s * 0.35, h - s, s * 0.35, s);
      ctx.fillStyle = "#f5c518";
      ctx.beginPath();
      ctx.arc(w - s * 0.55, s * 0.55, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tufte": {
      // Near-white / near-black — maximize data-ink contrast, no atmosphere
      ctx.fillStyle = light ? "#fbfaf7" : "#0c0c0e";
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "carbon": {
      ctx.fillStyle = light ? blendToward(bg, 0.06, "black") : blendToward(bg, 0.04, "white");
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = light ? 0.05 : 0.07;
      ctx.strokeStyle = light ? "#000000" : "#8a9a7a";
      ctx.lineWidth = 0.5;
      for (let i = -h; i < w + h; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "transparent":
      ctx.clearRect(0, 0, w, h);
      break;
    default:
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
  }
}

/**
 * Axis frame — the L / baseline / spine / tape that defines the design system.
 * Call after background, before marks (or after grid depending on style).
 */
export function drawAxisFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number | PlotRect,
  opts?: ChartLookOpts,
): void {
  const style = (opts?.axisStyle ?? "rule") as ChartAxisStyle;
  const color = opts?.axisLineColor ?? opts?.themeBorder ?? "#2a2a30";
  const lw = opts?.axisLineWidth ?? 1;
  const { left, right, top, bottom } = plotRect(w, h, opts?.plotBounds ?? pad);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "butt";

  switch (style) {
    case "mercury": {
      // Thick baseline only — Tufte-adjacent quantitative axis
      ctx.lineWidth = Math.max(2.5, lw * 1.8);
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      break;
    }
    case "spine": {
      // Single left spine; tiny bottom stub
      ctx.lineWidth = Math.max(1.5, lw);
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, lw * 0.8);
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(left + Math.min(48, (right - left) * 0.12), bottom);
      ctx.stroke();
      break;
    }
    case "index": {
      // No continuous axis — only corner tick brackets
      ctx.lineWidth = Math.max(1, lw);
      const t = 8;
      ctx.beginPath();
      ctx.moveTo(left, top + t);
      ctx.lineTo(left, bottom);
      ctx.lineTo(left + t, bottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(right - t, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      break;
    }
    case "tape": {
      // Double baseline (newspaper / tape rule)
      ctx.lineWidth = Math.max(1, lw);
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, lw * 0.5);
      ctx.beginPath();
      ctx.moveTo(left, bottom + 3);
      ctx.lineTo(right, bottom + 3);
      ctx.stroke();
      // Hairline left
      ctx.beginPath();
      ctx.moveTo(left, top + 12);
      ctx.lineTo(left, bottom);
      ctx.stroke();
      break;
    }
    case "ladder": {
      // Left rail + bottom; thicker for Bauhaus/brutal
      ctx.lineWidth = Math.max(2, lw);
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      break;
    }
    case "rule":
    default: {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Value domains for gridlines; `null` on an axis = categorical (no rules across it). */
export type GridDomains = { x?: [number, number] | null; y?: [number, number] | null };

/**
 * Grid dialect tied to design system — horizontal-only for newspaper/Tufte soft.
 * With `domains`, rules sit on the same round values as the tick labels.
 */
export function drawChartGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number | PlotRect,
  opts?: ChartLookOpts,
  domains?: GridDomains,
): void {
  if (opts?.showGrid === false) return;
  const style = opts?.gridStyle ?? "solid";
  if (style === "none") return;
  const axis = opts?.axisStyle ?? "rule";
  const n = Math.max(2, opts?.tickCount ?? 5);
  const alpha = opts?.gridOpacity ?? 0.5;
  const { left, right, top, bottom } = plotRect(w, h, opts?.plotBounds ?? pad);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = opts?.themeBorder ?? "#1a1a1f";
  ctx.lineWidth = axis === "ladder" ? 0.9 : 0.5;
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 3]);

  const tickFractions = (d: [number, number]) =>
    niceTicks(d[0], d[1], n, false).ticks.map((v) => (v - d[0]) / (d[1] - d[0] || 1));
  const evenFractions = Array.from({ length: n + 1 }, (_, i) => i / n);
  const yMap = opts?.scales?.y;
  const xMap = opts?.scales?.x;

  // Newspaper / mercury / tape: horizontal rules only (less chartjunk)
  const horizontalOnly = axis === "mercury" || axis === "tape" || axis === "spine";
  if (domains?.y !== null) {
    if (domains?.y && yMap) {
      for (const v of niceTicks(domains.y[0], domains.y[1], n, false).ticks) {
        const y = Math.round(yMap(v)) + 0.5;
        if (y < top - 0.5 || y > bottom + 0.5) continue;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
    } else {
      const ys = domains?.y ? tickFractions(domains.y) : evenFractions;
      for (const t of ys) {
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        const y = Math.round(bottom - t * (bottom - top)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
      }
    }
  }
  if (!horizontalOnly && domains?.x !== null) {
    if (domains?.x && xMap) {
      for (const v of niceTicks(domains.x[0], domains.x[1], n, false).ticks) {
        const x = Math.round(xMap(v)) + 0.5;
        if (x < left - 0.5 || x > right + 0.5) continue;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
    } else {
      const xs = domains?.x ? tickFractions(domains.x) : evenFractions;
      for (const t of xs) {
        if (t < -1e-6 || t > 1 + 1e-6) continue;
        const x = Math.round(left + t * (right - left)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Tick labels + stub marks at round values inside [min, max] — density/placement
 * depends on axisStyle. Pass `show.x = false` for category axes (draw those with
 * `drawBandAxisX`) and `show.y = false` for horizontal-band charts.
 */
export function drawChartTicks(
  ctx: CanvasRenderingContext2D,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  w: number,
  h: number,
  pad: number | PlotRect,
  opts?: ChartLookOpts,
  show: { x?: boolean; y?: boolean; xFormat?: (v: number, step: number) => string; yFormat?: (v: number, step: number) => string } = {},
): void {
  const n = Math.max(2, opts?.tickCount ?? 5);
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? CHART_LABEL_FALLBACK;
  const fontSize = chartTypeRamp(opts?.axisFontSize).tick;
  const rotDeg = opts?.tickRotation ?? 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const axis = (opts?.axisStyle ?? "rule") as ChartAxisStyle;
  const { left, right, top, bottom } = plotRect(w, h, opts?.plotBounds ?? pad);
  const stub = axis === "index" || axis === "mercury" ? 5 : axis === "ladder" ? 7 : 4;

  ctx.save();
  ctx.fillStyle = axisLabelColor;
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? axisLabelColor;
  ctx.lineWidth = Math.max(1, (opts?.axisLineWidth ?? 1) * 0.7);
  ctx.font = chartFont(fontSize, fontFamily);
  ctx.textBaseline = "alphabetic";

  const xMap = opts?.scales?.x;
  const yMap = opts?.scales?.y;

  // X ticks
  if (show.x !== false && Number.isFinite(xMin) && Number.isFinite(xMax)) {
    const xs = niceTicks(xMin, xMax, n, false);
    const span = xMax - xMin || 1;
    ctx.textAlign = "center";
    let lastRight = -Infinity;
    for (const v of xs.ticks) {
      const x = xMap ? xMap(v) : left + ((v - xMin) / span) * (right - left);
      if (x < left - 0.5 || x > right + 0.5) continue;
      // stub downward from baseline
      if (axis !== "spine") {
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        ctx.lineTo(x, bottom + (axis === "mercury" ? stub + 1 : stub));
        ctx.stroke();
      }
      const labelY = Math.min(h - 4, bottom + stub + fontSize + 2);
      const label = show.xFormat ? show.xFormat(v, xs.step) : formatAxisValue(v, xs.step);
      if (rotDeg !== 0) {
        ctx.save();
        ctx.translate(x, labelY);
        ctx.rotate(-rotRad);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      } else {
        // Soft-clamp edge labels so they don't clip; skip any that would collide
        const tw = ctx.measureText(label).width;
        const lx = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, x));
        if (lx - tw / 2 < lastRight + 6) continue;
        ctx.fillText(label, lx, labelY);
        lastRight = lx + tw / 2;
      }
    }
  }

  // Y ticks
  if (show.y !== false && Number.isFinite(yMin) && Number.isFinite(yMax)) {
    const ys = niceTicks(yMin, yMax, Math.min(n, Math.max(2, Math.floor((bottom - top) / (fontSize + 8)))), false);
    const span = yMax - yMin || 1;
    ctx.textAlign = "right";
    let lastLabelY = Infinity;
    for (const v of ys.ticks) {
      const y = yMap ? yMap(v) : bottom - ((v - yMin) / span) * (bottom - top);
      if (y < top - 0.5 || y > bottom + 0.5) continue;
      if (axis !== "mercury") {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left - stub, y);
        ctx.stroke();
      }
      const label = show.yFormat ? show.yFormat(v, ys.step) : formatAxisValue(v, ys.step);
      const lx = Math.max(4, left - stub - 4);
      const ly = Math.max(fontSize, Math.min(h - 4, y + fontSize * 0.35));
      if (lastLabelY - ly < fontSize + 4) continue;
      ctx.fillText(label, lx, ly);
      lastLabelY = ly;
    }
  }
  ctx.restore();
}

/**
 * Category labels under a band axis. `centers` are the band midpoints in px.
 * Ordered axes (time, sorted keys) thin to evenly spaced flat labels; nominal
 * axes go flat → ellipsized → angled so every bar keeps a readable name.
 */
export function drawBandAxisX(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  centers: number[],
  bandWidth: number,
  w: number,
  h: number,
  pad: number | PlotRect,
  opts?: ChartLookOpts,
  mode: "nominal" | "ordered" = "nominal",
): void {
  if (labels.length === 0) return;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? CHART_LABEL_FALLBACK;
  const baseFont = chartTypeRamp(opts?.axisFontSize).tick;
  const { bottom } = plotRect(w, h, opts?.plotBounds ?? pad);
  // Labels live between the baseline and the axis field name near the canvas floor
  const room = Math.max(14, h - bottom - 22);

  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "top";

  if (mode === "ordered") {
    ctx.font = chartFont(baseFont, fontFamily);
    const widest = Math.max(...labels.map((l) => ctx.measureText(l).width));
    const slot = Math.max(1, widest + 14);
    const span = Math.max(1, (centers[centers.length - 1] ?? 0) - (centers[0] ?? 0));
    const maxLabels = Math.max(2, Math.floor(span / slot) + 1);
    const every = Math.max(1, Math.ceil(labels.length / maxLabels));
    ctx.textAlign = "center";
    let lastRight = -Infinity;
    for (let i = 0; i < labels.length; i += every) {
      const text = labels[i]!;
      const tw = ctx.measureText(text).width;
      const x = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, centers[i]!));
      if (x - tw / 2 < lastRight + 8) continue;
      ctx.fillText(text, x, bottom + 6);
      lastRight = x + tw / 2;
    }
    ctx.restore();
    return;
  }

  const lay = layoutBandLabels(ctx, labels, bandWidth, room, fontFamily, baseFont);
  ctx.font = chartFont(lay.fontSize, fontFamily);
  labels.forEach((label, i) => {
    if (i % lay.every !== 0) return;
    const text = fitTextEllipsis(ctx, label, lay.maxWidth);
    const x = centers[i]!;
    if (lay.angle === 0) {
      ctx.textAlign = "center";
      ctx.fillText(text, x, bottom + 6);
    } else {
      ctx.save();
      ctx.translate(x + lay.fontSize * 0.3, bottom + 6);
      ctx.rotate(lay.angle);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  });
  ctx.restore();
}

/** Category labels left of a horizontal band axis, right-aligned to `x`. */
export function drawBandAxisY(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  centers: number[],
  bandHeight: number,
  x: number,
  maxWidth: number,
  opts?: ChartLookOpts,
): void {
  if (labels.length === 0) return;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? CHART_LABEL_FALLBACK;
  const fontSize = chartTypeRamp(opts?.axisFontSize).tick;
  const every = Math.max(1, Math.ceil((fontSize + 4) / Math.max(1, bandHeight)));
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = chartFont(fontSize, fontFamily);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  labels.forEach((label, i) => {
    if (i % every !== 0) return;
    ctx.fillText(fitTextEllipsis(ctx, label, maxWidth), x, centers[i]!);
  });
  ctx.restore();
}

/**
 * Tick stubs + labels at explicit x positions (time axes, custom scales).
 * Labels that would collide with the previous one are skipped.
 */
export function drawPositionedLabelsX(
  ctx: CanvasRenderingContext2D,
  items: { x: number; label: string }[],
  w: number,
  h: number,
  pad: number | PlotRect,
  opts?: ChartLookOpts,
): void {
  const { left, right, bottom } = plotRect(w, h, opts?.plotBounds ?? pad);
  const fontFamily = opts?.fontFamily ?? "Inter";
  const fontSize = chartTypeRamp(opts?.axisFontSize).tick;
  ctx.save();
  ctx.fillStyle = opts?.axisLabelColor ?? CHART_LABEL_FALLBACK;
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? CHART_LABEL_FALLBACK;
  ctx.lineWidth = Math.max(1, (opts?.axisLineWidth ?? 1) * 0.7);
  ctx.font = chartFont(fontSize, fontFamily);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let lastRight = -Infinity;
  for (const it of items) {
    if (it.x < left - 0.5 || it.x > right + 0.5) continue;
    const tw = ctx.measureText(it.label).width;
    const lx = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, it.x));
    if (lx - tw / 2 < lastRight + 8) continue;
    ctx.beginPath();
    ctx.moveTo(it.x, bottom);
    ctx.lineTo(it.x, bottom + 4);
    ctx.stroke();
    ctx.fillText(it.label, lx, Math.min(h - 4, bottom + 4 + fontSize + 2));
    lastRight = lx + tw / 2;
  }
  ctx.restore();
}

/** Vertical sequential key (top = high). Labels sit right of the ramp. */
export function drawColorRamp(
  ctx: CanvasRenderingContext2D,
  stops: string[],
  sample: (stops: string[], t: number) => string,
  x: number,
  y: number,
  height: number,
  lowLabel: string,
  highLabel: string,
  opts?: ChartLookOpts,
  title?: string,
): void {
  if (!stops.length || height < 24) return;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const rampW = 8;
  ctx.save();
  const steps = Math.max(8, Math.round(height / 3));
  for (let i = 0; i < steps; i++) {
    const t = 1 - i / (steps - 1);
    ctx.fillStyle = sample(stops, t);
    ctx.fillRect(x, y + (i / steps) * height, rampW, height / steps + 0.75);
  }
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.25, y + 0.25, rampW - 0.5, height - 0.5);
  const meta = chartTypeRamp(opts?.axisFontSize).footnoteMeta;
  ctx.fillStyle = opts?.axisLabelColor ?? opts?.themeMuted ?? CHART_LABEL_FALLBACK;
  ctx.font = chartFont(meta, fontFamily, 500);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(highLabel, x + rampW + 4, y);
  ctx.textBaseline = "bottom";
  ctx.fillText(lowLabel, x + rampW + 4, y + height);
  if (title) {
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, title, 72), x, y - 4);
  }
  ctx.restore();
}

/** Axis field names — centered X under plot; Y rotated in left gutter. */
export function drawAxisFieldLabels(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  xLabel: string,
  yLabel: string | null | undefined,
  opts?: ChartLookOpts,
): void {
  const fontFamily = opts?.fontFamily ?? "Inter";
  const fontSize = chartTypeRamp(opts?.axisFontSize).axisField;
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? CHART_LABEL_FALLBACK;
  const rect = opts?.plotBounds ?? plotRect(w, h, pad);
  const maxX = Math.max(40, rect.right - rect.left);
  const maxY = Math.max(40, rect.bottom - rect.top);

  ctx.save();
  ctx.fillStyle = color;
  ctx.font = chartFont(fontSize, fontFamily, 500);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Sit just above the canvas floor (or the footnote band), clear of tick labels
  const footBand = opts?.sourceFootnote ? FOOTNOTE_BAND_PX : 0;
  const xY = opts?.plotBounds ? Math.min(h - footBand - 12, rect.bottom + 40) : h - footBand - Math.max(10, Math.min(18, pad * 0.22));
  ctx.fillText(fitTextEllipsis(ctx, xLabel, maxX), (rect.left + rect.right) / 2, xY);

  if (yLabel) {
    ctx.save();
    // Vertically center on the plot; horizontally mid-left gutter, but always
    // left of ~7-char tick labels (narrow phone / capture layouts have slim pads).
    const gx = Math.max(fontSize * 0.75 + 2, Math.min(rect.left * 0.38, rect.left - 10, rect.left - 46));
    const gy = (rect.top + rect.bottom) / 2;
    ctx.translate(gx, gy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(fitTextEllipsis(ctx, yLabel, maxY), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Extra top margin (px) a title needs to wrap onto a second line above its
 * subtitle at this pad — 0 when it fits on one line (or the layout never wraps).
 */
export function chartTitleWrapPx(
  ctx: CanvasRenderingContext2D,
  w: number,
  pad: number,
  title: string,
  subtitle: string | undefined,
  opts: { titleLayout?: string; fontFamily?: string; titleFontWeight?: number; titleItalic?: boolean; axisFontSize?: number },
): number {
  const layout = opts.titleLayout ?? "pair";
  if (!subtitle || layout === "ticket" || layout === "slab") return 0;
  const ramp = chartTypeRamp(opts.axisFontSize);
  const size =
    layout === "stack" || layout === "spine" ? Math.max(12, ramp.title - 1)
      : layout === "caption" ? Math.max(12, ramp.title - 2)
        : ramp.title;
  const sidePad = w < 480 ? Math.min(pad, 16) : pad;
  const maxW = Math.max(0, w - sidePad * 2 - (titlePreferCenter(layout) ? 0 : 8));
  ctx.save();
  ctx.font = chartFont(size, opts.fontFamily ?? "Inter", opts.titleFontWeight ?? 600, opts.titleItalic ? "italic" : "normal");
  const wraps = ctx.measureText(title.replace(/\s+/g, " ").trim()).width > maxW;
  ctx.restore();
  return wraps ? Math.round(ramp.title * 1.15) : 0;
}

export const MIN_WRAPPED_TITLE_HEIGHT = 320;

/** Title / subtitle block — wraps up to 2 lines before ellipsis; sizes from type ramp. */
export function drawChartTitleBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  title: string,
  subtitle: string | undefined,
  opts: {
    titleX?: number;
    titleY?: number;
    titleWidth?: number;
    titleScale?: number;
    /** Internal recursive draw: preserve the exact width of an arranged title. */
    titleInset?: number;
    titleLayout?: string;
    fontFamily?: string;
    titleFontWeight?: number;
    titleItalic?: boolean;
    themeText?: string;
    themeMuted?: string;
    themeBorder?: string;
    axisLabelColor?: string;
    axisFontSize?: number;
  },
): void {
  if (opts.titleX != null || opts.titleY != null || opts.titleWidth != null || opts.titleScale != null) {
    const r = titleArrangementRect(w, h, pad, opts);
    const scale = opts.titleScale ?? 1;
    ctx.save();
    ctx.translate(r.x - pad * scale, r.y - 4 * scale);
    ctx.scale(scale, scale);
    drawChartTitleBlock(ctx, r.w / scale + 2 * pad, h / scale, pad, title, subtitle, { ...opts, titleInset: pad, titleX: undefined, titleY: undefined, titleWidth: undefined, titleScale: undefined });
    ctx.restore();
    return;
  }
  const layout = opts.titleLayout ?? "pair";
  const pos = titlePositions(pad, layout);
  const fontFamily = opts.fontFamily ?? "Inter";
  const titleWeight = opts.titleFontWeight ?? 600;
  const titleStyle = opts.titleItalic ? "italic" : "normal";
  const text = opts.themeText ?? CHART_TEXT_FALLBACK;
  const muted = opts.axisLabelColor ?? opts.themeMuted ?? CHART_LABEL_FALLBACK;
  const center = titlePreferCenter(layout);
  // Narrow charts need the full heading band, rather than the axis gutters.
  const sidePad = opts.titleInset ?? (w < 480 ? Math.min(pad, 16) : pad);
  const maxW = Math.max(0, layout === "ticket" ? Math.min(280, w - sidePad * 2) - 16 : w - sidePad * 2 - (center ? 0 : 8));
  const ramp = chartTypeRamp(opts.axisFontSize);
  const lineGap = Math.round(ramp.title * 1.15);
  const titleLines = h < MIN_WRAPPED_TITLE_HEIGHT ? 1 : 2;

  const paintWrapped = (
    value: string,
    x: number,
    y: number,
    size: number,
    weight: number | string,
    style: "normal" | "italic",
    fill: string,
    align: CanvasTextAlign,
    maxLines: number,
  ) => {
    ctx.font = chartFont(size, fontFamily, weight, style);
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    const lines = fitTextWrap(ctx, value, maxW, maxLines);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, x, y + i * lineGap * (size / ramp.title));
    }
  };

  /**
   * Title + subtitle pair: a title that wraps pushes the subtitle down a line
   * (lifting the title into the top inset first). When the band can't fit
   * both, the title stays on one line with an ellipsis instead of overlapping.
   */
  const paintTitlePair = (
    x: number,
    size: number,
    align: CanvasTextAlign,
    paintSubtitle: (y: number) => void,
  ) => {
    let titleY = pos.titleY;
    let subY = pos.subtitleY;
    let maxLines = titleLines;
    if (subtitle && titleLines > 1) {
      ctx.font = chartFont(size, fontFamily, titleWeight, titleStyle);
      if (fitTextWrap(ctx, title, maxW, 2).length > 1) {
        const gap = lineGap * (size / ramp.title);
        const lift = Math.max(0, Math.min(gap / 2, titleY - (size + 4)));
        if (subY + gap - lift <= pad - 6) {
          titleY -= lift;
          subY += gap - lift;
        } else {
          maxLines = 1;
        }
      }
    }
    paintWrapped(title, x, titleY, size, titleWeight, titleStyle, text, align, maxLines);
    if (subtitle) paintSubtitle(subY);
  };

  ctx.save();
  ctx.textBaseline = "alphabetic";
  const tx = center ? w / 2 : sidePad;
  const align: CanvasTextAlign = center ? "center" : "left";

  if (layout === "slab") {
    paintWrapped(title, tx, pos.titleY, ramp.titleSlab, titleWeight, titleStyle, text, align, titleLines);
  } else if (layout === "ticket") {
    ctx.fillStyle = opts.themeBorder ?? "#2a2a30";
    const tw = Math.min(280, w - sidePad * 2);
    ctx.strokeRect(sidePad, Math.max(6, pos.titleY - 12), tw, pos.ticketH || 34);
    paintWrapped(title, sidePad + 8, pos.titleY, ramp.titleCompact, titleWeight, titleStyle, text, "left", 1);
    if (subtitle) {
      paintWrapped(subtitle, sidePad + 8, pos.subtitleY, Math.max(10, ramp.subtitle - 1), 400, "normal", muted, "left", 1);
    }
  } else if (layout === "stack" || layout === "spine") {
    let ruleY = pos.subtitleY;
    paintTitlePair(sidePad, Math.max(12, ramp.title - 1), "left", (y) => {
      ruleY = y;
      paintWrapped(subtitle!, sidePad, y, ramp.subtitle, 400, "normal", muted, "left", 1);
    });
    if (layout === "spine") {
      ctx.strokeStyle = text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sidePad, Math.min(pad - 4, ruleY + 8));
      ctx.lineTo(sidePad + 48, Math.min(pad - 4, ruleY + 8));
      ctx.stroke();
    }
  } else if (layout === "caption") {
    paintTitlePair(tx, Math.max(12, ramp.title - 2), align, (y) =>
      paintWrapped(subtitle!, tx, y, ramp.subtitle, 400, "italic", muted, align, 1),
    );
  } else {
    paintTitlePair(tx, ramp.title, align, (y) =>
      paintWrapped(subtitle!, tx, y, ramp.subtitle, 500, "normal", muted, align, 1),
    );
  }
  ctx.restore();
}

/**
 * Vertical band (px from canvas bottom) reserved for source/time footnote +
 * optional color ramp. Scene chrome (cube hints, etc.) must stay above this
 * so lines don’t collide — LOOM footnote / chrome shared reserve.
 */
export function chartFootnoteReservePx(
  text: string | null | undefined,
  opts?: { hasColorRamp?: boolean; pad?: number; axisFontSize?: number },
): number {
  const lines = (text ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean).length;
  const hasRamp = !!opts?.hasColorRamp;
  if (!lines && !hasRamp) return 0;
  const pad = opts?.pad ?? 24;
  const type = chartTypeRamp(opts?.axisFontSize);
  const lineH = type.footnote + 3;
  const n = Math.max(lines, hasRamp ? 1 : 0);
  // rule (~13) + lines + bottom inset (matches drawChartSourceFootnote)
  const bottomInset = Math.max(6, pad * 0.22);
  return Math.ceil(13 + n * lineH + bottomInset + 4);
}

/**
 * Bottom source / time footnote — rides into PNG / share.
 * Supports 1–2 text lines (`\\n`). Optional `colorRamp` draws a glanceable
 * palette strip on the right (replacing a written palette name).
 */
export function drawChartSourceFootnote(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  text: string,
  opts: {
    align?: "left" | "center" | "right";
    fontFamily?: string;
    axisFontSize?: number;
    themeMuted?: string;
    themeBorder?: string;
    /** Palette stops — continuous blends, categorical draws discrete chips. */
    colorRamp?: string[] | null;
    /** Tiny label above the ramp, e.g. `nest: views`. */
    colorRampLabel?: string | null;
    /** When true, blend stops into a gradient; otherwise discrete chips. */
    colorRampContinuous?: boolean;
    /** Footer (default) under the plot, or header under the title band. */
    band?: "footer" | "header";
    /** When band is header, Y of the rule (CSS px from top). */
    headerTop?: number;
  } = {},
): void {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  // Credits can use the full band on a phone; axis gutters only constrain marks.
  if (w < 480) pad = Math.min(pad, 16);
  const ramp = lines.length && w - pad * 2 < 280 ? [] : opts.colorRamp?.filter((c) => typeof c === "string" && c.length > 0) ?? [];
  if (!lines.length && !ramp.length) return;

  const align = opts.align ?? "left";
  const fontFamily = opts.fontFamily ?? "Inter";
  const type = chartTypeRamp(opts.axisFontSize);
  const muted = opts.themeMuted ?? CHART_LABEL_FALLBACK;
  const lineH = type.footnote + 3;
  const rampH = 8;
  const rampW = Math.min(132, Math.max(72, w * 0.22));
  const rampGap = ramp.length ? rampW + 10 : 0;
  const maxW = Math.max(48, w - pad * 2 - rampGap);
  const textLines = Math.max(lines.length, ramp.length ? 1 : 0);
  const band = opts.band ?? "footer";
  const baseY =
    band === "header"
      ? (opts.headerTop ?? Math.max(pad * 0.55, 28)) + (textLines - 1) * lineH + rampH + 4
      : h - Math.max(6, pad * 0.22);
  const topLineY =
    band === "header"
      ? (opts.headerTop ?? Math.max(pad * 0.55, 28))
      : baseY - (textLines - 1) * lineH;

  ctx.save();
  ctx.strokeStyle = opts.themeBorder ?? muted;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (band === "header") {
    ctx.moveTo(pad, topLineY + textLines * lineH + 4);
    ctx.lineTo(w - pad, topLineY + textLines * lineH + 4);
  } else {
    ctx.moveTo(pad, topLineY - 13);
    ctx.lineTo(w - pad, topLineY - 13);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (lines.length) {
    ctx.font = chartFont(type.footnote, fontFamily, 500);
    ctx.fillStyle = muted;
    ctx.textBaseline = band === "header" ? "top" : "bottom";
    ctx.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
    const x =
      align === "center"
        ? pad + maxW / 2
        : align === "right"
          ? w - pad - rampGap
          : pad;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(fitTextEllipsis(ctx, lines[i]!, maxW), x, topLineY + i * lineH);
    }
  }

  if (ramp.length) {
    const rx = w - pad - rampW;
    const ry =
      band === "header"
        ? topLineY + Math.max(0, lines.length - 1) * lineH + (lines.length ? lineH - rampH : 0)
        : baseY - rampH;
    if (opts.colorRampLabel) {
      ctx.font = chartFont(type.footnoteMeta, fontFamily, 500);
      ctx.fillStyle = muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(fitTextEllipsis(ctx, opts.colorRampLabel, rampW), rx + rampW, ry - 2);
    }
    if (opts.colorRampContinuous !== false && ramp.length >= 2) {
      const grad = ctx.createLinearGradient(rx, 0, rx + rampW, 0);
      ramp.forEach((c, i) => grad.addColorStop(i / (ramp.length - 1), c));
      ctx.fillStyle = grad;
      ctx.beginPath();
      // subtle rounded strip
      const rr = 2;
      ctx.moveTo(rx + rr, ry);
      ctx.arcTo(rx + rampW, ry, rx + rampW, ry + rampH, rr);
      ctx.arcTo(rx + rampW, ry + rampH, rx, ry + rampH, rr);
      ctx.arcTo(rx, ry + rampH, rx, ry, rr);
      ctx.arcTo(rx, ry, rx + rampW, ry, rr);
      ctx.closePath();
      ctx.fill();
    } else {
      const chip = rampW / ramp.length;
      ramp.forEach((c, i) => {
        ctx.fillStyle = c;
        const x0 = rx + i * chip;
        ctx.fillRect(x0, ry, Math.max(1, chip - 0.75), rampH);
      });
    }
  }
  ctx.restore();
}
