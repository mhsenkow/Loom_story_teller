// =================================================================
// Chart links — `#chart=` shareable setup (pure, no React)
// =================================================================
// Mirrors Dive's `#dive=` links for every chart: the dataset path, the
// chart kind + encodings, title/subtitle, headline override, visual
// overrides, bar stacking and stage framing ride in the URL hash as
// base64url JSON. No row data — the recipient reopens the dataset
// (stream / demo / catalog CSV) and the chart is rebuilt from columns.
// =================================================================

import { b64urlDecode, b64urlEncode } from "./dive";
import {
  CHART_KIND_OPTIONS,
  Y_AGGREGATE_OPTIONS,
  createChartRec,
  type ChartKind,
  type ChartRecommendation,
  type YAggregateOption,
} from "./recommendations";
import { CHART_ASPECTS, type ChartAspectId, type ChartDeviceId } from "./chartViewport";
import type { AppSettings, ChartVisualOverrides, ColumnInfo, FileEntry } from "./store";

export const CHART_LINK_VERSION = 1;

type BarStackMode = "grouped" | "stacked" | "percent";
type Primitive = string | number | boolean;

/** Chart kind + encodings, enough to rebuild the recommendation from columns. */
export interface ChartLinkChart {
  kind: ChartKind;
  xField: string;
  yField?: string;
  colorField?: string;
  sizeField?: string;
  zField?: string;
  timeField?: string;
  trailId?: string;
  rowField?: string;
  glowField?: string;
  outlineField?: string;
  opacityField?: string;
  yAggregate?: YAggregateOption;
  topN?: number;
  y2Field?: string;
  comparePrevious?: boolean;
  rollingWindow?: 7 | 30;
  yScale?: "linear" | "log" | "symlog";
  seriesNormalize?: "index100" | "zscore";
  residualOverlay?: boolean;
  anomalyHighlight?: boolean;
  bumpMode?: "rank" | "delta";
  timeWindowField?: string;
  timeWindow?: "all" | "1h" | "6h" | "24h" | "7d" | "30d" | "90d" | "1y";
  tooltipFields?: string[];
  tooltipKeyField?: string;
  /** The recommendation's own title / subtitle (story recs carry hand-written ones). */
  title?: string;
  subtitle?: string;
}

export interface ChartLink {
  /**
   * Dataset path: `stream://…`, `mock://…`, `web://…`, or `file:<name>` for a
   * local file (only the file name is shared, never the sender's folder).
   */
  src: string;
  /** Remote CSV URL for catalog datasets (`web://…`) so another device can refetch it. */
  url?: string;
  chart: ChartLinkChart;
  /** Headline edited in Chart view / Share sheet. */
  titleOverride?: string;
  /** `chartVisualOverrides` — primitive values only. */
  visual?: Record<string, Primitive>;
  barStackMode?: BarStackMode;
  connectScatterTrail?: boolean;
  showMarginals?: boolean;
  chartAspect?: ChartAspectId;
  chartDevice?: ChartDeviceId;
}

// ---------------------------------------------------------------------------
// Build from app state
// ---------------------------------------------------------------------------

