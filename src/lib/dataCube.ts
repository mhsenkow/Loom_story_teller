// =================================================================
// Loom — Data cube (rows × columns × depth voxel scene)
// =================================================================
// Three dimensions (any column type) are binned onto a grid; each
// non-empty cell becomes a voxel sized + colored by an aggregated
// measure (count / sum / mean / min / max). Camera math here is the
// single source of truth for WebGPU (webgpuCube.ts), the Canvas 2D
// fallback, axis labels, and hover picking — so they always agree.
//
// Layout: X field = rows (vertical, first row on top), Y field =
// columns (left → right), Z field = depth (front → back).
// =================================================================

import type { ColumnInfo } from "./store";
import type { YAggregateOption } from "./recommendations";
import { sampleContinuous } from "./chartPalettes";
import { fitTextEllipsis } from "./chartLayout";

export type CubeAxisKind = "category" | "numeric" | "time";

export interface CubeAxis {
  field: string;
  kind: CubeAxisKind;
  labels: string[];
}

export interface CubeCell {
  xi: number;
  yi: number;
  zi: number;
  value: number;
  count: number;
  /** Min–max normalized value (0–1) for color. */
  t: number;
  /** Voxel scale factor (0–1) — zero-based for additive measures. */
  s: number;
  /** First sample row that landed in this cell (tooltip link). */
  rowIndex: number;
}

export interface DataCube {
  x: CubeAxis;
  y: CubeAxis;
  z: CubeAxis;
  cells: CubeCell[];
  vMin: number;
  vMax: number;
  aggregate: YAggregateOption;
  valueField: string | null;
  /** Human label for the measure, e.g. "Sum of sales" or "Rows". */
  valueLabel: string;
}

export interface CubeEncoding {
  xField: string;
  yField: string | null;
  zField?: string | null;
  valueField?: string | null;
  aggregate?: YAggregateOption | null;
}

export const CUBE_MAX_BINS = 12;

const AGG_LABEL: Record<YAggregateOption, string> = {
  sum: "Sum",
  mean: "Average",
  count: "Count",
  min: "Min",
  max: "Max",
};

// ---------------------------------------------------------------------------
// Binning
// ---------------------------------------------------------------------------

const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatCubeNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  // Below 10k stay literal so years (2024) never read as "2K".
  if (Math.abs(n) >= 10_000) return compactFmt.format(n);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(Math.abs(n) < 1 ? 3 : Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, "");
}

function asNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "boolean") return NaN;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

const DATE_LIKE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]\d{1,2}:\d{2})?|^\d{1,2}\/\d{1,2}\/\d{2,4}/;

