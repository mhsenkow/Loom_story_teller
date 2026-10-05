// =================================================================
// ChartView — Recommendation Grid + Full Chart
// =================================================================
// Two-panel layout:
//   Left: scrollable grid of chart recommendation thumbnails
//   Right: full-size render of the selected chart
//
// Clicking a thumbnail promotes it to the full-size view.
// The full-size view uses WebGPU for scatter, Canvas 2D for others.
// =================================================================

"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useLoomStore, type SmartResults } from "@/lib/store";
import { ChartCard } from "@/components/ChartCard";
import { LoomRenderer, type GPUScatterPoint } from "@/lib/webgpu";
import {
  discreteSeriesColors,
  getThemeUiColors,
  hexToRgb01,
  resolveChartColors,
  sampleContinuous,
} from "@/lib/chartPalettes";
import { useIsMobile, useMobileLiveEdit, useViewportWidth } from "@/lib/useMediaQuery";
import { fitChartFrame, resolveDevice, aspectLabel } from "@/lib/chartViewport";
import {
  getBestSuggestion,
  getTopSuggestions,
  getRecommendationReason,
  createChartRec,
  recommendStorySequence,
  recommend,
  tryBuildRandomChartRec,
  type YAggregateOption,
  type ChartRecommendation,
} from "@/lib/recommendations";
import { getChartRenderIssue, formatChartAggregationSummary, chartCapabilities } from "@/lib/chartSupport";
import { isOddChartKind, renderOddChart } from "@/lib/oddCharts";
import {
  extractGpuScenePoints,
  isGpuSceneKind,
  isWebGpuDrawableScene,
  renderGpuSceneCanvas,
  type GpuSceneKind,
} from "@/lib/gpuScenes";
import { isGeoMapKind, renderGeoMapCanvas, isWebGpuGlobeKind, globeCameraForData } from "@/lib/geoMaps";
import { LoomSceneRenderer } from "@/lib/webgpuScenes";
import { LoomCubeRenderer } from "@/lib/webgpuCube";
import { DataCubePivotBar, DataCubePivotTable, type CubeAxisSlot, type CubeHoverCell } from "@/components/DataCubePivot";
import {
  buildDataCube,
  buildPivotTable,
  cubeCellCenter,
  cubeCellKey,
  cubeCellTooltip,
  cubeView,
  drawDataCubeBackLayer,
  drawDataCubeFrontLayer,
  pickDataCubeCell,
  renderDataCubeCanvas,
  type DataCube,
  type DataCubeRenderOpts,
} from "@/lib/dataCube";
import {
  resolveChartPad,
  contrastingInk,
  densityAwarePointMarks,
  subsampleRowsForDensity,
  fitTextEllipsis,
  blendToward,
  isLightHex,
} from "@/lib/chartLayout";
import {
  drawChartBackground,
  drawAxisFrame,
  drawChartGrid,
  drawChartTicks,
  drawAxisFieldLabels,
  drawChartTitleBlock,
  drawBandAxisX,
  drawBandAxisY,
  drawColorRamp,
  drawPositionedLabelsX,
  type PlotRect,
} from "@/lib/chartLooks";
import {
  aggregateAxisTitle,
  buildXModel,
  classifyKeys,
  formatAxisValue,
  formatDataValue,
  histogramBins,
  linear,
  niceTicks,
  niceZeroScale,
  timeTicks,
  type XModel,
} from "@/lib/chartAxes";
import { VISUAL_PRESETS } from "@/lib/lookSystem";
import { StartHere } from "@/components/StartHere";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import { suggestChartFromOllama } from "@/lib/ollama";
import {
  allowedRowIndices,
  formatTooltipNumber,
  pickCanvasTooltipRowIndex,
  pickHitTarget,
  rowForHitTarget,
  type HitTarget,
  projectRowForTooltip,
  resolveTooltipFieldNames,
  rowMatchesTooltipLink,
} from "@/lib/chartTooltip";
import { buildBarFacetGrid, type BarFacetHitPayload, type Canvas2DHitContext } from "@/lib/chartTooltip";
import { partitionRowsByFacet, layoutFacetCells, clampTopN, DEFAULT_TOP_N } from "@/lib/chartFacets";

const DEFAULT_COLORS = discreteSeriesColors(
  resolveChartColors({ paletteId: "categorical" }),
  8,
);

/** Shift hit targets after painting a facet cell into a translated clip. */
function offsetHitTargets(targets: HitTarget[], dx: number, dy: number) {
  for (const t of targets) {
    if (t.shape === "rect") {
      t.x += dx;
      t.y += dy;
    } else {
      t.cx += dx;
      t.cy += dy;
    }
  }
}

function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DEFAULT_PAD = 56;

/** x/y charts that share the L-frame + axis titles drawn by the dispatch. */
const FRAMED_KINDS = new Set<string>([
  "scatter", "bar", "histogram", "line", "area", "box", "bubble", "violin", "waterfall", "hexbin",
]);
/** Charts with a category-label gutter: they draw their own frame; dispatch still titles the axes. */
const OWN_FRAME_KINDS = new Set<string>(["strip", "lollipop", "dumbbell", "ridgeline", "heatmap"]);

function isNumericType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some(n => t.includes(n));
}

/**
 * Backing-store scale for the chart stage. Platform captures pin it (so a
 * 1080px export lays out identically on every device); otherwise screen DPR.
 * Canvas sizing and every draw pass must agree on this value.
 */
function stageDpr(): number {
  const target = useLoomStore.getState().socialExportTarget;
  return target?.pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
}

