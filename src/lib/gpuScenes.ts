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
import { pickDataCubeEncoding, rankCubeDimensions } from "./dataCube";

export const GPU_SCENE_KINDS = [
  "scatter3d",
  "trailRibbon",
  "quakeTerrain",
  "firefly",
  "loomWeave",
  "dataCube",
] as const;

export type GpuSceneKind = (typeof GPU_SCENE_KINDS)[number];

export const GPU_SCENE_KIND_OPTIONS: { value: GpuSceneKind; label: string }[] = [
  { value: "scatter3d", label: "Orbit scatter 3D" },
  { value: "trailRibbon", label: "Trail ribbons" },
  { value: "quakeTerrain", label: "Quake terrain" },
  { value: "firefly", label: "Firefly field" },
  { value: "loomWeave", label: "Loom weave" },
  { value: "dataCube", label: "Data cube 3D" },
];

/** Scenes that are not classic Cartesian 2D axes. */
export const GPU_SCENE_NON_CARTESIAN = new Set<string>([
  "scatter3d",
  "quakeTerrain",
  "loomWeave",
  "dataCube",
]);

/** WebGPU kinds drawn by LoomSceneRenderer (terrain / weave / trails use Canvas; dataCube has LoomCubeRenderer). */
export function isWebGpuDrawableScene(kind: string): boolean {
  return kind === "scatter3d" || kind === "firefly";
}

export function isGpuSceneKind(kind: string): kind is GpuSceneKind {
  return (GPU_SCENE_KINDS as readonly string[]).includes(kind);
}

export function gpuSceneRecommendationReason(kind: GpuSceneKind): string {
  const map: Record<GpuSceneKind, string> = {
    scatter3d: "True x·y·z point cloud — drag to orbit, scroll to zoom",
    trailRibbon: "Each entity leaves a fading GPU trail through space/time",
    quakeTerrain: "Heightfield mesh — peaks rise where magnitude piles up",
    firefly: "Soft additive sprites; brightness from size / recency / anomaly",
    loomWeave: "Warp = categories, weft = time; thread thickness = value",
    dataCube: "Rows × columns × depth — each voxel is one cell; size + color = value",
  };
  return map[kind];
}

export function gpuSceneDataSupport(
  columns: ColumnInfo[],
  kind: GpuSceneKind,
): { ok: boolean; reason: string } {
  const num = columns.filter((c) => {
    const t = c.data_type.toUpperCase();
    return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT"].some((n) => t.includes(n));
  });
  const nom = columns.filter((c) => {
    const t = c.data_type.toUpperCase();
    return t.includes("VARCHAR") || t.includes("TEXT") || t.includes("BOOL");
  });
  const time = columns.filter(
    (c) =>
      /^(ts|time|date|timestamp)/i.test(c.name) ||
      c.data_type.toUpperCase().includes("TIMESTAMP") ||
      c.data_type.toUpperCase().includes("DATE"),
  );
  switch (kind) {
    case "scatter3d":
    case "firefly":
    case "quakeTerrain":
      return num.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns" };
    case "trailRibbon":
      return num.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns (path X/Y)" };
    case "loomWeave":
      return nom.length >= 1 && (num.length >= 1 || time.length >= 1)
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category + numeric/time" };
    case "dataCube":
      return rankCubeDimensions(columns).length >= 3
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need three columns to span rows · columns · depth" };
    default:
      return { ok: false, reason: "Unknown scene" };
  }
}

