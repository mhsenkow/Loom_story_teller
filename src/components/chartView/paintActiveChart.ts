// Active chart paint pass (extracted from ChartView useEffect — LOOM-141)
// @ts-nocheck
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
import { ARRANGE_PLOT_KINDS, arrangementPlot, hasCanvasArrangement, titleArrangementRect } from "@/lib/canvasArrangement";
import type { ChartChromeLayout } from "@/lib/chartChromeLink";
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
import { isGeoMapKind, isWebGpuGlobeKind, renderGeoMapCanvas } from "@/lib/geoMaps";
import { cubeCellCenter, cubeCellKey, dataCubeChartView, type DataCube, type DataCubeRenderOpts, drawDataCubeBackLayer, drawDataCubeFrontLayer, pickDataCubeCell, renderDataCubeCanvas } from "@/lib/dataCube";
import { isOddChartKind, renderOddChart } from "@/lib/oddCharts";
import type { HitTarget } from "@/lib/chartTooltip";
import type { ChartRecommendation } from "@/lib/recommendations";
import type { SmartResults } from "@/lib/store";
import { FRAMED_KINDS, OWN_FRAME_KINDS, SYMBOL_SERIES_KINDS, stageDpr } from "./constants";
import type { ChartStageRefs } from "./chartStageRefs";
import type { AtlasBundle } from "@/lib/geoAtlas";
import type { Dispatch, SetStateAction } from "react";

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
  extractScatterData: () => {
    points: import("@/lib/webgpu").GPUScatterPoint[];
    rowIndices: number[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } | null;
  continuousStops: string[];
  forceCanvasCapture: boolean;
  socialExportReady: boolean;
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
  reportArrangementLayout: (layout: ChartChromeLayout) => void;
  setHitsVersion: Dispatch<SetStateAction<number>>;
  setChartDrawError: Dispatch<SetStateAction<string | null>>;
  setCubeAnim: Dispatch<SetStateAction<number>>;
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
    continuousStops,
    forceCanvasCapture,
    socialExportReady,
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
    reportArrangementLayout: reportArrangementLayoutArg,
    setHitsVersion,
    setChartDrawError,
    setCubeAnim,
  } = p;
  // Alias so nested drawOneFrame never hits a TDZ / stale-bundle name miss after LOOM-141.
  const reportArrangementLayout =
    typeof reportArrangementLayoutArg === "function"
      ? reportArrangementLayoutArg
      : () => undefined;

  if (!canvasSized || !activeChart || !sampleRows) return;
  if (activeChart.kind !== "scatter") scatterDataRef.current = null;
  if (activeChart.kind !== "dataCube") cubeFrameRef.current = null;
  
  // Data cube: back walls on 2D canvas → voxels on WebGPU (or 2D) → labels on the overlay
  if (activeChart.kind === "dataCube") {
    canvas2DHitRef.current = null;
    const canvas2D = canvas2DRef.current;
    const overlay = axesOverlayRef.current;
    const ctx = canvas2D?.getContext("2d", { willReadFrequently: true });
    const octx = overlay?.getContext("2d");
    if (!canvas2D || !ctx) return;
    const dpr = stageDpr();
    const w = canvas2D.width / dpr;
    const h = canvas2D.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (octx && overlay) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
    }
    if (!dataCube) {
      cubeFrameRef.current = null;
      ctx.fillStyle = themeUi.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = themeUi.muted;
      ctx.font = chartFont(chartRenderOpts.axisFontSize ?? 12, chartFontFamily);
      ctx.textAlign = "center";
      ctx.fillText("No rows land in the cube — try other Rows / Columns / Depth fields", w / 2, h / 2);
      ctx.textAlign = "left";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    const tr = cubeTransitionRef.current;
    const animating = !!tr && tr.cube === dataCube && cubeAnim < 1;
    const ease = easeOutCubic(cubeAnim);
    const centerOf = animating
      ? (cell: DataCube["cells"][number]): [number, number, number] => {
          const to = cubeCellCenter(dataCube, cell.xi, cell.yi, cell.zi);
          const from = tr!.from.get(cubeCellKey(dataCube, cell));
          if (!from) return to;
          return [from[0] + (to[0] - from[0]) * ease, from[1] + (to[1] - from[1]) * ease, from[2] + (to[2] - from[2]) * ease];
        }
      : undefined;
    const camera = sceneOrbit;
    const cubeOpts: DataCubeRenderOpts = {
      ramp: continuousStops,
      opacity,
      camera,
      slice: cubeSlice,
      contentInsets: !forceCanvasCapture && !socialExportReady ? { top: isMobile ? 56 : 88, bottom: cubeTableOpen ? h * 0.44 : 0 } : undefined,
      centerOf,
      fontFamily: chartFontFamily,
      axisFontSize: chartRenderOpts.axisFontSize,
      spaceUse: chartVisualOverrides.spaceUse,
      themeText: themeUi.text,
      themeMuted: themeUi.label,
      themeBorder: themeUi.border,
      themeBg: themeUi.bg,
      // The HTML pivot bar carries the legend live; Canvas draws it only for capture / export.
      showLegend: chartVisualOverrides.legendPosition !== "none" && (forceCanvasCapture || !!socialExportReady),
      hovered: cubeHover,
      footerReserve: chartFootnoteReservePx(chartFootnoteText, {
        hasColorRamp: !!chartColorInfo?.stops?.length,
        pad: 24,
        axisFontSize: chartRenderOpts.axisFontSize,
      }),
    };
    cubeFrameRef.current = { cube: dataCube, opts: cubeOpts, w, h, baseCamera: sceneOrbit };
    reportArrangementLayout({ plot: { x: 24, y: 24, w: w - 48, h: h - 48 } });
    if (useWebGpuCube && cubeRendererRef.current && octx) {
      const view = dataCubeChartView(dataCube, w, h, cubeOpts);
      ctx.fillStyle = themeUi.bg;
      ctx.fillRect(0, 0, w, h);
      const far = drawDataCubeBackLayer(ctx, dataCube, view, cubeOpts);
      cubeRendererRef.current.render(dataCube, view, continuousStops, opacity, cubeOpts);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawDataCubeFrontLayer(octx, dataCube, view, far, cubeOpts);
      if (chartFootnoteText || chartColorInfo?.stops?.length) {
        drawChartSourceFootnote(octx, w, h, 24, chartFootnoteText ?? "", {
          ...footnoteOpts(themeUi.label, themeUi.border),
        });
      }
      octx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      renderDataCubeCanvas(ctx, dataCube, w, h, cubeOpts);
      if (chartFootnoteText || chartColorInfo?.stops?.length) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChartSourceFootnote(ctx, w, h, 24, chartFootnoteText ?? "", {
          ...footnoteOpts(themeUi.label, themeUi.border),
        });
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    notifyChartPainted();
    return;
  }
  
  // WebGPU particle / 3D scenes (scatter3d, firefly) + live globe points
  if (
    (useWebGpuScene && isWebGpuDrawableScene(activeChart.kind) && sceneRendererRef.current) ||
    (useWebGpuGlobe && isWebGpuGlobeKind(activeChart.kind) && sceneRendererRef.current)
  ) {
    // Drop the previous chart's marks so hover / focus / pins never resolve against them.
    canvas2DHitRef.current = null;
    const canvas2D = canvas2DRef.current;
    if (canvas2D) {
      const ctx = canvas2D.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        const dpr = stageDpr();
        const w = canvas2D.width / dpr;
        const h = canvas2D.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = themeUi.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    // Title + credit live on the axes overlay (raised above the GPU canvas) and are
    // painted by the overlay effect — don't clear it here, or orbiting the scene
    // (which re-runs this effect, not that one) would wipe the title.
    const sceneRows = chartSampleRows?.rows ?? sampleRows.rows;
    const sceneCols = chartSampleRows?.columns ?? sampleRows.columns;
    const groupedScene = groupChartChannels(sceneRows, sceneCols, activeChart);
    const packed = extractGpuScenePoints(
      groupedScene.rows,
      groupedScene.columns,
      {
        xField: activeChart.xField,
        yField: activeChart.yField,
        zField: activeChart.zField,
        colorField: groupedScene.colorField,
        sizeField: activeChart.sizeField,
        timeField: activeChart.timeField,
        trailId: activeChart.trailId,
        invertSize: !!activeChart.channelInvert?.size,
        invertZ: !!activeChart.channelInvert?.z,
      },
    );
    if (packed) {
      const canvas = canvasRef.current;
      const dpr = stageDpr();
      const w = canvas ? canvas.width / dpr : 800;
      const h = canvas ? canvas.height / dpr : 600;
      const mode = isWebGpuGlobeKind(activeChart.kind)
        ? "globe"
        : (activeChart.kind as GpuSceneKind);
      // Firefly is a flat x × y field: map into the same nice-domain plot rect the
      // overlay frames with axes (drawFireflyChrome), and glow by size or recency.
      let points = packed.points;
      let bounds: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number } = packed;
      let plotRect: { left: number; top: number; right: number; bottom: number } | undefined;
      let crowd = { alpha: 1, size: 1 };
      if (activeChart.kind === "firefly") {
        const ffPad = resolveChartPad({
          kind: activeChart.kind,
          width: w,
          height: h,
          basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
          titleLayout: chartRenderOpts.titleLayout,
          tickRotation: chartRenderOpts.tickRotation,
          chartFrame: chartRenderOpts.chartFrame,
          isCompact,
          legendPosition: chartRenderOpts.legendPosition,
          axisFontSize: chartRenderOpts.axisFontSize,
          sourceFootnote: chartRenderOpts.sourceFootnote,
          chromeInfoBand: chartRenderOpts.chromeInfoBand,
        });
        const ffHeight = h - ((chartFootnoteText || chartColorInfo?.stops?.length) && (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer" ? FOOTNOTE_BAND_PX : 0);
        const lay = fireflyLayout(packed, w, ffHeight, ffPad);
        points = fireflyGlowPoints(packed);
        bounds = { xMin: lay.xs.min, xMax: lay.xs.max, yMin: lay.ys.min, yMax: lay.ys.max, zMin: 0, zMax: 1 };
        plotRect = { left: lay.left, top: lay.top, right: lay.right, bottom: lay.bottom };
        crowd = fireflyDensity(points.length, lay.right - lay.left, lay.bottom - lay.top);
        // Same circles the Canvas fallback registers (gpuScenes.ts), so firefly answers hover on GPU too.
        const sceneRows = chartSampleRows?.rows ?? sampleRows.rows;
        const sceneCols = sampleRows.columns;
        const targets: HitTarget[] = points.map((p) => ({ shape: "circle", cx: lay.sx(p.x), cy: lay.sy(p.y), r: 6, match: [], rowIndex: p.row ?? p.trail }));
        canvas2DHitRef.current = {
          kind: activeChart.kind,
          frameH: h,
          rows: sceneRows,
          columns: sceneCols,
          pad: ffPad,
          w,
          h: ffHeight,
          xIdx: sceneCols.indexOf(activeChart.xField),
          yIdx: activeChart.yField ? sceneCols.indexOf(activeChart.yField) : -1,
          cIdx: activeChart.colorField ? sceneCols.indexOf(activeChart.colorField) : -1,
          sizeIdx: activeChart.sizeField ? sceneCols.indexOf(activeChart.sizeField) : -1,
          targets,
        };
      }
      sceneRendererRef.current.uploadData(points, bounds, {
        plotRect,
        pointSize: activeChart.kind === "firefly" ? radiusFromPointSize(pointSize, 3) * 5.2 * crowd.size : pointSize * (activeChart.kind === "globe" ? 1.6 : 1),
        opacity,
        glowDensity: crowd.alpha,
        sizeScale: chartVisualOverrides.sizeScale ?? 1,
        palette: activeChart.kind === "firefly" ? fireflyPalette(colors, themeUi.bg) : colors,
        clearColor: hexToRgb01(themeUi.bg),
        yaw: sceneOrbit.yaw,
        pitch: sceneOrbit.pitch,
        zoom: sceneOrbit.zoom,
        mode,
      });
      sceneRendererRef.current.setCamera(sceneOrbit.yaw, sceneOrbit.pitch, sceneOrbit.zoom);
      sceneRendererRef.current.render(w, h);
    }
    setHitsVersion((v) => v + 1);
    notifyChartPainted();
    return;
  }
  
  if (useWebGPUScatter) return;
  
  // Non-scatter: clear WebGPU canvas so old scatter never shows through, then draw with 2D
  rendererRef.current?.clearCanvas();
  
  // Canvas 2D for bar, histogram, line, heatmap, strip (and scatter when WebGPU unavailable)
  const canvas2D = canvas2DRef.current;
  if (!canvas2D) return;
  const ctx = canvas2D.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  
  const dpr = stageDpr();
  const cw = (canvas2D as HTMLCanvasElement).width;
  const ch = (canvas2D as HTMLCanvasElement).height;
  if (typeof cw !== "number" || typeof ch !== "number" || cw <= 0 || ch <= 0) return;
  const w = cw / dpr;
  const hFull = ch / dpr;
  // Footer info owns a carved bottom band; header info grows top pad via margins instead.
  const infoBandOn =
    !!chartFootnoteText || !!chartColorInfo?.stops?.length;
  const chromeBand = chartVisualOverrides.chromeInfoBand ?? "footer";
  const footBand = infoBandOn && chromeBand === "footer" ? FOOTNOTE_BAND_PX : 0;
  const h = hFull - footBand;
  
  const rowsAll = chartSampleRows?.rows;
  const sourceCols = chartSampleRows?.columns;
  if (!Array.isArray(rowsAll) || !Array.isArray(sourceCols)) return;
  
  const zoomScale = activeChart.kind === "scatter" ? scatterView.scale : 1;
  const densityKinds =
    activeChart.kind === "scatter" || activeChart.kind === "bubble" || activeChart.kind === "parallel";
  const sourceIndices = chartSampleRows?.rowSourceIndices;
  const grouped = groupChartChannels(rowsAll, sourceCols, activeChart);
  const sub = densityKinds
    ? subsampleRowsForDensity(grouped.rows, densityPointBudget(isMobile), zoomScale, sourceIndices)
    : {
        rows: grouped.rows,
        sourceIndices,
        sampled: false,
        shown: grouped.rows.length,
        total: grouped.rows.length,
      };
  const rows = sub.rows;
  const cols = grouped.columns;
  
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hFull);
  
  // The footnote band is already carved off h — renderers shouldn't reserve it again
  const opts: ChartRenderOpts = { ...chartRenderOpts, sourceFootnote: false };
  ctx.lineCap = opts.lineCap ?? "round";
  ctx.lineJoin = opts.lineJoin ?? "round";
  const padArgs = {
    kind: activeChart.kind,
    width: w,
    height: h,
    basePad: opts.chartPadding ?? DEFAULT_PAD,
    titleLayout: opts.titleLayout,
    tickRotation: opts.tickRotation,
    chartFrame: opts.chartFrame,
    isCompact,
    legendPosition: opts.legendPosition,
    axisFontSize: opts.axisFontSize,
    sourceFootnote: infoBandOn && chromeBand === "header",
    chromeInfoBand: chromeBand,
  };
  const basePadPx = resolveChartPad(padArgs);
  // A long headline (Discover hooks often are) wraps above its subtitle — give it the room
  const titleWrapPx = h < MIN_WRAPPED_TITLE_HEIGHT ? 0 : chartTitleWrapPx(
    ctx,
    w,
    basePadPx,
    chartTitleOverrides[activeChart.id] ?? activeChart.title,
    activeChart.subtitle,
    opts,
  );
  const pad = titleWrapPx ? resolveChartPad({ ...padArgs, titleWrapPx }) : basePadPx;
  if (ARRANGE_PLOT_KINDS.has(activeChart.kind) && !activeChart.rowField) {
    opts.plotBounds = arrangementPlot(w, h, chartVisualOverrides) ?? automaticPlotBounds({ ...padArgs, titleWrapPx }, chartVisualOverrides.spaceUse);
  }
  const xIdx = cols.indexOf(activeChart.xField);
  const yIdx = activeChart.yField ? cols.indexOf(activeChart.yField) : -1;
  const symbolSeriesField = SYMBOL_SERIES_KINDS.has(activeChart.kind)
    ? (activeChart.emojiField ?? grouped.shapeField)
    : null;
  const cIdx = grouped.colorField
    ? cols.indexOf(grouped.colorField)
    : symbolSeriesField
      ? cols.indexOf(symbolSeriesField)
      : -1;
  const sizeIdx = activeChart.sizeField ? cols.indexOf(activeChart.sizeField) : -1;
  const glowIdx = activeChart.glowField ? cols.indexOf(activeChart.glowField) : -1;
  const outlineIdx = activeChart.outlineField ? cols.indexOf(activeChart.outlineField) : -1;
  const opacityIdx = activeChart.opacityField ? cols.indexOf(activeChart.opacityField) : -1;
  if (xIdx === -1) return;
  
  const fontFamily = opts.fontFamily ?? "Inter";
  
  const drawOneFrame = (clipProgress: number) => {
    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hFull);
      drawChartBackground(ctx, w, hFull, opts.backgroundStyle, opts.themeBg);
      if (clipProgress < 1) {
        ctx.save();
        traceEntranceClip(ctx, w, hFull, clipProgress, chartEntranceReveal(activeChart.kind, w, hFull));
        ctx.clip();
      }
      ctx.globalCompositeOperation = "source-over";
  
      // Per-paint scratch: renderers register hover targets + the series they colored
      const hits: HitTarget[] = [];
      const ropts: ChartRenderOpts = {
        ...opts,
        hits,
        analysis: !analysisUnavailable(activeChart) && smartResults?.analysis?.scope === analysisScope(activeChart) ? smartResults.analysis : undefined,
        fieldNames: cols.filter((name) => !name.includes("\u0000")),
        colorField: activeChart.kind === "heatmap" || activeChart.kind === "hexbin" ? activeChart.colorField : grouped.colorField,
        legend: null,
        scales: null,
        connectTrail: connectScatterTrail,
        showMarginals,
        rowSourceIndices: sub.sourceIndices,
      };
  
      const barColorIdx = cIdx >= 0 && cIdx !== xIdx ? cIdx : -1;
      const barAgg: YAggregateOption = yIdx < 0 ? "count" : (opts.yAggregate ?? "sum");
      const topN = clampTopN(opts.topN, DEFAULT_TOP_N);
      const y2Idx = opts.y2Field ? cols.indexOf(opts.y2Field) : -1;
      const kind = activeChart.kind;
      const rowIdx = activeChart.rowField ? cols.indexOf(activeChart.rowField) : -1;
      const facetPanels =
        rowIdx >= 0 && (kind === "bar" || kind === "line" || kind === "area" || kind === "scatter" || kind === "bubble")
          ? partitionRowsByFacet(rows, rowIdx)
          : [];
      const useFacets = facetPanels.length >= 2;
  
      let barModel: BarModel | undefined;
      let barFacetPayload: ReturnType<typeof buildBarFacetGrid> | undefined;
      if (!useFacets && activeChart.kind === "bar") {
        if (barColorIdx >= 0) {
          barFacetPayload = buildBarFacetGrid(rows, xIdx, yIdx, barColorIdx, barAgg, opts.barStackMode ?? "grouped", topN) ?? undefined;
        }
        if (!barFacetPayload) barModel = computeBarModel(rows, xIdx, yIdx, barAgg, topN);
      }
      const autoBarHoriz = !!barModel && barsShouldBeHorizontal(ctx, barModel, w, h, pad, opts);
      const barLayout = resolveLayoutDirection(activeChart.layoutDirection, autoBarHoriz);
      const barHorizontal = barLayout.horizontal;
      const barReverse = barLayout.reverse;
      // Lollipop defaults horizontal; Encoding Direction can flip to vertical / reverse
      const lolliLayout = resolveLayoutDirection(activeChart.layoutDirection, true);
  
      // Only true x/y charts get the shared L-frame; band-gutter charts draw their own
      const framed = !useFacets && FRAMED_KINDS.has(kind) && !barHorizontal;
      if (framed) drawAxisFrame(ctx, w, h, pad, opts);
      if (!useFacets && (FRAMED_KINDS.has(kind) || OWN_FRAME_KINDS.has(kind))) {
        const measure = valueTitle(ropts, yIdx, kind === "line" ? "mean" : "sum");
        const yTitle =
          kind === "bar" || kind === "pareto" || kind === "line" || kind === "area" || kind === "waterfall" || kind === "lollipop"
            ? measure
            : kind === "histogram"
              ? "Count"
            : kind === "corrMatrix"
              ? "Pearson r"
              : activeChart.yField;
        const lolliHoriz = kind === "lollipop" && lolliLayout.horizontal;
        if (barHorizontal || lolliHoriz) {
          drawAxisFieldLabels(ctx, w, h, pad, measure, activeChart.xField, opts);
        } else if (kind === "ridgeline") {
          drawAxisFieldLabels(ctx, w, h, pad, activeChart.xField, activeChart.yField, opts);
        } else if (kind === "dumbbell") {
          drawAxisFieldLabels(ctx, w, h, pad, `${activeChart.yField ?? "start"} → ${activeChart.sizeField ?? "end"}`, activeChart.xField, opts);
        } else {
          drawAxisFieldLabels(ctx, w, h, pad, activeChart.xField, yTitle, opts);
        }
      }
  
      const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
      const drawTitle = () =>
        drawChartTitleBlock(ctx, w, h, pad, titleText, activeChart.subtitle, {
          titleX: opts.titleX, titleY: opts.titleY, titleWidth: opts.titleWidth, titleScale: opts.titleScale,
          titleLayout: opts.titleLayout,
          fontFamily,
          titleFontWeight: opts.titleFontWeight,
          titleItalic: opts.titleItalic,
          themeText: opts.themeText,
          themeMuted: opts.themeMuted,
          themeBorder: opts.themeBorder,
          axisLabelColor: opts.axisLabelColor,
          axisFontSize: opts.axisFontSize,
        });
      // Map and scene renderers fill the whole canvas first — title goes on top of them.
      const paintsOwnBackground =
        activeChart.kind === "choropleth" || isGeoMapKind(activeChart.kind) || isGpuSceneKind(activeChart.kind);
      if (!paintsOwnBackground) drawTitle();
  
      let scatterViewBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | undefined;
      if (!useFacets && activeChart.kind === "scatter") {
        const sd = extractScatterData();
        if (sd) {
          scatterViewBounds = getEffectiveScatterBounds(sd, scatterView);
          scatterDataRef.current = {
            ...sd,
            ...scatterViewBounds,
            plot: opts.plotBounds ?? { left: pad, top: pad, right: w - pad, bottom: h - pad },
            pad,
            w,
            h: hFull,
            columns: cols,
            yScale: (activeChart.yScale ?? "linear") as YScaleKind,
          };
          setHitsVersion((v) => v + 1);
        }
      }
  
      if (useFacets) {
        const sourceIndexOf = new Map<unknown[], number>(rows.map((row, index) => [row, sub.sourceIndices?.[index] ?? index]));
        const titleBand = Math.min(56, h * 0.12);
        const facetAgg: YAggregateOption = yIdx < 0 ? "count" : (ropts.yAggregate ?? (kind === "line" ? "mean" : "sum"));
        const sharedValueDomain = computeFacetSharedValueDomain(kind, rows, xIdx, yIdx, facetAgg, rowIdx, cIdx, ropts) ?? undefined;
        const sharedScatterBounds =
          kind === "scatter" || kind === "bubble"
            ? computeFacetSharedScatterBounds(rows, xIdx, yIdx) ?? undefined
            : undefined;
        const facetDropped = countFacetGroupsDropped(rows, rowIdx);
        if (facetDropped > 0) {
          ctx.fillStyle = opts.themeMuted ?? "#6b6b78";
          ctx.font = chartFont(opts.axisFontSize ?? 12, fontFamily, 600);
          ctx.textAlign = "right";
          ctx.textBaseline = "top";
          ctx.fillText(`+${facetDropped} more groups`, w - pad * 0.35, pad * 0.15);
        }
        const cells = layoutFacetCells(facetPanels, pad * 0.35, titleBand, w - pad * 0.7, h - titleBand - pad * 0.35);
        const miniPad = Math.max(18, Math.min(36, Math.min(cells[0]?.w ?? 80, cells[0]?.h ?? 80) * 0.18));
        const labelH = Math.max(18, (opts.axisFontSize ?? 12) + 6);
        for (let fi = 0; fi < cells.length; fi++) {
          const cell = cells[fi]!;
          const panel = facetPanels[fi]!;
          const cellHits: HitTarget[] = [];
          const cellOpts: ChartRenderOpts = {
            ...ropts,
            plotBounds: undefined,
            rowSourceIndices: undefined,
            hits: cellHits,
            legend: null,
            scales: null,
            ...(sharedValueDomain ? { sharedValueDomain } : {}),
            ...(sharedScatterBounds ? { sharedScatterBounds } : {}),
          };
          const cw = cell.w;
          const ch = Math.max(40, cell.h - labelH);
          ctx.save();
          ctx.beginPath();
          ctx.rect(cell.x, cell.y, cell.w, cell.h);
          ctx.clip();
          ctx.translate(cell.x, cell.y);
          ctx.fillStyle = opts.themeMuted ?? "#6b6b78";
          ctx.font = chartFont(opts.axisFontSize ?? 12, fontFamily, 600);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          const label = fitTextEllipsis(ctx, panel.key, Math.max(0, cw - 4));
          ctx.fillText(label, 2, 1);
          ctx.translate(0, labelH);
          if (kind === "bar") {
            let bf: ReturnType<typeof buildBarFacetGrid> | undefined;
            let bm: BarModel | undefined;
            if (barColorIdx >= 0) {
              bf = buildBarFacetGrid(panel.rows, xIdx, yIdx, barColorIdx, barAgg, opts.barStackMode ?? "grouped", topN) ?? undefined;
            }
            if (!bf) bm = computeBarModel(panel.rows, xIdx, yIdx, barAgg, topN);
            const autoH = !!bm && barsShouldBeHorizontal(ctx, bm, cw, ch, miniPad, cellOpts);
            const lay = resolveLayoutDirection(activeChart.layoutDirection, autoH);
            renderFullBar(ctx, panel.rows, xIdx, yIdx, barColorIdx, cw, ch, miniPad, cellOpts, bf, lay.horizontal, bm, cIdx >= 0 && cIdx === xIdx, lay.reverse);
          } else if (kind === "line") {
            renderFullLine(ctx, panel.rows, xIdx, yIdx, cIdx, cw, ch, miniPad, cellOpts, y2Idx);
          } else if (kind === "area") {
            renderFullArea(ctx, panel.rows, xIdx, yIdx, cIdx, cw, ch, miniPad, cellOpts, y2Idx);
          } else if (kind === "scatter" || kind === "bubble") {
            renderFullScatter(ctx, panel.rows, xIdx, yIdx, cIdx, sizeIdx, cw, ch, miniPad, cellOpts, {
              glowIdx,
              outlineIdx,
              opacityIdx,
            }, undefined, sharedScatterBounds);
          }
          ctx.restore();
          for (const hit of cellHits) {
            if (hit.rowIndex != null) hit.rowIndex = sourceIndexOf.get(panel.rows[hit.rowIndex]!) ?? hit.rowIndex;
            if (hit.match.length && rowIdx >= 0) hit.match.push([rowIdx, panel.key]);
          }
          offsetHitTargets(cellHits, cell.x, cell.y + labelH);
          hits.push(...cellHits);
          if (fi === 0 && cellOpts.legend) ropts.legend = cellOpts.legend;
          if (fi === 0 && cellOpts.scales) ropts.scales = cellOpts.scales;
        }
        drawAxisFieldLabels(ctx, w, h, pad, activeChart.xField, activeChart.yField, ropts);
      }
  
      if (!useFacets) switch (activeChart.kind) {
        case "scatter":
          renderFullScatter(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, ropts, {
            glowIdx,
            outlineIdx,
            opacityIdx,
          }, smartResults?.clusters?.rowToCluster ?? undefined, scatterViewBounds);
          break;
        case "bar": renderFullBar(ctx, rows, xIdx, yIdx, barColorIdx, w, h, pad, ropts, barFacetPayload, barHorizontal, barModel, cIdx >= 0 && cIdx === xIdx, barReverse); break;
        case "histogram": renderFullHistogram(ctx, rows, xIdx, w, h, pad, ropts); break;
        case "line": renderFullLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts, y2Idx); break;
        case "heatmap": renderFullHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "strip":
          renderFullStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts, { opacityIdx });
          break;
        case "box": renderFullBox(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "area": renderFullArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts, y2Idx); break;
        case "pie": renderFullPie(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "bubble": renderFullBubble(ctx, rows, cols, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, ropts); break;
        case "violin": renderFullViolin(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "radar": renderFullRadar(ctx, rows, cols, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "waterfall": renderFullWaterfall(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "lollipop": renderFullLollipop(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "dumbbell": renderFullDumbbell(ctx, rows, xIdx, yIdx, sizeIdx, cIdx, w, h, pad, ropts); break;
        case "ridgeline": renderFullRidgeline(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "hexbin": renderFullHexbin(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "funnel": renderFullFunnel(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "parallel": renderFullParallel(ctx, rows, cols, cIdx, w, h, pad, ropts); break;
        case "treemap": renderFullTreemap(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "sunburst": renderFullSunburst(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "choropleth":
          renderGeoMapCanvas(
            "choropleth",
            ctx,
            rows,
            cols,
            {
              xField: activeChart.xField,
              yField: activeChart.yField,
              colorField: grouped.colorField,
              sizeField: activeChart.sizeField,
            },
            w,
            h,
            pad,
            {
              colors: opts.colors,
                lineCap: opts.lineCap, lineJoin: opts.lineJoin,
              opacity: opts.opacity,
              fontFamily: opts.fontFamily,
                axisFontSize: opts.axisFontSize,
              themeText: opts.themeText,
              themeMuted: opts.themeMuted,
              themeBorder: opts.themeBorder,
              themeBg: opts.themeBg,
              pointSize: opts.pointSize,
              markShape: opts.markShape,
              markerMode: opts.markerMode,
              markEmoji: opts.markEmoji,
              shapeField: grouped.shapeField,
              emojiField: activeChart.emojiField,
              emojiMap: activeChart.emojiMap,
              yAggregate: opts.yAggregate,
              continuousStops: opts.continuousStops,
              channelInvert: opts.channelInvert,
              yaw: sceneOrbit.yaw,
              pitch: sceneOrbit.pitch,
              zoom: sceneOrbit.zoom,
              hits,
              atlas: geoAtlasBundle,
            },
          );
          break;
        case "forceBubble": renderFullForceBubble(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "sankey": renderFullSankey(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "network": renderFullNetwork(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "arcDiagram": renderFullArcDiagram(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
        case "pareto": renderFullPareto(ctx, rows, xIdx, yIdx, w, h, pad, ropts); break;
        case "corrMatrix": renderFullCorrMatrix(ctx, rows, cols, w, h, pad, ropts); break;
        default:
          if (isGeoMapKind(activeChart.kind)) {
            renderGeoMapCanvas(
              activeChart.kind,
              ctx,
              rows,
              cols,
              {
                xField: activeChart.xField,
                yField: activeChart.yField,
                colorField: grouped.colorField,
                sizeField: activeChart.sizeField,
              },
              w,
              h,
              pad,
              {
                colors: opts.colors,
                lineCap: opts.lineCap, lineJoin: opts.lineJoin,
                opacity: opts.opacity,
                fontFamily: opts.fontFamily,
                axisFontSize: opts.axisFontSize,
                themeText: opts.themeText,
                themeMuted: opts.themeMuted,
                themeBorder: opts.themeBorder,
                themeBg: opts.themeBg,
                pointSize: opts.pointSize,
                markShape: opts.markShape,
                markerMode: opts.markerMode,
                markEmoji: opts.markEmoji,
                shapeField: grouped.shapeField,
                emojiField: activeChart.emojiField,
                emojiMap: activeChart.emojiMap,
                yAggregate: opts.yAggregate,
                continuousStops: opts.continuousStops,
                channelInvert: opts.channelInvert,
                yaw: sceneOrbit.yaw,
                pitch: sceneOrbit.pitch,
                zoom: sceneOrbit.zoom,
                hits,
                atlas: geoAtlasBundle,
              },
            );
          } else if (isGpuSceneKind(activeChart.kind)) {
            const packed = extractGpuScenePoints(
              rows,
              cols,
              {
                xField: activeChart.xField,
                yField: activeChart.yField,
                // Terrain Height is Z; older shares may still carry it on sizeField.
                zField:
                  activeChart.zField ??
                  (activeChart.kind === "quakeTerrain" ? activeChart.sizeField : null),
                colorField: grouped.colorField,
                sizeField: activeChart.sizeField,
                timeField: activeChart.timeField,
                trailId: activeChart.trailId,
                invertSize: !!activeChart.channelInvert?.size,
        invertZ: !!activeChart.channelInvert?.z,
              },
            );
            if (packed) {
              renderGpuSceneCanvas(activeChart.kind, ctx, packed, w, h, pad, {
                ...opts,
                colors: opts.colors,
                lineCap: opts.lineCap, lineJoin: opts.lineJoin,
                opacity: opts.opacity,
                fontFamily: opts.fontFamily,
                axisFontSize: opts.axisFontSize,
                themeText: opts.themeText,
                themeMuted: opts.themeMuted,
                themeBorder: opts.themeBorder,
                themeBg: opts.themeBg,
                pointSize: opts.pointSize,
                continuousStops: opts.continuousStops,
                channelInvert: opts.channelInvert,
                layoutDirection: activeChart.layoutDirection,
                yaw: sceneOrbit.yaw,
                pitch: sceneOrbit.pitch,
                zoom: sceneOrbit.zoom,
                hits,
              });
            }
          } else if (isOddChartKind(activeChart.kind)) {
            renderOddChart(
              activeChart.kind,
              ctx,
              rows,
              cols,
              xIdx,
              yIdx,
              cIdx,
              sizeIdx,
              w,
              h,
              pad,
              {
                colors: opts.colors,
                lineCap: opts.lineCap, lineJoin: opts.lineJoin,
                opacity: opts.opacity,
                fontFamily: opts.fontFamily,
                axisFontSize: opts.axisFontSize,
                tickRotation: opts.tickRotation,
                axisLabelColor: opts.axisLabelColor,
                themeText: opts.themeText,
                themeMuted: opts.themeMuted,
                themeBorder: opts.themeBorder,
                showDataLabels: opts.showDataLabels,
                pointSize: opts.pointSize,
                markShape: opts.markShape,
                markerMode: opts.markerMode,
                markEmoji: opts.markEmoji,
                shapeField: grouped.shapeField,
                emojiField: activeChart.emojiField,
                emojiMap: activeChart.emojiMap,
                continuousStops: opts.continuousStops,
                channelInvert: opts.channelInvert,
                yAggregate: opts.yAggregate,
                themeBg: opts.themeBg,
                legendPosition: opts.legendPosition,
                topN: opts.topN,
                bumpMode: opts.bumpMode ?? activeChart.bumpMode ?? undefined,
                wordCloudMode: opts.wordCloudMode ?? activeChart.wordCloudMode ?? undefined,
                wordCloudFont: opts.wordCloudFont,
                wordCloudArrange: opts.wordCloudArrange,
                wordCloudScale: opts.wordCloudScale,
                wordCloudWeight: opts.wordCloudWeight,
                pyramidScaleMode: opts.pyramidScaleMode ?? activeChart.pyramidScaleMode ?? undefined,
                deltaDisplay: opts.deltaDisplay ?? activeChart.deltaDisplay ?? undefined,
                layoutDirection: activeChart.layoutDirection,
                hits,
              },
              false,
            );
          }
          break;
      }
      if (paintsOwnBackground) drawTitle();
  
      const baseHit: Canvas2DHitContext = {
        kind: activeChart.kind,
        frameH: hFull,
        rows,
        columns: cols,
        pad,
        w,
        h,
        xIdx,
        yIdx,
        cIdx: cIdx >= 0 ? cIdx : -1,
        sizeIdx: sizeIdx >= 0 ? sizeIdx : -1,
        yAggregate: opts.yAggregate ?? undefined,
        ...(activeChart.kind === "bar" && barFacetPayload ? { barFacet: barFacetPayload } : {}),
        ...(activeChart.kind === "bar" && barModel?.entries.length ? { barEntries: barModel.entries, barHorizontal } : {}),
        ...(hits.length ? { targets: hits } : {}),
      };
  
      // Legend: prefer what the renderer reported; otherwise fall back to color-field categories
      let legendEntries = ropts.legend;
      // Odd and scene renderers draw their own keys; maps only draw ramps, so
      // categorical color on point / bubble / globe / arc maps uses this legend.
      const categoricalMap = isGeoMapKind(kind) && kind !== "geoHex";
      const symbolField = activeChart.emojiField ?? activeChart.shapeField;
      if (legendEntries == null && symbolField && (categoricalMap || kind === "scatter")) {
        const symbols = markSymbols(
          { ...opts, shapeField: grouped.shapeField, emojiField: activeChart.emojiField, emojiMap: activeChart.emojiMap },
          cols,
          rows,
          rows.length,
        );
        const colorSeen = new Map<string, number>();
        if (cIdx >= 0) for (const r of rows) if (!colorSeen.has(String(r[cIdx]))) colorSeen.set(String(r[cIdx]), colorSeen.size);
        legendEntries = symbols.legend((r) =>
          opts.colors[(cIdx >= 0 ? (colorSeen.get(String(r[cIdx])) ?? 0) : 0) % opts.colors.length]!,
        );
      }
      if (legendEntries == null && cIdx >= 0 && (!paintsOwnBackground || categoricalMap) && !isOddChartKind(kind)) {
        const seen = categoryIndex(rows, cIdx);
        legendEntries = [...seen.entries()].map(([label, i]) => ({ label, color: opts.colors[i % opts.colors.length]! }));
      }
      const legendPos = opts.legendPosition ?? "auto";
      let legendRect: ChartChromeLayout["legend"] = null;
      if (legendPos !== "none" && legendEntries && legendEntries.length > 1) {
        const legendTitle =
          kind === "waterfall" || kind === "dumbbell"
            ? undefined
            : activeChart.emojiField ?? activeChart.shapeField ?? activeChart.colorField ?? undefined;
        // Renderers with a label gutter report their real plot rect — keep the key inside it
        const plotRect = !useFacets && ropts.scales?.rect ? ropts.scales.rect : pad;
        // Point / bubble maps draw their size key bottom-left
        const avoid = categoricalMap && activeChart.sizeField ? ["bottom-left"] : [];
        legendRect = drawLegend(ctx, legendEntries, legendPos, w, h, plotRect, fontFamily, opts.themeBg, opts.themeBorder, opts.themeText, legendTitle, avoid, { x: chartVisualOverrides.legendOffsetX, y: chartVisualOverrides.legendOffsetY, width: chartVisualOverrides.legendWidth, height: chartVisualOverrides.legendHeight }, opts.axisFontSize);
      }
      const actualPlot = !useFacets && ropts.scales?.rect ? ropts.scales.rect : (opts.plotBounds ?? { left: pad, top: pad, right: w - pad, bottom: h - pad });
      const chromeLayout: ChartChromeLayout = {
        plot: { x: actualPlot.left, y: actualPlot.top, w: actualPlot.right - actualPlot.left, h: actualPlot.bottom - actualPlot.top },
        plotEdit: opts.plotBounds ? { x: opts.plotBounds.left, y: opts.plotBounds.top, w: opts.plotBounds.right - opts.plotBounds.left, h: opts.plotBounds.bottom - opts.plotBounds.top } : { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad },
        title: titleArrangementRect(w, h, pad, chartVisualOverrides),
        legend: legendRect,
        xAxis: { x: pad, y: h - pad, w: Math.max(0, w - 2 * pad), h: pad },
        yAxis: { x: 0, y: pad, w: pad, h: Math.max(0, h - 2 * pad) },
      };
      canvas2DHitRef.current = { ...baseHit, chromeLayout };
      reportArrangementLayout(chromeLayout);
      setHitsVersion((v) => v + 1);
      // Custom reference lines ("+ Add reference line") on the renderer's own value scale
      // …plus limits from monitors watching this feed's plotted column ("🔔 ▲ name").
      const refLines = [...(customRefLines[activeChart.id] ?? []), ...monitorLines];
      if (refLines.length && ropts.scales) {
        drawReferenceLines(ctx, refLines, ropts.scales, opts);
      }
      if (opts.ghostEnabled) {
        const weight = opts.ghostWeight === "whisper" ? 0.12 : opts.ghostWeight === "firm" ? 0.35 : 0.22;
        const place = opts.ghostPlace ?? "se";
        const gw = Math.min(160, w * 0.28);
        const gh = 48;
        const gx =
          place === "sw" || place === "nw" ? pad : w - pad - gw;
        const gy =
          place === "ne" || place === "nw" ? pad + 8 : h - pad - gh - 8;
        ctx.save();
        ctx.globalAlpha = weight;
        ctx.fillStyle = opts.themeText ?? "#e8e8ec";
        ctx.font = chartFont(28, fontFamily, 600);
        ctx.textAlign = place.endsWith("e") ? "right" : "left";
        const tx = place.endsWith("e") ? gx + gw : gx;
        ctx.fillText(String(sub.total), tx, gy + 30);
        ctx.globalAlpha = weight * 0.8;
        ctx.font = chartFont(chartTypeRamp(opts.axisFontSize).mark, fontFamily);
        ctx.fillText("rows", tx, gy + 44);
        ctx.restore();
      }
      if (smartResults) {
        drawSmartOverlays(
          ctx,
          w,
          h,
          pad,
          rows,
          cols,
          xIdx,
          yIdx,
          activeChart,
          smartResults,
          ropts,
          smartOverlayPalette(themeUi, appSettings.colorblindCharts),
        );
      }
  
      if (infoBandOn) {
        drawChartSourceFootnote(ctx, w, hFull, pad, chartFootnoteText ?? "", {
          ...footnoteOpts(opts.themeMuted, opts.themeBorder),
          fontFamily,
        });
      }
  
      if (clipProgress < 1) ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } catch (err) {
      console.warn("Chart draw error:", err);
      setChartDrawError(err instanceof Error ? err.message : "Chart could not be drawn.");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  };
  
  setChartDrawError(null);
  const animateEntrance =
    !reducedMotion &&
    (chartVisualOverrides.animateEntrance ?? false) &&
    shouldPlayChartEntrance(
      chartEntranceKey(activeChart?.id, activeChart?.kind),
      chartVisualOverrides.animateEntrance ?? false,
    );
  if (animateEntrance) {
    let cancelled = false;
    const start = performance.now();
    const DURATION_MS = 600;
    const tick = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / DURATION_MS);
      drawOneFrame(easeOutCubic(t));
      if (t < 1) requestAnimationFrame(tick);
      else {
        drawOneFrame(1);
        markChartEntrancePlayed(chartEntranceKey(activeChart?.id, activeChart?.kind));
      }
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }
  
  drawOneFrame(1);
  if (chartVisualOverrides.animateEntrance && !reducedMotion) {
    markChartEntrancePlayed(chartEntranceKey(activeChart?.id, activeChart?.kind));
  }
  notifyChartPainted();
}