export function ChartView() {
  const {
    selectedFile, sampleRows, chartRecs, activeChart, setActiveChart, setPanelTab, columnStats,
    chartVisualOverrides, aiSuggestionReason, chartTitleOverrides, setChartTitleOverride,
    pngExportHandler, setPngExportHandler, setSvgExportHandler, vegaSpec, smartResults, appSettings,
    setSelectedRowIndices, setToast, chartAnnotations,
    setHoveredRowIndex,
    tooltipLink, setTooltipLink,
    pinnedTooltips, addPinnedTooltip, removePinnedTooltip,
    customRefLines, chartInteractionMode, setChartInteractionMode,
    crosshairPos, setCrosshairPos,
    lassoPoints, setLassoPoints,
    barStackMode, connectScatterTrail, showMarginals,
    selectedRowIndices,
    rulerPins, setRulerPins,
    addChartView, setPromptDialog, querySql,
    createStoryDashboard, setDashboardsExpanded,
    startDeepScan,
  } = useLoomStore();

  const isMobile = useIsMobile();
  const liveEdit = useMobileLiveEdit();
  const viewportW = useViewportWidth();
  // Framing uses the chart host width when Auto — window width would say
  // "desktop" while side panels leave a phone-sized stage.
  const [hostSize, setHostSize] = useState({ w: 800, h: 500 });
  const socialExportTarget = useLoomStore((s) => s.socialExportTarget);
  const socialExportReady = useLoomStore((s) => s.socialExportReady);
  // Phones (and panel-squeezed hosts) always fill — social aspect framing on a
  // already-narrow stage becomes a postage-stamp letterbox (e.g. 16:9 → 278×156).
  // Platform export overrides this so we can still hit exact pixel targets.
  const hostIsNarrow = hostSize.w > 0 && hostSize.w < 768 && !socialExportTarget;
  const chartAspect =
    socialExportTarget?.presetId && socialExportTarget.presetId !== "current"
      ? (appSettings.chartAspect ?? "free")
      : isMobile || hostIsNarrow
        ? "free"
        : (appSettings.chartAspect ?? "free");
  const chartDevice = socialExportTarget
    ? "desktop"
    : isMobile
      ? "mobile"
      // "Auto" means the real device (window width). The stage host is often narrow on a
      // laptop with both side panels open, and treating it as a phone boxed the chart into 390px.
      : resolveDevice(appSettings.chartDevice ?? "auto", viewportW);

  const openChartEditor = useCallback(() => {
    setPanelTab("chart");
    if (!useLoomStore.getState().panelOpen) useLoomStore.getState().togglePanel();
  }, [setPanelTab]);

  const colors = useMemo(() => {
    const colorField = activeChart?.colorField;
    const col = colorField
      ? columnStats.find((c) => c.name === colorField)
      : undefined;
    const colorFieldType = col
      ? (isNumericType(col.data_type) ? "quantitative" : "nominal")
      : null;
    const resolved = resolveChartColors({
      paletteId: chartVisualOverrides.colorPalette ?? "auto",
      theme: appSettings.theme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    });
    return discreteSeriesColors(resolved, Math.max(8, resolved.colors.length));
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.colorPaletteReverse,
    chartVisualOverrides.colorScaleKind,
    appSettings.theme,
    appSettings.colorblindCharts,
    activeChart?.kind,
    activeChart?.colorField,
    columnStats,
  ]);

  const continuousStops = useMemo(() => {
    const colorField = activeChart?.colorField;
    const col = colorField
      ? columnStats.find((c) => c.name === colorField)
      : undefined;
    const colorFieldType = col
      ? (isNumericType(col.data_type) ? "quantitative" : "nominal")
      : null;
    return resolveChartColors({
      paletteId: chartVisualOverrides.colorPalette ?? "auto",
      theme: appSettings.theme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    }).colors;
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.colorPaletteReverse,
    chartVisualOverrides.colorScaleKind,
    appSettings.theme,
    appSettings.colorblindCharts,
    activeChart?.kind,
    activeChart?.colorField,
    columnStats,
  ]);
  const opacity = chartVisualOverrides.opacity ?? 0.7;
  const pointSize = chartVisualOverrides.pointSize ?? 12;

  const themeUi = useMemo(() => getThemeUiColors(appSettings.theme), [appSettings.theme]);

  // Chart stage pixel size — must be in draw-effect deps so aspect/device
  // framing (and any resize that clears canvases) triggers a redraw.
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });
  const containerWidth = containerSize.w;
  const isCompact = containerWidth < 400;
  const isMedium = containerWidth < 600;

  const chartRenderOpts = useMemo((): ChartRenderOpts => {
    const frame = chartVisualOverrides.chartFrame ?? "focus";
    // Base pad from frame; final pad resolved at draw time against canvas size + title band
    const framePad =
      frame === "hero"
        ? Math.max(chartVisualOverrides.chartPadding ?? DEFAULT_PAD, 56)
        : frame === "compact"
          ? Math.min(Math.max(chartVisualOverrides.chartPadding ?? 44, 40), 48)
          : (chartVisualOverrides.chartPadding ?? DEFAULT_PAD);
    const axisStyle = chartVisualOverrides.axisStyle ?? "rule";
    const axisFromStyle =
      axisStyle === "ladder"
        ? { axisLineWidth: 2, gridStyle: "solid" as const, gridOpacity: 0.7 }
        : axisStyle === "mercury"
          ? { axisLineWidth: 3, gridStyle: "none" as const, gridOpacity: 0 }
          : axisStyle === "spine"
            ? { axisLineWidth: 1.5, gridStyle: "dashed" as const, gridOpacity: 0.35 }
            : axisStyle === "index"
              ? { axisLineWidth: 1, gridStyle: "dotted" as const, gridOpacity: 0.45 }
              : axisStyle === "tape"
                ? { axisLineWidth: 1, gridStyle: "solid" as const, gridOpacity: 0.25 }
                : {};
    const motif = chartVisualOverrides.markMotif ?? "dots";
    const motifShape =
      chartVisualOverrides.markShape ??
      (motif === "squares" ? "square" : motif === "ring" ? "ring" : motif === "ticks" ? "cross" : "circle");
    const detail = chartVisualOverrides.chartDetail ?? "viz";
    const showDataLabels =
      chartVisualOverrides.showDataLabels ?? (detail === "deep");
    const caps = activeChart ? chartCapabilities(activeChart.kind) : null;
    const showGrid =
      !caps?.cartesian || isCompact
        ? false
        : chartVisualOverrides.showGrid !== false &&
          (chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid") !== "none" &&
          detail !== "plain";

    // Never use screen/multiply blends as defaults — they wreck light themes
    const rawBlend = chartVisualOverrides.blendMode ?? "source-over";
    const blendMode =
      rawBlend === "screen" || rawBlend === "multiply" || rawBlend === "color-dodge"
        ? "source-over"
        : rawBlend;

    return {
      colors,
      continuousStops,
      opacity,
      opacityUserSet: typeof chartVisualOverrides.opacity === "number",
      pointSize: isCompact ? Math.max(4, pointSize * 0.7) : pointSize,
      fontFamily: chartVisualOverrides.fontFamily ?? "Inter",
      titleFontWeight: chartVisualOverrides.titleFontWeight ?? 600,
      titleItalic: chartVisualOverrides.titleItalic ?? false,
      tickRotation: chartVisualOverrides.tickRotation ?? 0,
      axisFontSize: isCompact ? 9 : Math.max(9, chartVisualOverrides.axisFontSize ?? 10),
      markShape: motifShape,
      markStroke: chartVisualOverrides.markStroke ?? motif === "ring",
      markStrokeWidth: chartVisualOverrides.markStrokeWidth ?? 1,
      markStrokeColor: chartVisualOverrides.markStrokeColor ?? "auto",
      markJitter: chartVisualOverrides.markJitter ?? 0,
      sizeScale: chartVisualOverrides.sizeScale ?? 1,
      barCornerRadius: chartVisualOverrides.barCornerRadius ?? (motif === "bar" ? 0 : 3),
      lineStrokeStyle: chartVisualOverrides.lineStrokeStyle ?? "solid",
      lineCurveSmooth: chartVisualOverrides.lineCurveSmooth ?? false,
      lineWidth: chartVisualOverrides.lineWidth ?? (motif === "ticks" ? 1 : 1.5),
      axisLineColor: chartVisualOverrides.axisLineColor ?? themeUi.border,
      axisLineWidth: chartVisualOverrides.axisLineWidth ?? axisFromStyle.axisLineWidth ?? 1,
      gridStyle: chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid",
      gridOpacity: chartVisualOverrides.gridOpacity ?? axisFromStyle.gridOpacity ?? 0.5,
      tickCount: chartVisualOverrides.tickCount ?? 5,
      axisLabelColor: chartVisualOverrides.axisLabelColor ?? themeUi.muted,
      showGrid,
      chartPadding: isCompact ? 36 : isMedium ? 46 : framePad,
      // "auto" shows a key only when a color field is encoded, in the emptiest corner
      legendPosition: !caps?.legend ? "none" : (chartVisualOverrides.legendPosition ?? "auto"),
      showDataLabels: detail === "plain" ? false : showDataLabels,
      backgroundStyle: chartVisualOverrides.backgroundStyle ?? "default",
      blendMode,
      glowEnabled: caps?.markPoints ? (chartVisualOverrides.glowEnabled ?? false) : false,
      glowIntensity: chartVisualOverrides.glowIntensity ?? 8,
      chartDetail: detail,
      markMotif: motif,
      axisStyle,
      emphasisStyle: chartVisualOverrides.emphasisStyle ?? "tint",
      ghostEnabled: chartVisualOverrides.ghostEnabled ?? false,
      ghostWeight: chartVisualOverrides.ghostWeight ?? "soft",
      ghostPlace: chartVisualOverrides.ghostPlace ?? "se",
      titleLayout: chartVisualOverrides.titleLayout ?? "pair",
      chartFrame: frame,
      themeBg: themeUi.bg,
      themeText: themeUi.text,
      themeMuted: themeUi.muted,
      themeBorder: themeUi.border,
      yAggregate: (() => {
        if (!activeChart) return undefined;
        if (!activeChart.yField) return "count" as YAggregateOption;
        return activeChart.yAggregate ?? (activeChart.kind === "line" ? "mean" : "sum");
      })(),
      barStackMode: activeChart?.kind === "bar" ? barStackMode : undefined,
      topN: activeChart?.topN ?? undefined,
      y2Field: activeChart?.y2Field ?? undefined,
      comparePrevious: activeChart?.comparePrevious ?? undefined,
    };
  }, [colors, continuousStops, opacity, pointSize, chartVisualOverrides, themeUi, isCompact, isMedium, activeChart, barStackMode]);

  const renderIssue = useMemo(
    () => getChartRenderIssue(activeChart, sampleRows),
    [activeChart, sampleRows],
  );

  const sampleHonestyLabel = useMemo(() => {
    if (!sampleRows) return "";
    const n = sampleRows.rows.length;
    const t = sampleRows.total_rows ?? n;
    if (t > n) return `${n.toLocaleString()} / ${t.toLocaleString()} rows`;
    return `${n.toLocaleString()} rows`;
  }, [sampleRows]);

  const densityHint = useMemo(() => {
    if (!sampleRows || !activeChart) return null;
    if (activeChart.kind !== "scatter" && activeChart.kind !== "bubble") return null;
    const n = sampleRows.rows.length;
    if (n < 800) return null;
    return n >= 5000
      ? "Dense · thinned"
      : "Crowded · softened";
  }, [sampleRows, activeChart]);

  const applyClarity = useCallback(() => {
    useLoomStore.getState().setChartVisualOverrides({ ...VISUAL_PRESETS.clarity.overrides });
    useLoomStore.getState().setToast("Applied Clarity look");
  }, []);

  const aggregationHint = useMemo(
    () => (activeChart ? formatChartAggregationSummary(activeChart) : ""),
    [activeChart],
  );

  const applyWorkingChart = useCallback(() => {
    const stats = columnStats ?? [];
    if (!stats.length) return;
    const tn = selectedFile?.name?.replace(/\.\w+$/, "") ?? "data";
    const first = recommend(stats, sampleRows ?? null, selectedFile?.name ?? `${tn}.csv`)[0];
    const rec = first ?? tryBuildRandomChartRec(stats, tn);
    if (rec) setActiveChart(rec);
  }, [columnStats, selectedFile, setActiveChart]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  const axesOverlayRef = useRef<HTMLCanvasElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartFrameSize = useMemo(() => {
    if (socialExportTarget) {
      return {
        width: socialExportTarget.width,
        height: socialExportTarget.height,
        aspectLocked: true,
      };
    }
    return fitChartFrame({
      hostW: hostSize.w,
      hostH: hostSize.h,
      aspectId: chartAspect,
      device: chartDevice,
      gutter: 10,
    });
  }, [hostSize.w, hostSize.h, chartAspect, chartDevice, socialExportTarget]);
  const rendererRef = useRef<LoomRenderer | null>(null);
  const sceneRendererRef = useRef<LoomSceneRenderer | null>(null);
  const cubeRendererRef = useRef<LoomCubeRenderer | null>(null);
  const [cubeHover, setCubeHover] = useState<CubeHoverCell | null>(null);
  /** Focused depth layer (null = all layers / rolled up). */
  const [cubeSlice, setCubeSlice] = useState<number | null>(null);
  const [cubeTableOpen, setCubeTableOpen] = useState(false);
  /** Pivot transition: voxel start positions keyed by cubeCellKey; progress 0→1 in cubeAnim. */
  const cubeTransitionRef = useRef<{ cube: DataCube; from: Map<string, [number, number, number]> } | null>(null);
  const prevCubeRef = useRef<DataCube | null>(null);
  const [cubeAnim, setCubeAnim] = useState(1);
  /** Last cube frame (data + layout) for hover picking and PNG export. */
  const cubeFrameRef = useRef<{ cube: DataCube; opts: DataCubeRenderOpts; w: number; h: number; baseCamera: { yaw: number; pitch: number; zoom: number } } | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const [sceneOrbit, setSceneOrbit] = useState({ yaw: 0.55, pitch: 0.35, zoom: 1 });
  const sceneOrbitDragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [sceneTime, setSceneTime] = useState(0);
  const hasSmartOverlays =
    smartResults &&
    ((smartResults.anomaly?.rowIndices?.length ?? 0) > 0 ||
      (smartResults.trend?.points?.length ?? 0) >= 2 ||
      (smartResults.forecast?.points?.length ?? 0) > 0 ||
      (smartResults.referenceLines?.lines?.length ?? 0) > 0 ||
      (smartResults.clusters && Object.keys(smartResults.clusters.rowToCluster).length > 0));
  // Story/dashboard PNG capture must use Canvas 2D — WebGPU readback often
  // yields axes-only frames (grid, no points) when tiles are snapped quickly.
  const previewCaptureActive = useLoomStore((s) => !!s.previewCapture);
  const forceCanvasCapture = previewCaptureActive || !!socialExportTarget || socialExportReady;
  const useWebGPUScatter =
    activeChart?.kind === "scatter" &&
    gpuReady &&
    !forceCanvasCapture &&
    !hasSmartOverlays &&
    // Trails, marginals, and reference lines are drawn by the Canvas scatter
    !connectScatterTrail &&
    !showMarginals &&
    !(customRefLines[activeChart.id]?.length) &&
    (chartVisualOverrides.markShape ?? "circle") === "circle" &&
    !chartVisualOverrides.markStroke &&
    !(chartVisualOverrides.markJitter ?? 0) &&
    !chartVisualOverrides.glowEnabled &&
    !activeChart?.glowField &&
    !activeChart?.outlineField &&
    !activeChart?.opacityField;
  const useWebGpuScene =
    !!activeChart &&
    isWebGpuDrawableScene(activeChart.kind) &&
    gpuReady &&
    !forceCanvasCapture &&
    !!sceneRendererRef.current;
  const useWebGpuGlobe =
    !!activeChart &&
    isWebGpuGlobeKind(activeChart.kind) &&
    gpuReady &&
    !forceCanvasCapture &&
    !!sceneRendererRef.current;
  const useWebGpuCube =
    activeChart?.kind === "dataCube" &&
    gpuReady &&
    !forceCanvasCapture &&
    !!cubeRendererRef.current;
  const dataCube = useMemo(() => {
    if (activeChart?.kind !== "dataCube" || !sampleRows?.rows?.length) return null;
    return buildDataCube(sampleRows.rows, sampleRows.columns, {
      xField: activeChart.xField,
      yField: activeChart.yField,
      zField: activeChart.zField,
      valueField: activeChart.sizeField,
      aggregate: activeChart.yAggregate,
    });
  }, [
    activeChart?.kind,
    activeChart?.xField,
    activeChart?.yField,
    activeChart?.zField,
    activeChart?.sizeField,
    activeChart?.yAggregate,
    sampleRows,
  ]);
  const pivotTable = useMemo(() => {
    if (!cubeTableOpen || activeChart?.kind !== "dataCube" || !sampleRows?.rows?.length) return null;
    return buildPivotTable(
      sampleRows.rows,
      sampleRows.columns,
      {
        xField: activeChart.xField,
        yField: activeChart.yField,
        zField: activeChart.zField,
        valueField: activeChart.sizeField,
        aggregate: activeChart.yAggregate,
      },
      cubeSlice,
    );
  }, [
    cubeTableOpen,
    cubeSlice,
    activeChart?.kind,
    activeChart?.xField,
    activeChart?.yField,
    activeChart?.zField,
    activeChart?.sizeField,
    activeChart?.yAggregate,
    sampleRows,
  ]);

  // A new depth field means old slice indices are meaningless.
  useEffect(() => {
    setCubeSlice(null);
  }, [activeChart?.zField, activeChart?.kind]);
  useEffect(() => {
    if (dataCube && cubeSlice != null && cubeSlice >= dataCube.z.labels.length) setCubeSlice(null);
  }, [dataCube, cubeSlice]);

  // Pivot animation: when the same three fields are re-assigned to different axes,
  // fly each voxel from its old grid position to its new one.
  useEffect(() => {
    const prev = prevCubeRef.current;
    prevCubeRef.current = dataCube;
    if (!prev || !dataCube || prev === dataCube) return;
    const fields = (c: DataCube) => [c.x.field, c.y.field, c.z.field];
    const same = [...fields(prev)].sort().join("\u0001") === [...fields(dataCube)].sort().join("\u0001");
    if (!same || fields(prev).join("\u0001") === fields(dataCube).join("\u0001")) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || appSettings.reducedMotion) return;
    const from = new Map<string, [number, number, number]>();
    for (const cell of prev.cells) from.set(cubeCellKey(prev, cell), cubeCellCenter(prev, cell.xi, cell.yi, cell.zi));
    cubeTransitionRef.current = { cube: dataCube, from };
    const start = performance.now();
    const DURATION = 650;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setCubeAnim(t);
      if (t < 1) raf = requestAnimationFrame(tick);
      else cubeTransitionRef.current = null;
    };
    setCubeAnim(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dataCube, appSettings.reducedMotion]);

  /** Re-assign the cube's three fields (pivot) through the normal encoding path. */
  const applyCubeAxes = useCallback(
    (next: Record<CubeAxisSlot, string>) => {
      if (!activeChart || activeChart.kind !== "dataCube" || columnStats.length === 0) return;
      const table = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";
      const rec = createChartRec("dataCube", columnStats, next.x, next.y, null, table, {
        zField: next.z,
        sizeField: activeChart.sizeField ?? null,
        yAggregate: activeChart.yAggregate ?? null,
        tooltipFields: activeChart.tooltipFields,
        tooltipKeyField: activeChart.tooltipKeyField ?? null,
      });
      if (rec) setActiveChart(rec);
    },
    [activeChart, columnStats, selectedFile?.name, setActiveChart],
  );
  const cubeAxes = useCallback(
    (): Record<CubeAxisSlot, string> => ({
      x: activeChart?.xField ?? "",
      y: activeChart?.yField ?? "",
      z: activeChart?.zField ?? "",
    }),
    [activeChart?.xField, activeChart?.yField, activeChart?.zField],
  );
  const swapCubeAxes = useCallback(
    (a: CubeAxisSlot, b: CubeAxisSlot) => {
      const cur = cubeAxes();
      applyCubeAxes({ ...cur, [a]: cur[b], [b]: cur[a] });
    },
    [cubeAxes, applyCubeAxes],
  );
  const rotateCubeAxes = useCallback(() => {
    const cur = cubeAxes();
    applyCubeAxes({ x: cur.z, y: cur.x, z: cur.y });
  }, [cubeAxes, applyCubeAxes]);
  const replaceCubeAxis = useCallback(
    (slot: CubeAxisSlot, column: string) => {
      if (!sampleRows?.columns.includes(column)) return;
      const cur = cubeAxes();
      const other = (Object.keys(cur) as CubeAxisSlot[]).find((k) => cur[k] === column);
      // Dropping a field that's already on another axis swaps them (pivot-table behaviour).
      if (other) {
        if (other !== slot) swapCubeAxes(other, slot);
        return;
      }
      applyCubeAxes({ ...cur, [slot]: column });
    },
    [cubeAxes, applyCubeAxes, swapCubeAxes, sampleRows?.columns],
  );

  // [ / ] step depth slices, Esc returns to all layers.
  useEffect(() => {
    if (activeChart?.kind !== "dataCube" || !dataCube) return;
    const nz = dataCube.z.labels.length;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "]") {
        e.preventDefault();
        setCubeSlice((s) => (s == null ? 0 : s + 1 >= nz ? null : s + 1));
      } else if (e.key === "[") {
        e.preventDefault();
        setCubeSlice((s) => (s == null ? nz - 1 : s - 1 < 0 ? null : s - 1));
      } else if (e.key === "Escape") {
        setCubeSlice((s) => (s == null ? s : null));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeChart?.kind, dataCube]);
  const orbitEnabled =
    !!activeChart &&
    (activeChart.kind === "scatter3d" ||
      activeChart.kind === "dataCube" ||
      activeChart.kind === "firefly" ||
      activeChart.kind === "globe" ||
      activeChart.kind === "globeTrail");
  const [canvasSized, setCanvasSized] = useState(false);
  const exportStateRef = useRef({ activeChart, gpuReady, vegaSpec, sampleRows, chartVisualOverrides });
  exportStateRef.current = { activeChart, gpuReady, vegaSpec, sampleRows, chartVisualOverrides };
  const sampleRowsRef = useRef(sampleRows);
  sampleRowsRef.current = sampleRows;
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  const getEffectiveScatterBounds = useCallback(
    (sd: { xMin: number; xMax: number; yMin: number; yMax: number }, view: { scale: number; panX: number; panY: number }) => {
      const { scale, panX, panY } = view;
      const cx = (sd.xMin + sd.xMax) / 2;
      const cy = (sd.yMin + sd.yMax) / 2;
      const halfX = (sd.xMax - sd.xMin) / 2;
      const halfY = (sd.yMax - sd.yMin) / 2;
      return {
        xMin: cx + panX - halfX / scale,
        xMax: cx + panX + halfX / scale,
        yMin: cy + panY - halfY / scale,
        yMax: cy + panY + halfY / scale,
      };
    },
    [],
  );

  const selectRecommendation = useCallback(
    (rec: ChartRecommendation) => {
      setActiveChart(rec);
      if (isMobile) {
        setSuggestionsExpanded(false);
      } else {
        setPanelTab("chart");
      }
    },
    [isMobile, setActiveChart, setPanelTab],
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [scatterTooltip, setScatterTooltip] = useState<{ clientX: number; clientY: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] } | null>(null);
  const [chartTooltip, setChartTooltip] = useState<{
    clientX: number;
    clientY: number;
    rowIndex: number;
    row: (string | number | boolean | null)[];
    columns: string[];
  } | null>(null);
  const [scatterView, setScatterView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [brushRect, setBrushRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);
  const brushRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  brushRectRef.current = brushRect;
  const scatterDataRef = useRef<{ points: { x: number; y: number }[]; rowIndices: number[]; xMin: number; xMax: number; yMin: number; yMax: number; pad: number; w: number; h: number; columns: string[] } | null>(null);
  const canvas2DHitRef = useRef<Canvas2DHitContext | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState("");
  const [showTitleEditButton, setShowTitleEditButton] = useState(false);
  const titleHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestSuggestion = useMemo(() => getBestSuggestion(chartRecs), [chartRecs]);
  const topSuggestions = useMemo(() => getTopSuggestions(chartRecs, 6), [chartRecs]);
  const suggestCycleRef = useRef(0);
  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const displayTitle = activeChart
    ? (chartTitleOverrides[activeChart.id] ?? activeChart.title)
    : "Select a chart";

  useEffect(() => {
    suggestCycleRef.current = 0;
  }, [selectedFile?.path, chartRecs]);

  const handleSuggestChart = useCallback(() => {
    const picks = topSuggestions.length > 0 ? topSuggestions : (bestSuggestion ? [bestSuggestion] : []);
    if (picks.length === 0) return;
    const idx = suggestCycleRef.current % picks.length;
    const pick = picks[idx]!;
    suggestCycleRef.current = idx + 1;
    setActiveChart(pick);
    setPanelTab("chart");
    const n = picks.length;
    setToast(
      n > 1
        ? `Suggested ${idx + 1}/${n}: ${pick.title} — click again for another`
        : `Applied best: ${pick.title}`,
    );
  }, [topSuggestions, bestSuggestion, setActiveChart, setPanelTab, setToast]);

  const handleTellStory = useCallback(async () => {
    if (!selectedFile) {
      setToast("Select a file first");
      return;
    }
    const story = recommendStorySequence(columnStats, sampleRows, selectedFile.name);
    if (story.charts.length === 0) {
      setToast("Not enough data variety to build a story");
      return;
    }
    const id = createStoryDashboard(
      selectedFile.path,
      selectedFile.name,
      story.title,
      story.charts,
      sampleRows,
    );
    if (!id) {
      setToast("Could not create story dashboard");
      return;
    }
    const dashboard = useLoomStore.getState().dashboards.find((d) => d.id === id);
    const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
    setPanelTab("dashboards");
    if (isMobile && !useLoomStore.getState().panelOpen) useLoomStore.getState().togglePanel();
    if (chartIds.length > 0) {
      setToast(`Building "${story.title}" — capturing ${chartIds.length} previews…`);
      await captureStoryDashboardPreviews(id);
    } else {
      useLoomStore.getState().setDashboardsExpanded(true);
      setToast(`Created "${story.title}" with ${story.charts.length} charts`);
    }
  }, [
    selectedFile,
    columnStats,
    sampleRows,
    createStoryDashboard,
    setPanelTab,
    setToast,
    isMobile,
  ]);

  const handleSuggestWithAI = useCallback(async () => {
    if (columnStats.length === 0) return;
    setAiSuggesting(true);
    try {
      const currentChart = activeChart
        ? {
          chartKind: activeChart.kind,
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: activeChart.colorField,
        }
        : null;
      const suggestion = await suggestChartFromOllama(columnStats, tableName, { currentChart });
      if (suggestion) {
        const rec = createChartRec(
          suggestion.chartKind,
          columnStats,
          suggestion.xField,
          suggestion.yField,
          suggestion.colorField,
          tableName,
        );
        if (rec) {
          setActiveChart(rec, { fromAI: true, aiReason: suggestion.reason });
          setPanelTab("chart");
          setToast(suggestion.reason ? `AI: ${suggestion.reason}` : "AI chart applied");
          return;
        }
      }
      if (bestSuggestion) {
        setActiveChart(bestSuggestion);
        setPanelTab("chart");
        setToast("Ollama unavailable — applied best scored chart");
      } else {
        setToast("Ollama unavailable. Start it locally, then try again.");
      }
    } finally {
      setAiSuggesting(false);
    }
  }, [columnStats, tableName, activeChart, bestSuggestion, setActiveChart, setPanelTab, setToast]);
  const handleTitleStartEdit = useCallback(() => {
    if (!activeChart) return;
    setTitleEditValue(displayTitle);
    setTitleEditing(true);
  }, [activeChart, displayTitle]);

  const handleTitleSave = useCallback(() => {
    if (!activeChart) return;
    const v = titleEditValue.trim();
    setChartTitleOverride(activeChart.id, v || null);
    setTitleEditing(false);
  }, [activeChart, titleEditValue, setChartTitleOverride]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSave();
      if (e.key === "Escape") {
        setTitleEditValue(displayTitle);
        setTitleEditing(false);
      }
    },
    [handleTitleSave, displayTitle],
  );

  const handleRefresh = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const canvas2D = canvas2DRef.current;
    const axesOverlay = axesOverlayRef.current;
    if (container && canvas && canvas2D && axesOverlay) {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const dpr = stageDpr();
        const w = Math.round(width * dpr);
        const h = Math.round(height * dpr);
        [canvas, canvas2D, axesOverlay].forEach((c) => {
          c.width = w;
          c.height = h;
          c.style.width = `${width}px`;
          c.style.height = `${height}px`;
        });
        setCanvasSized(true);
      }
    }
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

      // Tooltip link (L)
      if (e.key === "l" || e.key === "L") {
        if (tooltipLink) {
          e.preventDefault();
          setTooltipLink(null);
          return;
        }
        const chart = activeChart;
        const rows = sampleRows?.rows;
        const cols = sampleRows?.columns;
        if (!chart || !rows || !cols) return;
        const tt = scatterTooltip ?? chartTooltip;
        if (!tt) return;
        const keyField = chart.tooltipKeyField ?? chart.xField;
        const kidx = cols.indexOf(keyField);
        if (kidx < 0) return;
        const rawRow = rows[tt.rowIndex];
        if (!rawRow) return;
        e.preventDefault();
        setTooltipLink({ field: keyField, value: String(rawRow[kidx] ?? "") });
        return;
      }

      if (!activeChart || activeChart.kind !== "scatter") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_" || e.key === "0") {
        e.preventDefault();
        if (e.key === "0") {
          setScatterView({ scale: 1, panX: 0, panY: 0 });
          return;
        }
        const zoomOut = e.key === "-" || e.key === "_";
        setScatterView((v) => {
          const d = scatterDataRef.current;
          const newScale = Math.max(0.5, Math.min(20, v.scale * (zoomOut ? 0.85 : 1.18)));
          if (!d) return { ...v, scale: newScale };
          const bounds = getEffectiveScatterBounds(d, v);
          const midX = (bounds.xMin + bounds.xMax) / 2;
          const midY = (bounds.yMin + bounds.yMax) / 2;
          const cx = (d.xMin + d.xMax) / 2;
          const cy = (d.yMin + d.yMax) / 2;
          return { scale: newScale, panX: midX - cx, panY: midY - cy };
        });
        return;
      }

      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        const d = scatterDataRef.current;
        if (!d) return;
        const step = e.shiftKey ? 0.12 : 0.05;
        const spanX = (d.xMax - d.xMin) * step;
        const spanY = (d.yMax - d.yMin) * step;
        setScatterView((v) => {
          let { panX, panY } = v;
          if (e.key === "ArrowLeft") panX -= spanX / v.scale;
          if (e.key === "ArrowRight") panX += spanX / v.scale;
          if (e.key === "ArrowUp") panY += spanY / v.scale;
          if (e.key === "ArrowDown") panY -= spanY / v.scale;
          return { ...v, panX, panY };
        });
        return;
      }

      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        setChartInteractionMode("pan");
        return;
      }
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        setChartInteractionMode("crosshair");
        return;
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setChartInteractionMode("lasso");
        return;
      }
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setChartInteractionMode("pan");
        setToast("Brush: hold Shift and drag");
        return;
      }
      if (e.key === "Escape") {
        setSelectedRowIndices([]);
        setLassoPoints([]);
        setBrushRect(null);
        setRulerPins([]);
        setCrosshairPos(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tooltipLink,
    setTooltipLink,
    activeChart,
    sampleRows,
    scatterTooltip,
    chartTooltip,
    getEffectiveScatterBounds,
    setChartInteractionMode,
    setToast,
    setSelectedRowIndices,
    setLassoPoints,
    setRulerPins,
    setCrosshairPos,
  ]);

  // Initialize WebGPU — scatter renderer by default; scene renderer when a GPU scene is active.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const kind = activeChart?.kind ?? "";
    const wantScene = isWebGpuDrawableScene(kind);
    const wantCube = kind === "dataCube";

    rendererRef.current?.destroy();
    sceneRendererRef.current?.destroy();
    cubeRendererRef.current?.destroy();
    rendererRef.current = null;
    sceneRendererRef.current = null;
    cubeRendererRef.current = null;
    setGpuReady(false);

    void (async () => {
      if (wantCube) {
        const cubeRenderer = new LoomCubeRenderer();
        cubeRendererRef.current = cubeRenderer;
        const ok = await cubeRenderer.init(canvas);
        if (!cancelled && ok) setGpuReady(true);
        else if (!cancelled) cubeRendererRef.current = null;
      } else if (wantScene) {
        const scene = new LoomSceneRenderer();
        sceneRendererRef.current = scene;
        const ok = await scene.init(canvas);
        if (!cancelled && ok) setGpuReady(true);
        else if (!cancelled) sceneRendererRef.current = null;
      } else {
        const renderer = new LoomRenderer();
        rendererRef.current = renderer;
        const ok = await renderer.init(canvas);
        if (!cancelled && ok) setGpuReady(true);
        else if (!cancelled) rendererRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      sceneRendererRef.current?.destroy();
      cubeRendererRef.current?.destroy();
      rendererRef.current = null;
      sceneRendererRef.current = null;
      cubeRendererRef.current = null;
      setGpuReady(false);
    };
  }, [activeChart?.kind]);

  // Firefly pulse clock
  useEffect(() => {
    if (activeChart?.kind !== "firefly" || !useWebGpuScene) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setSceneTime((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeChart?.kind, useWebGpuScene]);

  // The stage only mounts once a file is selected. A shared #chart= link can
  // land in Chart view before its dataset loads, so the observers below must
  // re-attach when the stage appears (otherwise canvases stay 300×150, blank).
  const stageMounted = !!selectedFile;

  // Measure the stage host so we can fit social / device frames inside it.
  useEffect(() => {
    if (suggestionsExpanded) return;
    const host = stageHostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width < 40 || height < 40) continue;
        setHostSize({ w: width, h: height });
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [suggestionsExpanded, stageMounted]);

  // Resize all three canvases (WebGPU, 2D, axes overlay). Re-attach when chart panel is visible again.
  useEffect(() => {
    if (suggestionsExpanded) return; // chart panel has w-0, skip observer
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const canvas2D = canvas2DRef.current;
    const axesOverlay = axesOverlayRef.current;
    if (!container || !canvas || !canvas2D || !axesOverlay) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        const dpr = stageDpr();
        const w = Math.round(width * dpr);
        const h = Math.round(height * dpr);
        // Assigning width/height clears a canvas even at the same value. The observer
        // re-fires on re-attach with an unchanged size, React skips the redraw (same
        // containerSize), and the chart would stay wiped — so only touch real changes.
        [canvas, canvas2D, axesOverlay].forEach(c => {
          if (c.width !== w) c.width = w;
          if (c.height !== h) c.height = h;
          c.style.width = `${width}px`;
          c.style.height = `${height}px`;
        });
        setCanvasSized(true);
        setContainerSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [suggestionsExpanded, chartFrameSize.width, chartFrameSize.height, socialExportTarget, stageMounted]);

  // Register PNG/SVG export handlers for the Export tab
  useEffect(() => {
    setPngExportHandler(async (): Promise<Blob | null> => {
      const { activeChart: ac, gpuReady: gpu, chartVisualOverrides: overrides } = exportStateRef.current;
      const canvas = canvasRef.current;
      const canvas2D = canvas2DRef.current;
      const axesOverlay = axesOverlayRef.current;
      if (!canvas || !canvas2D || !ac) return null;
      const st = useLoomStore.getState();
      const capturing =
        !!st.previewCapture || !!st.socialExportTarget || st.socialExportReady;
      // Always prefer Canvas 2D during any capture path (WebGPU readback is flaky).
      const useWebGPU =
        !capturing &&
        ac.kind === "scatter" &&
        gpu &&
        (overrides.markShape ?? "circle") === "circle" &&
        !overrides.markStroke &&
        !(overrides.markJitter ?? 0) &&
        !overrides.glowEnabled &&
        !ac.glowField &&
        !ac.outlineField &&
        !ac.opacityField;
      // Prefer the layer that actually holds pixels; size from whichever is ready
      const w = Math.max(canvas2D.width, useWebGPU ? canvas.width : 0);
      const h = Math.max(canvas2D.height, useWebGPU ? canvas.height : 0);
      if (w === 0 || h === 0) return null;
      try {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const ctx = off.getContext("2d");
        if (!ctx) return null;
        const themeUi = getThemeUiColors(st.appSettings.theme);
        ctx.fillStyle = themeUi.bg;
        ctx.fillRect(0, 0, w, h);
        const cubeFrame = ac.kind === "dataCube" ? cubeFrameRef.current : null;
        if (cubeFrame) {
          // Voxels may live on the WebGPU layer — redraw the whole cube on Canvas instead of compositing.
          ctx.save();
          ctx.scale(w / cubeFrame.w, h / cubeFrame.h);
          renderDataCubeCanvas(ctx, cubeFrame.cube, cubeFrame.w, cubeFrame.h, {
            ...cubeFrame.opts,
            camera: cubeFrame.baseCamera,
            centerOf: undefined,
            showLegend: overrides.legendPosition !== "none",
            hovered: null,
          });
          ctx.restore();
        } else {
        // 2D layer first (theme fill / full chart); WebGPU scatter on top; axes last
        try {
          ctx.drawImage(canvas2D, 0, 0);
        } catch {
          /* tainted / lost context */
        }
        if (useWebGPU) {
          try {
            ctx.drawImage(canvas, 0, 0);
          } catch {
            /* WebGPU readback can fail mid-resize */
          }
        }
        if (axesOverlay && axesOverlay.width > 0 && axesOverlay.height > 0) {
          try {
            ctx.drawImage(axesOverlay, 0, 0);
          } catch {
            /* ignore */
          }
        }
        }
        // Attribution burn-in for platform / social PNG exports
        if (st.socialExportTarget) {
          const { drawExportBurnIn } = await import("@/lib/socialExport");
          const sourceLabel = st.selectedFile?.name ?? null;
          drawExportBurnIn(ctx, w, h, {
            burnIn: st.exportBurnIn,
            sourceLabel,
            themeText: themeUi.text,
            themeMuted: themeUi.muted,
            themeBg: themeUi.bg,
          });
        }
        return new Promise<Blob | null>((resolve) => {
          off.toBlob((blob) => resolve(blob), "image/png");
        });
      } catch {
        return null;
      }
    });
    setSvgExportHandler(async (): Promise<string | null> => {
      const { vegaSpec: spec, sampleRows: rows } = exportStateRef.current;
      if (!spec || !rows?.rows?.length) return null;
      try {
        const { compile } = await import("vega-lite");
        const vega = await import("vega");
        const values = rows.rows.map((row) => {
          const obj: Record<string, unknown> = {};
          rows.columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
        // Specs carry dark-theme text colors; an exported file needs the current theme's
        // colors on an opaque background so it reads wherever it's opened.
        const ui = getThemeUiColors(useLoomStore.getState().appSettings.theme);
        const axis = { labelColor: ui.muted, titleColor: ui.text, gridColor: ui.border, domainColor: ui.border, tickColor: ui.border, labelLimit: 180, labelFontSize: 11, titleFontSize: 12 };
        const base = (spec as { config?: Record<string, unknown> }).config ?? {};
        const specWithData = {
          ...spec,
          data: { values },
          config: {
            ...base,
            background: ui.bg,
            axis: { ...(base.axis as object | undefined), ...axis },
            title: { ...(base.title as object | undefined), color: ui.text, subtitleColor: ui.muted },
            legend: { ...(base.legend as object | undefined), labelColor: ui.text, titleColor: ui.text, labelLimit: 180 },
          },
        };
        const compiled = compile(specWithData as Parameters<typeof compile>[0]);
        const view = new vega.View(vega.parse(compiled.spec), { renderer: "none" });
        await view.runAsync();
        const svg = await view.toSVG();
        view.finalize();
        return svg;
      } catch (e) {
        console.warn("SVG export failed:", e);
        return null;
      }
    });
    return () => {
      setPngExportHandler(null);
      setSvgExportHandler(null);
    };
  }, [setPngExportHandler, setSvgExportHandler]);

  const handleScatterPointer = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeChart || activeChart.kind !== "scatter") return;
      const data = scatterDataRef.current;
      const allCols = sampleRowsRef.current?.columns;
      const rows = sampleRowsRef.current?.rows;
      if (!data || !allCols || !rows) {
        setScatterTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const link = useLoomStore.getState().tooltipLink;
      const rect = (e.target as HTMLDivElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { xMin, xMax, yMin, yMax, pad, w, h, points, rowIndices } = data;
      const chartW = w - 2 * pad;
      const chartH = h - 2 * pad;
      if (chartW <= 0 || chartH <= 0) return;
      const scaleX = w / rect.width;
      const scaleY = h / rect.height;
      const px = sx * scaleX;
      const py = sy * scaleY;
      let bestIdx = -1;
      let bestDist = 24;
      for (let i = 0; i < points.length; i++) {
        const rowIndex = rowIndices[i]!;
        if (link && !rowMatchesTooltipLink(allCols, rows[rowIndex]!, link)) continue;
        const p = points[i];
        const ppx = pad + ((p.x - xMin) / (xMax - xMin)) * chartW;
        const ppy = pad + (1 - (p.y - yMin) / (yMax - yMin)) * chartH;
        const d = Math.hypot(px - ppx, py - ppy);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const rowIndex = rowIndices[bestIdx];
        const rawRow = rows[rowIndex];
        if (rawRow) {
          const names = resolveTooltipFieldNames(activeChart, allCols);
          const proj = projectRowForTooltip(allCols, rawRow, names);
          setScatterTooltip({
            clientX: e.clientX,
            clientY: e.clientY,
            rowIndex,
            row: proj.row,
            columns: proj.columns,
          });
          setHoveredRowIndex(rowIndex);
        } else {
          setScatterTooltip(null);
          setHoveredRowIndex(null);
        }
      } else {
        setScatterTooltip(null);
        setHoveredRowIndex(null);
      }
    },
    [activeChart, setHoveredRowIndex],
  );

  const handleScatterPointerLeave = useCallback(() => {
    setScatterTooltip(null);
    setHoveredRowIndex(null);
  }, [setHoveredRowIndex]);

  const handleCanvas2DPointerMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hit = canvas2DHitRef.current;
      const ac = activeChart;
      const sr = sampleRowsRef.current;
      if (ac?.kind === "dataCube") {
        const frame = cubeFrameRef.current;
        const el = containerRef.current;
        if (!frame || !el || sceneOrbitDragRef.current) {
          setChartTooltip(null);
          setCubeHover(null);
          return;
        }
        const rect = el.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * frame.w;
        const py = ((e.clientY - rect.top) / rect.height) * frame.h;
        const cell = pickDataCubeCell(frame.cube, cubeView(frame.opts.camera, frame.w, frame.h), px, py, frame.opts);
        if (!cell) {
          setChartTooltip(null);
          setCubeHover(null);
          setHoveredRowIndex(null);
          return;
        }
        const tip = cubeCellTooltip(frame.cube, cell);
        setChartTooltip({ clientX: e.clientX, clientY: e.clientY, rowIndex: cell.rowIndex, row: tip.row, columns: tip.columns });
        setCubeHover((prev) =>
          prev && prev.xi === cell.xi && prev.yi === cell.yi && prev.zi === cell.zi ? prev : { xi: cell.xi, yi: cell.yi, zi: cell.zi },
        );
        return;
      }
      if (!hit || !containerRef.current || !ac || !sr?.rows.length) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const scaleX = hit.w / rect.width;
      const scaleY = hit.h / rect.height;
      const chartX = relX * scaleX;
      const chartY = relY * scaleY;
      const { pad, w, h } = hit;
      if (chartX < pad || chartX > w - pad || chartY < pad || chartY > h - pad) {
        setChartTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const link = useLoomStore.getState().tooltipLink;
      const allowed = allowedRowIndices(sr.rows, sr.columns, link);
      // Registered marks resolve against the full sample (density kinds paint a subsample)
      const target = hit.targets?.length ? pickHitTarget(hit.targets, chartX, chartY) : null;
      const rowIdx = hit.targets?.length
        ? (target ? rowForHitTarget(target, sr.rows, allowed) : null)
        : pickCanvasTooltipRowIndex(hit, chartX, chartY, allowed);
      if (rowIdx == null) {
        setChartTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const rawRow = sr.rows[rowIdx]!;
      // Aggregated marks (bars, slices, bins…) read out their own value, not one raw row
      const proj = target?.summary ?? projectRowForTooltip(sr.columns, rawRow, resolveTooltipFieldNames(ac, sr.columns));
      setChartTooltip({
        clientX: e.clientX,
        clientY: e.clientY,
        rowIndex: rowIdx,
        row: proj.row,
        columns: proj.columns,
      });
      setHoveredRowIndex(rowIdx);
    },
    [activeChart, setHoveredRowIndex],
  );
  const handleCanvas2DPointerLeave = useCallback(() => {
    setChartTooltip(null);
    setCubeHover(null);
    setHoveredRowIndex(null);
  }, [setHoveredRowIndex]);

  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(null);
  /** Last pointer type on the scatter overlay — a finger tap shows a tooltip but never pins one. */
  const lastPointerTypeRef = useRef<string>("mouse");

  const touchDistance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const applyPinchZoom = useCallback(
    (clientX: number, clientY: number, newScale: number, baseScale: number) => {
      const d = scatterDataRef.current;
      const el = overlayRef.current;
      if (!d || !el || baseScale <= 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = ((clientX - rect.left) / rect.width) * d.w;
      const py = ((clientY - rect.top) / rect.height) * d.h;
      const chartW = d.w - 2 * d.pad;
      const chartH = d.h - 2 * d.pad;
      if (chartW <= 0 || chartH <= 0) return;
      setScatterView((v) => {
        const bounds = getEffectiveScatterBounds(d, { ...v, scale: baseScale });
        const t = (px - d.pad) / chartW;
        const u = (py - d.pad) / chartH;
        const dataX = bounds.xMin + t * (bounds.xMax - bounds.xMin);
        const dataY = bounds.yMax - u * (bounds.yMax - bounds.yMin);
        const scale = Math.max(0.5, Math.min(20, newScale));
        const cx = (d.xMin + d.xMax) / 2;
        const cy = (d.yMin + d.yMax) / 2;
        const halfX = (d.xMax - d.xMin) / 2;
        const halfY = (d.yMax - d.yMin) / 2;
        return {
          scale,
          panX: dataX - cx - (halfX / scale) * (2 * t - 1),
          panY: dataY - cy - (halfY / scale) * (1 - 2 * u),
        };
      });
    },
    [getEffectiveScatterBounds],
  );

  useEffect(() => {
    const endPan = () => {
      if (panStartRef.current) {
        panStartRef.current = null;
        setIsPanning(false);
      }
    };
    window.addEventListener("mouseup", endPan);
    window.addEventListener("blur", endPan);
    return () => {
      window.removeEventListener("mouseup", endPan);
      window.removeEventListener("blur", endPan);
    };
  }, []);

  const handleScatterWheel = useCallback(
    (e: WheelEvent) => {
      if (!activeChart || activeChart.kind !== "scatter") return;
      e.preventDefault();
      const d = scatterDataRef.current;
      const el = overlayRef.current;
      if (!d || !el) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = ((e.clientX - rect.left) / rect.width) * d.w;
      const py = ((e.clientY - rect.top) / rect.height) * d.h;
      const chartW = d.w - 2 * d.pad;
      const chartH = d.h - 2 * d.pad;
      if (chartW <= 0 || chartH <= 0) return;

      // Pinch (ctrl+wheel) or discrete mouse wheel → zoom toward cursor.
      // Trackpad two-finger scroll → pan the view.
      const looksLikeMouseWheel =
        e.deltaMode === 1 ||
        (e.deltaMode === 0 && Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);
      const doZoom = e.ctrlKey || e.metaKey || looksLikeMouseWheel;

      if (doZoom) {
        const zoomOut = e.deltaY > 0;
        setScatterView((v) => {
          const bounds = getEffectiveScatterBounds(d, v);
          const t = (px - d.pad) / chartW;
          const u = (py - d.pad) / chartH;
          const dataX = bounds.xMin + t * (bounds.xMax - bounds.xMin);
          const dataY = bounds.yMax - u * (bounds.yMax - bounds.yMin);
          const factor = zoomOut ? 0.9 : 1.11;
          const newScale = Math.max(0.5, Math.min(20, v.scale * factor));
          const cx = (d.xMin + d.xMax) / 2;
          const cy = (d.yMin + d.yMax) / 2;
          const halfX = (d.xMax - d.xMin) / 2;
          const halfY = (d.yMax - d.yMin) / 2;
          const panX = dataX - cx - (halfX / newScale) * (2 * t - 1);
          const panY = dataY - cy - (halfY / newScale) * (1 - 2 * u);
          return { scale: newScale, panX, panY };
        });
        return;
      }

      const dataPerPxX = (d.xMax - d.xMin) / chartW;
      const dataPerPxY = (d.yMax - d.yMin) / chartH;
      setScatterView((v) => ({
        ...v,
        panX: v.panX + (e.deltaX * dataPerPxX) / v.scale,
        panY: v.panY - (e.deltaY * dataPerPxY) / v.scale,
      }));
    },
    [activeChart, getEffectiveScatterBounds],
  );
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleScatterWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleScatterWheel);
  }, [handleScatterWheel]);
  const handleScatterMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeChart || activeChart.kind !== "scatter" || e.button !== 0) return;
      if (chartInteractionMode === "lasso" || e.shiftKey) {
        brushStartRef.current = { x: e.clientX, y: e.clientY };
        if (chartInteractionMode === "lasso") {
          setLassoPoints([{ x: e.clientX, y: e.clientY }]);
        } else {
          setBrushRect({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
        }
      } else if (chartInteractionMode === "crosshair") {
        /* crosshair click pins a ruler point */
        if (crosshairPos) {
          setRulerPins([...rulerPins, { x: crosshairPos.dataX, y: crosshairPos.dataY }].slice(-2));
        }
      } else {
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setIsPanning(true);
      }
    },
    [activeChart, chartInteractionMode, crosshairPos, rulerPins, setRulerPins]
  );
  const handleScatterMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (brushStartRef.current && chartInteractionMode === "lasso") {
        setLassoPoints([...lassoPoints, { x: e.clientX, y: e.clientY }]);
        return;
      }
      if (brushStartRef.current) {
        setBrushRect((r) => (r ? { ...r, x2: e.clientX, y2: e.clientY } : null));
        return;
      }
      if (chartInteractionMode === "crosshair" && containerRef.current) {
        const data = scatterDataRef.current;
        if (data) {
          const rect = containerRef.current.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const { xMin, xMax, yMin, yMax, pad, w, h } = data;
          const chartW = w - 2 * pad;
          const chartH = h - 2 * pad;
          const scaleX = w / rect.width;
          const scaleY = h / rect.height;
          const px = sx * scaleX;
          const py = sy * scaleY;
          if (chartW > 0 && chartH > 0 && px >= pad && px <= w - pad && py >= pad && py <= h - pad) {
            const dataX = xMin + ((px - pad) / chartW) * (xMax - xMin);
            const dataY = yMax - ((py - pad) / chartH) * (yMax - yMin);
            setCrosshairPos({ dataX, dataY, screenX: e.clientX, screenY: e.clientY });
          } else {
            setCrosshairPos(null);
          }
        }
      }
      handleScatterPointer(e);
      if (panStartRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        const d = scatterDataRef.current;
        if (d) {
          const cw = d.w - 2 * d.pad;
          const ch = d.h - 2 * d.pad;
          const dataPerPxX = cw > 0 ? (d.xMax - d.xMin) / cw : 0;
          const dataPerPxY = ch > 0 ? (d.yMax - d.yMin) / ch : 0;
          setScatterView((v) => ({
            ...v,
            panX: v.panX + (dx * dataPerPxX) / v.scale,
            panY: v.panY - (dy * dataPerPxY) / v.scale,
          }));
        }
      }
    },
    [handleScatterPointer, chartInteractionMode, lassoPoints, setLassoPoints, setCrosshairPos],
  );
  const handleScatterMouseUp = useCallback(() => {
    setIsPanning(false);
    if (brushStartRef.current && chartInteractionMode === "lasso" && lassoPoints.length > 2 && containerRef.current) {
      const data = scatterDataRef.current;
      if (data) {
        const rect = containerRef.current.getBoundingClientRect();
        const { points, rowIndices, xMin, xMax, yMin, yMax, pad, w, h } = data;
        const chartW = w - 2 * pad;
        const chartH = h - 2 * pad;
        const scaleX = w / rect.width;
        const scaleY = h / rect.height;
        const polyPx = lassoPoints.map((p) => ({
          x: (p.x - rect.left) * scaleX,
          y: (p.y - rect.top) * scaleY,
        }));
        const sel: number[] = [];
        points.forEach((p, i) => {
          const px = pad + ((p.x - xMin) / (xMax - xMin || 1)) * chartW;
          const py = pad + (1 - (p.y - yMin) / (yMax - yMin || 1)) * chartH;
          if (pointInPolygon(px, py, polyPx)) sel.push(rowIndices[i]);
        });
        setSelectedRowIndices(sel);
        setToast(sel.length > 0 ? `${sel.length} point(s) lassoed` : "No points in lasso");
      }
      brushStartRef.current = null;
      setLassoPoints([]);
      return;
    }
    const br = brushRectRef.current;
    if (brushStartRef.current && br && containerRef.current) {
      const data = scatterDataRef.current;
      if (data) {
        const rect = containerRef.current.getBoundingClientRect();
        const { points, rowIndices, xMin, xMax, yMin, yMax, pad, w, h } = data;
        const chartW = w - 2 * pad;
        const chartH = h - 2 * pad;
        const scaleX = w / rect.width;
        const scaleY = h / rect.height;
        const px1 = (Math.min(br.x1, br.x2) - rect.left) * scaleX;
        const px2 = (Math.max(br.x1, br.x2) - rect.left) * scaleX;
        const py1 = (Math.min(br.y1, br.y2) - rect.top) * scaleY;
        const py2 = (Math.max(br.y1, br.y2) - rect.top) * scaleY;
        const dataX1 = xMin + ((px1 - pad) / chartW) * (xMax - xMin);
        const dataX2 = xMin + ((px2 - pad) / chartW) * (xMax - xMin);
        const dataY2 = yMax - ((py1 - pad) / chartH) * (yMax - yMin);
        const dataY1 = yMax - ((py2 - pad) / chartH) * (yMax - yMin);
        const sel: number[] = [];
        points.forEach((p, i) => {
          if (p.x >= Math.min(dataX1, dataX2) && p.x <= Math.max(dataX1, dataX2) && p.y >= Math.min(dataY1, dataY2) && p.y <= Math.max(dataY1, dataY2)) {
            sel.push(rowIndices[i]);
          }
        });
        setSelectedRowIndices(sel);
        setToast(sel.length > 0 ? `${sel.length} point(s) selected` : "No points in brush");
      }
      brushStartRef.current = null;
      setBrushRect(null);
    }
    panStartRef.current = null;
  }, [setSelectedRowIndices, setToast, chartInteractionMode, lassoPoints, setLassoPoints]);

  const extractScatterData = useCallback((): { points: GPUScatterPoint[]; rowIndices: number[]; xMin: number; xMax: number; yMin: number; yMax: number } | null => {
    if (!sampleRows || !activeChart) return null;
    const spec = activeChart.spec as Record<string, unknown>;
    const encoding = spec.encoding as Record<string, { field: string }> | undefined;
    const xFieldName = encoding?.x?.field ?? activeChart.xField;
    const yFieldName = encoding?.y?.field ?? activeChart.yField;
    if (!xFieldName || !yFieldName) return null;

    const xIdx = sampleRows.columns.indexOf(xFieldName);
    const yIdx = sampleRows.columns.indexOf(yFieldName);
    const colorField =
      (encoding?.color as { field?: string } | undefined)?.field ?? activeChart.colorField ?? undefined;
    const sizeField = (encoding?.size as { field?: string } | undefined)?.field ?? activeChart.sizeField;
    const cIdx = colorField ? sampleRows.columns.indexOf(colorField) : -1;
    const sizeIdx = sizeField ? sampleRows.columns.indexOf(sizeField) : -1;
    if (xIdx === -1 || yIdx === -1) return null;

    let sizeMin = Infinity, sizeMax = -Infinity;
    if (sizeIdx >= 0) {
      for (const row of sampleRows.rows) {
        const v = Number(row[sizeIdx]);
        if (!isNaN(v)) { sizeMin = Math.min(sizeMin, v); sizeMax = Math.max(sizeMax, v); }
      }
      if (sizeMin === sizeMax) { sizeMin = sizeMin - 1; sizeMax = sizeMax + 1; }
    }
    const sizeRange = sizeMax - sizeMin || 1;

    const catMap = new Map<string, number>();
    let nextCat = 0;
    const points: GPUScatterPoint[] = [];
    const rowIndices: number[] = [];
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

    sampleRows.rows.forEach((row, rowIndex) => {
      const x = Number(row[xIdx]), y = Number(row[yIdx]);
      if (isNaN(x) || isNaN(y)) return;
      let cat = 0;
      if (cIdx >= 0) {
        const k = String(row[cIdx]);
        if (!catMap.has(k)) catMap.set(k, nextCat++);
        cat = catMap.get(k)!;
      }
      let size: number | undefined;
      if (sizeIdx >= 0) {
        const s = Number(row[sizeIdx]);
        size = isNaN(s) ? undefined : (s - sizeMin) / sizeRange;
      }
      points.push({ x, y, category: cat, size });
      rowIndices.push(rowIndex);
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    });
    if (points.length === 0) return null;
    const xPad = (xMax - xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || 1;
    return { points, rowIndices, xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
  }, [sampleRows, activeChart]);

  // Render active chart
  useEffect(() => {
    if (!canvasSized || !activeChart || !sampleRows) return;
    if (activeChart.kind !== "scatter") scatterDataRef.current = null;
    if (activeChart.kind !== "dataCube") cubeFrameRef.current = null;

    // Data cube: back walls on 2D canvas → voxels on WebGPU (or 2D) → labels on the overlay
    if (activeChart.kind === "dataCube") {
      canvas2DHitRef.current = null;
      const canvas2D = canvas2DRef.current;
      const overlay = axesOverlayRef.current;
      const ctx = canvas2D?.getContext("2d");
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
        ctx.font = `12px ${chartVisualOverrides.fontFamily ?? "Inter"}, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("No rows land in the cube — try other Rows / Columns / Depth fields", w / 2, h / 2);
        ctx.textAlign = "left";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        return;
      }
      const tr = cubeTransitionRef.current;
      const animating = !!tr && tr.cube === dataCube && cubeAnim < 1;
      const ease = 1 - Math.pow(1 - cubeAnim, 3);
      const centerOf = animating
        ? (cell: DataCube["cells"][number]): [number, number, number] => {
            const to = cubeCellCenter(dataCube, cell.xi, cell.yi, cell.zi);
            const from = tr!.from.get(cubeCellKey(dataCube, cell));
            if (!from) return to;
            return [from[0] + (to[0] - from[0]) * ease, from[1] + (to[1] - from[1]) * ease, from[2] + (to[2] - from[2]) * ease];
          }
        : undefined;
      // Docked pivot table covers the lower ~44% — lift and shrink the cube into the space above.
      const camera = cubeTableOpen && !forceCanvasCapture
        ? { ...sceneOrbit, zoom: sceneOrbit.zoom * 0.7, offsetY: 0.45 }
        : sceneOrbit;
      const cubeOpts: DataCubeRenderOpts = {
        ramp: continuousStops,
        opacity,
        camera,
        slice: cubeSlice,
        centerOf,
        fontFamily: chartVisualOverrides.fontFamily ?? "Inter",
        themeText: themeUi.text,
        themeMuted: themeUi.muted,
        themeBorder: themeUi.border,
        themeBg: themeUi.bg,
        // The HTML pivot bar carries the legend live; Canvas draws it only for capture / export.
        showLegend: chartVisualOverrides.legendPosition !== "none" && (forceCanvasCapture || !!socialExportReady),
        hovered: cubeHover,
      };
      cubeFrameRef.current = { cube: dataCube, opts: cubeOpts, w, h, baseCamera: sceneOrbit };
      if (useWebGpuCube && cubeRendererRef.current && octx) {
        const view = cubeView(camera, w, h);
        ctx.fillStyle = themeUi.bg;
        ctx.fillRect(0, 0, w, h);
        const far = drawDataCubeBackLayer(ctx, dataCube, view, cubeOpts);
        cubeRendererRef.current.render(dataCube, view, continuousStops, opacity, cubeOpts);
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawDataCubeFrontLayer(octx, dataCube, view, far, cubeOpts);
        octx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        renderDataCubeCanvas(ctx, dataCube, w, h, cubeOpts);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    // WebGPU particle / 3D scenes (scatter3d, firefly) + live globe points
    if (
      (useWebGpuScene && isWebGpuDrawableScene(activeChart.kind) && sceneRendererRef.current) ||
      (useWebGpuGlobe && isWebGpuGlobeKind(activeChart.kind) && sceneRendererRef.current)
    ) {
      const canvas2D = canvas2DRef.current;
      if (canvas2D) {
        const ctx = canvas2D.getContext("2d");
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
      const packed = extractGpuScenePoints(
        sampleRows.rows,
        sampleRows.columns,
        {
          xField: activeChart.xField,
          yField: activeChart.yField,
          zField: activeChart.zField,
          colorField: activeChart.colorField,
          sizeField: activeChart.sizeField,
          timeField: activeChart.timeField,
          trailId: activeChart.trailId,
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
        sceneRendererRef.current.uploadData(packed.points, packed, {
          pointSize: pointSize * (activeChart.kind === "firefly" ? 1.4 : activeChart.kind === "globe" ? 1.6 : 1),
          opacity,
          sizeScale: chartVisualOverrides.sizeScale ?? 1,
          palette: colors,
          clearColor: hexToRgb01(themeUi.bg),
          yaw: sceneOrbit.yaw,
          pitch: sceneOrbit.pitch,
          zoom: sceneOrbit.zoom,
          mode,
          time: sceneTime,
        });
        sceneRendererRef.current.setCamera(sceneOrbit.yaw, sceneOrbit.pitch, sceneOrbit.zoom);
        sceneRendererRef.current.setTime(sceneTime);
        sceneRendererRef.current.render(w, h);
      }
      return;
    }

    const useWebGPU = useWebGPUScatter;
    if (useWebGPU) {
      canvas2DHitRef.current = null;
      // Scatter: clear 2D canvas to theme bg so it never shows through, then draw with WebGPU
      const canvas2D = canvas2DRef.current;
      if (canvas2D) {
        const ctx = canvas2D.getContext("2d");
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
      const sd = extractScatterData();
      if (sd && rendererRef.current) {
        const canvas = canvasRef.current;
        const dpr = stageDpr();
        const w = canvas ? canvas.width / dpr : 800;
        const h = canvas ? canvas.height / dpr : 600;
        const pad = resolveChartPad({
          kind: "scatter",
          width: w,
          height: h,
          basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
          titleLayout: chartRenderOpts.titleLayout,
          tickRotation: chartRenderOpts.tickRotation,
          chartFrame: chartRenderOpts.chartFrame,
          isCompact,
          legendPosition: chartRenderOpts.legendPosition,
          axisFontSize: chartRenderOpts.axisFontSize,
        });
        const subPts = subsampleRowsForDensity(sd.points, 4500, scatterView.scale);
        const subIdx = subsampleRowsForDensity(sd.rowIndices, 4500, scatterView.scale);
        const marks = densityAwarePointMarks({
          n: subPts.rows.length,
          plotW: Math.max(1, w - 2 * pad),
          plotH: Math.max(1, h - 2 * pad),
          hasSizeEncoding: !!activeChart.sizeField,
          sizeScale: chartVisualOverrides.sizeScale ?? 1,
          pointSize,
          opacity,
          opacityUserSet: typeof chartVisualOverrides.opacity === "number",
        });
        const eff = getEffectiveScatterBounds(sd, scatterView);
        rendererRef.current.uploadData(subPts.rows, {
          pointSize: marks.maxR * 2,
          opacity: marks.opacity,
          sizeScale: 1,
          palette: colors,
          clearColor: hexToRgb01(themeUi.bg),
        });
        rendererRef.current.render(eff.xMin, eff.xMax, eff.yMin, eff.yMax);
        if (canvas) {
          scatterDataRef.current = {
            points: subPts.rows,
            rowIndices: subIdx.rows,
            ...eff,
            pad,
            w,
            h,
            columns: sampleRows.columns,
          };
        }
      }
      return;
    }

    // Non-scatter: clear WebGPU canvas so old scatter never shows through, then draw with 2D
    rendererRef.current?.clearCanvas();

    // Canvas 2D for bar, histogram, line, heatmap, strip (and scatter when WebGPU unavailable)
    const canvas2D = canvas2DRef.current;
    if (!canvas2D) return;
    const ctx = canvas2D.getContext("2d");
    if (!ctx) return;

    const dpr = stageDpr();
    const cw = (canvas2D as HTMLCanvasElement).width;
    const ch = (canvas2D as HTMLCanvasElement).height;
    if (typeof cw !== "number" || typeof ch !== "number" || cw <= 0 || ch <= 0) return;
    const w = cw / dpr;
    const h = ch / dpr;

    const rowsAll = sampleRows?.rows;
    const cols = sampleRows?.columns;
    if (!Array.isArray(rowsAll) || !Array.isArray(cols)) return;

    const zoomScale = activeChart.kind === "scatter" ? scatterView.scale : 1;
    const densityKinds =
      activeChart.kind === "scatter" || activeChart.kind === "bubble" || activeChart.kind === "hexbin" || activeChart.kind === "parallel";
    const sub = densityKinds
      ? subsampleRowsForDensity(rowsAll, 3500, zoomScale)
      : { rows: rowsAll, sampled: false, shown: rowsAll.length, total: rowsAll.length };
    const rows = sub.rows;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const opts = chartRenderOpts;
    const pad = resolveChartPad({
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
    });
    const xIdx = cols.indexOf(activeChart.xField);
    const yIdx = activeChart.yField ? cols.indexOf(activeChart.yField) : -1;
    const cIdx = activeChart.colorField ? cols.indexOf(activeChart.colorField) : -1;
    const sizeIdx = activeChart.sizeField ? cols.indexOf(activeChart.sizeField) : -1;
    const glowIdx = activeChart.glowField ? cols.indexOf(activeChart.glowField) : -1;
    const outlineIdx = activeChart.outlineField ? cols.indexOf(activeChart.outlineField) : -1;
    const opacityIdx = activeChart.opacityField ? cols.indexOf(activeChart.opacityField) : -1;
    if (xIdx === -1) return;

    const fontFamily = opts.fontFamily ?? "Inter";

    const drawOneFrame = (clipProgress: number) => {
      try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawChartBackground(ctx, w, h, opts.backgroundStyle, opts.themeBg);
        if (clipProgress < 1) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w * clipProgress, h);
          ctx.clip();
        }
        ctx.globalCompositeOperation = (opts.blendMode as GlobalCompositeOperation) ?? "source-over";

        // Per-paint scratch: renderers register hover targets + the series they colored
        const hits: HitTarget[] = [];
        const ropts: ChartRenderOpts = {
          ...opts,
          hits,
          fieldNames: cols,
          legend: null,
          scales: null,
          connectTrail: connectScatterTrail,
          showMarginals,
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
        const barHorizontal = !!barModel && barsShouldBeHorizontal(ctx, barModel, w, h, pad, opts);

        // Only true x/y charts get the shared L-frame; band-gutter charts draw their own
        const framed = !useFacets && FRAMED_KINDS.has(kind) && !barHorizontal;
        if (framed) drawAxisFrame(ctx, w, h, pad, opts);
        if (!useFacets && (FRAMED_KINDS.has(kind) || OWN_FRAME_KINDS.has(kind))) {
          const measure = valueTitle(ropts, yIdx, kind === "line" ? "mean" : "sum");
          const yTitle =
            kind === "bar" || kind === "line" || kind === "area" || kind === "waterfall" || kind === "lollipop"
              ? measure
              : kind === "histogram"
                ? "Count"
                : activeChart.yField;
          if (barHorizontal || kind === "lollipop") {
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
            titleLayout: opts.titleLayout,
            fontFamily,
            titleFontWeight: opts.titleFontWeight,
            titleItalic: opts.titleItalic,
            themeText: opts.themeText,
            themeMuted: opts.themeMuted,
            themeBorder: opts.themeBorder,
            axisLabelColor: opts.axisLabelColor,
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
            scatterDataRef.current = { ...sd, ...scatterViewBounds, pad, w, h, columns: cols };
          }
        }

        if (useFacets) {
          const titleBand = Math.min(56, h * 0.12);
          const cells = layoutFacetCells(facetPanels, pad * 0.35, titleBand, w - pad * 0.7, h - titleBand - pad * 0.35);
          const miniPad = Math.max(18, Math.min(36, Math.min(cells[0]?.w ?? 80, cells[0]?.h ?? 80) * 0.18));
          const labelH = 14;
          for (let fi = 0; fi < cells.length; fi++) {
            const cell = cells[fi]!;
            const panel = facetPanels[fi]!;
            const cellHits: HitTarget[] = [];
            const cellOpts: ChartRenderOpts = { ...ropts, hits: cellHits, legend: null, scales: null };
            const cw = cell.w;
            const ch = Math.max(40, cell.h - labelH);
            ctx.save();
            ctx.beginPath();
            ctx.rect(cell.x, cell.y, cell.w, cell.h);
            ctx.clip();
            ctx.translate(cell.x, cell.y);
            ctx.fillStyle = opts.themeMuted ?? "#6b6b78";
            ctx.font = `600 10px ${fontFamily}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const label = panel.key.length > 28 ? `${panel.key.slice(0, 27)}…` : panel.key;
            ctx.fillText(label, 2, 1);
            ctx.translate(0, labelH);
            if (kind === "bar") {
              let bf: ReturnType<typeof buildBarFacetGrid> | undefined;
              let bm: BarModel | undefined;
              if (barColorIdx >= 0) {
                bf = buildBarFacetGrid(panel.rows, xIdx, yIdx, barColorIdx, barAgg, opts.barStackMode ?? "grouped", topN) ?? undefined;
              }
              if (!bf) bm = computeBarModel(panel.rows, xIdx, yIdx, barAgg, topN);
              const horiz = !!bm && barsShouldBeHorizontal(ctx, bm, cw, ch, miniPad, cellOpts);
              renderFullBar(ctx, panel.rows, xIdx, yIdx, barColorIdx, cw, ch, miniPad, cellOpts, bf, horiz, bm, cIdx >= 0 && cIdx === xIdx);
            } else if (kind === "line") {
              renderFullLine(ctx, panel.rows, xIdx, yIdx, cIdx, cw, ch, miniPad, cellOpts, y2Idx);
            } else if (kind === "area") {
              renderFullArea(ctx, panel.rows, xIdx, yIdx, cIdx, cw, ch, miniPad, cellOpts, y2Idx);
            } else if (kind === "scatter" || kind === "bubble") {
              renderFullScatter(ctx, panel.rows, xIdx, yIdx, cIdx, sizeIdx, cw, ch, miniPad, cellOpts, {
                glowIdx,
                outlineIdx,
                opacityIdx,
              });
            }
            ctx.restore();
            offsetHitTargets(cellHits, cell.x, cell.y + labelH);
            hits.push(...cellHits);
            if (fi === 0 && cellOpts.legend) ropts.legend = cellOpts.legend;
            if (fi === 0 && cellOpts.scales) ropts.scales = cellOpts.scales;
          }
        }

        if (!useFacets) switch (activeChart.kind) {
          case "scatter":
            renderFullScatter(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, ropts, {
              glowIdx,
              outlineIdx,
              opacityIdx,
            }, smartResults?.clusters?.rowToCluster ?? undefined, scatterViewBounds);
            break;
          case "bar": renderFullBar(ctx, rows, xIdx, yIdx, barColorIdx, w, h, pad, ropts, barFacetPayload, barHorizontal, barModel, cIdx >= 0 && cIdx === xIdx); break;
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
                colorField: activeChart.colorField,
                sizeField: activeChart.sizeField,
              },
              w,
              h,
              pad,
              {
                colors: opts.colors,
                opacity: opts.opacity,
                fontFamily: opts.fontFamily,
                themeText: opts.themeText,
                themeMuted: opts.themeMuted,
                themeBorder: opts.themeBorder,
                themeBg: opts.themeBg,
                pointSize: opts.pointSize,
                yAggregate: opts.yAggregate,
                continuousStops: opts.continuousStops,
                yaw: sceneOrbit.yaw,
                pitch: sceneOrbit.pitch,
                zoom: sceneOrbit.zoom,
              },
            );
            break;
          case "forceBubble": renderFullForceBubble(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
          case "sankey": renderFullSankey(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, ropts); break;
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
                  colorField: activeChart.colorField,
                  sizeField: activeChart.sizeField,
                },
                w,
                h,
                pad,
                {
                  colors: opts.colors,
                  opacity: opts.opacity,
                  fontFamily: opts.fontFamily,
                  themeText: opts.themeText,
                  themeMuted: opts.themeMuted,
                  themeBorder: opts.themeBorder,
                  themeBg: opts.themeBg,
                  pointSize: opts.pointSize,
                  yAggregate: opts.yAggregate,
                  continuousStops: opts.continuousStops,
                  yaw: sceneOrbit.yaw,
                  pitch: sceneOrbit.pitch,
                  zoom: sceneOrbit.zoom,
                },
              );
            } else if (isGpuSceneKind(activeChart.kind)) {
              const packed = extractGpuScenePoints(
                rows,
                cols,
                {
                  xField: activeChart.xField,
                  yField: activeChart.yField,
                  zField: activeChart.zField,
                  colorField: activeChart.colorField,
                  sizeField: activeChart.sizeField,
                  timeField: activeChart.timeField,
                  trailId: activeChart.trailId,
                },
              );
              if (packed) {
                renderGpuSceneCanvas(activeChart.kind, ctx, packed, w, h, pad, {
                  colors: opts.colors,
                  opacity: opts.opacity,
                  fontFamily: opts.fontFamily,
                  themeText: opts.themeText,
                  themeMuted: opts.themeMuted,
                  themeBorder: opts.themeBorder,
                  themeBg: opts.themeBg,
                  pointSize: opts.pointSize,
                  yaw: sceneOrbit.yaw,
                  pitch: sceneOrbit.pitch,
                  zoom: sceneOrbit.zoom,
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
                  opacity: opts.opacity,
                  fontFamily: opts.fontFamily,
                  axisLabelColor: opts.axisLabelColor,
                  themeText: opts.themeText,
                  themeMuted: opts.themeMuted,
                  themeBorder: opts.themeBorder,
                  showDataLabels: opts.showDataLabels,
                  pointSize: opts.pointSize,
                  continuousStops: opts.continuousStops,
                  yAggregate: opts.yAggregate,
                  themeBg: opts.themeBg,
                  legendPosition: opts.legendPosition,
                },
                false,
              );
            }
            break;
        }
        if (paintsOwnBackground) drawTitle();

        const baseHit: Canvas2DHitContext = {
          kind: activeChart.kind,
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
        canvas2DHitRef.current = baseHit;

        // Legend: prefer what the renderer reported; otherwise fall back to color-field categories
        let legendEntries = ropts.legend;
        // Odd and scene renderers draw their own keys; maps only draw ramps, so
        // categorical color on point / bubble / globe / arc maps uses this legend.
        const categoricalMap = isGeoMapKind(kind) && kind !== "geoHex";
        if (legendEntries == null && cIdx >= 0 && (!paintsOwnBackground || categoricalMap) && !isOddChartKind(kind)) {
          const seen = new Map<string, number>();
          for (const r of rows) {
            const k = String(r[cIdx]);
            if (!seen.has(k)) seen.set(k, seen.size);
          }
          legendEntries = [...seen.entries()].map(([label, i]) => ({ label, color: opts.colors[i % opts.colors.length]! }));
        }
        const legendPos = opts.legendPosition ?? "auto";
        if (legendPos !== "none" && legendEntries && legendEntries.length > 1) {
          const legendTitle =
            kind === "waterfall" || kind === "dumbbell" ? undefined : activeChart.colorField ?? undefined;
          drawLegend(ctx, legendEntries, legendPos, w, h, pad, fontFamily, opts.themeBg, opts.themeBorder, opts.themeText, legendTitle);
        }
        // Custom reference lines ("+ Add reference line") on the renderer's own value scale
        const refLines = customRefLines[activeChart.id] ?? [];
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
          ctx.font = `600 28px ${fontFamily}, sans-serif`;
          ctx.textAlign = place.endsWith("e") ? "right" : "left";
          const tx = place.endsWith("e") ? gx + gw : gx;
          ctx.fillText(String(rows.length), tx, gy + 30);
          ctx.globalAlpha = weight * 0.8;
          ctx.font = `10px ${fontFamily}, sans-serif`;
          ctx.fillText("rows", tx, gy + 44);
          ctx.restore();
        }
        if (smartResults) {
          drawSmartOverlays(ctx, w, h, pad, rows, cols, xIdx, yIdx, activeChart, smartResults);
        }

        if (clipProgress < 1) ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } catch (err) {
        console.warn("Chart draw error:", err);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    };

    const animateEntrance = chartVisualOverrides.animateEntrance ?? false;
    if (animateEntrance) {
      let cancelled = false;
      const start = performance.now();
      const DURATION_MS = 600;
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / DURATION_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        drawOneFrame(eased);
        if (t < 1) requestAnimationFrame(tick);
        else drawOneFrame(1);
      };
      requestAnimationFrame(tick);
      return () => { cancelled = true; };
    }

    drawOneFrame(1);
  }, [canvasSized, activeChart, sampleRows, gpuReady, useWebGPUScatter, useWebGpuScene, useWebGpuGlobe, extractScatterData, getEffectiveScatterBounds, scatterView, chartRenderOpts, chartVisualOverrides.animateEntrance, chartVisualOverrides.sizeScale, refreshKey, chartTitleOverrides, smartResults, themeUi, colors, opacity, pointSize, isCompact, containerSize.w, containerSize.h, sceneOrbit, sceneTime, dataCube, useWebGpuCube, cubeHover, continuousStops, cubeSlice, cubeTableOpen, cubeAnim, connectScatterTrail, showMarginals, customRefLines]);

  // Axes overlay for WebGPU scatter; clear when not scatter so overlay doesn't sit on top of line/bar
  useEffect(() => {
    const overlay = axesOverlayRef.current;
    if (!overlay) return;
    // Data cube owns the overlay (labels drawn in the main render pass).
    if (activeChart?.kind === "dataCube") return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const dpr = stageDpr();
    const w = overlay.width / dpr;
    const h = overlay.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (!canvasSized || !activeChart || activeChart.kind !== "scatter" || !gpuReady || !useWebGPUScatter) return;
    const sd = extractScatterData();
    if (!sd) return;
    const overlayPad = resolveChartPad({
      kind: "scatter",
      width: w,
      height: h,
      basePad: chartVisualOverrides.chartPadding ?? DEFAULT_PAD,
      titleLayout: chartVisualOverrides.titleLayout,
      tickRotation: chartVisualOverrides.tickRotation,
      chartFrame: chartVisualOverrides.chartFrame,
      isCompact,
      legendPosition: chartVisualOverrides.legendPosition,
      axisFontSize: chartVisualOverrides.axisFontSize ?? 10,
    });
    const eff = getEffectiveScatterBounds(sd, scatterView);
    const ui = getThemeUiColors(appSettings.theme);
    const overlayOpts: ChartRenderOpts = {
      colors: [],
      opacity: 1,
      pointSize: 8,
      axisFontSize: chartVisualOverrides.axisFontSize ?? 10,
      fontFamily: chartVisualOverrides.fontFamily ?? "Inter",
      axisLabelColor: chartVisualOverrides.axisLabelColor ?? ui.muted,
      axisLineColor: chartVisualOverrides.axisLineColor ?? ui.border,
      axisLineWidth: chartVisualOverrides.axisLineWidth ?? 1,
      axisStyle: chartVisualOverrides.axisStyle ?? "rule",
      tickCount: chartVisualOverrides.tickCount ?? 5,
      tickRotation: chartVisualOverrides.tickRotation ?? 0,
      showGrid: chartVisualOverrides.showGrid !== false,
      gridStyle: chartVisualOverrides.gridStyle ?? "solid",
      gridOpacity: chartVisualOverrides.gridOpacity ?? 0.5,
      chartPadding: overlayPad,
      titleLayout: chartVisualOverrides.titleLayout ?? "pair",
      titleFontWeight: chartVisualOverrides.titleFontWeight ?? 600,
      titleItalic: chartVisualOverrides.titleItalic ?? false,
      themeBg: ui.bg,
      themeText: ui.text,
      themeMuted: ui.muted,
      themeBorder: ui.border,
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAxisFrame(ctx, w, h, overlayPad, overlayOpts);
    drawAxisFieldLabels(ctx, w, h, overlayPad, activeChart.xField, activeChart.yField, overlayOpts);
    const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
    drawChartTitleBlock(ctx, w, h, overlayPad, titleText, activeChart.subtitle, {
      titleLayout: overlayOpts.titleLayout,
      fontFamily: overlayOpts.fontFamily,
      titleFontWeight: overlayOpts.titleFontWeight,
      titleItalic: overlayOpts.titleItalic,
      themeText: ui.text,
      themeMuted: ui.muted,
      themeBorder: ui.border,
      axisLabelColor: overlayOpts.axisLabelColor,
    });
    if (overlayOpts.showGrid) {
      drawGridLines(ctx, eff.xMin, eff.xMax, eff.yMin, eff.yMax, w, h, overlayPad, overlayOpts);
    }
    drawAxisTicks(ctx, eff.xMin, eff.xMax, eff.yMin, eff.yMax, w, h, overlayPad, overlayOpts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [canvasSized, activeChart, gpuReady, useWebGPUScatter, extractScatterData, getEffectiveScatterBounds, scatterView, chartVisualOverrides, refreshKey, appSettings.theme, isCompact, chartTitleOverrides, containerSize.w, containerSize.h]);

  useEffect(() => {
    if (activeChart?.kind === "scatter") setScatterView({ scale: 1, panX: 0, panY: 0 });
  }, [activeChart?.id]);

  // Globes open facing their data (e.g. US flights), not a fixed meridian over Africa.
  useEffect(() => {
    if (activeChart?.kind !== "globe" && activeChart?.kind !== "globeTrail") return;
    const sr = useLoomStore.getState().sampleRows;
    if (!sr) return;
    const cam = globeCameraForData(sr.rows, sr.columns, activeChart.xField, activeChart.yField);
    if (cam) setSceneOrbit({ yaw: cam.yaw, pitch: cam.pitch, zoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChart?.id, sampleRows]);

  // --- Empty states ---
  if (!selectedFile) {
    return (
      <StartHere />
    );
  }

  // Always show suggestions panel when a file is selected. Expand toggles full-browse grid.
  const suggestionHeader = (
    <div className={`flex flex-col border-b border-loom-border flex-shrink-0 ${isMobile && !suggestionsExpanded ? "gap-0 px-3 py-2" : "gap-2 px-2.5 py-2"}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <p className="text-xs font-semibold text-loom-text leading-tight">
            Suggestions
          </p>
          <p className="text-2xs text-loom-muted tabular-nums">
            {chartRecs.length}
            {(!isMobile || suggestionsExpanded) && (
              <> {chartRecs.length === 1 ? "chart" : "charts"}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isMobile && !suggestionsExpanded && (
            <>
              <button
                type="button"
                onClick={() => startDeepScan()}
                disabled={columnStats.length === 0 || !sampleRows}
                className="text-xs px-3 rounded-md border border-loom-border text-loom-text font-medium min-h-10 disabled:opacity-45"
                title="Swipe through more chart ideas · Keep / Skip"
              >
                ✦ Swipe ideas
              </button>
              <button
                type="button"
                onClick={openChartEditor}
                className="text-xs px-3 rounded-md border border-loom-accent/50 bg-loom-accent/10 text-loom-accent font-medium min-h-10"
              >
                Edit
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
            className={`
              loom-btn-ghost p-1.5 rounded border transition-colors min-h-10 min-w-10 md:min-h-9 md:min-w-9 flex items-center justify-center
              ${suggestionsExpanded
                ? "border-loom-accent bg-loom-accent/10 text-loom-accent"
                : "border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent hover:bg-loom-accent/10"}
            `}
            title={suggestionsExpanded ? "Back to chart" : "Browse all suggestions"}
            aria-label={suggestionsExpanded ? "Back to chart" : "Browse all suggestions"}
            aria-pressed={suggestionsExpanded}
          >
            {suggestionsExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Actions: full stack in desktop rail; hide on compact mobile rail to keep thumbnails usable */}
      {(!isMobile || suggestionsExpanded) && (
        <div
          className={`
            gap-1.5
            ${suggestionsExpanded
              ? "flex flex-wrap items-center"
              : "grid grid-cols-1"}
          `}
        >
          {(bestSuggestion || topSuggestions.length > 0) && (
            <button
              type="button"
              onClick={handleSuggestChart}
              className={`
                text-2xs py-1.5 px-2 rounded border border-loom-accent/45 bg-loom-accent/10 text-loom-accent
                hover:bg-loom-accent/20 transition-colors font-medium text-center
                ${suggestionsExpanded ? "shrink-0" : "w-full"}
              `}
              title={
                topSuggestions.length > 1
                  ? `Cycle ${topSuggestions.length} top picks (score + variety). First: ${topSuggestions[0]?.title}`
                  : `Apply best by score: ${bestSuggestion?.title ?? ""}`
              }
            >
              Suggest chart
              {topSuggestions.length > 1 ? (
                <span className="opacity-70 font-mono ml-1">{topSuggestions.length}</span>
              ) : null}
            </button>
          )}
          <button
            type="button"
            onClick={() => startDeepScan()}
            disabled={columnStats.length === 0 || !sampleRows}
            className={`
              text-2xs py-1.5 px-2 rounded border border-loom-accent/40 bg-loom-accent/10 text-loom-accent
              hover:bg-loom-accent/20 transition-colors font-medium text-center
              disabled:opacity-45 disabled:cursor-not-allowed
              ${suggestionsExpanded ? "shrink-0" : "w-full"}
            `}
            title="Deep scan · swipe Keep / Skip to train suggestions"
          >
            Deep scan
          </button>
          <div
            className={`
              gap-1.5
              ${suggestionsExpanded ? "flex flex-wrap" : "grid grid-cols-2"}
            `}
          >
            <button
              type="button"
              onClick={() => void handleTellStory()}
              disabled={!selectedFile || chartRecs.length === 0}
              className="text-2xs py-1.5 px-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent transition-colors font-medium text-center disabled:opacity-45 disabled:cursor-not-allowed"
              title="Build a multi-chart dashboard story (trend → breakdown → distribution → relationship)"
            >
              Tell a story
            </button>
            <button
              type="button"
              onClick={() => void handleSuggestWithAI()}
              disabled={aiSuggesting || columnStats.length === 0}
              className="text-2xs py-1.5 px-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text hover:bg-loom-accent/10 transition-colors font-medium text-center disabled:opacity-45 disabled:cursor-not-allowed"
              title="Local Ollama chart suggestion (requires ollama serve)"
            >
              {aiSuggesting ? "Asking…" : "Suggest with AI"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (chartRecs.length === 0) {
    return (
      <div className="flex h-full animate-fade-in flex-col md:flex-row">
        <div className="hidden md:flex w-[220px] flex-shrink-0 border-r border-loom-border bg-loom-surface flex-col overflow-hidden">
          {suggestionHeader}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center">
              <p className="text-sm text-loom-muted">No chart suggestions</p>
              <p className="text-xs text-loom-muted mt-1">Needs at least 1 numeric or temporal column</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-loom-muted text-center">Build a chart with Encoding in the Chart panel</p>
          <button type="button" onClick={openChartEditor} className="loom-btn-primary text-xs py-2 px-4 min-h-10">
            Open Chart editor
          </button>
        </div>
      </div>
    );
  }

  const mobileRail = isMobile && !suggestionsExpanded;

  return (
    <div className={`flex h-full animate-fade-in ${suggestionsExpanded || isMobile ? "flex-col" : ""}`}>
      {/* Recommendation panel — desktop sidebar, mobile bottom rail, or full browse grid */}
      {!socialExportReady && !liveEdit && (
      <div
        className={`
          bg-loom-surface overflow-hidden transition-[width,height] duration-200 ease-out
          ${suggestionsExpanded
            ? "order-1 w-full flex-1 flex flex-col min-h-0 border-b border-loom-border"
            : mobileRail
              ? "order-2 shrink-0 border-t border-loom-border flex flex-col max-h-[min(32%,11.5rem)] pb-[env(safe-area-inset-bottom,0px)]"
              : "w-[220px] flex-shrink-0 overflow-y-auto border-r border-loom-border"}
        `}
      >
        {suggestionHeader}
        <div
          className={`
            flex-1 min-h-0
            ${suggestionsExpanded
              ? "overflow-y-auto p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 content-start"
              : mobileRail
                ? "overflow-x-auto overflow-y-hidden flex flex-row gap-3 px-3 pt-1.5 pb-2.5 scrollbar-none snap-x snap-mandatory"
                : "overflow-y-auto p-2 grid grid-cols-1 gap-2"}
          `}
        >
          {chartRecs.map((rec) => (
            <ChartCard
              key={rec.id}
              rec={rec}
              data={sampleRows}
              isActive={activeChart?.id === rec.id}
              compact={mobileRail}
              onClick={() => selectRecommendation(rec)}
            />
          ))}
        </div>
      </div>
      )}

      {/* Full-size chart — always in DOM so refs/ResizeObserver stay valid; zero size when browsing all */}
      <div
        className={`
          flex flex-col min-w-0 overflow-hidden transition-[width,height] duration-200 ease-out
          ${suggestionsExpanded
            ? "w-0 h-0 flex-shrink-0 overflow-hidden pointer-events-none"
            : isMobile
              ? "order-1 flex-1 min-h-0"
              : "flex-1"}
        `}
      >
        {!socialExportReady && (
        <div className="flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 py-1.5 sm:py-2 border-b border-loom-border bg-loom-surface/50 flex-wrap">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <div
              className="flex items-center gap-2 min-w-0 group"
              onMouseEnter={() => {
                if (!activeChart || titleEditing) return;
                titleHoverTimerRef.current = setTimeout(() => setShowTitleEditButton(true), 1000);
              }}
              onMouseLeave={() => {
                if (titleHoverTimerRef.current) {
                  clearTimeout(titleHoverTimerRef.current);
                  titleHoverTimerRef.current = null;
                }
                setShowTitleEditButton(false);
              }}
            >
              <span className="w-2 h-2 rounded-full bg-loom-accent shrink-0" />
              {titleEditing ? (
                <input
                  type="text"
                  value={titleEditValue}
                  onChange={(e) => setTitleEditValue(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={handleTitleKeyDown}
                  className="flex-1 min-w-0 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded px-2 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-loom-accent focus:border-loom-accent"
                  placeholder="Chart title"
                  autoFocus
                  aria-label="Chart title"
                />
              ) : (
                <>
                  <span
                    className="text-xs font-medium text-loom-text truncate cursor-text select-text"
                    onDoubleClick={activeChart ? handleTitleStartEdit : undefined}
                    // Phones can't hover or double-click comfortably — a tap edits.
                    onClick={activeChart && isMobile ? handleTitleStartEdit : undefined}
                    title={activeChart ? "Double-click or hover for edit" : undefined}
                  >
                    {displayTitle}
                  </span>
                  {activeChart && (showTitleEditButton || isMobile) && (
                    <button
                      type="button"
                      onClick={handleTitleStartEdit}
                      className="shrink-0 p-1 max-md:p-2 max-md:-my-1.5 rounded text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
                      title="Edit title"
                      aria-label="Edit chart title"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
            {activeChart && !titleEditing && !isMobile && (
              <span
                className="text-2xs text-loom-muted pl-4 cursor-help border-b border-dotted border-loom-muted/50"
                title={aiSuggestionReason ?? getRecommendationReason(activeChart)}
              >
                Why?
              </span>
            )}
          </div>
          <div className="flex-1 min-w-2" />
          {activeChart && (
            <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end">
              {activeChart.kind === "scatter" && (
                <div className="flex items-center gap-0.5 mr-0.5 sm:mr-1" role="group" aria-label="Chart interaction mode">
                  {([
                    { mode: "pan" as const, label: "Pan", tip: "Drag to pan · pinch to zoom · Shift+drag brush" },
                    { mode: "crosshair" as const, label: "Cross", tip: "Read values · tap to pin ruler" },
                    ...(isMobile
                      ? []
                      : [{ mode: "lasso" as const, label: "Lasso", tip: "Draw to select points (G)" }]),
                  ]).map(({ mode, label, tip }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setChartInteractionMode(mode)}
                      aria-pressed={chartInteractionMode === mode}
                      title={tip}
                      className={`px-2.5 py-1.5 sm:px-1.5 sm:py-0.5 text-2xs rounded min-h-9 sm:min-h-0 ${chartInteractionMode === mode ? "bg-loom-accent/25 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                className="hidden sm:inline-flex px-1.5 py-0.5 text-2xs font-mono text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded"
                title="Redraw chart"
              >
                Refresh
              </button>
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => {
                    setPromptDialog({
                      title: "Name for this chart view",
                      defaultValue: activeChart.title || "Chart view",
                      onConfirm: async (name) => {
                        if (name == null || !name.trim()) return;
                        let snapshotImageDataUrl: string | null = null;
                        if (pngExportHandler) {
                          try {
                            const blob = await pngExportHandler();
                            if (blob) {
                              snapshotImageDataUrl = await new Promise<string>((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result as string);
                                r.onerror = rej;
                                r.readAsDataURL(blob);
                              });
                            }
                          } catch (_) { /* ignore */ }
                        }
                        const sample = sampleRows ? { columns: sampleRows.columns, types: sampleRows.types ?? [], rows: sampleRows.rows, total_rows: sampleRows.total_rows } : undefined;
                        const ok = addChartView(name.trim(), selectedFile.path, selectedFile.name, activeChart, { ...chartVisualOverrides }, querySql, sample, snapshotImageDataUrl);
                        setToast(ok ? "Chart view saved. Open the Dashboards tab and use \"Add to dashboard\" or \"+ Add view\"." : "Could not save chart view");
                      }
                    });
                  }}
                  className="hidden sm:inline-flex px-1.5 py-0.5 text-2xs text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded"
                  title="Save this chart for dashboards"
                >
                  Save view
                </button>
              )}
              <span className="loom-badge text-2xs hidden sm:inline-flex" title={aggregationHint || undefined}>{useWebGPUScatter || useWebGpuScene || useWebGpuCube ? "GPU" : "Canvas"}</span>
              {!useWebGPUScatter &&
                (!!chartVisualOverrides.markStroke ||
                  !!chartVisualOverrides.glowEnabled ||
                  (chartVisualOverrides.markJitter ?? 0) > 0 ||
                  (!!chartVisualOverrides.markShape && chartVisualOverrides.markShape !== "circle")) && (
                <span className="text-2xs text-loom-muted hidden md:inline" title="Mark style / glow / stroke use the Canvas renderer">
                  Canvas look
                </span>
              )}
              <span className="loom-badge text-2xs max-w-[200px] truncate hidden sm:inline-flex" title={`${sampleHonestyLabel}${aggregationHint ? ` · ${aggregationHint}` : ""}`}>
                {sampleHonestyLabel || "—"}
              </span>
              {densityHint && !isMobile && (
                <>
                  <span
                    className="loom-badge text-2xs text-loom-accent border-loom-accent/30 max-w-[140px] truncate"
                    title="Point size and opacity scale down when many rows would overplot. Zoom in to reveal more points."
                  >
                    {densityHint}
                  </span>
                  <button
                    type="button"
                    onClick={applyClarity}
                    className="px-2 py-1 text-2xs font-medium rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent min-h-8"
                    title="One-click Clarity preset: small marks, low opacity, no stroke"
                  >
                    Clarity
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        )}

        <div
          ref={stageHostRef}
          className={`flex-1 relative min-h-0 min-h-[200px] flex items-center justify-center ${socialExportReady ? "px-0 py-0 overflow-auto" : "px-2 py-2"}`}
          style={{
            // Letterbox matte — reads as a stage, not a broken black void
            backgroundColor: socialExportReady
              ? "var(--loom-bg)"
              : "color-mix(in srgb, var(--loom-bg) 88%, var(--loom-border))",
            backgroundImage: socialExportReady
              ? "none"
              : "radial-gradient(color-mix(in srgb, var(--loom-border) 55%, transparent) 0.6px, transparent 0.6px)",
            backgroundSize: "10px 10px",
          }}
        >
          <div
            ref={containerRef}
            className={`relative overflow-hidden ${
              !socialExportReady && (chartFrameSize.aspectLocked || chartDevice !== "desktop")
                ? "rounded-md border border-loom-border shadow-sm"
                : ""
            } ${orbitEnabled ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={(e) => {
              if (!orbitEnabled) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              sceneOrbitDragRef.current = {
                x: e.clientX,
                y: e.clientY,
                yaw: sceneOrbit.yaw,
                pitch: sceneOrbit.pitch,
              };
            }}
            onPointerMove={(e) => {
              const drag = sceneOrbitDragRef.current;
              if (!drag) return;
              const dx = e.clientX - drag.x;
              const dy = e.clientY - drag.y;
              setSceneOrbit((o) => ({
                ...o,
                yaw: drag.yaw + dx * 0.008,
                pitch: Math.max(-1.2, Math.min(1.2, drag.pitch + dy * 0.008)),
              }));
            }}
            onPointerUp={(e) => {
              const drag = sceneOrbitDragRef.current;
              sceneOrbitDragRef.current = null;
              // A click (not a drag) on the cube slices to that voxel's depth layer; empty space clears.
              if (activeChart?.kind === "dataCube" && drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
                const hz = cubeHover?.zi;
                setCubeSlice((s) => (hz == null ? null : s === hz ? null : hz));
              }
            }}
            onPointerCancel={() => {
              sceneOrbitDragRef.current = null;
            }}
            onWheel={(e) => {
              if (!orbitEnabled) return;
              e.preventDefault();
              setSceneOrbit((o) => ({
                ...o,
                zoom: Math.max(0.4, Math.min(3, o.zoom * (e.deltaY > 0 ? 0.92 : 1.08))),
              }));
            }}
            style={{
              width: chartFrameSize.width,
              height: chartFrameSize.height,
              maxWidth: socialExportTarget ? undefined : "100%",
              maxHeight: socialExportTarget ? undefined : "100%",
              flexShrink: 0,
              background: themeUi.bg,
            }}
          >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{
              zIndex: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? 1 : 0,
              // Default WebGPU clear is near-black; hide when Canvas 2D owns the frame
              // so aspect/device resizes never flash a black slab through a cleared 2D layer.
              visibility: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? "visible" : "hidden",
              pointerEvents: useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube ? "auto" : "none",
            }}
          />
          <canvas
            ref={canvas2DRef}
            data-loom-chart-canvas2d
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: useWebGPUScatter || useWebGpuScene || useWebGpuCube ? 0 : 1 }}
          />
          <canvas
            ref={axesOverlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: useWebGPUScatter || useWebGpuCube ? 2 : 0 }}
          />
          {socialExportReady &&
            (chartAspect === "9:16" || socialExportTarget?.presetId === "stories") && (
            <div className="absolute inset-0 z-[5] pointer-events-none" aria-hidden>
              <div
                className="absolute inset-x-0 top-0 border-b border-dashed border-amber-400/40 bg-amber-400/10"
                style={{ height: "14%" }}
              />
              <div
                className="absolute inset-x-0 bottom-0 border-t border-dashed border-amber-400/40 bg-amber-400/10"
                style={{ height: "20%" }}
              />
              <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[9px] font-mono text-amber-500/80 bg-loom-bg/70 px-1 rounded">
                Stories safe zone
              </span>
            </div>
          )}
          {renderIssue && activeChart && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-loom-bg/85 backdrop-blur-sm">
              <div className="loom-card max-w-md w-full p-4 space-y-3 border border-loom-accent/30 shadow-lg">
                <p className="text-sm font-semibold text-loom-text">{renderIssue.title}</p>
                <p className="text-2xs text-loom-muted leading-relaxed">{renderIssue.message}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyWorkingChart}
                    className="loom-btn-primary text-2xs py-1.5 px-3"
                  >
                    Pick a working suggestion
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanelTab("chart");
                      if (!useLoomStore.getState().panelOpen) useLoomStore.getState().togglePanel();
                    }}
                    className="text-2xs py-1.5 px-3 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text"
                  >
                    Open Encoding
                  </button>
                </div>
              </div>
            </div>
          )}
          {activeChart?.kind === "scatter" && (
            <div
              ref={overlayRef}
              className="absolute inset-0 w-full h-full"
              tabIndex={0}
              role="application"
              aria-label="Scatter chart. Two-finger scroll pans, pinch or mouse wheel zooms toward cursor. Arrows pan, plus and minus zoom, zero resets. V pan, C crosshair, G lasso. Shift-drag to brush."
              style={{
                zIndex: 3,
                touchAction: "none",
                cursor:
                  chartInteractionMode === "crosshair"
                    ? "crosshair"
                    : chartInteractionMode === "lasso"
                      ? "crosshair"
                      : isPanning
                        ? "grabbing"
                        : "grab",
              }}
              onMouseMove={handleScatterMouseMove}
              onMouseLeave={() => {
                handleScatterPointerLeave();
                panStartRef.current = null;
                setIsPanning(false);
                if (brushStartRef.current) { brushStartRef.current = null; setBrushRect(null); setLassoPoints([]); }
                setCrosshairPos(null);
              }}
              onMouseDown={handleScatterMouseDown}
              onMouseUp={handleScatterMouseUp}
              onMouseOut={handleScatterMouseUp}
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  const [a, b] = [e.touches[0], e.touches[1]];
                  pinchRef.current = {
                    dist: touchDistance(a, b),
                    scale: scatterView.scale,
                    midX: (a.clientX + b.clientX) / 2,
                    midY: (a.clientY + b.clientY) / 2,
                  };
                } else if (e.touches.length === 1 && chartInteractionMode === "pan") {
                  const t = e.touches[0];
                  panStartRef.current = { x: t.clientX, y: t.clientY };
                  setIsPanning(true);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2 && pinchRef.current) {
                  e.preventDefault();
                  const [a, b] = [e.touches[0], e.touches[1]];
                  const dist = touchDistance(a, b);
                  if (pinchRef.current.dist < 1) return;
                  const factor = dist / pinchRef.current.dist;
                  const midX = (a.clientX + b.clientX) / 2;
                  const midY = (a.clientY + b.clientY) / 2;
                  applyPinchZoom(midX, midY, pinchRef.current.scale * factor, pinchRef.current.scale);
                } else if (e.touches.length === 1 && panStartRef.current) {
                  e.preventDefault();
                  const t = e.touches[0];
                  const dx = t.clientX - panStartRef.current.x;
                  const dy = t.clientY - panStartRef.current.y;
                  panStartRef.current = { x: t.clientX, y: t.clientY };
                  const d = scatterDataRef.current;
                  if (d) {
                    const cw = d.w - 2 * d.pad;
                    const ch = d.h - 2 * d.pad;
                    const dataPerPxX = cw > 0 ? (d.xMax - d.xMin) / cw : 0;
                    const dataPerPxY = ch > 0 ? (d.yMax - d.yMin) / ch : 0;
                    setScatterView((v) => ({
                      ...v,
                      panX: v.panX + (dx * dataPerPxX) / v.scale,
                      panY: v.panY - (dy * dataPerPxY) / v.scale,
                    }));
                  }
                }
              }}
              onTouchEnd={() => {
                if (pinchRef.current) pinchRef.current = null;
                panStartRef.current = null;
                setIsPanning(false);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                setScatterView({ scale: 1, panX: 0, panY: 0 });
              }}
              onPointerDown={(e) => {
                lastPointerTypeRef.current = e.pointerType;
              }}
              onClick={() => {
                if (lastPointerTypeRef.current === "touch") return;
                if (chartInteractionMode === "pan" && scatterTooltip && activeChart) {
                  addPinnedTooltip({ chartId: activeChart.id, x: scatterTooltip.clientX, y: scatterTooltip.clientY, rowIndex: scatterTooltip.rowIndex, row: scatterTooltip.row, columns: scatterTooltip.columns });
                }
              }}
            />
          )}
          {activeChart && activeChart.kind !== "scatter" && (
            <div
              className="absolute inset-0 w-full h-full"
              // Pointer events + touch-action:none let a finger drag scrub the tooltip
              // (and orbit 3D scenes) instead of the browser claiming the gesture.
              style={{ zIndex: 2, cursor: activeChart.kind === "dataCube" ? "grab" : "crosshair", touchAction: "none" }}
              onPointerMove={handleCanvas2DPointerMove}
              onPointerDown={handleCanvas2DPointerMove}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch") handleCanvas2DPointerLeave();
              }}
              aria-hidden
            />
          )}
          {activeChart?.kind === "dataCube" && dataCube && !socialExportReady && !previewCaptureActive && (
            <>
              <DataCubePivotBar
                cube={dataCube}
                ramp={continuousStops}
                showLegend={chartVisualOverrides.legendPosition !== "none"}
                slice={cubeSlice}
                tableOpen={cubeTableOpen}
                onSlice={setCubeSlice}
                onToggleTable={() => setCubeTableOpen((o) => !o)}
                onSwap={swapCubeAxes}
                onRotate={rotateCubeAxes}
                onReplace={replaceCubeAxis}
              />
              {cubeTableOpen && pivotTable && (
                <DataCubePivotTable
                  table={pivotTable}
                  ramp={continuousStops}
                  hover={cubeHover}
                  onHover={(cell) => {
                    setCubeHover(cell ? { ...cell, zi: cubeSlice } : null);
                    if (!cell) setChartTooltip(null);
                  }}
                />
              )}
            </>
          )}
          {brushRect && (
            <div
              className="fixed pointer-events-none border-2 border-loom-accent bg-loom-accent/10 z-[90]"
              style={{
                left: Math.min(brushRect.x1, brushRect.x2),
                top: Math.min(brushRect.y1, brushRect.y2),
                width: Math.abs(brushRect.x2 - brushRect.x1),
                height: Math.abs(brushRect.y2 - brushRect.y1),
              }}
            />
          )}
          {/* Lasso polygon overlay */}
          {lassoPoints.length > 1 && (
            <svg className="fixed inset-0 w-full h-full pointer-events-none z-[90]">
              <polyline
                points={lassoPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="var(--loom-accent)"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            </svg>
          )}
          {/* Crosshair overlay */}
          {crosshairPos && chartInteractionMode === "crosshair" && containerRef.current && (() => {
            const rect = containerRef.current!.getBoundingClientRect();
            const sx = crosshairPos.screenX - rect.left;
            const sy = crosshairPos.screenY - rect.top;
            return (
              <>
                <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: sx, top: 0, width: 1, height: "100%" }} />
                <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: 0, top: sy, width: "100%", height: 1 }} />
                <div className="absolute pointer-events-none text-2xs font-mono text-loom-text bg-loom-surface/90 border border-loom-border rounded px-1 py-0.5 z-[6]" style={{ left: sx + 8, top: sy - 20 }}>
                  ({crosshairPos.dataX.toPrecision(4)}, {crosshairPos.dataY.toPrecision(4)})
                </div>
              </>
            );
          })()}
          {/* Ruler measurement */}
          {rulerPins.length === 2 && (
            <div className="absolute bottom-8 left-2 z-[6] text-2xs font-mono text-loom-text bg-loom-surface/90 border border-loom-border rounded px-1.5 py-0.5">
              Δx={Math.abs(rulerPins[1].x - rulerPins[0].x).toPrecision(4)} Δy={Math.abs(rulerPins[1].y - rulerPins[0].y).toPrecision(4)}
              <button type="button" onClick={() => setRulerPins([])} className="ml-1 text-loom-muted hover:text-loom-text">×</button>
            </div>
          )}
          {/* Pinned tooltips */}
          {pinnedTooltips.filter((t) => t.chartId === activeChart?.id).map((t) => (
            <div
              key={t.id}
              className="fixed z-[100] px-2 py-1 text-2xs font-mono rounded border border-loom-accent/50 bg-loom-surface text-loom-text shadow-lg max-w-[220px]"
              style={{ left: t.x + 12, top: t.y + 12 }}
            >
              <div className="flex justify-between items-start gap-1">
                <div className="space-y-0.5 min-w-0">
                  {t.columns.slice(0, 4).map((col, i) => (
                    <div key={col} className="truncate"><span className="text-loom-muted">{col}:</span> {String(t.row[i] ?? "null")}</div>
                  ))}
                </div>
                <button type="button" onClick={() => removePinnedTooltip(t.id)} className="shrink-0 text-loom-muted hover:text-loom-text">×</button>
              </div>
            </div>
          ))}
          {/* Mini-map when zoomed */}
          {activeChart?.kind === "scatter" && scatterView.scale > 1.5 && scatterDataRef.current && (() => {
            const MH = 60, MW = 80;
            const sd = scatterDataRef.current;
            const xRange = sd.xMax - sd.xMin || 1, yRange = sd.yMax - sd.yMin || 1;
            const vx1 = ((scatterView.panX - sd.xMin) / xRange) * MW;
            const vy1 = ((sd.yMax - scatterView.panY) / yRange) * MH;
            const vw = MW / scatterView.scale, vh = MH / scatterView.scale;
            return (
              <div className="absolute top-2 right-2 z-[6] border border-loom-border rounded bg-loom-surface/80 overflow-hidden" style={{ width: MW, height: MH }}>
                <svg width={MW} height={MH}>
                  {sd.points.slice(0, 500).map((p, i) => (
                    <circle key={i} cx={((p.x - sd.xMin) / xRange) * MW} cy={MH - ((p.y - sd.yMin) / yRange) * MH} r={1} fill="var(--loom-accent)" opacity={0.4} />
                  ))}
                  <rect x={MW / 2 - vw / 2} y={MH / 2 - vh / 2} width={vw} height={vh} fill="none" stroke="var(--loom-accent)" strokeWidth={1} />
                </svg>
              </div>
            );
          })()}
          {activeChart?.kind === "scatter" && (scatterView.scale !== 1 || scatterView.panX !== 0 || scatterView.panY !== 0) && (
            <button
              type="button"
              onClick={() => setScatterView({ scale: 1, panX: 0, panY: 0 })}
              className="absolute bottom-2 right-2 z-10 px-2 py-1 text-2xs rounded border border-loom-border bg-loom-surface text-loom-text hover:bg-loom-elevated"
            >
              Reset view
            </button>
          )}
          {activeChart && (chartAnnotations[activeChart.id] ?? []).map((a) => (
            <div
              key={a.id}
              className="absolute text-2xs font-mono px-1.5 py-0.5 rounded bg-loom-surface/95 border border-loom-border text-loom-text pointer-events-none z-[4]"
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: "translate(-50%, -50%)" }}
            >
              {a.text}
            </div>
          ))}
          </div>
        </div>
        {(scatterTooltip || chartTooltip) && (() => {
          const tip = (scatterTooltip ?? chartTooltip)!;
          // Flip to the pointer's other side near the window edges
          const left = tip.clientX + 300 > window.innerWidth ? Math.max(8, tip.clientX - 292) : tip.clientX + 12;
          const top = tip.clientY + 220 > window.innerHeight
            ? Math.max(8, tip.clientY - 16 - 20 * Math.min(9, tip.columns.length))
            : tip.clientY + 12;
          return (
            <div
              className="fixed z-[100] px-2.5 py-2 text-xs rounded-md border border-loom-border bg-loom-surface text-loom-text shadow-lg pointer-events-none max-w-[280px]"
              style={{ left, top }}
            >
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 items-baseline">
                {tip.columns.slice(0, 8).map((col, i) => (
                  <div key={`${col}-${i}`} className="contents">
                    <span className="text-loom-muted text-2xs">{col}</span>
                    <span className={`font-mono break-words min-w-0 ${i === 0 ? "font-semibold" : ""}`}>{String(tip.row[i] ?? "—")}</span>
                  </div>
                ))}
              </div>
              {tip.columns.length > 8 && (
                <div className="text-loom-muted text-2xs mt-1">+{tip.columns.length - 8} more</div>
              )}
              {tooltipLink && (
                <div className="text-2xs text-loom-accent border-t border-loom-border mt-1 pt-1 truncate" title={`Filter: ${tooltipLink.field} = ${tooltipLink.value}`}>
                  Link: {tooltipLink.field}={tooltipLink.value}
                </div>
              )}
            </div>
          );
        })()}

        {activeChart && !isMobile && (
          <div className="flex flex-wrap items-center gap-2 px-3 h-[var(--statusbar-height)] border-t border-loom-border text-2xs text-loom-muted font-mono">
            <span>Vega-Lite spec: {activeChart.kind}</span>
            <span className="text-loom-border">|</span>
            <span>{activeChart.xField}{activeChart.yField ? ` × ${activeChart.yField}` : ""}</span>
            <span className="text-loom-border">|</span>
            <span title="Press L while hovering a point to lock/unlock tooltip filter across charts">
              Tooltip L = link
            </span>
            {tooltipLink && (
              <>
                <span className="text-loom-accent truncate max-w-[200px]">
                  {tooltipLink.field}={tooltipLink.value}
                </span>
                <button
                  type="button"
                  onClick={() => setTooltipLink(null)}
                  className="text-loom-muted hover:text-loom-text underline"
                >
                  Clear link
                </button>
              </>
            )}
            {!socialExportReady &&
              (chartAspect !== "free" ||
                chartDevice !== "desktop" ||
                (appSettings.chartDevice ?? "auto") !== "auto") && (
              <span
                className="ml-auto text-2xs font-mono text-loom-muted tabular-nums"
                title="Chart frame aspect · device · pixel size"
              >
                {aspectLabel(chartAspect)}
                {" · "}
                {chartDevice}
                {" · "}
                {chartFrameSize.width}×{chartFrameSize.height}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// === Full-size Canvas 2D renderers ===

export interface ChartRenderOpts {
  colors: string[];
  /** Full continuous stops for heatmap / choropleth interpolation. */
  continuousStops?: string[];
  opacity: number;
  /** True when Visual → opacity was set explicitly (skip auto density opacity). */
  opacityUserSet?: boolean;
  pointSize: number;
  // Typography
  fontFamily?: string;
  titleFontWeight?: number;
  titleItalic?: boolean;
  tickRotation?: number;
  axisFontSize?: number;
  // Marks
  markShape?: string;
  markStroke?: boolean;
  markStrokeWidth?: number;
  markStrokeColor?: string;
  markJitter?: number;
  sizeScale?: number;
  barCornerRadius?: number;
  lineStrokeStyle?: string;
  lineCurveSmooth?: boolean;
  lineWidth?: number;
  // Axes & Grid
  axisLineColor?: string;
  axisLineWidth?: number;
  gridStyle?: string;
  gridOpacity?: number;
  tickCount?: number;
  axisLabelColor?: string;
  showGrid?: boolean;
  // Layout
  chartPadding?: number;
  legendPosition?: string;
  showDataLabels?: boolean;
  // Atmosphere
  backgroundStyle?: string;
  blendMode?: string;
  glowEnabled?: boolean;
  glowIntensity?: number;
  // Look spectrum
  chartDetail?: string;
  markMotif?: string;
  axisStyle?: string;
  emphasisStyle?: string;
  ghostEnabled?: boolean;
  ghostWeight?: string;
  ghostPlace?: string;
  titleLayout?: string;
  chartFrame?: string;
  // Theme-derived (so chart bg/title/axes follow app theme)
  themeBg?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  /** Y aggregation for bar/line/area/pie (canvas renderer uses this; Vega spec has it too). */
  yAggregate?: YAggregateOption | null;
  /** Bar + Color: grouped (dodge), stacked, or 100% stacked — canvas + Vega via createChartRec. */
  barStackMode?: "grouped" | "stacked" | "percent";
  /** Cap ranked categories (bar). */
  topN?: number | null;
  /** Second Y measure (line / area dashed overlay). */
  y2Field?: string | null;
  /** Overlay earlier half of the time series (line / area). */
  comparePrevious?: boolean | null;
  /** Per-paint: renderers push hoverable marks here (tooltips + linked highlight). */
  hits?: HitTarget[];
  /** Per-paint: column names so renderers can title axes / tooltips. */
  fieldNames?: string[];
  /** Per-paint: series the renderer actually colored (drives the shared legend). */
  legend?: { label: string; color: string }[] | null;
  /** Per-paint: value → pixel scales the renderer used, for reference lines. `valueAxis` names the measure axis. */
  scales?: { x?: (v: number) => number; y?: (v: number) => number; valueAxis?: "x" | "y"; rect: PlotRect } | null;
  /** Scatter: connect points in row order (trail). */
  connectTrail?: boolean;
  /** Scatter: marginal histograms along the x and y edges. */
  showMarginals?: boolean;
}

// --- Shape Drawing Helpers ---

function drawShape(ctx: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number) {
  switch (shape) {
    case "square":
      ctx.rect(cx - r, cy - r, r * 2, r * 2);
      break;
    case "diamond":
      ctx.moveTo(cx, cy - r * 1.3);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r * 1.3);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case "triangle":
      ctx.moveTo(cx, cy - r * 1.2);
      ctx.lineTo(cx + r * 1.1, cy + r * 0.8);
      ctx.lineTo(cx - r * 1.1, cy + r * 0.8);
      ctx.closePath();
      break;
    case "cross": {
      const a = r * 0.35;
      ctx.moveTo(cx - a, cy - r); ctx.lineTo(cx + a, cy - r);
      ctx.lineTo(cx + a, cy - a); ctx.lineTo(cx + r, cy - a);
      ctx.lineTo(cx + r, cy + a); ctx.lineTo(cx + a, cy + a);
      ctx.lineTo(cx + a, cy + r); ctx.lineTo(cx - a, cy + r);
      ctx.lineTo(cx - a, cy + a); ctx.lineTo(cx - r, cy + a);
      ctx.lineTo(cx - r, cy - a); ctx.lineTo(cx - a, cy - a);
      ctx.closePath();
      break;
    }
    case "star": {
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r * 1.2 : r * 0.5;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case "ring":
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    default: // circle
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }
}

export interface PointVisualOverrides {
  alpha?: number;
  glow?: number;   // 0 = off, >0 = blur amount
  stroke?: boolean;
  strokeWidth?: number;
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cx: number,
  cy: number,
  r: number,
  fillColor: string,
  alpha: number,
  opts?: ChartRenderOpts,
  pointOverrides?: PointVisualOverrides,
) {
  const useAlpha = pointOverrides?.alpha ?? alpha;
  const useGlow = pointOverrides?.glow !== undefined
    ? pointOverrides.glow > 0
    : (opts?.glowEnabled ?? false);
  const useGlowInt = pointOverrides?.glow !== undefined && pointOverrides.glow > 0
    ? pointOverrides.glow
    : (opts?.glowIntensity ?? 8);
  const useStroke = pointOverrides?.stroke !== undefined
    ? pointOverrides.stroke
    : (opts?.markStroke ?? false);
  const useStrokeWidth = pointOverrides?.strokeWidth ?? opts?.markStrokeWidth ?? 1;

  if (useGlow) {
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = useGlowInt;
  }
  ctx.beginPath();
  drawShape(ctx, shape, cx, cy, r);
  ctx.fillStyle = fillColor;
  ctx.globalAlpha = useAlpha;
  if (shape === "ring") {
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = Math.max(1, r * 0.4);
    ctx.stroke();
  } else {
    ctx.fill();
  }
  if (useStroke && shape !== "ring") {
    ctx.strokeStyle = opts?.markStrokeColor === "auto" || !opts?.markStrokeColor ? fillColor : opts.markStrokeColor;
    ctx.lineWidth = useStrokeWidth;
    ctx.globalAlpha = Math.min(1, useAlpha + 0.2);
    ctx.stroke();
  }
  if (useGlow) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }
}

// --- Jitter helper ---
const jitterSeed = new Map<number, number>();
function jitter(idx: number, amount: number): number {
  if (amount <= 0) return 0;
  if (!jitterSeed.has(idx)) jitterSeed.set(idx, Math.random() * 2 - 1);
  return jitterSeed.get(idx)! * amount;
}

// --- Legend renderer (theme colors optional) ---
/**
 * Floating key inside the plot. "auto" picks whichever corner has the least
 * ink under it (sampled from the canvas) so it never sits on top of the data.
 */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: { label: string; color: string }[],
  position: string,
  w: number,
  h: number,
  pad: number,
  fontFamily: string,
  themeBg = "#111114",
  themeBorder = "#2a2a30",
  themeText = "#e8e8ec",
  title?: string,
) {
  if (position === "none" || entries.length === 0) return;
  const maxRows = 10;
  const shown = entries.slice(0, maxRows);
  const extra = entries.length - shown.length;
  const font = `10px '${fontFamily}', sans-serif`;
  const titleFont = `600 10px '${fontFamily}', sans-serif`;
  const lineH = 16;
  const sw = 9;
  const maxText = Math.min(170, Math.max(60, (w - 2 * pad) * 0.32));
  ctx.save();
  ctx.font = font;
  let textW = Math.max(...shown.map((e) => ctx.measureText(e.label).width), extra > 0 ? ctx.measureText(`+${extra} more`).width : 0);
  if (title) {
    ctx.font = titleFont;
    textW = Math.max(textW, ctx.measureText(title).width);
  }
  textW = Math.min(maxText, textW);
  const legendW = Math.ceil(10 + sw + 6 + textW + 10);
  const rowsN = shown.length + (extra > 0 ? 1 : 0) + (title ? 1 : 0);
  const legendH = rowsN * lineH + 10;

  const inset = 8;
  const corners: Record<string, [number, number]> = {
    "top-right": [w - pad - legendW - inset, pad + inset],
    "top-left": [pad + inset, pad + inset],
    "bottom-right": [w - pad - legendW - inset, h - pad - legendH - inset],
    "bottom-left": [pad + inset, h - pad - legendH - inset],
    right: [w - pad - legendW - inset, Math.round(pad + (h - 2 * pad - legendH) / 2)],
    bottom: [Math.round((w - legendW) / 2), h - pad - legendH - inset],
  };
  let [lx, ly] = corners[position] ?? corners["top-right"]!;
  if (position === "auto") {
    // Score each corner by how many pixels differ from the background
    const dpr = ctx.getTransform().a || 1;
    let best = Infinity;
    for (const key of ["top-right", "top-left", "bottom-right", "bottom-left"]) {
      const [cx, cy] = corners[key]!;
      try {
        const img = ctx.getImageData(Math.max(0, cx * dpr), Math.max(0, cy * dpr), Math.max(1, legendW * dpr), Math.max(1, legendH * dpr));
        const d = img.data;
        const bg = themeBg.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        const [br, bgc, bb] = bg ? [parseInt(bg[1]!, 16), parseInt(bg[2]!, 16), parseInt(bg[3]!, 16)] : [0, 0, 0];
        let ink = 0;
        for (let i = 0; i < d.length; i += 16) {
          if (d[i + 3]! < 16) continue;
          if (Math.abs(d[i]! - br) + Math.abs(d[i + 1]! - bgc) + Math.abs(d[i + 2]! - bb) > 60) ink++;
        }
        if (ink < best - 2) {
          best = ink;
          lx = cx;
          ly = cy;
        }
      } catch {
        break; // tainted / unavailable canvas — keep top-right
      }
    }
  }
  lx = Math.max(4, Math.min(w - legendW - 4, lx));
  ly = Math.max(4, Math.min(h - legendH - 4, ly));

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = themeBg;
  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedBox(ctx, lx, ly, legendW, legendH, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let ey = ly + 5 + lineH / 2;
  if (title) {
    ctx.font = titleFont;
    ctx.fillStyle = themeText;
    ctx.fillText(fitTextEllipsis(ctx, title, legendW - 20), lx + 10, ey);
    ey += lineH;
  }
  ctx.font = font;
  for (const e of shown) {
    ctx.fillStyle = e.color;
    ctx.beginPath();
    roundedBox(ctx, lx + 10, ey - sw / 2, sw, sw, 2);
    ctx.fill();
    ctx.fillStyle = themeText;
    ctx.fillText(fitTextEllipsis(ctx, e.label, textW), lx + 10 + sw + 6, ey);
    ey += lineH;
  }
  if (extra > 0) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = themeText;
    ctx.fillText(`+${extra} more`, lx + 10 + sw + 6, ey);
  }
  ctx.restore();
}

function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// --- Smart overlays (anomaly, forecast, trend, reference lines) ---
function drawSmartOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: number,
  rows: unknown[][],
  columns: string[],
  xIdx: number,
  yIdx: number,
  activeChart: { kind: string; xField: string; yField: string | null },
  smartResults: SmartResults | null,
) {
  if (!smartResults || yIdx < 0 || xIdx < 0 || !rows.length) return;
  const [xMin, xMax] = numRange(rows, xIdx);
  const [yMin, yMax] = numRange(rows, yIdx);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
  const toSx = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (w - 2 * pad);
  const toSy = (y: number) => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - 2 * pad);

  // Anomaly: ring around anomalous points
  if (smartResults.anomaly?.rowIndices.length) {
    const set = new Set(smartResults.anomaly.rowIndices);
    ctx.strokeStyle = "#ff6b6b";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    let rowIdx = 0;
    for (const r of rows) {
      const x = Number(r[xIdx]);
      const y = Number(r[yIdx]);
      if (!isNaN(x) && !isNaN(y) && set.has(rowIdx)) {
        ctx.beginPath();
        ctx.arc(toSx(x), toSy(y), 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      rowIdx++;
    }
    ctx.setLineDash([]);
  }

  // Trend line
  if (smartResults.trend?.points.length === 2 && activeChart.kind === "scatter") {
    const [p0, p1] = smartResults.trend.points;
    ctx.strokeStyle = "rgba(0, 214, 143, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(toSx(p0.x), toSy(p0.y));
    ctx.lineTo(toSx(p1.x), toSy(p1.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Forecast line
  if (smartResults.forecast?.points.length && (activeChart.kind === "scatter" || activeChart.kind === "line")) {
    const pts = smartResults.forecast.points;
    ctx.strokeStyle = "rgba(255, 217, 61, 0.95)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(toSx(pts[0]!.x), toSy(pts[0]!.y));
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(toSx(pts[i]!.x), toSy(pts[i]!.y));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 217, 61, 0.9)";
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(toSx(p.x), toSy(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Reference lines
  if (smartResults.referenceLines?.lines.length) {
    const { axis, lines } = smartResults.referenceLines;
    const range = axis === "x" ? xMax - xMin || 1 : yMax - yMin || 1;
    const min = axis === "x" ? xMin : yMin;
    const colors: Record<string, string> = {
      mean: "#00d68f",
      median: "#6c5ce7",
      q1: "#74b9ff",
      q3: "#e77c5c",
    };
    lines.forEach((line) => {
      const v = line.value;
      ctx.strokeStyle = colors[line.type] ?? "#6b6b78";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      if (axis === "x") {
        const sx = toSx(v);
        ctx.moveTo(sx, pad);
        ctx.lineTo(sx, h - pad);
      } else {
        const sy = toSy(v);
        ctx.moveTo(pad, sy);
        ctx.lineTo(w - pad, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }
}

// --- Line dash helper ---
function applyLineDash(ctx: CanvasRenderingContext2D, style?: string) {
  switch (style) {
    case "dashed": ctx.setLineDash([8, 4]); break;
    case "dotted": ctx.setLineDash([2, 3]); break;
    default: ctx.setLineDash([]); break;
  }
}

// --- Monotone cubic interpolation (Fritsch–Carlson) ---
// Smooth, but never overshoots the data: no dips below zero or false peaks between points.
function drawSmoothLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 2) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (n === 2) {
    ctx.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x || 1e-6);
    slope.push((pts[i + 1]!.y - pts[i]!.y) / dx[i]!);
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) m.push(0);
    else {
      // Weighted harmonic mean keeps the curve inside each segment's range
      const w1 = 2 * dx[i]! + dx[i - 1]!;
      const w2 = dx[i]! + 2 * dx[i - 1]!;
      m.push((w1 + w2) / (w1 / a + w2 / b));
    }
  }
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]! / 3;
    ctx.bezierCurveTo(p0.x + h, p0.y + m[i]! * h, p1.x - h, p1.y - m[i + 1]! * h, p1.x, p1.y);
  }
}

function numRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const v = Number(r[idx]); if (!isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

/** Normalize a column to 0–1 for encoding (numeric: min-max, nominal: category index / count). */
function encodingNorm(rows: unknown[][], idx: number): (row: unknown[]) => number {
  const firstNum = rows.some(r => typeof r[idx] === "number" || !isNaN(Number(r[idx])));
  if (firstNum) {
    const [min, max] = numRange(rows, idx);
    const range = max - min || 1;
    return (row: unknown[]) => {
      const v = Number(row[idx]);
      return isNaN(v) ? 0.5 : (v - min) / range;
    };
  }
  const catMap = new Map<string, number>();
  let next = 0;
  for (const r of rows) {
    const k = String(r[idx]);
    if (!catMap.has(k)) catMap.set(k, next++);
  }
  const n = catMap.size;
  return (row: unknown[]) => {
    const k = String(row[idx]);
    const i = catMap.get(k) ?? 0;
    return n <= 1 ? 1 : i / (n - 1);
  };
}

function renderFullScatter(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  sizeIdx: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  encodingIndices?: { glowIdx: number; outlineIdx: number; opacityIdx: number },
  clusterByRow?: Record<number, number>,
  viewBounds?: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const [dataXMin, dataXMax] = numRange(rows, xi);
  const [dataYMin, dataYMax] = numRange(rows, yi);
  const xMin = viewBounds?.xMin ?? dataXMin;
  const xMax = viewBounds?.xMax ?? dataXMax;
  const yMin = viewBounds?.yMin ?? dataYMin;
  const yMax = viewBounds?.yMax ?? dataYMax;
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const catMap = new Map<string, number>();
  let next = 0;

  const glowIdx = encodingIndices?.glowIdx ?? -1;
  const outlineIdx = encodingIndices?.outlineIdx ?? -1;
  const opacityIdx = encodingIndices?.opacityIdx ?? -1;
  const getGlowNorm = glowIdx >= 0 ? encodingNorm(rows, glowIdx) : null;
  const getOutlineNorm = outlineIdx >= 0 ? encodingNorm(rows, outlineIdx) : null;
  const getOpacityNorm = opacityIdx >= 0 ? encodingNorm(rows, opacityIdx) : null;
  const glowIntensity = opts?.glowIntensity ?? 8;

  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);
  let nValid = 0;
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (!isNaN(x) && !isNaN(y)) nValid++;
  }
  const marks = densityAwarePointMarks({
    n: nValid,
    plotW,
    plotH,
    hasSizeEncoding: sizeIdx >= 0,
    sizeScale: opts?.sizeScale ?? 1,
    pointSize: opts?.pointSize ?? 12,
    opacity: opts?.opacity ?? 0.7,
    opacityUserSet: opts?.opacityUserSet,
  });
  const baseAlpha = marks.opacity;
  const baseRadius = marks.minR;
  const maxSizeRadius = marks.maxR;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  const toSX = (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (w - 2 * pad);
  const toSY = (v: number) => h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * pad);
  if (opts) opts.scales = { x: toSX, y: toSY, valueAxis: "y", rect: plotOf(w, h, pad) };
  if (opts?.showMarginals) drawScatterMarginals(ctx, rows, xi, yi, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts?.connectTrail) drawScatterTrail(ctx, rows, xi, yi, ci, toSX, toSY, opts);

  const shape = opts?.markShape ?? "circle";
  const jitterPx = opts?.markJitter ?? 0;
  let pointIdx = 0;
  let rowIdx = 0;
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let cat = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, next++);
      cat = catMap.get(k)!;
    }
    let radius = baseRadius;
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = baseRadius + Math.sqrt(Math.max(0, Math.min(1, t))) * (maxSizeRadius - baseRadius);
      }
    } else {
      radius = (baseRadius + maxSizeRadius) / 2;
    }
    let sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    let sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
    if (jitterPx > 0) {
      sx += jitter(pointIdx * 2, jitterPx);
      sy += jitter(pointIdx * 2 + 1, jitterPx);
    }
    pointIdx++;

    const useCluster = clusterByRow != null && clusterByRow[rowIdx] !== undefined;
    const fillColor = useCluster
      ? cols[(clusterByRow[rowIdx] ?? 0) % cols.length]
      : cols[cat % cols.length];
    rowIdx++;

    let pointOverrides: PointVisualOverrides | undefined;
    if (getGlowNorm || getOutlineNorm || getOpacityNorm) {
      const gNorm = getGlowNorm ? getGlowNorm(r) : 0;
      const oNorm = getOutlineNorm ? getOutlineNorm(r) : 0;
      const pNorm = getOpacityNorm ? getOpacityNorm(r) : 1;
      pointOverrides = {
        alpha: getOpacityNorm != null ? Math.max(0.15, baseAlpha * (0.3 + 0.7 * pNorm)) : undefined,
        glow: getGlowNorm != null ? (gNorm > 0.05 ? gNorm * glowIntensity : 0) : undefined,
        stroke: getOutlineNorm != null ? oNorm > 0.3 : undefined,
        strokeWidth: getOutlineNorm != null && oNorm > 0.3 ? 0.5 + oNorm * 2 : undefined,
      };
    }

    drawMark(ctx, shape, sx, sy, radius, fillColor, baseAlpha, opts, pointOverrides);
    if (opts?.hits) {
      const cols2 = [fieldLabel(opts, xi), fieldLabel(opts, yi)];
      const vals: (string | number | null)[] = [formatTooltipNumber(x), formatTooltipNumber(y)];
      if (ci >= 0) { cols2.unshift(fieldLabel(opts, ci)); vals.unshift(String(r[ci])); }
      opts.hits.push({
        shape: "circle", cx: sx, cy: sy, r: Math.max(4, radius),
        match: [[xi, String(r[xi])], [yi, String(r[yi])]],
        summary: { columns: cols2, row: vals },
      });
    }
  }
  ctx.globalAlpha = 1;
  if (ci >= 0 && !clusterByRow) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: cols[i % cols.length]! })));
  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
}

function aggregateValues(values: number[], agg: YAggregateOption): number {
  if (values.length === 0) return 0;
  if (agg === "count") return values.length;
  if (agg === "sum") return values.reduce((a, b) => a + b, 0);
  if (agg === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === "min") return Math.min(...values);
  if (agg === "max") return Math.max(...values);
  return values.reduce((a, b) => a + b, 0);
}

// --- Shared renderer plumbing (hit targets, field names, legends) ---

function pushHit(opts: ChartRenderOpts | undefined, t: HitTarget) {
  opts?.hits?.push(t);
}

function fieldLabel(opts: ChartRenderOpts | undefined, idx: number, fallback = "value"): string {
  return (idx >= 0 ? opts?.fieldNames?.[idx] : undefined) ?? fallback;
}

/** "Count" / "Sum of revenue" / "Average price" for the active aggregate. */
function valueTitle(opts: ChartRenderOpts | undefined, yi: number, fallbackAgg: YAggregateOption = "sum"): string {
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? fallbackAgg);
  return aggregateAxisTitle(agg, yi >= 0 ? fieldLabel(opts, yi) : null);
}

/** Renderers report the series they colored so the shared legend matches exactly. */
function setLegend(opts: ChartRenderOpts | undefined, entries: { label: string; color: string }[]) {
  if (opts) opts.legend = entries;
}

function plotOf(w: number, h: number, pad: number): PlotRect {
  return { left: pad, top: pad, right: w - pad, bottom: h - pad };
}

function widestText(ctx: CanvasRenderingContext2D, labels: string[], font: string): number {
  ctx.save();
  ctx.font = font;
  let m = 0;
  for (const l of labels) m = Math.max(m, ctx.measureText(l).width);
  ctx.restore();
  return m;
}

function axisFont(opts: ChartRenderOpts | undefined, size?: number): string {
  return `${size ?? Math.max(9, opts?.axisFontSize ?? 10)}px '${opts?.fontFamily ?? "Inter"}', sans-serif`;
}

/** Category label gutter for horizontal-band charts: room for the widest label, capped. */
function labelGutter(ctx: CanvasRenderingContext2D, labels: string[], w: number, pad: number, opts?: ChartRenderOpts): number {
  const widest = widestText(ctx, labels, axisFont(opts));
  return Math.min((w - 2 * pad) * 0.36, widest + 12);
}

/** Bar path with rounded corners on the free end only. */
function barPath(ctx: CanvasRenderingContext2D, x: number, y: number, bw: number, bh: number, r: number, dir: "up" | "down" | "right") {
  const rr = Math.max(0, Math.min(r, bw / 2, bh / 2));
  if (rr <= 0.5) {
    ctx.rect(x, y, bw, bh);
    return;
  }
  if (dir === "up") {
    roundedRect(ctx, x, y, bw, bh, rr);
  } else if (dir === "down") {
    ctx.moveTo(x, y);
    ctx.lineTo(x + bw, y);
    ctx.lineTo(x + bw, y + bh - rr);
    ctx.arcTo(x + bw, y + bh, x + bw - rr, y + bh, rr);
    ctx.lineTo(x + rr, y + bh);
    ctx.arcTo(x, y + bh, x, y + bh - rr, rr);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + bw - rr, y);
    ctx.arcTo(x + bw, y, x + bw, y + rr, rr);
    ctx.lineTo(x + bw, y + bh - rr);
    ctx.arcTo(x + bw, y + bh, x + bw - rr, y + bh, rr);
    ctx.lineTo(x, y + bh);
    ctx.closePath();
  }
}

/** Zero rule for value axes that cross zero. */
function drawZeroLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, opts?: ChartRenderOpts) {
  ctx.save();
  ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? "#6b6b78";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** Dashed user reference lines with a value pill; "y" lines sit on the chart's value axis. */
function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  lines: { id: string; axis: "x" | "y"; value: number; label: string }[],
  scales: NonNullable<ChartRenderOpts["scales"]>,
  opts?: ChartRenderOpts,
) {
  const { rect } = scales;
  const font = axisFont(opts, 10);
  ctx.save();
  for (const line of lines) {
    // "y" means the measure axis — which is X on horizontal bars / lollipops / strips
    const axis = line.axis === "y" ? (scales.valueAxis ?? "y") : scales.valueAxis === "x" ? "y" : "x";
    const scale = axis === "x" ? scales.x : scales.y;
    if (!scale || !Number.isFinite(line.value)) continue;
    const p = scale(line.value);
    const inside = axis === "x" ? p >= rect.left - 0.5 && p <= rect.right + 0.5 : p >= rect.top - 0.5 && p <= rect.bottom + 0.5;
    if (!inside) continue;
    ctx.strokeStyle = opts?.themeText ?? "#e8e8ec";
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (axis === "x") {
      ctx.moveTo(Math.round(p) + 0.5, rect.top);
      ctx.lineTo(Math.round(p) + 0.5, rect.bottom);
    } else {
      ctx.moveTo(rect.left, Math.round(p) + 0.5);
      ctx.lineTo(rect.right, Math.round(p) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Label pill at the far end of the line
    const text = `${line.label || "Ref"} · ${formatDataValue(line.value)}`;
    ctx.font = font;
    const tw = ctx.measureText(text).width + 10;
    const bx = axis === "x" ? Math.min(rect.right - tw, p + 4) : rect.right - tw;
    const by = axis === "x" ? rect.top + 2 : p - 18;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.beginPath();
    roundedBox(ctx, bx, by, tw, 16, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 5, by + 8);
  }
  ctx.restore();
}

/** Scatter trail: points joined in row order (time order for feeds), one path per color group. */
function drawScatterTrail(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  toSX: (v: number) => number,
  toSY: (v: number) => number,
  opts?: ChartRenderOpts,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const paths = new Map<string, { x: number; y: number }[]>();
  for (const r of rows) {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const k = ci >= 0 ? String(r[ci]) : "";
    if (!paths.has(k)) paths.set(k, []);
    paths.get(k)!.push({ x: toSX(x), y: toSY(y) });
  }
  ctx.save();
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  let i = 0;
  for (const pts of paths.values()) {
    ctx.strokeStyle = cols[i++ % cols.length]!;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }
  ctx.restore();
}

/** Marginal histograms hugging the bottom (x) and left (y) edges inside the plot. */
function drawScatterMarginals(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const bins = 32;
  const cx = new Array<number>(bins).fill(0);
  const cy = new Array<number>(bins).fill(0);
  for (const r of rows) {
    const x = Number(r[xi]);
    const y = Number(r[yi]);
    if (Number.isFinite(x) && x >= xMin && x <= xMax) cx[Math.min(bins - 1, Math.floor(((x - xMin) / (xMax - xMin || 1)) * bins))]! += 1;
    if (Number.isFinite(y) && y >= yMin && y <= yMax) cy[Math.min(bins - 1, Math.floor(((y - yMin) / (yMax - yMin || 1)) * bins))]! += 1;
  }
  const depth = Math.min(36, (Math.min(w, h) - 2 * pad) * 0.12);
  const mx = Math.max(1, ...cx);
  const my = Math.max(1, ...cy);
  const plotW = w - 2 * pad;
  const plotH = h - 2 * pad;
  ctx.save();
  ctx.fillStyle = (opts?.colors ?? DEFAULT_COLORS)[0]!;
  ctx.globalAlpha = 0.28;
  for (let b = 0; b < bins; b++) {
    const bh = (cx[b]! / mx) * depth;
    ctx.fillRect(pad + (b / bins) * plotW + 0.5, h - pad - bh, plotW / bins - 1, bh);
    const bw = (cy[b]! / my) * depth;
    ctx.fillRect(pad, h - pad - ((b + 1) / bins) * plotH + 0.5, bw, plotH / bins - 1);
  }
  ctx.restore();
}

/** X axis for an ordered model: number ticks, calendar ticks, or thinned category labels. */
function drawXModelAxis(ctx: CanvasRenderingContext2D, model: XModel, w: number, h: number, rect: PlotRect, opts?: ChartRenderOpts) {
  const span = rect.right - rect.left;
  if (model.kind === "number" && model.domain) {
    drawChartTicks(ctx, model.domain[0], model.domain[1], 0, 1, w, h, rect, opts, { y: false });
  } else if (model.kind === "time" && model.domain) {
    const [d0, d1] = model.domain;
    const tt = timeTicks(d0, d1, Math.max(2, Math.floor(span / 90)));
    drawPositionedLabelsX(
      ctx,
      tt.ticks.map((t) => ({ x: rect.left + ((t - d0) / (d1 - d0 || 1)) * span, label: tt.format(t) })),
      w,
      h,
      rect,
      opts,
    );
  } else {
    const n = Math.max(1, model.keys.length);
    drawBandAxisX(ctx, model.keys, model.pos.map((t) => rect.left + t * span), span / n, w, h, rect, opts, "ordered");
  }
}

/** Orient a sequential ramp so the high end contrasts most with the background (dark-on-light, light-on-dark). */
function densityStops(stops: string[], themeBg?: string): string[] {
  if (stops.length < 2) return stops;
  const lum = (hex: string) => {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
    if (!m) return 0.5;
    return (0.2126 * parseInt(m[1]!, 16) + 0.7152 * parseInt(m[2]!, 16) + 0.0722 * parseInt(m[3]!, 16)) / 255;
  };
  const bg = lum(themeBg ?? "#111114");
  const lo = Math.abs(lum(stops[0]!) - bg);
  const hi = Math.abs(lum(stops[stops.length - 1]!) - bg);
  return hi >= lo ? stops : [...stops].reverse();
}

/**
 * Long daily / hourly series turn into a wall of spikes. When a time axis has more
 * than ~90 distinct points, roll rows up to weeks or months (by span) so the trend
 * reads; keys become the bucket start ("2024-03-01"), which the time axis labels.
 */
function timeBuckets(rows: unknown[][], xi: number): {
  keyOf: (r: unknown[]) => string;
  unit: "" | "day" | "week" | "month" | "year";
  firstRow: Map<string, number>;
} {
  const raw = [...new Set(rows.map((r) => String(r[xi])))];
  const plain = { keyOf: (r: unknown[]) => String(r[xi]), unit: "" as const, firstRow: new Map<string, number>() };
  if (raw.length <= 90) return plain;
  const cls = classifyKeys(raw);
  if (cls.kind !== "time") return plain;
  const t0 = cls.values[0]!;
  const t1 = cls.values[cls.values.length - 1]!;
  const days = (t1 - t0) / 86_400_000;
  const unit = days > 365 * 12 ? "year" : days > 540 ? "month" : days > 120 ? "week" : "day";
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const bucket = (ms: number) => {
    const d = new Date(ms);
    if (unit === "year") return `${d.getUTCFullYear()}-01-01`;
    if (unit === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    if (unit === "week") {
      const dow = (d.getUTCDay() + 6) % 7; // Monday-start weeks
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)));
    }
    return iso(d);
  };
  const cache = new Map<string, string>();
  const keyOf = (r: unknown[]) => {
    const k = String(r[xi]);
    let b = cache.get(k);
    if (b === undefined) {
      const ms = Date.parse(k);
      b = Number.isFinite(ms) ? bucket(ms) : k;
      cache.set(k, b);
    }
    return b;
  };
  const firstRow = new Map<string, number>();
  rows.forEach((r, i) => {
    const b = keyOf(r);
    if (!firstRow.has(b)) firstRow.set(b, i);
  });
  return { keyOf, unit, firstRow };
}

// --- Bars ---

type BarModel = { entries: [string, number][]; rowCounts: Map<string, number>; ordered: boolean };

/** Aggregate simple bars. Ordered keys (numbers, dates) keep their order; categories rank by value (Top N). */
function computeBarModel(rows: unknown[][], xi: number, yi: number, agg: YAggregateOption, topN = DEFAULT_TOP_N): BarModel {
  const limit = clampTopN(topN, DEFAULT_TOP_N);
  const groups = new Map<string, number[]>();
  const rowCounts = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    rowCounts.set(k, (rowCounts.get(k) ?? 0) + 1);
    if (yi < 0) groups.get(k)!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) groups.get(k)!.push(v);
    }
  }
  const all = [...groups.entries()].map(([label, vals]) => [label, aggregateValues(vals, agg)] as [string, number]);
  const cls = classifyKeys(all.map((e) => e[0]));
  if (cls.kind !== "band" && cls.sorted.length >= 3 && cls.sorted.length <= Math.max(40, limit)) {
    const byKey = new Map(all);
    return { entries: cls.sorted.map((k) => [k, byKey.get(k) ?? 0] as [string, number]), rowCounts, ordered: true };
  }
  return { entries: all.sort((a, b) => b[1] - a[1]).slice(0, limit), rowCounts, ordered: false };
}

/** Horizontal bands when the stage is portrait or category names can't sit flat under their bars. */
function barsShouldBeHorizontal(ctx: CanvasRenderingContext2D, model: BarModel, w: number, h: number, pad: number, opts?: ChartRenderOpts): boolean {
  const n = model.entries.length;
  if (n === 0) return false;
  if (h > w * 1.05) return true;
  if (model.ordered) return false;
  const band = (w - 2 * pad) / n;
  const widest = widestText(ctx, model.entries.map((e) => e[0]), axisFont(opts));
  return widest > band - 6;
}

function renderFullBar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  facet?: BarFacetHitPayload | null,
  horizontal = false,
  model?: BarModel,
  colorByCategory = false,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const cornerR = opts?.barCornerRadius ?? 3;
  const showDataLabels = opts?.showDataLabels ?? false;
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const rect = plotOf(w, h, pad);
  const chartW = rect.right - rect.left;
  const xName = fieldLabel(opts, xi, "category");
  const vTitle = valueTitle(opts, yi);

  if (facet && ci >= 0 && facet.grid.length > 0 && facet.subLabels.length > 0) {
    const { xLabels, subLabels, grid, stackMode } = facet;
    const nx = xLabels.length;
    const ns = subLabels.length;
    const band = chartW / nx;
    const cName = fieldLabel(opts, ci, "group");
    setLegend(opts, subLabels.map((label, si) => ({ label, color: cols[si % cols.length]! })));

    let lo = 0;
    let hi = 0;
    if (stackMode === "grouped") {
      for (const row of grid) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    } else if (stackMode === "stacked") {
      for (const row of grid) hi = Math.max(hi, row.reduce((s, v) => s + Math.max(0, v), 0));
    } else {
      hi = 100;
    }
    const scale = stackMode === "percent" ? niceTicks(0, 100, opts?.tickCount ?? 5, true) : niceZeroScale(lo, hi, opts?.tickCount ?? 5);
    const Y = linear(scale.min, scale.max, rect.bottom, rect.top);
    if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
    drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [scale.min, scale.max] });

    const centers: number[] = [];
    for (let gi = 0; gi < nx; gi++) {
      const xk = xLabels[gi]!;
      const gx = rect.left + gi * band;
      centers.push(gx + band / 2);
      if (stackMode === "grouped") {
        const inner = band * 0.8;
        const innerW = inner / ns;
        for (let si = 0; si < ns; si++) {
          const val = grid[gi]![si]!;
          const x = gx + (band - inner) / 2 + si * innerW;
          const y0 = Y(0);
          const y1 = Y(val);
          const top = Math.min(y0, y1);
          const bh = Math.max(val === 0 ? 0 : 1, Math.abs(y1 - y0));
          ctx.fillStyle = cols[si % cols.length]!;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          barPath(ctx, x + 0.5, top, Math.max(1, innerW - 1), bh, cornerR, val >= 0 ? "up" : "down");
          ctx.fill();
          if (showDataLabels && innerW >= 18 && bh > 0) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = axisLabelColor;
            ctx.font = axisFont(opts, 9);
            ctx.textAlign = "center";
            ctx.textBaseline = val >= 0 ? "bottom" : "top";
            ctx.fillText(formatDataValue(val), x + innerW / 2, val >= 0 ? top - 3 : top + bh + 3);
          }
          pushHit(opts, {
            shape: "rect", x, y: rect.top, w: innerW, h: rect.bottom - rect.top,
            match: [[xi, xk], [ci, subLabels[si]!]],
            summary: { columns: [xName, cName, vTitle], row: [xk, subLabels[si]!, formatTooltipNumber(val)] },
          });
        }
      } else {
        const bw = Math.min(band * 0.72, 96);
        const x0 = gx + (band - bw) / 2;
        const total = grid[gi]!.reduce((s, v) => s + Math.max(0, v), 0) || 1;
        let acc = 0;
        for (let si = 0; si < ns; si++) {
          const v = Math.max(0, grid[gi]![si]!);
          const share = (v / total) * 100;
          const a = stackMode === "percent" ? acc / total * 100 : acc;
          const b = stackMode === "percent" ? (acc + v) / total * 100 : acc + v;
          acc += v;
          const yTop = Y(b);
          const yBot = Y(a);
          if (yBot - yTop < 0.25) continue;
          ctx.fillStyle = cols[si % cols.length]!;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.rect(x0, yTop, bw, yBot - yTop);
          ctx.fill();
          // Hairline separator between stacked segments
          ctx.globalAlpha = 1;
          ctx.strokeStyle = opts?.themeBg ?? "#111114";
          ctx.lineWidth = 0.75;
          ctx.beginPath();
          ctx.moveTo(x0, yTop);
          ctx.lineTo(x0 + bw, yTop);
          ctx.stroke();
          pushHit(opts, {
            shape: "rect", x: x0, y: yTop, w: bw, h: yBot - yTop,
            match: [[xi, xk], [ci, subLabels[si]!]],
            summary: {
              columns: [xName, cName, vTitle, "Share"],
              row: [xk, subLabels[si]!, formatTooltipNumber(v), `${share.toFixed(share < 10 ? 1 : 0)}%`],
            },
          });
        }
      }
    }
    ctx.globalAlpha = 1;
    if (scale.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
    drawChartTicks(ctx, 0, 1, scale.min, scale.max, w, h, rect, opts, {
      x: false,
      yFormat: stackMode === "percent" ? (v) => `${Math.round(v)}%` : undefined,
    });
    drawBandAxisX(ctx, xLabels, centers, band, w, h, rect, opts, "nominal");
    return;
  }

  const bm = model ?? computeBarModel(rows, xi, yi, yi < 0 ? "count" : (opts?.yAggregate ?? "sum"));
  const entries = bm.entries;
  if (entries.length === 0) return;
  const n = entries.length;
  const vals = entries.map((e) => e[1]);
  const vMin = Math.min(0, ...vals);
  const vMax = Math.max(0, ...vals);
  const colorOf = (i: number) => (colorByCategory ? cols[i % cols.length]! : cols[0]!);
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const summaryFor = (label: string, val: number) => {
    const rowsIn = bm.rowCounts.get(label) ?? 0;
    return agg === "count"
      ? { columns: [xName, vTitle], row: [label, formatTooltipNumber(val)] }
      : { columns: [xName, vTitle, "Rows"], row: [label, formatTooltipNumber(val), formatTooltipNumber(rowsIn)] };
  };
  if (colorByCategory) setLegend(opts, []);

  if (horizontal) {
    // Category names read left-to-right in a gutter; values sit at the bar ends.
    const band = (rect.bottom - rect.top) / n;
    const labelW = labelGutter(ctx, entries.map((e) => e[0]), w, pad, opts);
    const x0 = rect.left + labelW;
    const valueFont = axisFont(opts);
    const valueRoom = widestText(ctx, vals.map(formatDataValue), valueFont) + 10;
    const plotW = Math.max(8, rect.right - x0 - valueRoom);
    const X = linear(vMin, vMax || 1, x0, x0 + plotW);
    if (opts) opts.scales = { x: X, valueAxis: "x", rect: { left: x0, top: rect.top, right: x0 + plotW, bottom: rect.bottom } };
    const barT = Math.max(2, Math.min(band * 0.72, 30));
    const centers: number[] = [];
    entries.forEach(([label, val], i) => {
      const yMid = rect.top + band * (i + 0.5);
      centers.push(yMid);
      const xa = X(0);
      const xb = X(val);
      const left = Math.min(xa, xb);
      const len = Math.max(val === 0 ? 0 : 1, Math.abs(xb - xa));
      ctx.fillStyle = colorOf(i);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      if (val >= 0) barPath(ctx, left, yMid - barT / 2, len, barT, cornerR, "right");
      else ctx.rect(left, yMid - barT / 2, len, barT);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = valueFont;
      ctx.textBaseline = "middle";
      ctx.textAlign = val >= 0 ? "left" : "right";
      ctx.fillText(formatDataValue(val), val >= 0 ? left + len + 5 : left - 5, yMid);
      pushHit(opts, {
        shape: "rect", x: rect.left, y: rect.top + band * i, w: rect.right - rect.left, h: band,
        match: [[xi, label]],
        summary: summaryFor(label, val),
      });
    });
    ctx.textBaseline = "alphabetic";
    // Baseline at zero replaces the L-frame (category labels sit left of it)
    drawZeroLine(ctx, X(0), rect.top, X(0), rect.bottom, opts);
    drawBandAxisY(ctx, entries.map((e) => e[0]), centers, band, x0 - 8, labelW - 10, opts);
    ctx.globalAlpha = 1;
    return;
  }

  const scale = niceZeroScale(vMin, vMax, opts?.tickCount ?? 5);
  const Y = linear(scale.min, scale.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [scale.min, scale.max] });
  const band = chartW / n;
  const barW = Math.max(1, Math.min(band * (n > 24 ? 0.86 : 0.72), 96));
  const centers: number[] = [];
  entries.forEach(([label, val], i) => {
    const cx = rect.left + band * (i + 0.5);
    centers.push(cx);
    const y0 = Y(0);
    const y1 = Y(val);
    const top = Math.min(y0, y1);
    const bh = Math.max(val === 0 ? 0 : 1, Math.abs(y1 - y0));
    ctx.fillStyle = colorOf(i);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    barPath(ctx, cx - barW / 2, top, barW, bh, cornerR, val >= 0 ? "up" : "down");
    ctx.fill();
    if (showDataLabels) {
      const lbl = formatDataValue(val);
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = axisFont(opts, 10);
      if (ctx.measureText(lbl).width <= band + 2) {
        ctx.textAlign = "center";
        ctx.textBaseline = val >= 0 ? "bottom" : "top";
        ctx.fillText(lbl, cx, val >= 0 ? top - 3 : top + bh + 3);
      }
    }
    pushHit(opts, {
      shape: "rect", x: rect.left + band * i, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, label]],
      summary: summaryFor(label, val),
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (scale.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, scale.min, scale.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, entries.map((e) => e[0]), centers, band, w, h, rect, opts, bm.ordered ? "ordered" : "nominal");
}

function renderFullHistogram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const values = rows.map((r) => Number(r[xi]));
  const bins = histogramBins(values);
  if (!bins) return;
  const rect = plotOf(w, h, pad);
  const maxC = Math.max(1, ...bins.counts);
  const ys = niceZeroScale(0, maxC, opts?.tickCount ?? 5);
  const X = linear(bins.lo, bins.hi, rect.left, rect.right);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { x: X, y: Y, valueAxis: "y", rect };
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });

  // Representative row per bin for the tooltip
  const firstRow = new Array<number>(bins.counts.length).fill(-1);
  values.forEach((v, ri) => {
    if (!Number.isFinite(v)) return;
    const bi = Math.min(bins.counts.length - 1, Math.max(0, Math.floor((v - bins.lo) / bins.step + 1e-9)));
    if (firstRow[bi]! < 0) firstRow[bi] = ri;
  });
  const name = fieldLabel(opts, xi);
  bins.counts.forEach((c, i) => {
    const a = bins.lo + i * bins.step;
    const b = a + bins.step;
    const x0 = X(a);
    const x1 = X(b);
    const top = Y(c);
    ctx.fillStyle = cols[0]!;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x0 + 0.5, top, Math.max(1, x1 - x0 - 1), rect.bottom - top);
    if (firstRow[i]! >= 0) {
      pushHit(opts, {
        shape: "rect", x: x0, y: rect.top, w: x1 - x0, h: rect.bottom - rect.top,
        match: [],
        rowIndex: firstRow[i]!,
        summary: {
          columns: [name, "Count"],
          row: [`${formatAxisValue(a, bins.step)} – ${formatAxisValue(b, bins.step)}`, formatTooltipNumber(c)],
        },
      });
    }
  });
  ctx.globalAlpha = 1;
  drawChartTicks(ctx, bins.lo, bins.hi, ys.min, ys.max, w, h, rect, opts);
}

function renderFullLine(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  y2Idx = -1,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = Math.max(0.85, opts?.opacity ?? 0.9);
  const lineW = Math.max(1.5, opts?.lineWidth ?? 2);
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "mean");
  const rect = plotOf(w, h, pad);
  const span = rect.right - rect.left;
  const comparePrev = !!opts?.comparePrevious;

  // Series in first-appearance order; cap at the 10 largest so the legend stays readable
  const seriesRows = new Map<string, unknown[][]>();
  for (const r of rows) {
    const k = ci >= 0 ? String(r[ci]) : "";
    if (!seriesRows.has(k)) seriesRows.set(k, []);
    seriesRows.get(k)!.push(r);
  }
  let series = [...seriesRows.entries()];
  if (series.length > 10) {
    const keep = new Set(series.sort((a, b) => b[1].length - a[1].length).slice(0, 10).map((s) => s[0]));
    series = [...seriesRows.entries()].filter(([k]) => keep.has(k));
  }

  const tb = timeBuckets(rows, xi);
  const model = buildXModel([...new Set(rows.map(tb.keyOf))]);
  if (model.keys.length === 0) return;
  const posOf = new Map(model.keys.map((k, i) => [k, model.pos[i]!]));

  const seriesFrom = (measureIdx: number, nameSuffix = "") =>
    series.map(([name, gRows]) => {
      const byX = new Map<string, number[]>();
      for (const r of gRows) {
        const k = tb.keyOf(r);
        if (!posOf.has(k)) continue;
        if (!byX.has(k)) byX.set(k, []);
        if (measureIdx < 0) byX.get(k)!.push(1);
        else {
          const v = Number(r[measureIdx]);
          if (!isNaN(v)) byX.get(k)!.push(v);
        }
      }
      const pts = model.keys
        .filter((k) => byX.has(k) && (measureIdx < 0 || byX.get(k)!.length > 0))
        .map((k) => ({ key: k, t: posOf.get(k)!, v: aggregateValues(byX.get(k)!, agg) }));
      return { name: nameSuffix ? `${name || "series"}${nameSuffix}` : name, pts, compare: !!nameSuffix };
    }).filter((s) => s.pts.length > 0);

  let data = seriesFrom(yi);
  if (data.length === 0) return;

  // Earlier half of the X domain as a dashed overlay (same series, first 50% of keys)
  if (comparePrev && model.keys.length >= 4) {
    const mid = Math.floor(model.keys.length / 2);
    const earlier = new Set(model.keys.slice(0, mid));
    const prevOverlay = data.map((s) => ({
      name: `${s.name || "series"} (earlier)`,
      pts: s.pts.filter((p) => earlier.has(p.key)),
      compare: true as const,
    })).filter((s) => s.pts.length >= 2);
    data = [...prevOverlay, ...data];
  }

  if (y2Idx >= 0 && y2Idx !== yi) {
    const y2 = seriesFrom(y2Idx, ` · ${opts?.fieldNames?.[y2Idx] ?? "Y2"}`).map((s) => ({ ...s, compare: true }));
    data = [...data, ...y2];
  }

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of data) for (const p of s.pts) { yMin = Math.min(yMin, p.v); yMax = Math.max(yMax, p.v); }
  // Counts and sums read best from zero; averages zoom to their range
  if (agg === "count" || (agg === "sum" && yMin >= 0)) yMin = Math.min(0, yMin);
  const ys = niceTicks(yMin, yMax, opts?.tickCount ?? 5, true);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) {
    const dom = model.domain;
    opts.scales = { y: Y, x: dom ? (v: number) => rect.left + ((v - dom[0]) / (dom[1] - dom[0] || 1)) * span : undefined, valueAxis: "y", rect };
  }
  const X = (t: number) => rect.left + t * span;

  drawChartGrid(ctx, w, h, rect, opts, { x: model.kind === "number" ? model.domain : null, y: [ys.min, ys.max] });

  const xName = fieldLabel(opts, xi) + (tb.unit ? ` (${tb.unit})` : "");
  const cName = fieldLabel(opts, ci, "series");
  const vTitle = valueTitle(opts, yi, "mean");
  const maxPts = Math.max(...data.map((s) => s.pts.length));
  const hitR = Math.max(4, Math.min(12, span / Math.max(1, maxPts) / 2));
  applyLineDash(ctx, opts?.lineStrokeStyle);
  data.forEach((s, si) => {
    const color = cols[si % cols.length]!;
    const pts = s.pts.map((p) => ({ x: X(p.t), y: Y(p.v) }));
    ctx.strokeStyle = color;
    ctx.lineWidth = s.compare ? Math.max(1.25, lineW * 0.9) : lineW;
    ctx.lineJoin = "round";
    ctx.globalAlpha = s.compare ? alpha * 0.7 : alpha;
    if (s.compare) ctx.setLineDash([5, 4]);
    else applyLineDash(ctx, opts?.lineStrokeStyle);
    ctx.beginPath();
    if (opts?.lineCurveSmooth && pts.length >= 2) drawSmoothLine(ctx, pts);
    else pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    if (!s.compare && pts.length <= 40) {
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, pts.length === 1 ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      applyLineDash(ctx, opts?.lineStrokeStyle);
    }
    s.pts.forEach((p, i) => {
      pushHit(opts, {
        shape: "circle", cx: pts[i]!.x, cy: pts[i]!.y, r: hitR,
        // Bucketed keys aren't raw values — identify the bucket by its first row
        match: tb.unit ? [] : ci >= 0 ? [[xi, p.key], [ci, s.name]] : [[xi, p.key]],
        rowIndex: tb.unit ? tb.firstRow.get(p.key) : undefined,
        summary: ci >= 0
          ? { columns: [xName, cName, vTitle], row: [p.key, s.name, formatTooltipNumber(p.v)] }
          : { columns: [xName, vTitle], row: [p.key, formatTooltipNumber(p.v)] },
      });
    });
  });
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const legendSrc = data.filter((s) => !s.compare || y2Idx >= 0 || comparePrev);
  if (ci >= 0 || y2Idx >= 0 || comparePrev) {
    setLegend(opts, legendSrc.map((s, si) => ({ label: s.name || "series", color: cols[si % cols.length]! })));
  }
  if (ys.min < 0 && ys.max > 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawXModelAxis(ctx, model, w, h, rect, opts);
}

function renderFullHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const stops = densityStops(opts?.continuousStops?.length ? opts.continuousStops : (opts?.colors ?? DEFAULT_COLORS), opts?.themeBg);
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  // Color key lives in the right gutter
  const rampX = w - pad + 10;

  // Prefer quantitative density bins when both axes look numeric
  let numericHits = 0;
  const probe = Math.min(rows.length, 40);
  for (let i = 0; i < probe; i++) {
    const x = Number(rows[i]![xi]);
    const y = Number(rows[i]![yi]);
    if (!isNaN(x) && !isNaN(y)) numericHits++;
  }
  if (probe > 0 && numericHits / probe >= 0.7) {
    const rect = plotOf(w, h, pad);
    const plotW = rect.right - rect.left;
    const plotH = rect.bottom - rect.top;
    const [xMin, xMax] = numRange(rows, xi);
    const [yMin, yMax] = numRange(rows, yi);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const binsX = Math.min(36, Math.max(12, Math.floor(plotW / 18)));
    const binsY = Math.min(28, Math.max(10, Math.floor(plotH / 18)));
    const grid = new Float32Array(binsX * binsY);
    const firstRow = new Int32Array(binsX * binsY).fill(-1);
    rows.forEach((r, ri) => {
      const x = Number(r[xi]);
      const y = Number(r[yi]);
      if (isNaN(x) || isNaN(y)) return;
      const bx = Math.min(binsX - 1, Math.max(0, Math.floor(((x - xMin) / xRange) * binsX)));
      const by = Math.min(binsY - 1, Math.max(0, Math.floor(((y - yMin) / yRange) * binsY)));
      grid[by * binsX + bx]! += 1;
      if (firstRow[by * binsX + bx]! < 0) firstRow[by * binsX + bx] = ri;
    });
    let maxC = 1;
    for (let i = 0; i < grid.length; i++) maxC = Math.max(maxC, grid[i]!);
    const cellW = plotW / binsX;
    const cellH = plotH / binsY;
    for (let by = 0; by < binsY; by++) {
      for (let bx = 0; bx < binsX; bx++) {
        const c = grid[by * binsX + bx]!;
        if (c <= 0) continue;
        const t = Math.sqrt(c / maxC);
        ctx.fillStyle = sampleContinuous(stops, 0.08 + t * 0.92);
        const px = rect.left + bx * cellW;
        const py = rect.top + (binsY - 1 - by) * cellH;
        ctx.fillRect(px, py, Math.max(1, cellW - 0.5), Math.max(1, cellH - 0.5));
        const x0 = xMin + (bx / binsX) * xRange;
        const y0 = yMin + (by / binsY) * yRange;
        pushHit(opts, {
          shape: "rect", x: px, y: py, w: cellW, h: cellH,
          match: [],
          rowIndex: firstRow[by * binsX + bx]!,
          summary: {
            columns: [xName, yName, "Rows"],
            row: [
              `${formatDataValue(x0)} – ${formatDataValue(x0 + xRange / binsX)}`,
              `${formatDataValue(y0)} – ${formatDataValue(y0 + yRange / binsY)}`,
              formatTooltipNumber(c),
            ],
          },
        });
      }
    }
    drawChartTicks(ctx, xMin, xMax, yMin, yMax, w, h, rect, opts);
    drawColorRamp(ctx, stops, (s, t) => sampleContinuous(s, 0.08 + Math.sqrt(t) * 0.92), rampX, rect.top + 14, Math.min(140, plotH * 0.5), "0", formatDataValue(maxC), opts, "Rows");
    return;
  }

  // Category × category: rank by frequency (or natural order for numbers / dates)
  const orderedKeys = (idx: number) => {
    const freq = new Map<string, number>();
    for (const r of rows) freq.set(String(r[idx]), (freq.get(String(r[idx])) ?? 0) + 1);
    const cls = classifyKeys([...freq.keys()]);
    const keys = cls.kind !== "band" ? cls.sorted : [...freq.keys()].sort((a, b) => freq.get(b)! - freq.get(a)!);
    return keys.slice(0, 20);
  };
  const xLabels = orderedKeys(xi);
  const yLabels = orderedKeys(yi);
  if (xLabels.length === 0 || yLabels.length === 0) return;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = `${r[xi]}\u0000${r[yi]}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let maxC = 1;
  for (const xL of xLabels) for (const yL of yLabels) maxC = Math.max(maxC, counts.get(`${xL}\u0000${yL}`) ?? 0);

  const gutter = labelGutter(ctx, yLabels, w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const cellW = (rect.right - rect.left) / xLabels.length;
  const cellH = (rect.bottom - rect.top) / yLabels.length;
  const showValues = cellW >= 26 && cellH >= 16;
  const emptyFill = opts?.themeBorder ?? "#2a2a30";
  xLabels.forEach((xL, xi2) => {
    yLabels.forEach((yL, yi2) => {
      const c = counts.get(`${xL}\u0000${yL}`) ?? 0;
      const px = rect.left + xi2 * cellW;
      const py = rect.top + yi2 * cellH;
      const fill = c > 0 ? sampleContinuous(stops, 0.08 + (c / maxC) * 0.92) : emptyFill;
      ctx.globalAlpha = c > 0 ? 1 : 0.25;
      ctx.fillStyle = fill;
      ctx.fillRect(px + 0.5, py + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      ctx.globalAlpha = 1;
      if (showValues && c > 0) {
        ctx.fillStyle = contrastingInk(fill);
        ctx.font = axisFont(opts, Math.min(11, cellH * 0.55));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(formatDataValue(c), px + cellW / 2, py + cellH / 2);
      }
      pushHit(opts, {
        shape: "rect", x: px, y: py, w: cellW, h: cellH,
        match: c > 0 ? [[xi, xL], [yi, yL]] : [],
        summary: { columns: [xName, yName, "Rows"], row: [xL, yL, formatTooltipNumber(c)] },
      });
    });
  });
  ctx.textBaseline = "alphabetic";
  drawBandAxisX(ctx, xLabels, xLabels.map((_, i) => rect.left + (i + 0.5) * cellW), cellW, w, h, rect, opts, "nominal");
  drawBandAxisY(ctx, yLabels, yLabels.map((_, i) => rect.top + (i + 0.5) * cellH), cellH, rect.left - 8, gutter - 10, opts);
  drawColorRamp(ctx, stops, (s, t) => sampleContinuous(s, 0.08 + t * 0.92), rampX, rect.top + 14, Math.min(140, (rect.bottom - rect.top) * 0.5), "0", formatDataValue(maxC), opts, "Rows");
}

function renderFullStrip(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  encodingIndices?: { opacityIdx: number },
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const baseAlpha = opts?.opacity ?? 0.7;
  const jitterPx = opts?.markJitter ?? 0;
  const freq = new Map<string, number>();
  for (const r of rows) freq.set(String(r[yi]), (freq.get(String(r[yi])) ?? 0) + 1);
  const cls = classifyKeys([...freq.keys()]);
  const yLabels = (cls.kind !== "band" ? cls.sorted : [...freq.keys()].sort((a, b) => freq.get(b)! - freq.get(a)!)).slice(0, 15);
  if (yLabels.length === 0) return;
  const gutter = labelGutter(ctx, yLabels, w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const [dMin, dMax] = numRange(rows, xi);
  const xs = niceTicks(dMin, dMax, opts?.tickCount ?? 5, true);
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  const bandH = (rect.bottom - rect.top) / yLabels.length;
  const opacityIdx = encodingIndices?.opacityIdx ?? -1;
  const getOpacityNorm = opacityIdx >= 0 ? encodingNorm(rows, opacityIdx) : null;
  const bandOf = new Map(yLabels.map((l, i) => [l, i]));

  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });
  // Faint band separators help the eye track long rows
  ctx.save();
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.5;
  for (let i = 1; i < yLabels.length; i++) {
    const y = Math.round(rect.top + i * bandH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(rect.left, y);
    ctx.lineTo(rect.right, y);
    ctx.stroke();
  }
  ctx.restore();

  const ciMap = ci >= 0 ? new Map([...new Set(rows.map(r => String(r[ci])))].map((k, i) => [k, i])) : null;
  const tick = Math.max(3, Math.min(bandH * 0.32, 14));
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  let pointIdx = 0;
  rows.forEach((r) => {
    const x = Number(r[xi]);
    if (isNaN(x)) return;
    const yiL = bandOf.get(String(r[yi]));
    if (yiL == null) return;
    let sx = X(x);
    const sy = rect.top + yiL * bandH + bandH / 2;
    if (jitterPx > 0) sx += jitter(pointIdx * 2, jitterPx);
    pointIdx++;
    const alpha =
      getOpacityNorm != null
        ? Math.min(0.6, Math.max(0.15, baseAlpha * (0.3 + 0.7 * getOpacityNorm(r))))
        : Math.min(0.6, baseAlpha);
    ctx.beginPath();
    ctx.moveTo(sx, sy - tick);
    ctx.lineTo(sx, sy + tick);
    ctx.strokeStyle = ciMap ? cols[(ciMap.get(String(r[ci])) ?? 0) % cols.length]! : cols[0]!;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: sx - 2, y: sy - tick, w: 4, h: tick * 2,
      match: [[xi, String(r[xi])], [yi, String(r[yi])]],
      summary: { columns: [yName, xName], row: [String(r[yi]), formatTooltipNumber(x)] },
    });
  });
  ctx.globalAlpha = 1;
  if (ciMap) setLegend(opts, [...ciMap.entries()].map(([label, i]) => ({ label, color: cols[i % cols.length]! })));
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, yLabels, yLabels.map((_, i) => rect.top + (i + 0.5) * bandH), bandH, rect.left - 8, gutter - 10, opts);
}

function quartiles(sorted: number[]): { q1: number; q2: number; q3: number; min: number; max: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, q2: 0, q3: 0, min: 0, max: 0 };
  const min = sorted[0];
  const max = sorted[n - 1];
  const q2 = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const lo = sorted.slice(0, Math.floor(n / 2));
  const hi = sorted.slice(Math.ceil(n / 2));
  if (lo.length === 0 || hi.length === 0) return { q1: q2, q2, q3: q2, min, max };
  const q1 = lo.length % 2 === 1 ? lo[(lo.length - 1) / 2]! : (lo[lo.length / 2 - 1]! + lo[lo.length / 2]!) / 2;
  const q3 = hi.length % 2 === 1 ? hi[(hi.length - 1) / 2]! : (hi[hi.length / 2 - 1]! + hi[hi.length / 2]!) / 2;
  return { q1, q2, q3, min, max };
}

/** Group a numeric column by category; ordered keys keep natural order, others rank by median. */
function groupedDistributions(rows: unknown[][], gi: number, vi: number, limit: number) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r[vi]);
    if (isNaN(v)) continue;
    const k = String(r[gi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const stats = [...groups.entries()].map(([label, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    return { label, sorted: s, ...quartiles(s) };
  });
  const cls = classifyKeys(stats.map((s) => s.label));
  if (cls.kind !== "band") {
    const byKey = new Map(stats.map((s) => [s.label, s]));
    return cls.sorted.map((k) => byKey.get(k)!).filter(Boolean).slice(0, limit);
  }
  return stats.sort((a, b) => b.q2 - a.q2).slice(0, limit);
}

function renderFullBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const color = cols[0]!;
  const ink = opts?.themeText ?? "#e8e8ec";
  const boxes = groupedDistributions(rows, xi, yi, 20);
  if (boxes.length === 0) return;
  const rect = plotOf(w, h, pad);
  // Tukey whiskers: 1.5 × IQR, points beyond are outliers
  const tukey = boxes.map((b) => {
    const iqr = b.q3 - b.q1;
    const loF = b.q1 - 1.5 * iqr;
    const hiF = b.q3 + 1.5 * iqr;
    const inside = b.sorted.filter((v) => v >= loF && v <= hiF);
    return {
      lo: inside.length ? inside[0]! : b.min,
      hi: inside.length ? inside[inside.length - 1]! : b.max,
      outliers: b.sorted.filter((v) => v < loF || v > hiF),
    };
  });
  const gMin = Math.min(...boxes.map((b) => b.min));
  const gMax = Math.max(...boxes.map((b) => b.max));
  const ys = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / boxes.length;
  const boxW = Math.max(6, Math.min(band * 0.55, 72));
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const centers: number[] = [];

  boxes.forEach((box, i) => {
    const cx = rect.left + (i + 0.5) * band;
    centers.push(cx);
    const t = tukey[i]!;
    const q1y = Y(box.q1);
    const q3y = Y(box.q3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(cx, Y(t.lo)); ctx.lineTo(cx, q1y);
    ctx.moveTo(cx, q3y); ctx.lineTo(cx, Y(t.hi));
    ctx.moveTo(cx - boxW * 0.25, Y(t.lo)); ctx.lineTo(cx + boxW * 0.25, Y(t.lo));
    ctx.moveTo(cx - boxW * 0.25, Y(t.hi)); ctx.lineTo(cx + boxW * 0.25, Y(t.hi));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(cx - boxW / 2, q3y, boxW, Math.max(1, q1y - q3y));
    ctx.globalAlpha = 1;
    ctx.strokeRect(cx - boxW / 2, q3y, boxW, Math.max(1, q1y - q3y));
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - boxW / 2, Y(box.q2));
    ctx.lineTo(cx + boxW / 2, Y(box.q2));
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    for (const v of t.outliers.slice(0, 200)) {
      ctx.beginPath();
      ctx.arc(cx, Y(v), 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    pushHit(opts, {
      shape: "rect", x: rect.left + i * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, box.label]],
      summary: {
        columns: [xName, "Rows", `Median ${yName}`, "Q1 – Q3", "Min – Max"],
        row: [
          box.label,
          formatTooltipNumber(box.sorted.length),
          formatTooltipNumber(box.q2),
          `${formatTooltipNumber(box.q1)} – ${formatTooltipNumber(box.q3)}`,
          `${formatTooltipNumber(box.min)} – ${formatTooltipNumber(box.max)}`,
        ],
      },
    });
  });
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, boxes.map((b) => b.label), centers, band, w, h, rect, opts, "nominal");
}

function renderFullArea(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
  y2Idx = -1,
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const rect = plotOf(w, h, pad);
  const span = rect.right - rect.left;
  const tb = timeBuckets(rows, xi);
  const model = buildXModel([...new Set(rows.map(tb.keyOf))]);
  if (model.keys.length === 0) return;
  const keyIndex = new Map(model.keys.map((k, i) => [k, i]));

  // Series in first-appearance order (top 8 by rows when crowded)
  const seriesOrder: string[] = [];
  const seriesCount = new Map<string, number>();
  for (const r of rows) {
    const g = ci >= 0 ? String(r[ci]) : "";
    if (!seriesCount.has(g)) seriesOrder.push(g);
    seriesCount.set(g, (seriesCount.get(g) ?? 0) + 1);
  }
  const keep = new Set([...seriesOrder].sort((a, b) => seriesCount.get(b)! - seriesCount.get(a)!).slice(0, 8));
  const series = seriesOrder.filter((g) => keep.has(g));
  const buckets = series.map(() => model.keys.map(() => [] as number[]));
  for (const r of rows) {
    const si = series.indexOf(ci >= 0 ? String(r[ci]) : "");
    const ki = keyIndex.get(tb.keyOf(r));
    if (si < 0 || ki == null) continue;
    if (yi < 0) buckets[si]![ki]!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) buckets[si]![ki]!.push(v);
    }
  }
  const values = buckets.map((b) => b.map((vals) => (vals.length ? aggregateValues(vals, agg) : 0)));
  const tops: number[][] = [];
  let maxStack = 0;
  let minVal = 0;
  values.forEach((vals, si) => {
    tops.push(vals.map((v, ki) => (si === 0 ? 0 : tops[si - 1]![ki]!) + Math.max(0, v)));
    for (const v of vals) minVal = Math.min(minVal, v);
  });
  for (const t of tops[tops.length - 1] ?? []) maxStack = Math.max(maxStack, t);

  // Optional Y2 / earlier-half overlays — extend the value scale
  const overlayPts: { label: string; pts: { ki: number; v: number }[] }[] = [];
  if (y2Idx >= 0 && y2Idx !== yi) {
    const byX = model.keys.map(() => [] as number[]);
    for (const r of rows) {
      const ki = keyIndex.get(tb.keyOf(r));
      if (ki == null) continue;
      const v = Number(r[y2Idx]);
      if (!isNaN(v)) byX[ki]!.push(v);
    }
    const pts = model.keys.map((_, ki) => ({ ki, v: byX[ki]!.length ? aggregateValues(byX[ki]!, agg) : NaN })).filter((p) => !isNaN(p.v));
    for (const p of pts) {
      minVal = Math.min(minVal, p.v);
      maxStack = Math.max(maxStack, p.v);
    }
    overlayPts.push({ label: opts?.fieldNames?.[y2Idx] ?? "Compare Y", pts });
  }
  if (opts?.comparePrevious && model.keys.length >= 4 && series.length === 1) {
    const mid = Math.floor(model.keys.length / 2);
    const pts = values[0]!
      .map((v, ki) => ({ ki, v }))
      .filter((p) => p.ki < mid);
    overlayPts.push({ label: "Earlier half", pts });
  }

  // A single series may dip below zero; stacked series stack their positive parts
  const ys = niceZeroScale(series.length === 1 ? minVal : 0, maxStack, opts?.tickCount ?? 5);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const X = (ki: number) => rect.left + model.pos[ki]! * span;
  drawChartGrid(ctx, w, h, rect, opts, { x: model.kind === "number" ? model.domain : null, y: [ys.min, ys.max] });

  const single = series.length === 1;
  series.forEach((_, si) => {
    const color = cols[si % cols.length]!;
    const top = single ? values[0]! : tops[si]!;
    const base = single ? model.keys.map(() => 0) : si === 0 ? model.keys.map(() => 0) : tops[si - 1]!;
    ctx.fillStyle = color;
    ctx.globalAlpha = single ? 0.3 : Math.min(0.85, opts?.opacity ?? 0.75);
    ctx.beginPath();
    model.keys.forEach((_, ki) => (ki === 0 ? ctx.moveTo(X(ki), Y(top[ki]!)) : ctx.lineTo(X(ki), Y(top[ki]!))));
    for (let ki = model.keys.length - 1; ki >= 0; ki--) ctx.lineTo(X(ki), Y(base[ki]!));
    ctx.closePath();
    ctx.fill();
    // Crisp top edge so each layer reads as a line, not just a blob
    ctx.globalAlpha = 1;
    ctx.strokeStyle = single ? color : (opts?.themeBg ?? "#111114");
    ctx.lineWidth = single ? 2 : 0.75;
    ctx.beginPath();
    model.keys.forEach((_, ki) => (ki === 0 ? ctx.moveTo(X(ki), Y(top[ki]!)) : ctx.lineTo(X(ki), Y(top[ki]!))));
    ctx.stroke();
  });

  overlayPts.forEach((ov, oi) => {
    if (ov.pts.length < 2) return;
    const color = cols[(series.length + oi) % cols.length]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.75;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ov.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.ki), Y(p.v)) : ctx.lineTo(X(p.ki), Y(p.v))));
    ctx.stroke();
    ctx.setLineDash([]);
  });
  ctx.globalAlpha = 1;

  // One hover column per x key, reporting every layer
  const xName = fieldLabel(opts, xi) + (tb.unit ? ` (${tb.unit})` : "");
  const vTitle = valueTitle(opts, yi);
  const shown = series.slice(0, 6);
  model.keys.forEach((key, ki) => {
    const x = X(ki);
    const prev = ki > 0 ? X(ki - 1) : rect.left;
    const next = ki < model.keys.length - 1 ? X(ki + 1) : rect.right;
    const x0 = ki > 0 ? (prev + x) / 2 : rect.left;
    const x1 = ki < model.keys.length - 1 ? (x + next) / 2 : rect.right;
    const total = values.reduce((s, v) => s + v[ki]!, 0);
    pushHit(opts, {
      shape: "rect", x: x0, y: rect.top, w: Math.max(1, x1 - x0), h: rect.bottom - rect.top,
      match: tb.unit ? [] : [[xi, key]],
      rowIndex: tb.unit ? tb.firstRow.get(key) : undefined,
      summary: single
        ? { columns: [xName, vTitle], row: [key, formatTooltipNumber(total)] }
        : {
          columns: [xName, ...shown, "Total"],
          row: [key, ...shown.map((_, si) => formatTooltipNumber(values[si]![ki]!)), formatTooltipNumber(total)],
        },
    });
  });
  const legend = [
    ...series.map((label, si) => ({ label: label || "series", color: cols[si % cols.length]! })),
    ...overlayPts.map((ov, oi) => ({ label: ov.label, color: cols[(series.length + oi) % cols.length]! })),
  ];
  if (legend.length > 1) setLegend(opts, legend);
  if (ys.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawXModelAxis(ctx, model, w, h, rect, opts);
}