function asTime(v: unknown): number {
  if (typeof v !== "string" || !DATE_LIKE.test(v.trim())) return NaN;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const day = 86_400_000;
  if (spanMs > 3 * 365 * day) return String(d.getUTCFullYear());
  if (spanMs > 60 * day) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (spanMs > 2 * day) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

interface BuiltAxis {
  axis: CubeAxis;
  /** Bin index for a raw value, or -1 to skip the row. */
  indexOf: (v: unknown) => number;
}

function equalWidthBins(
  min: number,
  max: number,
  n: number,
  label: (lo: number, hi: number) => string,
): { labels: string[]; index: (x: number) => number } {
  const span = max - min || 1;
  const labels = Array.from({ length: n }, (_, i) => label(min + (span * i) / n, min + (span * (i + 1)) / n));
  return {
    labels,
    index: (x) => Math.min(n - 1, Math.max(0, Math.floor(((x - min) / span) * n))),
  };
}

/** Bin one column onto ≤ maxBins ordered slots (categories, numeric ranges, or time ranges). */
export function buildCubeAxis(values: unknown[], field: string, maxBins = CUBE_MAX_BINS): BuiltAxis | null {
  const present = values.filter((v) => !isBlank(v));
  if (present.length === 0) return null;

  const nums = present.map(asNumber);
  const numOk = nums.filter(Number.isFinite).length;
  if (numOk / present.length >= 0.9) {
    const distinct = [...new Set(nums.filter(Number.isFinite))].sort((a, b) => a - b);
    if (distinct.length <= maxBins) {
      const pos = new Map(distinct.map((d, i) => [d, i]));
      return {
        axis: { field, kind: "numeric", labels: distinct.map(formatCubeNumber) },
        indexOf: (v) => pos.get(asNumber(v)) ?? -1,
      };
    }
    const n = Math.min(maxBins, 8);
    const bins = equalWidthBins(distinct[0]!, distinct[distinct.length - 1]!, n, (lo, hi) => `${formatCubeNumber(lo)}–${formatCubeNumber(hi)}`);
    return {
      axis: { field, kind: "numeric", labels: bins.labels },
      indexOf: (v) => {
        const x = asNumber(v);
        return Number.isFinite(x) ? bins.index(x) : -1;
      },
    };
  }

  const times = present.map(asTime);
  const timeOk = times.filter(Number.isFinite).length;
  if (timeOk / present.length >= 0.9) {
    const finite = times.filter(Number.isFinite);
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const span = max - min;
    const distinct = [...new Set(finite)].sort((a, b) => a - b);
    if (distinct.length <= maxBins) {
      const pos = new Map(distinct.map((d, i) => [d, i]));
      return {
        axis: { field, kind: "time", labels: distinct.map((d) => formatTime(d, span)) },
        indexOf: (v) => pos.get(asTime(v)) ?? -1,
      };
    }
    const n = Math.min(maxBins, 8);
    const bins = equalWidthBins(min, max, n, (lo) => formatTime(lo, span));
    return {
      axis: { field, kind: "time", labels: bins.labels },
      indexOf: (v) => {
        const x = asTime(v);
        return Number.isFinite(x) ? bins.index(x) : -1;
      },
    };
  }

  // Categorical: most frequent first; overflow folds into "Other".
  const freq = new Map<string, number>();
  for (const v of present) {
    const k = String(v);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  const overflow = ranked.length > maxBins;
  const kept = overflow ? ranked.slice(0, maxBins - 1) : ranked;
  const pos = new Map(kept.map((k, i) => [k, i]));
  const otherIdx = kept.length;
  return {
    axis: { field, kind: "category", labels: overflow ? [...kept, "Other"] : kept },
    indexOf: (v) => (isBlank(v) ? -1 : pos.get(String(v)) ?? (overflow ? otherIdx : -1)),
  };
}

interface BinnedRows {
  ax: BuiltAxis;
  ay: BuiltAxis;
  az: BuiltAxis;
  /** Per sample row: bin index on each axis (-1 = skipped) and measure value. */
  bx: Int32Array;
  by: Int32Array;
  bz: Int32Array;
  val: Float64Array;
  aggregate: YAggregateOption;
  valueField: string | null;
  valueLabel: string;
}

/** Bin every row once; the cube and the pivot table aggregate from the same bins. */
function binRows(rows: unknown[][], columns: string[], enc: CubeEncoding, maxBins: number): BinnedRows | null {
  if (!enc.yField || !enc.zField) return null;
  const xi = columns.indexOf(enc.xField);
  const yi = columns.indexOf(enc.yField);
  const zi = columns.indexOf(enc.zField);
  if (xi < 0 || yi < 0 || zi < 0) return null;
  const vi = enc.valueField ? columns.indexOf(enc.valueField) : -1;
  const aggregate: YAggregateOption = vi < 0 ? "count" : (enc.aggregate ?? "sum");

  const ax = buildCubeAxis(rows.map((r) => r[xi]), enc.xField, maxBins);
  const ay = buildCubeAxis(rows.map((r) => r[yi]), enc.yField, maxBins);
  const az = buildCubeAxis(rows.map((r) => r[zi]), enc.zField, maxBins);
  if (!ax || !ay || !az) return null;

  const n = rows.length;
  const bx = new Int32Array(n);
  const by = new Int32Array(n);
  const bz = new Int32Array(n);
  const val = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    const row = rows[r]!;
    bx[r] = ax.indexOf(row[xi]);
    by[r] = ay.indexOf(row[yi]);
    bz[r] = az.indexOf(row[zi]);
    val[r] = vi >= 0 ? asNumber(row[vi]) : NaN;
  }
  return {
    ax, ay, az, bx, by, bz, val, aggregate,
    valueField: vi >= 0 ? enc.valueField! : null,
    valueLabel: vi >= 0 && aggregate !== "count" ? `${AGG_LABEL[aggregate]} of ${enc.valueField}` : "Rows",
  };
}

/** Running aggregate for one group of rows. */
class Acc {
  count = 0;
  valid = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  first = -1;
  add(r: number, v: number) {
    this.count += 1;
    if (this.first === -1) this.first = r;
    if (Number.isFinite(v)) {
      this.valid += 1;
      this.sum += v;
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
    }
  }
  /** Aggregated value, or null when nothing measurable landed here. */
  value(agg: YAggregateOption): number | null {
    if (this.count === 0) return null;
    if (agg === "count") return this.count;
    if (this.valid === 0) return null;
    if (agg === "sum") return this.sum;
    if (agg === "mean") return this.sum / this.valid;
    return agg === "min" ? this.min : this.max;
  }
}

/** Aggregate sample rows into a binned rows × columns × depth cube. */
export function buildDataCube(
  rows: unknown[][],
  columns: string[],
  enc: CubeEncoding,
  maxBins = CUBE_MAX_BINS,
): DataCube | null {
  const b = binRows(rows, columns, enc, maxBins);
  if (!b) return null;
  const nx = b.ax.axis.labels.length;
  const ny = b.ay.axis.labels.length;
  const nz = b.az.axis.labels.length;
  const accs = new Map<number, Acc>();
  for (let r = 0; r < rows.length; r++) {
    if (b.bx[r]! < 0 || b.by[r]! < 0 || b.bz[r]! < 0) continue;
    const k = (b.bx[r]! * ny + b.by[r]!) * nz + b.bz[r]!;
    let acc = accs.get(k);
    if (!acc) accs.set(k, (acc = new Acc()));
    acc.add(r, b.val[r]!);
  }

  const raw: Omit<CubeCell, "t" | "s">[] = [];
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const k of [...accs.keys()].sort((p, q) => p - q)) {
    const acc = accs.get(k)!;
    const value = acc.value(b.aggregate);
    if (value == null) continue;
    const zi = k % nz;
    const yi = Math.floor(k / nz) % ny;
    const xi = Math.floor(k / (nz * ny));
    raw.push({ xi, yi, zi, value, count: acc.count, rowIndex: acc.first });
    vMin = Math.min(vMin, value);
    vMax = Math.max(vMax, value);
  }
  if (raw.length === 0 || nx === 0) return null;

  const span = vMax - vMin;
  // Additive measures read as magnitude (size from zero); averages/extremes read relative to each other.
  const zeroBased = (b.aggregate === "count" || b.aggregate === "sum") && vMin >= 0;
  const cells: CubeCell[] = raw.map((c) => ({
    ...c,
    t: span > 0 ? (c.value - vMin) / span : 1,
    s: zeroBased ? (vMax > 0 ? c.value / vMax : 1) : span > 0 ? (c.value - vMin) / span : 1,
  }));

  return {
    x: b.ax.axis,
    y: b.ay.axis,
    z: b.az.axis,
    cells,
    vMin,
    vMax,
    aggregate: b.aggregate,
    valueField: b.valueField,
    valueLabel: b.valueLabel,
  };
}