export function getGpuRandomEncoding(
  columns: ColumnInfo[],
  kind: GpuSceneKind,
): { xField: string; yField: string | null; colorField: string | null; sizeField?: string | null } | null {
  const num = columns.filter((c) => {
    const t = c.data_type.toUpperCase();
    return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT"].some((n) => t.includes(n));
  });
  const nom = columns.filter((c) => {
    const t = c.data_type.toUpperCase();
    return t.includes("VARCHAR") || t.includes("TEXT") || t.includes("BOOL");
  });
  const pick = <T,>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)];
  if (kind === "dataCube") {
    const dims = rankCubeDimensions(columns).slice(0, 5).sort(() => Math.random() - 0.5);
    if (dims.length < 3) return null;
    const used = new Set(dims.slice(0, 3).map((c) => c.name));
    const measure = pick(num.filter((c) => !used.has(c.name) && c.distinct_count > 12)) ?? null;
    return { xField: dims[0]!.name, yField: dims[1]!.name, colorField: null, sizeField: measure?.name ?? null };
  }
  if (kind === "loomWeave") {
    const x = pick(nom.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 24));
    const y = pick(num);
    if (!x || !y) return null;
    return { xField: x.name, yField: y.name, colorField: null, sizeField: null };
  }
  if (num.length < 2) return null;
  const shuffled = [...num].sort(() => Math.random() - 0.5);
  const color = pick(nom.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 16)) ?? null;
  return {
    xField: shuffled[0]!.name,
    yField: shuffled[1]!.name,
    colorField: color?.name ?? null,
    sizeField: shuffled[2]?.name ?? null,
  };
}

export interface GpuSceneRenderOpts {
  colors: string[];
  opacity: number;
  fontFamily?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  themeBg?: string;
  pointSize?: number;
  /** Orbit camera (radians). */
  yaw?: number;
  pitch?: number;
  /** Zoom factor for 3D scenes. */
  zoom?: number;
  /** Sequential ramp for terrain heights (defaults to a theme-tuned ramp). */
  continuousStops?: string[];
  /** Thumbnail mode — marks only, no axes / keys. Inferred from size when omitted. */
  mini?: boolean;
}

