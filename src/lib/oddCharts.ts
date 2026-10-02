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
  fontOf,
  inkOn,
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

export const ODD_CHART_KINDS = [
  "bucketField",
  "beeswarm",
  "chernoff",
  "glyphStar",
  "waffle",
  "isotype",
  "pyramid",
  "slope",
  "bump",
  "stream",
  "horizon",
  "spiral",
  "radialBar",
  "chord",
  "voronoi",
  "isoBars",
  "isoScatter",
  "flower",
  "mosaic",
  "contour",
] as const;

export type OddChartKind = (typeof ODD_CHART_KINDS)[number];

export const ODD_CHART_KIND_OPTIONS: { value: OddChartKind; label: string }[] = [
  { value: "bucketField", label: "Bucket field" },
  { value: "beeswarm", label: "Beeswarm" },
  { value: "chernoff", label: "Chernoff faces" },
  { value: "glyphStar", label: "Star glyphs" },
  { value: "waffle", label: "Waffle" },
  { value: "isotype", label: "Isotype units" },
  { value: "pyramid", label: "Mirror pyramid" },
  { value: "slope", label: "Slope" },
  { value: "bump", label: "Bump ranks" },
  { value: "stream", label: "Streamgraph" },
  { value: "horizon", label: "Horizon" },
  { value: "spiral", label: "Time spiral" },
  { value: "radialBar", label: "Radial bars" },
  { value: "chord", label: "Chord" },
  { value: "voronoi", label: "Voronoi" },
  { value: "isoBars", label: "Isometric bars" },
  { value: "isoScatter", label: "Isometric scatter" },
  { value: "flower", label: "Flower petals" },
  { value: "mosaic", label: "Mosaic" },
  { value: "contour", label: "Density contour" },
];

export function isOddChartKind(kind: string): kind is OddChartKind {
  return (ODD_CHART_KINDS as readonly string[]).includes(kind);
}

export const ODD_NON_CARTESIAN = new Set<string>([
  "bucketField",
  "chernoff",
  "glyphStar",
  "waffle",
  "isotype",
  "radialBar",
  "chord",
  "flower",
  "spiral",
  "isoBars",
  "mosaic",
]);

export interface OddRenderOpts {
  colors: string[];
  opacity?: number;
  fontFamily?: string;
  axisLabelColor?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  showDataLabels?: boolean;
  pointSize?: number;
  continuousStops?: string[];
  yAggregate?: YAggregateOption | null;
  /** Theme background (for halos / contrast); falls back to the document theme. */
  themeBg?: string;
  /** "none" suppresses the renderer's own color legend; otherwise it draws one when a color field is encoded. */
  legendPosition?: string | null;
}

type ColType = "quantitative" | "nominal" | "temporal";

function inferType(dt: string, colName?: string): ColType {
  const t = dt.toUpperCase();
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some((n) => t.includes(n))) {
    return "quantitative";
  }
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some((n) => t.includes(n))) return "temporal";
  if (colName && /(_at$|_date$|^date|time|ts$|year|month|day)/i.test(colName)) return "temporal";
  return "nominal";
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(seed: string, i: number): number {
  const h = hash(`${seed}:${i}`);
  return (h % 10000) / 10000;
}

function agg(vals: number[], how: YAggregateOption = "sum"): number {
  if (vals.length === 0) return 0;
  if (how === "count") return vals.length;
  if (how === "mean") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (how === "min") return Math.min(...vals);
  if (how === "max") return Math.max(...vals);
  return vals.reduce((a, b) => a + b, 0);
}

function numColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "quantitative");
}
function nomColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "nominal");
}
function timeColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "temporal");
}

function pick<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

function groupSum(
  rows: unknown[][],
  xi: number,
  yi: number,
  how: YAggregateOption = "sum",
): [string, number][] {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi] ?? "");
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(yi >= 0 ? toNum(r[yi]) : 1);
  }
  return [...m.entries()]
    .map(([k, vs]) => [k, agg(vs.filter((v) => !isNaN(v)), how)] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

/** Strict numeric parse: null / "" / non-numeric strings are NaN (Number(null) would be 0). */
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// Spec / encoding helpers (called from recommendations.ts)
// ---------------------------------------------------------------------------

export function oddChartDataSupport(
  columns: ColumnInfo[],
  kind: OddChartKind,
): { ok: boolean; reason: string } {
  const num = numColsOf(columns);
  const nom = nomColsOf(columns);
  const time = timeColsOf(columns);
  const nomN = (lo: number, hi: number) => nom.filter((c) => c.distinct_count >= lo && c.distinct_count <= hi);

  switch (kind) {
    case "bucketField":
    case "beeswarm":
      return nomN(2, 12).length >= 1 && num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a bucket category (2–12) + numeric" };
    case "chernoff":
    case "glyphStar":
    case "flower":
      return nomN(2, 16).length >= 1 && num.length >= 3
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–16) + ≥3 numeric features" };
    case "waffle":
    case "isotype":
    case "radialBar":
    case "isoBars":
      return nomN(2, 20).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–20)" };
    case "pyramid":
    case "slope":
      return nomN(2, 20).length >= 1 && num.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category + two numeric measures" };
    case "bump":
    case "stream":
    case "horizon":
    case "spiral":
      return (time.length > 0 || nom.length > 0) && num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a time/order column + numeric" };
    case "chord":
    case "mosaic":
      return nom.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 12).length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need two categories (2–12 each)" };
    case "voronoi":
    case "isoScatter":
    case "contour":
      return num.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns" };
    default:
      return { ok: false, reason: "Unknown odd chart" };
  }
}

