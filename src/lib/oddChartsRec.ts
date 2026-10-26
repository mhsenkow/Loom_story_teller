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
  "calendar",
  "rose",
  "ecdf",
  "sparkGrid",
  "density",
  "qq",
  "connectedScatter",
  "stripes",
  "wordCloud",
  "errorBars",
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
  { value: "calendar", label: "Calendar heatmap" },
  { value: "rose", label: "Nightingale rose" },
  { value: "ecdf", label: "ECDF (cumulative)" },
  { value: "sparkGrid", label: "Sparkline grid" },
  { value: "density", label: "Density curve" },
  { value: "qq", label: "Q–Q plot" },
  { value: "connectedScatter", label: "Connected scatter" },
  { value: "stripes", label: "Warming stripes" },
  { value: "wordCloud", label: "Word cloud" },
  { value: "errorBars", label: "Mean ± CI dots" },
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
  "isoScatter",
  "mosaic",
  "calendar",
  "rose",
  "sparkGrid",
  "stripes",
  "wordCloud",
]);

export interface OddRenderOpts {
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  colors: string[];
  opacity?: number;
  fontFamily?: string;
  axisLabelColor?: string;
  axisFontSize?: number;
  /** Visual → tick label rotation (degrees) for continuous X ticks. */
  tickRotation?: number;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  showDataLabels?: boolean;
  pointSize?: number;
  /** Point marks: one shape / emoji for all, or per category (see markSymbols). */
  markShape?: string;
  markerMode?: "shape" | "emoji";
  markEmoji?: string;
  shapeField?: string | null;
  emojiField?: string | null;
  emojiMap?: import("./chartEmoji").ChartEmojiMap | null;
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
  /** Word cloud layout. Null and "cloud" are the single spiral. */
  wordCloudMode?: "cloud" | "compare" | "grid" | null;
  /** Face for the words themselves. Empty uses the chart font. */
  wordCloudFont?: string | null;
  /** Spiral from the center, horizontal rows, or vertical columns. */
  wordCloudArrange?: "spiral" | "rows" | "columns" | null;
  /** Largest-word size, 0.6–1.6. */
  wordCloudScale?: number | null;
  wordCloudWeight?: "ranked" | "even" | "heavy" | null;
  /** Pyramid: shared vs independent arm domains (auto picks by magnitude ratio). */
  pyramidScaleMode?: "auto" | "shared" | "independent" | null;
  /** Show signed Δ or % between Left/Right or Start/End. */
  deltaDisplay?: "off" | "diff" | "pct" | null;
  /** Bar grow / iso floor orientation (Encoding → Direction). */
  layoutDirection?: "auto" | "up" | "down" | "right" | "left" | null;
  channelInvert?: import("./channelInvert").ChannelInvert;
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

/** Per-word totals for each Compare-by group, plus each group's overall weight. */
export function wordTotalsByGroup(
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  how: YAggregateOption = "sum",
): { byWord: Map<string, Map<string, number>>; groupWeight: Map<string, number> } {
  const raw = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    const word = String(r[xi] ?? "");
    const group = String(r[ci] ?? "");
    if (!word.trim() || word === "null" || !group.trim() || group === "null") continue;
    const v = yi >= 0 ? toNum(r[yi]) : 1;
    if (!Number.isFinite(v)) continue;
    let groups = raw.get(word);
    if (!groups) raw.set(word, (groups = new Map()));
    const bucket = groups.get(group);
    if (bucket) bucket.push(v);
    else groups.set(group, [v]);
  }
  const byWord = new Map<string, Map<string, number>>();
  const groupWeight = new Map<string, number>();
  for (const [word, groups] of raw) {
    const summed = new Map<string, number>();
    for (const [group, vs] of groups) {
      const n = agg(vs, how);
      if (!(n > 0)) continue;
      summed.set(group, n);
      groupWeight.set(group, (groupWeight.get(group) ?? 0) + n);
    }
    if (summed.size) byWord.set(word, summed);
  }
  return { byWord, groupWeight };
}

/** Groups with the largest totals, heaviest first. */
export function topGroupsByWeight(weight: Map<string, number>, cap: number): string[] {
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, cap))
    .map(([name]) => name);
}