export interface GpuScenePoint {
  x: number;
  y: number;
  z: number;
  category: number;
  size: number;
  /** Entity id for trails (row index or hashed trailId). */
  trail: number;
  /** Normalized time 0–1 when available. */
  t: number;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return asNum;
    const asDate = Date.parse(v);
    if (Number.isFinite(asDate)) return asDate;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Packed scene points plus the labels Canvas fallbacks need for axes and keys. */
export interface GpuScenePacked {
  points: GpuScenePoint[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  /** Encoded field names (axis titles / key captions). */
  fields?: { x: string; y: string | null; z: string | null; color: string | null; size: string | null; time: string | null };
  /** Color categories in id order (ids wrap at 8). */
  categories?: string[];
  /** True when a color field drives `category` (false: categories come from a text x column). */
  colorEncoded?: boolean;
  /** Text x values in ordinal order when x is categorical (x = index). */
  xCategories?: string[];
  /** Raw size range before 0–1 normalization (null without a size field). */
  sizeRange?: [number, number] | null;
  /** Raw time range before 0–1 normalization (row index when no time field). */
  tRange?: [number, number];
}

/** Pack rows into GPU-scene points using encoding fields. */
export function extractGpuScenePoints(
  rows: unknown[][],
  columns: string[],
  encoding: {
    xField: string;
    yField: string | null;
    zField?: string | null;
    colorField?: string | null;
    sizeField?: string | null;
    timeField?: string | null;
    trailId?: string | null;
  },
  maxPoints = 8000,
): GpuScenePacked | null {
  const xi = columns.indexOf(encoding.xField);
  const yi = encoding.yField ? columns.indexOf(encoding.yField) : -1;
  const zi = encoding.zField ? columns.indexOf(encoding.zField) : -1;
  const ci = encoding.colorField ? columns.indexOf(encoding.colorField) : -1;
  const si = encoding.sizeField ? columns.indexOf(encoding.sizeField) : -1;
  const ti = encoding.timeField ? columns.indexOf(encoding.timeField) : -1;
  const trailI = encoding.trailId ? columns.indexOf(encoding.trailId) : -1;
  if (xi < 0 || yi < 0) return null;

  const catMap = new Map<string, number>();
  const trailMap = new Map<string, number>();
  const nextCat = (k: string) => {
    let id = catMap.get(k);
    if (id == null) {
      id = catMap.size % 8;
      catMap.set(k, id);
    }
    return id;
  };
  const nextTrail = (k: string) => {
    let id = trailMap.get(k);
    if (id == null) {
      id = trailMap.size;
      trailMap.set(k, id);
    }
    return id;
  };

  // A text x column (e.g. Loom weave warps) becomes ordinal positions — and the
  // color category when no color field is set — instead of dropping every row.
  let seenX = 0;
  let numericX = 0;
  for (let r = 0; r < rows.length && seenX < 50; r++) {
    const v = rows[r]![xi];
    if (v == null || v === "") continue;
    seenX++;
    if (Number.isFinite(num(v))) numericX++;
  }
  const xCategorical = seenX > 0 && numericX / seenX < 0.5;
  const xOrdinal = new Map<string, number>();
  const xValue = (v: unknown): number => {
    if (!xCategorical) return num(v);
    if (v == null || v === "") return NaN;
    const k = str(v);
    let id = xOrdinal.get(k);
    if (id == null) {
      id = xOrdinal.size;
      xOrdinal.set(k, id);
    }
    return id;
  };

  const raw: { x: number; y: number; z: number; category: number; size: number; trail: number; t: number }[] = [];
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  let tMin = Infinity, tMax = -Infinity;
  const stride = Math.max(1, Math.ceil(rows.length / maxPoints));

  for (let r = 0; r < rows.length; r += stride) {
    const row = rows[r]!;
    const x = xValue(row[xi]);
    const y = num(row[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const z = zi >= 0 ? num(row[zi]) : 0;
    const zz = Number.isFinite(z) ? z : 0;
    const sizeRaw = si >= 0 ? num(row[si]) : 1;
    const tRaw = ti >= 0 ? num(row[ti]) : r;
    const category = ci >= 0 ? nextCat(str(row[ci])) : xCategorical ? nextCat(str(row[xi])) : 0;
    const trail = trailI >= 0 ? nextTrail(str(row[trailI])) : 0;
    raw.push({
      x, y, z: zz,
      category,
      size: Number.isFinite(sizeRaw) ? sizeRaw : 1,
      trail,
      t: Number.isFinite(tRaw) ? tRaw : r,
    });
    xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    zMin = Math.min(zMin, zz); zMax = Math.max(zMax, zz);
    tMin = Math.min(tMin, Number.isFinite(tRaw) ? tRaw : r);
    tMax = Math.max(tMax, Number.isFinite(tRaw) ? tRaw : r);
  }
  if (!raw.length || !Number.isFinite(xMin)) return null;

  const sizeMin = Math.min(...raw.map((p) => p.size));
  const sizeMax = Math.max(...raw.map((p) => p.size));
  const sizeSpan = sizeMax - sizeMin || 1;
  const tSpan = tMax - tMin || 1;

  const points: GpuScenePoint[] = raw.map((p) => ({
    ...p,
    size: (p.size - sizeMin) / sizeSpan,
    t: (p.t - tMin) / tSpan,
  }));

  if (zMax - zMin < 1e-9) {
    zMin = 0;
    zMax = 1;
  }

  return {
    points,
    xMin,
    xMax,
    yMin,
    yMax,
    zMin,
    zMax,
    fields: {
      x: encoding.xField,
      y: encoding.yField,
      z: zi >= 0 ? encoding.zField ?? null : null,
      color: ci >= 0 ? encoding.colorField ?? null : xCategorical ? encoding.xField : null,
      size: si >= 0 ? encoding.sizeField ?? null : null,
      time: ti >= 0 ? encoding.timeField ?? null : null,
    },
    categories: [...catMap.keys()],
    colorEncoded: ci >= 0,
    xCategories: xCategorical ? [...xOrdinal.keys()] : undefined,
    sizeRange: si >= 0 ? [sizeMin, sizeMax] : null,
    tRange: [tMin, tMax],
  };
}

export function buildGpuSceneRec(
  kind: GpuSceneKind,
  columns: ColumnInfo[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  opts?: {
    zField?: string | null;
    sizeField?: string | null;
    timeField?: string | null;
    trailId?: string | null;
    yAggregate?: YAggregateOption | null;
    score?: number;
    title?: string;
    subtitle?: string;
  },
): ChartRecommendation | null {
  if (kind === "dataCube") return buildDataCubeRec(columns, xField, yField, opts);
  const num = columns.filter((c) => {
    const t = c.data_type.toUpperCase();
    return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT"].some((n) => t.includes(n));
  });
  if (!columns.some((c) => c.name === xField)) return null;
  if (yField && !columns.some((c) => c.name === yField)) return null;

  const zField =
    opts?.zField ??
    num.find((c) => c.name !== xField && c.name !== yField)?.name ??
    null;
  const sizeField = opts?.sizeField ?? null;
  const timeField =
    opts?.timeField ??
    columns.find((c) => /^(ts|time|date|timestamp)/i.test(c.name) || c.data_type.toUpperCase().includes("TIMESTAMP"))?.name ??
    null;
  const trailId = opts?.trailId ?? null;

  const titles: Record<GpuSceneKind, { title: string; subtitle: string }> = {
    scatter3d: {
      title: zField ? `${xField} · ${yField} · ${zField}` : `${xField} × ${yField} (3D)`,
      subtitle: "orbit scatter — drag to spin",
    },
    trailRibbon: {
      title: trailId ? `Trails by ${trailId}` : `Trails · ${xField} × ${yField}`,
      subtitle: "fading ribbons through time",
    },
    quakeTerrain: {
      title: zField ? `Terrain · ${zField}` : "Activity terrain",
      subtitle: "heightfield where values pile up",
    },
    firefly: {
      title: `Fireflies · ${xField} × ${yField}`,
      subtitle: sizeField ? `glow by ${sizeField}` : "soft additive spark field",
    },
    loomWeave: {
      title: timeField ? `Weave · ${xField} × ${timeField}` : `Weave · ${xField}`,
      subtitle: "warp categories · weft time · thickness = value",
    },
    dataCube: { title: "", subtitle: "" },
  };

  const meta = titles[kind];
  const colors = VIZ_CATEGORICAL;

  return {
    id: `gpu-${kind}-${xField}-${yField ?? "n"}-${zField ?? "n"}-${colorField ?? "n"}`,
    kind: kind as ChartKind,
    title: opts?.title ?? meta.title,
    subtitle: opts?.subtitle ?? meta.subtitle,
    score: opts?.score ?? 88,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: { type: "circle", opacity: 0.8 },
      encoding: {
        x: { field: xField, type: "quantitative" },
        y: yField ? { field: yField, type: "quantitative" } : undefined,
        ...(zField ? { z: { field: zField, type: "quantitative" } } : {}),
        ...(colorField ? { color: { field: colorField, type: "nominal", scale: { range: colors } } } : {}),
      },
      width: "container",
      height: "container",
    },
    xField,
    yField,
    colorField,
    sizeField: sizeField ?? undefined,
    zField: zField ?? undefined,
    timeField: timeField ?? undefined,
    trailId: trailId ?? undefined,
  };
}

/**
 * Data cube rec: X = rows, Y = columns, Z = depth, size = value measure.
 * The Vega-Lite spec is the honest 2D fallback — a rows × columns heatmap
 * with depth collapsed (SVG export / portable spec).
 */
function buildDataCubeRec(
  columns: ColumnInfo[],
  xField: string,
  yField: string | null,
  opts?: {
    zField?: string | null;
    sizeField?: string | null;
    yAggregate?: YAggregateOption | null;
    score?: number;
    title?: string;
    subtitle?: string;
  },
): ChartRecommendation | null {
  const byName = (n: string | null | undefined) => (n ? columns.find((c) => c.name === n) : undefined);
  if (!byName(xField)) return null;
  const dims = rankCubeDimensions(columns);
  const y = byName(yField) ?? dims.find((c) => c.name !== xField);
  if (!y) return null;
  const z = byName(opts?.zField) ?? dims.find((c) => c.name !== xField && c.name !== y.name);
  if (!z) return null;
  const measure = byName(opts?.sizeField);
  const sizeField = measure && isNumericColumn(measure) ? measure.name : null;
  const agg: YAggregateOption = sizeField ? (opts?.yAggregate && opts.yAggregate !== "count" ? opts.yAggregate : "sum") : "count";
  const vlType = (c: ColumnInfo) => (isNumericColumn(c) && c.distinct_count > 12 ? "quantitative" : "ordinal");
  const axisEnc = (c: ColumnInfo) => (vlType(c) === "quantitative" ? { field: c.name, type: "quantitative", bin: true } : { field: c.name, type: "ordinal" });
  const vlAgg = agg === "mean" ? "mean" : agg;
  const color = sizeField
    ? { field: sizeField, type: "quantitative", aggregate: vlAgg, scale: { scheme: "blues" } }
    : { aggregate: "count", type: "quantitative", scale: { scheme: "blues" } };
  const aggWord: Record<YAggregateOption, string> = { sum: "sum", mean: "avg", count: "count", min: "min", max: "max" };

  return {
    id: `gpu-dataCube-${xField}-${y.name}-${z.name}-${sizeField ?? "count"}-${agg}`,
    kind: "dataCube" as ChartKind,
    title: opts?.title ?? `${xField} × ${y.name} × ${z.name}`,
    subtitle: opts?.subtitle ?? (sizeField ? `${aggWord[agg]} of ${sizeField} per cell · drag to orbit` : "rows per cell · drag to orbit"),
    score: opts?.score ?? 84,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      description: `Data cube collapsed along ${z.name}`,
      mark: { type: "rect" },
      encoding: {
        x: axisEnc(y),
        y: axisEnc(byName(xField)!),
        color,
      },
      width: "container",
      height: "container",
    },
    xField,
    yField: y.name,
    colorField: null,
    zField: z.name,
    sizeField: sizeField ?? undefined,
    yAggregate: sizeField ? agg : null,
  };
}

/** Schema-only best guess for a data cube, as a ready rec (for recommend / discover). */
export function suggestDataCubeRec(columns: ColumnInfo[], score = 74): ChartRecommendation | null {
  const enc = pickDataCubeEncoding(columns);
  if (!enc) return null;
  return buildDataCubeRec(columns, enc.xField, enc.yField, {
    zField: enc.zField,
    sizeField: enc.valueField,
    yAggregate: enc.aggregate,
    score,
  });
}

function isNumericColumn(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some((n) => t.includes(n));
}


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
  const mini = inferMini(opts, w, h, pad);
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const opacity = opts.opacity ?? 0.85;

  ctx.save();
  if (ink.paintBg) {
    ctx.fillStyle = ink.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (!packed.points.length) {
    drawEmptyMessage(ctx, w, h, "No numeric rows to place in the scene", ink, font, mini);
    ctx.restore();
    return;
  }

  if (kind === "quakeTerrain") {
    drawQuakeTerrain(ctx, packed, w, h, pad, ink, font, mini, opts);
  } else if (kind === "loomWeave") {
    drawLoomWeave(ctx, packed, w, h, pad, colors, ink, font, mini, opacity);
  } else if (kind === "trailRibbon") {
    drawTrailRibbons(ctx, packed, w, h, pad, colors, ink, font, mini, opacity, radiusFromPointSize(opts.pointSize, 2.6));
  } else {
    drawOrbitPoints(kind, ctx, packed, w, h, pad, colors, ink, font, mini, opts);
  }
  ctx.restore();
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
  const look = { ink, font };
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
  look: { ink: ChartInk; font: string },
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
  ctx.font = fontOf(10, look.font);
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
    if (Math.abs(px - lastX) < tw + 8 && Math.abs(py - lastY) < 13) continue;
    ctx.fillText(label, px, py);
    lastX = px;
    lastY = py;
    widest = Math.max(widest, tw);
  }
  ctx.font = fontOf(10, look.font, 600);
  ctx.fillStyle = look.ink.text;
  const reach = 6 + (Math.abs(ox) > 0.35 ? widest + 8 : 16);
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
): void {
  const { points, yMin, yMax } = packed;
  const byTrail = new Map<number, GpuScenePoint[]>();
  for (const p of points) {
    const list = byTrail.get(p.trail) ?? [];
    list.push(p);
    byTrail.set(p.trail, list);
  }

  // Unwrap X per trail so longitude paths don't slash across the ±180° seam.
  type Pt = { x: number; y: number; t: number; size: number; category: number };
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
      unwrapped.push({ x, y: p.y, t: p.t, size: p.size, category: p.category });
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
    }
    if (unwrapped.length) trails.push(unwrapped);
  }
  if (!Number.isFinite(xMin)) {
    drawEmptyMessage(ctx, w, h, "No numeric rows to trace", ink, font, mini);
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
    axisFontSize: 10,
  };
  if (!mini) {
    drawChartGrid(ctx, w, h, pad, { ...look, themeBorder: inkTint(ink, 0.14), gridOpacity: 1 }, { x: [xs.min, xs.max], y: [ys.min, ys.max] });
    drawAxisFrame(ctx, w, h, pad, { ...look, axisLineColor: inkTint(ink, 0.35) });
    drawChartTicks(ctx, xs.min, xs.max, ys.min, ys.max, w, h, pad, look);
    if (packed.fields) drawAxisFieldLabels(ctx, w, h, pad, packed.fields.x, packed.fields.y, look);
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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
    drawEmptyMessage(ctx, w, h, "No rows to build terrain", ink, font, mini);
    return;
  }
  // Non-negative measures (magnitudes, counts) rise from zero so heights compare honestly.
  const base0 = lo >= 0 ? 0 : lo;
  const span = hi - base0 || 1;

