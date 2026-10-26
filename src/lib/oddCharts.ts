// =================================================================
// Loom — Odd / Creative Chart Kinds
// =================================================================
// Twenty unconventional canvases: bucket fields, Chernoff faces,
// isometric 3D, beeswarms, chords, flowers, etc. Specs stay portable;
// pixels are always Canvas 2D (same contract as ChartView).
// =================================================================

import type { ColumnInfo } from "./store";
import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import { fitTextEllipsis } from "./chartLayout";
import { formatDateCell } from "./dateFormat";
import {
  aggregateAxisTitle,
  classifyKeys,
  formatAxisValue,
  formatDataValue,
  linear,
  niceTicks,
  timeTicks,
} from "./chartAxes";
import {
  drawAxisFieldLabels,
  drawAxisFrame,
  drawBandAxisX,
  drawBandAxisY,
  drawChartGrid,
  drawChartTicks,
  drawPositionedLabelsX,
  type ChartLookOpts,
  type PlotRect,
} from "./chartLooks";
import {
  categoryIndex,
  dodgeLabels,
  drawEmptyMessage,
  drawKeyPanel,
  drawRampKey,
  drawSizeKey,
  drawSwatchRow,
  inkHighlight,
  inkOn,
  inkShadow,
  inkTint,
  mixColor,
  radiusFromPointSize,
  rampColor,
  rampKeyHeight,
  resolveChartInk,
  sequentialStops,
  withAlpha,
  type ChartInk,
  type SwatchEntry,
} from "./chartInk";

export * from "./oddChartsRec";
import type { OddChartKind, OddRenderOpts } from "./oddChartsRec";
import {
  toNum,
  groupSum,
  agg,
  numColsOf,
  nomColsOf,
  timeColsOf,
  inferType,
  jitter,
  assignWordCloudCompare,
  topGroupsByWeight,
  wordTotalsByGroup,
} from "./oddChartsRec";
import { resolveLayoutDirection } from "./chartSupport";
import { resolveIsoFloorOrient } from "./isoOrient";
import { resolvePyramidScaleMode } from "./pyramidScale";
import { formatDeltaLabel } from "./deltaCompare";
import { chartFont, chartTypeRamp } from "./chartType";
import { type MarkSymbols, drawMarkSymbol, markSymbols } from "./markSymbols";
import type { HitTarget } from "./chartTooltip";


// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------
//
// Every renderer owns its chrome: axis kinds (beeswarm, pyramid, slope, bump,
// stream, horizon, voronoi, isoBars, mosaic, contour) draw their own ticks /
// field names; the rest draw none. Color fields get a key, size fields a size
// key, ramps a labeled gradient. Renderers return a short message when there
// is nothing to draw; renderOddChart paints it centered.

interface OddEnv {
  ink: ChartInk;
  font: string;
  mini: boolean;
  look: ChartLookOpts;
  colors: string[];
  /** Single-series mark color. */
  single: string;
  alpha: number;
  w: number;
  h: number;
  pad: number;
  columns: string[];
  opts: OddRenderOpts;
  symbols: MarkSymbols;
  /** opts.hits length when this render started (per-renderer cap). */
  hitStart: number;
}

function oddFont(env: OddEnv, size: number, weight: number | string = 400): string {
  return chartFont(Math.max(size, chartTypeRamp(env.opts.axisFontSize).mark), env.font, weight);
}

type Renderer = (
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  env: OddEnv,
  xi: number,
  yi: number,
  ci: number,
  si: number,
) => string | void;

export function renderOddChart(
  kind: OddChartKind,
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columns: string[],
  xi: number,
  yi: number,
  ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini = false,
): void {
  const fn = RENDERERS[kind];
  if (!fn) return;
  const ink = resolveChartInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const colors = opts.colors?.length ? opts.colors : VIZ_CATEGORICAL;
  const env: OddEnv = {
    ink,
    font,
    mini,
    colors,
    single: colors[0]!,
    alpha: opts.opacity ?? 0.85,
    w,
    h,
    pad,
    columns,
    opts,
    symbols: markSymbols(opts, columns, rows),
    hitStart: opts.hits?.length ?? 0,
    look: {
      fontFamily: font,
      axisLabelColor: ink.muted,
      themeMuted: ink.muted,
      themeText: ink.text,
      themeBorder: ink.border,
      axisLineColor: inkTint(ink, 0.38),
      axisFontSize: chartTypeRamp(opts.axisFontSize).tick,
      tickRotation: opts.tickRotation,
    },
  };
  ctx.save();
  let message: string | void;
  try {
    message = fn(ctx, rows, env, xi, yi, ci, si);
  } finally {
    ctx.restore();
  }
  if (message) drawEmptyMessage(ctx, w, h, message, ink, font, mini, opts.axisFontSize);
}

/** Per-renderer cap so dense kinds stay cheap to hit-test. */
const ODD_HIT_CAP = 2000;

type OddSummary = NonNullable<HitTarget["summary"]>;

function canHit(env: OddEnv): HitTarget[] | null {
  const hits = env.opts.hits;
  if (!hits || hits.length - env.hitStart >= ODD_HIT_CAP) return null;
  return hits;
}

function hitCircle(
  env: OddEnv,
  cx: number,
  cy: number,
  r: number,
  match: [number, string][],
  rowIndex?: number,
  summary?: OddSummary,
): void {
  const hits = canHit(env);
  if (!hits || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
  // Keep the focus ring on-canvas for marks hugging the edge (stream ends, mini cards).
  const fit = Math.min(r, cx, env.w - cx, cy, env.h - cy);
  hits.push({ shape: "circle", cx, cy, r: Math.max(1, fit), match, rowIndex, summary });
}

function hitRect(
  env: OddEnv,
  x: number,
  y: number,
  w: number,
  h: number,
  match: [number, string][],
  rowIndex?: number,
  summary?: OddSummary,
  markRect?: { x: number; y: number; w: number; h: number },
): void {
  const hits = canHit(env);
  if (!hits || !(w > 0) || !(h > 0)) return;
  hits.push({ shape: "rect", x, y, w, h, match, rowIndex, summary, mark: markRect });
}

function hitArc(
  env: OddEnv,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  match: [number, string][],
  rowIndex?: number,
  summary?: OddSummary,
): void {
  const hits = canHit(env);
  if (!hits) return;
  hits.push({ shape: "arc", cx, cy, r0, r1, a0, a1, match, rowIndex, summary });
}

/** Row matching for a single drawn point: x, then color when present. */
function rowMatch(row: readonly unknown[], xi: number, ci: number): [number, string][] {
  const m: [number, string][] = [];
  if (xi >= 0) m.push([xi, String(row[xi] ?? "")]);
  if (ci >= 0 && ci !== xi) m.push([ci, String(row[ci] ?? "")]);
  return m;
}

/** Summary for a small-multiple glyph (group label + mean per feature). */
function groupSummary(env: OddEnv, xi: number, label: string, feats: number[], raw: number[]): OddSummary {
  return {
    columns: [fieldName(env, xi, "group"), ...feats.map((fi) => fieldName(env, fi))],
    row: [label, ...raw.map((v) => (Number.isFinite(v) ? v : null))],
  };
}

function firstRowIndex(rows: unknown[][], xi: number, key: string): number | undefined {
  const i = rows.findIndex((r) => String(r[xi] ?? "") === key);
  return i >= 0 ? i : undefined;
}

const RENDERERS: Record<OddChartKind, Renderer> = {
  bucketField: drawBucketField,
  beeswarm: drawBeeswarm,
  chernoff: drawChernoff,
  glyphStar: drawGlyphStar,
  waffle: drawWaffle,
  isotype: drawIsotype,
  pyramid: drawPyramid,
  slope: drawSlope,
  bump: drawBump,
  stream: drawStream,
  horizon: drawHorizon,
  spiral: drawSpiral,
  radialBar: drawRadialBar,
  chord: drawChord,
  voronoi: drawVoronoi,
  isoBars: drawIsoBars,
  isoScatter: drawIsoScatter,
  flower: drawFlower,
  mosaic: drawMosaic,
  contour: drawContour,
  calendar: drawCalendar,
  rose: drawRose,
  ecdf: drawEcdf,
  sparkGrid: drawSparkGrid,
  density: drawDensity,
  qq: drawQq,
  connectedScatter: drawConnectedScatter,
  stripes: drawStripes,
  wordCloud: drawWordCloud,
  errorBars: drawErrorBars,
};

// ---- shared helpers --------------------------------------------------------

function fieldName(env: OddEnv, i: number, fallback = ""): string {
  return i >= 0 ? (env.columns[i] ?? fallback) : fallback;
}

/** Plot rect inside the pad (thumbnails use the whole card). */
function basePlot(env: OddEnv): PlotRect {
  return { left: env.pad, top: env.pad, right: env.w - env.pad, bottom: env.h - env.pad };
}

function gridLook(env: OddEnv): ChartLookOpts {
  return { ...env.look, themeBorder: inkTint(env.ink, env.ink.light ? 0.12 : 0.14), gridOpacity: 1 };
}

function numericColumn(rows: unknown[][], i: number): boolean {
  if (i < 0) return false;
  let seen = 0;
  let ok = 0;
  for (const r of rows) {
    const v = r[i];
    if (v == null || v === "") continue;
    seen++;
    if (Number.isFinite(toNum(v))) ok++;
    if (seen >= 60) break;
  }
  return seen > 0 && ok / seen >= 0.8;
}

/** Numeric feature columns: preferred encodings first, then other numeric columns (≤ max). */
function featureColumns(rows: unknown[][], env: OddEnv, xi: number, prefer: number[], max = 6): number[] {
  const out: number[] = [];
  for (const i of prefer) if (i >= 0 && i !== xi && !out.includes(i) && numericColumn(rows, i)) out.push(i);
  for (let i = 0; i < env.columns.length && out.length < max; i++) {
    if (i !== xi && !out.includes(i) && numericColumn(rows, i)) out.push(i);
  }
  return out.slice(0, max);
}

/** Group means per feature, then min–max normalize each feature on its own scale. */
function groupFeatureMatrix(
  rows: unknown[][],
  xi: number,
  feats: number[],
  maxGroups: number,
): { labels: string[]; raw: number[][]; norm: number[][] } {
  const groups = new Map<string, unknown[][]>();
  for (const r of rows) {
    const k = String(r[xi] ?? "");
    let g = groups.get(k);
    if (!g) {
      if (groups.size >= maxGroups) continue;
      g = [];
      groups.set(k, g);
    }
    g.push(r);
  }
  const labels = [...groups.keys()];
  const raw = labels.map((k) =>
    feats.map((fi) => {
      const vs = groups.get(k)!.map((r) => toNum(r[fi])).filter(Number.isFinite);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN;
    }),
  );
  const norm = raw.map((row) => row.slice());
  feats.forEach((_, f) => {
    const col = raw.map((r) => r[f]!).filter(Number.isFinite);
    const lo = Math.min(...col);
    const hi = Math.max(...col);
    for (const row of norm) {
      const v = row[f]!;
      row[f] = !Number.isFinite(v) ? 0.5 : hi > lo ? (v - lo) / (hi - lo) : 0.5;
    }
  });
  return { labels, raw, norm };
}

/** Grid of small multiples sized to the plot's aspect, with a label strip under each cell. */
function multiplesGrid(n: number, plot: PlotRect): { cols: number; rows: number; cw: number; ch: number } {
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * pw) / Math.max(1, ph))) || 1));
  const rows = Math.ceil(n / cols);
  return { cols, rows, cw: pw / cols, ch: ph / rows };
}

function legendEntriesFor(rows: unknown[][], ci: number, colors: string[]): SwatchEntry[] {
  return [...categoryIndex(rows, ci).entries()].map(([label, i]) => ({ label, color: colors[i % colors.length]! }));
}

/** Symbol key when marks vary by a shape / emoji column, else the color key. */
function markLegendEntries(rows: unknown[][], env: OddEnv, ci: number): { entries: SwatchEntry[]; title: string | undefined } | null {
  const catIdx = categoryIndex(rows, ci);
  const colorOf = (row: readonly unknown[]) =>
    ci >= 0 ? env.colors[(catIdx.get(String(row[ci])) ?? 0) % env.colors.length]! : env.single;
  const symbolic = env.symbols.legend(colorOf);
  if (symbolic) {
    return {
      entries: symbolic.map((e) => ({ label: e.label, color: e.color, glyph: e.glyph, mark: e.shape })),
      title: env.opts.emojiField ?? env.opts.shapeField ?? undefined,
    };
  }
  return ci >= 0 ? { entries: legendEntriesFor(rows, ci, env.colors), title: fieldName(env, ci) } : null;
}

/** A point mark: the encoded symbol when marks are customized, else a dot. */
function mark(ctx: CanvasRenderingContext2D, env: OddEnv, row: readonly unknown[] | undefined, x: number, y: number, r: number, fill: string, alpha: number, halo: string | null) {
  if (!env.symbols.active) {
    dot(ctx, x, y, r, fill, alpha, halo);
    return;
  }
  const symbol = env.symbols.of(row);
  drawMarkSymbol(ctx, symbol, x, y, symbol.glyph ? Math.max(r * 1.4, 4.5) : r * 1.15, fill, symbol.glyph ? 1 : alpha, halo);
}

/** Vertical legend in a translucent panel at a plot corner. */
function drawPanelLegend(
  ctx: CanvasRenderingContext2D,
  env: OddEnv,
  entries: SwatchEntry[],
  title: string | undefined,
  plot: PlotRect,
  corner: "top-right" | "top-left" | "bottom-right" | "bottom-left" = "top-right",
): { x: number; y: number; w: number; h: number } | null {
  if (env.mini || entries.length === 0 || env.opts.legendPosition === "none") return null;
  // Visual → Legend corner overrides the renderer's preferred corner.
  const lp = env.opts.legendPosition;
  if (lp === "top-right" || lp === "top-left" || lp === "bottom-right" || lp === "bottom-left") corner = lp;
  const maxRows = entries.length <= 12 ? entries.length : 8;
  const shown = entries.slice(0, maxRows);
  const extra = entries.length - shown.length;
  const lineH = chartTypeRamp(env.opts.axisFontSize).legend + 6;
  ctx.save();
  ctx.font = oddFont(env, 10);
  const maxText = Math.min(150, Math.max(60, (plot.right - plot.left) * 0.32));
  let textW = Math.max(...shown.map((e) => ctx.measureText(e.label).width), extra > 0 ? ctx.measureText(`+${extra} more`).width : 0);
  if (title) {
    ctx.font = oddFont(env, 10, 600);
    textW = Math.max(textW, ctx.measureText(title).width);
  }
  textW = Math.min(maxText, textW);
  const bw = Math.ceil(8 + 9 + 6 + textW + 8);
  const bh = (shown.length + (extra > 0 ? 1 : 0) + (title ? 1 : 0)) * lineH + 8;
  const x = corner.endsWith("right") ? plot.right - bw - 6 : plot.left + 6;
  const y = corner.startsWith("top") ? plot.top + 6 : plot.bottom - bh - 6;
  drawKeyPanel(ctx, x, y, bw, bh, env.ink);
  let cy = y + 4 + lineH / 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if (title) {
    ctx.font = oddFont(env, 10, 600);
    ctx.fillStyle = env.ink.text;
    ctx.fillText(fitTextEllipsis(ctx, title, bw - 16), x + 8, cy);
    cy += lineH;
  }
  ctx.font = oddFont(env, 10);
  for (const e of shown) {
    ctx.fillStyle = e.color;
    if (e.glyph || e.mark) {
      drawMarkSymbol(ctx, { glyph: e.glyph ?? null, shape: e.mark ?? "circle" }, x + 12.5, cy, 4.5, e.color, 1);
      ctx.font = oddFont(env, 10);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
    } else if (e.shape === "line") ctx.fillRect(x + 8, cy - 1.5, 9, 3);
    else ctx.fillRect(x + 8, cy - 4.5, 9, 9);
    ctx.fillStyle = env.ink.muted;
    ctx.fillText(fitTextEllipsis(ctx, e.label, textW), x + 23, cy);
    cy += lineH;
  }
  if (extra > 0) {
    ctx.fillStyle = env.ink.muted;
    ctx.fillText(`+${extra} more`, x + 23, cy);
  }
  ctx.restore();
  return { x, y, w: bw, h: bh };
}

type FooterSpec = {
  swatches?: SwatchEntry[];
  size?: { min: number; max: number; radiusOf: (v: number) => number; title?: string; fill?: string };
  ramp?: { min: number; max: number; colorAt: (t: number) => string; title?: string; endLabels?: [string, string] };
  caption?: string;
};

/**
 * Keys under a non-axis chart: size key, ramp and swatches side by side,
 * caption below. `height` is what to reserve; `draw(top)` paints.
 */
function layoutFooter(ctx: CanvasRenderingContext2D, env: OddEnv, spec: FooterSpec): { height: number; draw: (top: number) => void } {
  if (env.mini) return { height: 0, draw: () => {} };
  // Legend → None hides keys; the caption still explains the encoding.
  if (env.opts.legendPosition === "none") spec = { caption: spec.caption };
  const left = env.pad * 0.5 + 4;
  const maxW = env.w - 2 * left;
  const sizeH = spec.size ? 6 + (spec.size.title ? 14 : 0) + Math.max(3, spec.size.radiusOf(spec.size.max)) * 2 + 4 + 12 + 4 : 0;
  const rampW = spec.ramp ? Math.max(90, Math.min(180, maxW * 0.36)) : 0;
  const rampH = spec.ramp ? rampKeyHeight(!!spec.ramp.title, false, env.opts.axisFontSize) : 0;
  const swW = Math.max(60, maxW - (spec.size ? 130 : 0) - (rampW ? rampW + 16 : 0));
  const swH = spec.swatches?.length ? drawSwatchRow(ctx, spec.swatches, 0, 0, swW, env.ink, env.font, { axisFontSize: env.opts.axisFontSize, measureOnly: true, maxRows: 2 }) : 0;
  let capLines: string[] = [];
  if (spec.caption) {
    ctx.save();
    ctx.font = oddFont(env, 10);
    capLines = wrapText(ctx, spec.caption, maxW, 2);
    ctx.restore();
  }
  const blockH = Math.max(sizeH, rampH, swH);
  const height = blockH + (capLines.length ? capLines.length * 13 + (blockH ? 4 : 0) : 0);
  const draw = (top: number) => {
    let x = left;
    if (spec.size) {
      const box = drawSizeKey(ctx, {
        x,
        bottom: top + sizeH,
        min: spec.size.min,
        max: spec.size.max,
        radiusOf: spec.size.radiusOf,
        title: spec.size.title,
        ink: env.ink,
        axisFontSize: env.opts.axisFontSize, fontFamily: env.font,
        fill: spec.size.fill,
        panel: false,
        maxWidth: 160,
      });
      if (box) x += box.w + 16;
    }
    if (spec.ramp) {
      drawRampKey(ctx, { x, y: top, width: rampW, min: spec.ramp.min, max: spec.ramp.max, colorAt: spec.ramp.colorAt, title: spec.ramp.title, endLabels: spec.ramp.endLabels, ink: env.ink, axisFontSize: env.opts.axisFontSize, fontFamily: env.font });
      x += rampW + 16;
    }
    if (spec.swatches?.length) {
      drawSwatchRow(ctx, spec.swatches, x, top, Math.max(60, env.w - left - x), env.ink, env.font, { axisFontSize: env.opts.axisFontSize, maxRows: 2 });
    }
    if (capLines.length) {
      ctx.save();
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = env.ink.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      capLines.forEach((line, i) => ctx.fillText(line, left, top + blockH + (blockH ? 4 : 0) + i * 13));
      ctx.restore();
    }
  };
  return { height, draw };
}

/** Plot for a non-axis chart with a footer reserved under it. */
function plotAboveFooter(env: OddEnv, footerH: number): { plot: PlotRect; footerTop: number } {
  const base = basePlot(env);
  if (!footerH) return { plot: base, footerTop: env.h };
  const bottom = Math.min(base.bottom, env.h - 6 - footerH - 8);
  return { plot: { ...base, bottom: Math.max(base.top + 40, bottom) }, footerTop: env.h - 6 - footerH };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW || !cur) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = word;
    if (lines.length === maxLines - 1) break;
  }
  const consumed = lines.join(" ").split(" ").filter(Boolean).length;
  const rest = words.slice(consumed).join(" ");
  if (rest) lines.push(fitTextEllipsis(ctx, rest, maxW));
  return lines.slice(0, maxLines);
}

/** Area-true radius scale for a size column (null when missing / constant). */
function sizeScaleOf(rows: unknown[][], si: number, rMin: number, rMax: number, invert = false) {
  if (si < 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    const v = toNum(r[si]);
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return null;
  const zeroBased = lo >= 0;
  const radiusOf = (v: number) => {
    if (!Number.isFinite(v)) return rMin;
    const raw = zeroBased ? Math.max(0, v) / hi : (v - lo) / (hi - lo);
    const t = invert ? 1 - Math.max(0, Math.min(1, raw)) : Math.max(0, Math.min(1, raw));
    return Math.max(rMin, rMax * Math.sqrt(t));
  };
  return { min: lo, max: hi, radiusOf };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, alpha: number, halo: string | null) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  if (halo) {
    ctx.strokeStyle = withAlpha(halo, 0.8);
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }
}

