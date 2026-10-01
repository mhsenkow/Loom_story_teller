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
): { points: GpuScenePoint[]; xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number } | null {
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

  const raw: { x: number; y: number; z: number; category: number; size: number; trail: number; t: number }[] = [];
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  let tMin = Infinity, tMax = -Infinity;
  const stride = Math.max(1, Math.ceil(rows.length / maxPoints));

  for (let r = 0; r < rows.length; r += stride) {
    const row = rows[r]!;
    const x = num(row[xi]);
    const y = num(row[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const z = zi >= 0 ? num(row[zi]) : 0;
    const zz = Number.isFinite(z) ? z : 0;
    const sizeRaw = si >= 0 ? num(row[si]) : 1;
    const tRaw = ti >= 0 ? num(row[ti]) : r;
    const category = ci >= 0 ? nextCat(str(row[ci])) : 0;
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

  return { points, xMin, xMax, yMin, yMax, zMin, zMax };
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

function project3d(
  x: number, y: number, z: number,
  xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number,
  w: number, h: number, pad: number,
  yaw: number, pitch: number, zoom: number,
): { sx: number; sy: number; depth: number } {
  const nx = ((x - xMin) / (xMax - xMin || 1)) * 2 - 1;
  const ny = ((y - yMin) / (yMax - yMin || 1)) * 2 - 1;
  const nz = ((z - zMin) / (zMax - zMin || 1)) * 2 - 1;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // yaw around Y, pitch around X
  const x1 = nx * cy + nz * sy;
  const z1 = -nx * sy + nz * cy;
  const y1 = ny;
  const y2 = y1 * cp - z1 * sp;
  const z2 = y1 * sp + z1 * cp;
  const dist = 2.8;
  const scale = (Math.min(w, h) * 0.38 * zoom) / (dist + z2 + 2);
  const cx = (w + pad) / 2;
  const cy0 = (h + pad) / 2;
  return {
    sx: cx + x1 * scale,
    sy: cy0 - y2 * scale,
    depth: z2,
  };
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
  const { points, xMin, xMax, yMin, yMax, zMin, zMax } = packed;
  const colors = opts.colors.length ? opts.colors : VIZ_CATEGORICAL;
  const yaw = opts.yaw ?? 0.55;
  const pitch = opts.pitch ?? 0.35;
  const zoom = opts.zoom ?? 1;
  const bg = opts.themeBg ?? "#0a0a0c";
  const text = opts.themeText ?? "#e8e8ec";
  const muted = opts.themeMuted ?? "#6b6b78";
  const baseSize = opts.pointSize ?? 4;

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (kind === "quakeTerrain") {
    drawQuakeTerrain(ctx, points, xMin, xMax, yMin, yMax, zMin, zMax, w, h, pad, colors, muted, text);
    ctx.restore();
    return;
  }
  if (kind === "loomWeave") {
    drawLoomWeave(ctx, points, w, h, pad, colors, muted, text, opts.opacity);
    ctx.restore();
    return;
  }
  if (kind === "trailRibbon") {
    drawTrailRibbons(ctx, points, xMin, xMax, yMin, yMax, w, h, pad, colors, opts.opacity, baseSize);
    ctx.restore();
    return;
  }

  // scatter3d + firefly share projected points
  const projected = points.map((p, i) => {
    const pr = project3d(p.x, p.y, p.z, xMin, xMax, yMin, yMax, zMin, zMax, w, h, pad, yaw, pitch, zoom);
    return { ...pr, p, i };
  });
  projected.sort((a, b) => a.depth - b.depth);

  if (kind === "firefly") {
    ctx.globalCompositeOperation = "lighter";
  }

  for (const pr of projected) {
    const col = colors[pr.p.category % colors.length] ?? "#6c5ce7";
    const r = kind === "firefly"
      ? baseSize * (0.6 + pr.p.size * 2.2) * (0.7 + pr.p.t * 0.5)
      : baseSize * (0.7 + pr.p.size * 1.4);
    const alpha = kind === "firefly"
      ? Math.min(1, (opts.opacity * 0.55) * (0.35 + pr.p.size * 0.9))
      : opts.opacity;
    if (kind === "firefly") {
      const g = ctx.createRadialGradient(pr.sx, pr.sy, 0, pr.sx, pr.sy, r * 3);
      g.addColorStop(0, withAlpha(col, alpha));
      g.addColorStop(0.35, withAlpha(col, alpha * 0.45));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, r * 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = withAlpha(col, alpha);
      ctx.beginPath();
      ctx.arc(pr.sx, pr.sy, Math.max(1.2, r), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = muted;
  ctx.font = `10px ${opts.fontFamily ?? "Inter"}, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(kind === "firefly" ? "Firefly field · drag to orbit" : "Orbit scatter 3D · drag to spin", pad, h - 10);
  ctx.restore();
}

function withAlpha(hex: string, a: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${Math.max(0, Math.min(1, a))})`;
}

function drawTrailRibbons(
  ctx: CanvasRenderingContext2D,
  points: GpuScenePoint[],
  _xMin: number, _xMax: number, yMin: number, yMax: number,
  w: number, h: number, pad: number,
  colors: string[],
  opacity: number,
  baseSize: number,
): void {
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

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
  if (!Number.isFinite(xMin)) return;
  // Small pad so a single-orbit ribbon isn't edge-glued.
  if (xMax - xMin < 1e-6) {
    xMin -= 1;
    xMax += 1;
  }

  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => pad + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  for (const list of trails) {
    if (list.length < 2) {
      const p = list[0];
      if (!p) continue;
      ctx.fillStyle = withAlpha(colors[p.category % colors.length] ?? "#6c5ce7", opacity);
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), baseSize, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      const fade = 0.2 + 0.8 * (i / (list.length - 1));
      ctx.strokeStyle = withAlpha(colors[b.category % colors.length] ?? "#6c5ce7", opacity * fade);
      ctx.lineWidth = Math.max(2, baseSize * (0.55 + b.size * 1.2));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
    const tip = list[list.length - 1]!;
    ctx.fillStyle = withAlpha(colors[tip.category % colors.length] ?? "#6c5ce7", opacity);
    ctx.beginPath();
    ctx.arc(sx(tip.x), sy(tip.y), baseSize * 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawQuakeTerrain(
  ctx: CanvasRenderingContext2D,
  points: GpuScenePoint[],
  xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number,
  w: number, h: number, pad: number,
  colors: string[],
  muted: string,
  text: string,
): void {
  const cols = 36;
  const rows = 28;
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const counts: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (const p of points) {
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(((p.x - xMin) / (xMax - xMin || 1)) * cols)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(((p.y - yMin) / (yMax - yMin || 1)) * rows)));
    grid[gy]![gx]! += p.z;
    counts[gy]![gx]! += 1;
  }
  let maxH = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = counts[r]![c]!;
      if (n > 0) grid[r]![c]! = grid[r]![c]! / n;
      maxH = Math.max(maxH, grid[r]![c]!);
    }
  }
  const zSpan = maxH - zMin || zMax - zMin || 1;

  const originX = w * 0.5;
  const originY = h * 0.62;
  const cellW = (w - pad * 2) / cols;
  const cellH = (h - pad * 2) / rows * 0.55;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const elev = ((grid[r]![c]! - zMin) / zSpan);
      if (elev <= 0.02 && counts[r]![c]! === 0) continue;
      const isoX = originX + (c - r) * cellW * 0.45;
      const isoY = originY + (c + r) * cellH * 0.22 - elev * (h * 0.28);
      const hh = elev * (h * 0.28);
      const col = colors[Math.min(7, Math.floor(elev * 8))] ?? colors[0]!;
      // top diamond
      ctx.fillStyle = withAlpha(col, 0.55 + elev * 0.4);
      ctx.beginPath();
      ctx.moveTo(isoX, isoY - hh);
      ctx.lineTo(isoX + cellW * 0.4, isoY - hh + cellH * 0.2);
      ctx.lineTo(isoX, isoY - hh + cellH * 0.4);
      ctx.lineTo(isoX - cellW * 0.4, isoY - hh + cellH * 0.2);
      ctx.closePath();
      ctx.fill();
      // side
      ctx.fillStyle = withAlpha(col, 0.25 + elev * 0.25);
      ctx.beginPath();
      ctx.moveTo(isoX - cellW * 0.4, isoY - hh + cellH * 0.2);
      ctx.lineTo(isoX, isoY - hh + cellH * 0.4);
      ctx.lineTo(isoX, isoY + cellH * 0.4);
      ctx.lineTo(isoX - cellW * 0.4, isoY + cellH * 0.2);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = muted;
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText(fitTextEllipsis(ctx, "Quake terrain · height = magnitude / measure", w - pad * 2), pad, h - 10);
  void text;
}

function drawLoomWeave(
  ctx: CanvasRenderingContext2D,
  points: GpuScenePoint[],
  w: number,
  h: number,
  pad: number,
  colors: string[],
  muted: string,
  text: string,
  opacity: number,
): void {
  const cats = [...new Set(points.map((p) => p.category))].sort((a, b) => a - b);
  const warps = Math.max(cats.length, 1);
  const wefts = 24;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const gapX = plotW / (warps + 1);
  const gapY = plotH / (wefts + 1);

  // Warp threads (vertical)
  for (let i = 0; i < warps; i++) {
    const x = pad + gapX * (i + 1);
    const cat = cats[i] ?? i % 8;
    ctx.strokeStyle = withAlpha(colors[cat % colors.length] ?? "#6c5ce7", 0.35);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
  }

  // Aggregate thickness by warp × weft bin
  const bins = new Map<string, { sum: number; n: number; cat: number }>();
  for (const p of points) {
    const wi = cats.indexOf(p.category);
    const we = Math.min(wefts - 1, Math.floor(p.t * wefts));
    const key = `${wi}:${we}`;
    const cur = bins.get(key) ?? { sum: 0, n: 0, cat: p.category };
    cur.sum += p.size;
    cur.n += 1;
    bins.set(key, cur);
  }

  for (const [key, v] of bins) {
    const [wiS, weS] = key.split(":");
    const wi = Number(wiS);
    const we = Number(weS);
    const x0 = pad + gapX * (wi + 0.55);
    const x1 = pad + gapX * (wi + 1.45);
    const y = pad + gapY * (we + 1);
    const thick = Math.max(1.2, 1 + (v.sum / Math.max(1, v.n)) * 6);
    ctx.strokeStyle = withAlpha(colors[v.cat % colors.length] ?? "#6c5ce7", opacity * 0.85);
    ctx.lineWidth = thick;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }

  ctx.fillStyle = muted;
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Loom weave · warp = category · weft = time", pad, h - 10);
  void text;
}
