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
    m.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  return [...m.entries()]
    .map(([k, vs]) => [k, agg(vs.filter((v) => !isNaN(v)), how)] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

function lerpColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };
  try {
    const [ar, ag, ab] = parse(a);
    const [br, bg, bb] = parse(b);
    const r = Math.round(ar! + (br! - ar!) * t);
    const g = Math.round(ag! + (bg! - ag!) * t);
    const bl = Math.round(ab! + (bb! - ab!) * t);
    return `rgb(${r},${g},${bl})`;
  } catch {
    return a;
  }
}

function colorAt(stops: string[], t: number): string {
  if (stops.length === 0) return "#888";
  if (stops.length === 1) return stops[0]!;
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= stops.length - 1) return stops[stops.length - 1]!;
  return lerpColor(stops[i]!, stops[i + 1]!, f);
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
  if (fn) fn(ctx, rows, columns, xi, yi, ci, si, w, h, pad, opts, mini);
}

type Renderer = (
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
  mini: boolean,
) => void;

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

function drawBucketField(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0) return;
  const palette = opts.colors;
  const alpha = opts.opacity ?? 0.75;
  const buckets = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 8);
  if (buckets.length === 0) return;
  const colsN = buckets.length <= 3 ? buckets.length : Math.ceil(Math.sqrt(buckets.length));
  const rowsN = Math.ceil(buckets.length / colsN);
  const gap = mini ? 4 : 10;
  const cw = (w - 2 * pad - gap * (colsN - 1)) / colsN;
  const ch = (h - 2 * pad - gap * (rowsN - 1)) / rowsN;

  let sizeMin = Infinity;
  let sizeMax = -Infinity;
  if (si >= 0) {
    for (const r of rows) {
      const v = Number(r[si]);
      if (!isNaN(v)) {
        sizeMin = Math.min(sizeMin, v);
        sizeMax = Math.max(sizeMax, v);
      }
    }
  }
  const colorMap = new Map<string, number>();
  let nextC = 0;

  buckets.forEach((b, bi) => {
    const col = bi % colsN;
    const row = Math.floor(bi / colsN);
    const x0 = pad + col * (cw + gap);
    const y0 = pad + row * (ch + gap);
    ctx.fillStyle = opts.themeBorder ?? "#2a2a30";
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x0, y0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = opts.themeBorder ?? "#3a3a44";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, cw, ch);
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `10px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText(b.length > 14 ? b.slice(0, 13) + "…" : b, x0 + 6, y0 + 14);
    }
    const pts = rows.filter((r) => String(r[xi]) === b).slice(0, mini ? 40 : 200);
    pts.forEach((r, i) => {
      const jx = jitter(b, i);
      const jy = jitter(b, i + 97);
      const px = x0 + 8 + jx * (cw - 16);
      const py = y0 + (mini ? 8 : 22) + jy * (ch - (mini ? 16 : 30));
      let rDot = (opts.pointSize ?? 3) * (mini ? 0.7 : 1);
      if (si >= 0 && sizeMax > sizeMin) {
        const v = Number(r[si]);
        if (!isNaN(v)) rDot = 2 + ((v - sizeMin) / (sizeMax - sizeMin)) * (mini ? 5 : 9);
      }
      let color = palette[bi % palette.length]!;
      if (ci >= 0) {
        const ck = String(r[ci]);
        if (!colorMap.has(ck)) colorMap.set(ck, nextC++);
        color = palette[(colorMap.get(ck) ?? 0) % palette.length]!;
      } else if (yi >= 0) {
        // subtle: tint by y rank within bucket
        color = palette[bi % palette.length]!;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, rDot, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.globalAlpha = 1;
}

function drawBeeswarm(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const palette = opts.colors;
  const alpha = opts.opacity ?? 0.8;
  const cats = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 10);
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const r of rows) {
    const v = Number(r[yi]);
    if (!isNaN(v)) {
      ymin = Math.min(ymin, v);
      ymax = Math.max(ymax, v);
    }
  }
  if (!isFinite(ymin)) return;
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const bandW = (w - 2 * pad) / cats.length;
  const rDot = mini ? 2 : 3.2;
  const colorMap = new Map<string, number>();
  let nextC = 0;

  cats.forEach((cat, ci0) => {
    const cx = pad + (ci0 + 0.5) * bandW;
    const pts = rows
      .filter((r) => String(r[xi]) === cat)
      .map((r) => Number(r[yi]))
      .filter((v) => !isNaN(v))
      .sort((a, b) => a - b)
      .slice(0, mini ? 60 : 250);
    // greedy beeswarm: place without overlap in x
    const placed: { x: number; y: number }[] = [];
    for (const v of pts) {
      const py = pad + (1 - (v - ymin) / (ymax - ymin)) * (h - 2 * pad);
      let px = cx;
      let tries = 0;
      while (tries < 40) {
        const hit = placed.some((p) => (p.x - px) ** 2 + (p.y - py) ** 2 < (rDot * 2.1) ** 2);
        if (!hit) break;
        const side = tries % 2 === 0 ? 1 : -1;
        px = cx + side * Math.ceil(tries / 2) * rDot * 2.05;
        tries++;
      }
      if (Math.abs(px - cx) > bandW * 0.45) px = cx + (jitter(cat, placed.length) - 0.5) * bandW * 0.6;
      placed.push({ x: px, y: py });
      let color = palette[ci0 % palette.length]!;
      if (ci >= 0) {
        // re-find a row — approximate by index
        const row = rows.find((r) => String(r[xi]) === cat && Number(r[yi]) === v);
        if (row) {
          const ck = String(row[ci]);
          if (!colorMap.has(ck)) colorMap.set(ck, nextC++);
          color = palette[(colorMap.get(ck) ?? 0) % palette.length]!;
        }
      }
      let rr = rDot;
      if (si >= 0) {
        const row = rows.find((r) => String(r[xi]) === cat && Number(r[yi]) === v);
        if (row) {
          const sv = Number(row[si]);
          if (!isNaN(sv)) rr = rDot * (0.7 + Math.min(1.5, Math.abs(sv) / (Math.abs(ymax) + 1)));
        }
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.globalAlpha = 1;
      ctx.fillText(cat.length > 10 ? cat.slice(0, 9) + "…" : cat, cx, h - pad + 12);
    }
  });
  ctx.globalAlpha = 1;
}

function faceFeatures(vals: number[]): number[] {
  const n = Math.max(vals.length, 1);
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const v = vals[i % n] ?? 0;
    out.push(isNaN(v) ? 0.5 : Math.max(0, Math.min(1, (v + 1e-9) / (Math.abs(v) + 1))));
  }
  // better normalize across provided vals
  const finite = vals.filter((v) => !isNaN(v));
  const lo = Math.min(...finite, 0);
  const hi = Math.max(...finite, 1);
  const span = hi - lo || 1;
  return vals.slice(0, 6).map((v) => (isNaN(v) ? 0.5 : (v - lo) / span));
}

function drawChernoff(
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
  mini: boolean,
) {
  if (xi < 0) return;
  const palette = opts.colors;
  const numIdx = columns
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i === yi || i === ci || i === si || /./.test(columns[i]!))
    .map(({ i }) => i);
  // Prefer y, color-as-numeric if numeric, size, then other numeric-looking
  const featureIdx = [yi, si, ci].filter((i) => i >= 0);
  for (let i = 0; i < columns.length && featureIdx.length < 6; i++) {
    if (!featureIdx.includes(i) && i !== xi) {
      const sample = Number(rows[0]?.[i]);
      if (!isNaN(sample)) featureIdx.push(i);
    }
  }
  void numIdx;
  const groups = new Map<string, number[][]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r as number[]);
  }
  const entries = [...groups.entries()].slice(0, mini ? 6 : 12);
  const colsN = Math.ceil(Math.sqrt(entries.length));
  const rowsN = Math.ceil(entries.length / colsN);
  const cw = (w - 2 * pad) / colsN;
  const ch = (h - 2 * pad) / rowsN;

  entries.forEach(([label, rs], bi) => {
    const means = featureIdx.map((fi) => {
      const vs = rs.map((r) => Number(r[fi])).filter((v) => !isNaN(v));
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0.5;
    });
    const f = faceFeatures(means.length ? means : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const cx = pad + (bi % colsN) * cw + cw / 2;
    const cy = pad + Math.floor(bi / colsN) * ch + ch / 2;
    const R = Math.min(cw, ch) * 0.32;
    ctx.fillStyle = palette[bi % palette.length]!;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * (0.85 + f[0]! * 0.3), R * (0.9 + f[1]! * 0.25), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = opts.themeText ?? "#e8e8ec";
    ctx.lineWidth = mini ? 1 : 1.5;
    ctx.stroke();
    // eyes
    const eyeY = cy - R * 0.2;
    const eyeSep = R * (0.25 + f[2]! * 0.2);
    const eyeR = R * (0.08 + f[3]! * 0.08);
    ctx.fillStyle = opts.themeText ?? "#e8e8ec";
    ctx.beginPath();
    ctx.arc(cx - eyeSep, eyeY, eyeR, 0, Math.PI * 2);
    ctx.arc(cx + eyeSep, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // mouth
    ctx.beginPath();
    const mouthW = R * (0.35 + f[4]! * 0.25);
    const smile = (f[5]! - 0.5) * R * 0.5;
    ctx.moveTo(cx - mouthW, cy + R * 0.35);
    ctx.quadraticCurveTo(cx, cy + R * 0.35 + smile, cx + mouthW, cy + R * 0.35);
    ctx.stroke();
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label.length > 12 ? label.slice(0, 11) + "…" : label, cx, cy + R + 14);
    }
  });
}

function drawGlyphStar(
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
  mini: boolean,
) {
  if (xi < 0) return;
  const palette = opts.colors;
  const featureIdx = [yi, si, ci].filter((i) => i >= 0);
  for (let i = 0; i < columns.length && featureIdx.length < 6; i++) {
    if (!featureIdx.includes(i) && i !== xi && !isNaN(Number(rows[0]?.[i]))) featureIdx.push(i);
  }
  const axes = Math.max(3, featureIdx.length);
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (groups.has(k)) continue;
    groups.set(
      k,
      featureIdx.map((fi) => {
        const vs = rows.filter((rr) => String(rr[xi]) === k).map((rr) => Number(rr[fi])).filter((v) => !isNaN(v));
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
      }),
    );
  }
  const entries = [...groups.entries()].slice(0, mini ? 6 : 12);
  const colsN = Math.ceil(Math.sqrt(entries.length));
  const cw = (w - 2 * pad) / colsN;
  const ch = (h - 2 * pad) / Math.ceil(entries.length / colsN);
  const allVals = entries.flatMap(([, v]) => v);
  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const span = hi - lo || 1;

  entries.forEach(([label, vals], bi) => {
    const cx = pad + (bi % colsN) * cw + cw / 2;
    const cy = pad + Math.floor(bi / colsN) * ch + ch / 2;
    const R = Math.min(cw, ch) * 0.35;
    ctx.strokeStyle = opts.themeBorder ?? "#3a3a44";
    ctx.globalAlpha = 0.5;
    for (let a = 0; a < axes; a++) {
      const ang = -Math.PI / 2 + (a / axes) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let a = 0; a < axes; a++) {
      const t = (vals[a % vals.length]! - lo) / span;
      const ang = -Math.PI / 2 + (a / axes) * Math.PI * 2;
      const rr = R * (0.15 + t * 0.85);
      const px = cx + Math.cos(ang) * rr;
      const py = cy + Math.sin(ang) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = palette[bi % palette.length]!;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette[bi % palette.length]!;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label.length > 10 ? label.slice(0, 9) + "…" : label, cx, cy + R + 12);
    }
  });
}

function drawWaffle(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).filter(([, v]) => v > 0).slice(0, 12);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const cells = 100;
  const grid = 10;
  const size = Math.min(w - 2 * pad, h - 2 * pad);
  const cell = size / grid;
  const x0 = pad + (w - 2 * pad - size) / 2;
  const y0 = pad + (h - 2 * pad - size) / 2;
  let filled = 0;
  entries.forEach(([label, v], ei) => {
    const n = Math.max(1, Math.round((v / total) * cells));
    for (let k = 0; k < n && filled < cells; k++, filled++) {
      const gx = filled % grid;
      const gy = Math.floor(filled / grid);
      ctx.fillStyle = opts.colors[ei % opts.colors.length]!;
      ctx.globalAlpha = opts.opacity ?? 0.9;
      ctx.fillRect(x0 + gx * cell + 1, y0 + gy * cell + 1, cell - 2, cell - 2);
    }
    void label;
  });
  ctx.globalAlpha = 1;
  if (!mini) {
    let legendY = y0 + size + 14;
    ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
    entries.slice(0, 6).forEach(([label], ei) => {
      ctx.fillStyle = opts.colors[ei % opts.colors.length]!;
      ctx.fillRect(x0, legendY - 7, 8, 8);
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.textAlign = "left";
      ctx.fillText(label.length > 16 ? label.slice(0, 15) + "…" : label, x0 + 12, legendY);
      legendY += 12;
    });
  }
}

function drawIsotype(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).slice(0, mini ? 5 : 8);
  const maxV = Math.max(...entries.map(([, v]) => v), 1);
  const unit = maxV / (mini ? 8 : 12);
  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach(([label, v], ei) => {
    const n = Math.max(1, Math.round(v / unit));
    const cy = pad + (ei + 0.5) * bandH;
    ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
    ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
    ctx.textAlign = "right";
    if (!mini) ctx.fillText(label.length > 10 ? label.slice(0, 9) + "…" : label, pad - 4, cy + 3);
    for (let i = 0; i < n; i++) {
      const px = pad + 8 + i * (mini ? 8 : 14);
      ctx.fillStyle = opts.colors[ei % opts.colors.length]!;
      ctx.globalAlpha = opts.opacity ?? 0.85;
      ctx.beginPath();
      ctx.moveTo(px, cy - 5);
      ctx.lineTo(px + 4, cy + 5);
      ctx.lineTo(px - 4, cy + 5);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
}

function drawPyramid(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0 || si < 0) return;
  // Aggregate per category, then keep the strongest pairs so tiny rows don't crush the chart.
  const byCat = new Map<string, { left: number; right: number }>();
  for (const r of rows) {
    const c = String(r[xi] ?? "");
    if (!c) continue;
    const cur = byCat.get(c) ?? { left: 0, right: 0 };
    const lv = Number(r[yi]);
    const rv = Number(r[si]);
    if (!isNaN(lv)) cur.left += lv;
    if (!isNaN(rv)) cur.right += rv;
    byCat.set(c, cur);
  }
  const ranked = [...byCat.entries()]
    .map(([c, v]) => ({ c, ...v, score: Math.max(v.left, v.right) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, mini ? 8 : 12);
  if (ranked.length === 0) return;

  // Independent scales: cases vs deaths (etc.) often differ by orders of magnitude.
  const maxL = Math.max(...ranked.map((p) => p.left), 1e-9);
  const maxR = Math.max(...ranked.map((p) => p.right), 1e-9);
  const mid = w / 2;
  const labelW = mini ? 0 : Math.min(72, w * 0.18);
  const arm = Math.max(8, mid - pad - labelW / 2 - 6);
  const bandH = (h - 2 * pad) / ranked.length;
  const barH = Math.max(4, bandH * 0.62);

  ranked.forEach((p, i) => {
    const cy = pad + (i + 0.5) * bandH;
    const lw = (p.left / maxL) * arm;
    const rw = (p.right / maxR) * arm;
    ctx.globalAlpha = opts.opacity ?? 0.88;
    ctx.fillStyle = opts.colors[0]!;
    ctx.fillRect(mid - labelW / 2 - lw, cy - barH / 2, lw, barH);
    ctx.fillStyle = opts.colors[1 % opts.colors.length]!;
    ctx.fillRect(mid + labelW / 2, cy - barH / 2, rw, barH);
    if (!mini) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = p.c.length > 10 ? `${p.c.slice(0, 9)}…` : p.c;
      ctx.fillText(label, mid, cy);
    }
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
}

function drawSlope(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0 || si < 0) return;
  const cats = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 14);
  const pairs = cats.map((c) => {
    const rs = rows.filter((r) => String(r[xi]) === c);
    return {
      c,
      a: agg(rs.map((r) => Number(r[yi])).filter((v) => !isNaN(v)), "mean"),
      b: agg(rs.map((r) => Number(r[si])).filter((v) => !isNaN(v)), "mean"),
    };
  });
  const vals = pairs.flatMap((p) => [p.a, p.b]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const x0 = pad + 40;
  const x1 = w - pad - 40;
  pairs.forEach((p, i) => {
    const yA = pad + (1 - (p.a - lo) / (hi - lo)) * (h - 2 * pad);
    const yB = pad + (1 - (p.b - lo) / (hi - lo)) * (h - 2 * pad);
    const color = opts.colors[i % opts.colors.length]!;
    ctx.strokeStyle = color;
    ctx.globalAlpha = opts.opacity ?? 0.75;
    ctx.lineWidth = mini ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(x0, yA);
    ctx.lineTo(x1, yB);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x0, yA, mini ? 2.5 : 4, 0, Math.PI * 2);
    ctx.arc(x1, yB, mini ? 2.5 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `8px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
      ctx.fillText(p.c.length > 10 ? p.c.slice(0, 9) + "…" : p.c, x1 + 6, yB + 3);
    }
  });
  ctx.globalAlpha = 1;
}