// ---------------------------------------------------------------------------
// Pivot table (2D projection: one depth slice, or rolled up across depth)
// ---------------------------------------------------------------------------

export interface PivotTable {
  rowField: string;
  colField: string;
  depthField: string;
  rows: string[];
  cols: string[];
  /** values[row][col]; null = empty cell. */
  values: (number | null)[][];
  rowTotals: (number | null)[];
  colTotals: (number | null)[];
  grand: number | null;
  vMin: number;
  vMax: number;
  valueLabel: string;
  /** Depth label being shown, or null when rolled up across all depth. */
  sliceLabel: string | null;
}

/**
 * Rows × columns table for one depth slice (or all depth when `slice` is null).
 * Totals re-aggregate raw rows, so averages / min / max stay correct.
 */
export function buildPivotTable(
  rows: unknown[][],
  columns: string[],
  enc: CubeEncoding,
  slice: number | null,
  maxBins = CUBE_MAX_BINS,
): PivotTable | null {
  const b = binRows(rows, columns, enc, maxBins);
  if (!b) return null;
  const nx = b.ax.axis.labels.length;
  const ny = b.ay.axis.labels.length;
  const nz = b.az.axis.labels.length;
  const sl = slice != null && slice >= 0 && slice < nz ? slice : null;
  const cell = Array.from({ length: nx }, () => Array.from({ length: ny }, () => new Acc()));
  const rowAcc = Array.from({ length: nx }, () => new Acc());
  const colAcc = Array.from({ length: ny }, () => new Acc());
  const all = new Acc();
  for (let r = 0; r < rows.length; r++) {
    const x = b.bx[r]!;
    const y = b.by[r]!;
    const z = b.bz[r]!;
    if (x < 0 || y < 0 || z < 0) continue;
    if (sl != null && z !== sl) continue;
    const v = b.val[r]!;
    cell[x]![y]!.add(r, v);
    rowAcc[x]!.add(r, v);
    colAcc[y]!.add(r, v);
    all.add(r, v);
  }
  const values = cell.map((row) => row.map((a) => a.value(b.aggregate)));
  const flat = values.flat().filter((v): v is number => v != null);
  return {
    rowField: b.ax.axis.field,
    colField: b.ay.axis.field,
    depthField: b.az.axis.field,
    rows: b.ax.axis.labels,
    cols: b.ay.axis.labels,
    values,
    rowTotals: rowAcc.map((a) => a.value(b.aggregate)),
    colTotals: colAcc.map((a) => a.value(b.aggregate)),
    grand: all.value(b.aggregate),
    vMin: flat.length ? Math.min(...flat) : 0,
    vMax: flat.length ? Math.max(...flat) : 0,
    valueLabel: b.valueLabel,
    sliceLabel: sl != null ? b.az.axis.labels[sl]! : null,
  };
}

/**
 * Position-independent identity of a cell (field=label for all three axes),
 * so a voxel can be followed across a pivot that permutes the axes.
 */
export function cubeCellKey(cube: Pick<DataCube, "x" | "y" | "z">, cell: Pick<CubeCell, "xi" | "yi" | "zi">): string {
  return [
    `${cube.x.field}=${cube.x.labels[cell.xi]}`,
    `${cube.y.field}=${cube.y.labels[cell.yi]}`,
    `${cube.z.field}=${cube.z.labels[cell.zi]}`,
  ]
    .sort()
    .join("\u0001");
}

// ---------------------------------------------------------------------------
// Encoding heuristics (schema-only)
// ---------------------------------------------------------------------------

function isNumericType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some((n) => t.includes(n));
}

function isTimeColumn(c: ColumnInfo): boolean {
  const t = c.data_type.toUpperCase();
  return t.includes("DATE") || t.includes("TIMESTAMP") || /^(ts|time|date|timestamp|year|month)$/i.test(c.name);
}

function isIdLike(name: string): boolean {
  return /\b(id|uuid|key|index)\b/i.test(name) || /(_id|_key)$/i.test(name);
}

/** How well a column works as a cube dimension (higher = better, ≤0 = unusable). */
function dimensionScore(c: ColumnInfo): number {
  const d = c.distinct_count ?? 0;
  if (d < 2 || isIdLike(c.name)) return 0;
  if (isTimeColumn(c)) return 8;
  if (!isNumericType(c.data_type)) {
    if (d <= CUBE_MAX_BINS) return 10;
    if (d <= 40) return 6;
    return 2;
  }
  // Low-cardinality numerics (ratings, years, floors) behave like ordered categories.
  if (d <= CUBE_MAX_BINS) return 7;
  return 3;
}