/** Ordered x keys (numbers / dates sorted by value, plain categories in data order). */
type OrderedModel = {
  keys: string[];
  pos: number[];
  kind: "number" | "time" | "band";
  domain: [number, number] | null;
  /** Which key a row lands in (raw value, or its bucket when `bucket` is on). */
  keyOf: (r: unknown[]) => string;
};

/**
 * Ordered X positions. Past `max` distinct values a band axis keeps an even
 * sample; a numeric / time axis either samples too or — with `bucket` — folds
 * every row into `max` equal-width ranges so nothing is dropped (event feeds
 * have a unique timestamp per row, and a sample kept ~1 row in 6).
 */
function orderedKeys(rows: unknown[][], xi: number, max: number, bucket = false): OrderedModel {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!set.has(k)) {
      set.add(k);
      seen.push(k);
    }
  }
  const raw = (r: unknown[]) => String(r[xi]);
  const cls = classifyKeys(seen);
  let keys = cls.kind === "band" ? seen.filter((k) => k !== "null" && k !== "undefined" && k !== "") : cls.sorted;
  let values = cls.kind === "band" ? keys.map((_, i) => i) : cls.values;
  if (bucket && cls.kind !== "band" && keys.length > max) {
    const lo = values[0]!;
    const hi = values[values.length - 1]!;
    const width = (hi - lo) / max || 1;
    const starts = Array.from({ length: max }, (_, i) => lo + i * width);
    const bucketKeys = starts.map((t) => (cls.kind === "time" ? new Date(t).toISOString() : String(t)));
    const valueOf = new Map(cls.sorted.map((k, i) => [k, cls.values[i]!]));
    const keyOf = (r: unknown[]) => {
      const v = valueOf.get(raw(r));
      if (v == null) return "";
      return bucketKeys[Math.min(max - 1, Math.max(0, Math.floor((v - lo) / width)))]!;
    };
    // Only buckets that hold rows, positioned at their centers
    const used = new Set(rows.map(keyOf));
    const kept = bucketKeys.map((k, i) => ({ k, center: starts[i]! + width / 2 })).filter((b) => used.has(b.k));
    return {
      keys: kept.map((b) => b.k),
      pos: kept.map((b) => (b.center - lo) / (hi - lo || 1)),
      kind: cls.kind,
      domain: [lo, hi],
      keyOf,
    };
  }
  if (keys.length > max) {
    // Even sample that keeps the first and last key.
    const idx = Array.from({ length: max }, (_, i) => Math.round((i * (keys.length - 1)) / (max - 1)));
    keys = idx.map((i) => keys[i]!);
    values = idx.map((i) => values[i]!);
  }
  if (cls.kind === "band" || keys.length < 2) {
    const n = Math.max(1, keys.length);
    return { keys, pos: keys.map((_, i) => (n === 1 ? 0.5 : i / (n - 1))), kind: "band", domain: null, keyOf: raw };
  }
  const lo = values[0]!;
  const hi = values[values.length - 1]!;
  return { keys, pos: values.map((v) => (v - lo) / (hi - lo || 1)), kind: cls.kind, domain: [lo, hi], keyOf: raw };
}

function drawOrderedXAxis(
  ctx: CanvasRenderingContext2D,
  env: OddEnv,
  model: OrderedModel,
  plot: PlotRect,
) {
  const pw = plot.right - plot.left;
  if (model.kind === "band" || !model.domain) {
    const centers = model.pos.map((p) => plot.left + p * pw);
    drawBandAxisX(ctx, model.keys, centers, pw / Math.max(1, model.keys.length), env.w, env.h, plot, env.look, "ordered");
    return;
  }
  const [lo, hi] = model.domain;
  const count = Math.max(2, Math.min(7, Math.floor(pw / 70)));
  let items: { x: number; label: string }[];
  if (model.kind === "time") {
    const tt = timeTicks(lo, hi, count);
    items = tt.ticks.map((t) => ({ x: plot.left + ((t - lo) / (hi - lo || 1)) * pw, label: tt.format(t) }));
  } else {
    const nt = niceTicks(lo, hi, count, false);
    items = nt.ticks.map((v) => ({ x: plot.left + ((v - lo) / (hi - lo || 1)) * pw, label: formatAxisValue(v, nt.step) }));
  }
  drawPositionedLabelsX(ctx, items, env.w, env.h, plot, env.look);
}

// ---- bucket field ----------------------------------------------------------

function drawBucketField(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0) return "Choose a category for the buckets";
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const buckets = [...counts.keys()].slice(0, 12);
  if (!buckets.length) return "No rows to place";
  const { mini, ink } = env;
  const catIdx = categoryIndex(rows, ci);
  const yVals = yi >= 0 ? rows.map((r) => toNum(r[yi])).filter(Number.isFinite) : [];
  const ys = yVals.length ? niceTicks(Math.min(...yVals), Math.max(...yVals), 3, true) : null;
  const base = mini ? 2 : radiusFromPointSize(env.opts.pointSize, 3);
  const sScale = sizeScaleOf(rows, si, mini ? 1.2 : 1.8, mini ? 5 : 9, !!env.opts.channelInvert?.size);

  const footer = layoutFooter(ctx, env, {
    size: sScale ? { ...sScale, title: fieldName(env, si), fill: ci >= 0 ? ink.muted : env.single } : undefined,
    swatches: ci >= 0 && ci !== xi ? legendEntriesFor(rows, ci, env.colors) : undefined,
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const gap = mini ? 4 : 10;
  const grid = multiplesGrid(buckets.length, plot);
  const cw = (plot.right - plot.left - gap * (grid.cols - 1)) / grid.cols;
  const ch = (plot.bottom - plot.top - gap * (grid.rows - 1)) / grid.rows;
  const headerH = mini ? 0 : 18;
  const fill = inkTint(ink, ink.light ? 0.05 : 0.06);
  const edge = inkTint(ink, ink.light ? 0.2 : 0.22);
  const total = rows.length;

  buckets.forEach((b, bi) => {
    const col = bi % grid.cols;
    const row = Math.floor(bi / grid.cols);
    const x0 = plot.left + col * (cw + gap);
    const y0 = plot.top + row * (ch + gap);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, y0, cw, ch);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
    if (!mini) {
      ctx.font = oddFont(env, 10);
      const n = formatDataValue(counts.get(b) ?? 0);
      const nW = ctx.measureText(n).width;
      ctx.textBaseline = "middle";
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "right";
      ctx.fillText(n, x0 + cw - 6, y0 + headerH / 2 + 1);
      ctx.font = oddFont(env, 10, 600);
      ctx.fillStyle = ink.text;
      ctx.textAlign = "left";
      ctx.fillText(fitTextEllipsis(ctx, b, Math.max(10, cw - 18 - nW)), x0 + 6, y0 + headerH / 2 + 1);
    }
    const inner = { left: x0 + 8, right: x0 + cw - 8, top: y0 + headerH + 6, bottom: y0 + ch - 6 };
    const ih = inner.bottom - inner.top;
    if (ih < 4) return;
    const ptIdx: number[] = [];
    for (let ri = 0; ri < rows.length && ptIdx.length < (mini ? 40 : 200); ri++) {
      if (String(rows[ri]![xi]) === b) ptIdx.push(ri);
    }
    ptIdx.forEach((ri, i) => {
      const r = rows[ri]!;
      const px = inner.left + jitter(b, i) * (inner.right - inner.left);
      const yv = ys ? toNum(r[yi]) : NaN;
      const py = ys && Number.isFinite(yv)
        ? inner.bottom - ((yv - ys.min) / (ys.max - ys.min || 1)) * ih
        : inner.top + jitter(b, i + 97) * ih;
      const rDot = sScale ? sScale.radiusOf(toNum(r[si])) : base;
      const color = ci >= 0 ? env.colors[(catIdx.get(String(r[ci])) ?? 0) % env.colors.length]! : env.single;
      dot(ctx, px, py, rDot, color, env.alpha, total <= 800 ? ink.bg : null);
      hitCircle(env, px, py, rDot, rowMatch(r, xi, ci), ri);
    });
    // Shared value scale: round min / max ticks beside the first column of regions.
    if (ys && !mini && col === 0 && env.pad >= 28 && ih >= 36) {
      ctx.font = oddFont(env, 9);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatAxisValue(ys.max, ys.step), plot.left - 5, inner.top);
      ctx.fillText(formatAxisValue(ys.min, ys.step), plot.left - 5, inner.bottom);
    }
  });
  if (!mini && ys) drawAxisFieldLabels(ctx, env.w, env.h, env.pad, "", fieldName(env, yi), env.look);
  footer.draw(footerTop);
}

// ---- beeswarm --------------------------------------------------------------

function drawBeeswarm(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0 || yi < 0) return "Beeswarm needs a category and a numeric column";
  const model = orderedKeys(rows, xi, 12);
  const cats = model.keys;
  const vals = rows.map((r) => toNum(r[yi])).filter(Number.isFinite);
  if (!cats.length || !vals.length) return `No numeric values in ${fieldName(env, yi, "y")}`;
  const { mini, ink } = env;
  const ys = niceTicks(Math.min(...vals), Math.max(...vals), 5, true);
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const bandW = pw / cats.length;
  if (!mini) {
    drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: null, y: [ys.min, ys.max] });
    drawAxisFrame(ctx, env.w, env.h, plot, env.look);
    drawChartTicks(ctx, 0, 1, ys.min, ys.max, env.w, env.h, plot, env.look, { x: false });
    drawBandAxisX(ctx, cats, cats.map((_, i) => plot.left + (i + 0.5) * bandW), bandW, env.w, env.h, plot, env.look);
    drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), fieldName(env, yi), env.look);
  }
  const catIdx = categoryIndex(rows, ci);
  const byCat = new Map<string, unknown[][]>();
  const rowIdx = new Map<unknown[], number>();
  rows.forEach((r, ri) => {
    const k = String(r[xi]);
    if (!Number.isFinite(toNum(r[yi]))) return;
    const l = byCat.get(k) ?? [];
    l.push(r);
    byCat.set(k, l);
    rowIdx.set(r, ri);
  });
  const maxN = Math.max(1, ...cats.map((c) => Math.min(mini ? 60 : 250, byCat.get(c)?.length ?? 0)));
  // Shrink dots when a band is crowded so the swarm still fits its column.
  const fit = Math.sqrt((bandW * 0.8 * ph) / (maxN * Math.PI * 1.6));
  const base = Math.max(1.4, Math.min(mini ? 2.2 : radiusFromPointSize(env.opts.pointSize, 3.2), fit));
  const sScale = sizeScaleOf(rows, si, base * 0.6, base * 2.4, !!env.opts.channelInvert?.size);
  const total = rows.length;
  cats.forEach((cat, k) => {
    const cx = plot.left + (k + 0.5) * bandW;
    const list = (byCat.get(cat) ?? [])
      .slice(0, mini ? 60 : 250)
      .sort((a, b) => toNum(a[yi]) - toNum(b[yi]));
    const placed: { x: number; y: number; r: number }[] = [];
    for (const row of list) {
      const v = toNum(row[yi]);
      const py = plot.bottom - ((v - ys.min) / (ys.max - ys.min || 1)) * ph;
      const rr = sScale ? sScale.radiusOf(toNum(row[si])) : base;
      let px = cx;
      for (let tries = 0; tries < 60; tries++) {
        const side = tries % 2 === 0 ? 1 : -1;
        px = cx + side * Math.ceil(tries / 2) * rr * 1.05;
        const hit = placed.some((p) => (p.x - px) ** 2 + (p.y - py) ** 2 < (p.r + rr + 0.4) ** 2);
        if (!hit) break;
      }
      if (Math.abs(px - cx) > bandW * 0.45) px = cx + (jitter(cat, placed.length) - 0.5) * bandW * 0.8;
      placed.push({ x: px, y: py, r: rr });
      const color = ci >= 0 ? env.colors[(catIdx.get(String(row[ci])) ?? 0) % env.colors.length]! : env.single;
      mark(ctx, env, row, px, py, rr, color, env.alpha, total <= 800 ? ink.bg : null);
      hitCircle(env, px, py, rr, [...rowMatch(row, xi, ci), [yi, String(row[yi])]], rowIdx.get(row));
    }
  });
  const swarmKey = markLegendEntries(rows, env, ci !== xi ? ci : -1);
  if (swarmKey) drawPanelLegend(ctx, env, swarmKey.entries, swarmKey.title, plot, "top-right");
  if (sScale && !mini) {
    drawSizeKey(ctx, {
      x: plot.left + 6,
      bottom: plot.top + 6 + 60,
      min: sScale.min,
      max: sScale.max,
      radiusOf: sScale.radiusOf,
      title: fieldName(env, si),
      ink,
      axisFontSize: env.opts.axisFontSize, fontFamily: env.font,
      fill: ci >= 0 ? ink.muted : env.single,
      maxWidth: pw * 0.4,
    });
  }
}

// ---- Chernoff faces / star glyphs / flowers --------------------------------

const FACE_PARTS = ["face width", "face height", "eye spacing", "eye size", "mouth width", "smile"];

function drawChernoff(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0) return "Choose a category for the faces";
  const feats = featureColumns(rows, env, xi, [yi, si, ci]);
  if (!feats.length) return "Chernoff faces need numeric columns";
  const m = groupFeatureMatrix(rows, xi, feats, env.mini ? 6 : 12);
  if (!m.labels.length) return "No rows to draw";
  const { mini, ink } = env;
  const footer = layoutFooter(ctx, env, {
    caption: feats.map((fi, i) => `${FACE_PARTS[i]} = ${fieldName(env, fi)}`).join(" · "),
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const g = multiplesGrid(m.labels.length, plot);
  const labelH = mini ? 0 : 16;
  m.labels.forEach((label, bi) => {
    const f = Array.from({ length: 6 }, (_, i) => m.norm[bi]![i] ?? 0.5);
    const cx = plot.left + (bi % g.cols) * g.cw + g.cw / 2;
    const cellTop = plot.top + Math.floor(bi / g.cols) * g.ch;
    const R = Math.max(4, Math.min(g.cw * 0.34, (g.ch - labelH) * 0.38));
    const cy = cellTop + (g.ch - labelH) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * (0.8 + f[0]! * 0.3), R * (0.85 + f[1]! * 0.25), 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(env.single, 0.3);
    ctx.fill();
    ctx.strokeStyle = ink.text;
    ctx.lineWidth = mini ? 1 : 1.5;
    ctx.stroke();
    const eyeY = cy - R * 0.2;
    const eyeSep = R * (0.22 + f[2]! * 0.22);
    const eyeR = R * (0.07 + f[3]! * 0.09);
    ctx.fillStyle = ink.text;
    ctx.beginPath();
    ctx.arc(cx - eyeSep, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(cx + eyeSep, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const mouthW = R * (0.25 + f[4]! * 0.3);
    const smile = (f[5]! - 0.5) * R * 0.6;
    ctx.moveTo(cx - mouthW, cy + R * 0.38);
    ctx.quadraticCurveTo(cx, cy + R * 0.38 + smile, cx + mouthW, cy + R * 0.38);
    ctx.stroke();
    hitCircle(env, cx, cy, R * Math.max(0.8 + f[0]! * 0.3, 0.85 + f[1]! * 0.25), [[xi, label]], firstRowIndex(rows, xi, label), groupSummary(env, xi, label, feats, m.raw[bi]!));
    if (!mini) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, label, g.cw - 8), cx, Math.min(cy + R * 1.15 + 4, cellTop + g.ch - labelH + 2));
    }
  });
  footer.draw(footerTop);
}

function drawGlyphStar(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0) return "Choose a category for the stars";
  const feats = featureColumns(rows, env, xi, [yi, si, ci]);
  if (feats.length < 3) return "Star glyphs need at least three numeric columns";
  const m = groupFeatureMatrix(rows, xi, feats, env.mini ? 6 : 12);
  const { mini, ink } = env;
  const axes = feats.length;
  const footer = layoutFooter(ctx, env, {
    caption: `Spokes clockwise from top: ${feats.map((fi) => fieldName(env, fi)).join(" · ")} (each scaled min → max across groups)`,
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const g = multiplesGrid(m.labels.length, plot);
  const labelH = mini ? 0 : 16;
  m.labels.forEach((label, bi) => {
    const cx = plot.left + (bi % g.cols) * g.cw + g.cw / 2;
    const cellTop = plot.top + Math.floor(bi / g.cols) * g.ch;
    const R = Math.max(4, Math.min(g.cw * 0.38, (g.ch - labelH) * 0.42));
    const cy = cellTop + (g.ch - labelH) / 2;
    ctx.strokeStyle = inkTint(ink, 0.22);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let a = 0; a < axes; a++) {
      const ang = -Math.PI / 2 + (a / axes) * Math.PI * 2;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let a = 0; a < axes; a++) {
      const ang = -Math.PI / 2 + (a / axes) * Math.PI * 2;
      const pt = { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R };
      if (a === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    for (let a = 0; a < axes; a++) {
      const t = m.norm[bi]![a] ?? 0.5;
      const ang = -Math.PI / 2 + (a / axes) * Math.PI * 2;
      const rr = R * (0.12 + t * 0.88);
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = withAlpha(env.single, 0.4);
    ctx.fill();
    ctx.strokeStyle = env.single;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    hitCircle(env, cx, cy, R, [[xi, label]], firstRowIndex(rows, xi, label), groupSummary(env, xi, label, feats, m.raw[bi]!));
    if (!mini) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, label, g.cw - 8), cx, Math.min(cy + R + 5, cellTop + g.ch - labelH + 2));
    }
  });
  footer.draw(footerTop);
}

function drawFlower(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0) return "Choose a category for the flowers";
  const feats = featureColumns(rows, env, xi, [yi, si, ci]);
  if (feats.length < 3) return "Flowers need at least three numeric columns";
  const m = groupFeatureMatrix(rows, xi, feats, env.mini ? 4 : 9);
  const { mini, ink } = env;
  const footer = layoutFooter(ctx, env, {
    swatches: feats.map((fi, i) => ({ label: fieldName(env, fi), color: env.colors[i % env.colors.length]! })),
    caption: "Petal length = value, scaled min → max across groups",
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const g = multiplesGrid(m.labels.length, plot);
  const labelH = mini ? 0 : 16;
  m.labels.forEach((label, gi) => {
    const cx = plot.left + (gi % g.cols) * g.cw + g.cw / 2;
    const cellTop = plot.top + Math.floor(gi / g.cols) * g.ch;
    const R = Math.max(4, Math.min(g.cw * 0.4, (g.ch - labelH) * 0.44));
    const cy = cellTop + (g.ch - labelH) / 2;
    const petals = feats.length;
    for (let p = 0; p < petals; p++) {
      const t = m.norm[gi]![p] ?? 0.5;
      const ang = -Math.PI / 2 + (p / petals) * Math.PI * 2;
      const len = R * (0.25 + t * 0.75);
      const ortho = ang + Math.PI / 2;
      const wid = Math.min(len * 0.3, (Math.PI * len) / petals);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * len * 0.5 + Math.cos(ortho) * wid,
        cy + Math.sin(ang) * len * 0.5 + Math.sin(ortho) * wid,
        cx + Math.cos(ang) * len,
        cy + Math.sin(ang) * len,
      );
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * len * 0.5 - Math.cos(ortho) * wid,
        cy + Math.sin(ang) * len * 0.5 - Math.sin(ortho) * wid,
        cx,
        cy,
      );
      ctx.fillStyle = withAlpha(env.colors[p % env.colors.length]!, 0.7);
      ctx.fill();
    }
    ctx.fillStyle = ink.text;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, R * 0.1), 0, Math.PI * 2);
    ctx.fill();
    hitCircle(env, cx, cy, R, [[xi, label]], firstRowIndex(rows, xi, label), groupSummary(env, xi, label, feats, m.raw[gi]!));
    if (!mini) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, label, g.cw - 8), cx, Math.min(cy + R + 4, cellTop + g.ch - labelH + 2));
    }
  });
  footer.draw(footerTop);
}

// ---- waffle / isotype ------------------------------------------------------

function percentLabel(share: number): string {
  const p = share * 100;
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}

