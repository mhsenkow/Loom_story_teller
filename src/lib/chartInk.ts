// =================================================================
// Loom — Theme ink + chart keys for the "creative" canvas renderers
// =================================================================
// Odd charts, geo maps, GPU-scene fallbacks and the data cube all draw
// their own chrome. This module gives them one way to resolve theme
// colors (falling back to the live <html data-theme> instead of a
// hard-coded near-black), plus shared keys: gradient ramps, swatch
// lists, size keys and the "nothing to draw" message.
// =================================================================

import { getThemeUiColors } from "./chartPalettes";
import { fitTextEllipsis } from "./chartLayout";
import { formatAxisValue, formatDataValue, niceTicks } from "./chartAxes";

export type ChartInk = {
  /** Background used for contrast math (never transparent). */
  bg: string;
  text: string;
  muted: string;
  border: string;
  /** Whether the caller asked for an opaque background fill. */
  paintBg: boolean;
  light: boolean;
};

type InkSource = {
  themeBg?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  axisLabelColor?: string;
};

/** Parse #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() into 0–255 rgb + alpha. */
export function parseColor(c: string | undefined | null): [number, number, number, number] | null {
  if (!c) return null;
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const h = m[1]!;
    return [parseInt(h[0]! + h[0]!, 16), parseInt(h[1]! + h[1]!, 16), parseInt(h[2]! + h[2]!, 16), 1];
  }
  m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
  if (m) {
    return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16), m[4] ? parseInt(m[4], 16) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) {
    const aRaw = m[4];
    const a = aRaw == null ? 1 : aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number.isFinite(a) ? a : 1];
  }
  return null;
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two colors in RGB (t = 0 → a, 1 → b). Returns hex; falls back to `a` if unparseable. */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return a;
  const u = Math.max(0, Math.min(1, t));
  return toHex(pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u);
}

/** Color with a new alpha (any parseable color; unknown strings pass through). */
export function withAlpha(c: string, a: number): string {
  const p = parseColor(c);
  if (!p) return c;
  return `rgba(${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2])},${Math.max(0, Math.min(1, a))})`;
}

export function relativeLuminance(c: string): number {
  const p = parseColor(c);
  if (!p) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
}

/** Black-or-white label ink for text on a fill (WCAG luminance). */
export function inkOn(fill: string): string {
  return relativeLuminance(fill) > 0.4 ? "#141414" : "#ffffff";
}

/** UI colors for whatever theme <html data-theme> currently shows. */
export function documentThemeUi() {
  let theme: string | null = null;
  try {
    if (typeof document !== "undefined") theme = document.documentElement.getAttribute("data-theme");
  } catch {
    /* SSR / worker */
  }
  return getThemeUiColors(theme);
}

/**
 * Resolve chart ink from renderer opts. Missing (or fully transparent)
 * colors fall back to the live document theme so thumbnails rendered
 * without explicit theme opts still match light and dark shells.
 */
export function resolveChartInk(o: InkSource): ChartInk {
  const ui = documentThemeUi();
  const bgParsed = parseColor(o.themeBg);
  const paintBg = !!o.themeBg && (!bgParsed || bgParsed[3] > 0.01);
  const bg = paintBg && bgParsed && bgParsed[3] >= 0.99 ? o.themeBg! : ui.bg;
  const text = o.themeText ?? ui.text;
  const muted = o.axisLabelColor ?? o.themeMuted ?? ui.muted;
  const border = o.themeBorder ?? ui.border;
  return { bg, text, muted, border, paintBg, light: relativeLuminance(bg) > 0.4 };
}

/** A color guaranteed to separate from the background (mix of bg → text). */
export function inkTint(ink: ChartInk, amount: number): string {
  return mixColor(ink.bg, ink.text, amount);
}

export function fontOf(size: number, family = "Inter", weight: number | string = 400): string {
  return `${weight} ${size}px '${family}', sans-serif`;
}

// ---------------------------------------------------------------
// Sequential ramps
// ---------------------------------------------------------------

/** Default sequential ramps when a renderer gets no continuous stops. Low end stays visible on the bg. */
const SEQ_ON_DARK = ["#1d4f73", "#2a7fa8", "#46b3b5", "#9ad7a4", "#f2f0a1"];
const SEQ_ON_LIGHT = ["#c9e3f2", "#7fb8d9", "#3b88bf", "#1d5a96", "#0d2f63"];