/** Top slices + "Other" so a pie never has more than 8 wedges. */
function pieSlices(rows: unknown[][], xi: number, yi: number, agg: YAggregateOption) {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const all = [...groups.entries()]
    .map(([label, vals]) => ({ label, value: Math.max(0, aggregateValues(vals.filter((v) => !isNaN(v)), agg)), other: [] as string[] }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
  if (all.length <= 8) return all;
  const head = all.slice(0, 7);
  const tail = all.slice(7);
  return [...head, { label: `Other (${tail.length})`, value: tail.reduce((s, e) => s + e.value, 0), other: tail.map((e) => e.label) }];
}

function renderFullPie(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = Math.max(0.85, opts?.opacity ?? 0.9);
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const entries = pieSlices(rows, xi, yi, agg);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total === 0) return;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const rect = plotOf(w, h, pad);
  const plotW = rect.right - rect.left;
  const plotH = rect.bottom - rect.top;
  const pct = (v: number) => {
    const p = (v / total) * 100;
    return `${p < 1 ? "<1" : p < 10 ? p.toFixed(1) : Math.round(p)}%`;
  };

  // Legend beside the donut on wide stages, underneath on tall ones
  const legendFont = `11px '${fontFamily}', sans-serif`;
  const legendTexts = entries.map((e) => `${e.label}  ${pct(e.value)}`);
  const textW = widestText(ctx, legendTexts, legendFont);
  const portrait = plotH > plotW * 1.1;
  const rowH = 18;
  const legendW = portrait ? plotW : Math.min(plotW * 0.42, textW + 22);
  const legendH = portrait ? Math.ceil(entries.length / 2) * rowH + 6 : entries.length * rowH;
  const pieW = portrait ? plotW : plotW - legendW - 16;
  const pieH = portrait ? plotH - legendH - 8 : plotH;
  const cx = rect.left + pieW / 2;
  const cy = rect.top + pieH / 2;
  const radius = Math.max(24, Math.min(pieW, pieH) / 2 - 4);
  const innerR = radius * 0.55;
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);

  let start = -Math.PI / 2;
  entries.forEach((e, i) => {
    const sweep = (e.value / total) * Math.PI * 2;
    const fill = cols[i % cols.length]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.arc(cx, cy, innerR, start + sweep, start, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#1a1a1f";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.stroke();
    // Percent on wedges big enough to hold it
    if (sweep > 0.32 && opts?.chartDetail !== "plain") {
      const mid = start + sweep / 2;
      const r2 = (radius + innerR) / 2;
      ctx.fillStyle = contrastingInk(fill);
      ctx.font = `600 ${Math.max(9, Math.min(12, (radius - innerR) * 0.3))}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pct(e.value), cx + Math.cos(mid) * r2, cy + Math.sin(mid) * r2);
    }
    const firstOther = e.other.length
      ? rows.findIndex((r) => e.other.includes(String(r[xi])))
      : -1;
    pushHit(opts, {
      shape: "arc", cx, cy, r0: innerR, r1: radius, a0: start, a1: start + sweep,
      match: e.other.length ? [] : [[xi, e.label]],
      rowIndex: firstOther >= 0 ? firstOther : undefined,
      summary: { columns: [xName, vTitle, "Share"], row: [e.label, formatTooltipNumber(e.value), pct(e.value)] },
    });
    start += sweep;
  });

  // Total in the hole
  if (innerR > 26) {
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.max(12, Math.min(22, innerR * 0.38))}px '${fontFamily}', sans-serif`;
    ctx.fillText(formatDataValue(total), cx, cy - innerR * 0.08);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.font = `${Math.max(9, Math.min(11, innerR * 0.2))}px '${fontFamily}', sans-serif`;
    ctx.fillText(fitTextEllipsis(ctx, agg === "count" ? "total rows" : "total", innerR * 1.6), cx, cy + innerR * 0.28);
  }

  ctx.font = legendFont;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  entries.forEach((e, i) => {
    const colW = portrait ? plotW / 2 : legendW;
    const lx = portrait ? rect.left + (i % 2) * colW : rect.right - legendW;
    const ly = portrait
      ? rect.top + pieH + 14 + Math.floor(i / 2) * rowH
      : cy - legendH / 2 + i * rowH + rowH / 2;
    ctx.fillStyle = cols[i % cols.length]!;
    ctx.globalAlpha = 1;
    ctx.fillRect(lx, ly - 5, 10, 10);
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    const maxText = colW - 22;
    const pctText = pct(e.value);
    const pctW = ctx.measureText(pctText).width;
    ctx.fillText(fitTextEllipsis(ctx, e.label, Math.max(20, maxText - pctW - 8)), lx + 16, ly);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.textAlign = "right";
    ctx.fillText(pctText, lx + colW - 4, ly);
    ctx.textAlign = "left";
  });
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, []);
}

// --- Bubble (scatter with size) ---

function renderFullBubble(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  xi: number,
  yi: number,
  ci: number,
  sizeIdx: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);

  // Count valid points cheaply for density (same filter as draw loop)
  let nValid = 0;
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (!isNaN(x) && !isNaN(y)) nValid++;
  }
  const marks = densityAwarePointMarks({
    n: nValid,
    plotW,
    plotH,
    hasSizeEncoding: sizeIdx >= 0,
    sizeScale: opts?.sizeScale ?? 1,
    pointSize: opts?.pointSize ?? 12,
    opacity: opts?.opacity,
    opacityUserSet: opts?.opacityUserSet,
  });
  const { minR, maxR, opacity: alpha, drawStroke } = marks;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts) {
    opts.scales = {
      x: (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (w - 2 * pad),
      y: (v: number) => h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * pad),
      valueAxis: "y",
      rect: plotOf(w, h, pad),
    };
  }

  const catMap = new Map<string, number>();
  let nextCat = 0;
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const sName = sizeIdx >= 0 ? (columnNames[sizeIdx] ?? "size") : "";

  type Bubble = { sx: number; sy: number; r: number; cat: number; row: unknown[] };
  const bubbles: Bubble[] = [];
  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let cat = 0;
    if (ci >= 0) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, nextCat++);
      cat = catMap.get(k)!;
    }
    let radius = (minR + maxR) / 2;
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = minR + Math.sqrt(Math.max(0, Math.min(1, t))) * (maxR - minR);
      }
    }
    const sx = pad + ((x - xMin) / xRange) * plotW;
    const sy = h - pad - ((y - yMin) / yRange) * plotH;
    bubbles.push({ sx, sy, r: radius, cat, row: r });
  }

  // Big bubbles first so small ones stay visible on top
  bubbles.sort((a, b) => b.r - a.r);

  for (const b of bubbles) {
    const color = palette[b.cat % palette.length]!;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.r, 0, Math.PI * 2);
    ctx.fill();
    if (drawStroke) {
      ctx.globalAlpha = Math.min(alpha + 0.25, 0.85);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    const cols = [xName, yName];
    const vals: (string | number | null)[] = [formatTooltipNumber(Number(b.row[xi])), formatTooltipNumber(Number(b.row[yi]))];
    if (sizeIdx >= 0) { cols.push(sName); vals.push(formatTooltipNumber(Number(b.row[sizeIdx]))); }
    if (ci >= 0) { cols.unshift(fieldLabel(opts, ci)); vals.unshift(String(b.row[ci])); }
    pushHit(opts, {
      shape: "circle", cx: b.sx, cy: b.sy, r: Math.max(4, b.r),
      match: [[xi, String(b.row[xi])], [yi, String(b.row[yi])]],
      summary: { columns: cols, row: vals },
    });
  }
  ctx.globalAlpha = 1;

  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (ci >= 0) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));

  // Size key: three nested reference circles, bottom-right inside the plot
  if (sizeIdx >= 0 && maxR >= 4) {
    const steps = [0.1, 0.5, 1.0];
    const font = `9px '${fontFamily}', sans-serif`;
    const labels = steps.map((t) => formatDataValue(sizeMin + t * sizeRange));
    const labelW = widestText(ctx, labels, font);
    const boxW = maxR * 2 + labelW + 22;
    const boxH = maxR * 2 + 26;
    const bx = w - pad - boxW - 6;
    const by = h - pad - boxH - 6;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(fitTextEllipsis(ctx, sName, boxW - 8), bx + 4, by + 3);
    const baseY = by + boxH - 4;
    const ccx = bx + 6 + maxR;
    steps.forEach((t, i) => {
      const r = minR + Math.sqrt(t) * (maxR - minR);
      ctx.strokeStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(ccx, baseY - r, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([2, 2]);
      ctx.moveTo(ccx, baseY - 2 * r);
      ctx.lineTo(ccx + maxR + 6, baseY - 2 * r);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.textBaseline = "middle";
      ctx.fillText(labels[i]!, ccx + maxR + 8, baseY - 2 * r);
    });
    ctx.restore();
  }
}