function drawWaffle(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the waffle";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  let entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0);
  if (!entries.length) return "Nothing positive to split into 100 cells";
  const { mini, ink } = env;
  const maxCats = env.opts.topN != null
    ? Math.max(3, Math.min(20, Math.round(env.opts.topN)))
    : 8;
  const otherColor = inkTint(ink, 0.4);
  let hasOther = false;
  if (entries.length > maxCats) {
    const rest = entries.slice(maxCats - 1).reduce((s, [, v]) => s + v, 0);
    entries = [...entries.slice(0, maxCats - 1), [`Other (${entries.length - maxCats + 1})`, rest]];
    hasOther = true;
  }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  // Largest-remainder rounding: cells always sum to exactly 100.
  const exact = entries.map(([, v]) => (v / total) * 100);
  const cells = exact.map(Math.floor);
  let left = 100 - cells.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0 && k < order.length; k++, left--) cells[order[k]!.i]! += 1;
  const colorOf = (i: number) => (hasOther && i === entries.length - 1 ? otherColor : env.colors[i % env.colors.length]!);

  const base = basePlot(env);
  const availW = base.right - base.left;
  const availH = base.bottom - base.top;
  const legend: SwatchEntry[] = entries.map(([label, v], i) => ({ label: `${label} · ${percentLabel(v / total)}`, color: colorOf(i) }));
  let size: number;
  let gx: number;
  let gy: number;
  let legendBox: { x: number; y: number; w: number; vertical: boolean } | null = null;
  if (mini) {
    size = Math.min(availW, availH);
    gx = base.left + (availW - size) / 2;
    gy = base.top + (availH - size) / 2;
  } else if (availW - availH >= 130) {
    size = Math.min(availH, availW - 150);
    const legW = Math.min(220, availW - size - 20);
    const blockW = size + 20 + legW;
    gx = base.left + (availW - blockW) / 2;
    gy = base.top + (availH - size) / 2;
    legendBox = { x: gx + size + 20, y: gy, w: legW, vertical: true };
  } else {
    const legH = drawSwatchRow(ctx, legend, 0, 0, availW, ink, env.font, { axisFontSize: env.opts.axisFontSize, measureOnly: true, maxRows: 3 });
    size = Math.max(40, Math.min(availW, availH - legH - 10));
    gx = base.left + (availW - size) / 2;
    gy = base.top + Math.max(0, (availH - size - legH - 10) / 2);
    legendBox = { x: base.left, y: gy + size + 10, w: availW, vertical: false };
  }
  const cell = size / 10;
  const inset = Math.max(0.5, cell * 0.07);
  let filled = 0;
  const entryRow = env.opts.hits ? entries.map(([label]) => firstRowIndex(rows, xi, label)) : [];
  cells.forEach((n, ei) => {
    ctx.fillStyle = colorOf(ei);
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    for (let k = 0; k < n && filled < 100; k++, filled++) {
      const cx = filled % 10;
      const cy = Math.floor(filled / 10);
      ctx.fillRect(gx + cx * cell + inset, gy + cy * cell + inset, cell - 2 * inset, cell - 2 * inset);
      const [label, v] = entries[ei]!;
      const isOther = hasOther && ei === entries.length - 1;
      hitRect(
        env,
        gx + cx * cell + inset,
        gy + cy * cell + inset,
        cell - 2 * inset,
        cell - 2 * inset,
        isOther ? [] : [[xi, label]],
        isOther ? undefined : entryRow[ei],
        { columns: [fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null), "share"], row: [label, v, percentLabel(v / total)] },
      );
    }
  });
  ctx.globalAlpha = 1;
  if (legendBox) {
    if (legendBox.vertical) {
      ctx.font = oddFont(env, 10);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const lineH = Math.min(18, size / Math.max(1, legend.length));
      legend.forEach((e, i) => {
        const y = legendBox!.y + (i + 0.5) * Math.max(14, lineH);
        ctx.fillStyle = e.color;
        ctx.fillRect(legendBox!.x, y - 4.5, 9, 9);
        ctx.fillStyle = ink.muted;
        ctx.fillText(fitTextEllipsis(ctx, e.label, legendBox!.w - 15), legendBox!.x + 15, y);
      });
    } else {
      drawSwatchRow(ctx, legend, legendBox.x, legendBox.y, legendBox.w, ink, env.font, { axisFontSize: env.opts.axisFontSize, maxRows: 3, align: "center" });
    }
  }
}

function drawIsotype(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the unit chart";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(
    0,
    env.opts.topN != null ? Math.max(3, Math.min(20, Math.round(env.opts.topN))) : (env.mini ? 5 : 8),
  );
  if (!entries.length) return "Nothing positive to count in units";
  const { mini, ink } = env;
  const maxV = Math.max(...entries.map(([, v]) => v));
  const { plot, footerTop } = plotAboveFooter(env, mini ? 0 : 14);
  ctx.font = oddFont(env, 10);
  const pw = plot.right - plot.left;
  const labelW = mini ? 0 : Math.max(40, Math.min(pw * 0.3, Math.max(...entries.map(([l]) => ctx.measureText(l).width)) + 10));
  const valueW = mini ? 0 : 44;
  const bandH = (plot.bottom - plot.top) / entries.length;
  const s = Math.max(5, Math.min(16, bandH * 0.62));
  const step = s * 1.3;
  const area = pw - labelW - valueW;
  const maxIcons = Math.max(3, Math.floor(area / step));
  const unit = niceTicks(0, maxV, maxIcons, true).step;
  entries.forEach(([label, v], ei) => {
    const cy = plot.top + (ei + 0.5) * bandH;
    const n = v / unit;
    const full = Math.floor(n);
    const frac = n - full;
    const x0 = plot.left + labelW;
    ctx.fillStyle = env.single;
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    let iconsW = 0;
    for (let i = 0; i <= full && i < maxIcons + 1; i++) {
      const part = i < full ? 1 : frac;
      if (part <= 0.02) break;
      const px = x0 + i * step;
      iconsW = px + s * part - x0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, cy - s / 2 - 1, s * part, s + 2);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (iconsW > 0) {
      const measure = aggregateAxisTitle(how, fieldName(env, yi) || null);
      hitRect(env, x0, cy - s / 2, iconsW, s, [[xi, label]], firstRowIndex(rows, xi, label), {
        columns: [fieldName(env, xi), measure],
        row: [label, v],
      });
    }
    if (!mini) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      ctx.fillText(fitTextEllipsis(ctx, label, labelW - 8), x0 - 8, cy);
      ctx.textAlign = "left";
      ctx.fillText(formatDataValue(v), x0 + Math.min(area, Math.ceil(n) * step) + 4, cy);
    }
  });
  if (!mini) {
    // Unit key: one icon = a round amount of the measure.
    const top = footerTop;
    ctx.fillStyle = env.single;
    ctx.beginPath();
    ctx.arc(env.pad * 0.5 + 4 + 5, top + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const measure = aggregateAxisTitle(how, fieldName(env, yi) || null);
    ctx.fillText(fitTextEllipsis(ctx, `= ${formatAxisValue(unit, unit)} · ${measure}`, env.w - env.pad - 24), env.pad * 0.5 + 4 + 14, top + 6);
  }
}

// ---- pyramid / slope -------------------------------------------------------

function drawPyramid(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, _ci: number, si: number) {
  if (xi < 0 || yi < 0 || si < 0) return "Pyramid needs a category and two numeric columns";
  const howRaw = env.opts.yAggregate ?? "sum";
  const how = howRaw === "count" ? "sum" : howRaw;
  const byCat = new Map<string, { left: number[]; right: number[]; rowIndex: number }>();
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]!;
    const c = String(r[xi] ?? "");
    if (!c) continue;
    let cur = byCat.get(c);
    if (!cur) {
      cur = { left: [], right: [], rowIndex: ri };
      byCat.set(c, cur);
    }
    const lv = toNum(r[yi]);
    const rv = toNum(r[si]);
    if (Number.isFinite(lv)) cur.left.push(lv);
    if (Number.isFinite(rv)) cur.right.push(rv);
  }
  const catLimit =
    env.opts.topN != null
      ? Math.max(3, Math.min(40, Math.round(env.opts.topN)))
      : env.mini
        ? 8
        : 14;
  const ranked = [...byCat.entries()]
    .map(([c, v]) => {
      const left = Math.max(0, agg(v.left, how));
      const right = Math.max(0, agg(v.right, how));
      return { c, left, right, score: Math.max(left, right), rowIndex: v.rowIndex };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, catLimit);
  if (!ranked.length) return "No positive values to mirror";
  const { mini, ink } = env;
  const leftColor = env.colors[0]!;
  const rightColor = env.colors[1 % env.colors.length]!;
  const headerRowH = chartTypeRamp(env.opts.axisFontSize).tick + 7;
  const headerH = mini ? 0 : headerRowH * 2;
  const base = basePlot(env);
  const plot = { ...base, top: base.top + headerH };
  const pw = plot.right - plot.left;
  ctx.font = oddFont(env, 10);
  const labelW = mini
    ? 6
    : Math.max(50, Math.min(pw * 0.26, Math.max(...ranked.map((p) => ctx.measureText(p.c).width)) + 14));
  const mid = plot.left + pw / 2;
  const arm = Math.max(8, (pw - labelW) / 2);
  const leftMax = Math.max(...ranked.map((p) => p.left), 1e-9);
  const rightMax = Math.max(...ranked.map((p) => p.right), 1e-9);
  const scaleKind = resolvePyramidScaleMode(env.opts.pyramidScaleMode, leftMax, rightMax);
  const nT = Math.max(2, Math.min(4, Math.floor(arm / 60)));
  const sharedDomain = Math.max(leftMax, rightMax);
  const lt =
    scaleKind === "shared"
      ? niceTicks(0, sharedDomain, nT, true)
      : niceTicks(0, leftMax, nT, true);
  const rt =
    scaleKind === "shared"
      ? niceTicks(0, sharedDomain, nT, true)
      : niceTicks(0, rightMax, nT, true);
  const independent = scaleKind === "independent";
  const bandH = (plot.bottom - plot.top) / ranked.length;
  const barH = Math.max(3, bandH * 0.68);
  const lx = (v: number) => mid - labelW / 2 - (v / (lt.max || 1)) * arm;
  const rx = (v: number) => mid + labelW / 2 + (v / (rt.max || 1)) * arm;
  const leftEdge = mid - labelW / 2;
  const rightEdge = mid + labelW / 2;
  const lField = fieldName(env, yi);
  const rField = fieldName(env, si);

  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.lineWidth = 1;
    for (const v of lt.ticks) {
      const x = Math.round(lx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
    }
    for (const v of rt.ticks) {
      const x = Math.round(rx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
    }
    // Shared zero spine through the category gutter.
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.28 : 0.35);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(Math.round(leftEdge) + 0.5, plot.top);
    ctx.lineTo(Math.round(leftEdge) + 0.5, plot.bottom);
    ctx.moveTo(Math.round(rightEdge) + 0.5, plot.top);
    ctx.lineTo(Math.round(rightEdge) + 0.5, plot.bottom);
    ctx.stroke();
    const items = [
      ...lt.ticks.map((v) => ({ x: lx(v), label: formatAxisValue(v, lt.step) })),
      ...rt.ticks.map((v) => ({ x: rx(v), label: formatAxisValue(v, rt.step) })),
    ].sort((a, b) => a.x - b.x);
    drawPositionedLabelsX(ctx, items, env.w, env.h, plot, env.look);
  }

  const fs = chartTypeRamp(env.opts.axisFontSize).tick;
  const every = Math.max(1, Math.ceil((fs + 2) / bandH));
  const hits = env.opts.hits;
  ranked.forEach((p, i) => {
    const cy = plot.top + (i + 0.5) * bandH;
    const y0 = cy - barH / 2;
    const leftX = lx(p.left);
    const rightX = rx(p.right);
    const leftW = leftEdge - leftX;
    const rightW = rightX - rightEdge;
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    ctx.fillStyle = leftColor;
    ctx.fillRect(leftX, y0, leftW, barH);
    ctx.fillStyle = rightColor;
    ctx.fillRect(rightEdge, y0, rightW, barH);
    ctx.globalAlpha = 1;
    if (hits) {
      const matchBase: [number, string][] = [[xi, p.c]];
      if (leftW > 0.5) {
        hits.push({
          shape: "rect",
          x: leftX,
          y: y0,
          w: leftW,
          h: barH,
          match: [...matchBase, [yi, String(p.left)]],
          rowIndex: p.rowIndex,
          summary: {
            columns: [env.columns[xi]!, lField, rField],
            row: [p.c, p.left, p.right],
          },
        });
      }
      if (rightW > 0.5) {
        hits.push({
          shape: "rect",
          x: rightEdge,
          y: y0,
          w: rightW,
          h: barH,
          match: [...matchBase, [si, String(p.right)]],
          rowIndex: p.rowIndex,
          summary: {
            columns: [env.columns[xi]!, lField, rField],
            row: [p.c, p.left, p.right],
          },
        });
      }
    }
    if (mini) return;
    ctx.textBaseline = "middle";
    if (i % every === 0) {
      ctx.font = oddFont(env, fs);
      ctx.fillStyle = ink.text;
      ctx.textAlign = "center";
      ctx.fillText(fitTextEllipsis(ctx, p.c, labelW - 10), mid, cy);
    }
    if (env.opts.showDataLabels && barH >= 10) {
      ctx.font = oddFont(env, 9);
      ctx.fillStyle = ink.muted;
      const lt0 = formatDataValue(p.left);
      const rt0 = formatDataValue(p.right);
      ctx.textAlign = "right";
      if (leftX - ctx.measureText(lt0).width - 4 > plot.left - env.pad * 0.4) {
        ctx.fillText(lt0, leftX - 4, cy);
      }
      ctx.textAlign = "left";
      if (rightX + ctx.measureText(rt0).width + 4 < env.w - 4) {
        ctx.fillText(rt0, rightX + 4, cy);
      }
    }
    const deltaLbl = formatDeltaLabel(p.left, p.right, env.opts.deltaDisplay);
    if (!mini && deltaLbl && bandH >= fs * 2 + 6) {
      ctx.font = oddFont(env, 9, 600);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fitTextEllipsis(ctx, deltaLbl, labelW - 8), mid, cy + (i % every === 0 ? fs * 0.85 : 0));
    }
  });

  if (!mini) {
    const hy = base.top + headerRowH / 2;
    ctx.font = oddFont(env, 10, 600);
    ctx.textBaseline = "middle";
    const lName = fitTextEllipsis(ctx, lField, arm - 20);
    const rName = fitTextEllipsis(ctx, rField, arm - 20);
    ctx.textAlign = "right";
    ctx.fillStyle = ink.text;
    ctx.fillText(lName, leftEdge - 4, hy);
    ctx.fillStyle = leftColor;
    ctx.fillRect(leftEdge - 4 - ctx.measureText(lName).width - 14, hy - 4.5, 9, 9);
    ctx.textAlign = "left";
    ctx.fillStyle = rightColor;
    ctx.fillRect(rightEdge + 4, hy - 4.5, 9, 9);
    ctx.fillStyle = ink.text;
    ctx.fillText(rName, rightEdge + 18, hy);
    ctx.font = oddFont(env, 9);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "center";
    const scaleHint = independent ? "separate scales" : "same scale";
    ctx.fillText(fitTextEllipsis(ctx, scaleHint, pw), mid, hy + headerRowH);
  }
}

function drawSlope(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, _ci: number, si: number) {
  if (xi < 0 || yi < 0 || si < 0) return "Slope needs a category and two numeric columns";
  const groups = new Map<string, { a: number[]; b: number[]; row: unknown[] }>();
  for (const r of rows) {
    const k = String(r[xi]);
    let g = groups.get(k);
    if (!g) {
      if (groups.size >= 14) continue;
      g = { a: [], b: [], row: r };
      groups.set(k, g);
    }
    const a = toNum(r[yi]);
    const b = toNum(r[si]);
    if (Number.isFinite(a)) g.a.push(a);
    if (Number.isFinite(b)) g.b.push(b);
  }
  const pairs = [...groups.entries()]
    .filter(([, g]) => g.a.length && g.b.length)
    .map(([c, g]) => ({ c, a: agg(g.a, "mean"), b: agg(g.b, "mean"), row: g.row }));
  if (!pairs.length) return "No rows have both values";
  const { mini, ink } = env;
  const vals = pairs.flatMap((p) => [p.a, p.b]);
  const ys = niceTicks(Math.min(...vals), Math.max(...vals), 5, true);
  const headerH = mini ? 0 : 18;
  const base = basePlot(env);
  const top = base.top + headerH;
  const ph = base.bottom - top;
  const sy = (v: number) => base.bottom - ((v - ys.min) / (ys.max - ys.min || 1)) * ph;
  ctx.font = oddFont(env, 10);
  const deltaMode = env.opts.deltaDisplay;
  const labelOf = (p: (typeof pairs)[number]) => {
    const delta = formatDeltaLabel(p.a, p.b, deltaMode);
    const baseLbl = `${p.c}  ${formatDataValue(p.b)}`;
    return delta ? `${baseLbl}  ${delta}` : baseLbl;
  };
  const labelW = mini ? 0 : Math.max(60, Math.min((base.right - base.left) * 0.38, Math.max(...pairs.map((p) => ctx.measureText(labelOf(p)).width)) + 10));
  const x0 = base.left + (mini ? 6 : 8);
  const x1 = Math.max(x0 + 40, base.right + env.pad * 0.5 - labelW - 8);

  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.lineWidth = 1;
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of ys.ticks) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillText(formatAxisValue(v, ys.step), x0 - 6, y);
    }
    ctx.strokeStyle = inkTint(ink, 0.38);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, top);
    ctx.lineTo(x0 + 0.5, base.bottom);
    ctx.moveTo(x1 + 0.5, top);
    ctx.lineTo(x1 + 0.5, base.bottom);
    ctx.stroke();
    ctx.font = oddFont(env, 10, 600);
    ctx.fillStyle = ink.text;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, fieldName(env, yi), (x1 - x0) / 2 - 6), x0, base.top + headerH / 2 - 2);
    ctx.textAlign = "right";
    ctx.fillText(fitTextEllipsis(ctx, fieldName(env, si), (x1 - x0) / 2 - 6), x1, base.top + headerH / 2 - 2);
  }

  ctx.lineCap = env.opts.lineCap ?? "round";
  // Direction is the story: rises and falls get the first two palette colors, flat stays muted.
  const riseColor = env.colors[0]!;
  const fallColor = env.colors[1 % env.colors.length]!;
  const flatColor = inkTint(ink, 0.45);
  const tol = (ys.max - ys.min) * 1e-6;
  const dirColor = (p: { a: number; b: number }) => (p.b - p.a > tol ? riseColor : p.a - p.b > tol ? fallColor : flatColor);
  for (const p of pairs) {
    const lineColor = dirColor(p);
    ctx.strokeStyle = lineColor;
    ctx.globalAlpha = Math.max(0.6, env.alpha);
    ctx.lineWidth = mini ? 1.2 : 2;
    ctx.beginPath();
    ctx.moveTo(x0, sy(p.a));
    ctx.lineTo(x1, sy(p.b));
    ctx.stroke();
    ctx.globalAlpha = 1;
    mark(ctx, env, p.row, x0, sy(p.a), mini ? 2.2 : 3.5, lineColor, 1, mini ? null : ink.bg);
    mark(ctx, env, p.row, x1, sy(p.b), mini ? 2.2 : 3.5, lineColor, 1, mini ? null : ink.bg);
    const ri = firstRowIndex(rows, xi, p.c);
    const summary: OddSummary = {
      columns: [fieldName(env, xi), `${fieldName(env, yi)} (mean)`, `${fieldName(env, si)} (mean)`],
      row: [p.c, p.a, p.b],
    };
    hitCircle(env, x0, sy(p.a), mini ? 2.2 : 3.5, [[xi, p.c], [yi, String(p.a)]], ri, summary);
    hitCircle(env, x1, sy(p.b), mini ? 2.2 : 3.5, [[xi, p.c], [si, String(p.b)]], ri, summary);
  }
  if (mini) return;
  const targets = pairs.map((p) => sy(p.b));
  const placed = dodgeLabels(targets, chartTypeRamp(env.opts.axisFontSize).tick + 4, top + 5, base.bottom - 5);
  ctx.font = oddFont(env, 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  pairs.forEach((p, i) => {
    const y = placed[i]!;
    if (Math.abs(y - targets[i]!) > 2) {
      ctx.strokeStyle = inkTint(ink, 0.3);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x1 + 5, targets[i]!);
      ctx.lineTo(x1 + 10, y);
      ctx.stroke();
    }
    ctx.fillStyle = ink.text;
    ctx.fillText(fitTextEllipsis(ctx, labelOf(p), labelW), x1 + 12, y);
  });
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, `${fieldName(env, xi)} · average per group`, null, env.look);
  const ups = pairs.filter((p) => dirColor(p) === riseColor).length;
  const downs = pairs.filter((p) => dirColor(p) === fallColor).length;
  const flats = pairs.length - ups - downs;
  const key: SwatchEntry[] = [];
  if (ups) key.push({ label: `Rises (${ups})`, color: riseColor, shape: "line" });
  if (downs) key.push({ label: `Falls (${downs})`, color: fallColor, shape: "line" });
  if (flats) key.push({ label: `Flat (${flats})`, color: flatColor, shape: "line" });
  drawPanelLegend(ctx, env, key, `${fieldName(env, yi)} → ${fieldName(env, si)}`, { left: x0 + 6, top, right: x1 - 6, bottom: base.bottom }, "top-left");
}