/** Columns that can span a cube axis, best first. */
export function rankCubeDimensions(columns: ColumnInfo[]): ColumnInfo[] {
  return columns
    .map((c) => ({ c, s: dimensionScore(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** Best rows / columns / depth / value encoding for a schema, or null. */
export function pickDataCubeEncoding(
  columns: ColumnInfo[],
): { xField: string; yField: string; zField: string; valueField: string | null; aggregate: YAggregateOption } | null {
  const dims = rankCubeDimensions(columns);
  if (dims.length < 3) return null;
  // Put time on depth when present so slices read as "pages" through time.
  const time = dims.find(isTimeColumn);
  const flat = dims.filter((c) => c !== time);
  const [x, y, z] = time ? [flat[0], flat[1], time] : [dims[0], dims[1], dims[2]];
  if (!x || !y || !z) return null;
  const used = new Set([x.name, y.name, z.name]);
  const measure = columns.find((c) => isNumericType(c.data_type) && !used.has(c.name) && !isIdLike(c.name) && (c.distinct_count ?? 0) > CUBE_MAX_BINS);
  const rateLike = measure && /(percent|pct|rate|ratio|%|avg|mean|score|temp)/i.test(measure.name);
  return {
    xField: x.name,
    yField: y.name,
    zField: z.name,
    valueField: measure?.name ?? null,
    aggregate: measure ? (rateLike ? "mean" : "sum") : "count",
  };
}

// ---------------------------------------------------------------------------
// Camera (column-major 4×4, WebGPU clip space z ∈ [0, 1])
// ---------------------------------------------------------------------------

export interface CubeCamera {
  yaw: number;
  pitch: number;
  zoom: number;
  /** Shift the cube up (+) / down (−) in NDC, e.g. to make room for a docked table. */
  offsetY?: number;
}

const CAMERA_DIST = 7.2;
const FOV_Y = (32 * Math.PI) / 180;

export interface CubeView {
  /** viewProjection, column-major. */
  m: Float32Array;
  /** World-space light direction (follows the camera). */
  light: [number, number, number];
  /** Vertical focal scale (NDC per view unit at distance 1). */
  fy: number;
  w: number;
  h: number;
}

/** Half-extents of the cube box; voxels stay cubic so lopsided cubes read as slabs. */
export function cubeExtents(cube: Pick<DataCube, "x" | "y" | "z">): { ex: number; ey: number; ez: number; pitch: number } {
  const nx = cube.x.labels.length;
  const ny = cube.y.labels.length;
  const nz = cube.z.labels.length;
  const n = Math.max(nx, ny, nz, 1);
  return { ex: ny / n, ey: nx / n, ez: nz / n, pitch: 2 / n };
}

/** World-space center of grid cell (row xi, column yi, depth zi). */
export function cubeCellCenter(cube: Pick<DataCube, "x" | "y" | "z">, xi: number, yi: number, zi: number): [number, number, number] {
  const { ex, ey, ez, pitch } = cubeExtents(cube);
  return [-ex + (yi + 0.5) * pitch, ey - (xi + 0.5) * pitch, ez - (zi + 0.5) * pitch];
}

export function cubeView(cam: CubeCamera, w: number, h: number): CubeView {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  // view = T(0,0,-d) · Rx(pitch) · Ry(yaw)   (row-major R written out)
  const r = [
    cy, 0, sy,
    sp * sy, cp, -sp * cy,
    -cp * sy, sp, cp * cy,
  ];
  const aspect = w / Math.max(1, h);
  const f = (1 / Math.tan(FOV_Y / 2)) * cam.zoom;
  // Fit the shorter side so portrait frames don't crop the cube.
  const fx = aspect >= 1 ? f / aspect : f;
  const fy = aspect >= 1 ? f : f * aspect;
  const near = 0.1;
  const far = 100;
  const rangeInv = 1 / (near - far);
  const p22 = far * rangeInv;
  const p32 = near * far * rangeInv;
  const d = CAMERA_DIST;
  // proj · view, column-major: column j = (fx*R0j, fy*R1j, p22*R2j, -R2j); translation column uses -d.
  const m = new Float32Array(16);
  for (let j = 0; j < 3; j++) {
    m[j * 4 + 0] = fx * r[0 * 3 + j]!;
    m[j * 4 + 1] = fy * r[1 * 3 + j]!;
    m[j * 4 + 2] = p22 * r[2 * 3 + j]!;
    m[j * 4 + 3] = -r[2 * 3 + j]!;
  }
  m[12] = 0;
  m[13] = 0;
  m[14] = p22 * -d + p32;
  m[15] = d;
  // Screen-space shift: clip.y += offsetY · clip.w (perspective-correct translate in NDC).
  const oy = cam.offsetY ?? 0;
  if (oy) for (const c of [0, 4, 8, 12]) m[c + 1] = m[c + 1]! + oy * m[c + 3]!;
  // Light fixed in view space (upper-left, toward viewer) → world via Rᵀ.
  const lv = [-0.35, 0.75, 0.55];
  const len = Math.hypot(lv[0]!, lv[1]!, lv[2]!);
  const light: [number, number, number] = [0, 1, 2].map(
    (j) => (r[0 * 3 + j]! * lv[0]! + r[1 * 3 + j]! * lv[1]! + r[2 * 3 + j]! * lv[2]!) / len,
  ) as [number, number, number];
  return { m, light, fy, w, h };
}

/** World point → CSS pixels; `depth` is view distance (larger = farther). */
export function projectCube(v: CubeView, x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
  const m = v.m;
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const iw = 1 / (cw || 1e-6);
  return {
    sx: (cx * iw * 0.5 + 0.5) * v.w,
    sy: (0.5 - cy * iw * 0.5) * v.h,
    depth: cw,
  };
}

/** Voxel half-size in world units for a cell. */
export function cubeVoxelHalf(cube: DataCube, cell: CubeCell): number {
  const { pitch } = cubeExtents(cube);
  return (pitch / 2) * (0.28 + 0.64 * Math.sqrt(Math.max(0, cell.s)));
}

/** Cells sorted far → near for painter's order / alpha blending. */
/** Per-frame voxel placement / visibility shared by Canvas, WebGPU, and picking. */
export interface CubeCellStyle {
  /** Depth layer in focus; other layers render as ghosts and can't be picked. */
  slice?: number | null;
  /** Override voxel centers (pivot transitions). */
  centerOf?: (cell: CubeCell) => [number, number, number];
}

export const CUBE_GHOST_ALPHA = 0.1;

export function cubeCellPosition(cube: DataCube, cell: CubeCell, style?: CubeCellStyle): [number, number, number] {
  return style?.centerOf?.(cell) ?? cubeCellCenter(cube, cell.xi, cell.yi, cell.zi);
}

/** 1 for voxels in focus, CUBE_GHOST_ALPHA for voxels outside the active slice. */
export function cubeCellAlphaScale(cell: CubeCell, style?: CubeCellStyle): number {
  return style?.slice != null && cell.zi !== style.slice ? CUBE_GHOST_ALPHA : 1;
}

export function sortCellsBackToFront(cube: DataCube, v: CubeView, style?: CubeCellStyle): { cell: CubeCell; depth: number }[] {
  return cube.cells
    .map((cell) => {
      const [x, y, z] = cubeCellPosition(cube, cell, style);
      return { cell, depth: projectCube(v, x, y, z).depth };
    })
    .sort((a, b) => b.depth - a.depth);
}

/** Front-most voxel under a CSS-pixel point, or null. Ghosted (out-of-slice) voxels are skipped. */
export function pickDataCubeCell(cube: DataCube, v: CubeView, px: number, py: number, style?: CubeCellStyle): CubeCell | null {
  let best: CubeCell | null = null;
  let bestDepth = Infinity;
  for (const cell of cube.cells) {
    if (cubeCellAlphaScale(cell, style) < 1) continue;
    const [x, y, z] = cubeCellPosition(cube, cell, style);
    const p = projectCube(v, x, y, z);
    const radius = Math.max(4, ((cubeVoxelHalf(cube, cell) * v.fy * v.h) / 2 / p.depth) * 1.25);
    if (Math.hypot(px - p.sx, py - p.sy) <= radius && p.depth < bestDepth) {
      best = cell;
      bestDepth = p.depth;
    }
  }
  return best;
}

/** Tooltip rows (column names + values) for a hovered cell. */
export function cubeCellTooltip(cube: DataCube, cell: CubeCell): { columns: string[]; row: (string | number)[] } {
  const columns = [cube.x.field, cube.y.field, cube.z.field];
  // Same field on two axes would collide as React keys in the tooltip.
  const unique = columns.map((c, i) => (columns.indexOf(c) === i ? c : `${c} (${["rows", "cols", "depth"][i]})`));
  const out = {
    columns: [...unique, cube.valueLabel],
    row: [cube.x.labels[cell.xi]!, cube.y.labels[cell.yi]!, cube.z.labels[cell.zi]!, formatCubeNumber(cell.value)] as (string | number)[],
  };
  if (cube.aggregate !== "count") {
    out.columns.push("Rows");
    out.row.push(cell.count);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Canvas 2D rendering (fallback + capture + chrome layers over WebGPU)
// ---------------------------------------------------------------------------

export interface DataCubeRenderOpts extends CubeCellStyle {
  /** Sequential ramp for value → color. */
  ramp: string[];
  opacity: number;
  camera: CubeCamera;
  fontFamily?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  themeBg?: string;
  showLegend?: boolean;
  /** Hovered cell; `zi: null` highlights the whole depth pillar (pivot table roll-up). */
  hovered?: { xi: number; yi: number; zi: number | null } | null;
  /** Thumbnail mode — no labels / legend. */
  mini?: boolean;
}

/** Face definitions: outward normal + 4 corner sign triples (CCW seen from outside). */
const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/** Same Lambert term the WGSL fragment shader uses. */
export function cubeShade(n: [number, number, number], light: [number, number, number]): number {
  return 0.42 + 0.58 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
}

function parseHex(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return [136, 136, 136];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function rgba(rgb: [number, number, number], k: number, a: number): string {
  return `rgba(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)},${Math.max(0, Math.min(1, a))})`;
}

/** Voxel RGBA (0–255 rgb + alpha) shared by Canvas and WebGPU paths. */
export function cubeCellColor(cell: CubeCell, ramp: string[], opacity: number): { rgb: [number, number, number]; alpha: number } {
  const hex = sampleContinuous(ramp.length ? ramp : ["#c6dbef", "#08519c"], 0.15 + 0.85 * cell.t);
  return { rgb: parseHex(hex), alpha: Math.min(1, opacity * (0.55 + 0.45 * cell.t)) };
}

type Vec3 = [number, number, number];

function boxCorners(ex: number, ey: number, ez: number): Vec3[] {
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * ex, sy * ey, sz * ez]);
  return out;
}

/** The 12 box edges as corner-index pairs (corners from boxCorners). */
const BOX_EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // z-parallel
  [0, 2], [1, 3], [4, 6], [5, 7], // y-parallel
  [0, 4], [1, 5], [2, 6], [3, 7], // x-parallel
];

/**
 * Back layer: the three far walls with bin gridlines (drawn under voxels).
 * Returns the index of the farthest box corner so the front layer can skip its edges.
 */
export function drawDataCubeBackLayer(ctx: CanvasRenderingContext2D, cube: DataCube, v: CubeView, opts: DataCubeRenderOpts): number {
  const { ex, ey, ez, pitch } = cubeExtents(cube);
  const corners = boxCorners(ex, ey, ez);
  const proj = corners.map((c) => projectCube(v, c[0], c[1], c[2]));
  let far = 0;
  proj.forEach((p, i) => { if (p.depth > proj[far]!.depth) far = i; });
  const fc = corners[far]!;
  const border = opts.themeBorder ?? "#3a3a44";

  ctx.save();
  ctx.lineWidth = 1;
  // Each far wall: fix one axis at the far corner's sign, grid the other two.
  const walls: { fixed: 0 | 1 | 2 }[] = [{ fixed: 0 }, { fixed: 1 }, { fixed: 2 }];
  for (const { fixed } of walls) {
    const ext = [ex, ey, ez];
    const others = [0, 1, 2].filter((a) => a !== fixed) as (0 | 1 | 2)[];
    // Wall fill
    const wallPts: Vec3[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const p: Vec3 = [0, 0, 0];
      p[fixed] = fc[fixed];
      p[others[0]!] = a! * ext[others[0]!]!;
      p[others[1]!] = b! * ext[others[1]!]!;
      return p;
    });
    ctx.fillStyle = withAlphaHex(border, 0.08);
    ctx.beginPath();
    wallPts.forEach((p, i) => {
      const s = projectCube(v, p[0], p[1], p[2]);
      if (i === 0) ctx.moveTo(s.sx, s.sy); else ctx.lineTo(s.sx, s.sy);
    });
    ctx.closePath();
    ctx.fill();
    // Gridlines at bin boundaries
    ctx.strokeStyle = withAlphaHex(border, opts.mini ? 0.35 : 0.55);
    for (const axis of others) {
      const other = others.find((a) => a !== axis)!;
      const n = Math.round((2 * ext[axis]!) / pitch);
      for (let i = 0; i <= n; i++) {
        const a: Vec3 = [0, 0, 0];
        const b: Vec3 = [0, 0, 0];
        a[fixed] = b[fixed] = fc[fixed];
        a[axis] = b[axis] = -ext[axis]! + i * pitch;
        a[other] = -ext[other]!;
        b[other] = ext[other]!;
        const sa = projectCube(v, a[0], a[1], a[2]);
        const sb = projectCube(v, b[0], b[1], b[2]);
        ctx.beginPath();
        ctx.moveTo(sa.sx, sa.sy);
        ctx.lineTo(sb.sx, sb.sy);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  return far;
}

/** Voxels via painter's algorithm (Canvas fallback only — WebGPU draws these otherwise). */
export function drawDataCubeVoxels(ctx: CanvasRenderingContext2D, cube: DataCube, v: CubeView, opts: DataCubeRenderOpts): void {
  const sorted = sortCellsBackToFront(cube, v, opts);
  ctx.save();
  ctx.lineJoin = "round";
  for (const { cell } of sorted) {
    const [cx, cy, cz] = cubeCellPosition(cube, cell, opts);
    const hs = cubeVoxelHalf(cube, cell);
    const { rgb, alpha: baseAlpha } = cubeCellColor(cell, opts.ramp, opts.opacity);
    const alpha = baseAlpha * cubeCellAlphaScale(cell, opts);
    for (const face of FACES) {
      const pts = face.c.map(([a, b, c]) => projectCube(v, cx + a * hs, cy + b * hs, cz + c * hs));
      // Back-face cull by screen winding (CCW from outside → negative area in y-down screen space).
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % 4]!;
        area += p.sx * q.sy - q.sx * p.sy;
      }
      if (area >= 0) continue;
      const k = cubeShade(face.n, v.light);
      ctx.fillStyle = rgba(rgb, k, alpha);
      ctx.strokeStyle = rgba(rgb, k * 0.7, Math.min(1, alpha + 0.15 * cubeCellAlphaScale(cell, opts)));
      ctx.lineWidth = opts.mini ? 0.5 : 0.75;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function withAlphaHex(color: string, a: number): string {
  const rgb = parseHex(color);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

/**
 * Front layer: near box edges, hovered-voxel outline, axis tick labels + titles, value legend.
 * `far` is the farthest corner index from drawDataCubeBackLayer.
 */
export function drawDataCubeFrontLayer(
  ctx: CanvasRenderingContext2D,
  cube: DataCube,
  v: CubeView,
  far: number,
  opts: DataCubeRenderOpts,
): void {
  const { ex, ey, ez, pitch } = cubeExtents(cube);
  const corners = boxCorners(ex, ey, ez);
  const proj = corners.map((c) => projectCube(v, c[0], c[1], c[2]));
  const text = opts.themeText ?? "#e8e8ec";
  const muted = opts.themeMuted ?? "#8a8a96";
  const border = opts.themeBorder ?? "#3a3a44";
  const font = opts.fontFamily ?? "Inter";

  ctx.save();
  ctx.strokeStyle = withAlphaHex(border, 0.9);
  ctx.lineWidth = 1;
  for (const [a, b] of BOX_EDGES) {
    if (a === far || b === far) continue;
    ctx.beginPath();
    ctx.moveTo(proj[a]!.sx, proj[a]!.sy);
    ctx.lineTo(proj[b]!.sx, proj[b]!.sy);
    ctx.stroke();
  }

  // Active slice: dashed frame around the depth layer in focus.
  const slice = opts.slice ?? null;
  if (slice != null && slice >= 0 && slice < cube.z.labels.length) {
    const zc = ez - (slice + 0.5) * pitch;
    const m = pitch * 0.08;
    const frame: Vec3[] = [[-ex - m, -ey - m, zc], [ex + m, -ey - m, zc], [ex + m, ey + m, zc], [-ex - m, ey + m, zc]];
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = withAlphaHex(text, 0.7);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    frame.forEach((p, i) => {
      const q = projectCube(v, p[0], p[1], p[2]);
      if (i === 0) ctx.moveTo(q.sx, q.sy); else ctx.lineTo(q.sx, q.sy);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  const hov = opts.hovered;
  const hovCells = hov
    ? cube.cells.filter(
        (c) => c.xi === hov.xi && c.yi === hov.yi && (hov.zi == null ? slice == null || c.zi === slice : c.zi === hov.zi),
      )
    : [];
  const hovCell = hovCells[0] ?? null;
  ctx.strokeStyle = text;
  ctx.lineWidth = 1.5;
  for (const hc of hovCells) {
    const [cx, cy, cz] = cubeCellPosition(cube, hc, opts);
    const hs = cubeVoxelHalf(cube, hc) * 1.08;
    const vc = boxCorners(hs, hs, hs).map((c) => projectCube(v, cx + c[0], cy + c[1], cz + c[2]));
    for (const [a, b] of BOX_EDGES) {
      ctx.beginPath();
      ctx.moveTo(vc[a]!.sx, vc[a]!.sy);
      ctx.lineTo(vc[b]!.sx, vc[b]!.sy);
      ctx.stroke();
    }
  }

  if (opts.mini) {
    ctx.restore();
    return;
  }

  const center = projectCube(v, 0, 0, 0);
  const sidePick = (cands: [Vec3, Vec3][], score: (mid: { sx: number; sy: number }) => number) => {
    let best = cands[0]!;
    let bestScore = -Infinity;
    for (const e of cands) {
      const a = projectCube(v, ...e[0]);
      const b = projectCube(v, ...e[1]);
      const s = score({ sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 });
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  };
  // Floor = whichever horizontal level sits lower on screen (works when orbiting below the cube too).
  const floorY = projectCube(v, 0, -ey, 0).sy >= projectCube(v, 0, ey, 0).sy ? -ey : ey;
  // Columns run along the floor edge nearest the viewer.
  const colEdge = sidePick(
    [[[-ex, floorY, ez], [ex, floorY, ez]], [[-ex, floorY, -ez], [ex, floorY, -ez]]],
    (m) => m.sy,
  );
  // Depth runs along the floor edge farthest out horizontally.
  const depthEdge = sidePick(
    [[[-ex, floorY, ez], [-ex, floorY, -ez]], [[ex, floorY, ez], [ex, floorY, -ez]]],
    (m) => Math.abs(m.sx - center.sx),
  );
  const depthSide = Math.sign(projectCube(v, depthEdge[0][0], floorY, 0).sx - center.sx) || 1;
  // Rows run up the vertical edge on the opposite side from depth labels.
  const rowCands: [Vec3, Vec3][] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rowCands.push([[sx * ex, ey, sz * ez], [sx * ex, -ey, sz * ez]]);
  const rowEdge = sidePick(rowCands, (m) => -depthSide * (m.sx - center.sx));

  const drawAxis = (
    edge: [Vec3, Vec3],
    axis: CubeAxis,
    pos: (i: number) => Vec3,
    hoverIdx: number | null,
    title: string,
    titleAt: "start" | "mid" | "end",
  ) => {
    const a = projectCube(v, ...edge[0]);
    const b = projectCube(v, ...edge[1]);
    const mx = (a.sx + b.sx) / 2 - center.sx;
    const my = (a.sy + b.sy) / 2 - center.sy;
    // Push labels perpendicular to the edge (away from the cube) so adjacent axes fan apart.
    let ox = -(b.sy - a.sy);
    let oy = b.sx - a.sx;
    if (Math.hypot(ox, oy) < 1) {
      ox = mx;
      oy = my;
    } else if (ox * mx + oy * my < 0) {
      ox = -ox;
      oy = -oy;
    }
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const n = axis.labels.length;
    const pts = axis.labels.map((_, i) => projectCube(v, ...pos(i)));
    const align: CanvasTextAlign = ox > 0.35 ? "left" : ox < -0.35 ? "right" : "center";
    ctx.textAlign = align;
    ctx.textBaseline = oy > 0.35 ? "top" : oy < -0.35 ? "bottom" : "middle";
    ctx.font = `400 10px ${font}, sans-serif`;
    const labels = axis.labels.map((l) => fitTextEllipsis(ctx, l, 96));
    // Thin labels so neighbours don't overlap: centered labels need their width, side labels a line height.
    const dx0 = n > 1 ? Math.abs(pts[1]!.sx - pts[0]!.sx) : 999;
    const dy0 = n > 1 ? Math.abs(pts[1]!.sy - pts[0]!.sy) : 999;
    const maxW = Math.max(...labels.map((l) => ctx.measureText(l).width));
    const need = align === "center" ? maxW + 6 : 12;
    const step = Math.max(1, Math.ceil(need / Math.max(1, align === "center" ? dx0 : dy0)));
    for (let i = 0; i < n; i++) {
      const isHover = hoverIdx === i;
      if (i % step !== 0 && !isHover) continue;
      const p = pts[i]!;
      ctx.font = `${isHover ? 600 : 400} 10px ${font}, sans-serif`;
      ctx.fillStyle = isHover ? text : muted;
      ctx.fillText(labels[i]!, p.sx + ox * 8, p.sy + oy * 8);
    }
    ctx.font = `600 10.5px ${font}, sans-serif`;
    ctx.fillStyle = text;
    if (titleAt === "mid") {
      // Beyond the tick labels, away from the box.
      const reach = 8 + (align === "center" ? 13 : maxW) + 8;
      ctx.fillText(fitTextEllipsis(ctx, title, 160), (a.sx + b.sx) / 2 + ox * reach, (a.sy + b.sy) / 2 + oy * reach);
      return;
    }
    // Past the first or last tick, continuing along the edge.
    const tip = titleAt === "end" ? pts[n - 1]! : pts[0]!;
    const prev = n > 1 ? (titleAt === "end" ? pts[n - 2]! : pts[1]!) : titleAt === "end" ? a : b;
    let dx = tip.sx - prev.sx;
    let dy = tip.sy - prev.sy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    ctx.textAlign = dx > 0.35 ? "left" : dx < -0.35 ? "right" : "center";
    ctx.textBaseline = dy > 0.35 ? "top" : dy < -0.35 ? "bottom" : "middle";
    ctx.fillText(fitTextEllipsis(ctx, title, 140), tip.sx + dx * 16 + ox * 6, tip.sy + dy * 16 + oy * 6);
  };

  const half = pitch / 2;
  drawAxis(
    rowEdge,
    cube.x,
    (i) => [rowEdge[0][0], ey - half - i * pitch, rowEdge[0][2]],
    hovCell?.xi ?? null,
    cube.x.field,
    floorY < 0 ? "start" : "end",
  );
  drawAxis(
    colEdge,
    cube.y,
    (i) => [-ex + half + i * pitch, floorY, colEdge[0][2]],
    hovCell?.yi ?? null,
    cube.y.field,
    "mid",
  );
  drawAxis(
    depthEdge,
    cube.z,
    (i) => [depthEdge[0][0], floorY, ez - half - i * pitch],
    hov?.zi ?? slice,
    cube.z.field,
    "mid",
  );

  if (opts.showLegend !== false) drawCubeLegend(ctx, cube, v, opts);

  ctx.fillStyle = muted;
  ctx.font = `10px ${font}, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitTextEllipsis(ctx, opts.slice != null ? "Slice · click a voxel or Esc for all layers · [ ] to step" : "Data cube · drag to orbit · click a voxel to slice", v.w - 24), 12, v.h - 10);
  ctx.restore();
}

function drawCubeLegend(ctx: CanvasRenderingContext2D, cube: DataCube, v: CubeView, opts: DataCubeRenderOpts): void {
  const font = opts.fontFamily ?? "Inter";
  const barW = Math.min(120, v.w * 0.28);
  const x = v.w - barW - 14;
  const y = 16;
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    ctx.fillStyle = sampleContinuous(opts.ramp.length ? opts.ramp : ["#c6dbef", "#08519c"], 0.15 + 0.85 * t);
    ctx.fillRect(x + (barW * i) / steps, y + 14, barW / steps + 0.5, 7);
  }
  ctx.font = `600 10px ${font}, sans-serif`;
  ctx.fillStyle = opts.themeText ?? "#e8e8ec";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitTextEllipsis(ctx, cube.valueLabel, barW + 40), x + barW, y + 10);
  ctx.font = `10px ${font}, sans-serif`;
  ctx.fillStyle = opts.themeMuted ?? "#8a8a96";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(formatCubeNumber(cube.vMin), x, y + 24);
  ctx.textAlign = "right";
  ctx.fillText(formatCubeNumber(cube.vMax), x + barW, y + 24);
}

/** Full Canvas 2D frame: background, back walls, voxels, front chrome. */
export function renderDataCubeCanvas(
  ctx: CanvasRenderingContext2D,
  cube: DataCube,
  w: number,
  h: number,
  opts: DataCubeRenderOpts,
): void {
  const v = cubeView(opts.camera, w, h);
  ctx.save();
  ctx.fillStyle = opts.themeBg ?? "#0a0a0c";
  ctx.fillRect(0, 0, w, h);
  const far = drawDataCubeBackLayer(ctx, cube, v, opts);
  drawDataCubeVoxels(ctx, cube, v, opts);
  drawDataCubeFrontLayer(ctx, cube, v, far, opts);
  ctx.restore();
}
