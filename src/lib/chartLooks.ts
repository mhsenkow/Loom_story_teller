// =================================================================
// Loom — Chart look chrome (axis frames, backgrounds, grid dialects)
// =================================================================
// Design systems (Tufte, Bauhaus, newspaper, military, …) only ring true
// when axis style + background + grid actually draw differently. These
// helpers are shared by every canvas chart kind.
// =================================================================

import {
  blendToward,
  fitTextEllipsis,
  isLightHex,
  titlePositions,
  titlePreferCenter,
} from "./chartLayout";
import { formatAxisValue, layoutBandLabels, niceTicks } from "./chartAxes";

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
  const { left, right, top, bottom } = plotRect(w, h, pad);

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
  const { left, right, top, bottom } = plotRect(w, h, pad);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = opts?.themeBorder ?? "#1a1a1f";
  ctx.lineWidth = axis === "ladder" ? 0.9 : 0.5;
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 3]);

  const tickFractions = (d: [number, number]) =>
    niceTicks(d[0], d[1], n, false).ticks.map((v) => (v - d[0]) / (d[1] - d[0] || 1));
  const evenFractions = Array.from({ length: n + 1 }, (_, i) => i / n);

  // Newspaper / mercury / tape: horizontal rules only (less chartjunk)
  const horizontalOnly = axis === "mercury" || axis === "tape" || axis === "spine";
  if (domains?.y !== null) {
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
  if (!horizontalOnly && domains?.x !== null) {
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
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const fontSize = Math.max(9, opts?.axisFontSize ?? 10);
  const rotDeg = opts?.tickRotation ?? 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const axis = (opts?.axisStyle ?? "rule") as ChartAxisStyle;
  const { left, right, top, bottom } = plotRect(w, h, pad);
  const stub = axis === "index" || axis === "mercury" ? 5 : axis === "ladder" ? 7 : 4;

  ctx.save();
  ctx.fillStyle = axisLabelColor;
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? axisLabelColor;
  ctx.lineWidth = Math.max(1, (opts?.axisLineWidth ?? 1) * 0.7);
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
  ctx.textBaseline = "alphabetic";

  // X ticks
  if (show.x !== false && Number.isFinite(xMin) && Number.isFinite(xMax)) {
    const xs = niceTicks(xMin, xMax, n, false);
    const span = xMax - xMin || 1;
    ctx.textAlign = "center";
    let lastRight = -Infinity;
    for (const v of xs.ticks) {
      const x = left + ((v - xMin) / span) * (right - left);
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
    const ys = niceTicks(yMin, yMax, n, false);
    const span = yMax - yMin || 1;
    ctx.textAlign = "right";
    for (const v of ys.ticks) {
      const y = bottom - ((v - yMin) / span) * (bottom - top);
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
      ctx.fillText(label, lx, ly);
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
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? "#6b6b78";
  const baseFont = Math.max(9, opts?.axisFontSize ?? 10);
  const { bottom } = plotRect(w, h, pad);
  // Labels live between the baseline and the axis field name near the canvas floor
  const room = Math.max(14, h - bottom - 22);

  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "top";

  if (mode === "ordered") {
    ctx.font = `${baseFont}px '${fontFamily}', sans-serif`;
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
  ctx.font = `${lay.fontSize}px '${fontFamily}', sans-serif`;
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
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? "#6b6b78";
  const fontSize = Math.max(9, Math.min(opts?.axisFontSize ?? 11, bandHeight * 0.6));
  const every = Math.max(1, Math.ceil((fontSize + 2) / Math.max(1, bandHeight)));
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
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
  const { left, right, bottom } = plotRect(w, h, pad);
  const fontFamily = opts?.fontFamily ?? "Inter";
  const fontSize = Math.max(9, opts?.axisFontSize ?? 10);
  ctx.save();
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? "#6b6b78";
  ctx.lineWidth = Math.max(1, (opts?.axisLineWidth ?? 1) * 0.7);
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
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
  ctx.fillStyle = opts?.axisLabelColor ?? opts?.themeMuted ?? "#6b6b78";
  ctx.font = `9px '${fontFamily}', sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(highLabel, x + rampW + 4, y);
  ctx.textBaseline = "bottom";
  ctx.fillText(lowLabel, x + rampW + 4, y + height);
  if (title) {
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, title, 64), x, y - 4);
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
  const fontSize = opts?.axisFontSize ?? 10;
  const color = opts?.axisLabelColor ?? opts?.themeMuted ?? "#6b6b78";
  const maxX = Math.max(40, w - pad * 2);
  const maxY = Math.max(40, h - pad * 2);

  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Sit just above the canvas floor, clear of tick labels
  const xY = h - Math.max(9, Math.min(16, pad * 0.2));
  ctx.fillText(fitTextEllipsis(ctx, xLabel, maxX), w / 2, xY);

  if (yLabel) {
    ctx.save();
    // Vertically center on the plot; horizontally mid-left gutter, but always
    // left of ~7-char tick labels (narrow phone / capture layouts have slim pads).
    const gx = Math.max(fontSize * 0.75 + 2, Math.min(pad * 0.38, pad - 10, pad - 46));
    const gy = pad + (h - 2 * pad) / 2;
    ctx.translate(gx, gy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(fitTextEllipsis(ctx, yLabel, maxY), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Title / subtitle block with centering + ellipsis for pair/slab/caption. */
export function drawChartTitleBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  title: string,
  subtitle: string | undefined,
  opts: {
    titleLayout?: string;
    fontFamily?: string;
    titleFontWeight?: number;
    titleItalic?: boolean;
    themeText?: string;
    themeMuted?: string;
    themeBorder?: string;
    axisLabelColor?: string;
  },
): void {
  void h;
  const layout = opts.titleLayout ?? "pair";
  const pos = titlePositions(pad, layout);
  const fontFamily = opts.fontFamily ?? "Inter";
  const titleWeight = opts.titleFontWeight ?? 600;
  const titleItalic = opts.titleItalic ? "italic" : "normal";
  const text = opts.themeText ?? "#e8e8ec";
  const muted = opts.axisLabelColor ?? opts.themeMuted ?? "#6b6b78";
  const center = titlePreferCenter(layout);
  const maxW = Math.max(48, w - pad * 2 - (center ? 0 : 8));

  ctx.save();
  ctx.fillStyle = text;
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "alphabetic";
  const tx = center ? w / 2 : pad;

  if (layout === "slab") {
    ctx.font = `${titleItalic} ${titleWeight} 17px ${fontFamily}, sans-serif`;
    ctx.fillText(fitTextEllipsis(ctx, title, maxW), tx, pos.titleY);
  } else if (layout === "ticket") {
    ctx.font = `${titleItalic} ${titleWeight} 11px ${fontFamily}, sans-serif`;
    ctx.fillStyle = opts.themeBorder ?? "#2a2a30";
    const tw = Math.min(280, w - pad * 2);
    ctx.strokeRect(pad, Math.max(6, pos.titleY - 12), tw, pos.ticketH || 34);
    ctx.fillStyle = text;
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, title, tw - 16), pad + 8, pos.titleY);
    if (subtitle) {
      ctx.fillStyle = muted;
      ctx.font = `9px ${fontFamily}, sans-serif`;
      ctx.fillText(fitTextEllipsis(ctx, subtitle, tw - 16), pad + 8, pos.subtitleY);
    }
  } else if (layout === "stack" || layout === "spine") {
    ctx.font = `${titleItalic} ${titleWeight} 13px ${fontFamily}, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, title, maxW), pad, pos.titleY);
    if (subtitle) {
      ctx.fillStyle = muted;
      ctx.font = `10px ${fontFamily}, sans-serif`;
      ctx.fillText(fitTextEllipsis(ctx, subtitle, maxW), pad, pos.subtitleY);
    }
    if (layout === "spine") {
      ctx.strokeStyle = text;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pad, Math.min(pad - 4, pos.subtitleY + 8));
      ctx.lineTo(pad + 48, Math.min(pad - 4, pos.subtitleY + 8));
      ctx.stroke();
    }
  } else if (layout === "caption") {
    ctx.font = `${titleItalic} ${titleWeight} 12px ${fontFamily}, sans-serif`;
    ctx.fillText(fitTextEllipsis(ctx, title, maxW), tx, pos.titleY);
    if (subtitle) {
      ctx.fillStyle = muted;
      ctx.font = `italic 10px ${fontFamily}, sans-serif`;
      ctx.fillText(fitTextEllipsis(ctx, subtitle, maxW), tx, pos.subtitleY);
    }
  } else {
    // pair (default) — centered title + subtitle
    ctx.font = `${titleItalic} ${titleWeight} 14px ${fontFamily}, sans-serif`;
    ctx.fillText(fitTextEllipsis(ctx, title, maxW), tx, pos.titleY);
    if (subtitle) {
      ctx.fillStyle = muted;
      ctx.font = `11px ${fontFamily}, sans-serif`;
      ctx.fillText(fitTextEllipsis(ctx, subtitle, maxW), tx, pos.subtitleY);
    }
  }
  ctx.restore();
}

/** Bottom source lineage footnote — rides with the chart into PNG / share. */
/** Bottom source / time footnote — rides into PNG / share. Supports 1–2 lines (`\\n`). */
export function drawChartSourceFootnote(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  text: string,
  opts: {
    align?: "left" | "center" | "right";
    fontFamily?: string;
    themeMuted?: string;
    themeBorder?: string;
  } = {},
): void {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!lines.length) return;
  const align = opts.align ?? "left";
  const fontFamily = opts.fontFamily ?? "Inter";
  const muted = opts.themeMuted ?? "#9e9eac";
  const maxW = Math.max(48, w - pad * 2);
  const lineH = 13;
  const baseY = h - Math.max(6, pad * 0.22);
  const topLineY = baseY - (lines.length - 1) * lineH;
  ctx.save();
  ctx.font = `500 11px ${fontFamily}, sans-serif`;
  ctx.fillStyle = muted;
  ctx.textBaseline = "bottom";
  ctx.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  const x = align === "center" ? w / 2 : align === "right" ? w - pad : pad;
  ctx.strokeStyle = opts.themeBorder ?? muted;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, topLineY - 13);
  ctx.lineTo(w - pad, topLineY - 13);
  ctx.stroke();
  ctx.globalAlpha = 1;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(fitTextEllipsis(ctx, lines[i]!, maxW), x, topLineY + i * lineH);
  }
  ctx.restore();
}