// ---- bump / stream / horizon / spiral --------------------------------------

function drawBump(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Bump chart needs an order column and a numeric column";
  if (ci < 0) return "Bump charts rank series — choose a color (series) field";
  const model = orderedKeys(rows, xi, 20, true);
  if (model.keys.length < 2) return "Need at least two positions to rank across";
  const { mini, ink } = env;
  const catIdx = categoryIndex(rows, ci);
  const cell = new Map<string, number[]>();
  const totals = new Map<string, number>();
  const seriesRow = new Map<string, unknown[]>();
  const rowIndexOf = new Map<unknown[], number>();
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri]!;
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const s = String(r[ci]);
    if (!seriesRow.has(s)) {
      seriesRow.set(s, r);
      rowIndexOf.set(r, ri);
    }
    const key = `${model.keyOf(r)}||${s}`;
    const l = cell.get(key) ?? [];
    l.push(v);
    cell.set(key, l);
    totals.set(s, (totals.get(s) ?? 0) + v);
  }
  const series = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s);
  if (series.length < 2) return "Need at least two series to rank";
  const ranks = model.keys.map((x) => {
    const scored = series
      .map((s) => ({ s, v: cell.get(`${x}||${s}`) }))
      .filter((e) => e.v && e.v.length)
      .map((e) => ({ s: e.s, v: agg(e.v!, "mean") }))
      .sort((a, b) => b.v - a.v);
    const m = new Map<string, number>();
    scored.forEach((sc, i) => m.set(sc.s, i + 1));
    return m;
  });
  const deltaMode = env.opts.bumpMode === "delta";
  const values = ranks.map((m, i) => {
    if (!deltaMode || i === 0) return m;
    const prev = ranks[i - 1]!;
    const out = new Map<string, number>();
    for (const s of series) {
      const cur = m.get(s);
      const p = prev.get(s);
      if (cur != null && p != null) out.set(s, p - cur); // positive = climbed
    }
    return out;
  });
  const maxRank = series.length;
  const deltaSpan = deltaMode
    ? Math.max(1, ...values.flatMap((m) => [...m.values()].map((v) => Math.abs(v))))
    : 0;
  ctx.font = oddFont(env, 10);
  const labelW = mini ? 0 : Math.min(130, Math.max(...series.map((s) => ctx.measureText(s).width)) + 18);
  const base = basePlot(env);
  const plot = mini ? base : { ...base, left: base.left + 6, right: Math.min(base.right, env.w - labelW - 10) };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const xAt = (i: number) => plot.left + model.pos[i]! * pw;
  const yAt = (rank: number) => plot.top + ((rank - 1) / Math.max(1, maxRank - 1)) * ph;
  const yAtDelta = (d: number) => plot.top + ((deltaSpan - d) / (2 * deltaSpan || 1)) * ph;
  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.1 : 0.12);
    ctx.lineWidth = 1;
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    if (deltaMode) {
      for (const d of [-deltaSpan, 0, deltaSpan]) {
        const y = Math.round(yAtDelta(d)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.right, y);
        ctx.stroke();
        ctx.fillText(d === 0 ? "0" : d > 0 ? `↑${d}` : `↓${Math.abs(d)}`, plot.left - 8, y);
      }
    } else {
      const every = Math.max(1, Math.ceil(12 / Math.max(1, ph / Math.max(1, maxRank - 1))));
      for (let k = 1; k <= maxRank; k++) {
        const y = Math.round(yAt(k)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.right, y);
        ctx.stroke();
        if ((k - 1) % every === 0) ctx.fillText(`#${k}`, plot.left - 8, y);
      }
    }
    drawOrderedXAxis(ctx, env, model, plot);
    drawAxisFieldLabels(
      ctx,
      env.w,
      env.h,
      env.pad,
      fieldName(env, xi),
      deltaMode ? `Δ rank by ${fieldName(env, yi)}` : `Rank by ${fieldName(env, yi)}`,
      env.look,
    );
  }
  const ends: { s: string; y: number; color: string }[] = [];
  series.forEach((s) => {
    const color = env.colors[(catIdx.get(s) ?? 0) % env.colors.length]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.5 : 2.5;
    ctx.lineJoin = env.opts.lineJoin ?? "round";
    ctx.globalAlpha = Math.max(0.7, env.alpha);
    ctx.beginPath();
    let pen = false;
    let last: { x: number; y: number } | null = null;
    model.keys.forEach((_, i) => {
      const v = values[i]!.get(s);
      if (v == null) {
        pen = false;
        return;
      }
      const x = xAt(i);
      const y = deltaMode ? yAtDelta(v) : yAt(v);
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
      last = { x, y };
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!mini) {
      model.keys.forEach((_, i) => {
        const v = values[i]!.get(s);
        if (v != null) mark(ctx, env, seriesRow.get(s), xAt(i), deltaMode ? yAtDelta(v) : yAt(v), 3.2, color, 1, ink.bg);
      });
    }
    const sRow = seriesRow.get(s);
    const sRi = sRow ? rowIndexOf.get(sRow) : undefined;
    model.keys.forEach((key, i) => {
      const v = values[i]!.get(s);
      if (v == null) return;
      const rank = ranks[i]!.get(s);
      hitCircle(env, xAt(i), deltaMode ? yAtDelta(v) : yAt(v), mini ? 2 : 3.2, [[xi, key], [ci, s]], sRi, {
        columns: [fieldName(env, xi), fieldName(env, ci), deltaMode ? "Δ rank" : "rank"],
        row: [key, s, deltaMode ? v : (rank ?? null)],
      });
    });
    if (last) ends.push({ s, y: (last as { y: number }).y, color });
  });
  if (mini) return;
  const placed = dodgeLabels(ends.map((e) => e.y), chartTypeRamp(env.opts.axisFontSize).tick + 4, plot.top - 4, plot.bottom + 4);
  ctx.font = oddFont(env, 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ends.forEach((e, i) => {
    ctx.fillStyle = e.color;
    ctx.fillRect(plot.right + 8, placed[i]! - 1.5, 6, 3);
    ctx.fillStyle = ink.text;
    ctx.fillText(fitTextEllipsis(ctx, e.s, labelW - 18), plot.right + 18, placed[i]!);
  });
}

function drawStream(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Streamgraph needs an order column and a numeric column";
  const model = orderedKeys(rows, xi, 60, true);
  if (model.keys.length < 2) return "Need at least two positions for a stream";
  const { mini, ink } = env;
  const catIdx = categoryIndex(rows, ci);
  const totalsBy = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v) || v < 0) continue;
    const s = ci >= 0 ? String(r[ci]) : "";
    const k = `${model.keyOf(r)}||${s}`;
    cell.set(k, (cell.get(k) ?? 0) + v);
    totalsBy.set(s, (totalsBy.get(s) ?? 0) + v);
  }
  if (!totalsBy.size) return `No non-negative ${fieldName(env, yi, "values")} to stack`;
  const ranked = [...totalsBy.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const top = ranked.slice(0, 8);
  const otherSet = new Set(ranked.slice(8));
  const series = otherSet.size ? [...top, "__other"] : top;
  const grid = series.map((s) =>
    model.keys.map((x) =>
      s === "__other"
        ? [...otherSet].reduce((acc, o) => acc + (cell.get(`${x}||${o}`) ?? 0), 0)
        : cell.get(`${x}||${s}`) ?? 0,
    ),
  );
  const colorOf = (s: string) =>
    s === "__other" ? inkTint(ink, 0.35) : ci >= 0 ? env.colors[(catIdx.get(s) ?? 0) % env.colors.length]! : env.single;
  const nameOf = (s: string) => (s === "__other" ? `Other (${otherSet.size})` : s);
  const totals = model.keys.map((_, i) => grid.reduce((acc, row) => acc + row[i]!, 0));
  const maxT = Math.max(...totals);
  if (!(maxT > 0)) return "All values are zero";
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = (plot.bottom - plot.top) * 0.92;
  const midY = (plot.top + plot.bottom) / 2;
  const k = ph / maxT;
  const xAt = (i: number) => plot.left + model.pos[i]! * pw;
  const layers = series.map(() => ({ top: [] as number[], bot: [] as number[] }));
  model.keys.forEach((_, i) => {
    let y = midY - (totals[i]! * k) / 2;
    series.forEach((_, si0) => {
      layers[si0]!.top.push(y);
      y += grid[si0]![i]! * k;
      layers[si0]!.bot.push(y);
    });
  });
  series.forEach((s, si0) => {
    const L = layers[si0]!;
    ctx.beginPath();
    L.top.forEach((y, i) => (i === 0 ? ctx.moveTo(xAt(i), y) : ctx.lineTo(xAt(i), y)));
    for (let i = L.bot.length - 1; i >= 0; i--) ctx.lineTo(xAt(i), L.bot[i]!);
    ctx.closePath();
    ctx.globalAlpha = Math.max(0.7, env.alpha);
    ctx.fillStyle = colorOf(s);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = withAlpha(ink.bg, 0.6);
    ctx.lineWidth = 0.75;
    ctx.stroke();
    model.keys.forEach((key, i) => {
      const thick = L.bot[i]! - L.top[i]!;
      if (!(thick > 0.5)) return;
      const match: [number, string][] = [[xi, key]];
      if (ci >= 0 && s !== "__other") match.push([ci, s]);
      hitCircle(env, xAt(i), (L.top[i]! + L.bot[i]!) / 2, Math.max(3, Math.min(thick / 2, 10)), match, undefined, {
        columns: [fieldName(env, xi), ...(ci >= 0 ? [fieldName(env, ci)] : []), `${fieldName(env, yi)} (sum)`],
        row: [key, ...(ci >= 0 ? [nameOf(s)] : []), grid[si0]![i]!],
      });
    });
  });
  if (mini) return;
  drawOrderedXAxis(ctx, env, model, plot);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), null, env.look);
  // Scale bar: the height of a round amount (streams have no y axis).
  const nt = niceTicks(0, maxT, 3, false);
  const barV = [...nt.ticks].reverse().find((v) => v > 0 && v <= maxT * 0.9) ?? nt.ticks[nt.ticks.length - 1]!;
  if (barV > 0) {
    const bh = barV * k;
    const bx = plot.left - 10;
    const by0 = midY + bh / 2;
    ctx.strokeStyle = ink.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 3, by0);
    ctx.lineTo(bx, by0);
    ctx.lineTo(bx, by0 - bh);
    ctx.lineTo(bx - 3, by0 - bh);
    ctx.stroke();
    ctx.save();
    ctx.translate(bx - 6, midY);
    ctx.rotate(-Math.PI / 2);
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, `${formatAxisValue(barV, nt.step)} ${fieldName(env, yi)}`, Math.max(40, ph)), 0, 0);
    ctx.restore();
  }
  if (series.length < 2 && ci < 0) return;
  // Direct labels where a layer is thick enough; otherwise a legend panel.
  const canLabelAll = series.every((_, si0) => {
    const L = layers[si0]!;
    return L.bot.some((b, i) => b - L.top[i]! >= 14);
  });
  if (canLabelAll) {
    ctx.font = oddFont(env, 10, 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    series.forEach((s, si0) => {
      const L = layers[si0]!;
      let best = 0;
      L.bot.forEach((b, i) => {
        if (b - L.top[i]! > L.bot[best]! - L.top[best]!) best = i;
      });
      const x = Math.max(plot.left + 30, Math.min(plot.right - 30, xAt(best)));
      ctx.fillStyle = inkOn(colorOf(s));
      ctx.fillText(fitTextEllipsis(ctx, nameOf(s), Math.min(140, pw * 0.3)), x, (L.top[best]! + L.bot[best]!) / 2);
    });
  } else {
    drawPanelLegend(ctx, env, series.map((s) => ({ label: nameOf(s), color: colorOf(s) })), fieldName(env, ci) || undefined, plot, "top-right");
  }
}

function drawHorizon(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0 || yi < 0) return "Horizon needs an order column and a numeric column";
  const model = orderedKeys(rows, xi, 120, true);
  const sums = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const k = model.keyOf(r);
    const cur = sums.get(k) ?? { s: 0, n: 0 };
    cur.s += v;
    cur.n += 1;
    sums.set(k, cur);
  }
  const pts = model.keys
    .map((k, i) => ({ k, pos: model.pos[i]!, v: sums.has(k) ? sums.get(k)!.s / sums.get(k)!.n : NaN }))
    .filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return "Horizon needs at least two numeric points";
  const { mini, ink } = env;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  // Fold around zero, unless the series sits far from zero (then a round value near its middle).
  let baseline = 0;
  if ((lo > 0 && lo > hi - lo) || (hi < 0 && -hi > hi - lo)) {
    const nt = niceTicks(lo, hi, 4, false);
    const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    baseline = nt.ticks.reduce((best, t) => (Math.abs(t - mean) < Math.abs(best - mean) ? t : best), nt.ticks[0] ?? mean);
  }
  const maxAbs = Math.max(...pts.map((p) => Math.abs(p.v - baseline)));
  if (!(maxAbs > 0)) return "Values are flat — nothing to fold";
  const step = niceTicks(0, maxAbs, 3, true).step;
  const bands = Math.max(1, Math.min(4, Math.ceil(maxAbs / step - 1e-9)));
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const posColor = env.colors[0]!;
  const negColor = env.colors[1 % env.colors.length]!;
  const shade = (c: string, b: number) => mixColor(ink.bg, c, 0.3 + (0.7 * (b + 1)) / bands);
  const xAt = (p: number) => plot.left + p * pw;
  const hasNeg = pts.some((p) => p.v < baseline);
  for (const sign of [1, -1]) {
    if (sign < 0 && !hasNeg) continue;
    for (let b = 0; b < bands; b++) {
      ctx.beginPath();
      ctx.moveTo(xAt(pts[0]!.pos), plot.bottom);
      for (const p of pts) {
        const d = (p.v - baseline) * sign;
        const fillT = Math.max(0, Math.min(1, (d - b * step) / step));
        ctx.lineTo(xAt(p.pos), plot.bottom - fillT * ph);
      }
      ctx.lineTo(xAt(pts[pts.length - 1]!.pos), plot.bottom);
      ctx.closePath();
      ctx.fillStyle = shade(sign > 0 ? posColor : negColor, b);
      ctx.fill();
    }
  }
  // One point per drawn sample, on the top edge of its first (lightest) fold.
  for (const p of pts) {
    const fillT = Math.max(0, Math.min(1, Math.abs(p.v - baseline) / step));
    hitCircle(env, xAt(p.pos), plot.bottom - fillT * ph, 4, [[xi, p.k]], undefined, {
      columns: [fieldName(env, xi), `${fieldName(env, yi)} (mean)`],
      row: [p.k, p.v],
    });
  }
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawOrderedXAxis(ctx, env, model, plot);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), null, env.look);
  const fmt = (v: number) => formatAxisValue(v, step);
  const entries: SwatchEntry[] = [];
  for (let b = 0; b < bands; b++) entries.push({ label: `${b === 0 ? "0" : `+${fmt(b * step)}`} to +${fmt((b + 1) * step)}`, color: shade(posColor, b) });
  if (hasNeg) for (let b = 0; b < bands; b++) entries.push({ label: `${b === 0 ? "0" : `−${fmt(b * step)}`} to −${fmt((b + 1) * step)}`, color: shade(negColor, b) });
  const base0 = baseline === 0 ? "" : ` vs ${formatDataValue(baseline)}`;
  drawPanelLegend(ctx, env, entries, `${fieldName(env, yi)}${base0}`, plot, "top-left");
}

function drawSpiral(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (yi < 0) return "Time spiral needs a numeric column";
  type P = { y: number; c: string; x: string; ri: number };
  let pts: P[] = rows
    .map((r, i) => ({ y: toNum(r[yi]), c: ci >= 0 ? String(r[ci]) : "", x: xi >= 0 ? String(r[xi]) : String(i + 1), ri: i }))
    .filter((p) => Number.isFinite(p.y));
  if (xi >= 0) {
    const model = orderedKeys(rows, xi, 100000);
    const rank = new Map(model.keys.map((k, i) => [k, i]));
    pts = pts.filter((p) => rank.has(p.x)).sort((a, b) => rank.get(a.x)! - rank.get(b.x)!);
  }
  const cap = env.mini ? 80 : 240;
  if (pts.length > cap) pts = Array.from({ length: cap }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (cap - 1))]!);
  if (pts.length < 3) return "Need at least three values for a spiral";
  const { mini, ink } = env;
  const lo = Math.min(...pts.map((p) => p.y));
  const hi = Math.max(...pts.map((p) => p.y));
  const span = hi - lo || 1;
  const stops = sequentialStops(ink, env.opts.continuousStops);
  const colorAt = (t: number) => rampColor(stops, 0.15 + 0.85 * t);
  const catIdx = categoryIndex(rows, ci);
  const footer = layoutFooter(ctx, env, ci >= 0
    ? { swatches: legendEntriesFor(rows, ci, env.colors), caption: `Line width = ${fieldName(env, yi)}` }
    : { ramp: { min: lo, max: hi, colorAt: (t) => colorAt(t), title: `${fieldName(env, yi)} (color + width)` } });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  const maxR = Math.max(10, Math.min(plot.right - plot.left, plot.bottom - plot.top) / 2 - (mini ? 2 : 8));
  const turns = Math.max(1, Math.min(5, Math.ceil(pts.length / 36)));
  const posOf = (i: number) => {
    const t = i / (pts.length - 1);
    const ang = -Math.PI / 2 + t * Math.PI * 2 * turns;
    const rad = maxR * (0.12 + t * 0.88);
    return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
  };
  // Faint guide rings so the coil reads as turns.
  ctx.strokeStyle = inkTint(ink, 0.1);
  ctx.lineWidth = 1;
  for (let k = 1; k <= turns; k++) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * (0.12 + (0.88 * k) / turns), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineCap = env.opts.lineCap ?? "round";
  for (let i = 1; i < pts.length; i++) {
    const a = posOf(i - 1);
    const b = posOf(i);
    const t = (pts[i]!.y - lo) / span;
    ctx.strokeStyle = ci >= 0 ? env.colors[(catIdx.get(pts[i]!.c) ?? 0) % env.colors.length]! : colorAt(t);
    ctx.lineWidth = (mini ? 1 : 1.5) + t * (mini ? 4 : 8);
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  pts.forEach((p, i) => {
    const at = posOf(i);
    const t = (p.y - lo) / span;
    const match: [number, string][] = [];
    if (xi >= 0) match.push([xi, p.x]);
    if (ci >= 0) match.push([ci, p.c]);
    match.push([yi, String(rows[p.ri]![yi])]);
    hitCircle(env, at.x, at.y, Math.max(3, ((mini ? 1 : 1.5) + t * (mini ? 4 : 8)) / 2), match, p.ri);
  });
  if (!mini && xi >= 0) {
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textBaseline = "middle";
    const s = posOf(0);
    const e = posOf(pts.length - 1);
    // ISO timestamps read as "2026-10-13 22:47", not "2026-10-13T22:47:39.280Z"; years stay as-is
    const when = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? formatDateCell(v) : v);
    ctx.textAlign = "center";
    ctx.fillText(fitTextEllipsis(ctx, `start ${when(pts[0]!.x)}`, maxR), s.x, s.y - 12);
    ctx.textAlign = e.x >= cx ? "left" : "right";
    ctx.fillText(fitTextEllipsis(ctx, `end ${when(pts[pts.length - 1]!.x)}`, Math.max(40, env.w / 2 - 10)), e.x + (e.x >= cx ? 8 : -8), e.y);
  }
  footer.draw(footerTop);
}

// ---- radial bars / chord ---------------------------------------------------