  const keyH = mini ? 0 : rampKeyHeight(true) + 8;
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

  const stops = sequentialStops(ink, opts.continuousStops);
  const colorAt = (t: number) => rampColor(stops, 0.12 + 0.88 * t);
  const shadeTo = "#000000";
  cells.sort((a, b) => a.c + a.r - (b.c + b.r) || a.c - b.c);
  for (const cell of cells) {
    const t = Math.max(0, Math.min(1, (cell.v - base0) / span));
    const hh = Math.max(1, t * elevMax);
    const x = originX + (cell.c - cell.r) * sxStep;
    const yBase = originY + (cell.c + cell.r) * syStep;
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
    fontFamily: font,
  });
  // Floor axis names along the two near floor edges
  ctx.save();
  ctx.font = fontOf(10, font);
  ctx.fillStyle = ink.muted;
  const frontY = originY + (cols + rows) * syStep + 2 * syStep;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const xLabel = f?.x ? `${f.x} →` : "";
  const yLabel = f?.y ? `← ${f.y}` : "";
  const half = Math.max(40, floorW / 2 - 8);
  if (xLabel) ctx.fillText(fitTextEllipsis(ctx, xLabel, half), originX - rows * sxStep + floorW / 2 + 8, Math.min(h - bottom - 12, frontY - (cols * syStep) / 2));
  ctx.textAlign = "right";
  if (yLabel) ctx.fillText(fitTextEllipsis(ctx, yLabel, half), originX - rows * sxStep + floorW / 2 - 8, Math.min(h - bottom - 12, frontY - (rows * syStep) / 2));
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
): void {
  const { points } = packed;
  const cats = [...new Set(points.map((p) => p.category))].sort((a, b) => a - b);
  const warps = Math.max(cats.length, 1);
  const wefts = mini ? 16 : 24;
  const labelTop = mini ? 0 : 16;
  const keyH = mini ? 0 : 18;
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
  ctx.lineCap = "round";
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
  }

  if (mini) return;
  ctx.save();
  ctx.font = fontOf(10, font);
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