// --- Violin ---

function renderFullViolin(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.55;
  const ink = opts?.themeText ?? "#e8e8ec";
  const groups = groupedDistributions(rows, xi, yi, 12);
  if (groups.length === 0) return;
  // Color only when Color encodes something other than the group itself
  const groupColor = new Map<string, string>();
  if (ci >= 0 && ci !== xi) for (const r of rows) if (!groupColor.has(String(r[xi]))) groupColor.set(String(r[xi]), String(r[ci]));
  const colorKeys = [...new Set(groupColor.values())];
  const rect = plotOf(w, h, pad);
  const gMin = Math.min(...groups.map((g) => g.min));
  const gMax = Math.max(...groups.map((g) => g.max));
  const ys = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / groups.length;
  const halfW = Math.min(band * 0.42, 60);
  const bins = 40;
  const binH = (ys.max - ys.min) / bins;
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const yName = fieldLabel(opts, yi);
  const centers: number[] = [];

  groups.forEach((g, gi) => {
    // Smoothed density: histogram + 3-tap blur twice
    let counts = new Array<number>(bins).fill(0);
    for (const v of g.sorted) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - ys.min) / binH)))]! += 1;
    for (let pass = 0; pass < 2; pass++) {
      counts = counts.map((c, i) => ((counts[i - 1] ?? 0) + 2 * c + (counts[i + 1] ?? 0)) / 4);
    }
    const maxC = Math.max(...counts, 1e-9);
    const cx = rect.left + (gi + 0.5) * band;
    centers.push(cx);
    const color = groupColor.size ? cols[Math.max(0, colorKeys.indexOf(groupColor.get(g.label)!)) % cols.length]! : cols[0]!;
    // Clip the outline to the group's own range so tails don't float
    const b0 = Math.max(0, Math.floor((g.min - ys.min) / binH));
    const b1 = Math.min(bins - 1, Math.floor((g.max - ys.min) / binH));
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let b = b0; b <= b1; b++) {
      const y = Y(ys.min + (b + 0.5) * binH);
      const dx = (counts[b]! / maxC) * halfW;
      if (b === b0) ctx.moveTo(cx - dx, y);
      else ctx.lineTo(cx - dx, y);
    }
    for (let b = b1; b >= b0; b--) {
      ctx.lineTo(cx + (counts[b]! / maxC) * halfW, Y(ys.min + (b + 0.5) * binH));
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Inner box: IQR bar + median dot
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, Y(g.q1));
    ctx.lineTo(cx, Y(g.q3));
    ctx.stroke();
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, Y(g.q2), 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: rect.left + gi * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: [[xi, g.label]],
      summary: {
        columns: [xName, "Rows", `Median ${yName}`, "Q1 – Q3"],
        row: [g.label, formatTooltipNumber(g.sorted.length), formatTooltipNumber(g.q2), `${formatTooltipNumber(g.q1)} – ${formatTooltipNumber(g.q3)}`],
      },
    });
  });
  ctx.globalAlpha = 1;
  if (groupColor.size) setLegend(opts, colorKeys.map((label, i) => ({ label, color: cols[i % cols.length]! })));
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, groups.map((g) => g.label), centers, band, w, h, rect, opts, "nominal");
}