function drawRadialBar(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the wheel";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(
    0,
    env.opts.topN != null ? Math.max(3, Math.min(30, Math.round(env.opts.topN))) : 16,
  );
  if (!entries.length) return "Nothing positive to plot on the wheel";
  const { mini, ink } = env;
  const plot = basePlot(env);
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  ctx.font = oddFont(env, 10);
  const labelRoom = mini ? 0 : Math.min(70, Math.max(30, Math.max(...entries.map(([l]) => ctx.measureText(l).width)) * 0.6 + 12));
  const maxR = Math.max(16, Math.min(plot.right - plot.left, plot.bottom - plot.top) / 2 - labelRoom + (mini ? 0 : env.pad * 0.4));
  const inner = maxR * 0.22;
  const scale = niceTicks(0, Math.max(...entries.map(([, v]) => v)), 3, true);
  const rOf = (v: number) => inner + (v / (scale.max || 1)) * (maxR - inner);
  // Leave a gap at 12 o'clock for the ring labels.
  const gapA = mini ? 0 : 0.35;
  const startA = -Math.PI / 2 + gapA / 2;
  const slice = (Math.PI * 2 - gapA) / entries.length;
  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.lineWidth = 1;
    for (const v of scale.ticks) {
      if (v <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rOf(v), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  entries.forEach(([label, v], i) => {
    const r = rOf(v);
    const a0 = startA + i * slice + slice * 0.06;
    const a1 = startA + (i + 1) * slice - slice * 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.arc(cx, cy, inner, a1, a0, true);
    ctx.closePath();
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    ctx.fillStyle = env.single;
    ctx.fill();
    ctx.globalAlpha = 1;
    hitArc(env, cx, cy, inner, r, a0, a1, [[xi, label]], firstRowIndex(rows, xi, label), {
      columns: [fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null)],
      row: [label, v],
    });
    if (mini) return;
    const am = (a0 + a1) / 2;
    const lx = cx + Math.cos(am) * (r + 6);
    const ly = cy + Math.sin(am) * (r + 6);
    const right = Math.cos(am) >= 0;
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.text;
    ctx.textAlign = Math.abs(Math.cos(am)) < 0.2 ? "center" : right ? "left" : "right";
    ctx.textBaseline = Math.sin(am) > 0.6 ? "top" : Math.sin(am) < -0.6 ? "bottom" : "middle";
    const room = right ? env.w - 4 - lx : lx - 4;
    const text = env.opts.showDataLabels ? `${label} · ${formatDataValue(v)}` : label;
    ctx.fillText(fitTextEllipsis(ctx, text, Math.max(24, Math.min(room, 140))), lx, ly);
  });
  if (!mini) {
    // Ring values sit in the 12 o'clock gap, haloed so they read over bar ends.
    ctx.font = oddFont(env, 9);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = env.opts.lineJoin ?? "round";
    for (const v of scale.ticks) {
      if (v <= 0) continue;
      const label = formatAxisValue(v, scale.step);
      ctx.strokeStyle = ink.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(label, cx, cy - rOf(v));
      ctx.fillStyle = ink.muted;
      ctx.fillText(label, cx, cy - rOf(v));
    }
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.fillText(fitTextEllipsis(ctx, aggregateAxisTitle(how, fieldName(env, yi) || null), inner * 1.8), cx, cy);
  }
}

function drawChord(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || ci < 0) return "Chord needs two category columns";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const flowsM = new Map<string, number>();
  const nodeTotal = new Map<string, number>();
  for (const r of rows) {
    const a = String(r[xi]);
    const b = String(r[ci]);
    if (a === b) continue;
    const add = yi >= 0 && how !== "count" ? toNum(r[yi]) : 1;
    if (!Number.isFinite(add) || add <= 0) continue;
    const key = `${a}||${b}`;
    flowsM.set(key, (flowsM.get(key) ?? 0) + add);
    nodeTotal.set(a, (nodeTotal.get(a) ?? 0) + add);
    nodeTotal.set(b, (nodeTotal.get(b) ?? 0) + add);
  }
  if (!flowsM.size) return "No connections between the two categories";
  const { mini, ink } = env;
  const nodes = [...nodeTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n]) => n);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const targetIdx = categoryIndex(rows, ci);
  const sourceSet = new Set(rows.map((r) => String(r[xi])));
  const nodeColor = (n: string) =>
    targetIdx.has(n) && !sourceSet.has(n) ? env.colors[targetIdx.get(n)! % env.colors.length]! : inkTint(ink, 0.55);
  const flows = [...flowsM.entries()]
    .map(([k, v]) => {
      const [a, b] = k.split("||");
      return { a: a!, b: b!, v };
    })
    .filter((f) => idx.has(f.a) && idx.has(f.b));
  const maxV = Math.max(...flows.map((f) => f.v), 1);
  const maxNode = Math.max(...nodes.map((n) => nodeTotal.get(n)!));
  const footer = layoutFooter(ctx, env, { caption: `Ribbon width = ${aggregateAxisTitle(how, fieldName(env, yi) || null).toLowerCase()} · colored by ${fieldName(env, ci)}` });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  ctx.font = oddFont(env, 10);
  const labelRoom = mini ? 4 : Math.min(80, Math.max(...nodes.map((n) => ctx.measureText(n).width)) + 12);
  const R = Math.max(14, Math.min(plot.right - plot.left - 2 * labelRoom, plot.bottom - plot.top - 28) / 2);
  const angOf = (i: number) => -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
  flows.sort((p, q) => p.v - q.v).forEach((f) => {
    const a0 = angOf(idx.get(f.a)!);
    const a1 = angOf(idx.get(f.b)!);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
    ctx.quadraticCurveTo(cx, cy, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
    ctx.strokeStyle = withAlpha(env.colors[(targetIdx.get(f.b) ?? 0) % env.colors.length]!, 0.3 + 0.5 * (f.v / maxV));
    ctx.lineWidth = 1 + (mini ? 3 : 7) * (f.v / maxV);
    ctx.stroke();
  });
  nodes.forEach((n, i) => {
    const ang = angOf(i);
    const x = cx + Math.cos(ang) * R;
    const y = cy + Math.sin(ang) * R;
    const dotR = (mini ? 2.5 : 3.5) + (mini ? 2 : 4) * Math.sqrt(nodeTotal.get(n)! / maxNode);
    dot(ctx, x, y, dotR, nodeColor(n), 1, ink.bg);
    const col = sourceSet.has(n) ? xi : ci;
    const half = Math.min(Math.PI / nodes.length, Math.max(dotR, 6) / R);
    hitArc(env, cx, cy, Math.max(0, R - dotR), R + dotR, ang - half, ang + half, [[col, n]], firstRowIndex(rows, col, n), {
      columns: [fieldName(env, col), aggregateAxisTitle(how, fieldName(env, yi) || null)],
      row: [n, nodeTotal.get(n)!],
    });
    if (mini) return;
    const right = Math.cos(ang) >= 0;
    const lx = cx + Math.cos(ang) * (R + 12);
    const ly = cy + Math.sin(ang) * (R + 12);
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.text;
    ctx.textAlign = Math.abs(Math.cos(ang)) < 0.2 ? "center" : right ? "left" : "right";
    ctx.textBaseline = Math.sin(ang) > 0.6 ? "top" : Math.sin(ang) < -0.6 ? "bottom" : "middle";
    const room = right ? env.w - 4 - lx : lx - 4;
    ctx.fillText(fitTextEllipsis(ctx, n, Math.max(24, Math.min(room, 120))), lx, ly);
  });
  footer.draw(footerTop);
}

// ---- voronoi ---------------------------------------------------------------

type Pt2 = { x: number; y: number };

/** Clip a convex polygon to the half-plane closer to `a` than to `b`. */
function clipCloser(poly: Pt2[], a: Pt2, b: Pt2): Pt2[] {
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const c = (nx * (a.x + b.x) + ny * (a.y + b.y)) / 2;
  const side = (p: Pt2) => nx * p.x + ny * p.y - c;
  const out: Pt2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

function drawVoronoi(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Voronoi needs two numeric columns";
  let pts = rows
    .map((r, ri) => ({ x: toNum(r[xi]), y: toNum(r[yi]), c: ci >= 0 ? String(r[ci]) : "", ri }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return `No rows have numeric ${fieldName(env, xi, "x")} and ${fieldName(env, yi, "y")}`;
  const cap = env.mini ? 40 : 150;
  if (pts.length > cap) pts = Array.from({ length: cap }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (cap - 1))]!);
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), 5, true);
  const ys = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), 5, true);
  const plot = basePlot(env);
  const sx = linear(xs.min, xs.max, plot.left, plot.right);
  const sy = linear(ys.min, ys.max, plot.bottom, plot.top);
  const mapped = pts.map((p) => ({ x: sx(p.x), y: sy(p.y), c: p.c, ri: p.ri }));
  const catIdx = categoryIndex(rows, ci);
  const colorOf = (c: string) => (ci >= 0 ? env.colors[(catIdx.get(c) ?? 0) % env.colors.length]! : env.single);
  const rect: Pt2[] = [
    { x: plot.left, y: plot.top },
    { x: plot.right, y: plot.top },
    { x: plot.right, y: plot.bottom },
    { x: plot.left, y: plot.bottom },
  ];
  mapped.forEach((p, i) => {
    let poly = rect;
    for (let j = 0; j < mapped.length && poly.length; j++) {
      if (j === i) continue;
      const q = mapped[j]!;
      if (q.x === p.x && q.y === p.y) continue;
      poly = clipCloser(poly, p, q);
    }
    if (poly.length < 3) return;
    ctx.beginPath();
    poly.forEach((v, k) => (k === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();
    ctx.fillStyle = withAlpha(colorOf(p.c), ci >= 0 ? 0.32 : 0.16);
    ctx.fill();
    ctx.strokeStyle = withAlpha(ink.bg, 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  for (const p of mapped) {
    dot(ctx, p.x, p.y, mini ? 1.8 : 3, colorOf(p.c), 1, ink.bg);
    const row = rows[p.ri]!;
    const match: [number, string][] = [[xi, String(row[xi])], [yi, String(row[yi])]];
    if (ci >= 0) match.push([ci, p.c]);
    hitCircle(env, p.x, p.y, mini ? 1.8 : 3, match, p.ri);
  }
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), fieldName(env, yi), env.look);
  if (ci >= 0) drawPanelLegend(ctx, env, legendEntriesFor(rows, ci, env.colors), fieldName(env, ci), plot, "top-right");
}

// ---- isometric bars / scatter ----------------------------------------------

function drawIsoBars(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the bars";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(
    0,
    env.opts.topN != null ? Math.max(3, Math.min(30, Math.round(env.opts.topN))) : 12,
  );
  if (!entries.length) return "Nothing positive to stack into bars";
  const layout = resolveLayoutDirection(env.opts.layoutDirection, false);
  const { mini, ink } = env;
  const base = basePlot(env);
  const n = entries.length;
  const bandW = (base.right - base.left) / n;
  const depth = Math.max(3, Math.min(14, bandW * 0.3));
  const plot: PlotRect = { ...base, top: base.top + depth * 0.6, right: base.right - depth };
  const bw = Math.max(3, ((plot.right - plot.left) / n) * 0.6);
  const scale = niceTicks(0, Math.max(...entries.map(([, v]) => v)), 5, true);
  const ph = plot.bottom - plot.top;
  // Direction ↓ / ← grow from the top; → flips extrusion to the left.
  const yOf = (v: number) =>
    layout.reverse
      ? plot.top + (v / (scale.max || 1)) * ph
      : plot.bottom - (v / (scale.max || 1)) * ph;
  const step = (plot.right - plot.left) / n;
  const centers = entries.map((_, i) => plot.left + (i + 0.5) * step);
  const front = env.single;
  const sideC = mixColor(front, inkShadow(env.ink), 0.3);
  const topC = mixColor(front, inkHighlight(env.ink), 0.25);
  const dx = layout.horizontal && layout.reverse ? -depth : depth;
  const dy = -depth * 0.6;
  const baseline = layout.reverse ? plot.top : plot.bottom;
  entries.forEach(([, v], i) => {
    const x0 = centers[i]! - bw / 2;
    const x1 = centers[i]! + bw / 2;
    const yT = Math.min(yOf(v), baseline);
    const yB = Math.max(yOf(v), baseline);
    ctx.globalAlpha = Math.max(0.85, env.alpha);
    ctx.fillStyle = sideC;
    ctx.beginPath();
    ctx.moveTo(x1, yB);
    ctx.lineTo(x1 + dx, yB + dy);
    ctx.lineTo(x1 + dx, yT + dy);
    ctx.lineTo(x1, yT);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = topC;
    ctx.beginPath();
    ctx.moveTo(x0, yT);
    ctx.lineTo(x0 + dx, yT + dy);
    ctx.lineTo(x1 + dx, yT + dy);
    ctx.lineTo(x1, yT);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = front;
    ctx.fillRect(x0, yT, bw, yB - yT);
    ctx.globalAlpha = 1;
    const label = entries[i]![0];
    // Hover anywhere on the block (incl. extrusion); focus hugs the front face.
    const hx0 = Math.min(x0, x0 + dx);
    const hx1 = Math.max(x1, x1 + dx);
    const hy0 = Math.min(yT, yT + dy);
    const hy1 = Math.max(yB, yB + dy);
    hitRect(env, hx0, hy0, hx1 - hx0, hy1 - hy0, [[xi, label]], firstRowIndex(rows, xi, label), {
      columns: [fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null)],
      row: [label, v],
    }, { x: x0, y: yT, w: bw, h: Math.max(1, yB - yT) });
  });
  if (mini) return;
  // Floor edge follows the extrusion (fake-3D), not a flat cartesian L-frame.
  ctx.strokeStyle = inkTint(ink, 0.4);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(plot.left, baseline);
  ctx.lineTo(plot.right, baseline);
  ctx.lineTo(plot.right + dx, baseline + dy);
  ctx.lineTo(plot.left + dx, baseline + dy);
  ctx.closePath();
  ctx.stroke();
  // Height ticks along the left riser, parallel to bar extrusion.
  const yTicks = niceTicks(0, scale.max, 4, true);
  ctx.font = oddFont(env, 10);
  ctx.fillStyle = ink.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = inkTint(ink, 0.28);
  for (const v of yTicks.ticks) {
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + dx * 0.35, y + dy * 0.35);
    ctx.stroke();
    ctx.fillText(formatAxisValue(v, yTicks.step), plot.left - 4, y);
  }
  drawBandAxisX(ctx, entries.map(([l]) => l), centers, step, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null), env.look);
  ctx.font = oddFont(env, 10);
  ctx.fillStyle = ink.text;
  ctx.textAlign = "center";
  ctx.textBaseline = layout.reverse ? "top" : "bottom";
  if (env.opts.showDataLabels !== false) {
    entries.forEach(([, v], i) => {
      const t = formatDataValue(v);
      if (ctx.measureText(t).width > step - 2) return;
      const tip = yOf(v);
      ctx.fillText(t, centers[i]! + dx / 2, tip + dy + (layout.reverse ? 4 : -3));
    });
  }
}

function drawIsoScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0 || yi < 0) return "Isometric scatter needs two numeric columns";
  let pts = rows
    .map((r, ri) => ({ x: toNum(r[xi]), y: toNum(r[yi]), z: si >= 0 ? toNum(r[si]) : NaN, c: ci >= 0 ? String(r[ci]) : "", row: r, ri }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return `No rows have numeric ${fieldName(env, xi, "x")} and ${fieldName(env, yi, "y")}`;
  const cap = env.mini ? 80 : 400;
  if (pts.length > cap) pts = Array.from({ length: cap }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (cap - 1))]!);
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), 4, true);
  const ys = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), 4, true);
  const zVals = pts.map((p) => p.z).filter(Number.isFinite);
  const zs = zVals.length ? niceTicks(Math.min(...zVals), Math.max(...zVals), 3, true) : null;
  const zH = zs ? 0.9 : 0;
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = 0.5;
  const floorOrient = resolveIsoFloorOrient(env.opts.layoutDirection);
  const mapFloor = (nx: number, ny: number): { nx: number; ny: number } => {
    switch (floorOrient) {
      case 1:
        return { nx: ny, ny: 1 - nx };
      case 2:
        return { nx: 1 - nx, ny: 1 - ny };
      case 3:
        return { nx: 1 - ny, ny: nx };
      default:
        return { nx, ny };
    }
  };
  // Unit-space projection, then fit to the plot (with room for edge labels).
  const iso = (nx0: number, ny0: number, nz: number) => {
    const { nx, ny } = mapFloor(nx0, ny0);
    return { X: (nx - ny) * cos30, Y: (nx + ny) * sin30 - nz * zH };
  };
  const corners = [iso(0, 0, 0), iso(1, 0, 0), iso(0, 1, 0), iso(1, 1, 0), iso(0, 0, 1), iso(0, 1, 1)];
  const minX = Math.min(...corners.map((c) => c.X));
  const maxX = Math.max(...corners.map((c) => c.X));
  const minY = Math.min(...corners.map((c) => c.Y));
  const maxY = Math.max(...corners.map((c) => c.Y));
  const base = basePlot(env);
  const margin = mini ? 2 : 34;
  const availW = base.right - base.left - 2 * margin;
  const availH = base.bottom - base.top - margin;
  const k = Math.max(1, Math.min(availW / (maxX - minX), availH / (maxY - minY)));
  const ox = (base.left + base.right) / 2 - ((minX + maxX) / 2) * k;
  const oy = base.top + (availH - (maxY - minY) * k) / 2 - minY * k;
  const proj = (nx: number, ny: number, nz: number) => {
    const p = iso(nx, ny, nz);
    return { sx: ox + p.X * k, sy: oy + p.Y * k };
  };
  const nX = (v: number) => (v - xs.min) / (xs.max - xs.min || 1);
  const nY = (v: number) => (v - ys.min) / (ys.max - ys.min || 1);
  const nZ = (v: number) => (zs && Number.isFinite(v) ? (v - zs.min) / (zs.max - zs.min || 1) : 0);

  // Floor
  const f = [proj(0, 0, 0), proj(1, 0, 0), proj(1, 1, 0), proj(0, 1, 0)];
  ctx.beginPath();
  f.forEach((c, i) => (i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy)));
  ctx.closePath();
  ctx.fillStyle = inkTint(ink, ink.light ? 0.04 : 0.05);
  ctx.fill();
  ctx.strokeStyle = inkTint(ink, 0.3);
  ctx.lineWidth = 1;
  ctx.stroke();
  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.beginPath();
    for (const v of xs.ticks) {
      const a = proj(nX(v), 0, 0);
      const b = proj(nX(v), 1, 0);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
    }
    for (const v of ys.ticks) {
      const a = proj(0, nY(v), 0);
      const b = proj(1, nY(v), 0);
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
    }
    ctx.stroke();
  }
  // Points back to front (after Direction remap), with drop lines when height is encoded.
  const catIdx = categoryIndex(rows, ci);
  const drawn = pts
    .map((p) => {
      const nx0 = nX(p.x);
      const ny0 = nY(p.y);
      const floor = mapFloor(nx0, ny0);
      return { p, n: [nx0, ny0, nZ(p.z)] as const, depth: floor.nx + floor.ny };
    })
    .sort((a, b) => a.depth - b.depth || a.n[2] - b.n[2]);
  const r = mini ? 2 : radiusFromPointSize(env.opts.pointSize, 3.2);
  for (const d of drawn) {
    const top = proj(d.n[0], d.n[1], d.n[2]);
    if (zs) {
      const foot = proj(d.n[0], d.n[1], 0);
      ctx.strokeStyle = inkTint(ink, 0.25);
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(foot.sx, foot.sy);
      ctx.lineTo(top.sx, top.sy);
      ctx.stroke();
    }
    const color = ci >= 0 ? env.colors[(catIdx.get(d.p.c) ?? 0) % env.colors.length]! : env.single;
    mark(ctx, env, d.p.row, top.sx, top.sy, r, color, env.alpha, ink.bg);
    const match: [number, string][] = [[xi, String(d.p.row[xi])], [yi, String(d.p.row[yi])]];
    if (ci >= 0) match.push([ci, d.p.c]);
    hitCircle(env, top.sx, top.sy, r, match, d.p.ri);
  }
  if (mini) return;
  // Tick labels on the two floor edges from the origin — stay on the diamond after Direction.
  const o = proj(0, 0, 0);
  ctx.strokeStyle = inkTint(ink, 0.4);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(o.sx, o.sy);
  ctx.lineTo(proj(1, 0, 0).sx, proj(1, 0, 0).sy);
  ctx.moveTo(o.sx, o.sy);
  ctx.lineTo(proj(0, 1, 0).sx, proj(0, 1, 0).sy);
  ctx.stroke();

  ctx.font = oddFont(env, 10);
  ctx.fillStyle = ink.muted;
  ctx.textBaseline = "top";
  for (const v of xs.ticks) {
    const p = proj(nX(v), 0, 0);
    ctx.strokeStyle = inkTint(ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy);
    ctx.lineTo(p.sx - 4, p.sy + 7);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(formatAxisValue(v, xs.step), p.sx - 2, p.sy + 8);
  }
  for (const v of ys.ticks) {
    const p = proj(0, nY(v), 0);
    ctx.strokeStyle = inkTint(ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy);
    ctx.lineTo(p.sx + 4, p.sy + 7);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText(formatAxisValue(v, ys.step), p.sx + 6, p.sy + 6);
  }
  ctx.font = oddFont(env, 10, 600);
  ctx.fillStyle = ink.text;
  const xm = proj(0.55, 0, 0);
  const ym = proj(0, 0.55, 0);
  ctx.textAlign = "center";
  ctx.fillText(fitTextEllipsis(ctx, `${fieldName(env, xi)} →`, env.w / 2 - 20), xm.sx, xm.sy + 22);
  ctx.textAlign = "left";
  ctx.fillText(fitTextEllipsis(ctx, `← ${fieldName(env, yi)}`, env.w / 2 - 20), ym.sx + 10, ym.sy + 18);
  if (zs) {
    const p0 = proj(0, 0, 0);
    const p1 = proj(0, 0, 1);
    ctx.strokeStyle = inkTint(ink, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of zs.ticks) {
      const p = proj(0, 0, nZ(v));
      ctx.fillText(formatAxisValue(v, zs.step), p.sx - 6, p.sy);
    }
    ctx.font = oddFont(env, 10, 600);
    ctx.fillStyle = ink.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, `↑ ${fieldName(env, si)}`, 140), p1.sx, p1.sy - 4);
  }
  const isoKey = markLegendEntries(rows, env, ci);
  if (isoKey) drawPanelLegend(ctx, env, isoKey.entries, isoKey.title, base, "top-right");
}