export function getOddRandomEncoding(
  columns: ColumnInfo[],
  kind: OddChartKind,
): { xField: string; yField: string | null; colorField: string | null; sizeField?: string | null } | null {
  const num = numColsOf(columns);
  const nom = nomColsOf(columns);
  const time = timeColsOf(columns);
  const nomN = (lo: number, hi: number) => nom.filter((c) => c.distinct_count >= lo && c.distinct_count <= hi);

  switch (kind) {
    case "bucketField":
    case "beeswarm": {
      const x = pick(nomN(2, 12));
      const y = pick(num);
      if (!x || !y) return null;
      const color = pick(nom.filter((c) => c.name !== x.name && c.distinct_count <= 10)) ?? null;
      const size = num.length >= 2 && Math.random() > 0.4
        ? pick(num.filter((c) => c.name !== y.name)) ?? null
        : null;
      return { xField: x.name, yField: y.name, colorField: color?.name ?? null, sizeField: size?.name ?? null };
    }
    case "chernoff":
    case "glyphStar":
    case "flower": {
      const x = pick(nomN(2, 16));
      if (!x || num.length < 3) return null;
      const shuffled = [...num].sort(() => Math.random() - 0.5);
      return {
        xField: x.name,
        yField: shuffled[0]!.name,
        colorField: shuffled[1]!.name,
        sizeField: shuffled[2]!.name,
      };
    }
    case "waffle":
    case "isotype":
    case "radialBar":
    case "isoBars": {
      const x = pick(nomN(2, 20));
      if (!x) return null;
      const y = num.length > 0 ? pick(num)! : null;
      const color = pick(nom.filter((c) => c.name !== x.name && c.distinct_count <= 8)) ?? null;
      return { xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null };
    }
    case "pyramid":
    case "slope": {
      const x = pick(nomN(2, 20));
      if (!x || num.length < 2) return null;
      const shuffled = [...num].sort(() => Math.random() - 0.5);
      return {
        xField: x.name,
        yField: shuffled[0]!.name,
        colorField: null,
        sizeField: shuffled[1]!.name,
      };
    }
    case "bump":
    case "stream": {
      const x = pick(time.length ? time : nom);
      const y = pick(num);
      if (!x || !y) return null;
      const color = pick(nomN(2, 10).filter((c) => c.name !== x.name)) ?? null;
      return { xField: x.name, yField: y.name, colorField: color?.name ?? null };
    }
    case "horizon":
    case "spiral": {
      const x = pick(time.length ? time : nom);
      const y = pick(num);
      if (!x || !y) return null;
      return { xField: x.name, yField: y.name, colorField: null };
    }
    case "chord":
    case "mosaic": {
      const pool = nom.filter((c) => c.distinct_count >= 2 && c.distinct_count <= 12);
      const a = pick(pool);
      if (!a) return null;
      const b = pick(pool.filter((c) => c.name !== a.name));
      if (!b) return null;
      const y = num.length ? pick(num)! : null;
      return { xField: a.name, yField: y?.name ?? null, colorField: b.name };
    }
    case "voronoi":
    case "contour": {
      if (num.length < 2) return null;
      const a = pick(num)!;
      const b = pick(num.filter((c) => c.name !== a.name))!;
      const color = pick(nomN(2, 12)) ?? null;
      return { xField: a.name, yField: b.name, colorField: color?.name ?? null };
    }
    case "isoScatter": {
      if (num.length < 2) return null;
      const shuffled = [...num].sort(() => Math.random() - 0.5);
      const color = pick(nomN(2, 10)) ?? null;
      return {
        xField: shuffled[0]!.name,
        yField: shuffled[1]!.name,
        colorField: color?.name ?? null,
        sizeField: shuffled[2]?.name ?? null,
      };
    }
    default:
      return null;
  }
}

export function buildOddChartRec(
  kind: OddChartKind,
  columns: ColumnInfo[],
  xField: string,
  yField: string | null,
  colorField: string | null,
  tableName: string,
  extra?: {
    sizeField?: string | null;
    yAggregate?: YAggregateOption | null;
  },
): ChartRecommendation | null {
  const support = oddChartDataSupport(columns, kind);
  if (!support.ok) return null;
  const num = numColsOf(columns);
  const nom = nomColsOf(columns);
  const sizeField = extra?.sizeField ?? null;
  const yAggregate = extra?.yAggregate ?? null;
  const colors = VIZ_CATEGORICAL;
  const id = `odd-${kind}-${xField}-${yField ?? "n"}-${colorField ?? "n"}-${sizeField ?? "n"}`;

  const titles: Record<OddChartKind, { title: string; subtitle: string }> = {
    bucketField: {
      title: yField ? `${yField} scattered in ${xField} fields` : `Dots in ${xField} fields`,
      subtitle: "bucket field — regions are categories; size & color still talk",
    },
    beeswarm: {
      title: yField ? `${yField} beeswarm by ${xField}` : `Beeswarm by ${xField}`,
      subtitle: "each row is a dot — no stacking, just swarm",
    },
    chernoff: {
      title: `Chernoff faces by ${xField}`,
      subtitle: "features encode numerics — weird but honest",
    },
    glyphStar: {
      title: `Star glyphs by ${xField}`,
      subtitle: "each star is a multivariate snapshot",
    },
    waffle: {
      title: yField ? `${yField} waffle by ${xField}` : `Waffle of ${xField}`,
      subtitle: "100-cell part-to-whole grid",
    },
    isotype: {
      title: yField ? `${yField} units by ${xField}` : `Unit chart of ${xField}`,
      subtitle: "one mark ≈ one chunk of value",
    },
    pyramid: {
      title: sizeField ? `${yField} ↔ ${sizeField} by ${xField}` : `Pyramid by ${xField}`,
      subtitle: "mirror bars — two sides of the same story",
    },
    slope: {
      title: sizeField ? `${yField} → ${sizeField}` : `Slope by ${xField}`,
      subtitle: "before / after as a lean diagonal",
    },
    bump: {
      title: yField ? `Rank bumps of ${yField}` : `Bump chart`,
      subtitle: "who rises and who falls across order",
    },
    stream: {
      title: yField ? `Stream of ${yField}` : `Streamgraph`,
      subtitle: "organic stacked flow over time",
    },
    horizon: {
      title: yField ? `Horizon of ${yField}` : `Horizon chart`,
      subtitle: "folded bands pack a tall range into a short strip",
    },
    spiral: {
      title: yField ? `Spiral of ${yField}` : `Time spiral`,
      subtitle: "time wraps outward — seasons hug seasons",
    },
    radialBar: {
      title: yField ? `${yField} on a wheel` : `Radial bars of ${xField}`,
      subtitle: "polar bars — nightingale vibes",
    },
    chord: {
      title: colorField ? `${xField} ↔ ${colorField}` : `Chord of ${xField}`,
      subtitle: "ribbons of flow between categories",
    },
    voronoi: {
      title: yField ? `${xField} × ${yField} territories` : `Voronoi`,
      subtitle: "each point claims the land around it",
    },
    isoBars: {
      title: yField ? `Isometric ${yField} by ${xField}` : `Isometric bars`,
      subtitle: "fake-3D blocks on a diamond grid",
    },
    isoScatter: {
      title: yField ? `Isometric ${xField} · ${yField}` : `Isometric scatter`,
      subtitle: "depth from a third measure (or size)",
    },
    flower: {
      title: `Flower garden by ${xField}`,
      subtitle: "each bloom is a multivariate petal set",
    },
    mosaic: {
      title: colorField ? `${xField} × ${colorField} mosaic` : `Mosaic of ${xField}`,
      subtitle: "area encodes share — marimekko cousin",
    },
    contour: {
      title: yField ? `Density of ${xField} × ${yField}` : `Contour`,
      subtitle: "smooth hills where points pile up",
    },
  };

  const meta = titles[kind];
  if (!meta) return null;

  // Light validation of required slots
  if ((kind === "pyramid" || kind === "slope") && (!yField || !sizeField)) {
    const alt = num.find((c) => c.name !== yField)?.name;
    if (!yField || !alt) return null;
  }
  if ((kind === "chord" || kind === "mosaic") && (!colorField || !nom.some((c) => c.name === colorField))) {
    return null;
  }
  if ((kind === "voronoi" || kind === "isoScatter" || kind === "contour") && !yField) return null;

  const enc: Record<string, unknown> = {
    x: { field: xField, type: "nominal" },
  };
  if (yField) enc.y = { field: yField, type: "quantitative" };
  if (colorField) enc.color = { field: colorField, type: "nominal", scale: { range: colors } };
  if (sizeField) enc.size = { field: sizeField, type: "quantitative" };

  void tableName;
  void yAggregate;

  return {
    id,
    kind: kind as ChartKind,
    title: meta.title,
    subtitle: meta.subtitle,
    score: 62,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      mark: { type: "circle", opacity: 0.75 },
      encoding: enc,
      width: "container",
      height: "container",
    },
    xField,
    yField: yField ?? (kind === "pyramid" || kind === "slope" ? num[0]?.name ?? null : null),
    colorField,
    sizeField:
      sizeField ??
      (kind === "pyramid" || kind === "slope"
        ? num.find((c) => c.name !== yField)?.name ?? null
        : undefined),
    yAggregate: ["waffle", "isotype", "radialBar", "isoBars", "chord", "mosaic"].includes(kind)
      ? (!yField ? "count" : (yAggregate ?? "sum"))
      : undefined,
  };
}