function drawBump(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const seriesKey = ci >= 0 ? ci : -1;
  const xs = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 20);
  const series = seriesKey >= 0
    ? [...new Set(rows.map((r) => String(r[seriesKey])))].slice(0, 8)
    : ["_"];
  // rank per x: higher y = better rank (1)
  const ranks = new Map<string, Map<string, number>>();
  xs.forEach((x) => {
    const scored = series.map((s) => {
      const vs = rows
        .filter((r) => String(r[xi]) === x && (seriesKey < 0 || String(r[seriesKey]) === s))
        .map((r) => Number(r[yi]))
        .filter((v) => !isNaN(v));
      return { s, v: vs.length ? agg(vs, "mean") : -Infinity };
    }).sort((a, b) => b.v - a.v);
    const m = new Map<string, number>();
    scored.forEach((sc, i) => m.set(sc.s, i + 1));
    ranks.set(x, m);
  });
  const maxRank = series.length;
  series.forEach((s, si0) => {
    ctx.beginPath();
    xs.forEach((x, i) => {
      const rank = ranks.get(x)?.get(s) ?? maxRank;
      const px = pad + (i / Math.max(1, xs.length - 1)) * (w - 2 * pad);
      const py = pad + ((rank - 1) / Math.max(1, maxRank - 1)) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = opts.colors[si0 % opts.colors.length]!;
    ctx.globalAlpha = opts.opacity ?? 0.85;
    ctx.lineWidth = mini ? 1.5 : 2.5;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawStream(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0 || ci < 0) return;
  const xs = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 30);
  const series = [...new Set(rows.map((r) => String(r[ci])))].slice(0, 8);
  const grid: number[][] = series.map((s) =>
    xs.map((x) => {
      const vs = rows
        .filter((r) => String(r[xi]) === x && String(r[ci]) === s)
        .map((r) => Number(r[yi]))
        .filter((v) => !isNaN(v));
      return vs.length ? agg(vs, "sum") : 0;
    }),
  );
  const totals = xs.map((_, i) => grid.reduce((s, row) => s + row[i]!, 0));
  const maxT = Math.max(...totals, 1);
  // baseline centered stream
  const baseline = xs.map((_, i) => (h / 2) - (totals[i]! / maxT) * (h - 2 * pad) * 0.45);
  series.forEach((_, si0) => {
    const top: { x: number; y: number }[] = [];
    const bot: { x: number; y: number }[] = [];
    xs.forEach((_, i) => {
      const px = pad + (i / Math.max(1, xs.length - 1)) * (w - 2 * pad);
      let y0 = baseline[i]!;
      for (let s = 0; s < si0; s++) {
        y0 += (grid[s]![i]! / maxT) * (h - 2 * pad) * 0.9;
      }
      const y1 = y0 + (grid[si0]![i]! / maxT) * (h - 2 * pad) * 0.9;
      top.push({ x: px, y: y0 });
      bot.push({ x: px, y: y1 });
    });
    ctx.beginPath();
    top.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i]!.x, bot[i]!.y);
    ctx.closePath();
    ctx.fillStyle = opts.colors[si0 % opts.colors.length]!;
    ctx.globalAlpha = (opts.opacity ?? 0.7) * (mini ? 0.9 : 1);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawHorizon(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  _mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const pts = rows
    .map((r, i) => ({ i, x: String(r[xi]), y: Number(r[yi]) }))
    .filter((p) => !isNaN(p.y))
    .slice(0, 200);
  if (pts.length < 2) return;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const mid = (lo + hi) / 2;
  const amp = (hi - lo) / 2 || 1;
  const bands = 3;
  const bandH = (h - 2 * pad) / bands;
  for (let b = 0; b < bands; b++) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const px = pad + (i / (pts.length - 1)) * (w - 2 * pad);
      const norm = (p.y - mid) / amp;
      const folded = Math.abs(norm);
      const inBand = Math.max(0, Math.min(1, folded * bands - b));
      const py = pad + (b + 1) * bandH - inBand * bandH;
      if (i === 0) ctx.moveTo(px, pad + (b + 1) * bandH);
      ctx.lineTo(px, py);
    });
    ctx.lineTo(pad + (w - 2 * pad), pad + (b + 1) * bandH);
    ctx.closePath();
    const stops = opts.continuousStops ?? opts.colors;
    ctx.fillStyle = colorAt(stops, (b + 1) / bands);
    ctx.globalAlpha = 0.55;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSpiral(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (yi < 0) return;
  const pts = rows
    .map((r, i) => ({ i, y: Number(r[yi]), c: ci >= 0 ? String(r[ci]) : "", x: xi >= 0 ? String(r[xi]) : String(i) }))
    .filter((p) => !isNaN(p.y))
    .slice(0, mini ? 80 : 240);
  if (pts.length < 3) return;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) / 2 - pad;
  const colorMap = new Map<string, number>();
  let nextC = 0;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const t = i / (pts.length - 1);
    const ang = t * Math.PI * 2 * 4;
    const rad = maxR * (0.08 + t * 0.92);
    const thick = ((p.y - lo) / span) * (mini ? 4 : 8);
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    let color = opts.colors[0]!;
    if (ci >= 0) {
      if (!colorMap.has(p.c)) colorMap.set(p.c, nextC++);
      color = opts.colors[(colorMap.get(p.c) ?? 0) % opts.colors.length]!;
    } else {
      color = colorAt(opts.continuousStops ?? opts.colors, (p.y - lo) / span);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 + thick;
    ctx.globalAlpha = opts.opacity ?? 0.8;
    if (i > 0) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py);
    }
  });
  ctx.globalAlpha = 1;
}