// ---- mosaic ----------------------------------------------------------------

function drawMosaic(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || ci < 0) return "Mosaic needs two category columns";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const xs = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 10);
  const catIdx = categoryIndex(rows, ci);
  const ys = [...catIdx.keys()].slice(0, 8);
  const cell = new Map<string, number>();
  for (const r of rows) {
    const a = String(r[xi]);
    const b = String(r[ci]);
    if (!xs.includes(a) || !ys.includes(b)) continue;
    const add = yi >= 0 && how !== "count" ? toNum(r[yi]) : 1;
    if (!Number.isFinite(add) || add <= 0) continue;
    const key = `${a}||${b}`;
    cell.set(key, (cell.get(key) ?? 0) + add);
  }
  const colTotals = xs.map((a) => ys.reduce((s, b) => s + (cell.get(`${a}||${b}`) ?? 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  if (!(grand > 0)) return "No positive values to tile";
  const { mini, ink } = env;
  const legend = ys.map((b) => ({ label: b, color: env.colors[(catIdx.get(b) ?? 0) % env.colors.length]! }));
  const base = basePlot(env);
  const legH = mini ? 0 : drawSwatchRow(ctx, legend, 0, 0, base.right - base.left, ink, env.font, { axisFontSize: env.opts.axisFontSize, measureOnly: true, maxRows: 2 });
  const plot = mini ? base : { ...base, bottom: Math.min(base.bottom, env.h - 6 - legH - 22) };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  let xCursor = plot.left;
  const gap = mini ? 1 : 2;
  xs.forEach((a, ai) => {
    const colW = (colTotals[ai]! / grand) * pw;
    if (colW <= 0) return;
    let yCursor = plot.top;
    const colTotal = colTotals[ai]! || 1;
    ys.forEach((b) => {
      const v = cell.get(`${a}||${b}`) ?? 0;
      const segH = (v / colTotal) * ph;
      if (segH <= 0) return;
      const color = env.colors[(catIdx.get(b) ?? 0) % env.colors.length]!;
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0.8, env.alpha);
      ctx.fillRect(xCursor, yCursor, Math.max(0, colW - gap), Math.max(0, segH - gap));
      ctx.globalAlpha = 1;
      hitRect(env, xCursor, yCursor, Math.max(1, colW - gap), Math.max(1, segH - gap), [[xi, a], [ci, b]], undefined, {
        columns: [fieldName(env, xi), fieldName(env, ci), aggregateAxisTitle(how, fieldName(env, yi) || null), "share"],
        row: [a, b, v, percentLabel(v / colTotal)],
      });
      if (!mini && colW - gap >= 30 && segH - gap >= 14) {
        ctx.font = oddFont(env, 10);
        ctx.fillStyle = inkOn(color);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(percentLabel(v / colTotal), xCursor + (colW - gap) / 2, yCursor + (segH - gap) / 2);
      }
      yCursor += segH;
    });
    if (!mini && colW >= 18) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, a, colW - 4), xCursor + colW / 2, plot.bottom + 4);
    }
    xCursor += colW;
  });
  if (mini) return;
  ctx.font = oddFont(env, 10);
  ctx.fillStyle = ink.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const p of [0, 0.25, 0.5, 0.75, 1]) ctx.fillText(`${Math.round(p * 100)}%`, plot.left - 6, plot.bottom - p * ph);
  ctx.save();
  ctx.translate(Math.max(10, plot.left - 40), (plot.top + plot.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(fitTextEllipsis(ctx, `Share within ${fieldName(env, xi)} · width = ${aggregateAxisTitle(how, fieldName(env, yi) || null).toLowerCase()}`, ph), 0, 0);
  ctx.restore();
  drawSwatchRow(ctx, legend, plot.left, plot.bottom + 20, pw, ink, env.font, { axisFontSize: env.opts.axisFontSize, maxRows: 2, align: "center" });
}

// ---- contour ---------------------------------------------------------------

/** Marching-squares segments for one threshold on a scalar grid (grid[j][i]). */
function isoSegments(grid: number[][], th: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const gh = grid.length;
  const gw = grid[0]?.length ?? 0;
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (th - a) / (b - a));
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const a = grid[j]![i]!;
      const b = grid[j]![i + 1]!;
      const c = grid[j + 1]![i + 1]!;
      const d = grid[j + 1]![i]!;
      const code = (a > th ? 8 : 0) | (b > th ? 4 : 0) | (c > th ? 2 : 0) | (d > th ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top: [number, number] = [i + lerp(a, b), j];
      const right: [number, number] = [i + 1, j + lerp(b, c)];
      const bottom: [number, number] = [i + lerp(d, c), j + 1];
      const left: [number, number] = [i, j + lerp(a, d)];
      const seg = (p: [number, number], q: [number, number]) => out.push([p[0], p[1], q[0], q[1]]);
      switch (code) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
  }
  return out;
}

function drawContour(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0 || yi < 0) return "Contour needs two numeric columns";
  const pts = rows
    .map((r) => ({ x: toNum(r[xi]), y: toNum(r[yi]) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(0, env.mini ? 400 : 4000);
  if (pts.length < 4) return "Need at least four points for a density surface";
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), 5, true);
  const ys = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), 5, true);
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const gw = mini ? 30 : Math.max(24, Math.min(80, Math.round(pw / 8)));
  const gh = mini ? 22 : Math.max(18, Math.min(60, Math.round(ph / 8)));
  const grid = Array.from({ length: gh + 1 }, () => new Array<number>(gw + 1).fill(0));
  const sigma = Math.max(1.2, Math.min(gw, gh) / 14);
  const reach = Math.ceil(sigma * 2.5);
  for (const p of pts) {
    const gx = ((p.x - xs.min) / (xs.max - xs.min || 1)) * gw;
    const gy = (1 - (p.y - ys.min) / (ys.max - ys.min || 1)) * gh;
    const i0 = Math.round(gx);
    const j0 = Math.round(gy);
    for (let jj = j0 - reach; jj <= j0 + reach; jj++) {
      for (let ii = i0 - reach; ii <= i0 + reach; ii++) {
        if (ii < 0 || jj < 0 || ii > gw || jj > gh) continue;
        grid[jj]![ii]! += Math.exp(-((ii - gx) ** 2 + (jj - gy) ** 2) / (2 * sigma * sigma));
      }
    }
  }
  let gmax = 0;
  for (const row of grid) for (const v of row) gmax = Math.max(gmax, v);
  if (!(gmax > 0)) return "No density to draw";
  const stops = sequentialStops(ink, env.opts.continuousStops);
  const colorAt = (t: number) => rampColor(stops, t);
  const cellW = pw / gw;
  const cellH = ph / gh;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const t = (grid[j]![i]! + grid[j]![i + 1]! + grid[j + 1]![i]! + grid[j + 1]![i + 1]!) / (4 * gmax);
      if (t < 0.04) continue;
      ctx.fillStyle = colorAt(t);
      ctx.fillRect(plot.left + i * cellW, plot.top + j * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
  // No points are drawn: register coarse density blocks (4×4 cells) as summary rects.
  const blk = 4;
  for (let j = 0; j < gh; j += blk) {
    for (let i = 0; i < gw; i += blk) {
      const j1 = Math.min(gh, j + blk);
      const i1 = Math.min(gw, i + blk);
      let sum = 0;
      let n = 0;
      for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) { sum += grid[jj]![ii]!; n++; }
      const t = sum / (n * gmax);
      if (t < 0.04) continue;
      const x0v = xs.min + (i / gw) * (xs.max - xs.min);
      const x1v = xs.min + (i1 / gw) * (xs.max - xs.min);
      const y1v = ys.max - (j / gh) * (ys.max - ys.min);
      const y0v = ys.max - (j1 / gh) * (ys.max - ys.min);
      hitRect(env, plot.left + i * cellW, plot.top + j * cellH, (i1 - i) * cellW, (j1 - j) * cellH, [], undefined, {
        columns: [fieldName(env, xi), fieldName(env, yi), "density"],
        row: [`${formatDataValue(x0v)}–${formatDataValue(x1v)}`, `${formatDataValue(y0v)}–${formatDataValue(y1v)}`, percentLabel(t)],
      });
    }
  }
  const levels = [0.2, 0.4, 0.6, 0.8];
  for (const th of levels) {
    const segs = isoSegments(grid.map((r) => r.map((v) => v / gmax)), th);
    ctx.strokeStyle = th >= 0.6 ? inkOn(colorAt(th)) : withAlpha(ink.text, 0.45);
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of segs) {
      ctx.moveTo(plot.left + x0 * cellW, plot.top + y0 * cellH);
      ctx.lineTo(plot.left + x1 * cellW, plot.top + y1 * cellH);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), fieldName(env, yi), env.look);
  const kw = Math.max(90, Math.min(150, pw * 0.3));
  drawRampKey(ctx, {
    x: plot.right - kw - 6,
    y: plot.top + 6,
    width: kw,
    min: 0,
    max: 1,
    colorAt,
    title: "Point density",
    endLabels: ["sparse", "dense"],
    ink,
    axisFontSize: env.opts.axisFontSize, fontFamily: env.font,
    panel: true,
  });
}

// ---- calendar heatmap ------------------------------------------------------

const DAY_MS = 86_400_000;

/** Epoch ms for a date-ish cell (Date, ISO / date string, epoch s or ms); NaN otherwise. */
function toTime(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "bigint") v = Number(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return NaN;
    // Bare years (1990) and small counts aren't instants.
    if (Math.abs(v) < 1e9) return NaN;
    return Math.abs(v) < 1e11 ? v * 1000 : v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const t = Date.parse(v.trim().replace(" ", "T"));
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

const WEEKDAY_SHORT = ["Mon", "", "Wed", "", "Fri", "", ""];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function drawCalendar(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Calendar needs a date column";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const byDay = new Map<number, { vals: number[]; ri: number }>();
  for (let i = 0; i < rows.length; i++) {
    const t = toTime(rows[i]![xi]);
    if (!Number.isFinite(t)) continue;
    const day = Math.floor(t / DAY_MS);
    let d = byDay.get(day);
    if (!d) {
      d = { vals: [], ri: i };
      byDay.set(day, d);
    }
    const v = yi >= 0 ? toNum(rows[i]![yi]) : 1;
    if (Number.isFinite(v)) d.vals.push(v);
  }
  if (byDay.size < 2) return "Calendar needs dates spread over at least two days";
  const days = [...byDay.keys()].sort((a, b) => a - b);
  let last = days[days.length - 1]!;
  let first = days[0]!;
  // At most a year of weeks — keep the most recent stretch.
  const maxDays = 7 * 53 - 1;
  const clipped = last - first > maxDays;
  if (clipped) first = last - maxDays;
  // Week columns start on Monday (1970-01-01 was a Thursday → +3).
  const dow = (d: number) => (((d + 3) % 7) + 7) % 7;
  const start = first - dow(first);
  last = Math.max(last, first);
  const weeks = Math.floor((last - start) / 7) + 1;
  const values = new Map<number, number>();
  for (const [d, g] of byDay) if (d >= first && g.vals.length) values.set(d, agg(g.vals, how));
  const vs = [...values.values()];
  if (!vs.length) return "No numeric values on those dates";
  const lo = Math.min(0, ...vs);
  const hi = Math.max(...vs);
  const { mini, ink } = env;
  const stops = sequentialStops(ink, env.opts.continuousStops);
  const colorAt = (t: number) => rampColor(stops, 0.12 + 0.88 * t);
  const measure = aggregateAxisTitle(how, fieldName(env, yi) || null);
  const footer = layoutFooter(ctx, env, {
    ramp: { min: lo, max: hi, colorAt, title: `${measure} per day` },
    caption: clipped ? `Showing the latest 53 weeks of ${days.length} dated days` : undefined,
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const leftGutter = mini ? 0 : 30;
  const topGutter = mini ? 0 : 18;
  const pw = plot.right - plot.left - leftGutter;
  const ph = plot.bottom - plot.top - topGutter;
  const cell = Math.max(2, Math.min(pw / weeks, ph / 7, mini ? 14 : 26));
  const gridW = cell * weeks;
  const ox = plot.left + leftGutter + Math.max(0, (pw - gridW) / 2);
  const oy = plot.top + topGutter + Math.max(0, (ph - cell * 7) / 2);
  const gap = cell > 8 ? 1.5 : cell > 4 ? 0.75 : 0;
  const empty = inkTint(ink, ink.light ? 0.07 : 0.1);
  const span = hi - lo || 1;
  for (let d = first; d <= last; d++) {
    const col = Math.floor((d - start) / 7);
    const row = dow(d);
    const x = ox + col * cell + gap / 2;
    const y = oy + row * cell + gap / 2;
    const v = values.get(d);
    ctx.fillStyle = v == null ? empty : colorAt((v - lo) / span);
    ctx.fillRect(x, y, cell - gap, cell - gap);
    if (v == null) continue;
    const iso = new Date(d * DAY_MS).toISOString().slice(0, 10);
    const ri = byDay.get(d)?.ri;
    hitRect(env, x, y, cell - gap, cell - gap, ri != null ? [[xi, String(rows[ri]![xi] ?? "")]] : [], ri, {
      columns: ["date", measure],
      row: [iso, v],
    });
  }
  if (mini) {
    footer.draw(footerTop);
    return;
  }
  ctx.font = oddFont(env, 10);
  ctx.fillStyle = ink.muted;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  if (cell >= 9) WEEKDAY_SHORT.forEach((lbl, r) => lbl && ctx.fillText(lbl, ox - 5, oy + (r + 0.5) * cell));
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  let lastLabelEnd = -Infinity;
  for (let col = 0; col < weeks; col++) {
    const weekStart = start + col * 7;
    const date = new Date(Math.max(weekStart, first) * DAY_MS);
    const prev = new Date((Math.max(weekStart, first) - 7) * DAY_MS);
    if (col > 0 && date.getUTCMonth() === prev.getUTCMonth()) continue;
    const x = ox + col * cell;
    const label = date.getUTCMonth() === 0 || col === 0 ? `${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}` : MONTH_SHORT[date.getUTCMonth()]!;
    if (x < lastLabelEnd + 6) continue;
    ctx.fillText(label, x, oy - 4);
    lastLabelEnd = x + ctx.measureText(label).width;
  }
  footer.draw(footerTop);
}

// ---- nightingale rose -----------------------------------------------------

function drawRose(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0) return "Choose a category for the rose";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const cap = env.opts.topN != null ? Math.max(3, Math.min(24, Math.round(env.opts.topN))) : 12;
  const totals = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(0, cap);
  if (!totals.length) return "Nothing positive to draw petals for";
  const stacked = ci >= 0 && ci !== xi && (how === "sum" || how === "count");
  const catIdx = categoryIndex(rows, ci);
  // Per wedge: stacked segments by Color (sum / count only — means don't stack).
  const segs = new Map<string, Map<string, number[]>>();
  if (stacked) {
    const keep = new Set(totals.map(([k]) => k));
    for (const r of rows) {
      const k = String(r[xi] ?? "");
      if (!keep.has(k)) continue;
      const c = String(r[ci]);
      const v = yi >= 0 ? toNum(r[yi]) : 1;
      if (!Number.isFinite(v)) continue;
      let m = segs.get(k);
      if (!m) segs.set(k, (m = new Map()));
      let arr = m.get(c);
      if (!arr) m.set(c, (arr = []));
      arr.push(v);
    }
  }
  const { mini, ink } = env;
  const plot = basePlot(env);
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  ctx.font = oddFont(env, 10);
  const labelRoom = mini ? 0 : Math.min(64, Math.max(28, Math.max(...totals.map(([l]) => ctx.measureText(l).width)) * 0.55 + 12));
  const maxR = Math.max(16, Math.min(plot.right - plot.left, plot.bottom - plot.top) / 2 - labelRoom + (mini ? 0 : env.pad * 0.4));
  const vmax = Math.max(...totals.map(([, v]) => v));
  // Area-true: radius ∝ √value, so a wedge's area reads as its share.
  const rOf = (v: number) => maxR * Math.sqrt(Math.max(0, v) / (vmax || 1));
  const slice = (Math.PI * 2) / totals.length;
  const startA = -Math.PI / 2;
  if (!mini) {
    const scale = niceTicks(0, vmax, 3, false);
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.lineWidth = 1;
    for (const v of scale.ticks) {
      if (v <= 0 || v > vmax) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rOf(v), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  totals.forEach(([label, total], i) => {
    const a0 = startA + i * slice + (mini ? 0.01 : 0.02);
    const a1 = startA + (i + 1) * slice - (mini ? 0.01 : 0.02);
    const ri = firstRowIndex(rows, xi, label);
    const wedge = (r0: number, r1: number, fill: string) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.globalAlpha = Math.max(0.78, env.alpha);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ink.bg;
      ctx.lineWidth = mini ? 0.5 : 1;
      ctx.stroke();
    };
    if (stacked) {
      const parts = [...(segs.get(label) ?? new Map()).entries()]
        .map(([c, vs]) => [c, agg(vs, how)] as [string, number])
        .filter(([, v]) => v > 0)
        .sort((a, b) => (catIdx.get(a[0]) ?? 0) - (catIdx.get(b[0]) ?? 0));
      let acc = 0;
      for (const [c, v] of parts) {
        const r0 = rOf(acc);
        acc += v;
        const r1 = rOf(acc);
        wedge(r0, r1, env.colors[(catIdx.get(c) ?? 0) % env.colors.length]!);
        hitArc(env, cx, cy, r0, r1, a0, a1, [[xi, label], [ci, c]], ri, {
          columns: [fieldName(env, xi), fieldName(env, ci), aggregateAxisTitle(how, fieldName(env, yi) || null)],
          row: [label, c, v],
        });
      }
    } else {
      wedge(0, rOf(total), env.colors[i % env.colors.length]!);
      hitArc(env, cx, cy, 0, rOf(total), a0, a1, [[xi, label]], ri, {
        columns: [fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null)],
        row: [label, total],
      });
    }
    if (mini) return;
    const am = (a0 + a1) / 2;
    const r = Math.max(rOf(total), maxR * 0.25);
    const lx = cx + Math.cos(am) * (r + 6);
    const ly = cy + Math.sin(am) * (r + 6);
    const right = Math.cos(am) >= 0;
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.text;
    ctx.textAlign = Math.abs(Math.cos(am)) < 0.2 ? "center" : right ? "left" : "right";
    ctx.textBaseline = Math.sin(am) > 0.6 ? "top" : Math.sin(am) < -0.6 ? "bottom" : "middle";
    const room = right ? env.w - 4 - lx : lx - 4;
    const text = env.opts.showDataLabels ? `${label} · ${formatDataValue(total)}` : label;
    ctx.fillText(fitTextEllipsis(ctx, text, Math.max(24, Math.min(room, 140))), lx, ly);
  });
  if (stacked) drawPanelLegend(ctx, env, legendEntriesFor(rows, ci, env.colors), fieldName(env, ci), plot, "top-right");
}

// ---- ECDF ------------------------------------------------------------------

function drawEcdf(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, _yi: number, ci: number) {
  if (xi < 0) return "ECDF needs a numeric column";
  const series = new Map<string, number[]>();
  const catIdx = categoryIndex(rows, ci);
  for (const r of rows) {
    const v = toNum(r[xi]);
    if (!Number.isFinite(v)) continue;
    const k = ci >= 0 ? String(r[ci]) : "";
    if (ci >= 0 && !series.has(k) && series.size >= 8) continue;
    let arr = series.get(k);
    if (!arr) series.set(k, (arr = []));
    arr.push(v);
  }
  const all = [...series.values()].flat();
  if (all.length < 3) return "ECDF needs at least three numeric values";
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...all), Math.max(...all), 5, true);
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const sx = (v: number) => plot.left + ((v - xs.min) / (xs.max - xs.min || 1)) * pw;
  const sy = (p: number) => plot.bottom - p * ph;
  if (!mini) {
    drawChartGrid(ctx, env.w, env.h, plot, gridLook(env));
    // Median guide
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = inkTint(ink, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, Math.round(sy(0.5)) + 0.5);
    ctx.lineTo(plot.right, Math.round(sy(0.5)) + 0.5);
    ctx.stroke();
    ctx.restore();
  }
  const entries: SwatchEntry[] = [];
  ctx.lineCap = env.opts.lineCap ?? "round";
  ctx.lineJoin = env.opts.lineJoin ?? "round";
  for (const [k, vals] of series) {
    vals.sort((a, b) => a - b);
    const color = ci >= 0 ? env.colors[(catIdx.get(k) ?? 0) % env.colors.length]! : env.single;
    const n = vals.length;
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.2 : 2;
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    ctx.beginPath();
    ctx.moveTo(plot.left, sy(0));
    ctx.lineTo(sx(vals[0]!), sy(0));
    for (let i = 0; i < n; i++) {
      const x = sx(vals[i]!);
      ctx.lineTo(x, sy(i / n));
      ctx.lineTo(x, sy((i + 1) / n));
    }
    ctx.lineTo(plot.right, sy(1));
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Hover: ~40 evenly spaced quantiles per series.
    const step = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n; i += step) {
      const p = (i + 1) / n;
      const match: [number, string][] = [[xi, String(vals[i])]];
      if (ci >= 0) match.push([ci, k]);
      hitCircle(env, sx(vals[i]!), sy(p), 4, match, undefined, {
        columns: [...(ci >= 0 ? [fieldName(env, ci)] : []), fieldName(env, xi), "share at or below"],
        row: [...(ci >= 0 ? [k] : []), vals[i]!, percentLabel(p)],
      });
    }
    if (ci >= 0) entries.push({ label: `${k} (n=${n})`, color, shape: "line" });
  }
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, env.w, env.h, plot, env.look, { yFormat: (v) => `${Math.round(v * 100)}%` });
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), "share of rows ≤ value", env.look);
  if (entries.length) drawPanelLegend(ctx, env, entries, fieldName(env, ci), plot, "bottom-right");
}

