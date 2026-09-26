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
  pad: number,
  opts?: ChartLookOpts,
): void {
  const style = (opts?.axisStyle ?? "rule") as ChartAxisStyle;
  const color = opts?.axisLineColor ?? opts?.themeBorder ?? "#2a2a30";
  const lw = opts?.axisLineWidth ?? 1;
  const left = pad;
  const right = w - pad;
  const top = pad;
  const bottom = h - pad;

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

/** Grid dialect tied to design system — horizontal-only for newspaper/Tufte soft. */
export function drawChartGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  opts?: ChartLookOpts,
): void {
  if (opts?.showGrid === false) return;
  const style = opts?.gridStyle ?? "solid";
  if (style === "none") return;
  const axis = opts?.axisStyle ?? "rule";
  const n = Math.max(2, opts?.tickCount ?? 5);
  const alpha = opts?.gridOpacity ?? 0.5;
  const left = pad;
  const right = w - pad;
  const top = pad;
  const bottom = h - pad;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = opts?.themeBorder ?? "#1a1a1f";
  ctx.lineWidth = axis === "ladder" ? 0.9 : 0.5;
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 3]);

  // Newspaper / mercury / tape: horizontal rules only (less chartjunk)
  const horizontalOnly = axis === "mercury" || axis === "tape" || axis === "spine";
  for (let i = 0; i <= n; i++) {
    const y = top + (i / n) * (bottom - top);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  if (!horizontalOnly) {
    for (let i = 0; i <= n; i++) {
      const x = left + (i / n) * (right - left);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Tick labels + stub marks — density/placement depends on axisStyle. */
export function drawChartTicks(
  ctx: CanvasRenderingContext2D,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartLookOpts,
): void {
  const n = Math.max(2, opts?.tickCount ?? 5);
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const fontSize = opts?.axisFontSize ?? 9;
  const rotDeg = opts?.tickRotation ?? 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const axis = (opts?.axisStyle ?? "rule") as ChartAxisStyle;
  const left = pad;
  const right = w - pad;
  const top = pad;
  const bottom = h - pad;
  const stub = axis === "index" || axis === "mercury" ? 5 : axis === "ladder" ? 7 : 4;

  ctx.save();
  ctx.fillStyle = axisLabelColor;
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? axisLabelColor;
  ctx.lineWidth = Math.max(1, (opts?.axisLineWidth ?? 1) * 0.7);
  ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;

  // X ticks
  ctx.textAlign = "center";
  for (let i = 0; i <= n; i++) {
    const v = xMin + (i / n) * (xMax - xMin);
    const x = left + (i / n) * (right - left);
    // stub upward from baseline
    if (axis !== "spine") {
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + (axis === "mercury" ? stub + 1 : stub));
      ctx.stroke();
    }
    const labelY = Math.min(h - 4, bottom + stub + fontSize + 2);
    const label = formatTick(v);
    if (rotDeg !== 0) {
      ctx.save();
      ctx.translate(x, labelY);
      ctx.rotate(-rotRad);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      // Soft-clamp edge labels so they don't clip the canvas
      const tw = ctx.measureText(label).width;
      const lx = Math.max(tw / 2 + 4, Math.min(w - tw / 2 - 4, x));
      ctx.fillText(label, lx, labelY);
    }
  }

  // Y ticks
  ctx.textAlign = "right";
  for (let i = 0; i <= n; i++) {
    const v = yMin + (i / n) * (yMax - yMin);
    const y = bottom - (i / n) * (bottom - top);
    if (axis !== "mercury") {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left - stub, y);
      ctx.stroke();
    }
    const label = formatTick(v);
    const lx = Math.max(4, left - stub - 4);
    const ly = Math.max(fontSize, Math.min(h - 4, y + fontSize * 0.35));
    ctx.fillText(label, lx, ly);
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
    // Vertically center on the plot; horizontally mid-left gutter
    const gx = Math.max(11, Math.min(pad * 0.38, pad - 10));
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
