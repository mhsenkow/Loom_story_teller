// =================================================================
// Loom — GPU / 3D / Particle scene chart kinds (shortlist)
// =================================================================
// WebGL-era scenes from the viz catalog:
//   scatter3d · trailRibbon · quakeTerrain · firefly · loomWeave · dataCube
// Specs stay encoding-portable; pixels prefer WebGPU when available,
// with Canvas 2D fallbacks for capture / unsupported GPUs.
// =================================================================

import type { ColumnInfo } from "./store";
import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";
import { ensureContrast } from "./wcagColor";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import { fitTextEllipsis } from "./chartLayout";
import { formatAxisValue, formatDataValue, niceTicks } from "./chartAxes";
import {
  drawAxisFieldLabels,
  drawAxisFrame,
  drawChartGrid,
  drawChartTicks,
  type ChartLookOpts,
} from "./chartLooks";
import {
  resolveChartInk,
  inkHighlight,
  inkShadow,
  inkTint,
  mixColor,
  withAlpha,
  rampColor,
  rampKeyHeight,
  sequentialStops,
  drawRampKey,
  drawEmptyMessage,
  fontOf,
  radiusFromPointSize,
  type ChartInk,
} from "./chartInk";
import { chartTypeRamp } from "./chartType";
import { pickDataCubeEncoding, rankCubeDimensions } from "./dataCube";
import { orientIsoCell, resolveIsoFloorOrient } from "./isoOrient";

export * from "./gpuScenesRec";
import type {
  GpuSceneKind,
  GpuSceneRenderOpts,
  GpuScenePacked,
  GpuScenePoint,
} from "./gpuScenesRec";
import { extractGpuScenePoints } from "./gpuScenesRec";

// ---------------------------------------------------------------------------
// Canvas 2D fallbacks (capture-safe)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

/** Orbit camera frame shared by the scatter3d / firefly fallbacks. */
type OrbitFrame = { cx: number; cy: number; scale: number; yaw: number; pitch: number };

function orbitFrame(w: number, h: number, pad: number, yaw: number, pitch: number, zoom: number, mini: boolean): OrbitFrame {
  // Sit the scene under the title band; keep a gutter for axis labels.
  const side = mini ? 4 : Math.max(16, pad * 0.5);
  const top = pad;
  const bottom = mini ? pad : Math.max(16, pad * 0.5);
  const availW = Math.max(20, w - 2 * side);
  const availH = Math.max(20, h - top - bottom);
  // Max projected corner offset over every orbit angle is ≈ 2.06 half-sizes
  // (√3 corner radius × perspective), so the box never clips while spinning.
  return { cx: w / 2, cy: top + availH / 2, scale: (Math.min(availW, availH) / 2 / 2.1) * zoom, yaw, pitch };
}

/** Normalized cube coords (-1…1) → screen. Mild perspective so depth reads. */
function projectUnit(f: OrbitFrame, nx: number, ny: number, nz: number): { sx: number; sy: number; depth: number } {
  const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
  const x1 = nx * cy + nz * sy;
  const z1 = -nx * sy + nz * cy;
  const y2 = ny * cp - z1 * sp;
  const z2 = ny * sp + z1 * cp;
  const persp = 3.2 / (3.2 + z2);
  return { sx: f.cx + x1 * f.scale * persp, sy: f.cy - y2 * f.scale * persp, depth: z2 };
}

function norm(v: number, lo: number, hi: number): number {
  return ((v - lo) / (hi - lo || 1)) * 2 - 1;
}

const UNIT_CORNERS: Vec3[] = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) UNIT_CORNERS.push([x, y, z]);
const UNIT_EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function inferMini(opts: GpuSceneRenderOpts, w: number, h: number, pad: number): boolean {
  return opts.mini ?? (pad < 16 || Math.min(w, h) < 220);
}