// ---- sparkline grid --------------------------------------------------------

function drawSparkGrid(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Sparkline grid needs an order column and a numeric column";
  const how = env.opts.yAggregate ?? "mean";
  const model = orderedKeys(rows, xi, env.mini ? 30 : 60, true);
  if (model.keys.length < 2) return "Need at least two points along the order column";
  const keyPos = new Map(model.keys.map((k, i) => [k, i]));
  const cap = env.opts.topN != null ? Math.max(2, Math.min(36, Math.round(env.opts.topN))) : env.mini ? 9 : 24;
  const panels = new Map<string, number[][]>();
  const volume = new Map<string, number>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const p = keyPos.get(model.keyOf(r));
    if (p == null) continue;
    const name = ci >= 0 ? String(r[ci]) : fieldName(env, yi);
    let buckets = panels.get(name);
    if (!buckets) panels.set(name, (buckets = model.keys.map(() => [])));
    buckets[p]!.push(v);
    volume.set(name, (volume.get(name) ?? 0) + Math.abs(v));
  }
  const names = [...panels.keys()].sort((a, b) => volume.get(b)! - volume.get(a)!).slice(0, cap);
  if (!names.length) return "No numeric values to draw";
  const { mini, ink } = env;
  const series = names.map((name) =>
    panels.get(name)!.map((vs, i) => ({ i, v: vs.length ? agg(vs, how) : NaN })).filter((p) => Number.isFinite(p.v)),
  );
  const hidden = panels.size - names.length;
  const footer = layoutFooter(ctx, env, {
    caption: `${aggregateAxisTitle(how, fieldName(env, yi))} along ${fieldName(env, xi)} · each panel on its own scale${hidden > 0 ? ` · ${hidden} smaller panel${hidden === 1 ? "" : "s"} hidden` : ""}`,
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const grid = multiplesGrid(names.length, plot);
  const headH = mini ? 0 : chartTypeRamp(env.opts.axisFontSize).mark + 6;
  const n = model.keys.length;
  names.forEach((name, idx) => {
    const pts = series[idx]!;
    const gx = plot.left + (idx % grid.cols) * grid.cw;
    const gy = plot.top + Math.floor(idx / grid.cols) * grid.ch;
    const inner = { l: gx + 6, r: gx + grid.cw - 6, t: gy + headH + 4, b: gy + grid.ch - 6 };
    if (!mini) {
      ctx.strokeStyle = inkTint(ink, ink.light ? 0.1 : 0.12);
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(gx + 2) + 0.5, Math.round(gy + 2) + 0.5, grid.cw - 4, grid.ch - 4);
    }
    if (pts.length < 1 || inner.b - inner.t < 6) return;
    const lo = Math.min(...pts.map((p) => p.v));
    const hi = Math.max(...pts.map((p) => p.v));
    const span = hi - lo || 1;
    const sx = (i: number) => inner.l + (n === 1 ? 0.5 : model.pos[i]!) * (inner.r - inner.l);
    const sy = (v: number) => inner.b - ((v - lo) / span) * (inner.b - inner.t);
    const color = env.colors[idx % env.colors.length]!;
    // Soft area under the line, then the line.
    ctx.beginPath();
    ctx.moveTo(sx(pts[0]!.i), inner.b);
    for (const p of pts) ctx.lineTo(sx(p.i), sy(p.v));
    ctx.lineTo(sx(pts[pts.length - 1]!.i), inner.b);
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.14);
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(sx(p.i), sy(p.v)) : ctx.moveTo(sx(p.i), sy(p.v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1 : 1.6;
    ctx.lineJoin = env.opts.lineJoin ?? "round";
    ctx.lineCap = env.opts.lineCap ?? "round";
    ctx.stroke();
    const lastP = pts[pts.length - 1]!;
    dot(ctx, sx(lastP.i), sy(lastP.v), mini ? 1.6 : 2.6, color, 1, mini ? null : ink.bg);
    for (const p of pts) {
      const match: [number, string][] = [];
      if (ci >= 0) match.push([ci, name]);
      hitCircle(env, sx(p.i), sy(p.v), 4, match, undefined, {
        columns: [...(ci >= 0 ? [fieldName(env, ci)] : []), fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi))],
        row: [...(ci >= 0 ? [name] : []), model.kind === "time" ? formatDateCell(model.keys[p.i]!) : model.keys[p.i]!, p.v],
      });
    }
    if (mini) return;
    ctx.font = oddFont(env, 10, 600);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = ink.text;
    const valueText = formatDataValue(lastP.v);
    ctx.font = oddFont(env, 10);
    const valueW = ctx.measureText(valueText).width;
    ctx.font = oddFont(env, 10, 600);
    ctx.fillText(fitTextEllipsis(ctx, name, Math.max(20, grid.cw - 18 - valueW)), gx + 7, gy + 5);
    ctx.font = oddFont(env, 10);
    ctx.textAlign = "right";
    ctx.fillStyle = ink.muted;
    ctx.fillText(valueText, gx + grid.cw - 7, gy + 5);
  });
  footer.draw(footerTop);
}

// ---- density curve ---------------------------------------------------------

/** Gaussian KDE on an even grid; Silverman bandwidth. */
function kde(vals: number[], lo: number, hi: number, n: number): number[] {
  const m = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / m;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, m - 1));
  const sorted = [...vals].sort((a, b) => a - b);
  const iqr = (sorted[Math.floor(m * 0.75)] ?? 0) - (sorted[Math.floor(m * 0.25)] ?? 0);
  const spread = Math.min(sd || Infinity, iqr > 0 ? iqr / 1.34 : Infinity);
  const bw = Math.max(1e-9, 0.9 * (Number.isFinite(spread) ? spread : (hi - lo) / 10 || 1) * m ** -0.2);
  const out = new Array<number>(n).fill(0);
  const k = 1 / (m * bw * Math.sqrt(2 * Math.PI));
  for (let i = 0; i < n; i++) {
    const x = lo + ((hi - lo) * i) / (n - 1);
    let s = 0;
    for (const v of vals) {
      const z = (x - v) / bw;
      if (z > -5 && z < 5) s += Math.exp(-0.5 * z * z);
    }
    out[i] = s * k;
  }
  return out;
}

function seriesBy(rows: unknown[][], vi: number, ci: number, max = 8): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const v = toNum(r[vi]);
    if (!Number.isFinite(v)) continue;
    const k = ci >= 0 ? String(r[ci]) : "";
    if (ci >= 0 && !out.has(k) && out.size >= max) continue;
    let arr = out.get(k);
    if (!arr) out.set(k, (arr = []));
    arr.push(v);
  }
  return out;
}

function drawDensity(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, _yi: number, ci: number) {
  if (xi < 0) return "Density needs a numeric column";
  const series = [...seriesBy(rows, xi, ci).entries()].filter(([, v]) => v.length >= 3);
  if (!series.length) return "Density needs at least three numeric values";
  const all = series.flatMap(([, v]) => v);
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...all), Math.max(...all), 5, true);
  const N = mini ? 60 : 160;
  const curves = series.map(([k, v]) => ({ k, n: v.length, vals: v, d: kde(v, xs.min, xs.max, N) }));
  const peak = Math.max(...curves.flatMap((c) => c.d));
  if (!(peak > 0)) return "Values are identical — no spread to draw";
  const ys = niceTicks(0, peak, 4, true);
  const plot = basePlot(env);
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const sx = (v: number) => plot.left + ((v - xs.min) / (xs.max - xs.min || 1)) * pw;
  const sy = (d: number) => plot.bottom - (d / (ys.max || 1)) * ph;
  const catIdx = categoryIndex(rows, ci);
  if (!mini) drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: [xs.min, xs.max], y: [ys.min, ys.max] });
  const entries: SwatchEntry[] = [];
  ctx.lineJoin = env.opts.lineJoin ?? "round";
  for (const c of curves) {
    const color = ci >= 0 ? env.colors[(catIdx.get(c.k) ?? 0) % env.colors.length]! : env.single;
    const xAt = (i: number) => sx(xs.min + ((xs.max - xs.min) * i) / (N - 1));
    // Soft fill fading to the baseline, then the curve.
    const grad = ctx.createLinearGradient(0, plot.top, 0, plot.bottom);
    // Many overlapping groups: lines only (fills would stack into a wash).
    grad.addColorStop(0, withAlpha(color, curves.length > 1 ? 0.24 : 0.42));
    grad.addColorStop(1, withAlpha(color, 0.03));
    if (curves.length <= 3) {
      ctx.beginPath();
      ctx.moveTo(xAt(0), plot.bottom);
      c.d.forEach((d, i) => ctx.lineTo(xAt(i), sy(d)));
      ctx.lineTo(xAt(N - 1), plot.bottom);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.beginPath();
    c.d.forEach((d, i) => (i ? ctx.lineTo(xAt(i), sy(d)) : ctx.moveTo(xAt(i), sy(d))));
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.2 : 2;
    ctx.stroke();
    // Rug of raw values along the floor.
    if (!mini && curves.length <= 3 && c.vals.length <= 600) {
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of c.vals) {
        ctx.moveTo(Math.round(sx(v)) + 0.5, plot.bottom);
        ctx.lineTo(Math.round(sx(v)) + 0.5, plot.bottom - 5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const sorted = [...c.vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    for (let i = 0; i < N; i += Math.max(1, Math.floor(N / 40))) {
      const xv = xs.min + ((xs.max - xs.min) * i) / (N - 1);
      hitCircle(env, xAt(i), sy(c.d[i]!), 4, ci >= 0 ? [[ci, c.k]] : [], undefined, {
        columns: [...(ci >= 0 ? [fieldName(env, ci)] : []), fieldName(env, xi), "density", "rows", "median"],
        row: [...(ci >= 0 ? [c.k] : []), formatDataValue(xv), formatDataValue(c.d[i]!), c.n, median],
      });
    }
    if (ci >= 0) entries.push({ label: `${c.k} (n=${c.n})`, color, shape: "line" });
  }
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), "density", env.look);
  if (entries.length) drawPanelLegend(ctx, env, entries, fieldName(env, ci), plot, "top-right");
}

// ---- Q–Q plot --------------------------------------------------------------

/** Inverse standard normal CDF (Acklam's rational approximation). */
function normalQuantile(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function drawQq(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number) {
  if (xi < 0) return "Q–Q plot needs a numeric column";
  let vals = rows.map((r) => toNum(r[xi])).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length < 5) return "Q–Q plot needs at least five numeric values";
  const cap = env.mini ? 200 : 1500;
  if (vals.length > cap) vals = Array.from({ length: cap }, (_, i) => vals[Math.round((i * (vals.length - 1)) / (cap - 1))]!);
  const n = vals.length;
  const pts = vals.map((v, i) => ({ z: normalQuantile((i + 0.5) / n), v }));
  const { mini, ink } = env;
  const xs = niceTicks(pts[0]!.z, pts[n - 1]!.z, 5, true);
  const ys = niceTicks(vals[0]!, vals[n - 1]!, 5, true);
  const plot = basePlot(env);
  const sx = (z: number) => plot.left + ((z - xs.min) / (xs.max - xs.min || 1)) * (plot.right - plot.left);
  const sy = (v: number) => plot.bottom - ((v - ys.min) / (ys.max - ys.min || 1)) * (plot.bottom - plot.top);
  if (!mini) drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: [xs.min, xs.max], y: [ys.min, ys.max] });
  // Reference line through the quartiles (robust to tails).
  const q1 = vals[Math.floor(n * 0.25)]!;
  const q3 = vals[Math.floor(n * 0.75)]!;
  const z1 = normalQuantile(0.25);
  const slope = (q3 - q1) / (2 * -z1 || 1);
  const icpt = q1 - slope * z1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = inkTint(ink, 0.55);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(sx(xs.min), sy(icpt + slope * xs.min));
  ctx.lineTo(sx(xs.max), sy(icpt + slope * xs.max));
  ctx.stroke();
  ctx.restore();
  const r = mini ? 1.6 : Math.max(2, Math.min(4, 180 / Math.sqrt(n)));
  // Points far from the line glow in the second palette color.
  const resid = pts.map((p) => Math.abs(p.v - (icpt + slope * p.z)));
  const rs = [...resid].sort((a, b) => a - b);
  const cut = rs[Math.floor(rs.length * 0.9)] ?? Infinity;
  const off = env.colors[1 % env.colors.length]!;
  pts.forEach((p, i) => {
    const far = resid[i]! > cut && resid[i]! > (q3 - q1) * 0.25;
    dot(ctx, sx(p.z), sy(p.v), r, far ? off : env.single, env.alpha, mini ? null : ink.bg);
    if (i % Math.max(1, Math.floor(n / 300)) === 0 || far) {
      hitCircle(env, sx(p.z), sy(p.v), Math.max(r, 4), [[xi, String(p.v)]], undefined, {
        columns: [fieldName(env, xi), "normal quantile", "percentile", "vs normal line"],
        row: [p.v, formatDataValue(p.z), percentLabel((i + 0.5) / n), formatDataValue(p.v - (icpt + slope * p.z))],
      });
    }
  });
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, env.w, env.h, plot, env.look, { xFormat: (v) => `${v > 0 ? "+" : ""}${formatAxisValue(v, xs.step)}σ` });
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, "Normal quantile", fieldName(env, xi), env.look);
  drawPanelLegend(ctx, env, [
    { label: "Normal line", color: inkTint(ink, 0.55), shape: "line" },
    { label: "Farthest 10%", color: off },
  ], undefined, plot, "top-left");
}

// ---- connected scatter -----------------------------------------------------

function drawConnectedScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, _ci: number, si: number) {
  if (xi < 0 || yi < 0) return "Connected scatter needs two numeric columns";
  type P = { x: number; y: number; o: number; label: string; ri: number };
  // No Order chosen: follow a date column when the table has one, else row order.
  if (si < 0) {
    for (let c = 0; c < env.columns.length && si < 0; c++) {
      if (c === xi || c === yi) continue;
      const sample = rows.slice(0, 30).map((r) => r[c]);
      if (sample.length && sample.filter((v) => typeof v !== "number" && Number.isFinite(toTime(v))).length >= sample.length * 0.8) si = c;
    }
  }
  let pts: P[] = [];
  rows.forEach((r, i) => {
    const x = toNum(r[xi]);
    const y = toNum(r[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const raw = si >= 0 ? r[si] : i;
    const t = si >= 0 ? (Number.isFinite(toTime(raw)) ? toTime(raw) : toNum(raw)) : i;
    if (!Number.isFinite(t)) return;
    pts.push({ x, y, o: t, label: si >= 0 ? String(raw) : String(i + 1), ri: i });
  });
  if (pts.length < 3) return "Need at least three points to connect";
  pts.sort((a, b) => a.o - b.o);
  // Many rows per step: average each order value into one point.
  const byO = new Map<number, P[]>();
  for (const p of pts) {
    let g = byO.get(p.o);
    if (!g) byO.set(p.o, (g = []));
    g.push(p);
  }
  pts = [...byO.values()].map((g) => ({ ...g[0]!, x: g.reduce((s, p) => s + p.x, 0) / g.length, y: g.reduce((s, p) => s + p.y, 0) / g.length }));
  // A long order reads as noise: fold it into ~40 equal steps, averaging each.
  const steps = env.mini ? 24 : 40;
  if (pts.length > steps * 1.5) {
    const lo = pts[0]!.o;
    const width = (pts[pts.length - 1]!.o - lo) / steps || 1;
    const bins = new Map<number, P[]>();
    for (const p of pts) {
      const b = Math.min(steps - 1, Math.floor((p.o - lo) / width));
      let g = bins.get(b);
      if (!g) bins.set(b, (g = []));
      g.push(p);
    }
    pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => ({
      ...g[0]!,
      x: g.reduce((s, p) => s + p.x, 0) / g.length,
      y: g.reduce((s, p) => s + p.y, 0) / g.length,
    }));
  }
  const { mini, ink } = env;
  const xs = niceTicks(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), 5, true);
  const ys = niceTicks(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), 5, true);
  const plot = basePlot(env);
  const sx = (v: number) => plot.left + ((v - xs.min) / (xs.max - xs.min || 1)) * (plot.right - plot.left);
  const sy = (v: number) => plot.bottom - ((v - ys.min) / (ys.max - ys.min || 1)) * (plot.bottom - plot.top);
  if (!mini) drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: [xs.min, xs.max], y: [ys.min, ys.max] });
  const stops = sequentialStops(ink, env.opts.continuousStops);
  const colorAt = (i: number) => rampColor(stops, 0.25 + 0.75 * (i / Math.max(1, pts.length - 1)));
  ctx.lineCap = env.opts.lineCap ?? "round";
  ctx.lineJoin = env.opts.lineJoin ?? "round";
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    ctx.strokeStyle = colorAt(i);
    ctx.globalAlpha = Math.max(0.6, env.alpha);
    ctx.lineWidth = mini ? 1 : 1.8;
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    ctx.lineTo(sx(b.x), sy(b.y));
    ctx.stroke();
    // Small chevron mid-segment shows travel direction.
    const len = Math.hypot(sx(b.x) - sx(a.x), sy(b.y) - sy(a.y));
    if (!mini && len > 22 && pts.length <= 120) {
      const ang = Math.atan2(sy(b.y) - sy(a.y), sx(b.x) - sx(a.x));
      const mx = (sx(a.x) + sx(b.x)) / 2;
      const my = (sy(a.y) + sy(b.y)) / 2;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ang) * 4, my + Math.sin(ang) * 4);
      ctx.lineTo(mx + Math.cos(ang + 2.5) * 4, my + Math.sin(ang + 2.5) * 4);
      ctx.lineTo(mx + Math.cos(ang - 2.5) * 4, my + Math.sin(ang - 2.5) * 4);
      ctx.closePath();
      ctx.fillStyle = colorAt(i);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const r = mini ? 1.6 : pts.length > 150 ? 2.2 : 3.4;
  pts.forEach((p, i) => {
    mark(ctx, env, rows[p.ri], sx(p.x), sy(p.y), i === 0 || i === pts.length - 1 ? r * 1.5 : r, colorAt(i), 1, mini ? null : ink.bg);
    hitCircle(env, sx(p.x), sy(p.y), Math.max(r, 4), [[xi, String(rows[p.ri]![xi])], [yi, String(rows[p.ri]![yi])]], p.ri, {
      columns: [si >= 0 ? `${fieldName(env, si)} (from)` : "step", `${fieldName(env, xi)} (mean)`, `${fieldName(env, yi)} (mean)`],
      row: [/^\d{4}-\d{2}-\d{2}/.test(p.label) ? formatDateCell(p.label) : p.label, p.x, p.y],
    });
  });
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), fieldName(env, yi), env.look);
  // Label the journey's ends.
  const when = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? formatDateCell(v) : v);
  ctx.font = oddFont(env, 10, 600);
  ctx.textBaseline = "bottom";
  const s0 = pts[0]!;
  const s1 = pts[pts.length - 1]!;
  const crowded = Math.abs(sy(s0.y) - sy(s1.y)) < 18 && Math.abs(sx(s0.x) - sx(s1.x)) < 170;
  for (const [p, tag] of [[s0, "start"], [s1, "end"]] as const) {
    const x = sx(p.x);
    const below = crowded && tag === "end";
    ctx.textBaseline = below ? "top" : "bottom";
    const y = below ? sy(p.y) + r * 1.5 + 3 : sy(p.y) - r * 1.5 - 3;
    const text = fitTextEllipsis(ctx, `${tag} · ${when(p.label)}`, 160);
    ctx.textAlign = x > (plot.left + plot.right) / 2 ? "right" : "left";
    ctx.strokeStyle = ink.bg;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = ink.text;
    ctx.fillText(text, x, y);
  }
}

