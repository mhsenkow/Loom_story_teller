#!/usr/bin/env node
/**
 * One-shot mechanical split for LOOM-141. Run from repo root:
 *   node scripts/split-loom-141.mjs
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const chartViewPath = path.join(root, "src/components/ChartView.tsx");
const outDir = path.join(root, "src/components/chartView");
const lines = fs.readFileSync(chartViewPath, "utf8").split("\n");

function slice1(a, b) {
  return lines.slice(a - 1, b).join("\n");
}

function stripLeadingSpaces(text, n) {
  return text
    .split("\n")
    .map((l) => (l.startsWith(" ".repeat(n)) ? l.slice(n) : l))
    .join("\n");
}

fs.mkdirSync(outDir, { recursive: true });

// --- constants.ts ---
const constantsBlock = slice1(122, 147);
fs.writeFileSync(
  path.join(outDir, "constants.ts"),
  `// ChartView stage constants (LOOM-141)
import { stagePixelRatio } from "@/lib/chartStagePixels";
import { useLoomStore } from "@/lib/store";

${constantsBlock.replace(/^\/\/.*\n/gm, "").trim()}\n`,
);

// --- chartStageRefs.ts ---
fs.writeFileSync(
  path.join(outDir, "chartStageRefs.ts"),
  `// Shared canvas / GPU ref bag for ChartView hooks (LOOM-141)
import type { MutableRefObject, RefObject } from "react";
import type { Canvas2DHitContext } from "@/lib/chartTooltip";
import type { DataCube, DataCubeRenderOpts } from "@/lib/dataCube";
import type { PressStart } from "@/lib/markFocus";
import type { YScaleKind } from "@/lib/dsTransforms";

export type GpuScatterRenderer = import("@/lib/webgpu").LoomRenderer;
export type GpuSceneRenderer = import("@/lib/webgpuScenes").LoomSceneRenderer;
export type GpuCubeRenderer = import("@/lib/webgpuCube").LoomCubeRenderer;

export type ChartStageRefs = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  axesOverlayRef: RefObject<HTMLCanvasElement | null>;
  focusLayerRef: RefObject<HTMLCanvasElement | null>;
  stageHostRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  rendererRef: MutableRefObject<GpuScatterRenderer | null>;
  sceneRendererRef: MutableRefObject<GpuSceneRenderer | null>;
  cubeRendererRef: MutableRefObject<GpuCubeRenderer | null>;
  scatterDataRef: MutableRefObject<{
    points: { x: number; y: number }[];
    rowIndices: number[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    pad: number;
    w: number;
    h: number;
    columns: string[];
    yScale?: YScaleKind;
    plot?: { left: number; top: number; right: number; bottom: number };
  } | null>;
  canvas2DHitRef: MutableRefObject<Canvas2DHitContext | null>;
  cubeFrameRef: MutableRefObject<{
    cube: DataCube;
    opts: DataCubeRenderOpts;
    w: number;
    h: number;
    baseCamera: { yaw: number; pitch: number; zoom: number };
  } | null>;
  cubeTransitionRef: MutableRefObject<{
    cube: DataCube;
    from: Map<string, [number, number, number]>;
  } | null>;
  exportStateRef: MutableRefObject<Record<string, unknown>>;
  sampleRowsRef: MutableRefObject<import("@/lib/store").SampleRows | null | undefined>;
  scatterTooltipRef: MutableRefObject<unknown>;
  chartTooltipRef: MutableRefObject<unknown>;
  brushStartRef: MutableRefObject<{ x: number; y: number } | null>;
  brushRectRef: MutableRefObject<{ x1: number; y1: number; x2: number; y2: number } | null>;
  panStartRef: MutableRefObject<{ x: number; y: number } | null>;
  pinchRef: MutableRefObject<{ dist: number; scale: number; midX: number; midY: number } | null>;
  pointerDownAtRef: MutableRefObject<PressStart | null>;
  sceneOrbitDragRef: MutableRefObject<{ x: number; y: number; yaw: number; pitch: number } | null>;
  scenePinchRef: MutableRefObject<{ dist: number; zoom: number } | null>;
  lastPointerTypeRef: MutableRefObject<string>;
  pinnedBoxesRef: MutableRefObject<import("@/lib/markFocus").CalloutBox[]>;
  suggestCycleRef: MutableRefObject<number>;
  prevChartSwapKeyRef: MutableRefObject<string | null>;
  chartSwapAnimsRef: MutableRefObject<Animation[]>;
  arrangePanelWasOpen: MutableRefObject<boolean>;
  prevCubeRef: MutableRefObject<DataCube | null>;
  announceKeyStepRef: MutableRefObject<boolean>;
};
`,
);

const paintBody = stripLeadingSpaces(slice1(2709, 3596), 4);
const paintImports = `// Active chart paint pass (extracted from ChartView useEffect — LOOM-141)
import { categoryIndex, radiusFromPointSize } from "@/lib/chartInk";
import { groupChartChannels } from "@/lib/channelGroups";
import { chartEntranceKey, markChartEntrancePlayed, shouldPlayChartEntrance } from "@/lib/chartEntranceOnce";
import { notifyChartPainted } from "@/lib/chartPaintSignal";
import { chartFont, chartTypeRamp } from "@/lib/chartType";
import { chartFontStack, resolveChartFontFamily } from "@/lib/fontCatalog";
import { FOOTNOTE_BAND_PX, densityAwarePointMarks, fitTextEllipsis, resolveChartPad, subsampleRowsForDensity, titleBandBottom } from "@/lib/chartLayout";
import {
  chartFootnoteReservePx,
  drawAxisFieldLabels,
  drawAxisFrame,
  drawChartBackground,
  drawChartSourceFootnote,
  MIN_WRAPPED_TITLE_HEIGHT,
  chartTitleWrapPx,
  drawChartTitleBlock,
} from "@/lib/chartLooks";
import { densityPointBudget } from "@/lib/chartStagePixels";
import { drawCanvasAnnotations } from "@/lib/canvasAnnotationDraw";
import { ARRANGE_PLOT_KINDS, arrangementPlot, hasCanvasArrangement } from "@/lib/canvasArrangement";
import { automaticPlotBounds } from "@/lib/chartSpace";
import { buildCategoricalLegendEntries, drawLegend } from "@/lib/chartLegend";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import { plotOf, valueTitle } from "@/lib/canvasCharts/plumbing";
import { renderFullSunburst } from "@/lib/canvasCharts/sunburst";
import { invScaleY, scaleDomain, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { analysisScope, analysisUnavailable } from "@/lib/timeSeriesAnalysis";
import { smartOverlayPalette } from "@/lib/chartSmartOverlayStyle";
import { chartEntranceReveal, easeOutCubic, traceEntranceClip } from "@/lib/motion";
import { getThemeUiColors, hexToRgb01 } from "@/lib/chartPalettes";
import { monitorRefLines } from "@/lib/monitoring/chartBridge";
import { drawReferenceLines } from "@/lib/canvasCharts/axisHelpers";
import { drawAxisTicks, drawGridLines, drawSmartOverlays } from "@/lib/canvasCharts/primitives";
import { renderFullScatter } from "@/lib/canvasCharts/scatter";
import { type BarModel, barsShouldBeHorizontal, computeBarModel, renderFullBar, renderFullHistogram } from "@/lib/canvasCharts/bar";
import { renderFullHeatmap, renderFullLine } from "@/lib/canvasCharts/lineHeatmap";
import { renderFullArea, renderFullBox, renderFullStrip } from "@/lib/canvasCharts/distributions";
import { renderFullBubble, renderFullPie } from "@/lib/canvasCharts/pieBubble";
import { renderFullLollipop, renderFullRadar, renderFullViolin, renderFullWaterfall } from "@/lib/canvasCharts/violinRadar";
import { renderFullArcDiagram, renderFullForceBubble, renderFullNetwork, renderFullSankey, renderFullTreemap } from "@/lib/canvasCharts/flowCharts";
import { renderFullCorrMatrix, renderFullDumbbell, renderFullFunnel, renderFullHexbin, renderFullParallel, renderFullPareto, renderFullRidgeline } from "@/lib/canvasCharts/statCharts";
import { markSymbols } from "@/lib/markSymbols";
import { DEFAULT_PAD, offsetHitTargets, scatterYDomain } from "@/lib/canvasCharts/shared";
import { clampTopN, countFacetGroupsDropped, DEFAULT_TOP_N, layoutFacetCells, partitionRowsByFacet } from "@/lib/chartFacets";
import { computeFacetSharedScatterBounds, computeFacetSharedValueDomain } from "@/lib/chartFacetScales";
import { resolveLayoutDirection } from "@/lib/chartSupport";
import type { YAggregateOption } from "@/lib/recommendations";
import { drawFireflyChrome, extractGpuScenePoints, fireflyDensity, fireflyGlowPoints, fireflyPalette, fireflyLayout, type GpuSceneKind, isGpuSceneKind, isWebGpuDrawableScene, renderGpuSceneCanvas } from "@/lib/gpuScenes";
import { isGeoMapKind, renderGeoMapCanvas } from "@/lib/geoMaps";
import { cubeCellCenter, cubeCellKey, dataCubeChartView, type DataCube, type DataCubeRenderOpts, drawDataCubeBackLayer, drawDataCubeFrontLayer, pickDataCubeCell, renderDataCubeCanvas } from "@/lib/dataCube";
import { isOddChartKind, renderOddChart } from "@/lib/oddCharts";
import type { HitTarget } from "@/lib/chartTooltip";
import type { ChartRecommendation } from "@/lib/recommendations";
import type { SmartResults } from "@/lib/store";
import { FRAMED_KINDS, OWN_FRAME_KINDS, SYMBOL_SERIES_KINDS, stageDpr } from "./constants";
import type { ChartStageRefs } from "./chartStageRefs";
import type { AtlasBundle } from "@/lib/geoAtlas";

export type ChartPaintParams = {
  refs: ChartStageRefs;
  canvasSized: boolean;
  activeChart: ChartRecommendation;
  sampleRows: NonNullable<import("@/lib/store").SampleRows>;
  chartSampleRows: import("@/lib/store").SampleRows | null | undefined;
  chartFootnoteText: string | null;
  chartColorInfo: ReturnType<typeof import("@/lib/chartPalettes").describeChartColorStatus> | null;
  footnoteOpts: (themeMuted?: string, themeBorder?: string) => Record<string, unknown>;
  gpuReady: boolean;
  useWebGPUScatter: boolean;
  useWebGpuScene: boolean;
  useWebGpuGlobe: boolean;
  useWebGpuCube: boolean;
  extractScatterData: () => import("@/lib/webgpu").GPUScatterPoint[] extends infer _ ? ReturnType<ChartPaintParams["extractScatterData"]> : never;
  getEffectiveScatterBounds: (
    sd: { xMin: number; xMax: number; yMin: number; yMax: number },
    view: { scale: number; panX: number; panY: number },
  ) => { xMin: number; xMax: number; yMin: number; yMax: number };
  scatterView: { scale: number; panX: number; panY: number };
  chartRenderOpts: ChartRenderOpts;
  chartVisualOverrides: import("@/lib/chartVisualTypes").ChartVisualOverrides;
  chartTitleOverrides: Record<string, string | null>;
  smartResults: SmartResults | null;
  themeUi: ReturnType<typeof getThemeUiColors>;
  colors: string[];
  opacity: number;
  pointSize: number;
  isCompact: boolean;
  isMobile: boolean;
  containerSize: { w: number; h: number };
  sceneOrbit: { yaw: number; pitch: number; zoom: number };
  dataCube: DataCube | null;
  cubeHover: import("@/components/DataCubePivot").CubeHoverCell | null;
  cubeSlice: number | null;
  cubeTableOpen: boolean;
  cubeAnim: number;
  connectScatterTrail: boolean;
  showMarginals: boolean;
  customRefLines: Record<string, import("@/lib/chartRenderTypes").ChartRenderOpts["customRefLines"] extends infer T ? T : never>;
  monitorLines: ReturnType<typeof monitorRefLines>;
  geoAtlasBundle: AtlasBundle | null;
  reducedMotion: boolean;
  fontEpoch: number;
  chartFontFamily: string;
  effectiveTheme: string;
  setHitsVersion: React.Dispatch<React.SetStateAction<number>>;
  setChartDrawError: React.Dispatch<React.SetStateAction<string | null>>;
  setCubeAnim: React.Dispatch<React.SetStateAction<number>>;
};

export function paintActiveChart(p: ChartPaintParams): (() => void) | undefined {
  const {
    refs: {
      canvasRef,
      canvas2DRef,
      axesOverlayRef,
      rendererRef,
      sceneRendererRef,
      cubeRendererRef,
      scatterDataRef,
      canvas2DHitRef,
      cubeFrameRef,
      cubeTransitionRef,
    },
    canvasSized,
    activeChart,
    sampleRows,
    chartSampleRows,
    chartFootnoteText,
    chartColorInfo,
    footnoteOpts,
    gpuReady,
    useWebGPUScatter,
    useWebGpuScene,
    useWebGpuGlobe,
    useWebGpuCube,
    extractScatterData,
    getEffectiveScatterBounds,
    scatterView,
    chartRenderOpts,
    chartVisualOverrides,
    chartTitleOverrides,
    smartResults,
    themeUi,
    colors,
    opacity,
    pointSize,
    isCompact,
    isMobile,
    containerSize,
    sceneOrbit,
    dataCube,
    cubeHover,
    cubeSlice,
    cubeTableOpen,
    cubeAnim,
    connectScatterTrail,
    showMarginals,
    customRefLines,
    monitorLines,
    geoAtlasBundle,
    reducedMotion,
    fontEpoch,
    chartFontFamily,
    effectiveTheme,
    setHitsVersion,
    setChartDrawError,
    setCubeAnim,
  } = p;

${paintBody.split("\n").map((l) => "  " + l).join("\n")}
}
`;

fs.writeFileSync(path.join(outDir, "paintActiveChart.ts"), paintImports);

console.log("Wrote constants.ts, chartStageRefs.ts, paintActiveChart.ts");
console.log("Next: run manual hook/component extraction or extend this script.");