export interface ChartLinkState {
  selectedFile: Pick<FileEntry, "path" | "name" | "sourceUrl"> | null;
  activeChart: ChartRecommendation | null;
  chartTitleOverrides?: Record<string, string>;
  chartVisualOverrides?: ChartVisualOverrides;
  barStackMode?: BarStackMode;
  connectScatterTrail?: boolean;
  showMarginals?: boolean;
  appSettings?: Pick<AppSettings, "chartAspect" | "chartDevice">;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Dataset path as shared: local files keep only their name. */
export function chartLinkSrc(file: Pick<FileEntry, "path" | "name">): string {
  const p = file.path;
  if (/^(stream|mock|web):\/\//.test(p)) return p;
  return `file:${file.name || p.split(/[\\/]/).pop() || p}`;
}

/** Can a recipient on another device reopen this dataset without the sender's files? */
export function isPortableChartLink(link: Pick<ChartLink, "src" | "url">): boolean {
  return link.src.startsWith("stream://") || link.src.startsWith("mock://") || (link.src.startsWith("web://") && !!link.url);
}

/** Does the open file satisfy this link's dataset? */
export function chartLinkMatchesFile(link: Pick<ChartLink, "src">, file: Pick<FileEntry, "path" | "name"> | null): boolean {
  if (!file) return false;
  if (link.src === file.path) return true;
  return link.src.startsWith("file:") && link.src.slice(5) === file.name;
}

/** Short label for the dataset a link needs ("USGS Quakes" style labels live in the UI). */
export function chartLinkDatasetLabel(link: Pick<ChartLink, "src">): string {
  return link.src.replace(/^(stream|mock|web):\/\//, "").replace(/^file:/, "");
}

function cleanVisual(v: ChartVisualOverrides | undefined): Record<string, Primitive> | undefined {
  if (!v) return undefined;
  const out: Record<string, Primitive> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
    if (typeof val === "string" || typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val))) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Snapshot the current chart setup as a link (null when there is no chart or dataset). */
export function chartLinkFromState(s: ChartLinkState): ChartLink | null {
  const rec = s.activeChart;
  const file = s.selectedFile;
  if (!rec || !file || !rec.xField) return null;
  const src = chartLinkSrc(file);
  const chart: ChartLinkChart = {
    kind: rec.kind,
    xField: rec.xField,
    yField: str(rec.yField),
    colorField: str(rec.colorField),
    sizeField: str(rec.sizeField),
    zField: str(rec.zField),
    timeField: str(rec.timeField),
    trailId: str(rec.trailId),
    rowField: str(rec.rowField),
    glowField: str(rec.glowField),
    outlineField: str(rec.outlineField),
    opacityField: str(rec.opacityField),
    yAggregate: rec.yAggregate ?? undefined,
    topN: typeof rec.topN === "number" && Number.isFinite(rec.topN) ? rec.topN : undefined,
    y2Field: str(rec.y2Field),
    comparePrevious: rec.comparePrevious || undefined,
    rollingWindow: rec.rollingWindow === 7 || rec.rollingWindow === 30 ? rec.rollingWindow : undefined,
    yScale: rec.yScale && rec.yScale !== "linear" ? rec.yScale : undefined,
    seriesNormalize: rec.seriesNormalize === "index100" || rec.seriesNormalize === "zscore" ? rec.seriesNormalize : undefined,
    residualOverlay: rec.residualOverlay || undefined,
    anomalyHighlight: rec.anomalyHighlight || undefined,
    bumpMode: rec.bumpMode === "delta" || rec.bumpMode === "rank" ? rec.bumpMode : undefined,
    timeWindowField: str(rec.timeWindowField),
    timeWindow: rec.timeWindow && rec.timeWindow !== "all" ? rec.timeWindow : undefined,
    tooltipFields: rec.tooltipFields?.length ? [...rec.tooltipFields] : undefined,
    tooltipKeyField: str(rec.tooltipKeyField),
    title: str(rec.title),
    subtitle: str(rec.subtitle),
  };
  const titleOverride = str(s.chartTitleOverrides?.[rec.id]);
  return {
    src,
    url: src.startsWith("web://") ? str(file.sourceUrl) : undefined,
    chart,
    titleOverride: titleOverride && titleOverride !== rec.title ? titleOverride : undefined,
    visual: cleanVisual(s.chartVisualOverrides),
    barStackMode: s.barStackMode && s.barStackMode !== "grouped" ? s.barStackMode : undefined,
    connectScatterTrail: s.connectScatterTrail || undefined,
    showMarginals: s.showMarginals || undefined,
    chartAspect: s.appSettings?.chartAspect && s.appSettings.chartAspect !== "free" ? s.appSettings.chartAspect : undefined,
    chartDevice: s.appSettings?.chartDevice && s.appSettings.chartDevice !== "auto" ? s.appSettings.chartDevice : undefined,
  };
}

// ---------------------------------------------------------------------------
// Wire format (short keys, defaults and undefined omitted)
// ---------------------------------------------------------------------------

/** Link field ↔ wire key. */
const CHART_KEYS: [keyof ChartLinkChart, string][] = [
  ["kind", "k"],
  ["xField", "x"],
  ["yField", "y"],
  ["colorField", "c"],
  ["sizeField", "s"],
  ["zField", "z"],
  ["timeField", "t"],
  ["trailId", "tr"],
  ["rowField", "r"],
  ["glowField", "g"],
  ["outlineField", "o"],
  ["opacityField", "op"],
  ["yAggregate", "a"],
  ["topN", "tn"],
  ["y2Field", "y2"],
  ["comparePrevious", "cp"],
  ["rollingWindow", "rw"],
  ["yScale", "ys"],
  ["seriesNormalize", "sn"],
  ["residualOverlay", "ro"],
  ["anomalyHighlight", "ah"],
  ["bumpMode", "bm"],
  ["timeWindowField", "twf"],
  ["timeWindow", "tw"],
  ["tooltipFields", "tf"],
  ["tooltipKeyField", "tk"],
  ["title", "ti"],
  ["subtitle", "st"],
];

const TOP_KEYS: [Exclude<keyof ChartLink, "chart">, string][] = [
  ["src", "src"],
  ["url", "u"],
  ["titleOverride", "h"],
  ["visual", "vo"],
  ["barStackMode", "bs"],
  ["connectScatterTrail", "ct"],
  ["showMarginals", "mg"],
  ["chartAspect", "ar"],
  ["chartDevice", "dv"],
];

function compact(entries: [string, unknown][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

/** `chart=…` (no leading #). */
export function encodeChartLink(link: ChartLink): string {
  const c = compact(CHART_KEYS.map(([f, k]) => [k, link.chart[f]]));
  const top = compact(TOP_KEYS.map(([f, k]) => [k, link[f]]));
  return `chart=${b64urlEncode(JSON.stringify({ v: CHART_LINK_VERSION, ...top, c }))}`;
}

const KINDS = new Set<string>(CHART_KIND_OPTIONS.map((o) => o.value));
const AGGS = new Set<string>(Y_AGGREGATE_OPTIONS.map((o) => o.value));
const ASPECTS = new Set<string>(CHART_ASPECTS.map((a) => a.id));
const DEVICES = new Set<string>(["auto", "mobile", "tablet", "desktop"]);
const STACKS = new Set<string>(["grouped", "stacked", "percent"]);
const TIME_WINDOWS = new Set<string>(["all", "1h", "6h", "24h", "7d", "30d", "90d", "1y"]);

const field = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/** Parse `#chart=…` (with or without the leading #). Returns null when absent, malformed, or unknown. */
export function decodeChartLink(hash: string): ChartLink | null {
  const m = hash.replace(/^#/, "").match(/(?:^|&)chart=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(b64urlDecode(m[1]!));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof obj.v !== "number" || obj.v > CHART_LINK_VERSION) return null;
  const c = obj.c;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const cr = c as Record<string, unknown>;
  const src = field(obj.src, 2048);
  const kind = field(cr.k, 40);
  const xField = field(cr.x);
  if (!src || !kind || !KINDS.has(kind) || !xField) return null;

  const chart: ChartLinkChart = { kind: kind as ChartKind, xField };
  for (const [f, k] of CHART_KEYS) {
    if (
      f === "kind" ||
      f === "xField" ||
      f === "yAggregate" ||
      f === "tooltipFields" ||
      f === "topN" ||
      f === "comparePrevious" ||
      f === "rollingWindow" ||
      f === "yScale" ||
      f === "seriesNormalize" ||
      f === "residualOverlay" ||
      f === "anomalyHighlight" ||
      f === "bumpMode" ||
      f === "timeWindow"
    ) {
      continue;
    }
    const v = field(cr[k], f === "title" || f === "subtitle" ? 300 : 200);
    if (v) chart[f] = v;
  }
  if (typeof cr.a === "string" && AGGS.has(cr.a)) chart.yAggregate = cr.a as YAggregateOption;
  if (typeof cr.tn === "number" && Number.isFinite(cr.tn)) chart.topN = Math.max(3, Math.min(50, Math.round(cr.tn)));
  if (cr.cp === true) chart.comparePrevious = true;
  if (cr.rw === 7 || cr.rw === 30) chart.rollingWindow = cr.rw;
  if (cr.ys === "log" || cr.ys === "symlog" || cr.ys === "linear") chart.yScale = cr.ys;
  if (cr.sn === "index100" || cr.sn === "zscore") chart.seriesNormalize = cr.sn;
  if (cr.ro === true) chart.residualOverlay = true;
  if (cr.ah === true) chart.anomalyHighlight = true;
  if (cr.bm === "delta" || cr.bm === "rank") chart.bumpMode = cr.bm;
  if (typeof cr.tw === "string" && TIME_WINDOWS.has(cr.tw) && cr.tw !== "all") {
    chart.timeWindow = cr.tw as ChartLinkChart["timeWindow"];
  }
  if (Array.isArray(cr.tf)) {
    const tf = cr.tf.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 200).slice(0, 40);
    if (tf.length) chart.tooltipFields = tf;
  }

  const link: ChartLink = { src, chart };
  const url = field(obj.u, 2048);
  if (url && /^https?:\/\//i.test(url)) link.url = url;
  const h = field(obj.h, 300);
  if (h) link.titleOverride = h;
  if (obj.vo && typeof obj.vo === "object" && !Array.isArray(obj.vo)) {
    const visual = cleanVisual(obj.vo as ChartVisualOverrides);
    if (visual) link.visual = visual;
  }
  if (typeof obj.bs === "string" && STACKS.has(obj.bs) && obj.bs !== "grouped") link.barStackMode = obj.bs as BarStackMode;
  if (obj.ct === true) link.connectScatterTrail = true;
  if (obj.mg === true) link.showMarginals = true;
  if (typeof obj.ar === "string" && ASPECTS.has(obj.ar)) link.chartAspect = obj.ar as ChartAspectId;
  if (typeof obj.dv === "string" && DEVICES.has(obj.dv)) link.chartDevice = obj.dv as ChartDeviceId;
  return link;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const ENCODING_FIELDS = [
  "xField",
  "yField",
  "colorField",
  "sizeField",
  "zField",
  "timeField",
  "trailId",
  "rowField",
  "glowField",
  "outlineField",
  "opacityField",
  "y2Field",
  "timeWindowField",
] as const;

const norm = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);

/**
 * Rebuild the shared chart against the open dataset's columns. Prefers an
 * identical rec already in the rail (keeps story specs), then `createChartRec`
 * (same path the Encoding panel uses), then a bare field-driven rec. Null when
 * the dataset is missing a column the chart needs.
 */
export function restoreChartRec(
  link: Pick<ChartLink, "chart" | "barStackMode">,
  columns: ColumnInfo[],
  recs: ChartRecommendation[],
  tableName: string,
): ChartRecommendation | null {
  const c = link.chart;
  const names = new Set(columns.map((col) => col.name));
  const used = [...ENCODING_FIELDS.map((f) => c[f]), c.tooltipKeyField].filter((f): f is string => !!f);
  if (!names.size || used.some((f) => !names.has(f))) return null;

  const same = recs.find(
    (r) =>
      r.kind === c.kind &&
      ENCODING_FIELDS.every((f) => norm(r[f]) === norm(c[f])) &&
      (!c.yAggregate || norm(r.yAggregate) === c.yAggregate),
  );
  let rec: ChartRecommendation | null = same ?? null;
  if (!rec) {
    rec = createChartRec(c.kind, columns, c.xField, c.yField ?? null, c.colorField ?? null, tableName, {
      sizeField: c.sizeField ?? null,
      zField: c.zField ?? null,
      timeField: c.timeField ?? null,
      trailId: c.trailId ?? null,
      rowField: c.rowField ?? null,
      glowField: c.glowField ?? null,
      outlineField: c.outlineField ?? null,
      opacityField: c.opacityField ?? null,
      yAggregate: c.yAggregate ?? null,
      topN: c.topN ?? null,
      y2Field: c.y2Field ?? null,
      comparePrevious: c.comparePrevious ?? null,
      rollingWindow: c.rollingWindow ?? null,
      yScale: c.yScale ?? null,
      seriesNormalize: c.seriesNormalize ?? null,
      residualOverlay: c.residualOverlay ?? null,
      anomalyHighlight: c.anomalyHighlight ?? null,
      bumpMode: c.bumpMode ?? null,
      timeWindowField: c.timeWindowField ?? null,
      timeWindow: c.timeWindow ?? null,
      tooltipFields: c.tooltipFields ?? null,
      tooltipKeyField: c.tooltipKeyField ?? null,
      barStackMode: link.barStackMode ?? "grouped",
    });
  }
  if (!rec) {
    rec = {
      id: `link-${c.kind}-${c.xField}-${c.yField ?? "n"}-${c.colorField ?? "n"}`,
      kind: c.kind,
      title: c.title ?? c.xField,
      subtitle: c.subtitle ?? "",
      score: 0,
      spec: {},
      xField: c.xField,
      yField: c.yField ?? null,
      colorField: c.colorField ?? null,
    };
  }
  // Overlay the shared encodings so channels createChartRec ignores for this
  // kind (e.g. a story scatter's time field) still come back.
  const out: ChartRecommendation = { ...rec };
  for (const f of ENCODING_FIELDS) {
    if (f === "xField") continue;
    const v = c[f];
    if (v !== undefined) (out as unknown as Record<string, unknown>)[f] = v;
  }
  if (c.yAggregate) out.yAggregate = c.yAggregate;
  if (c.tooltipFields) out.tooltipFields = c.tooltipFields;
  if (c.tooltipKeyField) out.tooltipKeyField = c.tooltipKeyField;
  if (c.title) out.title = c.title;
  if (c.subtitle !== undefined) out.subtitle = c.subtitle;
  if (c.timeWindow) out.timeWindow = c.timeWindow;
  return out;
}