export function renderGpuSceneCanvas(
  kind: GpuSceneKind,
  ctx: CanvasRenderingContext2D,
  packed: NonNullable<ReturnType<typeof extractGpuScenePoints>>,
  w: number,
  h: number,
  pad: number,
  opts: GpuSceneRenderOpts,
): void {
  const ink = resolveChartInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const mini = kind === "firefly" ? (opts.mini ?? pad < 16) : inferMini(opts, w, h, pad);
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const opacity = opts.opacity ?? 0.85;

  ctx.save();
  if (ink.paintBg) {
    ctx.fillStyle = ink.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (!packed.points.length) {
    drawEmptyMessage(ctx, w, h, "No numeric rows to place in the scene", ink, font, mini, opts.axisFontSize);
    ctx.restore();
    return;
  }

  if (kind === "quakeTerrain") {
    drawQuakeTerrain(ctx, packed, w, h, pad, ink, font, mini, opts);
  } else if (kind === "loomWeave") {
    drawLoomWeave(ctx, packed, w, h, pad, colors, ink, font, mini, opacity, opts.axisFontSize, opts);
  } else if (kind === "trailRibbon") {
    drawTrailRibbons(ctx, packed, w, h, pad, colors, ink, font, mini, opacity, radiusFromPointSize(opts.pointSize, 2.6), opts.axisFontSize, opts);
  } else if (kind === "firefly") {
    drawFireflyField(ctx, packed, w, h, pad, colors, ink, font, mini, opacity, opts);
  } else {
    drawOrbitPoints(kind, ctx, packed, w, h, pad, colors, ink, font, mini, opts);
  }
  ctx.restore();
}

/** A steady glow encodes a measure, real recency, or equal weight — never row order. */
export function fireflyGlowPoints(packed: GpuScenePacked): GpuScenePoint[] {
  if (packed.sizeRange) {
    if (packed.sizeRange[0] !== packed.sizeRange[1]) return packed.points;
    return packed.points.map((p) => ({ ...p, size: 0.5 }));
  }
  const hasTime = !!packed.fields?.time && !!packed.tRange && packed.tRange[1] > packed.tRange[0];
  return packed.points.map((p) => ({ ...p, size: hasTime && p.t >= 0 ? 0.15 + 0.85 * p.t : 0.5 }));
}

/** Keep categorical hues readable against both paper and dark chart surfaces. */
export function fireflyPalette(colors: string[], background: string): string[] {
  return colors.map((color) => ensureContrast(color, background, true));
}

/** Flat x × y plot frame shared by the Canvas fallback and the WebGPU firefly pass. */
export function fireflyLayout(packed: GpuScenePacked, w: number, h: number, pad: number, mini = false) {
  const xs = packed.xCategories
    ? { min: -0.5, max: packed.xCategories.length - 0.5, ticks: packed.xCategories.map((_, i) => i), step: 1 }
    : niceTicks(packed.xMin, packed.xMax, 5, false);
  const ys = niceTicks(packed.yMin, packed.yMax, 5, false);
  const inset = mini ? 6 : pad;
  const left = inset;
  const right = w - inset;
  const top = inset;
  const bottom = h - inset;
  return {
    xs,
    ys,
    left,
    right,
    top,
    bottom,
    sx: (x: number) => left + ((x - xs.min) / (xs.max - xs.min || 1)) * (right - left),
    sy: (y: number) => bottom - ((y - ys.min) / (ys.max - ys.min || 1)) * (bottom - top),
  };
}

/**
 * Additive glow saturates to white once sparks overlap, so dim and shrink them by
 * how crowded the plot is (≈ points per px²). Shared by Canvas and WebGPU paths.
 */
export function fireflyDensity(n: number, plotW: number, plotH: number): { alpha: number; size: number } {
  const area = Math.max(1, plotW * plotH);
  const perPoint = area / Math.max(1, n);
  return {
    // Source-over halos (no additive bloom) can stay brighter when crowded.
    alpha: Math.max(0.4, Math.min(1, perPoint / 600)),
    size: Math.max(0.35, Math.min(1, Math.sqrt(perPoint / 600))),
  };
}

/** Grid, frame, ticks and field titles for the firefly field (also painted above the GPU canvas). */
export function drawFireflyChrome(
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  opts: Partial<GpuSceneRenderOpts>,
): void {
  const ink = resolveChartInk(opts);
  const font = opts.fontFamily ?? "Inter";
  const { xs, ys, left, right, top, bottom } = fireflyLayout(packed, w, h, pad);
  const look: ChartLookOpts = {
    fontFamily: font,
    themeMuted: ink.muted,
    themeBorder: ink.border,
    themeText: ink.text,
    axisFontSize: opts.axisFontSize,
    ...opts,
    axisLabelColor: opts.axisLabelColor ?? ink.muted,
    plotBounds: { left, right, top, bottom },
    sourceFootnote: false,
  };
  ctx.save();
  drawChartGrid(ctx, w, h, pad, { ...look, themeBorder: inkTint(ink, 0.15), gridOpacity: opts.gridOpacity ?? 1 }, { x: [xs.min, xs.max], y: [ys.min, ys.max] });
  drawAxisFrame(ctx, w, h, pad, { ...look, axisLineColor: opts.axisLineColor ?? inkTint(ink, 0.65) });
  if (packed.xCategories) {
    const { sx } = fireflyLayout(packed, w, h, pad);
    ctx.font = fontOf(chartTypeRamp(opts.axisFontSize).tick, font);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const slot = (w - 2 * pad) / Math.max(1, packed.xCategories.length);
    packed.xCategories.forEach((c, i) => ctx.fillText(fitTextEllipsis(ctx, c, Math.max(24, slot - 6)), sx(i), h - pad + 6));
    drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, w, h, pad, look, { x: false });
  } else {
    drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, w, h, pad, look);
  }
  if (packed.fields) drawAxisFieldLabels(ctx, w, h, pad, packed.fields.x, packed.fields.y, look);
  ctx.restore();
}