function drawRadialBar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).slice(0, 16);
  const maxV = Math.max(...entries.map(([, v]) => v), 1);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.min(w, h) / 2 - pad;
  const inner = maxR * 0.2;
  const slice = (Math.PI * 2) / entries.length;
  entries.forEach(([label, v], i) => {
    const r = inner + (v / maxV) * (maxR - inner);
    const a0 = -Math.PI / 2 + i * slice;
    const a1 = a0 + slice * 0.85;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.arc(cx, cy, inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = opts.colors[i % opts.colors.length]!;
    ctx.globalAlpha = opts.opacity ?? 0.85;
    ctx.fill();
    if (!mini && opts.showDataLabels) {
      const am = (a0 + a1) / 2;
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `8px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.globalAlpha = 1;
      ctx.fillText(label.slice(0, 6), cx + Math.cos(am) * (r + 10), cy + Math.sin(am) * (r + 10));
    }
  });
  ctx.globalAlpha = 1;
}

function drawChord(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  _mini: boolean,
) {
  if (xi < 0 || ci < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const nodes = [...new Set(rows.flatMap((r) => [String(r[xi]), String(r[ci])]))].slice(0, 14);
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const flows: { a: number; b: number; v: number }[] = [];
  const m = new Map<string, number>();
  for (const r of rows) {
    const a = String(r[xi]);
    const b = String(r[ci]);
    if (!idx.has(a) || !idx.has(b) || a === b) continue;
    const key = `${a}||${b}`;
    const add = yi >= 0 ? Number(r[yi]) : 1;
    if (yi >= 0 && isNaN(add)) continue;
    m.set(key, (m.get(key) ?? 0) + (how === "count" ? 1 : add));
  }
  for (const [key, v] of m) {
    const [a, b] = key.split("||");
    flows.push({ a: idx.get(a!)!, b: idx.get(b!)!, v });
  }
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - pad;
  const maxV = Math.max(...flows.map((f) => f.v), 1);
  nodes.forEach((n, i) => {
    const ang = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
    ctx.fillStyle = opts.colors[i % opts.colors.length]!;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 5, 0, Math.PI * 2);
    ctx.fill();
    void n;
  });
  flows.forEach((f, fi) => {
    const a0 = -Math.PI / 2 + (f.a / nodes.length) * Math.PI * 2;
    const a1 = -Math.PI / 2 + (f.b / nodes.length) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * R;
    const y0 = cy + Math.sin(a0) * R;
    const x1 = cx + Math.cos(a1) * R;
    const y1 = cy + Math.sin(a1) * R;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.strokeStyle = opts.colors[fi % opts.colors.length]!;
    ctx.globalAlpha = 0.25 + 0.55 * (f.v / maxV);
    ctx.lineWidth = 1 + 4 * (f.v / maxV);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawVoronoi(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const pts = rows
    .map((r) => ({
      x: Number(r[xi]),
      y: Number(r[yi]),
      c: ci >= 0 ? String(r[ci]) : "",
    }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y))
    .slice(0, mini ? 40 : 120);
  if (pts.length === 0) return;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of pts) {
    xmin = Math.min(xmin, p.x);
    xmax = Math.max(xmax, p.x);
    ymin = Math.min(ymin, p.y);
    ymax = Math.max(ymax, p.y);
  }
  if (xmin === xmax) {
    xmin -= 1;
    xmax += 1;
  }
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const toX = (v: number) => pad + ((v - xmin) / (xmax - xmin)) * (w - 2 * pad);
  const toY = (v: number) => pad + (1 - (v - ymin) / (ymax - ymin)) * (h - 2 * pad);
  const mapped = pts.map((p) => ({ px: toX(p.x), py: toY(p.y), c: p.c }));
  const colorMap = new Map<string, number>();
  let nextC = 0;
  // Approximate Voronoi via pixel sampling on a coarse grid
  const step = mini ? 8 : 5;
  for (let gy = pad; gy < h - pad; gy += step) {
    for (let gx = pad; gx < w - pad; gx += step) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < mapped.length; i++) {
        const d = (mapped[i]!.px - gx) ** 2 + (mapped[i]!.py - gy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const p = mapped[best]!;
      let color = opts.colors[best % opts.colors.length]!;
      if (ci >= 0) {
        if (!colorMap.has(p.c)) colorMap.set(p.c, nextC++);
        color = opts.colors[(colorMap.get(p.c) ?? 0) % opts.colors.length]!;
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(gx, gy, step, step);
    }
  }
  mapped.forEach((p, i) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.themeText ?? "#fff";
    ctx.beginPath();
    ctx.arc(p.px, p.py, mini ? 1.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    void i;
  });
  ctx.globalAlpha = 1;
}

function drawIsoBars(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const entries = groupSum(rows, xi, yi, how).slice(0, 12);
  const maxV = Math.max(...entries.map(([, v]) => v), 1);
  const originX = w * 0.2;
  const originY = h * 0.72;
  const dx = (w - 2 * pad) / Math.max(entries.length, 1) * 0.55;
  const dy = dx * 0.5;
  entries.forEach(([label, v], i) => {
    const bh = (v / maxV) * (h * 0.45);
    const x = originX + i * dx;
    const y = originY - i * dy * 0.15;
    const color = opts.colors[(ci >= 0 ? i : i) % opts.colors.length]!;
    // top diamond
    const top = y - bh;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + dx * 0.45, top + dy * 0.35);
    ctx.lineTo(x, top + dy * 0.7);
    ctx.lineTo(x - dx * 0.45, top + dy * 0.35);
    ctx.closePath();
    ctx.fill();
    // left face
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x - dx * 0.45, top + dy * 0.35);
    ctx.lineTo(x, top + dy * 0.7);
    ctx.lineTo(x, y + dy * 0.7);
    ctx.lineTo(x - dx * 0.45, y + dy * 0.35);
    ctx.closePath();
    ctx.fill();
    // right face
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x + dx * 0.45, top + dy * 0.35);
    ctx.lineTo(x, top + dy * 0.7);
    ctx.lineTo(x, y + dy * 0.7);
    ctx.lineTo(x + dx * 0.45, y + dy * 0.35);
    ctx.closePath();
    ctx.fill();
    if (!mini) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `8px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label.slice(0, 6), x, y + dy + 12);
    }
  });
  ctx.globalAlpha = 1;
}