/** One group's words, heaviest first. A word can belong to more than one group. */
export function wordsForCloudGroup(
  byWord: Map<string, Map<string, number>>,
  group: string,
): [string, number][] {
  return [...byWord.entries()]
    .map(([word, totals]) => [word, totals.get(group) ?? 0] as [string, number])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Two clouds when Compare by is not a small set of groups (a market-cap
 * column has one value per name). Higher half on the left, lower on the right.
 * Size stays the group's total; the split uses that total, or the numeric
 * group label when every label is a number.
 */
export function splitWordCloudHalves(
  byWord: Map<string, Map<string, number>>,
): { higher: [string, number][]; lower: [string, number][] } {
  const ranked: { word: string; size: number; stat: number }[] = [];
  for (const [word, groups] of byWord) {
    let size = 0;
    const keyNums: number[] = [];
    for (const [group, v] of groups) {
      size += v;
      const n = Number(String(group).replace(/,/g, ""));
      if (Number.isFinite(n)) keyNums.push(n);
    }
    if (!(size > 0)) continue;
    const stat = keyNums.length === groups.size && keyNums.length > 0 ? Math.max(...keyNums) : size;
    ranked.push({ word, size, stat });
  }
  ranked.sort((a, b) => b.stat - a.stat || b.size - a.size || a.word.localeCompare(b.word));
  const mid = Math.ceil(ranked.length / 2);
  const toPairs = (list: typeof ranked): [string, number][] =>
    list
      .map((w) => [w.word, w.size] as [string, number])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { higher: toPairs(ranked.slice(0, mid)), lower: toPairs(ranked.slice(mid)) };
}

/** A low-cardinality column to compare a word cloud against. Two values → Compare; 3–8 → Grid. */
export function wordCloudCompareColumn(
  columns: ColumnInfo[],
  wordField: string,
): { name: string; mode: "compare" | "grid" } | null {
  const groups = nomColsOf(columns).filter(
    (c) => c.name !== wordField && c.distinct_count >= 2 && c.distinct_count <= 8,
  );
  const two = groups.find((c) => c.distinct_count === 2);
  if (two) return { name: two.name, mode: "compare" };
  const grid = [...groups].sort((a, b) => a.distinct_count - b.distinct_count || a.name.localeCompare(b.name))[0];
  return grid ? { name: grid.name, mode: "grid" } : null;
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
    case "calendar":
      return time.length > 0
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a date column" };
    case "rose":
      return nomN(2, 40).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–40)" };
    case "ecdf":
      return num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a numeric column" };
    case "sparkGrid":
    case "stripes":
      return (time.length > 0 || nom.length > 0) && num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a time/order column + numeric" };
    case "density":
    case "qq":
      return num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a numeric column" };
    case "connectedScatter":
      return num.length >= 2
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need ≥2 numeric columns" };
    case "wordCloud":
      return nom.filter((c) => c.distinct_count >= 5).length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a text column with at least five distinct values" };
    case "errorBars":
      return nomN(2, 40).length >= 1 && num.length >= 1
        ? { ok: true, reason: "" }
        : { ok: false, reason: "Need a category (2–40) + numeric" };
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
    case "calendar": {
      const x = pick(time);
      if (!x) return null;
      const y = num.length && Math.random() > 0.25 ? pick(num)! : null;
      return { xField: x.name, yField: y?.name ?? null, colorField: null };
    }
    case "rose": {
      const x = pick(nomN(2, 24)) ?? pick(nomN(2, 40));
      if (!x) return null;
      const y = num.length ? pick(num)! : null;
      const color = Math.random() > 0.5 ? pick(nomN(2, 6).filter((c) => c.name !== x.name)) ?? null : null;
      return { xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null };
    }
    case "ecdf": {
      const x = pick(num);
      if (!x) return null;
      const color = Math.random() > 0.35 ? pick(nomN(2, 6)) ?? null : null;
      return { xField: x.name, yField: null, colorField: color?.name ?? null };
    }
    case "sparkGrid": {
      const x = pick(time.length ? time : nom);
      const y = pick(num);
      if (!x || !y) return null;
      const color = pick(nomN(2, 24).filter((c) => c.name !== x.name)) ?? null;
      return { xField: x.name, yField: y.name, colorField: color?.name ?? null };
    }
    case "density": {
      const x = pick(num);
      if (!x) return null;
      const color = Math.random() > 0.4 ? pick(nomN(2, 5)) ?? null : null;
      return { xField: x.name, yField: null, colorField: color?.name ?? null };
    }
    case "qq": {
      const x = pick(num);
      return x ? { xField: x.name, yField: null, colorField: null } : null;
    }
    case "connectedScatter": {
      if (num.length < 2) return null;
      const a = pick(num)!;
      const b = pick(num.filter((c) => c.name !== a.name))!;
      const order = pick(time) ?? null;
      return { xField: a.name, yField: b.name, colorField: null, sizeField: order?.name ?? null };
    }
    case "stripes": {
      const x = pick(time.length ? time : nom);
      const y = pick(num);
      if (!x || !y) return null;
      return { xField: x.name, yField: y.name, colorField: null };
    }
    case "wordCloud": {
      const x = pick(nom.filter((c) => c.distinct_count >= 5));
      if (!x) return null;
      const y = num.length && Math.random() > 0.5 ? pick(num)! : null;
      const color = Math.random() > 0.45
        ? pick(nom.filter((c) => c.name !== x.name && c.distinct_count >= 2 && c.distinct_count <= 8)) ?? null
        : null;
      return { xField: x.name, yField: y?.name ?? null, colorField: color?.name ?? null };
    }
    case "errorBars": {
      const x = pick(nomN(2, 40));
      const y = pick(num);
      if (!x || !y) return null;
      return { xField: x.name, yField: y.name, colorField: null };
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
    calendar: {
      title: yField ? `${yField} by day` : `Activity by day`,
      subtitle: "a year of days — weekdays down, weeks across",
    },
    rose: {
      title: yField ? `${yField} rose by ${xField}` : `Rose of ${xField}`,
      subtitle: "Nightingale petals — wedge area is the value",
    },
    ecdf: {
      title: colorField ? `How ${xField} accumulates by ${colorField}` : `How ${xField} accumulates`,
      subtitle: "cumulative share of rows at or below each value",
    },
    sparkGrid: {
      title: colorField ? `${yField} over ${xField} for each ${colorField}` : `${yField} over ${xField}`,
      subtitle: "small-multiple sparklines — shape over scale",
    },
    density: {
      title: colorField ? `Distribution of ${xField} by ${colorField}` : `Distribution of ${xField}`,
      subtitle: "smoothed density — where values pile up",
    },
    qq: {
      title: `Is ${xField} normally distributed?`,
      subtitle: "Q–Q plot — points on the line mean a bell curve",
    },
    connectedScatter: {
      title: yField ? `${xField} and ${yField} over ${sizeField ?? "time"}` : `Connected scatter`,
      subtitle: "a path through two measures — where it went, step by step",
    },
    stripes: {
      title: yField ? `${yField} stripes over ${xField}` : `Stripes`,
      subtitle: "one band per period — warm above average, cool below",
    },
    wordCloud: {
      title: yField ? `${xField} sized by ${yField}` : `Most common ${xField}`,
      subtitle: "word cloud — bigger means more",
    },
    errorBars: {
      title: yField ? `Average ${yField} by ${xField}` : `Averages by ${xField}`,
      subtitle: "mean with 95% confidence interval — overlap means maybe no real difference",
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
  if ((kind === "voronoi" || kind === "isoScatter" || kind === "contour" || kind === "sparkGrid" || kind === "connectedScatter" || kind === "stripes" || kind === "errorBars") && !yField) return null;

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
    yAggregate: ["waffle", "isotype", "radialBar", "isoBars", "chord", "mosaic", "pyramid", "calendar", "rose", "wordCloud"].includes(kind)
      ? (!yField ? "count" : (yAggregate ?? "sum"))
      : kind === "sparkGrid" || kind === "stripes"
        ? (yAggregate ?? "mean")
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
    pyramid: "Two opposing bars — same or separate scales for A-vs-B mirrors",
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
    calendar: "Every day as a cell — weekly rhythms and busy stretches pop",
    rose: "Polar wedges whose area tracks value — stack a second category inside",
    ecdf: "Cumulative distribution — compare medians and tails across groups without binning",
    sparkGrid: "One tiny trend per group — compare shapes, not just totals",
    density: "A smooth curve of the distribution — no bin-size guessing, compare groups by overlap",
    qq: "Check normality: sample quantiles vs a bell curve; bends reveal skew and heavy tails",
    connectedScatter: "Two measures traced through time — loops, reversals and drift jump out",
    stripes: "Ed Hawkins-style stripes — a long series as one band of warm and cool",
    wordCloud: "Category labels sized by count or value — compare two groups or lay out one cloud per group",
    errorBars: "Group means with 95% intervals over the raw dots — honest comparisons",
  };
  return map[kind] ?? "An unconventional view that fits your columns";
}