export function oddRecommendationReason(kind: OddChartKind): string {
  const map: Record<OddChartKind, string> = {
    bucketField: "Split the canvas into category regions; scatter dots inside with size & color",
    beeswarm: "One dot per row along a value axis — no overlap stacking",
    chernoff: "Cartoon faces whose features encode several numerics at once",
    glyphStar: "Star polygons — each axis is a different numeric feature",
    waffle: "Part-to-whole as a tidy 10×10 grid of cells",
    isotype: "Unit marks — count the icons, feel the magnitude",
    pyramid: "Two opposing bars — classic population / A-vs-B mirror",
    slope: "Two measures as a diagonal — rise or fall at a glance",
    bump: "Ranking over time — who climbs, who slips",
    stream: "Stacked organic ribbons over an ordered axis",
    horizon: "Band-folded time series — dense without tall axes",
    spiral: "Time curls outward so cycles sit next to cycles",
    radialBar: "Bars on a circle — polar drama for categories",
    chord: "Arcs of relationship between two category sets",
    voronoi: "Tessellate the plane so every point owns a cell",
    isoBars: "Isometric 3D-looking bars on a diamond floor",
    isoScatter: "Pseudo-3D scatter with depth from a third measure",
    flower: "A garden of multivariate blooms — one flower per group",
    mosaic: "Rectangle areas show joint category shares",
    contour: "Smooth density hills where observations cluster",
  };
  return map[kind] ?? "An unconventional view that fits your columns";
}

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
    look: {
      fontFamily: font,
      axisLabelColor: ink.muted,
      themeMuted: ink.muted,
      themeText: ink.text,
      themeBorder: ink.border,
      axisLineColor: inkTint(ink, 0.38),
      axisFontSize: 10,
    },
  };
  ctx.save();
  let message: string | void;
  try {
    message = fn(ctx, rows, env, xi, yi, ci, si);
  } finally {
    ctx.restore();
  }
  if (message) drawEmptyMessage(ctx, w, h, message, ink, font, mini);
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
  const maxRows = 8;
  const shown = entries.slice(0, maxRows);
  const extra = entries.length - shown.length;
  const lineH = 15;
  ctx.save();
  ctx.font = fontOf(10, env.font);
  const maxText = Math.min(150, Math.max(60, (plot.right - plot.left) * 0.32));
  let textW = Math.max(...shown.map((e) => ctx.measureText(e.label).width), extra > 0 ? ctx.measureText(`+${extra} more`).width : 0);
  if (title) {
    ctx.font = fontOf(10, env.font, 600);
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
    ctx.font = fontOf(10, env.font, 600);
    ctx.fillStyle = env.ink.text;
    ctx.fillText(fitTextEllipsis(ctx, title, bw - 16), x + 8, cy);
    cy += lineH;
  }
  ctx.font = fontOf(10, env.font);
  for (const e of shown) {
    ctx.fillStyle = e.color;
    if (e.shape === "line") ctx.fillRect(x + 8, cy - 1.5, 9, 3);
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
  const left = env.pad * 0.5 + 4;
  const maxW = env.w - 2 * left;
  const sizeH = spec.size ? 6 + (spec.size.title ? 14 : 0) + Math.max(3, spec.size.radiusOf(spec.size.max)) * 2 + 4 + 12 + 4 : 0;
  const rampW = spec.ramp ? Math.max(90, Math.min(180, maxW * 0.36)) : 0;
  const rampH = spec.ramp ? rampKeyHeight(!!spec.ramp.title) : 0;
  const swW = Math.max(60, maxW - (spec.size ? 130 : 0) - (rampW ? rampW + 16 : 0));
  const swH = spec.swatches?.length ? drawSwatchRow(ctx, spec.swatches, 0, 0, swW, env.ink, env.font, { measureOnly: true, maxRows: 2 }) : 0;
  let capLines: string[] = [];
  if (spec.caption) {
    ctx.save();
    ctx.font = fontOf(10, env.font);
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
        fontFamily: env.font,
        fill: spec.size.fill,
        panel: false,
        maxWidth: 160,
      });
      if (box) x += box.w + 16;
    }
    if (spec.ramp) {
      drawRampKey(ctx, { x, y: top, width: rampW, min: spec.ramp.min, max: spec.ramp.max, colorAt: spec.ramp.colorAt, title: spec.ramp.title, endLabels: spec.ramp.endLabels, ink: env.ink, fontFamily: env.font });
      x += rampW + 16;
    }
    if (spec.swatches?.length) {
      drawSwatchRow(ctx, spec.swatches, x, top, Math.max(60, env.w - left - x), env.ink, env.font, { maxRows: 2 });
    }
    if (capLines.length) {
      ctx.save();
      ctx.font = fontOf(10, env.font);
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
function sizeScaleOf(rows: unknown[][], si: number, rMin: number, rMax: number) {
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
    const t = zeroBased ? Math.max(0, v) / hi : (v - lo) / (hi - lo);
    return Math.max(rMin, rMax * Math.sqrt(Math.max(0, Math.min(1, t))));
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
function orderedKeys(rows: unknown[][], xi: number, max: number): { keys: string[]; pos: number[]; kind: "number" | "time" | "band"; domain: [number, number] | null } {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!set.has(k)) {
      set.add(k);
      seen.push(k);
    }
  }
  const cls = classifyKeys(seen);
  let keys = cls.kind === "band" ? seen.filter((k) => k !== "null" && k !== "undefined" && k !== "") : cls.sorted;
  let values = cls.kind === "band" ? keys.map((_, i) => i) : cls.values;
  if (keys.length > max) {
    // Even sample that keeps the first and last key.
    const idx = Array.from({ length: max }, (_, i) => Math.round((i * (keys.length - 1)) / (max - 1)));
    keys = idx.map((i) => keys[i]!);
    values = idx.map((i) => values[i]!);
  }
  if (cls.kind === "band" || keys.length < 2) {
    const n = Math.max(1, keys.length);
    return { keys, pos: keys.map((_, i) => (n === 1 ? 0.5 : i / (n - 1))), kind: "band", domain: null };
  }
  const lo = values[0]!;
  const hi = values[values.length - 1]!;
  return { keys, pos: values.map((v) => (v - lo) / (hi - lo || 1)), kind: cls.kind, domain: [lo, hi] };
}