function drawIsoScatter(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const pts = rows
    .map((r) => ({
      x: Number(r[xi]),
      y: Number(r[yi]),
      z: si >= 0 ? Number(r[si]) : 0,
      c: ci >= 0 ? String(r[ci]) : "",
    }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y))
    .slice(0, mini ? 80 : 300);
  if (!pts.length) return;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const zs = pts.map((p) => (isNaN(p.z) ? 0 : p.z));
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const xspan = xmax - xmin || 1;
  const yspan = ymax - ymin || 1;
  const zspan = zmax - zmin || 1;
  const colorMap = new Map<string, number>();
  let nextC = 0;
  // isometric project
  const project = (x: number, y: number, z: number) => {
    const nx = (x - xmin) / xspan;
    const ny = (y - ymin) / yspan;
    const nz = (z - zmin) / zspan;
    const isoX = (nx - ny) * Math.cos(Math.PI / 6);
    const isoY = (nx + ny) * Math.sin(Math.PI / 6) - nz * 0.55;
    return {
      px: w / 2 + isoX * (w - 2 * pad) * 0.45,
      py: h * 0.62 + isoY * (h - 2 * pad) * 0.55,
      nz,
    };
  };
  // floor diamond
  ctx.strokeStyle = opts.themeBorder ?? "#3a3a44";
  ctx.globalAlpha = 0.4;
  const corners = [
    project(xmin, ymin, zmin),
    project(xmax, ymin, zmin),
    project(xmax, ymax, zmin),
    project(xmin, ymax, zmin),
  ];
  ctx.beginPath();
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.px, c.py) : ctx.lineTo(c.px, c.py)));
  ctx.closePath();
  ctx.stroke();

  const drawn = pts.map((p) => ({ ...project(p.x, p.y, isNaN(p.z) ? zmin : p.z), c: p.c })).sort((a, b) => a.py - b.py);
  drawn.forEach((p) => {
    let color = opts.colors[0]!;
    if (ci >= 0) {
      if (!colorMap.has(p.c)) colorMap.set(p.c, nextC++);
      color = opts.colors[(colorMap.get(p.c) ?? 0) % opts.colors.length]!;
    }
    const r = (mini ? 2 : 3.5) * (0.7 + p.nz);
    ctx.fillStyle = color;
    ctx.globalAlpha = opts.opacity ?? 0.85;
    ctx.beginPath();
    ctx.ellipse(p.px, p.py, r * 1.1, r * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawFlower(
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
  mini: boolean,
) {
  if (xi < 0) return;
  const featureIdx = [yi, si, ci].filter((i) => i >= 0);
  for (let i = 0; i < columns.length && featureIdx.length < 6; i++) {
    if (!featureIdx.includes(i) && i !== xi && !isNaN(Number(rows[0]?.[i]))) featureIdx.push(i);
  }
  const groups = [...new Set(rows.map((r) => String(r[xi])))].slice(0, mini ? 4 : 9);
  const colsN = Math.ceil(Math.sqrt(groups.length));
  const cw = (w - 2 * pad) / colsN;
  const ch = (h - 2 * pad) / Math.ceil(groups.length / colsN);
  const allMeans: number[][] = [];
  groups.forEach((g) => {
    const rs = rows.filter((r) => String(r[xi]) === g);
    allMeans.push(
      featureIdx.map((fi) => {
        const vs = rs.map((r) => Number(r[fi])).filter((v) => !isNaN(v));
        return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0;
      }),
    );
  });
  const flat = allMeans.flat();
  const lo = Math.min(...flat, 0);
  const hi = Math.max(...flat, 1);
  const span = hi - lo || 1;

  groups.forEach((g, gi) => {
    const cx = pad + (gi % colsN) * cw + cw / 2;
    const cy = pad + Math.floor(gi / colsN) * ch + ch / 2;
    const means = allMeans[gi]!;
    const petals = Math.max(3, means.length);
    const R = Math.min(cw, ch) * 0.28;
    for (let p = 0; p < petals; p++) {
      const t = (means[p % means.length]! - lo) / span;
      const ang = -Math.PI / 2 + (p / petals) * Math.PI * 2;
      const len = R * (0.4 + t * 0.9);
      const px = cx + Math.cos(ang) * len;
      const py = cy + Math.sin(ang) * len;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const ortho = ang + Math.PI / 2;
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * len * 0.5 + Math.cos(ortho) * len * 0.25,
        cy + Math.sin(ang) * len * 0.5 + Math.sin(ortho) * len * 0.25,
        px,
        py,
      );
      ctx.quadraticCurveTo(
        cx + Math.cos(ang) * len * 0.5 - Math.cos(ortho) * len * 0.25,
        cy + Math.sin(ang) * len * 0.5 - Math.sin(ortho) * len * 0.25,
        cx,
        cy,
      );
      ctx.fillStyle = opts.colors[p % opts.colors.length]!;
      ctx.globalAlpha = 0.55;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts.themeText ?? "#e8e8ec";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.18, 0, Math.PI * 2);
    ctx.fill();
    if (!mini) {
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(g.length > 10 ? g.slice(0, 9) + "…" : g, cx, cy + R + 14);
    }
  });
}

function drawMosaic(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || ci < 0) return;
  const how = opts.yAggregate ?? (yi >= 0 ? "sum" : "count");
  const xs = [...new Set(rows.map((r) => String(r[xi])))].slice(0, 8);
  const ys = [...new Set(rows.map((r) => String(r[ci])))].slice(0, 8);
  const cell = new Map<string, number>();
  for (const r of rows) {
    const a = String(r[xi]);
    const b = String(r[ci]);
    if (!xs.includes(a) || !ys.includes(b)) continue;
    const add = yi >= 0 ? Number(r[yi]) : 1;
    if (yi >= 0 && isNaN(add)) continue;
    const key = `${a}||${b}`;
    cell.set(key, (cell.get(key) ?? 0) + (how === "count" ? 1 : add));
  }
  const colTotals = xs.map((a) => ys.reduce((s, b) => s + (cell.get(`${a}||${b}`) ?? 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0) || 1;
  let xCursor = pad;
  xs.forEach((a, ai) => {
    const colW = ((colTotals[ai] || 0) / grand) * (w - 2 * pad);
    let yCursor = pad;
    const colTotal = colTotals[ai] || 1;
    ys.forEach((b, bi) => {
      const v = cell.get(`${a}||${b}`) ?? 0;
      const ch = (v / colTotal) * (h - 2 * pad);
      ctx.fillStyle = opts.colors[bi % opts.colors.length]!;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(xCursor, yCursor, Math.max(0, colW - 1), Math.max(0, ch - 1));
      yCursor += ch;
    });
    if (!mini && colW > 20) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
      ctx.font = `8px '${opts.fontFamily ?? "Inter"}', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(a.slice(0, 8), xCursor + colW / 2, h - pad + 10);
    }
    xCursor += colW;
    void ai;
  });
  ctx.globalAlpha = 1;
}

function drawContour(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  _cols: string[],
  xi: number,
  yi: number,
  _ci: number,
  _si: number,
  w: number,
  h: number,
  pad: number,
  opts: OddRenderOpts,
  mini: boolean,
) {
  if (xi < 0 || yi < 0) return;
  const pts = rows
    .map((r) => ({ x: Number(r[xi]), y: Number(r[yi]) }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y))
    .slice(0, mini ? 100 : 400);
  if (pts.length < 4) return;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const xspan = xmax - xmin || 1;
  const yspan = ymax - ymin || 1;
  const gw = mini ? 24 : 40;
  const gh = mini ? 18 : 28;
  const grid = Array.from({ length: gh }, () => new Array(gw).fill(0));
  const sigma = 1.6;
  for (const p of pts) {
    const gx = ((p.x - xmin) / xspan) * (gw - 1);
    const gy = (1 - (p.y - ymin) / yspan) * (gh - 1);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    for (let jj = j0 - 2; jj <= j0 + 2; jj++) {
      for (let ii = i0 - 2; ii <= i0 + 2; ii++) {
        if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        const d2 = (ii - gx) ** 2 + (jj - gy) ** 2;
        grid[jj]![ii]! += Math.exp(-d2 / (2 * sigma * sigma));
      }
    }
  }
  let gmax = 0;
  for (const row of grid) for (const v of row) gmax = Math.max(gmax, v);
  const stops = opts.continuousStops ?? opts.colors;
  const cellW = (w - 2 * pad) / gw;
  const cellH = (h - 2 * pad) / gh;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const t = gmax ? grid[j]![i]! / gmax : 0;
      if (t < 0.05) continue;
      ctx.fillStyle = colorAt(stops, t);
      ctx.globalAlpha = 0.15 + t * 0.7;
      ctx.fillRect(pad + i * cellW, pad + j * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
  // contour rings via threshold outlines
  const thresholds = [0.25, 0.5, 0.75];
  thresholds.forEach((th, ti) => {
    ctx.strokeStyle = colorAt(stops, th);
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1 + ti * 0.4;
    ctx.beginPath();
    for (let j = 1; j < gh - 1; j++) {
      for (let i = 1; i < gw - 1; i++) {
        const v = grid[j]![i]! / (gmax || 1);
        const crossing =
          (v - th) * (grid[j]![i + 1]! / (gmax || 1) - th) <= 0 ||
          (v - th) * (grid[j + 1]![i]! / (gmax || 1) - th) <= 0;
        if (crossing) {
          ctx.rect(pad + i * cellW, pad + j * cellH, cellW, cellH);
        }
      }
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