export function defaultSequentialStops(ink: ChartInk): string[] {
  return ink.light ? SEQ_ON_LIGHT : SEQ_ON_DARK;
}

/** Interpolated color along stops (hex or rgb() stops). */
export function rampColor(stops: string[], t: number): string {
  if (stops.length === 0) return "#888888";
  if (stops.length === 1) return stops[0]!;
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  return mixColor(stops[i]!, stops[i + 1]!, u - i);
}

/** True when luminance moves one way along the stops (a sequential ramp, not a categorical palette). */
function isMonotonicRamp(stops: string[]): boolean {
  const L = stops.map(relativeLuminance);
  let up = 0;
  let down = 0;
  for (let i = 1; i < L.length; i++) {
    const d = L[i]! - L[i - 1]!;
    if (d > 0.004) up++;
    else if (d < -0.004) down++;
  }
  const spread = Math.max(...L) - Math.min(...L);
  return spread > 0.08 && (up === 0 || down === 0);
}

/**
 * Pick usable sequential stops for a magnitude / density ramp: the first
 * candidate that is a real ramp (≥2 parseable stops with monotonic
 * lightness — categorical palettes passed as "continuous" are skipped),
 * else a theme-tuned default. The result always runs from the end that
 * blends into the background (low) toward the end that contrasts with it
 * (high), so the densest / largest values pop in light AND dark themes.
 */
export function sequentialStops(ink: ChartInk, ...candidates: (string[] | undefined | null)[]): string[] {
  let stops = defaultSequentialStops(ink);
  for (const c of candidates) {
    if (c && c.length >= 2 && c.every((s) => parseColor(s)) && isMonotonicRamp(c)) {
      stops = c;
      break;
    }
  }
  const bgL = relativeLuminance(ink.bg);
  const first = Math.abs(relativeLuminance(stops[0]!) - bgL);
  const last = Math.abs(relativeLuminance(stops[stops.length - 1]!) - bgL);
  return first > last ? [...stops].reverse() : stops;
}

// ---------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------

export function drawEmptyMessage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  message: string,
  ink: ChartInk,
  fontFamily = "Inter",
  mini = false,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink.muted;
  ctx.font = fontOf(mini ? 10 : 12, fontFamily);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fitTextEllipsis(ctx, message, Math.max(40, w - 24)), w / 2, h / 2);
  ctx.restore();
}

// ---------------------------------------------------------------
// Keys
// ---------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Translucent theme panel behind a key so it reads over marks. */
export function drawKeyPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ink: ChartInk): void {
  ctx.save();
  ctx.globalAlpha = 0.86;
  ctx.fillStyle = ink.bg;
  roundRectPath(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = withAlpha(ink.border, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export type RampKeyArgs = {
  /** Anchor corner (top-left of the key box). */
  x: number;
  y: number;
  width: number;
  min: number;
  max: number;
  colorAt: (t: number) => string;
  title?: string;
  ink: ChartInk;
  fontFamily?: string;
  /** Panel behind the key (for keys floating over marks). */
  panel?: boolean;
  /** Override tick labels (e.g. ["low", "high"]). */
  endLabels?: [string, string];
};

/** Height a ramp key occupies (for layout before drawing). */
export function rampKeyHeight(hasTitle: boolean, panel = false): number {
  return (hasTitle ? 14 : 0) + 8 + 14 + (panel ? 12 : 0);
}

/**
 * Horizontal gradient bar with round tick values (or min/max) underneath.
 * Returns the box it drew in.
 */
export function drawRampKey(ctx: CanvasRenderingContext2D, a: RampKeyArgs): { x: number; y: number; w: number; h: number } {
  const font = a.fontFamily ?? "Inter";
  const padIn = a.panel ? 6 : 0;
  const boxH = rampKeyHeight(!!a.title, a.panel);
  const barW = Math.max(40, a.width - padIn * 2);
  const bx = a.x + padIn;
  let cy = a.y + padIn;
  ctx.save();
  if (a.panel) drawKeyPanel(ctx, a.x, a.y, a.width, boxH, a.ink);
  ctx.textBaseline = "alphabetic";
  if (a.title) {
    ctx.font = fontOf(10, font, 600);
    ctx.fillStyle = a.ink.text;
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, a.title, barW), bx, cy + 10);
    cy += 14;
  }
  const steps = 32;
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = a.colorAt(i / (steps - 1));
    ctx.fillRect(bx + (barW * i) / steps, cy, barW / steps + 0.6, 8);
  }
  ctx.strokeStyle = withAlpha(a.ink.border, 0.9);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, cy + 0.5, barW - 1, 7);
  cy += 8;

  ctx.font = fontOf(10, font);
  ctx.fillStyle = a.ink.muted;
  ctx.textBaseline = "top";
  const ly = cy + 3;
  if (a.endLabels) {
    ctx.textAlign = "left";
    ctx.fillText(a.endLabels[0], bx, ly);
    ctx.textAlign = "right";
    ctx.fillText(a.endLabels[1], bx + barW, ly);
  } else if (!(a.max > a.min)) {
    ctx.textAlign = "left";
    ctx.fillText(formatDataValue(a.min), bx, ly);
  } else {
    const nt = niceTicks(a.min, a.max, Math.max(2, Math.min(4, Math.floor(barW / 40))), false);
    const ticks = nt.ticks.filter((v) => v >= a.min - 1e-9 && v <= a.max + 1e-9);
    if (ticks.length >= 2) {
      let lastRight = -Infinity;
      for (const v of ticks) {
        const label = formatAxisValue(v, nt.step);
        const tw = ctx.measureText(label).width;
        const px = bx + ((v - a.min) / (a.max - a.min)) * barW;
        const lx = Math.max(bx + tw / 2, Math.min(bx + barW - tw / 2, px));
        if (lx - tw / 2 < lastRight + 6) continue;
        ctx.textAlign = "center";
        ctx.fillText(label, lx, ly);
        ctx.fillRect(px - 0.5, cy - 2, 1, 3);
        lastRight = lx + tw / 2;
      }
    } else {
      ctx.textAlign = "left";
      ctx.fillText(formatDataValue(a.min), bx, ly);
      ctx.textAlign = "right";
      ctx.fillText(formatDataValue(a.max), bx + barW, ly);
    }
  }
  ctx.restore();
  return { x: a.x, y: a.y, w: a.width, h: boxH };
}