// --- Radar / Spider ---

function renderFullRadar(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  void xi;
  void yi;
  const palette = opts?.colors ?? DEFAULT_COLORS;

  if (!rows.length || !columnNames.length) return;

  const numericAxes: { idx: number; name: string }[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const sample = rows.slice(0, 20);
    const numCount = sample.filter(r => !isNaN(Number(r[c])) && r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean").length;
    if (numCount >= sample.length * 0.5) {
      numericAxes.push({ idx: c, name: columnNames[c] });
    }
  }
  if (numericAxes.length < 3) return;
  const axes = numericAxes.slice(0, 8);
  const n = axes.length;

  const ranges = axes.map(a => numRange(rows, a.idx));

  const groups = new Map<string, unknown[][]>();
  if (ci >= 0) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r as unknown[]);
    }
  } else {
    groups.set("all", rows as unknown[][]);
  }
  const groupEntries = [...groups.entries()].slice(0, 6);
  const groupAvgs = groupEntries.map(([, gRows]) =>
    axes.map((a) => {
      const vals = gRows.map(r => Number(r[a.idx])).filter(v => !isNaN(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    }),
  );
  // Comparing groups: scale each axis across the group averages (lowest at 20% of the radius)
  // so differences show — row-level min/max squashes every average toward the center.
  const compare = groupEntries.length > 1;
  const axisNorm = axes.map((_, ai) => {
    if (!compare) {
      const [mn, mx] = ranges[ai]!;
      return (v: number) => (mx === mn ? 0.5 : (v - mn) / (mx - mn));
    }
    const vals = groupAvgs.map((g) => g[ai]!);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    return (v: number) => (mx === mn ? 0.6 : 0.2 + 0.8 * ((v - mn) / (mx - mn)));
  });

  // Leave room for axis names around the web
  const labelFont = axisFont(opts, Math.max(10, opts?.axisFontSize ?? 10));
  const labelRoom = Math.min(90, widestText(ctx, axes.map((a) => a.name), labelFont) + 8);
  const cx = w / 2;
  const cy = pad + (h - 2 * pad) / 2;
  const radius = Math.max(20, Math.min((w - 2 * pad) / 2 - labelRoom, (h - 2 * pad) / 2 - 18));
  if (radius < 20) return;

  const rings = 4;
  ctx.save();
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.lineWidth = 0.75;
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * (ring / rings);
    ctx.globalAlpha = ring === rings ? 0.7 : 0.35;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const angle = (Math.PI * 2 * (i % n)) / n - Math.PI / 2;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.globalAlpha = 0.5;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.font = labelFont;
  ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
  ctx.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const labelR = radius + 8;
    const lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    ctx.textAlign = Math.abs(Math.cos(angle)) < 0.1 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
    ctx.textBaseline = Math.abs(Math.sin(angle)) < 0.1 ? "middle" : Math.sin(angle) > 0 ? "top" : "bottom";
    ctx.fillText(fitTextEllipsis(ctx, axes[i]!.name, labelRoom), lx, ly);
  }
  ctx.restore();

  groupEntries.forEach(([gName], gi) => {
    const avgs = groupAvgs[gi]!;
    const normals = avgs.map((avg, ai) => axisNorm[ai]!(avg));
    const vertex = (i: number) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, normals[i]!) * radius;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    };

    const color = palette[gi % palette.length]!;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    normals.forEach((_, i) => {
      const p = vertex(i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    normals.forEach((_, i) => {
      const p = vertex(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      pushHit(opts, {
        shape: "circle", cx: p.x, cy: p.y, r: 8,
        match: ci >= 0 ? [[ci, gName]] : [],
        rowIndex: ci >= 0 ? undefined : 0,
        summary: {
          columns: ci >= 0 ? [fieldLabel(opts, ci), `Average ${axes[i]!.name}`] : [`Average ${axes[i]!.name}`],
          row: ci >= 0 ? [gName, formatTooltipNumber(avgs[i]!)] : [formatTooltipNumber(avgs[i]!)],
        },
      });
    });
  });

  setLegend(opts, ci >= 0 ? groupEntries.map(([label], gi) => ({ label, color: palette[gi % palette.length]! })) : []);
  ctx.globalAlpha = 1;
}

// --- Waterfall ---

function renderFullWaterfall(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  // Steps run in natural order for numbers / dates, otherwise first appearance
  const cls = classifyKeys([...groups.keys()]);
  const keys = (cls.kind !== "band" ? cls.sorted : [...groups.keys()]).slice(0, 20);
  if (keys.length === 0) return;

  let running = 0;
  const bars: { label: string; start: number; end: number; value: number; total?: boolean }[] = [];
  for (const label of keys) {
    const val = aggregateValues(groups.get(label)!.filter(v => !isNaN(v)), agg);
    bars.push({ label, start: running, end: running + val, value: val });
    running += val;
  }
  bars.push({ label: "Total", start: 0, end: running, value: running, total: true });
  const allY = bars.flatMap(b => [b.start, b.end]);
  const ys = niceZeroScale(Math.min(0, ...allY), Math.max(0, ...allY), opts?.tickCount ?? 5);
  const rect = plotOf(w, h, pad);
  const Y = linear(ys.min, ys.max, rect.bottom, rect.top);
  if (opts) opts.scales = { y: Y, valueAxis: "y", rect };
  const band = (rect.right - rect.left) / bars.length;
  const barW = Math.max(3, Math.min(band * 0.7, 72));
  const up = cols[0]!;
  const down = cols[2] ?? cols[1] ?? cols[0]!;
  const totalColor = cols[3] ?? opts?.axisLabelColor ?? "#6b6b78";
  drawChartGrid(ctx, w, h, rect, opts, { x: null, y: [ys.min, ys.max] });
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const centers: number[] = [];

  bars.forEach((bar, i) => {
    const cx = rect.left + (i + 0.5) * band;
    centers.push(cx);
    const top = Math.min(Y(bar.start), Y(bar.end));
    const bottom = Math.max(Y(bar.start), Y(bar.end));
    ctx.fillStyle = bar.total ? totalColor : bar.value >= 0 ? up : down;
    ctx.globalAlpha = alpha;
    ctx.fillRect(cx - barW / 2, top, barW, Math.max(1, bottom - top));
    if (i > 0) {
      // Connector from the previous step's end
      ctx.globalAlpha = 1;
      ctx.strokeStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.lineWidth = 0.75;
      ctx.setLineDash([3, 2]);
      const prevEnd = Y(bars[i - 1]!.end);
      ctx.beginPath();
      ctx.moveTo(cx - band + barW / 2, prevEnd);
      ctx.lineTo(cx - barW / 2, prevEnd);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts?.showDataLabels && band >= 26) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.font = axisFont(opts, 9);
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const sign = !bar.total && bar.value > 0 ? "+" : "";
      ctx.fillText(sign + formatDataValue(bar.value), cx, top - 3);
    }
    pushHit(opts, {
      shape: "rect", x: rect.left + i * band, y: rect.top, w: band, h: rect.bottom - rect.top,
      match: bar.total ? [] : [[xi, bar.label]],
      rowIndex: bar.total ? 0 : undefined,
      summary: bar.total
        ? { columns: [xName, vTitle], row: ["Total", formatTooltipNumber(bar.value)] }
        : { columns: [xName, "Change", "Running total"], row: [bar.label, (bar.value > 0 ? "+" : "") + formatTooltipNumber(bar.value), formatTooltipNumber(bar.end)] },
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (ys.min < 0) drawZeroLine(ctx, rect.left, Y(0), rect.right, Y(0), opts);
  drawChartTicks(ctx, 0, 1, ys.min, ys.max, w, h, rect, opts, { x: false });
  drawBandAxisX(ctx, bars.map((b) => b.label), centers, band, w, h, rect, opts, "nominal");
  setLegend(opts, [
    { label: "Increase", color: up },
    { label: "Decrease", color: down },
    { label: "Total", color: totalColor },
  ]);
}

// --- Lollipop ---

function renderFullLollipop(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.9;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const catColorMap = new Map<string, number>();
  let nextCat = 0;
  if (ci >= 0 && ci !== xi) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!catColorMap.has(k)) catColorMap.set(k, nextCat++);
    }
  }

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    groups.get(k)!.vals.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: aggregateValues(g.vals.filter(v => !isNaN(v)), agg), cat: g.cat }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);
  if (entries.length === 0) return;

  const gutter = labelGutter(ctx, entries.map((e) => e.label), w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const xs = niceZeroScale(Math.min(0, ...entries.map((e) => e.value)), Math.max(0, ...entries.map((e) => e.value)), opts?.tickCount ?? 5);
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });

  const bandH = (rect.bottom - rect.top) / entries.length;
  const dotR = Math.max(3, Math.min(6, bandH * 0.3));
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const centers: number[] = [];
  entries.forEach(({ label, value, cat }, i) => {
    const cy = rect.top + (i + 0.5) * bandH;
    centers.push(cy);
    const color = catColorMap.size ? palette[(catColorMap.get(cat) ?? 0) % palette.length]! : palette[0]!;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.moveTo(X(0), cy);
    ctx.lineTo(X(value), cy);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(X(value), cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    if (opts?.showDataLabels) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
      ctx.font = axisFont(opts);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatDataValue(value), X(value) + dotR + 4, cy);
    }
    pushHit(opts, {
      shape: "rect", x: rect.left, y: cy - bandH / 2, w: rect.right - rect.left, h: bandH,
      match: [[xi, label]],
      summary: { columns: [xName, vTitle], row: [label, formatTooltipNumber(value)] },
    });
  });
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";
  if (catColorMap.size) setLegend(opts, [...catColorMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, entries.map((e) => e.label), centers, bandH, rect.left - 8, gutter - 10, opts);
}