/** X labels for an ordered axis: round ticks for numbers / dates, thinned keys for categories. */
function drawOrderedXAxis(
  ctx: CanvasRenderingContext2D,
  env: OddEnv,
  model: ReturnType<typeof orderedKeys>,
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
  const sScale = sizeScaleOf(rows, si, mini ? 1.2 : 1.8, mini ? 5 : 9);

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
      ctx.font = fontOf(10, env.font);
      const n = formatDataValue(counts.get(b) ?? 0);
      const nW = ctx.measureText(n).width;
      ctx.textBaseline = "middle";
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "right";
      ctx.fillText(n, x0 + cw - 6, y0 + headerH / 2 + 1);
      ctx.font = fontOf(10, env.font, 600);
      ctx.fillStyle = ink.text;
      ctx.textAlign = "left";
      ctx.fillText(fitTextEllipsis(ctx, b, Math.max(10, cw - 18 - nW)), x0 + 6, y0 + headerH / 2 + 1);
    }
    const inner = { left: x0 + 8, right: x0 + cw - 8, top: y0 + headerH + 6, bottom: y0 + ch - 6 };
    const ih = inner.bottom - inner.top;
    if (ih < 4) return;
    const pts = rows.filter((r) => String(r[xi]) === b).slice(0, mini ? 40 : 200);
    pts.forEach((r, i) => {
      const px = inner.left + jitter(b, i) * (inner.right - inner.left);
      const yv = ys ? toNum(r[yi]) : NaN;
      const py = ys && Number.isFinite(yv)
        ? inner.bottom - ((yv - ys.min) / (ys.max - ys.min || 1)) * ih
        : inner.top + jitter(b, i + 97) * ih;
      const rDot = sScale ? sScale.radiusOf(toNum(r[si])) : base;
      const color = ci >= 0 ? env.colors[(catIdx.get(String(r[ci])) ?? 0) % env.colors.length]! : env.single;
      dot(ctx, px, py, rDot, color, env.alpha, total <= 800 ? ink.bg : null);
    });
    // Shared value scale: round min / max ticks beside the first column of regions.
    if (ys && !mini && col === 0 && env.pad >= 28 && ih >= 36) {
      ctx.font = fontOf(9, env.font);
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
  for (const r of rows) {
    const k = String(r[xi]);
    if (!Number.isFinite(toNum(r[yi]))) continue;
    const l = byCat.get(k) ?? [];
    l.push(r);
    byCat.set(k, l);
  }
  const maxN = Math.max(1, ...cats.map((c) => Math.min(mini ? 60 : 250, byCat.get(c)?.length ?? 0)));
  // Shrink dots when a band is crowded so the swarm still fits its column.
  const fit = Math.sqrt((bandW * 0.8 * ph) / (maxN * Math.PI * 1.6));
  const base = Math.max(1.4, Math.min(mini ? 2.2 : radiusFromPointSize(env.opts.pointSize, 3.2), fit));
  const sScale = sizeScaleOf(rows, si, base * 0.6, base * 2.4);
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
      dot(ctx, px, py, rr, color, env.alpha, total <= 800 ? ink.bg : null);
    }
  });
  if (ci >= 0 && ci !== xi) drawPanelLegend(ctx, env, legendEntriesFor(rows, ci, env.colors), fieldName(env, ci), plot, "top-right");
  if (sScale && !mini) {
    drawSizeKey(ctx, {
      x: plot.left + 6,
      bottom: plot.top + 6 + 60,
      min: sScale.min,
      max: sScale.max,
      radiusOf: sScale.radiusOf,
      title: fieldName(env, si),
      ink,
      fontFamily: env.font,
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
    if (!mini) {
      ctx.font = fontOf(10, env.font);
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
    if (!mini) {
      ctx.font = fontOf(10, env.font);
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
    if (!mini) {
      ctx.font = fontOf(10, env.font);
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
  const maxCats = 8;
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
    const legH = drawSwatchRow(ctx, legend, 0, 0, availW, ink, env.font, { measureOnly: true, maxRows: 3 });
    size = Math.max(40, Math.min(availW, availH - legH - 10));
    gx = base.left + (availW - size) / 2;
    gy = base.top + Math.max(0, (availH - size - legH - 10) / 2);
    legendBox = { x: base.left, y: gy + size + 10, w: availW, vertical: false };
  }
  const cell = size / 10;
  const inset = Math.max(0.5, cell * 0.07);
  let filled = 0;
  cells.forEach((n, ei) => {
    ctx.fillStyle = colorOf(ei);
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    for (let k = 0; k < n && filled < 100; k++, filled++) {
      const cx = filled % 10;
      const cy = Math.floor(filled / 10);
      ctx.fillRect(gx + cx * cell + inset, gy + cy * cell + inset, cell - 2 * inset, cell - 2 * inset);
    }
  });
  ctx.globalAlpha = 1;
  if (legendBox) {
    if (legendBox.vertical) {
      ctx.font = fontOf(10, env.font);
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
      drawSwatchRow(ctx, legend, legendBox.x, legendBox.y, legendBox.w, ink, env.font, { maxRows: 3, align: "center" });
    }
  }
}

function drawIsotype(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the unit chart";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(0, env.mini ? 5 : 8);
  if (!entries.length) return "Nothing positive to count in units";
  const { mini, ink } = env;
  const maxV = Math.max(...entries.map(([, v]) => v));
  const { plot, footerTop } = plotAboveFooter(env, mini ? 0 : 14);
  ctx.font = fontOf(10, env.font);
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
    for (let i = 0; i <= full && i < maxIcons + 1; i++) {
      const part = i < full ? 1 : frac;
      if (part <= 0.02) break;
      const px = x0 + i * step;
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
    if (!mini) {
      ctx.font = fontOf(10, env.font);
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
    ctx.font = fontOf(10, env.font);
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
  const byCat = new Map<string, { left: number; right: number }>();
  for (const r of rows) {
    const c = String(r[xi] ?? "");
    if (!c) continue;
    const cur = byCat.get(c) ?? { left: 0, right: 0 };
    const lv = toNum(r[yi]);
    const rv = toNum(r[si]);
    if (Number.isFinite(lv)) cur.left += lv;
    if (Number.isFinite(rv)) cur.right += rv;
    byCat.set(c, cur);
  }
  const ranked = [...byCat.entries()]
    .map(([c, v]) => ({ c, left: Math.max(0, v.left), right: Math.max(0, v.right), score: Math.max(v.left, v.right) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, env.mini ? 8 : 14);
  if (!ranked.length) return "No positive values to mirror";
  const { mini, ink } = env;
  const leftColor = env.colors[0]!;
  const rightColor = env.colors[1 % env.colors.length]!;
  const headerH = mini ? 0 : 18;
  const base = basePlot(env);
  const plot = { ...base, top: base.top + headerH };
  const pw = plot.right - plot.left;
  ctx.font = fontOf(10, env.font);
  const labelW = mini ? 6 : Math.max(50, Math.min(pw * 0.26, Math.max(...ranked.map((p) => ctx.measureText(p.c).width)) + 14));
  const mid = plot.left + pw / 2;
  const arm = Math.max(8, (pw - labelW) / 2);
  // Independent round scales per side (cases vs deaths often differ by orders of magnitude).
  const nT = Math.max(2, Math.min(4, Math.floor(arm / 60)));
  const lt = niceTicks(0, Math.max(...ranked.map((p) => p.left), 1e-9), nT, true);
  const rt = niceTicks(0, Math.max(...ranked.map((p) => p.right), 1e-9), nT, true);
  const shared = lt.max === rt.max && lt.step === rt.step;
  const bandH = (plot.bottom - plot.top) / ranked.length;
  const barH = Math.max(3, bandH * 0.68);
  const lx = (v: number) => mid - labelW / 2 - (v / (lt.max || 1)) * arm;
  const rx = (v: number) => mid + labelW / 2 + (v / (rt.max || 1)) * arm;

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
    const items = [
      ...lt.ticks.map((v) => ({ x: lx(v), label: formatAxisValue(v, lt.step) })),
      ...rt.ticks.map((v) => ({ x: rx(v), label: formatAxisValue(v, rt.step) })),
    ].sort((a, b) => a.x - b.x);
    drawPositionedLabelsX(ctx, items, env.w, env.h, plot, env.look);
  }

  const fs = Math.max(9, Math.min(10, bandH * 0.8));
  const every = Math.max(1, Math.ceil((fs + 2) / bandH));
  ranked.forEach((p, i) => {
    const cy = plot.top + (i + 0.5) * bandH;
    ctx.globalAlpha = Math.max(0.75, env.alpha);
    ctx.fillStyle = leftColor;
    ctx.fillRect(lx(p.left), cy - barH / 2, mid - labelW / 2 - lx(p.left), barH);
    ctx.fillStyle = rightColor;
    ctx.fillRect(mid + labelW / 2, cy - barH / 2, rx(p.right) - (mid + labelW / 2), barH);
    ctx.globalAlpha = 1;
    if (mini) return;
    ctx.textBaseline = "middle";
    if (i % every === 0) {
      ctx.font = fontOf(fs, env.font);
      ctx.fillStyle = ink.text;
      ctx.textAlign = "center";
      ctx.fillText(fitTextEllipsis(ctx, p.c, labelW - 10), mid, cy);
    }
    if (env.opts.showDataLabels && barH >= 10) {
      ctx.font = fontOf(9, env.font);
      ctx.fillStyle = ink.muted;
      const lt0 = formatDataValue(p.left);
      const rt0 = formatDataValue(p.right);
      ctx.textAlign = "right";
      if (lx(p.left) - ctx.measureText(lt0).width - 4 > plot.left - env.pad * 0.4) ctx.fillText(lt0, lx(p.left) - 4, cy);
      ctx.textAlign = "left";
      if (rx(p.right) + ctx.measureText(rt0).width + 4 < env.w - 4) ctx.fillText(rt0, rx(p.right) + 4, cy);
    }
  });

  if (!mini) {
    // Header doubles as the key: swatch + measure name over each arm.
    const hy = base.top + headerH / 2 - 2;
    ctx.font = fontOf(10, env.font, 600);
    ctx.textBaseline = "middle";
    const lName = fitTextEllipsis(ctx, fieldName(env, yi), arm - 20);
    const rName = fitTextEllipsis(ctx, fieldName(env, si), arm - 20);
    ctx.textAlign = "right";
    ctx.fillStyle = ink.text;
    ctx.fillText(lName, mid - labelW / 2 - 4, hy);
    ctx.fillStyle = leftColor;
    ctx.fillRect(mid - labelW / 2 - 4 - ctx.measureText(lName).width - 14, hy - 4.5, 9, 9);
    ctx.textAlign = "left";
    ctx.fillStyle = rightColor;
    ctx.fillRect(mid + labelW / 2 + 4, hy - 4.5, 9, 9);
    ctx.fillStyle = ink.text;
    ctx.fillText(rName, mid + labelW / 2 + 18, hy);
    if (!shared) {
      ctx.font = fontOf(9, env.font);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.fillText(fitTextEllipsis(ctx, "separate scales", labelW - 4), mid, hy);
    }
  }
}

function drawSlope(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, _ci: number, si: number) {
  if (xi < 0 || yi < 0 || si < 0) return "Slope needs a category and two numeric columns";
  const groups = new Map<string, { a: number[]; b: number[] }>();
  for (const r of rows) {
    const k = String(r[xi]);
    let g = groups.get(k);
    if (!g) {
      if (groups.size >= 14) continue;
      g = { a: [], b: [] };
      groups.set(k, g);
    }
    const a = toNum(r[yi]);
    const b = toNum(r[si]);
    if (Number.isFinite(a)) g.a.push(a);
    if (Number.isFinite(b)) g.b.push(b);
  }
  const pairs = [...groups.entries()]
    .filter(([, g]) => g.a.length && g.b.length)
    .map(([c, g]) => ({ c, a: agg(g.a, "mean"), b: agg(g.b, "mean") }));
  if (!pairs.length) return "No rows have both values";
  const { mini, ink } = env;
  const vals = pairs.flatMap((p) => [p.a, p.b]);
  const ys = niceTicks(Math.min(...vals), Math.max(...vals), 5, true);
  const headerH = mini ? 0 : 18;
  const base = basePlot(env);
  const top = base.top + headerH;
  const ph = base.bottom - top;
  const sy = (v: number) => base.bottom - ((v - ys.min) / (ys.max - ys.min || 1)) * ph;
  ctx.font = fontOf(10, env.font);
  const labelOf = (p: (typeof pairs)[number]) => `${p.c}  ${formatDataValue(p.b)}`;
  const labelW = mini ? 0 : Math.max(60, Math.min((base.right - base.left) * 0.38, Math.max(...pairs.map((p) => ctx.measureText(labelOf(p)).width)) + 10));
  const x0 = base.left + (mini ? 6 : 8);
  const x1 = Math.max(x0 + 40, base.right + env.pad * 0.5 - labelW - 8);

  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.12 : 0.14);
    ctx.lineWidth = 1;
    ctx.font = fontOf(10, env.font);
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
    ctx.font = fontOf(10, env.font, 600);
    ctx.fillStyle = ink.text;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, fieldName(env, yi), (x1 - x0) / 2 - 6), x0, base.top + headerH / 2 - 2);
    ctx.textAlign = "right";
    ctx.fillText(fitTextEllipsis(ctx, fieldName(env, si), (x1 - x0) / 2 - 6), x1, base.top + headerH / 2 - 2);
  }

  ctx.lineCap = "round";
  for (const p of pairs) {
    ctx.strokeStyle = env.single;
    ctx.globalAlpha = Math.max(0.6, env.alpha);
    ctx.lineWidth = mini ? 1.2 : 2;
    ctx.beginPath();
    ctx.moveTo(x0, sy(p.a));
    ctx.lineTo(x1, sy(p.b));
    ctx.stroke();
    ctx.globalAlpha = 1;
    dot(ctx, x0, sy(p.a), mini ? 2.2 : 3.5, env.single, 1, mini ? null : ink.bg);
    dot(ctx, x1, sy(p.b), mini ? 2.2 : 3.5, env.single, 1, mini ? null : ink.bg);
  }
  if (mini) return;
  const targets = pairs.map((p) => sy(p.b));
  const placed = dodgeLabels(targets, 12, top + 5, base.bottom - 5);
  ctx.font = fontOf(10, env.font);
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
}

// ---- bump / stream / horizon / spiral --------------------------------------

function drawBump(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number) {
  if (xi < 0 || yi < 0) return "Bump chart needs an order column and a numeric column";
  if (ci < 0) return "Bump charts rank series — choose a color (series) field";
  const model = orderedKeys(rows, xi, 20);
  if (model.keys.length < 2) return "Need at least two positions to rank across";
  const { mini, ink } = env;
  const catIdx = categoryIndex(rows, ci);
  const cell = new Map<string, number[]>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const s = String(r[ci]);
    const key = `${String(r[xi])}||${s}`;
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
  const maxRank = series.length;
  ctx.font = fontOf(10, env.font);
  const labelW = mini ? 0 : Math.min(130, Math.max(...series.map((s) => ctx.measureText(s).width)) + 18);
  const base = basePlot(env);
  const plot = mini ? base : { ...base, left: base.left + 6, right: Math.min(base.right, env.w - labelW - 10) };
  const pw = plot.right - plot.left;
  const ph = plot.bottom - plot.top;
  const xAt = (i: number) => plot.left + model.pos[i]! * pw;
  const yAt = (rank: number) => plot.top + ((rank - 1) / Math.max(1, maxRank - 1)) * ph;
  if (!mini) {
    ctx.strokeStyle = inkTint(ink, ink.light ? 0.1 : 0.12);
    ctx.lineWidth = 1;
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const every = Math.max(1, Math.ceil(12 / Math.max(1, ph / Math.max(1, maxRank - 1))));
    for (let k = 1; k <= maxRank; k++) {
      const y = Math.round(yAt(k)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      if ((k - 1) % every === 0) ctx.fillText(`#${k}`, plot.left - 8, y);
    }
    drawOrderedXAxis(ctx, env, model, plot);
    drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), `Rank by ${fieldName(env, yi)}`, env.look);
  }
  const ends: { s: string; y: number; color: string }[] = [];
  series.forEach((s) => {
    const color = env.colors[(catIdx.get(s) ?? 0) % env.colors.length]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = mini ? 1.5 : 2.5;
    ctx.lineJoin = "round";
    ctx.globalAlpha = Math.max(0.7, env.alpha);
    ctx.beginPath();
    let pen = false;
    let last: { x: number; y: number } | null = null;
    model.keys.forEach((_, i) => {
      const rank = ranks[i]!.get(s);
      if (rank == null) {
        pen = false;
        return;
      }
      const x = xAt(i);
      const y = yAt(rank);
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
      last = { x, y };
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!mini) {
      model.keys.forEach((_, i) => {
        const rank = ranks[i]!.get(s);
        if (rank != null) dot(ctx, xAt(i), yAt(rank), 3.2, color, 1, ink.bg);
      });
    }
    if (last) ends.push({ s, y: (last as { y: number }).y, color });
  });
  if (mini) return;
  const placed = dodgeLabels(ends.map((e) => e.y), 12, plot.top - 4, plot.bottom + 4);
  ctx.font = fontOf(10, env.font);
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
  const model = orderedKeys(rows, xi, 60);
  if (model.keys.length < 2) return "Need at least two positions for a stream";
  const { mini, ink } = env;
  const catIdx = categoryIndex(rows, ci);
  const totalsBy = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v) || v < 0) continue;
    const s = ci >= 0 ? String(r[ci]) : "";
    const k = `${String(r[xi])}||${s}`;
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
    ctx.font = fontOf(10, env.font);
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
    ctx.font = fontOf(10, env.font, 600);
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
  const model = orderedKeys(rows, xi, 400);
  const sums = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const v = toNum(r[yi]);
    if (!Number.isFinite(v)) continue;
    const k = String(r[xi]);
    const cur = sums.get(k) ?? { s: 0, n: 0 };
    cur.s += v;
    cur.n += 1;
    sums.set(k, cur);
  }
  const pts = model.keys
    .map((k, i) => ({ pos: model.pos[i]!, v: sums.has(k) ? sums.get(k)!.s / sums.get(k)!.n : NaN }))
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
  type P = { y: number; c: string; x: string };
  let pts: P[] = rows
    .map((r, i) => ({ y: toNum(r[yi]), c: ci >= 0 ? String(r[ci]) : "", x: xi >= 0 ? String(r[xi]) : String(i + 1) }))
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
  ctx.lineCap = "round";
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
  if (!mini && xi >= 0) {
    ctx.font = fontOf(10, env.font);
    ctx.fillStyle = ink.muted;
    ctx.textBaseline = "middle";
    const s = posOf(0);
    const e = posOf(pts.length - 1);
    ctx.textAlign = "center";
    ctx.fillText(fitTextEllipsis(ctx, `start ${pts[0]!.x}`, maxR), s.x, s.y - 12);
    ctx.textAlign = e.x >= cx ? "left" : "right";
    ctx.fillText(fitTextEllipsis(ctx, `end ${pts[pts.length - 1]!.x}`, Math.max(40, env.w / 2 - 10)), e.x + (e.x >= cx ? 8 : -8), e.y);
  }
  footer.draw(footerTop);
}