function drawFireflyField(
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  colors: string[],
  ink: ChartInk,
  font: string,
  mini: boolean,
  opacity: number,
  opts: GpuSceneRenderOpts,
): void {
  const { sx, sy, left, right, top, bottom } = fireflyLayout(packed, w, h, pad, mini);
  const pts = fireflyGlowPoints(packed);
  const crowd = fireflyDensity(pts.length, right - left, bottom - top);
  const base = radiusFromPointSize(opts.pointSize, 3) * (mini ? 0.7 : 1);
  const density = crowd.size;
  // Dim sparks first so the brightest land on top.
  const order = pts.map((_, i) => i).sort((a, b) => pts[a]!.size - pts[b]!.size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  ctx.globalCompositeOperation = "source-over";
  const palette = fireflyPalette(colors, ink.bg);
  for (const i of order) {
    const p = pts[i]!;
    const col = palette[p.category % palette.length] ?? palette[0]!;
    const px = sx(p.x);
    const py = sy(p.y);
    const r = base * density * (0.8 + p.size * 1.8);
    const a = Math.min(1, opacity * crowd.alpha * (ink.light ? 0.75 : 0.6) * (0.3 + p.size * 0.9));
    const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.6);
    g.addColorStop(0, withAlpha(ink.light ? col : mixColor(col, inkHighlight(ink), 0.35 * p.size), a));
    g.addColorStop(0.3, withAlpha(col, a * 0.5));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // A crisp center survives faint halos and crowded or light surfaces.
    ctx.fillStyle = withAlpha(col, Math.min(1, opacity * (0.65 + 0.35 * p.size)));
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.8, r * 0.28), 0, Math.PI * 2);
    ctx.fill();
    if (opts.hits) {
      opts.hits.push({ shape: "circle", cx: px, cy: py, r: Math.max(6, r * 1.6), match: [], rowIndex: p.row ?? p.trail });
    }
  }
  ctx.restore();
  if (!mini) drawFireflyChrome(ctx, packed, w, h, pad, { ...opts, fontFamily: font });
}