// --- Treemap ---

type TreemapItem = { label: string; value: number; cat: string };
type TreemapRect = TreemapItem & { x: number; y: number; w: number; h: number };

/** Squarified treemap (Bruls et al.) — tiles stay close to square so labels fit. */
function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): TreemapRect[] {
  const out: TreemapRect[] = [];
  const total = items.reduce((s, e) => s + e.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  const queue = items.map((e) => ({ ...e, area: e.value * scale }));
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row: { area: number }[], side: number) => {
    const s = row.reduce((a, r) => a + r.area, 0);
    let mx = 0;
    for (const r of row) {
      const ratio = Math.max((side * side * r.area) / (s * s), (s * s) / (side * side * r.area));
      mx = Math.max(mx, ratio);
    }
    return mx;
  };
  while (queue.length) {
    const side = Math.min(rw, rh);
    const row = [queue.shift()!];
    while (queue.length && worst([...row, queue[0]!], side) <= worst(row, side)) row.push(queue.shift()!);
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    const thick = rowArea / side;
    let off = 0;
    for (const r of row) {
      const len = r.area / thick;
      if (rw >= rh) out.push({ label: r.label, value: r.value, cat: r.cat, x: rx, y: ry + off, w: thick, h: len });
      else out.push({ label: r.label, value: r.value, cat: r.cat, x: rx + off, y: ry, w: len, h: thick });
      off += len;
    }
    if (rw >= rh) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
  }
  return out;
}