// ---- radial bars / chord ---------------------------------------------------

function drawRadialBar(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number) {
  if (xi < 0) return "Choose a category for the wheel";
  const how = env.opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(0, 16);
  if (!entries.length) return "Nothing positive to plot on the wheel";
  const { mini, ink } = env;
  const plot = basePlot(env);
  const cx = (plot.left + plot.right) / 2;
  const cy = (plot.top + plot.bottom) / 2;
  ctx.font = fontOf(10, env.font);
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
    if (mini) return;
    const am = (a0 + a1) / 2;
    const lx = cx + Math.cos(am) * (r + 6);
    const ly = cy + Math.sin(am) * (r + 6);
    const right = Math.cos(am) >= 0;
    ctx.font = fontOf(10, env.font);
    ctx.fillStyle = ink.text;
    ctx.textAlign = Math.abs(Math.cos(am)) < 0.2 ? "center" : right ? "left" : "right";
    ctx.textBaseline = Math.sin(am) > 0.6 ? "top" : Math.sin(am) < -0.6 ? "bottom" : "middle";
    const room = right ? env.w - 4 - lx : lx - 4;
    const text = env.opts.showDataLabels ? `${label} · ${formatDataValue(v)}` : label;
    ctx.fillText(fitTextEllipsis(ctx, text, Math.max(24, Math.min(room, 140))), lx, ly);
  });
  if (!mini) {
    // Ring values sit in the 12 o'clock gap, haloed so they read over bar ends.
    ctx.font = fontOf(9, env.font);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const v of scale.ticks) {
      if (v <= 0) continue;
      const label = formatAxisValue(v, scale.step);
      ctx.strokeStyle = ink.bg;
      ctx.lineWidth = 3;
      ctx.strokeText(label, cx, cy - rOf(v));
      ctx.fillStyle = ink.muted;
      ctx.fillText(label, cx, cy - rOf(v));
    }
    ctx.font = fontOf(10, env.font);
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
  ctx.font = fontOf(10, env.font);
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
    dot(ctx, x, y, (mini ? 2.5 : 3.5) + (mini ? 2 : 4) * Math.sqrt(nodeTotal.get(n)! / maxNode), nodeColor(n), 1, ink.bg);
    if (mini) return;
    const right = Math.cos(ang) >= 0;
    const lx = cx + Math.cos(ang) * (R + 12);
    const ly = cy + Math.sin(ang) * (R + 12);
    ctx.font = fontOf(10, env.font);
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
    .map((r) => ({ x: toNum(r[xi]), y: toNum(r[yi]), c: ci >= 0 ? String(r[ci]) : "" }))
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
  const mapped = pts.map((p) => ({ x: sx(p.x), y: sy(p.y), c: p.c }));
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
  for (const p of mapped) dot(ctx, p.x, p.y, mini ? 1.8 : 3, colorOf(p.c), 1, ink.bg);
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
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(0, 12);
  if (!entries.length) return "Nothing positive to stack into bars";
  const { mini, ink } = env;
  const base = basePlot(env);
  const n = entries.length;
  const bandW = (base.right - base.left) / n;
  const depth = Math.max(3, Math.min(14, bandW * 0.3));
  const plot: PlotRect = { ...base, top: base.top + depth * 0.6, right: base.right - depth };
  const bw = Math.max(3, ((plot.right - plot.left) / n) * 0.6);
  const scale = niceTicks(0, Math.max(...entries.map(([, v]) => v)), 5, true);
  const ph = plot.bottom - plot.top;
  const yOf = (v: number) => plot.bottom - (v / (scale.max || 1)) * ph;
  if (!mini) {
    drawChartGrid(ctx, env.w, env.h, plot, gridLook(env), { x: null, y: [0, scale.max] });
    drawChartTicks(ctx, 0, 1, 0, scale.max, env.w, env.h, plot, env.look, { x: false });
  }
  const step = (plot.right - plot.left) / n;
  const centers = entries.map((_, i) => plot.left + (i + 0.5) * step);
  const front = env.single;
  const sideC = mixColor(front, "#000000", 0.3);
  const topC = mixColor(front, "#ffffff", 0.25);
  const dx = depth;
  const dy = -depth * 0.6;
  entries.forEach(([, v], i) => {
    const x0 = centers[i]! - bw / 2;
    const x1 = centers[i]! + bw / 2;
    const yT = yOf(v);
    const yB = plot.bottom;
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
  });
  if (mini) return;
  ctx.strokeStyle = inkTint(ink, 0.38);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.bottom + 0.5);
  ctx.lineTo(plot.right + depth, plot.bottom + 0.5);
  ctx.stroke();
  drawBandAxisX(ctx, entries.map(([l]) => l), centers, step, env.w, env.h, plot, env.look);
  drawAxisFieldLabels(ctx, env.w, env.h, env.pad, fieldName(env, xi), aggregateAxisTitle(how, fieldName(env, yi) || null), env.look);
  // Value on top of each bar when it fits.
  ctx.font = fontOf(10, env.font);
  ctx.fillStyle = ink.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  if (env.opts.showDataLabels !== false) {
    entries.forEach(([, v], i) => {
      const t = formatDataValue(v);
      if (ctx.measureText(t).width > step - 2) return;
      ctx.fillText(t, centers[i]! + dx / 2, yOf(v) + dy - 3);
    });
  }
}

function drawIsoScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], env: OddEnv, xi: number, yi: number, ci: number, si: number) {
  if (xi < 0 || yi < 0) return "Isometric scatter needs two numeric columns";
  let pts = rows
    .map((r) => ({ x: toNum(r[xi]), y: toNum(r[yi]), z: si >= 0 ? toNum(r[si]) : NaN, c: ci >= 0 ? String(r[ci]) : "" }))
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
  // Unit-space projection, then fit to the plot (with room for edge labels).
  const iso = (nx: number, ny: number, nz: number) => ({ X: (nx - ny) * cos30, Y: (nx + ny) * sin30 - nz * zH });
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
  // Points back to front, with drop lines when height is encoded.
  const catIdx = categoryIndex(rows, ci);
  const drawn = pts
    .map((p) => ({ p, n: [nX(p.x), nY(p.y), nZ(p.z)] as const }))
    .sort((a, b) => a.n[0] + a.n[1] - (b.n[0] + b.n[1]) || a.n[2] - b.n[2]);
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
    dot(ctx, top.sx, top.sy, r, color, env.alpha, ink.bg);
  }
  if (mini) return;
  // Edge tick labels on the two front floor edges, height ticks on the left pole.
  ctx.font = fontOf(10, env.font);
  ctx.fillStyle = ink.muted;
  ctx.textBaseline = "top";
  ctx.textAlign = "right";
  for (const v of xs.ticks) {
    const p = proj(nX(v), 1, 0);
    ctx.fillText(formatAxisValue(v, xs.step), p.sx - 4, p.sy + 3);
  }
  ctx.textAlign = "left";
  for (const v of ys.ticks) {
    const p = proj(1, nY(v), 0);
    ctx.fillText(formatAxisValue(v, ys.step), p.sx + 4, p.sy + 3);
  }
  ctx.font = fontOf(10, env.font, 600);
  ctx.fillStyle = ink.text;
  const xm = proj(0.5, 1, 0);
  const ym = proj(1, 0.5, 0);
  ctx.textAlign = "right";
  ctx.fillText(fitTextEllipsis(ctx, `${fieldName(env, xi)} →`, env.w / 2 - 20), xm.sx - 16, xm.sy + 18);
  ctx.textAlign = "left";
  ctx.fillText(fitTextEllipsis(ctx, `← ${fieldName(env, yi)}`, env.w / 2 - 20), ym.sx + 16, ym.sy + 18);
  if (zs) {
    const p0 = proj(0, 1, 0);
    const p1 = proj(0, 1, 1);
    ctx.strokeStyle = inkTint(ink, 0.38);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(p1.sx, p1.sy);
    ctx.stroke();
    ctx.font = fontOf(10, env.font);
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of zs.ticks) {
      const p = proj(0, 1, nZ(v));
      ctx.fillText(formatAxisValue(v, zs.step), p.sx - 5, p.sy);
    }
    ctx.font = fontOf(10, env.font, 600);
    ctx.fillStyle = ink.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(fitTextEllipsis(ctx, `↑ ${fieldName(env, si)}`, 140), p1.sx, p1.sy - 6);
  }
  if (ci >= 0) drawPanelLegend(ctx, env, legendEntriesFor(rows, ci, env.colors), fieldName(env, ci), base, "top-right");
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
  const legH = mini ? 0 : drawSwatchRow(ctx, legend, 0, 0, base.right - base.left, ink, env.font, { measureOnly: true, maxRows: 2 });
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
      if (!mini && colW - gap >= 30 && segH - gap >= 14) {
        ctx.font = fontOf(10, env.font);
        ctx.fillStyle = inkOn(color);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(percentLabel(v / colTotal), xCursor + (colW - gap) / 2, yCursor + (segH - gap) / 2);
      }
      yCursor += segH;
    });
    if (!mini && colW >= 18) {
      ctx.font = fontOf(10, env.font);
      ctx.fillStyle = ink.muted;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, a, colW - 4), xCursor + colW / 2, plot.bottom + 4);
    }
    xCursor += colW;
  });
  if (mini) return;
  ctx.font = fontOf(10, env.font);
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
  drawSwatchRow(ctx, legend, plot.left, plot.bottom + 20, pw, ink, env.font, { maxRows: 2, align: "center" });
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
    fontFamily: env.font,
    panel: true,
  });
}
