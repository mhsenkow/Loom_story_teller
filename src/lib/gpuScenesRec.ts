// =================================================================
// Loom — GPU scene recommendations (no Canvas render)
// =================================================================

import type { ColumnInfo } from "./queryTypes";
import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";
import { VIZ_CATEGORICAL } from "./chartPalettes";
import { pickDataCubeEncoding, rankCubeDimensions } from "./dataCubeSchema";

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
): {
  xField: string;
  yField: string | null;
  colorField: string | null;
  sizeField?: string | null;
  zField?: string | null;
} | null {
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
    return {
      xField: dims[0]!.name,
      yField: dims[1]!.name,
      colorField: null,
      sizeField: measure?.name ?? null,
      zField: dims[2]?.name ?? null,
    };
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
  if (kind === "quakeTerrain") {
    // Height is Z — not Size (Size remains unused for terrain).
    return {
      xField: shuffled[0]!.name,
      yField: shuffled[1]!.name,
      colorField: color?.name ?? null,
      zField: shuffled[2]?.name ?? null,
      sizeField: null,
    };
  }
  return {
    xField: shuffled[0]!.name,
    yField: shuffled[1]!.name,
    colorField: color?.name ?? null,
    zField: kind === "scatter3d" ? shuffled[2]?.name ?? null : null,
    sizeField: kind === "scatter3d" ? shuffled[3]?.name ?? null : shuffled[2]?.name ?? null,
  };
}

export interface GpuSceneRenderOpts {
  colors: string[];
  opacity: number;
  fontFamily?: string;
  axisFontSize?: number;
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
  /** Encoding → Direction: rotate / flip the isometric floor (terrain). */
  layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
  channelInvert?: import("./channelInvert").ChannelInvert;
  /** Thumbnail mode — marks only, no axes / keys. Inferred from size when omitted. */
  mini?: boolean;
  hits?: import("./chartTooltip").HitTarget[];
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
    invertSize?: boolean;
    invertZ?: boolean;
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
      id = catMap.size;
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
    z: encoding.invertZ ? zMin + zMax - p.z : p.z,
    size: encoding.invertSize ? 1 - (p.size - sizeMin) / sizeSpan : (p.size - sizeMin) / sizeSpan,
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

  // Terrain Height historically lived on sizeField — prefer explicit z, then size, then auto.
  const zField =
    opts?.zField ??
    (kind === "quakeTerrain" ? opts?.sizeField ?? null : null) ??
    num.find((c) => c.name !== xField && c.name !== yField && c.name !== opts?.sizeField)?.name ??
    null;
  const sizeField = kind === "quakeTerrain" ? null : opts?.sizeField ?? null;
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

function isNumericColumn(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some((n) =>
    t.includes(n),
  );
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
