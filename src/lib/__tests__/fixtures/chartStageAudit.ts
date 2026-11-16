/** Full production Canvas dispatcher with deterministic data and no GPU/animation. */
import { paintActiveChart, type ChartPaintParams } from "@/components/chartView/paintActiveChart";
import { extractScatterDataFromRows, getEffectiveScatterBounds } from "@/components/chartView/extractScatterData";
import { buildDataCube } from "../../dataCube";
import { isOddChartKind } from "../../oddCharts";
import { isGeoMapKind } from "../../geoMaps";
import { isGpuSceneKind } from "../../gpuScenes";
import type { ChartKind, ChartRecommendation } from "../../recommendations";
import type { ChartRenderOpts } from "../../chartRenderTypes";
import type { Canvas2DHitContext } from "../../chartTooltip";
import { chartCapabilities } from "../../chartSupport";
import { auditColumns, auditRows, oddEnc } from "./chartAudit";

export function auditRecommendation(kind: ChartKind): ChartRecommendation {
  let slots = [0, 2, 1, -1];
  if (isOddChartKind(kind)) slots = oddEnc[kind] ?? [0, 2, 1, 3];
  else if (isGeoMapKind(kind)) slots = [5, 6, 1, 2];
  else if (isGpuSceneKind(kind)) slots = [2, 3, 1, 4];
  else if (["scatter", "bubble", "hexbin"].includes(kind)) slots = [2, 3, 1, 4];
  else if (["line", "area"].includes(kind)) slots = [7, 2, 1, -1];
  else if (["strip", "ridgeline"].includes(kind)) slots = [2, 0, 1, -1];
  else if (kind === "histogram") slots = [2, -1, -1, -1];
  else if (kind === "heatmap") slots = [0, 1, 2, -1];
  else if (kind === "dumbbell") slots = [0, 2, -1, 3];
  else if (["pie", "waterfall", "box", "pareto", "choropleth"].includes(kind)) slots = [0, 2, -1, -1];
  if (kind === "hexbin") slots = [2, 3, 4, -1];
  const [x, y, c, s] = slots;
  return { id: `audit-${kind}`, kind, title: "Parameter audit", subtitle: "", score: 90, spec: {},
    xField: auditColumns[x]!, yField: auditColumns[y] ?? null, colorField: auditColumns[c] ?? null,
    sizeField: auditColumns[s] ?? null, zField: "depth", timeField: "date", trailId: "series" };
}

export function paintAuditStage(kind: ChartKind, ctx: CanvasRenderingContext2D, overrides: Partial<ChartRenderOpts> = {}, rows = auditRows, recipe: Partial<ChartRecommendation> = {}, paint: Partial<ChartPaintParams> = {}) {
  const chart = { ...auditRecommendation(kind), ...overrides, ...recipe };
  const sample = { columns: auditColumns, rows, types: [], total_rows: rows.length };
  const opts: ChartRenderOpts = { colors: ["#0072b2", "#d55e00", "#009e73"], continuousStops: ["#0072b2", "#d55e00"], opacity: .85, pointSize: 12, fontFamily: "Inter", legendPosition: chartCapabilities(kind).legend ? "auto" : "none", ...overrides };
  const canvas = { width: 800, height: 500, getContext: () => ctx };
  const refs = {
    canvas2DRef: { current: canvas }, canvasRef: { current: canvas }, axesOverlayRef: { current: canvas },
    rendererRef: { current: null }, sceneRendererRef: { current: null }, cubeRendererRef: { current: null },
    scatterDataRef: { current: null }, canvas2DHitRef: { current: null as Canvas2DHitContext | null },
    cubeFrameRef: { current: null }, cubeTransitionRef: { current: null },
  };
  const errors: string[] = [];
  paintActiveChart({
    refs, canvasSized: true, activeChart: chart, sampleRows: sample, chartSampleRows: sample,
    chartFootnoteText: null, chartColorInfo: null, footnoteOpts: () => ({}),
    chartRenderOpts: opts, colors: opts.colors, continuousStops: opts.continuousStops!, opacity: opts.opacity, pointSize: opts.pointSize,
    chartVisualOverrides: overrides, chartTitleOverrides: {}, smartResults: null,
    themeUi: { bg: "#fff", text: "#111", label: "#555", border: "#ccc" },
    containerSize: { w: 800, h: 500 }, sceneOrbit: { yaw: .6, pitch: .4, zoom: 1 },
    scatterView: { scale: 1, panX: 0, panY: 0 }, extractScatterData: () => extractScatterDataFromRows(sample, chart as Parameters<typeof extractScatterDataFromRows>[1]),
    getEffectiveScatterBounds, chartFontFamily: "Inter", forceCanvasCapture: true,
    dataCube: kind === "dataCube" ? buildDataCube(rows, auditColumns, { xField: "region", yField: "series", zField: "depth", valueField: "value", aggregate: "sum" }) : null,
    cubeSlice: null, cubeAnim: 1, customRefLines: {}, monitorLines: [], reducedMotion: true,
    reportArrangementLayout: () => {}, setHitsVersion: () => {}, setChartDrawError: (message: unknown) => { if (typeof message === "string") errors.push(message); },
    ...paint,
  } as unknown as ChartPaintParams);
  if (errors.length) throw new Error(errors.join("; "));
  return refs.canvas2DHitRef.current;
}