function drawOrbitPoints(
  kind: GpuSceneKind,
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  colors: string[],
  ink: ChartInk,
  font: string,
  mini: boolean,
  opts: GpuSceneRenderOpts,
): void {
  const { points, xMin, xMax, yMin, yMax, zMin, zMax } = packed;
  const f = orbitFrame(w, h, pad, opts.yaw ?? 0.55, opts.pitch ?? 0.35, opts.zoom ?? 1, mini);
  const firefly = kind === "firefly";
  const opacity = opts.opacity ?? 0.85;
  const base = radiusFromPointSize(opts.pointSize, 3);
  const corners = UNIT_CORNERS.map((c) => projectUnit(f, c[0], c[1], c[2]));
  let far = 0;
  corners.forEach((c, i) => { if (c.depth > corners[far]!.depth) far = i; });
  const frameInk = inkTint(ink, ink.light ? 0.3 : 0.32);
  const gridInk = inkTint(ink, ink.light ? 0.14 : 0.16);

  // Floor grid + far edges (behind points)
  if (!firefly || !mini) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridInk;
    for (let i = 1; i < 4; i++) {
      const t = -1 + (2 * i) / 4;
      const a = projectUnit(f, t, -1, -1);
      const b = projectUnit(f, t, -1, 1);
      const c = projectUnit(f, -1, -1, t);
      const d = projectUnit(f, 1, -1, t);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.moveTo(c.sx, c.sy);
      ctx.lineTo(d.sx, d.sy);
      ctx.stroke();
    }
    ctx.strokeStyle = frameInk;
    ctx.setLineDash([3, 3]);
    for (const [a, b] of UNIT_EDGES) {
      if (a !== far && b !== far) continue;
      ctx.beginPath();
      ctx.moveTo(corners[a]!.sx, corners[a]!.sy);
      ctx.lineTo(corners[b]!.sx, corners[b]!.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  const projected = points.map((p) => ({ ...projectUnit(f, norm(p.x, xMin, xMax), norm(p.y, yMin, yMax), norm(p.z, zMin, zMax)), p }));
  projected.sort((a, b) => b.depth - a.depth);
  const n = projected.length;
  const density = n > 4000 ? 0.65 : n > 1500 ? 0.8 : 1;

  ctx.save();
  if (firefly) ctx.globalCompositeOperation = ink.light ? "multiply" : "lighter";
  for (const pr of projected) {
    const col = colors[pr.p.category % colors.length] ?? colors[0]!;
    // Nearer points (smaller depth) slightly larger and more opaque.
    const near = 1 - (pr.depth + 1.8) / 3.6;
    if (firefly) {
      const r = base * density * (0.6 + pr.p.size * 2.2) * (0.7 + pr.p.t * 0.5);
      const a = Math.min(1, opacity * (ink.light ? 0.7 : 0.55) * (0.35 + pr.p.size * 0.9));
      const g = ctx.createRadialGradient(pr.sx, pr.sy, 0, pr.sx, pr.sy, r * 3);
      g.addColorStop(0, withAlpha(col, a));
      g.addColorStop(0.35, withAlpha(col, a * 0.45));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, r * 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const sized = packed.sizeRange ? 0.7 + pr.p.size * 1.4 : 1;
      const r = Math.max(mini ? 1.6 : 2, base * density * sized * (0.85 + 0.3 * near));
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(col, opacity * (0.6 + 0.4 * Math.max(0, Math.min(1, near))));
      ctx.fill();
      if (n <= 4000) {
        ctx.strokeStyle = withAlpha(ink.bg, 0.8);
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }
    if (opts.hits) {
      const hitR = firefly ? base * 4 : Math.max(6, base * 2);
      opts.hits.push({
        shape: "circle",
        cx: pr.sx,
        cy: pr.sy,
        r: hitR,
        match: [],
        rowIndex: pr.p.row ?? pr.p.trail,
      });
    }
  }
  ctx.restore();

  // Near edges on top
  ctx.save();
  ctx.strokeStyle = frameInk;
  ctx.lineWidth = 1;
  for (const [a, b] of UNIT_EDGES) {
    if (a === far || b === far) continue;
    ctx.beginPath();
    ctx.moveTo(corners[a]!.sx, corners[a]!.sy);
    ctx.lineTo(corners[b]!.sx, corners[b]!.sy);
    ctx.stroke();
  }
  ctx.restore();

  if (mini) return;
  const fields = packed.fields;
  const center = projectUnit(f, 0, 0, 0);
  // Pick the floor edges nearest the viewer for x / z, and a vertical edge on the side for y.
  const pickEdge = (cands: [Vec3, Vec3][], score: (m: { sx: number; sy: number }) => number) => {
    let best = cands[0]!;
    let bestS = -Infinity;
    for (const e of cands) {
      const a = projectUnit(f, ...e[0]);
      const b = projectUnit(f, ...e[1]);
      const s = score({ sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 });
      if (s > bestS) { bestS = s; best = e; }
    }
    return best;
  };
  const xEdge = pickEdge([[[-1, -1, 1], [1, -1, 1]], [[-1, -1, -1], [1, -1, -1]]], (m) => m.sy);
  const zEdge = pickEdge([[[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]]], (m) => m.sy + Math.abs(m.sx - center.sx) * 0.25);
  const yCands: [Vec3, Vec3][] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) yCands.push([[sx, -1, sz], [sx, 1, sz]]);
  // Height labels go on the side opposite the depth labels so the two never stack.
  const zMid = projectUnit(f, zEdge[0][0], -1, 0);
  const zSide = Math.sign(zMid.sx - center.sx) || 1;
  const yEdge = pickEdge(yCands, (m) => -zSide * (m.sx - center.sx));
  const look = { ink, font, axisFontSize: opts.axisFontSize };
  drawEdgeAxis(ctx, f, xEdge, xMin, xMax, fields?.x ?? "x", center, look, packed.xCategories);
  drawEdgeAxis(ctx, f, zEdge, zMin, zMax, fields?.z ?? "z", center, look);
  drawEdgeAxis(ctx, f, yEdge, yMin, yMax, fields?.y ?? "y", center, look);
}

/** Round tick values along one projected box edge, pushed away from the box center. */
function drawEdgeAxis(
  ctx: CanvasRenderingContext2D,
  f: OrbitFrame,
  edge: [Vec3, Vec3],
  min: number,
  max: number,
  title: string,
  center: { sx: number; sy: number },
  look: { ink: ChartInk; font: string; axisFontSize?: number },
  categories?: string[],
): void {
  const a = projectUnit(f, ...edge[0]);
  const b = projectUnit(f, ...edge[1]);
  const len = Math.hypot(b.sx - a.sx, b.sy - a.sy);
  if (len < 24) return;
  let ox = -(b.sy - a.sy);
  let oy = b.sx - a.sx;
  const mx = (a.sx + b.sx) / 2 - center.sx;
  const my = (a.sy + b.sy) / 2 - center.sy;
  if (ox * mx + oy * my < 0) { ox = -ox; oy = -oy; }
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol;
  oy /= ol;
  ctx.save();
  ctx.font = fontOf(chartTypeRamp(look.axisFontSize).tick, look.font);
  ctx.fillStyle = look.ink.muted;
  ctx.textAlign = ox > 0.35 ? "left" : ox < -0.35 ? "right" : "center";
  ctx.textBaseline = oy > 0.35 ? "top" : oy < -0.35 ? "bottom" : "middle";
  const nt = niceTicks(min, max, Math.max(2, Math.min(5, Math.floor(len / 60))), false);
  const span = max - min || 1;
  const ticks = categories ? categories.map((_, i) => i) : nt.ticks;
  const labelOf = (v: number) => (categories ? fitTextEllipsis(ctx, categories[v] ?? "", 90) : formatAxisValue(v, nt.step));
  let lastX = -Infinity;
  let lastY = -Infinity;
  let widest = 0;
  for (const v of ticks) {
    const t = (v - min) / span;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    const px = a.sx + (b.sx - a.sx) * t + ox * 6;
    const py = a.sy + (b.sy - a.sy) * t + oy * 6;
    const label = labelOf(v);
    const tw = ctx.measureText(label).width;
    // Skip labels that would collide with the previous one along this edge.
    if (Math.abs(px - lastX) < tw + 8 && Math.abs(py - lastY) < chartTypeRamp(look.axisFontSize).tick + 4) continue;
    ctx.fillText(label, px, py);
    lastX = px;
    lastY = py;
    widest = Math.max(widest, tw);
  }
  ctx.font = fontOf(chartTypeRamp(look.axisFontSize).tick, look.font, 600);
  ctx.fillStyle = look.ink.text;
  const reach = 6 + (Math.abs(ox) > 0.35 ? widest + 8 : chartTypeRamp(look.axisFontSize).tick + 6);
  ctx.fillText(fitTextEllipsis(ctx, title, Math.max(60, len)), (a.sx + b.sx) / 2 + ox * reach, (a.sy + b.sy) / 2 + oy * reach);
  ctx.restore();
}

function drawTrailRibbons(
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  colors: string[],
  ink: ChartInk,
  font: string,
  mini: boolean,
  opacity: number,
  baseSize: number,
  axisFontSize?: number,
  edge: Pick<GpuSceneRenderOpts, "lineCap" | "lineJoin" | "hits"> = {},
): void {
  const { points, yMin, yMax } = packed;
  const byTrail = new Map<number, GpuScenePoint[]>();
  for (const p of points) {
    const list = byTrail.get(p.trail) ?? [];
    list.push(p);
    byTrail.set(p.trail, list);
  }

  // Unwrap X per trail so longitude paths don't slash across the ±180° seam.
  type Pt = { x: number; y: number; t: number; size: number; category: number; row?: number };
  const trails: Pt[][] = [];
  let xMin = Infinity, xMax = -Infinity;
  for (const [, list] of byTrail) {
    list.sort((a, b) => a.t - b.t);
    const unwrapped: Pt[] = [];
    let prevX: number | null = null;
    let offset = 0;
    for (const p of list) {
      let x = p.x;
      if (prevX != null) {
        const delta = x + offset - prevX;
        if (delta > 180) offset -= 360;
        else if (delta < -180) offset += 360;
        x = p.x + offset;
      }
      prevX = x;
      unwrapped.push({ x, y: p.y, t: p.t, size: p.size, category: p.category, row: p.row });
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
    }
    if (unwrapped.length) trails.push(unwrapped);
  }
  if (!Number.isFinite(xMin)) {
    drawEmptyMessage(ctx, w, h, "No numeric rows to trace", ink, font, mini, axisFontSize);
    return;
  }

  // Round domains so gridlines / ticks land on whole values and paths never touch the frame.
  const xs = niceTicks(xMin, xMax, 5, true);
  const ys = niceTicks(yMin, yMax, 5, true);
  const left = pad;
  const right = w - pad;
  const top = pad;
  const bottom = h - pad;
  const sx = (x: number) => left + ((x - xs.min) / (xs.max - xs.min || 1)) * (right - left);
  const sy = (y: number) => bottom - ((y - ys.min) / (ys.max - ys.min || 1)) * (bottom - top);

  const look: ChartLookOpts = {
    fontFamily: font,
    axisLabelColor: ink.muted,
    themeMuted: ink.muted,
    themeBorder: ink.border,
    themeText: ink.text,
    axisFontSize,
  };
  if (!mini) {
    drawChartGrid(ctx, w, h, pad, { ...look, themeBorder: inkTint(ink, 0.14), gridOpacity: 1 }, { x: [xs.min, xs.max], y: [ys.min, ys.max] });
    drawAxisFrame(ctx, w, h, pad, { ...look, axisLineColor: inkTint(ink, 0.35) });
    drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, w, h, pad, look);
    if (packed.fields) drawAxisFieldLabels(ctx, w, h, pad, packed.fields.x, packed.fields.y, look);
  }

  ctx.save();
  ctx.lineCap = edge.lineCap ?? "round";
  ctx.lineJoin = edge.lineJoin ?? "round";
  for (const list of trails) {
    const tipCol = colors[list[list.length - 1]!.category % colors.length] ?? colors[0]!;
    if (list.length < 2) {
      const p = list[0]!;
      ctx.fillStyle = withAlpha(tipCol, opacity);
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), Math.max(2, baseSize), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      const fade = 0.25 + 0.75 * (i / (list.length - 1));
      ctx.strokeStyle = withAlpha(colors[b.category % colors.length] ?? colors[0]!, opacity * fade);
      ctx.lineWidth = Math.max(1.5, baseSize * (0.55 + (packed.sizeRange ? b.size : 0.5) * 1.2));
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
    const tip = list[list.length - 1]!;
    ctx.fillStyle = withAlpha(tipCol, Math.min(1, opacity + 0.1));
    ctx.strokeStyle = withAlpha(ink.bg, 0.85);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx(tip.x), sy(tip.y), Math.max(2.5, baseSize * 1.3), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  // Every vertex along every trail is hoverable / pinnable.
  if (edge.hits) {
    for (const list of trails) {
      for (const p of list) {
        if (p.row != null) edge.hits.push({ shape: "circle", cx: sx(p.x), cy: sy(p.y), r: Math.max(4, baseSize), match: [], rowIndex: p.row });
      }
    }
  }
}

function drawQuakeTerrain(
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  ink: ChartInk,
  font: string,
  mini: boolean,
  opts: GpuSceneRenderOpts,
): void {
  const { points, xMin, xMax, yMin, yMax } = packed;
  const cols = mini ? 24 : 36;
  const rows = mini ? 18 : 28;
  const sum: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const counts: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const p of points) {
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(((p.x - xMin) / (xMax - xMin || 1)) * cols)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(((p.y - yMin) / (yMax - yMin || 1)) * rows)));
    sum[gy]![gx]! += p.z;
    counts[gy]![gx]! += 1;
  }
  // Cell height = mean z of the rows that land in it (empty cells are skipped, not drawn at zero).
  let lo = Infinity;
  let hi = -Infinity;
  const cells: { r: number; c: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = counts[r]![c]!;
      if (!n) continue;
      const v = sum[r]![c]! / n;
      cells.push({ r, c, v });
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!cells.length) {
    drawEmptyMessage(ctx, w, h, "No rows to build terrain", ink, font, mini, opts.axisFontSize);
    return;
  }
  // Non-negative measures (magnitudes, counts) rise from zero so heights compare honestly.
  const base0 = lo >= 0 ? 0 : lo;
  const span = hi - base0 || 1;
  const floorOrient = resolveIsoFloorOrient(opts.layoutDirection);

  const keyH = mini ? 0 : rampKeyHeight(true, false, opts.axisFontSize) + 8;
  const side = mini ? 4 : Math.max(12, pad * 0.4);
  const top = pad;
  const bottom = (mini ? pad : Math.max(12, pad * 0.4)) + keyH;
  const availW = Math.max(40, w - 2 * side);
  const availH = Math.max(40, h - top - bottom);
  // Diamond floor: half-cell step sx horizontally, sy = sx/2 vertically; peaks take ≤45% of height.
  let sxStep = availW / (cols + rows);
  let syStep = sxStep * 0.5;
  let elevMax = Math.min(availH * 0.45, availH - (cols + rows) * syStep);
  if (elevMax < availH * 0.25) {
    syStep = (availH * 0.7) / (cols + rows);
    sxStep = syStep * 2;
    elevMax = availH * 0.3;
  }
  const floorW = (cols + rows) * sxStep;
  const originX = (w - floorW) / 2 + rows * sxStep;
  const originY = top + elevMax + Math.max(0, (availH - elevMax - (cols + rows) * syStep) / 2);

  const projectFloor = (c: number, r: number, elev = 0) => {
    const o = orientIsoCell(c, r, cols, rows, floorOrient);
    return {
      x: originX + (o.c - o.r) * sxStep,
      y: originY + (o.c + o.r) * syStep - elev,
    };
  };

  const stops = sequentialStops(ink, opts.continuousStops);
  const colorAt = (t: number) => rampColor(stops, 0.12 + 0.88 * t);
  const shadeTo = inkShadow(ink);
  cells.sort((a, b) => {
    const ao = orientIsoCell(a.c, a.r, cols, rows, floorOrient);
    const bo = orientIsoCell(b.c, b.r, cols, rows, floorOrient);
    return ao.c + ao.r - (bo.c + bo.r) || ao.c - bo.c;
  });
  for (const cell of cells) {
    const t = Math.max(0, Math.min(1, (cell.v - base0) / span));
    const hh = Math.max(1, t * elevMax);
    const o = orientIsoCell(cell.c, cell.r, cols, rows, floorOrient);
    const x = originX + (o.c - o.r) * sxStep;
    const yBase = originY + (o.c + o.r) * syStep;
    const yTop = yBase - hh;
    const col = colorAt(t);
    // left face
    ctx.fillStyle = mixColor(col, shadeTo, 0.28);
    ctx.beginPath();
    ctx.moveTo(x - sxStep, yTop + syStep);
    ctx.lineTo(x, yTop + 2 * syStep);
    ctx.lineTo(x, yBase + 2 * syStep);
    ctx.lineTo(x - sxStep, yBase + syStep);
    ctx.closePath();
    ctx.fill();
    // right face
    ctx.fillStyle = mixColor(col, shadeTo, 0.45);
    ctx.beginPath();
    ctx.moveTo(x + sxStep, yTop + syStep);
    ctx.lineTo(x, yTop + 2 * syStep);
    ctx.lineTo(x, yBase + 2 * syStep);
    ctx.lineTo(x + sxStep, yBase + syStep);
    ctx.closePath();
    ctx.fill();
    // top
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x + sxStep, yTop + syStep);
    ctx.lineTo(x, yTop + 2 * syStep);
    ctx.lineTo(x - sxStep, yTop + syStep);
    ctx.closePath();
    ctx.fill();
    if (opts.hits) {
      // Column footprint + extrusion; drawn back-to-front, so the nearest cell wins the pick.
      const fx = (k: number) => formatDataValue(xMin + (k / cols) * (xMax - xMin));
      const fy = (k: number) => formatDataValue(yMin + (k / rows) * (yMax - yMin));
      const f = packed.fields;
      opts.hits.push({
        shape: "rect",
        x: x - sxStep,
        y: yTop,
        w: 2 * sxStep,
        h: yBase + 2 * syStep - yTop,
        mark: { x: x - sxStep, y: yTop, w: 2 * sxStep, h: 2 * syStep },
        match: [],
        summary: {
          columns: [f?.x ?? "x", f?.y ?? "y", f?.z ? `Mean ${f.z}` : "Height", "Rows"],
          row: [`${fx(cell.c)} – ${fx(cell.c + 1)}`, `${fy(cell.r)} – ${fy(cell.r + 1)}`, formatDataValue(cell.v), counts[cell.r]![cell.c]!],
        },
      });
    }
  }

  if (mini) return;
  const f = packed.fields;
  drawRampKey(ctx, {
    x: side,
    y: h - bottom + 6,
    width: Math.max(90, Math.min(200, w * 0.36)),
    min: base0,
    max: hi,
    colorAt,
    title: f?.z ? `Mean ${f.z} per cell` : "Height",
    ink,
    fontFamily: font, axisFontSize: opts.axisFontSize,
  });

  // Isometric floor edges + tick labels (aligned with the diamond, not screen axes).
  const corners = {
    o: projectFloor(0, 0),
    x: projectFloor(cols - 1, 0),
    y: projectFloor(0, rows - 1),
    far: projectFloor(cols - 1, rows - 1),
  };
  ctx.save();
  ctx.strokeStyle = inkTint(ink, 0.4);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(corners.o.x, corners.o.y);
  ctx.lineTo(corners.x.x, corners.x.y);
  ctx.moveTo(corners.o.x, corners.o.y);
  ctx.lineTo(corners.y.x, corners.y.y);
  ctx.stroke();

  const xTicks = niceTicks(xMin, xMax, 4, true);
  const yTicks = niceTicks(yMin, yMax, 4, true);
  ctx.font = fontOf(chartTypeRamp(opts.axisFontSize).tick, font);
  ctx.fillStyle = ink.muted;
  ctx.textBaseline = "top";
  for (const v of xTicks.ticks) {
    const t = (v - xMin) / (xMax - xMin || 1);
    const c = Math.max(0, Math.min(cols - 1, Math.round(t * (cols - 1))));
    const p = projectFloor(c, 0);
    ctx.strokeStyle = inkTint(ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 4, p.y + 7);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(formatAxisValue(v, xTicks.step), p.x - 2, p.y + 8);
  }
  for (const v of yTicks.ticks) {
    const t = (v - yMin) / (yMax - yMin || 1);
    const r = Math.max(0, Math.min(rows - 1, Math.round(t * (rows - 1))));
    const p = projectFloor(0, r);
    ctx.strokeStyle = inkTint(ink, 0.22);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 4, p.y + 7);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText(formatAxisValue(v, yTicks.step), p.x + 6, p.y + 6);
  }

  // Height pole at the origin corner — same perspective as cell extrusion.
  const zTicks = niceTicks(base0, hi, 3, true);
  const poleTop = projectFloor(0, 0, elevMax);
  ctx.strokeStyle = inkTint(ink, 0.45);
  ctx.beginPath();
  ctx.moveTo(corners.o.x, corners.o.y);
  ctx.lineTo(poleTop.x, poleTop.y);
  ctx.stroke();
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of zTicks.ticks) {
    const t = Math.max(0, Math.min(1, (v - base0) / span));
    const p = projectFloor(0, 0, t * elevMax);
    ctx.fillText(formatAxisValue(v, zTicks.step), p.x - 6, p.y);
  }

  ctx.font = fontOf(chartTypeRamp(opts.axisFontSize).tick, font, 600);
  ctx.fillStyle = ink.text;
  ctx.textBaseline = "top";
  const xm = projectFloor((cols - 1) * 0.55, 0);
  const ym = projectFloor(0, (rows - 1) * 0.55);
  ctx.textAlign = "center";
  if (f?.x) ctx.fillText(fitTextEllipsis(ctx, `${f.x} →`, floorW * 0.42), xm.x, xm.y + 22);
  ctx.textAlign = "left";
  if (f?.y) ctx.fillText(fitTextEllipsis(ctx, `← ${f.y}`, floorW * 0.42), ym.x + 10, ym.y + 18);
  if (f?.z) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, `↑ ${f.z}`, 120), poleTop.x, poleTop.y - 4);
  }
  ctx.restore();
}