// ---- warming stripes -------------------------------------------------------

function drawStripes(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0 || yi < 0) return "Stripes need an order column and a numeric column";
  const model = orderedKeys(rows, xi, env.mini ? 40 : 90, true);
  const sums = new Map<string, number[]>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const k = model.keyOf(r);
    let arr = sums.get(k);
    if (!arr) sums.set(k, (arr = []));
    arr.push(v);
  }
  const how = env.opts.yAggregate ?? "mean";
  const pts = model.keys.map((k) => ({ k, v: sums.has(k) ? agg(sums.get(k)!, how) : NaN })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 3) return "Stripes need at least three ordered values";
  const { mini, ink } = env;
  const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length;
  // Scale to ±2.5σ (capped at the extreme) so typical swings show real color.
  const sd = Math.sqrt(pts.reduce((a, p) => a + (p.v - mean) ** 2, 0) / pts.length);
  const dev = Math.min(Math.max(...pts.map((p) => Math.abs(p.v - mean))), 2.5 * sd) || 1;
  // Diverging around the series mean: the palette's first color below, its last above,
  // through a neutral middle — any palette (auto is Cool–Warm) reads as cooler vs warmer.
  const cs = env.opts.continuousStops?.length ? env.opts.continuousStops : env.colors;
  const stops = [cs[0]!, inkTint(ink, 0.78), cs[cs.length - 1]!];
  const colorAt = (v: number) => rampColor(stops, 0.5 + (0.5 * (v - mean)) / dev);
  const measure = aggregateAxisTitle(how, fieldName(env, yi));
  const footer = layoutFooter(ctx, env, {
    ramp: { min: mean - dev, max: mean + dev, colorAt, title: `${measure} vs its average (${formatDataValue(mean)})`, endLabels: ["below", "above"] },
  });
  const { plot, footerTop } = plotAboveFooter(env, footer.height);
  const bottom = mini ? plot.bottom : plot.bottom - 16;
  const sw = (plot.right - plot.left) / pts.length;
  pts.forEach((p, i) => {
    const x = plot.left + i * sw;
    ctx.fillStyle = colorAt(p.v);
    ctx.fillRect(Math.floor(x), plot.top, Math.ceil(sw) + 0.5, bottom - plot.top);
    hitRect(env, x, plot.top, sw, bottom - plot.top, [], undefined, {
      columns: [fieldName(env, xi), measure, "vs average"],
      row: [model.kind === "time" ? formatDateCell(p.k) : p.k, p.v, `${p.v >= mean ? "+" : ""}${formatDataValue(p.v - mean)}`],
    }, { x, y: plot.top, w: sw, h: bottom - plot.top });
  });
  if (!mini) {
    const when = (v: string) => (model.kind === "time" ? formatDateCell(v).slice(0, 10) : v);
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, when(pts[0]!.k), 140), plot.left, bottom + 4);
    ctx.textAlign = "right";
    ctx.fillText(fitTextEllipsis(ctx, when(pts[pts.length - 1]!.k), 140), plot.right, bottom + 4);
  }
  footer.draw(footerTop);
}

// ---- word cloud ------------------------------------------------------------

type WordBox = { x: number; y: number; w: number; h: number };
type CloudWord = { word: string; v: number; color: string; group: string; rank: number };
type PlacedCloudWord = CloudWord & { f: number; x: number; y: number; box: WordBox };

function cloudFontLimits(env: OddEnv, plot: PlotRect): { minF: number; maxF: number } {
  const ph = Math.max(1, plot.bottom - plot.top);
  const { mini } = env;
  const mark = chartTypeRamp(env.opts.axisFontSize).mark;
  const minF = Math.min(mini ? 6 : Math.max(11, mark), Math.max(8, ph / 5));
  const maxF = Math.max(minF + 4, Math.min(mini ? 22 : 64, ph / 4));
  return { minF, maxF };
}

/** Room for a group name or “groups left out” line. Matches the font `oddFont` actually paints. */
function cloudChrome(env: OddEnv): number {
  if (env.mini) return 0;
  return chartTypeRamp(env.opts.axisFontSize).mark + 6;
}

function cloudWeight(rank: number): number {
  return rank < 3 ? 700 : rank < 12 ? 600 : 400;
}

/** How many words a region can hold before the spiral is mostly misses. */
function cloudWordCap(env: OddEnv, plot: PlotRect): number {
  const base = env.opts.topN != null ? Math.max(5, Math.min(150, Math.round(env.opts.topN))) : env.mini ? 30 : 80;
  const area = Math.max(1, (plot.right - plot.left) * (plot.bottom - plot.top));
  return Math.min(base, Math.max(5, Math.round(area / 1800)));
}

/** Spiral-pack words inside `plot`. Font size uses the shared `vmax` and `maxF`. */
function packWordCloud(
  ctx: CanvasRenderingContext2D,
  env: OddEnv,
  words: CloudWord[],
  plot: PlotRect,
  vmax: number,
  minF: number,
  maxF: number,
): PlacedCloudWord[] {
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  if (pw < 8 || ph < 8 || !(vmax > 0)) return [];
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  const ax = pw / Math.max(1, ph);
  const placed: PlacedCloudWord[] = [];
  const boxes: WordBox[] = [];
  const floor = Math.max(11, chartTypeRamp(env.opts.axisFontSize).mark);
  words.forEach((word) => {
    let f = Math.round(Math.max(minF, maxF * Math.sqrt(word.v / vmax)));
    // oddFont never paints below the mark size — measure and collide at that size.
    const paintAt = (n: number) => Math.max(floor, n);
    // Weight follows the word's rank, the same weight paint uses — a bolder face is wider.
    ctx.font = oddFont(env, paintAt(f), cloudWeight(word.rank));
    const natural = ctx.measureText(word.word).width;
    if (natural > pw * 0.92) {
      f = Math.max(minF, Math.floor((f * pw * 0.92) / Math.max(1, natural)));
      ctx.font = oddFont(env, paintAt(f), cloudWeight(word.rank));
    }
    f = paintAt(f);
    const tw = Math.min(ctx.measureText(word.word).width, pw * 0.92);
    const box = { w: tw + 4, h: f * 1.15 };
    for (let s = 0; s < 900; s++) {
      const ang = s * 0.32;
      const rad = 1.6 * Math.sqrt(s) * Math.max(2, f * 0.18);
      const x = cx + Math.cos(ang) * rad * Math.sqrt(ax) - box.w / 2;
      const y = cy + Math.sin(ang) * rad / Math.sqrt(ax) - box.h / 2;
      if (x < plot.left || y < plot.top || x + box.w > plot.right || y + box.h > plot.bottom) continue;
      const b = { x, y, ...box };
      if (boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)) continue;
      boxes.push(b);
      placed.push({ ...word, f, x: x + box.w / 2, y: y + box.h / 2, box: b });
      return;
    }
  });
  return placed;
}

function paintPackedWords(
  ctx: CanvasRenderingContext2D,
  env: OddEnv,
  rows: unknown[][],
  placed: PlacedCloudWord[],
  xi: number,
  yi: number,
  ci: number,
  how: YAggregateOption,
  plotWidth: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of placed) {
    ctx.font = oddFont(env, p.f, cloudWeight(p.rank));
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.rank < 12 ? 1 : Math.max(0.7, env.alpha);
    ctx.fillText(fitTextEllipsis(ctx, p.word, Math.min(p.box.w, plotWidth * 0.92)), p.x, p.y);
    const match: [number, string][] = [[xi, p.word]];
    if (ci >= 0 && p.group && p.group !== "tie") match.push([ci, p.group]);
    const rowIndex = rows.findIndex(
      (r) =>
        String(r[xi] ?? "") === p.word &&
        (ci < 0 || !p.group || p.group === "tie" || String(r[ci] ?? "") === p.group),
    );
    hitRect(env, p.box.x, p.box.y, p.box.w, p.box.h, match, rowIndex >= 0 ? rowIndex : undefined, {
      columns: [fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null), "group", "rank"],
      row: [p.word, p.v, p.group, `#${p.rank + 1}`],
    });
  }
  ctx.globalAlpha = 1;
}

function drawWordCloud(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0) return "Word cloud needs a text or category column";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const mode = env.opts.wordCloudMode === "compare" || env.opts.wordCloudMode === "grid" ? env.opts.wordCloudMode : "cloud";
  const { mini, ink } = env;
  const plot = basePlot(env);

  if (mode === "cloud") {
    const words = groupSum(rows, xi, yi, how)
      .filter(([k, v]) => v > 0 && k.trim() !== "" && k !== "null")
      .slice(0, cloudWordCap(env, plot));
    if (!words.length) return "No positive values to size words by";
    const limits = cloudFontLimits(env, plot);
    const vmax = words[0]![1];
    let maxF = limits.maxF;
    const cloudWords: CloudWord[] = words.map(([word, v], rank) => ({
      word,
      v,
      color: env.colors[rank % env.colors.length]!,
      group: "",
      rank,
    }));
    let placed: PlacedCloudWord[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      placed = packWordCloud(ctx, env, cloudWords, plot, vmax, limits.minF, maxF);
      if (placed.length >= cloudWords.length * 0.9) break;
      maxF *= 0.8;
    }
    paintPackedWords(ctx, env, rows, placed, xi, yi, -1, how, plot.right - plot.left);
    const dropped = cloudWords.length - placed.length;
    if (!mini && dropped > 0) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${dropped} smaller word${dropped === 1 ? "" : "s"} didn’t fit`, plot.right, plot.bottom);
    }
    return;
  }

  if (ci < 0) return "Pick a Compare by column to compare word clouds";
  const { byWord, groupWeight } = wordTotalsByGroup(rows, xi, yi, ci, how);
  const groups = topGroupsByWeight(groupWeight, mode === "compare" ? 2 : 8);
  if (groups.length < 2) return "Compare by needs at least two groups";

  if (mode === "compare") {
    const leftName = groups[0]!;
    const rightName = groups[1]!;
    const hidden = groupWeight.size - 2;
    const assigned = assignWordCloudCompare(byWord, leftName, rightName).slice(0, cloudWordCap(env, plot));
    if (!assigned.length) return "No positive values to size words by";
    const chrome = cloudChrome(env);
    const footer = hidden > 0 ? chrome : 0;
    const header = chrome;
    const stage: PlotRect = { ...plot, top: plot.top + header, bottom: plot.bottom - footer };
    const pw = stage.right - stage.left;
    const centerW = Math.min(pw * 0.2, 110);
    const cx = (stage.left + stage.right) / 2;
    const leftPlot: PlotRect = { ...stage, right: cx - centerW / 2 };
    const rightPlot: PlotRect = { ...stage, left: cx + centerW / 2 };
    const centerPlot: PlotRect = { ...stage, left: cx - centerW / 2, right: cx + centerW / 2 };
    const sideCap = (region: PlotRect) => cloudWordCap(env, region);
    const leftWords = assigned.filter((w) => w.side === "left").slice(0, sideCap(leftPlot));
    const rightWords = assigned.filter((w) => w.side === "right").slice(0, sideCap(rightPlot));
    const centerWords = assigned.filter((w) => w.side === "center").slice(0, sideCap(centerPlot));
    const shown = [...leftWords, ...rightWords, ...centerWords];
    const vmax = Math.max(...shown.map((w) => w.value));
    const limits = cloudFontLimits(env, stage);
    const toCloud = (list: typeof shown, color: string): CloudWord[] =>
      list.map((w) => ({ word: w.word, v: w.value, color, group: w.group, rank: assigned.findIndex((a) => a.word === w.word) }));
    const placed = [
      ...packWordCloud(ctx, env, toCloud(leftWords, env.colors[0]!), leftPlot, vmax, limits.minF, limits.maxF),
      ...packWordCloud(ctx, env, toCloud(rightWords, env.colors[1 % env.colors.length]!), rightPlot, vmax, limits.minF, limits.maxF),
      ...packWordCloud(ctx, env, toCloud(centerWords, ink.muted), centerPlot, vmax, limits.minF, limits.maxF),
    ];
    if (!placed.length) return "No positive values to size words by";
    paintPackedWords(ctx, env, rows, placed, xi, yi, ci, how, Math.max(leftPlot.right - leftPlot.left, rightPlot.right - rightPlot.left));
    if (!mini) {
      ctx.font = oddFont(env, 11, 600);
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = env.colors[0]!;
      ctx.fillText(fitTextEllipsis(ctx, leftName, leftPlot.right - leftPlot.left), leftPlot.left, plot.top);
      ctx.textAlign = "right";
      ctx.fillStyle = env.colors[1 % env.colors.length]!;
      ctx.fillText(fitTextEllipsis(ctx, rightName, rightPlot.right - rightPlot.left), rightPlot.right, plot.top);
      if (hidden > 0) {
        ctx.font = oddFont(env, 10);
        ctx.fillStyle = ink.muted;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(
          fitTextEllipsis(
            ctx,
            `Comparing ${leftName} and ${rightName} · ${hidden} other group${hidden === 1 ? "" : "s"} left out`,
            plot.right - plot.left,
          ),
          plot.left,
          plot.bottom,
        );
      }
    }
    return;
  }

  const hidden = groupWeight.size - groups.length;
  const chrome = cloudChrome(env);
  const headH = chrome;
  const gridPlot: PlotRect = { ...plot, bottom: plot.bottom - (hidden > 0 ? chrome : 0) };
  const grid = multiplesGrid(groups.length, gridPlot);
  const panels = groups.map((name) => {
    const words = [...byWord.entries()]
      .map(([word, totals]) => [word, totals.get(name) ?? 0] as [string, number])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    return { name, words };
  });
  const cellPlot = (idx: number): PlotRect => {
    const gx = gridPlot.left + (idx % grid.cols) * grid.cw;
    const gy = gridPlot.top + Math.floor(idx / grid.cols) * grid.ch;
    return { left: gx + 4, right: gx + grid.cw - 4, top: gy + headH + 2, bottom: gy + grid.ch - 4 };
  };
  const capped = panels.map((panel, idx) => ({
    ...panel,
    words: panel.words.slice(0, cloudWordCap(env, cellPlot(idx))),
  }));
  const vmax = Math.max(1, ...capped.flatMap((p) => p.words.map(([, v]) => v)));
  const limits = cloudFontLimits(env, cellPlot(0));
  const placed: PlacedCloudWord[] = [];
  capped.forEach((panel, idx) => {
    const region = cellPlot(idx);
    const color = env.colors[idx % env.colors.length]!;
    const cloudWords: CloudWord[] = panel.words.map(([word, v], rank) => ({ word, v, color, group: panel.name, rank }));
    placed.push(...packWordCloud(ctx, env, cloudWords, region, vmax, limits.minF, limits.maxF));
    if (!mini) {
      ctx.font = oddFont(env, 11, 600);
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const gx = gridPlot.left + (idx % grid.cols) * grid.cw;
      const gy = gridPlot.top + Math.floor(idx / grid.cols) * grid.ch;
      ctx.fillText(fitTextEllipsis(ctx, panel.name, grid.cw - 10), gx + 4, gy + 2);
    }
  });
  if (!placed.length) return "No positive values to size words by";
  paintPackedWords(ctx, env, rows, placed, xi, yi, ci, how, grid.cw - 8);
  if (!mini && hidden > 0) {
    ctx.font = oddFont(env, 10);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      fitTextEllipsis(ctx, `${hidden} smaller group${hidden === 1 ? "" : "s"} hidden`, plot.right - plot.left),
      plot.right,
      plot.bottom,
    );
  }
}

// ---- mean ± CI dot plot ----------------------------------------------------

function drawErrorBars(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Needs a category and a numeric column";
  const groups = new Map<string, { vals: number[]; ris: number[]; ri: number }>();
  rows.forEach((r, i) => {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) return;
    const k = String(r[xi] ?? "");
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { vals: [], ris: [], ri: i }));
    g.vals.push(v);
    g.ris.push(i);
  });
  const cap = env.opts.topN != null ? Math.max(2, Math.min(40, Math.round(env.opts.topN))) : 20;
  const stats = [...groups.entries()]
    .map(([k, g]) => {
      const n = g.vals.length;
      const mean = g.vals.reduce((a, b) => a + b, 0) / n;
      const sd = n > 1 ? Math.sqrt(g.vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
      const half = n > 1 ? 1.96 * (sd / Math.sqrt(n)) : 0;
      return { k, n, mean, lo: mean - half, hi: mean + half, vals: g.vals, ris: g.ris, ri: g.ri };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, cap)
    .sort((a, b) => b.mean - a.mean);
  if (!stats.length) return "No numeric values per group";
  const { mini, ink } = env;
  const all = stats.flatMap((s) => [s.lo, s.hi, ...(mini ? [] : s.vals)]);
  const xs = niceTicks(Math.min(...all), Math.max(...all), 5, true);
  const base = basePlot(env);
  ctx.font = oddFont(env, 10);
  const gutter = mini ? 0 : Math.min((base.right - base.left) * 0.3, Math.max(...stats.map((s) => ctx.measureText(s.k).width)) + 12);
  const plot: PlotRect = { ...base, left: base.left + gutter };
  const sx = (v: number) => plot.left + ((v - xs.min) / (xs.max - xs.min || 1)) * (plot.right - plot.left);
  const band = (plot.bottom - plot.top) / stats.length;
  const catIdx = categoryIndex(rows, ci);
  if (!mini) drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: [xs.min, xs.max], y: null });
  const grand = stats.reduce((a, s) => a + s.mean * s.n, 0) / stats.reduce((a, s) => a + s.n, 0);
  if (!mini) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = inkTint(ink, 0.4);
    ctx.beginPath();
    ctx.moveTo(Math.round(sx(grand)) + 0.5, plot.top);
    ctx.lineTo(Math.round(sx(grand)) + 0.5, plot.bottom);
    ctx.stroke();
    ctx.restore();
  }
  const r = Math.max(2.5, Math.min(6, band * 0.22));
  stats.forEach((s, i) => {
    const cy = plot.top + (i + 0.5) * band;
    // Color splits the raw dots; the estimate stays in ink so it reads over them.
    const color = ci >= 0 ? ink.text : env.single;
    const dotColor = (j: number) => (ci >= 0 ? env.colors[(catIdx.get(String(rows[s.ris[j]!]![ci])) ?? 0) % env.colors.length]! : color);
    // Raw values as a faint jittered strip behind the estimate.
    if (!mini && s.vals.length <= 300) {
      s.vals.forEach((v, j) => {
        const jy = cy + (jitter(s.k, j) - 0.5) * band * 0.55;
        ctx.fillStyle = withAlpha(dotColor(j), ci >= 0 ? 0.5 : 0.22);
        ctx.beginPath();
        ctx.arc(sx(v), jy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.2 : 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx(s.lo), cy);
    ctx.lineTo(sx(s.hi), cy);
    ctx.moveTo(sx(s.lo), cy - r * 0.8);
    ctx.lineTo(sx(s.lo), cy + r * 0.8);
    ctx.moveTo(sx(s.hi), cy - r * 0.8);
    ctx.lineTo(sx(s.hi), cy + r * 0.8);
    ctx.stroke();
    mark(ctx, env, rows[s.ri], sx(s.mean), cy, r, color, 1, mini ? null : ink.bg);
    hitRect(env, plot.left, cy - band / 2, plot.right - plot.left, band, [[xi, s.k]], s.ri, {
      columns: [fieldName(env, xi), `${fieldName(env, yi)} (mean)`, "95% CI", "rows"],
      row: [s.k, s.mean, `${formatDataValue(s.lo)} – ${formatDataValue(s.hi)}`, s.n],
    }, { x: sx(s.lo) - r, y: cy - r, w: sx(s.hi) - sx(s.lo) + 2 * r, h: 2 * r });
    if (!mini && env.opts.showDataLabels) {
      ctx.font = oddFont(env, 10);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const lx = sx(s.hi) + r + 4;
      if (lx < plot.right - 24) ctx.fillText(formatDataValue(s.mean), lx, cy);
    }
  });
  if (mini) return;
  drawAxisFrame(ctx, env.w, env.h, plot, env.look);
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, env.w, env.h, plot, env.look, { y: false });
  drawBandAxisY(ctx, stats.map((s) => s.k), stats.map((_, i) => plot.top + (i + 0.5) * band), band, plot.left - 6, gutter - 8, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, `${fieldName(env, yi)} · mean with 95% interval`, null, env.look);
  if (ci >= 0 && stats.some((st) => st.vals.length <= 300)) drawPanelLegend(ctx, env, legendEntriesFor(rows, ci, env.colors), fieldName(env, ci), plot, "bottom-right");
}