function renderFullTreemap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (!isNaN(v)) groups.get(k)!.vals.push(v);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(aggregateValues(g.vals, agg)), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  if (ci >= 0 && ci !== xi) for (const e of entries) if (!catMap.has(e.cat)) catMap.set(e.cat, catMap.size);
  const total = entries.reduce((s, e) => s + e.value, 0);
  const rects = squarify(entries, pad, pad, w - 2 * pad, h - 2 * pad);
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);

  for (const rect of rects) {
    const fill = catMap.size ? palette[(catMap.get(rect.cat) ?? 0) % palette.length]! : palette[0]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    if (rect.w > 34 && rect.h > 18) {
      const ink = contrastingInk(fill);
      const fontSize = Math.max(9, Math.min(13, Math.min(rect.w / 6, rect.h / 2.4)));
      ctx.fillStyle = ink;
      ctx.font = `600 ${fontSize}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(fitTextEllipsis(ctx, rect.label, rect.w - 10), rect.x + 5, rect.y + 5);
      if (rect.h > fontSize * 2 + 14) {
        ctx.globalAlpha = 0.85;
        ctx.font = `${Math.max(9, fontSize - 2)}px '${fontFamily}', sans-serif`;
        ctx.fillText(fitTextEllipsis(ctx, formatDataValue(rect.value), rect.w - 10), rect.x + 5, rect.y + 8 + fontSize);
        ctx.globalAlpha = 1;
      }
    }
    pushHit(opts, {
      shape: "rect", x: rect.x, y: rect.y, w: rect.w, h: rect.h,
      match: [[xi, rect.label]],
      summary: { columns: [xName, vTitle, "Share"], row: [rect.label, formatTooltipNumber(rect.value), `${((rect.value / total) * 100).toFixed(1)}%`] },
    });
  }
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Sunburst ---

function renderFullSunburst(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const outerGroups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const outer = String(r[xi]);
    const inner = ci >= 0 ? String(r[ci]) : "__all__";
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (!outerGroups.has(outer)) outerGroups.set(outer, new Map());
    const innerMap = outerGroups.get(outer)!;
    innerMap.set(inner, (innerMap.get(inner) ?? 0) + (isNaN(v) ? 0 : (agg === "count" ? 1 : v)));
  }

  const outerEntries = [...outerGroups.entries()]
    .map(([label, innerMap]) => ({
      label,
      total: [...innerMap.values()].reduce((s, v) => s + Math.abs(v), 0),
      children: [...innerMap.entries()].map(([k, v]) => ({ label: k, value: Math.abs(v) })).filter(c => c.value > 0),
    }))
    .filter(e => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  if (outerEntries.length === 0) return;

  const grandTotal = outerEntries.reduce((s, e) => s + e.total, 0);
  const cx = w / 2;
  const cy = pad + (h - 2 * pad) / 2;
  const outerR = Math.max(24, Math.min(w - 2 * pad, h - 2 * pad) / 2 - 4);
  const innerR = outerR * 0.36;
  const hasInner = ci >= 0 && outerEntries.some(e => e.children.length > 1);
  const midR = hasInner ? outerR * 0.68 : outerR;
  const xName = fieldLabel(opts, xi);
  const cName = fieldLabel(opts, ci);
  const vTitle = valueTitle(opts, yi);
  const share = (v: number) => `${((v / grandTotal) * 100).toFixed(1)}%`;

  /** Label along the middle of a wedge if it fits the arc and ring depth. */
  const wedgeLabel = (text: string, a0: number, sweep: number, r0: number, r1: number, fill: string) => {
    const rm = (r0 + r1) / 2;
    const arcLen = sweep * rm;
    const depth = r1 - r0;
    const fs = Math.max(9, Math.min(12, depth * 0.32));
    if (arcLen < fs * 2.2 || depth < fs + 6) return;
    ctx.font = `${fs}px '${fontFamily}', sans-serif`;
    const maxW = Math.min(depth - 6, arcLen * 1.2);
    const t = fitTextEllipsis(ctx, text, Math.max(maxW, arcLen - 6));
    if (t === "…") return;
    const mid = a0 + sweep / 2;
    ctx.fillStyle = contrastingInk(fill);
    ctx.globalAlpha = 0.95;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm);
    ctx.globalAlpha = 1;
  };

  let angle = -Math.PI / 2;
  outerEntries.forEach((entry, ei) => {
    const sweep = (entry.total / grandTotal) * Math.PI * 2;
    const fill = palette[ei % palette.length]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, midR, angle, angle + sweep);
    ctx.arc(cx, cy, innerR, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1;
    ctx.stroke();
    wedgeLabel(entry.label, angle, sweep, innerR, midR, fill);
    pushHit(opts, {
      shape: "arc", cx, cy, r0: innerR, r1: midR, a0: angle, a1: angle + sweep,
      match: [[xi, entry.label]],
      summary: { columns: [xName, vTitle, "Share"], row: [entry.label, formatTooltipNumber(entry.total), share(entry.total)] },
    });

    if (hasInner) {
      let childAngle = angle;
      entry.children.sort((a, b) => b.value - a.value);
      for (const child of entry.children) {
        const childSweep = (child.value / entry.total) * sweep;
        ctx.fillStyle = fill;
        ctx.globalAlpha = alpha * 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, childAngle, childAngle + childSweep);
        ctx.arc(cx, cy, midR, childAngle + childSweep, childAngle, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 1;
        ctx.stroke();
        wedgeLabel(child.label, childAngle, childSweep, midR, outerR, blendToward(fill, 0.25, isLightHex(opts?.themeBg ?? "#000000") ? "white" : "black"));
        pushHit(opts, {
          shape: "arc", cx, cy, r0: midR, r1: outerR, a0: childAngle, a1: childAngle + childSweep,
          match: [[xi, entry.label], [ci, child.label]],
          summary: { columns: [xName, cName, vTitle, "Share"], row: [entry.label, child.label, formatTooltipNumber(child.value), share(child.value)] },
        });
        childAngle += childSweep;
      }
    }

    angle += sweep;
  });

  // Grand total in the hole
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(11, Math.min(20, innerR * 0.36))}px '${fontFamily}', sans-serif`;
  ctx.fillText(formatDataValue(grandTotal), cx, cy - innerR * 0.08);
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.font = `${Math.max(9, Math.min(11, innerR * 0.2))}px '${fontFamily}', sans-serif`;
  ctx.fillText("total", cx, cy + innerR * 0.3);
  ctx.textBaseline = "alphabetic";
  setLegend(opts, []);
}

// --- Force Bubble (packed circles) ---

function renderFullForceBubble(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { vals: number[]; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, { vals: [], cat: ci >= 0 ? String(r[ci]) : "" });
    const v = yi >= 0 ? Number(r[yi]) : 1;
    if (!isNaN(v)) groups.get(k)!.vals.push(v);
  }

  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(aggregateValues(g.vals, agg)), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 50);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  if (ci >= 0 && ci !== xi) for (const e of entries) if (!catMap.has(e.cat)) catMap.set(e.cat, catMap.size);

  // Area-true radii scaled so the pack fills ~55% of the plot
  const plotCx = w / 2;
  const plotCy = pad + (h - 2 * pad) / 2;
  const plotArea = Math.max(1, (w - 2 * pad) * (h - 2 * pad));
  const total = entries.reduce((s, e) => s + e.value, 0);
  const k = Math.sqrt((plotArea * 0.55) / (Math.PI * total));

  type Circle = { x: number; y: number; r: number; label: string; cat: string; value: number };
  // Deterministic golden-angle seed so the layout doesn't jump between redraws
  const circles: Circle[] = entries.map((e, i) => {
    const a = i * 2.39996;
    const d = Math.sqrt(i) * 6;
    return { x: plotCx + Math.cos(a) * d, y: plotCy + Math.sin(a) * d, r: Math.max(4, Math.sqrt(e.value) * k), label: e.label, cat: e.cat, value: e.value };
  });

  for (let iter = 0; iter < 160; iter++) {
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i]!;
      a.x += (plotCx - a.x) * 0.02;
      a.y += (plotCy - a.y) * 0.02;
      for (let j = i + 1; j < circles.length; j++) {
        const b = circles[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.r + b.r + 2;
        if (dist < minDist) {
          const overlap = (minDist - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
      a.x = Math.min(w - pad - a.r, Math.max(pad + a.r, a.x));
      a.y = Math.min(h - pad - a.r, Math.max(pad + a.r, a.y));
    }
  }

  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  for (const c of circles) {
    const fill = catMap.size ? palette[(catMap.get(c.cat) ?? 0) % palette.length]! : palette[0]!;
    ctx.fillStyle = fill;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (c.r > 16) {
      const fs = Math.max(9, Math.min(13, c.r * 0.34));
      ctx.fillStyle = contrastingInk(fill);
      ctx.font = `600 ${fs}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const showValue = c.r > fs * 2.4;
      ctx.fillText(fitTextEllipsis(ctx, c.label, c.r * 1.7), c.x, showValue ? c.y - fs * 0.55 : c.y);
      if (showValue) {
        ctx.globalAlpha = 0.85;
        ctx.font = `${Math.max(9, fs - 2)}px '${fontFamily}', sans-serif`;
        ctx.fillText(formatDataValue(c.value), c.x, c.y + fs * 0.65);
        ctx.globalAlpha = 1;
      }
    }
    pushHit(opts, {
      shape: "circle", cx: c.x, cy: c.y, r: c.r,
      match: [[xi, c.label]],
      summary: { columns: [xName, vTitle], row: [c.label, formatTooltipNumber(c.value)] },
    });
  }
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Sankey ---

function renderFullSankey(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.4;
  const fontFamily = opts?.fontFamily ?? "Inter";

  const targetIdx = ci >= 0 ? ci : yi;
  if (targetIdx < 0) return;

  const flows = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  for (const r of rows) {
    const src = String(r[xi]);
    const tgt = String(r[targetIdx]);
    const v = yi >= 0 && targetIdx !== yi ? Number(r[yi]) : 1;
    const val = isNaN(v) ? 1 : Math.abs(v);
    const key = `${src}\0${tgt}`;
    flows.set(key, (flows.get(key) ?? 0) + val);
    sourceTotals.set(src, (sourceTotals.get(src) ?? 0) + val);
    targetTotals.set(tgt, (targetTotals.get(tgt) ?? 0) + val);
  }
  // Largest 15 nodes per side; everything else is dropped from both ends
  const sortedSources = [...sourceTotals.keys()].sort((a, b) => sourceTotals.get(b)! - sourceTotals.get(a)!).slice(0, 15);
  const sortedTargets = [...targetTotals.keys()].sort((a, b) => targetTotals.get(b)! - targetTotals.get(a)!).slice(0, 15);
  if (sortedSources.length === 0 || sortedTargets.length === 0) return;
  const srcSet = new Set(sortedSources);
  const tgtSet = new Set(sortedTargets);
  const shownFlows = [...flows.entries()].filter(([k]) => {
    const [s, t] = k.split("\0");
    return srcSet.has(s!) && tgtSet.has(t!);
  });
  const srcShown = new Map<string, number>();
  const tgtShown = new Map<string, number>();
  for (const [k, v] of shownFlows) {
    const [s, t] = k.split("\0");
    srcShown.set(s!, (srcShown.get(s!) ?? 0) + v);
    tgtShown.set(t!, (tgtShown.get(t!) ?? 0) + v);
  }
  const grandTotal = [...srcShown.values()].reduce((s, v) => s + v, 0) || 1;

  const labelFont = axisFont(opts);
  const nodeW = 12;
  const gutterL = Math.min((w - 2 * pad) * 0.24, widestText(ctx, sortedSources, labelFont) + 10);
  const gutterR = Math.min((w - 2 * pad) * 0.24, widestText(ctx, sortedTargets, labelFont) + 10);
  const leftX = pad + gutterL;
  const rightX = w - pad - gutterR - nodeW;
  const top = pad + 4;
  const plotH = Math.max(40, h - 2 * pad - 8);
  const nodeGap = Math.min(6, plotH * 0.02);

  const layout = (keys: string[], totals: Map<string, number>) => {
    const gaps = nodeGap * (keys.length - 1);
    const scale = (plotH - gaps) / grandTotal;
    const out = new Map<string, { y: number; h: number }>();
    let cursor = top;
    for (const k of keys) {
      const nh = Math.max(2, (totals.get(k) ?? 0) * scale);
      out.set(k, { y: cursor, h: nh });
      cursor += nh + nodeGap;
    }
    return { out, scale };
  };
  const { out: sourceY, scale: srcScale } = layout(sortedSources, srcShown);
  const { out: targetY, scale: tgtScale } = layout(sortedTargets, tgtShown);

  const srcOffsets = new Map<string, number>();
  const tgtOffsets = new Map<string, number>();
  const srcColor = (s: string) => palette[sortedSources.indexOf(s) % palette.length]!;

  for (const [key, val] of shownFlows.sort((a, b) => b[1] - a[1])) {
    const [src, tgt] = key.split("\0");
    const sRect = sourceY.get(src!);
    const tRect = targetY.get(tgt!);
    if (!sRect || !tRect) continue;
    const sOff = srcOffsets.get(src!) ?? 0;
    const tOff = tgtOffsets.get(tgt!) ?? 0;
    const bandH = Math.max(1, val * srcScale);
    const bandHT = Math.max(1, val * tgtScale);
    ctx.fillStyle = srcColor(src!);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const sy1 = sRect.y + sOff;
    const sy2 = sy1 + bandH;
    const ty1 = tRect.y + tOff;
    const ty2 = ty1 + bandHT;
    const mx = (leftX + nodeW + rightX) / 2;
    ctx.moveTo(leftX + nodeW, sy1);
    ctx.bezierCurveTo(mx, sy1, mx, ty1, rightX, ty1);
    ctx.lineTo(rightX, ty2);
    ctx.bezierCurveTo(mx, ty2, mx, sy2, leftX + nodeW, sy2);
    ctx.closePath();
    ctx.fill();
    srcOffsets.set(src!, sOff + bandH);
    tgtOffsets.set(tgt!, tOff + bandHT);
  }

  const sName = fieldLabel(opts, xi, "source");
  const tName = fieldLabel(opts, targetIdx, "target");
  ctx.globalAlpha = 1;
  ctx.font = labelFont;
  ctx.textBaseline = "middle";
  for (const s of sortedSources) {
    const r = sourceY.get(s)!;
    ctx.fillStyle = srcColor(s);
    ctx.fillRect(leftX, r.y, nodeW, r.h);
    ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "right";
    ctx.fillText(fitTextEllipsis(ctx, s, gutterL - 8), leftX - 5, r.y + r.h / 2);
    pushHit(opts, {
      shape: "rect", x: leftX, y: r.y, w: nodeW, h: Math.max(4, r.h),
      match: [[xi, s]],
      summary: { columns: [sName, "Total"], row: [s, formatTooltipNumber(srcShown.get(s) ?? 0)] },
    });
  }
  for (const t of sortedTargets) {
    const r = targetY.get(t)!;
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.fillRect(rightX, r.y, nodeW, r.h);
    ctx.fillStyle = opts?.themeText ?? opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "left";
    ctx.fillText(fitTextEllipsis(ctx, t, gutterR - 8), rightX + nodeW + 5, r.y + r.h / 2);
    pushHit(opts, {
      shape: "rect", x: rightX, y: r.y, w: nodeW, h: Math.max(4, r.h),
      match: [[targetIdx, t]],
      summary: { columns: [tName, "Total"], row: [t, formatTooltipNumber(tgtShown.get(t) ?? 0)] },
    });
  }
  ctx.textBaseline = "alphabetic";
  void fontFamily;
  setLegend(opts, []);
}

// --- Dumbbell (category × start → end) ---

function renderFullDumbbell(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  si: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0 || si < 0) return;
  void ci;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.9;
  const agg: YAggregateOption = opts?.yAggregate ?? "mean";

  const groups = new Map<string, { start: number[]; end: number[] }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const a = Number(r[yi]);
    const b = Number(r[si]);
    if (isNaN(a) || isNaN(b)) continue;
    if (!groups.has(k)) groups.set(k, { start: [], end: [] });
    const g = groups.get(k)!;
    g.start.push(a);
    g.end.push(b);
  }
  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, start: aggregateValues(g.start, agg), end: aggregateValues(g.end, agg) }))
    .sort((a, b) => Math.abs(b.end - b.start) - Math.abs(a.end - a.start))
    .slice(0, 20);
  if (entries.length === 0) return;

  let minV = Infinity;
  let maxV = -Infinity;
  for (const e of entries) {
    minV = Math.min(minV, e.start, e.end);
    maxV = Math.max(maxV, e.start, e.end);
  }
  const gutter = labelGutter(ctx, entries.map((e) => e.label), w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const xs = niceTicks(minV, maxV, opts?.tickCount ?? 5, true);
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });

  const startColor = palette[0]!;
  const endColor = palette[1] ?? palette[0]!;
  const bandH = (rect.bottom - rect.top) / entries.length;
  const dotR = Math.max(3, Math.min(5.5, bandH * 0.28));
  const xName = fieldLabel(opts, xi);
  const aName = fieldLabel(opts, yi, "start");
  const bName = fieldLabel(opts, si, "end");
  const centers: number[] = [];

  entries.forEach((e, i) => {
    const cy = rect.top + (i + 0.5) * bandH;
    centers.push(cy);
    ctx.strokeStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(X(e.start), cy);
    ctx.lineTo(X(e.end), cy);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = startColor;
    ctx.beginPath();
    ctx.arc(X(e.start), cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = endColor;
    ctx.beginPath();
    ctx.arc(X(e.end), cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    pushHit(opts, {
      shape: "rect", x: rect.left, y: cy - bandH / 2, w: rect.right - rect.left, h: bandH,
      match: [[xi, e.label]],
      summary: {
        columns: [xName, aName, bName, "Change"],
        row: [e.label, formatTooltipNumber(e.start), formatTooltipNumber(e.end), (e.end - e.start > 0 ? "+" : "") + formatTooltipNumber(e.end - e.start)],
      },
    });
  });
  ctx.globalAlpha = 1;
  setLegend(opts, [{ label: aName, color: startColor }, { label: bName, color: endColor }]);
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, entries.map((e) => e.label), centers, bandH, rect.left - 8, gutter - 10, opts);
}

// --- Ridgeline (density per group) ---

function renderFullRidgeline(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.6;
  const groups = groupedDistributions(rows, yi, xi, 10);
  if (groups.length === 0) return;

  const gMin = Math.min(...groups.map((g) => g.min));
  const gMax = Math.max(...groups.map((g) => g.max));
  const xs = niceTicks(gMin, gMax, opts?.tickCount ?? 5, true);
  const gutter = labelGutter(ctx, groups.map((g) => g.label), w, pad, opts);
  const rect: PlotRect = { left: pad + gutter, top: pad, right: w - pad, bottom: h - pad };
  const X = linear(xs.min, xs.max, rect.left, rect.right);
  if (opts) opts.scales = { x: X, valueAxis: "x", rect };
  const bins = 48;
  const binW = (xs.max - xs.min) / bins;
  const bandH = (rect.bottom - rect.top) / groups.length;
  // Ridges overlap the band above by ~40% — the classic joyplot look
  const ridgeH = Math.min(bandH * 1.4, rect.bottom - rect.top);
  drawAxisFrame(ctx, w, h, rect, opts);
  drawChartGrid(ctx, w, h, rect, opts, { x: [xs.min, xs.max], y: null });
  const color = palette[0]!;
  const gName = fieldLabel(opts, yi);
  const vName = fieldLabel(opts, xi);
  const centers: number[] = [];

  groups.forEach((g, gi) => {
    let counts = new Array<number>(bins).fill(0);
    for (const v of g.sorted) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - xs.min) / binW)))]! += 1;
    for (let pass = 0; pass < 2; pass++) counts = counts.map((c, i) => ((counts[i - 1] ?? 0) + 2 * c + (counts[i + 1] ?? 0)) / 4);
    const maxC = Math.max(...counts, 1e-9);
    const baseline = rect.top + (gi + 1) * bandH;
    centers.push(baseline - bandH * 0.3);

    ctx.beginPath();
    ctx.moveTo(rect.left, baseline);
    for (let b = 0; b < bins; b++) ctx.lineTo(X(xs.min + (b + 0.5) * binW), baseline - (counts[b]! / maxC) * ridgeH);
    ctx.lineTo(rect.right, baseline);
    ctx.closePath();
    // Opaque base so the ridge in front hides the one behind it
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts?.themeBg ?? "#111114";
    ctx.fill();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    pushHit(opts, {
      shape: "rect", x: rect.left, y: rect.top + gi * bandH, w: rect.right - rect.left, h: bandH,
      match: [[yi, g.label]],
      summary: { columns: [gName, "Rows", `Median ${vName}`], row: [g.label, formatTooltipNumber(g.sorted.length), formatTooltipNumber(g.q2)] },
    });
  });

  ctx.globalAlpha = 1;
  drawChartTicks(ctx, xs.min, xs.max, 0, 1, w, h, rect, opts, { y: false });
  drawBandAxisY(ctx, groups.map((g) => g.label), centers, bandH, rect.left - 8, gutter - 10, opts);
}

// --- Hexbin density ---

function renderFullHexbin(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  if (yi < 0) return;
  const stops = densityStops(opts?.continuousStops?.length ? opts.continuousStops : (opts?.colors ?? DEFAULT_COLORS), opts?.themeBg);
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const plotW = w - 2 * pad;
  const plotH = h - 2 * pad;
  const targetHex = Math.max(8, Math.min(28, Math.round(Math.sqrt(rows.length) / 2)));
  const hexR = Math.min(plotW, plotH) / (targetHex * 1.75);
  const hexW = hexR * Math.sqrt(3);
  const hexH = hexR * 1.5;

  const counts = new Map<string, { n: number; row: number }>();
  let maxC = 0;
  rows.forEach((r, ri) => {
    const xv = Number(r[xi]);
    const yv = Number(r[yi]);
    if (isNaN(xv) || isNaN(yv)) return;
    const px = pad + ((xv - xMin) / (xMax - xMin || 1)) * plotW;
    const py = h - pad - ((yv - yMin) / (yMax - yMin || 1)) * plotH;
    const row = Math.round((py - pad) / hexH);
    const col = Math.round((px - pad - (row % 2 === 0 ? 0 : hexW / 2)) / hexW);
    const key = `${col},${row}`;
    const cur = counts.get(key);
    const n = (cur?.n ?? 0) + 1;
    counts.set(key, { n, row: cur?.row ?? ri });
    if (n > maxC) maxC = n;
  });
  if (counts.size === 0) return;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  if (opts) {
    opts.scales = {
      x: (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (w - 2 * pad),
      y: (v: number) => h - pad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * pad),
      valueAxis: "y",
      rect: plotOf(w, h, pad),
    };
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, plotW, plotH);
  ctx.clip();
  for (const [key, cell] of counts) {
    const [cs, rs] = key.split(",");
    const col = Number(cs);
    const row = Number(rs);
    const cx = pad + col * hexW + (Math.abs(row) % 2 === 0 ? 0 : hexW / 2);
    const cy = pad + row * hexH;
    const t = Math.sqrt(cell.n / maxC);
    ctx.fillStyle = sampleContinuous(stops, 0.12 + t * 0.88);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 180) * (60 * i - 30);
      const hx = cx + hexR * Math.cos(ang);
      const hy = cy + hexR * Math.sin(ang);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    pushHit(opts, {
      shape: "circle", cx, cy, r: hexR * 0.9,
      match: [],
      rowIndex: cell.row,
      summary: { columns: ["Rows here"], row: [formatTooltipNumber(cell.n)] },
    });
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
  drawColorRamp(ctx, stops, (s, t) => sampleContinuous(s, 0.12 + Math.sqrt(t) * 0.88), w - pad + 10, pad + 14, Math.min(140, plotH * 0.5), "1", formatDataValue(maxC), opts, "Rows");
}

// --- Funnel stages ---

function renderFullFunnel(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  xi: number,
  yi: number,
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  void ci;
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const entries = [...groups.entries()]
    .map(([label, vals]) => ({ label, value: aggregateValues(vals.filter(v => !isNaN(v)), agg) }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  if (entries.length === 0) return;

  const maxVal = entries[0]!.value;
  const plotW = w - 2 * pad;
  const minW = plotW * 0.16;
  const maxW = plotW * 0.92;
  const bandH = (h - 2 * pad) / entries.length;
  const gap = Math.min(4, bandH * 0.12);
  const color = palette[0]!;
  const ink = contrastingInk(color);
  const cx = w / 2;
  const xName = fieldLabel(opts, xi);
  const vTitle = valueTitle(opts, yi);
  const widthOf = (v: number) => minW + (v / maxVal) * (maxW - minW);

  entries.forEach((e, i) => {
    const next = entries[i + 1];
    const topW = widthOf(e.value);
    const botW = next ? widthOf(next.value) : topW * 0.85;
    const y0 = pad + i * bandH;
    const y1 = y0 + bandH - gap;
    ctx.beginPath();
    ctx.moveTo(cx - topW / 2, y0);
    ctx.lineTo(cx + topW / 2, y0);
    ctx.lineTo(cx + botW / 2, y1);
    ctx.lineTo(cx - botW / 2, y1);
    ctx.closePath();
    ctx.fillStyle = color;
    // Later stages fade slightly so the drop-off reads at a glance
    ctx.globalAlpha = alpha * (1 - (i / Math.max(1, entries.length)) * 0.45);
    ctx.fill();

    const pctOfFirst = (e.value / maxVal) * 100;
    const fs = Math.max(9, Math.min(13, bandH * 0.3));
    const text = `${e.label}  ·  ${formatDataValue(e.value)}${i > 0 ? `  (${pctOfFirst < 10 ? pctOfFirst.toFixed(1) : Math.round(pctOfFirst)}%)` : ""}`;
    ctx.font = `600 ${fs}px '${fontFamily}', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    const inner = Math.min(topW, botW) - 12;
    if (ctx.measureText(text).width <= inner) {
      ctx.fillStyle = ink;
      ctx.fillText(text, cx, (y0 + y1) / 2);
    } else {
      // Too narrow: label beside the stage
      ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
      ctx.textAlign = "left";
      const lx = cx + Math.max(topW, botW) / 2 + 8;
      ctx.fillText(fitTextEllipsis(ctx, text, Math.max(30, w - pad - lx)), lx, (y0 + y1) / 2);
    }
    pushHit(opts, {
      shape: "rect", x: pad, y: y0, w: plotW, h: bandH,
      match: [[xi, e.label]],
      summary: { columns: [xName, vTitle, "Of first stage"], row: [e.label, formatTooltipNumber(e.value), `${pctOfFirst.toFixed(1)}%`] },
    });
  });
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
  setLegend(opts, []);
}

// --- Parallel coordinates ---

function renderFullParallel(
  ctx: CanvasRenderingContext2D,
  rows: unknown[][],
  columnNames: string[],
  ci: number,
  w: number,
  h: number,
  pad: number,
  opts?: ChartRenderOpts,
) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.35;
  const fontFamily = opts?.fontFamily ?? "Inter";

  const axes: { name: string; idx: number; min: number; max: number }[] = [];
  for (let c = 0; c < columnNames.length; c++) {
    if (c === ci) continue;
    const [min, max] = numRange(rows, c);
    const sampleN = rows.slice(0, 40).filter(r => {
      const v = Number(r[c]);
      return r[c] !== null && r[c] !== "" && typeof r[c] !== "boolean" && !isNaN(v);
    }).length;
    if (sampleN < Math.min(12, rows.length * 0.3)) continue;
    axes.push({ name: columnNames[c]!, idx: c, min, max });
    if (axes.length >= 8) break;
  }
  if (axes.length < 3) return;

  const catMap = new Map<string, number>();
  if (ci >= 0) {
    for (const r of rows) {
      const k = String(r[ci]);
      if (!catMap.has(k)) catMap.set(k, catMap.size);
    }
  }

  const fontSize = Math.max(9, opts?.axisFontSize ?? 10);
  const edge = Math.min(40, (w - 2 * pad) / (axes.length * 2));
  const axisXs = axes.map((_, i) => pad + edge + (i / (axes.length - 1)) * (w - 2 * pad - 2 * edge));
  const spacing = (w - 2 * pad - 2 * edge) / (axes.length - 1);
  const plotTop = pad + fontSize + 6;
  const plotBot = h - pad - fontSize - 6;

  const maxLines = Math.min(rows.length, 400);
  const stride = Math.max(1, Math.floor(rows.length / maxLines));
  for (let ri = 0; ri < rows.length; ri += stride) {
    const r = rows[ri]!;
    const colorIdx = ci >= 0 ? (catMap.get(String(r[ci])) ?? 0) : 0;
    ctx.strokeStyle = palette[colorIdx % palette.length]!;
    ctx.lineWidth = 1;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    let started = false;
    axes.forEach((ax, i) => {
      const v = Number(r[ax.idx]);
      if (isNaN(v)) return;
      const t = (v - ax.min) / (ax.max - ax.min || 1);
      const y = plotBot - t * (plotBot - plotTop);
      if (!started) { ctx.moveTo(axisXs[i]!, y); started = true; }
      else ctx.lineTo(axisXs[i]!, y);
    });
    ctx.stroke();
  }

  // Axes on top of the lines, each with its own min / max
  ctx.globalAlpha = 1;
  axes.forEach((ax, i) => {
    const x = axisXs[i]!;
    ctx.strokeStyle = opts?.axisLineColor ?? opts?.themeBorder ?? "#2a2a30";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBot);
    ctx.stroke();
    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.font = `600 ${fontSize}px '${fontFamily}', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(fitTextEllipsis(ctx, ax.name, spacing - 8), x, plotBot + 6);
    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText(formatDataValue(ax.max), x, plotTop - 3);
    ctx.textBaseline = "top";
    ctx.globalAlpha = 0.8;
    ctx.fillText(formatDataValue(ax.min), x, plotBot + fontSize + 8);
    ctx.globalAlpha = 1;
  });
  ctx.textBaseline = "alphabetic";
  if (ci >= 0) setLegend(opts, [...catMap.entries()].map(([label, i]) => ({ label, color: palette[i % palette.length]! })));
}

// --- Helpers ---

function drawGridLines(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  drawChartGrid(ctx, w, h, pad, opts, { x: [xMin, xMax], y: [yMin, yMax] });
}

function drawAxisTicks(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  drawChartTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}