function formatTimeEnd(v: number, span: number, isTime: boolean): string {
  if (isTime && Math.abs(v) > 1e11 && Math.abs(v) < 1e14) {
    const iso = new Date(v).toISOString();
    return span < 2 * 86_400_000 ? iso.slice(11, 16) : iso.slice(0, 10);
  }
  return formatDataValue(v);
}

function drawLoomWeave(
  ctx: CanvasRenderingContext2D,
  packed: GpuScenePacked,
  w: number,
  h: number,
  pad: number,
  colors: string[],
  ink: ChartInk,
  font: string,
  mini: boolean,
  opacity: number,
  axisFontSize?: number,
  edge: Pick<GpuSceneRenderOpts, "lineCap" | "lineJoin" | "hits"> = {},
): void {
  const { points } = packed;
  const cats = [...new Set(points.map((p) => p.category))].sort((a, b) => a - b);
  const warps = Math.max(cats.length, 1);
  const wefts = mini ? 16 : 24;
  const labelTop = mini ? 0 : chartTypeRamp(axisFontSize).tick + 6;
  const keyH = mini ? 0 : chartTypeRamp(axisFontSize).tick + 8;
  const leftGutter = mini ? 0 : 44;
  const x0 = pad + leftGutter;
  const plotW = Math.max(20, w - pad - x0);
  const y0 = pad + labelTop;
  const plotH = Math.max(20, h - pad - y0 - keyH);
  const gapX = plotW / (warps + 1);
  const gapY = plotH / (wefts + 1);
  const single = !packed.colorEncoded;
  // Thread value: size field when set, else the y measure (normalized), else row count.
  const yr = packed.yMax - packed.yMin;
  const valueOf = (p: GpuScenePoint) => (packed.sizeRange ? p.size : yr > 0 ? (p.y - packed.yMin) / yr : 1);

  // Warp threads (vertical)
  for (let i = 0; i < warps; i++) {
    const x = x0 + gapX * (i + 1);
    const cat = cats[i] ?? i % 8;
    ctx.strokeStyle = withAlpha(single ? colors[0]! : colors[cat % colors.length] ?? colors[0]!, 0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + plotH);
    ctx.stroke();
  }

  // Aggregate thickness by warp × weft bin
  const bins = new Map<string, { sum: number; n: number; cat: number }>();
  for (const p of points) {
    const wi = cats.indexOf(p.category);
    const we = Math.min(wefts - 1, Math.floor(p.t * wefts));
    const key = `${wi}:${we}`;
    const cur = bins.get(key) ?? { sum: 0, n: 0, cat: p.category };
    cur.sum += valueOf(p);
    cur.n += 1;
    bins.set(key, cur);
  }
  let maxV = 0;
  for (const v of bins.values()) maxV = Math.max(maxV, v.sum / v.n);
  const maxThick = Math.max(2, Math.min(gapY * 0.85, 9));
  ctx.lineCap = edge.lineCap ?? "round";
  for (const [key, v] of bins) {
    const [wiS, weS] = key.split(":");
    const wi = Number(wiS);
    const we = Number(weS);
    const val = v.sum / v.n;
    const xa = x0 + gapX * (wi + 0.55);
    const xb = x0 + gapX * (wi + 1.45);
    const y = y0 + gapY * (we + 1);
    ctx.strokeStyle = withAlpha(single ? colors[0]! : colors[v.cat % colors.length] ?? colors[0]!, opacity * 0.9);
    ctx.lineWidth = Math.max(1.2, (val / (maxV || 1)) * maxThick);
    ctx.beginPath();
    ctx.moveTo(xa, y);
    ctx.lineTo(xb, y);
    ctx.stroke();
    if (edge.hits) {
      const thick = Math.max(1.2, (val / (maxV || 1)) * maxThick);
      const tr = packed.tRange;
      const isTime = !!packed.fields?.time;
      const span = tr ? tr[1] - tr[0] : 0;
      const when = tr
        ? `${formatTimeEnd(tr[0] + (we / wefts) * span, span, isTime)} – ${formatTimeEnd(tr[0] + ((we + 1) / wefts) * span, span, isTime)}`
        : `slice ${we + 1} of ${wefts}`;
      edge.hits.push({
        shape: "rect",
        x: xa,
        y: y - gapY / 2,
        w: xb - xa,
        h: gapY,
        mark: { x: xa, y: y - thick / 2, w: xb - xa, h: thick },
        match: [],
        summary: {
          columns: [packed.fields?.color ?? "Warp", packed.fields?.time ?? "When", "Rows"],
          row: [packed.categories?.[v.cat] ?? `#${wi + 1}`, when, v.n],
        },
      });
    }
  }

  if (mini) return;
  ctx.save();
  ctx.font = fontOf(chartTypeRamp(axisFontSize).tick, font);
  ctx.fillStyle = ink.muted;
  // Warp labels (categories) across the top, thinned when crowded
  const labels = packed.categories ?? [];
  if (labels.length && packed.fields?.color) {
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const every = Math.max(1, Math.ceil(36 / Math.max(1, gapX)));
    cats.forEach((cat, i) => {
      if (i % every !== 0) return;
      ctx.fillText(fitTextEllipsis(ctx, labels[cat] ?? "", Math.max(30, gapX * every - 6)), x0 + gapX * (i + 1), y0 - 3);
    });
  }
  // Time direction on the left gutter
  const tr = packed.tRange;
  const isTime = !!packed.fields?.time;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const tLabel = (v: number) => (tr ? formatTimeEnd(v, tr[1] - tr[0], isTime) : "");
  if (tr) {
    ctx.fillText(fitTextEllipsis(ctx, isTime ? tLabel(tr[0]) : "first", leftGutter - 6), x0 - 4, y0 + gapY);
    ctx.fillText(fitTextEllipsis(ctx, isTime ? tLabel(tr[1]) : "last", leftGutter - 6), x0 - 4, y0 + gapY * wefts);
  }
  // Thickness key
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const valueName = packed.fields?.size ?? packed.fields?.y;
  const caption = `Thread thickness = ${valueName ? `mean ${valueName}` : "rows"} · time runs ${isTime ? "top → bottom" : "in row order, top → bottom"}`;
  ctx.fillText(fitTextEllipsis(ctx, caption, w - 2 * pad), pad, h - pad - keyH / 2 + 4);
  ctx.restore();
}
