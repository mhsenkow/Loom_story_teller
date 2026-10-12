// =================================================================
// Loom — Odd chart recommendations (no Canvas render)
// =================================================================

import type { ColumnInfo } from "./queryTypes";
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
  /** Theme background (for halos / contrast); falls back to the document theme. */
  themeBg?: string;
  /** "none" suppresses the renderer's own color legend; otherwise it draws one when a color field is encoded. */
  legendPosition?: string | null;
  /** Cap categories (waffle / radial / iso bars) when Encoding Top N is set. */
  topN?: number | null;
  /** Bump: absolute rank or Δrank over time. */
  bumpMode?: "rank" | "delta" | null;
  /** Registered hover targets (LOOM-020). */
  hits?: import("./chartTooltip").HitTarget[];
}

type ColType = "quantitative" | "nominal" | "temporal";

export function inferType(dt: string, colName?: string): ColType {
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

export function jitter(seed: string, i: number): number {
  const h = hash(`${seed}:${i}`);
  return (h % 10000) / 10000;
}

export function agg(vals: number[], how: YAggregateOption = "sum"): number {
  if (vals.length === 0) return 0;
  if (how === "count") return vals.length;
  if (how === "mean") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (how === "min") return Math.min(...vals);
  if (how === "max") return Math.max(...vals);
  return vals.reduce((a, b) => a + b, 0);
}

export function numColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "quantitative");
}
export function nomColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "nominal");
}
export function timeColsOf(columns: ColumnInfo[]) {
  return columns.filter((c) => inferType(c.data_type, c.name) === "temporal");
}

function pick<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function groupSum(
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
export function toNum(v: unknown): number {
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
        ? // Compare like with like: a time-ish number (year) makes a meaningless second side
          (num.find((c) => c.name !== yField && !/^(year|yr|month|day|week|hour)$/i.test(c.name)) ??
            num.find((c) => c.name !== yField))?.name ?? null
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