export type SwatchEntry = { label: string; color: string; shape?: "square" | "circle" | "line" };

/**
 * Wrapping row(s) of swatches + labels, left-aligned in [x, x + maxWidth].
 * Returns the height used. With `measureOnly` nothing is painted.
 */
export function drawSwatchRow(
  ctx: CanvasRenderingContext2D,
  entries: SwatchEntry[],
  x: number,
  y: number,
  maxWidth: number,
  ink: ChartInk,
  fontFamily = "Inter",
  opts: { maxRows?: number; measureOnly?: boolean; align?: "left" | "center" } = {},
): number {
  if (entries.length === 0) return 0;
  const lineH = 15;
  const maxRows = opts.maxRows ?? 2;
  const box = 9;
  const gap = 12;
  ctx.save();
  ctx.font = fontOf(10, fontFamily);
  const maxLabel = Math.max(40, Math.min(160, maxWidth - box - 6));
  const items = entries.map((e) => {
    const label = fitTextEllipsis(ctx, e.label, maxLabel);
    return { ...e, label, w: box + 5 + ctx.measureText(label).width };
  });
  const rows: (typeof items)[] = [[]];
  let rowW = 0;
  for (const it of items) {
    const need = (rows[rows.length - 1]!.length ? gap : 0) + it.w;
    if (rowW + need > maxWidth && rows[rows.length - 1]!.length) {
      if (rows.length >= maxRows) break;
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1]!.push(it);
    rowW += (rows[rows.length - 1]!.length > 1 ? gap : 0) + it.w;
  }
  if (!opts.measureOnly) {
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    rows.forEach((row, ri) => {
      const total = row.reduce((s, it, i) => s + it.w + (i ? gap : 0), 0);
      let cx = opts.align === "center" ? x + Math.max(0, (maxWidth - total) / 2) : x;
      const cy = y + ri * lineH + lineH / 2;
      for (const it of row) {
        ctx.fillStyle = it.color;
        ctx.strokeStyle = it.color;
        if (it.shape === "circle") {
          ctx.beginPath();
          ctx.arc(cx + box / 2, cy, box / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (it.shape === "line") {
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + box, cy);
          ctx.stroke();
        } else {
          ctx.fillRect(cx, cy - box / 2, box, box);
        }
        ctx.fillStyle = ink.muted;
        ctx.fillText(it.label, cx + box + 5, cy);
        cx += it.w + gap;
      }
    });
  }
  ctx.restore();
  return rows.length * lineH;
}

/**
 * Compact horizontal size key: three circles at round values with labels.
 * `radiusOf` maps a data value to a pixel radius. Returns the box drawn.
 */
export function drawSizeKey(
  ctx: CanvasRenderingContext2D,
  args: {
    x: number;
    /** Bottom edge of the key box. */
    bottom: number;
    min: number;
    max: number;
    radiusOf: (v: number) => number;
    title?: string;
    ink: ChartInk;
    fontFamily?: string;
    fill?: string;
    panel?: boolean;
    maxWidth?: number;
    /** "right" treats `x` as the key's right edge. */
    anchor?: "left" | "right";
  },
): { x: number; y: number; w: number; h: number } | null {
  const { min, max, ink } = args;
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  const font = args.fontFamily ?? "Inter";
  const nt = niceTicks(min, max, 3, false);
  let vals = nt.ticks.filter((v) => v > 0 || min <= 0);
  if (vals.length > 3) vals = [vals[0]!, vals[Math.floor(vals.length / 2)]!, vals[vals.length - 1]!];
  if (vals.length < 2) vals = [min, max];
  const labels = vals.map((v) => (nt.ticks.includes(v) ? formatAxisValue(v, nt.step) : formatDataValue(v)));
  ctx.save();
  ctx.font = fontOf(10, font);
  const radii = vals.map((v) => Math.max(1.5, args.radiusOf(v)));
  const rMax = Math.max(...radii);
  const titleH = args.title ? 14 : 0;
  const padIn = 6;
  let wSum = padIn;
  const cols = vals.map((_, i) => {
    const cw = Math.max(radii[i]! * 2, ctx.measureText(labels[i]!).width);
    const cx = wSum + cw / 2;
    wSum += cw + 10;
    return cx;
  });
  const boxW = Math.min(args.maxWidth ?? Infinity, Math.max(wSum - 10 + padIn, args.title ? ctx.measureText(args.title).width + padIn * 2 : 0));
  const boxH = padIn + titleH + rMax * 2 + 4 + 12 + padIn - 2;
  const x = args.anchor === "right" ? args.x - boxW : args.x;
  const y = args.bottom - boxH;
  if (args.panel !== false) drawKeyPanel(ctx, x, y, boxW, boxH, ink);
  if (args.title) {
    ctx.font = fontOf(10, font, 600);
    ctx.fillStyle = ink.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(fitTextEllipsis(ctx, args.title, boxW - padIn * 2), x + padIn, y + padIn + 9);
  }
  const baseY = y + padIn + titleH + rMax * 2;
  ctx.font = fontOf(10, font);
  vals.forEach((_, i) => {
    const r = radii[i]!;
    const cx = x + cols[i]!;
    ctx.beginPath();
    ctx.arc(cx, baseY - r, r, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(args.fill ?? ink.muted, 0.35);
    ctx.fill();
    ctx.strokeStyle = args.fill ?? ink.muted;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(labels[i]!, cx, baseY + 3);
  });
  ctx.restore();
  return { x, y, w: boxW, h: boxH };
}

/** Push label centers apart so no two are closer than `gap`, staying within [lo, hi]. */
export function dodgeLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => Math.max(lo, Math.min(hi, o.y)));
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k]!, out[k - 1]! + gap);
  const overflow = (out[out.length - 1] ?? hi) - hi;
  if (overflow > 0) {
    out[out.length - 1] = hi;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k]!, out[k + 1]! - gap);
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]!));
  return res;
}

/** Category → palette index in first-appearance row order (matches ChartView's legend). */
export function categoryIndex(rows: unknown[][], ci: number): Map<string, number> {
  const m = new Map<string, number>();
  if (ci < 0) return m;
  for (const r of rows) {
    const k = String(r[ci]);
    if (!m.has(k)) m.set(k, m.size);
  }
  return m;
}

/**
 * Mark radius from a `pointSize` option. ChartView passes Visual → Point
 * size in UI units (12 = default ≈ the renderer's base radius); thumbnail
 * callers pass a literal radius (≈2–4 px). Values ≥ 6 are treated as UI units.
 */
export function radiusFromPointSize(pointSize: number | undefined, baseRadius: number): number {
  if (pointSize == null || !Number.isFinite(pointSize) || pointSize <= 0) return baseRadius;
  if (pointSize >= 6) return baseRadius * Math.max(0.35, Math.min(2.5, pointSize / 12));
  return pointSize;
}
