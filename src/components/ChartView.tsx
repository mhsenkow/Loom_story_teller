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
import { radiusFromPointSize } from "@/lib/chartInk";
import { useChartTheme } from "@/components/useChartTheme";
import { resolveRuntimeTheme } from "@/lib/resolveEffectiveTheme";
import { resolveThemeChartStyle } from "@/lib/themeChartStyle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type LoomState, useLoomStore } from "@/lib/store";
import { createChartMonitorDraft, monitorRefLines } from "@/lib/monitoring/chartBridge";
import { ChartCard } from "@/components/ChartCard";
import type { GPUScatterPoint } from "@/lib/webgpu";
import { acquireSharedGpuDevice } from "@/lib/gpuDevice";
import { gpuCategoryIndex } from "@/lib/gpuPalette";
import { buildChartA11ySummary } from "@/lib/chartA11ySummary";
import { chartEntranceKey, markChartEntrancePlayed, shouldPlayChartEntrance } from "@/lib/chartEntranceOnce";
import { dataTableRowsFromHits } from "@/lib/chartDataTableFromHits";
import { keyboardNavigableHits, nextMarkIndex } from "@/lib/chartMarkKeyboard";
import { calloutLines, drawMarkFocus, drawPinnedCallout, findHitForMark, markFocusStyle, markRefForHit, markRefForRow, sameMark, type CalloutBox, type MarkRef } from "@/lib/markFocus";
import { analysisScope, analysisUnavailable } from "@/lib/timeSeriesAnalysis";
import { smartOverlayPalette } from "@/lib/chartSmartOverlayStyle";
import { chartStageLiveMessage, chartStageStatus } from "@/lib/chartStageStatus";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { describeChartColorStatus, discreteSeriesColors, getThemeUiColors, hexToRgb01, resolveChartColors } from "@/lib/chartPalettes";
import { useIsMobile, useMobileLiveEdit, useShellMode } from "@/lib/useMediaQuery";
import { aspectLabel, fitChartFrame } from "@/lib/chartViewport";
import { automaticPlotBounds, chartSpacePadding, chartStageGutter } from "@/lib/chartSpace";
import { type ChartRecommendation, createChartRec, getBestSuggestion, getRecommendationReason, getTopSuggestions, recommend, recommendStorySequence, tryBuildRandomChartRec, type YAggregateOption } from "@/lib/recommendations";
import { chartNumber } from "@/lib/chartNumbers";
import { chartCapabilities, encodingChannelLabels, formatChartAggregationSummary, getChartRenderIssue, resolveLayoutDirection, svgExportMode } from "@/lib/chartSupport";
import { canUseWebGpuScatter } from "@/lib/webGpuScatterEligibility";
import { notifyChartPainted } from "@/lib/chartPaintSignal";
import { drawCanvasAnnotations } from "@/lib/canvasAnnotationDraw";
import { CanvasArrangeOverlay, type ArrangeChange } from "./CanvasArrangeOverlay";
import { ARRANGEMENT_KEYS, ARRANGE_PLOT_KINDS, arrangementPlot, arrangedFrameSize, hasCanvasArrangement, titleArrangementRect } from "@/lib/canvasArrangement";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";
import { type ChartChromeLayout, type ChartChromeTarget, chromeHighlightRect, chromeSectionFor, pickChartChromeRegion } from "@/lib/chartChromeLink";
import { type AtlasBundle, type AtlasKind, loadAtlas } from "@/lib/geoAtlas";
import { resolveTooltipPresentation } from "@/lib/chartTooltipMode";
import { ChartTooltipCard } from "@/components/ChartTooltipCard";
import { isOddChartKind, renderOddChart } from "@/lib/oddCharts";
import { drawFireflyChrome, extractGpuScenePoints, fireflyDensity, fireflyGlowPoints, fireflyPalette, fireflyLayout, type GpuSceneKind, isGpuSceneKind, isWebGpuDrawableScene, renderGpuSceneCanvas } from "@/lib/gpuScenes";
import { globeCameraForData, isGeoFamilyKind, isGeoMapKind, isWebGpuGlobeKind, pickAtlasKind, renderGeoMapCanvas } from "@/lib/geoMaps";
import { type CubeAxisSlot, type CubeHoverCell, DataCubePivotBar, DataCubePivotTable } from "@/components/DataCubePivot";
import { buildDataCube, buildPivotTable, cubeCellCenter, cubeCellKey, cubeCellTooltip, dataCubeChartView, type DataCube, type DataCubeRenderOpts, drawDataCubeBackLayer, drawDataCubeFrontLayer, pickDataCubeCell, renderDataCubeCanvas } from "@/lib/dataCube";
import { FOOTNOTE_BAND_PX, densityAwarePointMarks, fitTextEllipsis, resolveChartPad, subsampleRowsForDensity, titleBandBottom } from "@/lib/chartLayout";
import { chartFont, chartTypeRamp, resolveChartAxisFontSize } from "@/lib/chartType";
import { chartFontStack, ensureChartFontLoaded, resolveChartFontFamily } from "@/lib/fontCatalog";
import { ensureContrast } from "@/lib/wcagColor";
import { densityPointBudget, resolveStageBoxSize, stagePixelRatio } from "@/lib/chartStagePixels";
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
import { formatSourceFootnote, resolveDataProvenance } from "@/lib/dataProvenance";
import { formatAxisValue } from "@/lib/chartAxes";
import { VISUAL_PRESETS } from "@/lib/lookSystem";
import { StartHere } from "@/components/StartHere";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  readSuggestionsRailFromSession,
  writeSuggestionsRailToSession,
} from "@/lib/shellLayout";
import { allowedRowIndices, buildBarFacetGrid, type Canvas2DHitContext, type HitTarget, mergeChartTooltip, pickCanvasTooltipRowIndex, pickHitTarget, projectRowForTooltip, resolveTooltipFieldNames, rowForHitTarget, rowMatchesTooltipLink } from "@/lib/chartTooltip";
import { clampTopN, countFacetGroupsDropped, DEFAULT_TOP_N, layoutFacetCells, partitionRowsByFacet } from "@/lib/chartFacets";
import { computeFacetSharedScatterBounds, computeFacetSharedValueDomain } from "@/lib/chartFacetScales";
import { resolveGpuScatterPads } from "@/lib/chartPlotRect";
import { buildCategoricalLegendEntries, drawLegend } from "@/lib/chartLegend";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import { plotOf, valueTitle } from "@/lib/canvasCharts/plumbing";
import { renderFullSunburst } from "@/lib/canvasCharts/sunburst";
import { CHART_KIND_CATALOG } from "@/lib/chartKindSearch";
import { invScaleY, scaleDomain, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { applyChartTimeWindow, composeChartFootnote, formatChartTimeFootnote, resolveEffectiveTimeRec } from "@/lib/chartTime";
import { applyExplorerViewToRows, explorerFiltersActive } from "@/lib/explorerViewRows";
import { ViewCohortBar } from "@/components/ViewCohortBar";
import {
  CellIconBtn,
  ChartCellRail,
  IconArrange,
  IconDataTable,
  IconBell,
  IconEditTitle,
  IconRefresh,
  IconSave,
  IconWhy,
} from "@/components/ChartCellChrome";
import { goToDashboardsAfterSave, saveChartView } from "@/lib/saveChartView";
import { DEFAULT_PAD, isNumericType, offsetHitTargets, pointInPolygon, scatterYDomain } from "@/lib/canvasCharts/shared";
import { drawAxisTicks, drawGridLines, drawSmartOverlays } from "@/lib/canvasCharts/primitives";
import { renderFullScatter } from "@/lib/canvasCharts/scatter";
import { drawReferenceLines } from "@/lib/canvasCharts/axisHelpers";
import { type BarModel, barsShouldBeHorizontal, computeBarModel, renderFullBar, renderFullHistogram } from "@/lib/canvasCharts/bar";
import { renderFullHeatmap, renderFullLine } from "@/lib/canvasCharts/lineHeatmap";
import { renderFullArea, renderFullBox, renderFullStrip } from "@/lib/canvasCharts/distributions";
import { renderFullBubble, renderFullPie } from "@/lib/canvasCharts/pieBubble";
import { renderFullLollipop, renderFullRadar, renderFullViolin, renderFullWaterfall } from "@/lib/canvasCharts/violinRadar";
import { renderFullArcDiagram, renderFullForceBubble, renderFullNetwork, renderFullSankey, renderFullTreemap } from "@/lib/canvasCharts/flowCharts";
import { renderFullCorrMatrix, renderFullDumbbell, renderFullFunnel, renderFullHexbin, renderFullParallel, renderFullPareto, renderFullRidgeline } from "@/lib/canvasCharts/statCharts";
import { markSymbols } from "@/lib/markSymbols";
export type { ChartRenderOpts } from "@/lib/chartRenderTypes";

// The WebGPU globe pass (globe.wgsl) only draws glowing points — no sphere,
// coastlines, legend or hit targets — and its 2D layer covered it, so WebGPU
// devices (iPadOS Safari included) showed an empty globe. The Canvas 2D globe
// draws all of that and handles live-feed point counts fine; keep it on 2D
// until the GPU pass composites a basemap.
const GPU_GLOBE_ENABLED = false;

/** x/y charts that share the L-frame + axis titles drawn by the dispatch. */
const FRAMED_KINDS = new Set<string>([
  "scatter", "bar", "pareto", "histogram", "line", "area", "box", "bubble", "violin", "waterfall", "hexbin", "corrMatrix",
]);
/** Charts with a category-label gutter: they draw their own frame; dispatch still titles the axes. */
const OWN_FRAME_KINDS = new Set<string>(["strip", "lollipop", "dumbbell", "ridgeline", "heatmap"]);
/** Series kinds split by the Shape / Emoji column when Color is empty. */
const SYMBOL_SERIES_KINDS = new Set<string>(["line", "radar", "bump"]);


/**
 * Backing-store scale for the chart stage. Platform captures pin it (so a
 * 1080px export lays out identically on every device); otherwise screen DPR
 * capped for phone / Retina buffer size. Canvas sizing and every draw pass
 * must agree on this value.
 */
function stageDpr(): number {
  return stagePixelRatio(useLoomStore.getState().socialExportTarget?.pixelRatio);
}

type GpuScatterRenderer = import("@/lib/webgpu").LoomRenderer;
type GpuSceneRenderer = import("@/lib/webgpuScenes").LoomSceneRenderer;
type GpuCubeRenderer = import("@/lib/webgpuCube").LoomCubeRenderer;

export function ChartView() {
  // A string key (stable between checks) so a monitor's nextRunAt ticking doesn't redraw the chart.
  const monitorLinesKey = useLoomStore((s) => JSON.stringify(monitorRefLines(s.monitors, s.selectedFile?.path, s.activeChart?.yField)));
  const monitorLines = useMemo(() => JSON.parse(monitorLinesKey) as ReturnType<typeof monitorRefLines>, [monitorLinesKey]);
  const chartMonitorCount = useLoomStore((s) => {
    const path = s.selectedFile?.path;
    return path?.startsWith("stream://") ? s.monitors.filter((m) => `stream://${m.metric.source}` === path).length : 0;
  });
  const {
    selectedFile, sampleRows, chartRecs, activeChart, setActiveChart, setPanelTab, columnStats,
    chartVisualOverrides: savedChartVisualOverrides, aiSuggestionReason, chartTitleOverrides, setChartTitleOverride,
    setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, smartResults, appSettings,
    setSelectedRowIndices, setToast, chartAnnotations,
    setHoveredRowIndex,
    tooltipLink, setTooltipLink,
    pinnedTooltips, togglePinnedTooltip, setPinnedTooltips,
    customRefLines, chartInteractionMode, setChartInteractionMode,
    crosshairPos, setCrosshairPos,
    lassoPoints, setLassoPoints,
    barStackMode, connectScatterTrail, showMarginals,
    selectedRowIndices,
    rulerPins, setRulerPins,
    setPromptDialog, querySql,
    createStoryDashboard, setDashboardsExpanded,
    startDeepScan,
    chartChromeFocus, setChartChromeFocus, setChartPanelSection, setPanelOpen,
    setChartVisualOverrides,
    inspectingFilePath,
      suggestionsRailOpen, setSuggestionsRailOpen,
      tableColumnFilters, tableFilterRowIndices, tableSortColumn, tableSortDir,
      viewTimeField, viewTimeWindow, applyBrushSelection,
  } = useLoomStore(
    useShallow((s: LoomState) => ({
      selectedFile: s.selectedFile,
      sampleRows: s.sampleRows,
      chartRecs: s.chartRecs,
      activeChart: s.activeChart,
      setActiveChart: s.setActiveChart,
      setPanelTab: s.setPanelTab,
      columnStats: s.columnStats,
      chartVisualOverrides: s.chartVisualOverrides,
      aiSuggestionReason: s.aiSuggestionReason,
      chartTitleOverrides: s.chartTitleOverrides,
      setChartTitleOverride: s.setChartTitleOverride,
      setPngExportHandler: s.setPngExportHandler,
      setSvgExportHandler: s.setSvgExportHandler,
      setSvgExportLabel: s.setSvgExportLabel,
      vegaSpec: s.vegaSpec,
      smartResults: s.smartResults,
      appSettings: s.appSettings,
      setSelectedRowIndices: s.setSelectedRowIndices,
      setToast: s.setToast,
      chartAnnotations: s.chartAnnotations,
      setHoveredRowIndex: s.setHoveredRowIndex,
      tooltipLink: s.tooltipLink,
      setTooltipLink: s.setTooltipLink,
      pinnedTooltips: s.pinnedTooltips,
      togglePinnedTooltip: s.togglePinnedTooltip,
      setPinnedTooltips: s.setPinnedTooltips,
      customRefLines: s.customRefLines,
      chartInteractionMode: s.chartInteractionMode,
      setChartInteractionMode: s.setChartInteractionMode,
      crosshairPos: s.crosshairPos,
      setCrosshairPos: s.setCrosshairPos,
      lassoPoints: s.lassoPoints,
      setLassoPoints: s.setLassoPoints,
      barStackMode: s.barStackMode,
      connectScatterTrail: s.connectScatterTrail,
      showMarginals: s.showMarginals,
      selectedRowIndices: s.selectedRowIndices,
      rulerPins: s.rulerPins,
      setRulerPins: s.setRulerPins,
      setPromptDialog: s.setPromptDialog,
      querySql: s.querySql,
      createStoryDashboard: s.createStoryDashboard,
      setDashboardsExpanded: s.setDashboardsExpanded,
      startDeepScan: s.startDeepScan,
      chartChromeFocus: s.chartChromeFocus,
      setChartChromeFocus: s.setChartChromeFocus,
      setChartPanelSection: s.setChartPanelSection,
      setPanelOpen: s.setPanelOpen,
      setChartVisualOverrides: s.setChartVisualOverrides,
      inspectingFilePath: s.inspectingFilePath,
      suggestionsRailOpen: s.suggestionsRailOpen,
      setSuggestionsRailOpen: s.setSuggestionsRailOpen,
      tableColumnFilters: s.tableColumnFilters,
      tableFilterRowIndices: s.tableFilterRowIndices,
      tableSortColumn: s.tableSortColumn,
      tableSortDir: s.tableSortDir,
      viewTimeField: s.viewTimeField,
      viewTimeWindow: s.viewTimeWindow,
      applyBrushSelection: s.applyBrushSelection,
    })),
  );

  // Restore suggestions rail preference once (session).
  useEffect(() => {
    const pref = readSuggestionsRailFromSession();
    if (pref != null) setSuggestionsRailOpen(pref);
  }, [setSuggestionsRailOpen]);

  useEffect(() => {
    writeSuggestionsRailToSession(suggestionsRailOpen);
  }, [suggestionsRailOpen]);

  const reducedMotion = useReducedMotion();
  const effectiveTheme = useChartTheme();
  const isMobile = useIsMobile();
  const panelOpen = useLoomStore((s) => s.panelOpen);
  const readoutsObscured = isMobile && panelOpen;
  const [arranging, setArranging] = useState(false);
  const [arrangeReady, setArrangeReady] = useState(false);
  const arrangePanelWasOpen = useRef(false);
  const finishArranging = useCallback(() => {
    setArranging(false);
    setArrangeReady(false);
    setArrangementPreview(null);
    if (arrangePanelWasOpen.current) useLoomStore.getState().setPanelOpen(true);
    arrangePanelWasOpen.current = false;
  }, []);
  const toggleArranging = useCallback(() => {
    if (arranging) {
      finishArranging();
      return;
    }
    arrangePanelWasOpen.current = isMobile && useLoomStore.getState().panelOpen;
    if (arrangePanelWasOpen.current) setPanelOpen(false);
    setArrangeReady(false);
    setArranging(true);
    setArrangementPreview(null);
  }, [arranging, finishArranging, isMobile, setPanelOpen]);
  const [arrangementPreview, setArrangementPreview] = useState<ArrangeChange | null>(null);
  const [arrangementLayout, setArrangementLayout] = useState<ChartChromeLayout | null>(null);
  const chartVisualOverrides = useMemo(() => resolveThemeChartStyle(effectiveTheme, arrangementPreview && "visual" in arrangementPreview ? { ...savedChartVisualOverrides, ...arrangementPreview.visual } : savedChartVisualOverrides), [effectiveTheme, savedChartVisualOverrides, arrangementPreview]);
  const reportArrangementLayout = useCallback((layout: ChartChromeLayout) => {
    setArrangementLayout((old) => JSON.stringify(old) === JSON.stringify(layout) ? old : layout);
  }, []);
  const commitArrangement = useCallback((change: ArrangeChange, group?: string) => {
    const store = useLoomStore.getState();
    if ("visual" in change) store.editChartVisualOverrides(change.visual, group);
    else if (store.activeChart) {
      const { id, ...patch } = change.annotation;
      store.updateChartAnnotation(store.activeChart.id, id, patch);
    }
  }, []);
  const resetArrangement = useCallback(() => {
    const reset = Object.fromEntries(ARRANGEMENT_KEYS.map((k) => [k, undefined])) as ChartVisualOverrides;
    reset.legendPosition = "auto";
    commitArrangement({ visual: reset });
  }, [commitArrangement]);
  useEffect(() => { setArranging(false); setArrangementPreview(null); setArrangementLayout(null); }, [activeChart?.id]);
  const shellMode = useShellMode();
  const liveEdit = useMobileLiveEdit();
  // Auto uses the actual center-panel space; only explicit device previews impose a width cap.
  const [hostSize, setHostSize] = useState({ w: 800, h: 500 });
  const socialExportTarget = useLoomStore((s) => s.socialExportTarget);
  const socialExportReady = useLoomStore((s) => s.socialExportReady);
  // Phones, tablet Stage Manager, and panel-squeezed hosts always fill —
  // social aspect framing on a narrow stage becomes a postage-stamp letterbox.
  // Platform export overrides this so we can still hit exact pixel targets.
  const devicePreset = appSettings.chartDevice ?? "auto";
  const hostIsNarrow = hostSize.w > 0 && hostSize.w < 768 && !socialExportTarget;
  const forceFillStage =
    !socialExportTarget &&
    devicePreset === "auto" &&
    (isMobile || hostIsNarrow || (shellMode === "tablet" && hostSize.w > 0 && hostSize.w < 900));
  const chartAspect =
    socialExportTarget?.presetId && socialExportTarget.presetId !== "current"
      ? (appSettings.chartAspect ?? "free")
      : forceFillStage
        ? "free"
        : (appSettings.chartAspect ?? "free");
  const chartDevice = socialExportTarget ? "desktop" : devicePreset;

  const openChartEditor = useCallback(() => {
    setPanelTab("chart");
    if (!useLoomStore.getState().panelOpen) useLoomStore.getState().togglePanel();
  }, [setPanelTab]);

  // Kinds that never read Color (hexbin, histogram, heatmap…) may carry a stale
  // colorField from an earlier type — don't let it pick palettes or legends.
  const effectiveColorField =
    activeChart && chartCapabilities(activeChart.kind).colorChannel ? (activeChart.colorField ?? null) : null;

  const colors = useMemo(() => {
    const colorField = effectiveColorField;
    const col = colorField
      ? columnStats.find((c) => c.name === colorField)
      : undefined;
    const colorFieldType = col
      ? (isNumericType(col.data_type) ? "quantitative" : "nominal")
      : null;
    const resolved = resolveChartColors({
      paletteId: chartVisualOverrides.colorPalette ?? "auto",
      theme: effectiveTheme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    });
    return discreteSeriesColors(resolved, Math.max(8, resolved.colors.length));
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.colorPaletteReverse,
    chartVisualOverrides.colorScaleKind,
    effectiveTheme,
    appSettings.colorblindCharts,
    activeChart?.kind,
    activeChart?.channelInvert?.color,
    effectiveColorField,
    columnStats,
  ]);

  const continuousStops = useMemo(() => {
    const colorField = effectiveColorField;
    const col = colorField
      ? columnStats.find((c) => c.name === colorField)
      : undefined;
    const colorFieldType = col
      ? (isNumericType(col.data_type) ? "quantitative" : "nominal")
      : null;
    return resolveChartColors({
      paletteId: chartVisualOverrides.colorPalette ?? "auto",
      theme: effectiveTheme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    }).colors;
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.colorPaletteReverse,
    chartVisualOverrides.colorScaleKind,
    effectiveTheme,
    appSettings.colorblindCharts,
    activeChart?.kind,
    activeChart?.channelInvert?.color,
    effectiveColorField,
    columnStats,
  ]);
  const opacity = chartVisualOverrides.opacity ?? 0.7;
  const pointSize = chartVisualOverrides.pointSize ?? 12;

  const chartColorInfo = useMemo(() => {
    if (!activeChart) return null;
    const colorField = effectiveColorField;
    const col = colorField ? columnStats.find((c) => c.name === colorField) : undefined;
    const colorFieldType = col
      ? isNumericType(col.data_type)
        ? ("quantitative" as const)
        : ("nominal" as const)
      : null;
    return describeChartColorStatus({ ...activeChart, colorField }, {
      paletteId: chartVisualOverrides.colorPalette ?? "auto",
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
      reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
      theme: effectiveTheme,
      colorblind: !!appSettings.colorblindCharts,
      colorFieldType,
      channelLabel: encodingChannelLabels(activeChart.kind).color,
    });
  }, [
    activeChart,
    effectiveColorField,
    columnStats,
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.colorScaleKind,
    chartVisualOverrides.colorPaletteReverse,
    effectiveTheme,
    appSettings.colorblindCharts,
  ]);

  const chartSampleRows = useMemo(() => {
    if (!sampleRows) return sampleRows;
    // Explorer filters/sort first so Chart paints the same cohort as the table.
    const view = applyExplorerViewToRows(sampleRows.rows, sampleRows.columns, {
      columnFilters: tableColumnFilters,
      filterRowIndices: tableFilterRowIndices,
      columnStats,
      sortColumn: tableSortColumn,
      sortDir: tableSortDir,
    });
    let rows = view.rows;
    let sourceIndices = view.sourceIndices;
    let changed = view.changed;
    const timeRec = resolveEffectiveTimeRec(viewTimeWindow, viewTimeField, activeChart);
    const sliced = applyChartTimeWindow(rows, sampleRows.columns, timeRec);
    if (sliced.filtered) {
      rows = sliced.rows;
      sourceIndices = sliced.sourceIndices.map((i) => view.sourceIndices[i]!);
      changed = true;
    }
    if (!changed) return sampleRows;
    return { ...sampleRows, rows, rowSourceIndices: sourceIndices };
  }, [
    sampleRows,
    activeChart,
    tableColumnFilters,
    tableFilterRowIndices,
    tableSortColumn,
    tableSortDir,
    columnStats,
    viewTimeField,
    viewTimeWindow,
  ]);

  /** Source credit + “when?” under the plot (palette is a ramp on the right, not text). */
  const chartFootnoteText = useMemo(() => {
    const rows = chartSampleRows ?? sampleRows;
    const timeRec = resolveEffectiveTimeRec(viewTimeWindow, viewTimeField, activeChart);
    const timeLine = formatChartTimeFootnote(
      rows?.rows,
      rows?.columns,
      {
        timeWindowField: timeRec.timeWindowField,
        timeWindow: timeRec.timeWindow,
        timeField: activeChart?.timeField,
        xField: activeChart?.xField,
      },
      columnStats,
    );
    const footMode = chartVisualOverrides.sourceFootnote ?? "credit";
    let sourceLine: string | null = null;
    if (footMode !== "off" && selectedFile) {
      const prov = resolveDataProvenance(selectedFile, {
        loadedRows: rows?.rows.length ?? null,
        totalRows: rows?.total_rows ?? selectedFile.row_count,
      });
      if (prov) sourceLine = formatSourceFootnote(prov, footMode);
    }
    return composeChartFootnote(sourceLine, timeLine);
  }, [
    chartSampleRows,
    sampleRows,
    activeChart,
    columnStats,
    chartVisualOverrides.sourceFootnote,
    selectedFile,
    viewTimeWindow,
    viewTimeField,
  ]);

  const saveActiveChartView = useCallback(() => {
    if (!selectedFile || !activeChart) return;
    const base = {
      filePath: selectedFile.path,
      fileName: selectedFile.name,
      chart: activeChart,
      visualOverrides: chartVisualOverrides,
      querySql,
      sampleRows,
    };
    setPromptDialog({
      title: "Save chart view",
      message: "Name this view, then save it — or save and jump to Dashboards to place it.",
      defaultValue: activeChart.title || "Chart view",
      confirmLabel: "Save",
      secondaryConfirmLabel: "Save and go to Dashboards",
      onConfirm: async (name) => {
        if (name == null || !name.trim()) return;
        const id = await saveChartView({ ...base, name });
        setToast(id ? "Chart view saved" : "Could not save chart view");
      },
      onSecondaryConfirm: async (name) => {
        if (!name.trim()) return;
        const id = await saveChartView({ ...base, name });
        if (!id) {
          setToast("Could not save chart view");
          return;
        }
        goToDashboardsAfterSave();
        setToast("Saved — add it to a dashboard");
      },
    });
  }, [
    selectedFile,
    activeChart,
    sampleRows,
    chartVisualOverrides,
    querySql,
    setPromptDialog,
    setToast,
  ]);

  const chartFontFamily = resolveChartFontFamily(chartVisualOverrides.fontFamily, appSettings.font, appSettings.faces);

  const footnoteOpts = useCallback(
    (themeMuted?: string, themeBorder?: string) => ({
      align: (chartVisualOverrides.sourceFootnoteAlign ?? "left") as "left" | "center" | "right",
      fontFamily: chartFontFamily,
      themeMuted,
      axisFontSize: resolveChartAxisFontSize(chartVisualOverrides.axisFontSize),
      themeBorder,
      colorRamp: chartColorInfo?.stops ?? null,
      colorRampLabel: chartColorInfo?.fieldLabel ?? null,
      colorRampContinuous: chartColorInfo?.continuous ?? true,
      band: (chartVisualOverrides.chromeInfoBand ?? "footer") as "footer" | "header",
      headerTop:
        (chartVisualOverrides.chromeInfoBand ?? "footer") === "header"
          ? titleBandBottom(chartVisualOverrides.titleLayout) + 6
          : undefined,
    }),
    [
      chartVisualOverrides.sourceFootnoteAlign,
      chartFontFamily,
      chartVisualOverrides.axisFontSize,
      chartVisualOverrides.chromeInfoBand,
      chartVisualOverrides.titleLayout,
      chartColorInfo,
    ],
  );

  const themeUi = useMemo(() => getThemeUiColors(effectiveTheme), [effectiveTheme]);

  // Chart stage pixel size — must be in draw-effect deps so aspect/device
  // framing (and any resize that clears canvases) triggers a redraw.
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });
  const containerWidth = containerSize.w;
  const isCompact = containerWidth < 400;

  const chartRenderOpts = useMemo((): ChartRenderOpts => {
    const frame = chartVisualOverrides.chartFrame ?? "focus";
    const framePad = chartSpacePadding(chartVisualOverrides.spaceUse, containerWidth, chartVisualOverrides.chartPadding, frame);
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
      !caps?.cartesian || (isCompact && chartVisualOverrides.showGrid == null)
        ? false
        : chartVisualOverrides.showGrid !== false &&
          (chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid") !== "none" &&
          (chartVisualOverrides.showGrid === true || detail !== "plain");

    const blendMode = chartVisualOverrides.blendMode ?? "source-over";

    return {
      titleX: chartVisualOverrides.titleX,
      titleY: chartVisualOverrides.titleY,
      titleWidth: chartVisualOverrides.titleWidth,
      titleScale: chartVisualOverrides.titleScale,
      colors,
      continuousStops,
      opacity,
      opacityUserSet: typeof chartVisualOverrides.opacity === "number",
      pointSize: isCompact ? Math.max(4, pointSize * 0.7) : pointSize,
      fontFamily: chartFontFamily,
      titleFontWeight: chartVisualOverrides.titleFontWeight ?? 600,
      titleItalic: chartVisualOverrides.titleItalic ?? false,
      tickRotation: chartVisualOverrides.tickRotation ?? 0,
      axisFontSize: resolveChartAxisFontSize(chartVisualOverrides.axisFontSize, isCompact),
      markShape: motifShape,
      markerMode: chartVisualOverrides.markerMode ?? "shape",
      markEmoji: chartVisualOverrides.markEmoji ?? "😀",
      shapeField: activeChart?.shapeField ?? null,
      emojiField: activeChart?.emojiField ?? null,
      emojiMap: activeChart?.emojiMap,
      markMaterial: chartVisualOverrides.markMaterial,
      markStroke: chartVisualOverrides.markStroke ?? motif === "ring",
      markStrokeWidth: chartVisualOverrides.markStrokeWidth ?? 1,
      markStrokeColor: chartVisualOverrides.markStrokeColor ?? "auto",
      markJitter: chartVisualOverrides.markJitter ?? 0,
      sizeScale: chartVisualOverrides.sizeScale ?? 1,
      barCornerRadius: chartVisualOverrides.barCornerRadius ?? (motif === "bar" ? 0 : 3),
      lineStrokeStyle: chartVisualOverrides.lineStrokeStyle ?? "solid",
      lineCap: chartVisualOverrides.lineCap,
      lineJoin: chartVisualOverrides.lineJoin,
      lineCurveSmooth: chartVisualOverrides.lineCurveSmooth ?? false,
      lineWidth: chartVisualOverrides.lineWidth ?? (motif === "ticks" ? 1 : 1.5),
      axisLineColor: chartVisualOverrides.axisLineColor ?? themeUi.border,
      axisLineWidth: chartVisualOverrides.axisLineWidth ?? axisFromStyle.axisLineWidth ?? 1,
      gridStyle: chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid",
      gridOpacity: chartVisualOverrides.gridOpacity ?? axisFromStyle.gridOpacity ?? 0.5,
      tickCount: chartVisualOverrides.tickCount ?? 5,
      axisLabelColor: ensureContrast(chartVisualOverrides.axisLabelColor ?? themeUi.label, themeUi.bg),
      showGrid,
      chartPadding: framePad,
      spaceUse: chartVisualOverrides.spaceUse ?? "auto",
      // "auto" shows a key only when a color field is encoded, in the emptiest corner
      legendOffsetX: chartVisualOverrides.legendOffsetX,
      legendOffsetY: chartVisualOverrides.legendOffsetY,
      legendWidth: chartVisualOverrides.legendWidth,
      legendHeight: chartVisualOverrides.legendHeight,
      plotX: chartVisualOverrides.plotX, plotY: chartVisualOverrides.plotY, plotWidth: chartVisualOverrides.plotWidth, plotHeight: chartVisualOverrides.plotHeight,
      legendPosition: !caps?.legend ? "none" : (chartVisualOverrides.legendPosition ?? "auto"),
      showDataLabels,
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
      sourceFootnote: Boolean(chartFootnoteText || chartColorInfo?.stops?.length),
      sourceFootnoteAlign: chartVisualOverrides.sourceFootnoteAlign ?? "left",
      chromeInfoBand: chartVisualOverrides.chromeInfoBand ?? "footer",
      themeBg: themeUi.bg,
      themeText: themeUi.text,
      themeMuted: themeUi.label,
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
      rollingWindow: activeChart?.rollingWindow ?? undefined,
      yScale: activeChart?.yScale ?? undefined,
      seriesNormalize: activeChart?.seriesNormalize ?? undefined,
      residualOverlay: activeChart?.residualOverlay ?? undefined,
      anomalyHighlight: activeChart?.anomalyHighlight ?? undefined,
      bumpMode: activeChart?.bumpMode ?? undefined,
      pyramidScaleMode: activeChart?.pyramidScaleMode ?? undefined,
      deltaDisplay: activeChart?.deltaDisplay ?? undefined,
      layoutDirection: activeChart?.layoutDirection ?? undefined,
      channelInvert: activeChart?.channelInvert ?? undefined,
    };
  }, [colors, continuousStops, opacity, pointSize, chartVisualOverrides, chartFontFamily, themeUi, isCompact, containerWidth, activeChart, barStackMode, chartFootnoteText, chartColorInfo]);

  const renderIssue = useMemo(
    () => getChartRenderIssue(activeChart, chartSampleRows ?? sampleRows),
    [activeChart, chartSampleRows, sampleRows],
  );

  const sampleHonestyLabel = useMemo(() => {
    if (!sampleRows) return "";
    const shown = chartSampleRows?.rows.length ?? sampleRows.rows.length;
    const n = sampleRows.rows.length;
    const t = sampleRows.total_rows ?? n;
    const filtered = explorerFiltersActive(tableColumnFilters, tableFilterRowIndices);
    if (filtered && shown < n) return `${shown.toLocaleString()} / ${n.toLocaleString()} filtered`;
    if (shown < n) return `${shown.toLocaleString()} / ${n.toLocaleString()} in window`;
    if (t > n) return `${n.toLocaleString()} / ${t.toLocaleString()} rows`;
    return `${n.toLocaleString()} rows`;
  }, [sampleRows, chartSampleRows, tableColumnFilters, tableFilterRowIndices]);

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
  }, [columnStats, selectedFile, sampleRows, setActiveChart]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  const axesOverlayRef = useRef<HTMLCanvasElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!arranging) return;
    let frame = 0;
    let previous = "";
    let stableFrames = 0;
    const settle = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const geometry = [rect.x, rect.y, rect.width, rect.height].map((v) => Math.round(v * 100)).join(":");
      stableFrames = geometry === previous ? stableFrames + 1 : 0;
      previous = geometry;
      if (stableFrames >= 2) { setArrangeReady(true); return; }
      frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [arranging]);
  const chartFrameMax = useMemo(() => {
    if (socialExportTarget) {
      return {
        width: socialExportTarget.width,
        height: socialExportTarget.height,
        aspectLocked: true,
      };
    }
    // Desktop cell rail sits beside the plot — hug the icons (~40px + gap).
    const railReserve = !isMobile ? 48 : 0;
    return fitChartFrame({
      hostW: Math.max(40, hostSize.w - railReserve),
      hostH: hostSize.h,
      aspectId: chartAspect,
      device: chartDevice,
      gutter: chartStageGutter(chartVisualOverrides.spaceUse),
    });
  }, [hostSize.w, hostSize.h, chartAspect, chartDevice, socialExportTarget, isMobile, chartVisualOverrides.spaceUse]);
  const chartFrameSize = useMemo(() => {
    if (socialExportTarget) return chartFrameMax;
    return arrangedFrameSize(chartFrameMax, chartVisualOverrides);
  }, [chartFrameMax, chartVisualOverrides.canvasWidth, chartVisualOverrides.canvasHeight, socialExportTarget]);
  const rendererRef = useRef<GpuScatterRenderer | null>(null);
  const sceneRendererRef = useRef<GpuSceneRenderer | null>(null);
  const cubeRendererRef = useRef<GpuCubeRenderer | null>(null);
  const [geoAtlasBundle, setGeoAtlasBundle] = useState<AtlasBundle | null>(null);
  const [cubeHover, setCubeHover] = useState<CubeHoverCell | null>(null);
  /** Axis / title / legend under the pointer. Outline only — does not open the panel. */
  const [chromeHover, setChromeHover] = useState<ChartChromeTarget | null>(null);
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
  const scenePinchRef = useRef<{ dist: number; zoom: number } | null>(null);
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
  const forceCanvasCapture = previewCaptureActive || !!socialExportTarget || socialExportReady || arranging || hasCanvasArrangement(chartVisualOverrides);
  const useWebGPUScatter = canUseWebGpuScatter({
    kind: activeChart?.kind,
    gpuReady,
    forceCanvasCapture,
    hasSmartOverlays: !!hasSmartOverlays,
    connectScatterTrail,
    showMarginals,
    customRefLineCount: activeChart ? (customRefLines[activeChart.id]?.length ?? 0) : 0,
    chart: activeChart,
    overrides: chartVisualOverrides,
  });
  const useWebGpuScene =
    !!activeChart &&
    isWebGpuDrawableScene(activeChart.kind) &&
    gpuReady &&
    !forceCanvasCapture &&
    !!sceneRendererRef.current;
  const useWebGpuGlobe =
    GPU_GLOBE_ENABLED &&
    !!activeChart &&
    isWebGpuGlobeKind(activeChart.kind) &&
    !activeChart.emojiField && !activeChart.shapeField &&
    chartVisualOverrides.markerMode !== "emoji" &&
    (!chartVisualOverrides.markShape || chartVisualOverrides.markShape === "circle") &&
    gpuReady &&
    !forceCanvasCapture &&
    !!sceneRendererRef.current;
  const useWebGpuCube =
    activeChart?.kind === "dataCube" &&
    gpuReady &&
    !forceCanvasCapture &&
    !!cubeRendererRef.current;
  const dataCube = useMemo(() => {
    if (activeChart?.kind !== "dataCube" || !chartSampleRows?.rows?.length) return null;
    return buildDataCube(chartSampleRows.rows, chartSampleRows.columns, {
      xField: activeChart.xField,
      yField: activeChart.yField,
      zField: activeChart.zField,
      valueField: activeChart.sizeField,
      aggregate: activeChart.yAggregate,
      invertSize: !!activeChart.channelInvert?.size,
    });
  }, [
    activeChart?.kind,
    activeChart?.xField,
    activeChart?.yField,
    activeChart?.zField,
    activeChart?.sizeField,
    activeChart?.yAggregate,
    activeChart?.channelInvert?.size,
    chartSampleRows,
  ]);
  const pivotTable = useMemo(() => {
    if (!cubeTableOpen || activeChart?.kind !== "dataCube" || !chartSampleRows?.rows?.length) return null;
    return buildPivotTable(
      chartSampleRows.rows,
      chartSampleRows.columns,
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
    chartSampleRows,
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
    if (reducedMotion) return;
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
  }, [dataCube, reducedMotion]);

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
      activeChart.kind === "globe" ||
      activeChart.kind === "globeTrail");
  const [canvasSized, setCanvasSized] = useState(false);
  const exportStateRef = useRef({
    activeChart,
    gpuReady,
    vegaSpec,
    sampleRows: chartSampleRows,
    chartVisualOverrides,
    chartFootnoteText,
    sceneOrbit,
    colors,
    opacity,
    pointSize,
  });
  exportStateRef.current = {
    activeChart,
    gpuReady,
    vegaSpec,
    sampleRows: chartSampleRows,
    chartVisualOverrides,
    chartFootnoteText,
    sceneOrbit,
    colors,
    opacity,
    pointSize,
  };
  const sampleRowsRef = useRef(chartSampleRows);
  sampleRowsRef.current = chartSampleRows;
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

  const hideSuggestionsRail = useCallback(() => {
    setSuggestionsExpanded(false);
    setSuggestionsRailOpen(false);
  }, [setSuggestionsRailOpen]);

  const showSuggestionsRail = useCallback(() => {
    setSuggestionsRailOpen(true);
  }, [setSuggestionsRailOpen]);

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
  const scatterTooltipRef = useRef(scatterTooltip);
  scatterTooltipRef.current = scatterTooltip;
  const chartTooltipRef = useRef(chartTooltip);
  chartTooltipRef.current = chartTooltip;
  const [scatterView, setScatterView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [brushRect, setBrushRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);
  const brushRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  brushRectRef.current = brushRect;
  const scatterDataRef = useRef<{
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
  } | null>(null);
  const canvas2DHitRef = useRef<Canvas2DHitContext | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleEditValue, setTitleEditValue] = useState("");
  const [whyReasonOpen, setWhyReasonOpen] = useState(false);
  const [chartDataTableOpen, setChartDataTableOpen] = useState(false);
  const [keyboardMarkIndex, setKeyboardMarkIndex] = useState(-1);
  // Mark focus (markFocus.ts): the hovered / keyboard-focused mark, drawn on its own
  // layer above the chart; pins are drawn there too so exports carry them.
  const focusLayerRef = useRef<HTMLCanvasElement>(null);
  const [hoverMark, setHoverMark] = useState<HitTarget | null>(null);
  const [hitsVersion, setHitsVersion] = useState(0);
  const pinnedBoxesRef = useRef<CalloutBox[]>([]);
  const [chartDrawError, setChartDrawError] = useState<string | null>(null);
  const [fontEpoch, setFontEpoch] = useState(0);
  const bestSuggestion = useMemo(() => getBestSuggestion(chartRecs), [chartRecs]);
  const topSuggestions = useMemo(() => getTopSuggestions(chartRecs, 10), [chartRecs]);
  const suggestCycleRef = useRef(0);
  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const displayTitle = activeChart
    ? (chartTitleOverrides[activeChart.id] ?? activeChart.title)
    : "Select a chart";

  const chartA11yLabel = useMemo(
    () =>
      buildChartA11ySummary({
        chart: activeChart,
        rowCount: sampleRows?.total_rows ?? sampleRows?.rows.length ?? 0,
      }),
    [activeChart, sampleRows?.total_rows, sampleRows?.rows.length],
  );

  const loadingSample =
    !!selectedFile && inspectingFilePath === selectedFile.path && !sampleRows;
  const stageStatus = useMemo(
    () =>
      chartStageStatus({
        loadingSample,
        hasChart: !!activeChart,
        hasRows: (chartSampleRows?.rows.length ?? sampleRows?.rows.length ?? 0) > 0,
        renderError: chartDrawError,
      }),
    [loadingSample, activeChart, chartSampleRows?.rows.length, sampleRows?.rows.length, chartDrawError],
  );
  const stageLiveMessage = chartStageLiveMessage(stageStatus);

  const dataTableRows = useMemo(
    () => dataTableRowsFromHits(canvas2DHitRef.current?.targets),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when chart paints
    [activeChart?.id, refreshKey, chartDataTableOpen],
  );
  useEffect(() => {
    setWhyReasonOpen(false);
    setKeyboardMarkIndex(-1);
    setChartDrawError(null);
  }, [activeChart?.id]);

  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts?.ready) return;
    let cancelled = false;
    const repaint = () => { if (!cancelled) setFontEpoch((n) => n + 1); };
    void document.fonts.ready.then(repaint);
    document.fonts.addEventListener("loadingdone", repaint);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", repaint);
    };
  }, []);

  useEffect(() => { ensureChartFontLoaded(chartFontFamily, appSettings.faces); }, [chartFontFamily, appSettings.faces]);

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
      const { suggestChartFromOllama } = await import("@/lib/ollama");
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
        [canvas, canvas2D, axesOverlay, focusLayerRef.current].forEach((c) => {
          if (!c) return;
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
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.getAttribute("role") === "listbox" ||
        el.isContentEditable
      ) {
        return;
      }

      // Tooltip link (L) — never steal browser location shortcuts
      if (e.key === "l" || e.key === "L") {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (tooltipLink) {
          e.preventDefault();
          setTooltipLink(null);
          return;
        }
        const chart = activeChart;
        const rows = chartSampleRows?.rows;
        const cols = chartSampleRows?.columns;
        if (!chart || !rows || !cols) return;
        const tt = scatterTooltipRef.current ?? chartTooltipRef.current;
        if (!tt) return;
        const keyField = chart.tooltipKeyField ?? chart.xField;
        const kidx = cols.indexOf(keyField);
        if (kidx < 0) return;
        const rawRow = tt.rowIndex >= 0 ? rows[tt.rowIndex] : null;
        if (!rawRow) return;
        e.preventDefault();
        setTooltipLink({ field: keyField, value: String(rawRow[kidx] ?? "") });
        return;
      }

      if (!activeChart || activeChart.kind !== "scatter") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const stageEl = stageHostRef.current;
      const focused = document.activeElement;
      if (stageEl && focused && focused !== document.body && !stageEl.contains(focused)) return;

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
        applyBrushSelection([]);
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
    chartSampleRows,
    getEffectiveScatterBounds,
    setChartInteractionMode,
    setToast,
    applyBrushSelection,
    setLassoPoints,
    setRulerPins,
    setCrosshairPos,
  ]);

  // Initialize WebGPU lazily and retain renderers until unmount so kind switches reuse one shared device.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const kind = activeChart?.kind ?? "";
    const wantScene = isWebGpuDrawableScene(kind);
    const wantCube = kind === "dataCube";
    const wantScatter = kind === "scatter";

    setGpuReady(false);
    if (!wantCube && !wantScene && !wantScatter) return;
    if ((wantCube && cubeRendererRef.current) || (wantScene && sceneRendererRef.current) || (wantScatter && rendererRef.current)) {
      setGpuReady(true);
      return;
    }

    void (async () => {
      const lease = await acquireSharedGpuDevice();
      if (!lease) return;
      if (wantCube) {
        const { LoomCubeRenderer } = await import("@/lib/webgpuCube");
        const cubeRenderer = new LoomCubeRenderer();
        cubeRendererRef.current = cubeRenderer;
        const ok = await cubeRenderer.init(canvas, lease);
        if (!cancelled && ok) setGpuReady(true);
        else if (cubeRendererRef.current === cubeRenderer) cubeRendererRef.current = null;
        if (!ok) lease.release();
      } else if (wantScene) {
        const { LoomSceneRenderer } = await import("@/lib/webgpuScenes");
        const scene = new LoomSceneRenderer();
        sceneRendererRef.current = scene;
        const ok = await scene.init(canvas, lease);
        if (!cancelled && ok) setGpuReady(true);
        else if (sceneRendererRef.current === scene) sceneRendererRef.current = null;
        if (!ok) lease.release();
      } else if (wantScatter) {
        const { LoomRenderer } = await import("@/lib/webgpu");
        const renderer = new LoomRenderer();
        rendererRef.current = renderer;
        const ok = await renderer.init(canvas, lease);
        if (!cancelled && ok && !renderer.deviceLost) setGpuReady(true);
        else if (rendererRef.current === renderer) rendererRef.current = null;
        if (!ok) lease.release();
      } else {
        lease.release();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChart?.kind]);

  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      sceneRendererRef.current?.destroy();
      cubeRendererRef.current?.destroy();
      rendererRef.current = null;
      sceneRendererRef.current = null;
      cubeRendererRef.current = null;
      setGpuReady(false);
    };
  }, []);

  useEffect(() => {
    const kind = activeChart?.kind ?? "";
    if (!isGeoFamilyKind(kind)) {
      setGeoAtlasBundle(null);
      return;
    }
    const override = chartVisualOverrides.geoAtlas;
    const regionField = activeChart?.xField ?? "";
    const samples = sampleRows?.rows.slice(0, 40).map((r) => {
      const xi = sampleRows.columns.indexOf(regionField);
      return xi >= 0 ? r[xi] : null;
    }) ?? [];
    // Lon/lat maps (globe, geoPoints, …) must use a world coastline — US FIPS
    // digits collide with longitude values and used to paint only the United States.
    const atlasKind: AtlasKind =
      override && override !== "auto"
        ? override
        : kind === "choropleth"
          ? pickAtlasKind(regionField, samples)
          : "world";
    let cancelled = false;
    void loadAtlas(atlasKind).then((bundle) => {
      if (!cancelled) setGeoAtlasBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeChart?.kind,
    activeChart?.xField,
    sampleRows,
    chartVisualOverrides.geoAtlas,
  ]);

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
        // Prefer device-pixel content box so buffer and CSS never drift (blurry
        // stretch). Skip it during social export — capture pins an explicit DPR.
        const exporting = !!useLoomStore.getState().socialExportTarget;
        const dpb = entry.devicePixelContentBoxSize?.[0];
        const box = resolveStageBoxSize({
          cssW: width,
          cssH: height,
          dpr,
          devicePixelW: exporting ? null : dpb?.inlineSize,
          devicePixelH: exporting ? null : dpb?.blockSize,
        });
        const w = box.bufW;
        const h = box.bufH;
        // Assigning width/height clears a canvas even at the same value. The observer
        // re-fires on re-attach with an unchanged size, React skips the redraw (same
        // containerSize), and the chart would stay wiped — so only touch real changes.
        [canvas, canvas2D, axesOverlay, focusLayerRef.current].forEach((c) => {
          if (!c) return;
          if (c.width !== w) c.width = w;
          if (c.height !== h) c.height = h;
          c.style.width = `${box.cssW}px`;
          c.style.height = `${box.cssH}px`;
        });
        setCanvasSized(true);
        setContainerSize((prev) =>
          prev.w === box.cssW && prev.h === box.cssH ? prev : { w: box.cssW, h: box.cssH },
        );
      }
    });
    try {
      observer.observe(container, { box: "device-pixel-content-box" });
    } catch {
      observer.observe(container);
    }
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
      const smart = st.smartResults;
      const exportHasSmartOverlays = Boolean(
        smart &&
          ((smart.anomaly?.rowIndices?.length ?? 0) > 0 ||
            (smart.trend?.points?.length ?? 0) >= 2 ||
            (smart.forecast?.points?.length ?? 0) > 0 ||
            (smart.referenceLines?.lines?.length ?? 0) > 0 ||
            (smart.clusters && Object.keys(smart.clusters.rowToCluster).length > 0)),
      );
      const useWebGPU = canUseWebGpuScatter({
        kind: ac.kind,
        gpuReady: gpu,
        forceCanvasCapture: capturing,
        hasSmartOverlays: exportHasSmartOverlays,
        connectScatterTrail: st.connectScatterTrail,
        showMarginals: st.showMarginals,
        customRefLineCount: st.customRefLines[ac.id]?.length ?? 0,
        chart: ac,
        overrides,
      });
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
        const themeUi = getThemeUiColors(resolveRuntimeTheme(st.appSettings.theme));
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
            contentInsets: undefined,
            centerOf: undefined,
            showLegend: overrides.legendPosition !== "none",
            hovered: null,
          });
          ctx.restore();
        } else {
          const exp = exportStateRef.current;
          const cssW = canvas2D.width / stageDpr();
          const cssH = canvas2D.height / stageDpr();
          // Geo maps / globes already paint title, categorical legend, size key, and
          // footnote on canvas2D (and GPU globe sits on the WebGPU layer). Re-rendering
          // them here dropped the city color key from Share / Save PNGs — composite the
          // live stage instead so the export matches what you see.
          // Particle GPU scenes still re-draw on Canvas for a reliable readback.
          const needsSceneCanvas = isGpuSceneKind(ac.kind) && !isWebGpuGlobeKind(ac.kind) && !hasCanvasArrangement(overrides);
          if (needsSceneCanvas && exp.sampleRows?.rows.length) {
            ctx.save();
            ctx.scale(w / cssW, h / cssH);
            const pad = resolveChartPad({
              kind: ac.kind,
              width: cssW,
              height: cssH,
              basePad: overrides.chartPadding ?? DEFAULT_PAD,
              titleLayout: overrides.titleLayout,
              tickRotation: overrides.tickRotation ?? 0,
              chartFrame: overrides.chartFrame,
              isCompact: false,
              legendPosition: overrides.legendPosition,
              axisFontSize: overrides.axisFontSize,
              sourceFootnote: (overrides.sourceFootnote ?? "off") !== "off",
            });
            const ui = themeUi;
            const sceneOpts = {
              ...overrides,
              colors: exp.colors,
              lineCap: overrides.lineCap, lineJoin: overrides.lineJoin,
              opacity: exp.opacity,
              fontFamily: resolveChartFontFamily(overrides.fontFamily, st.appSettings.font, st.appSettings.faces),
              axisFontSize: resolveChartAxisFontSize(overrides.axisFontSize),
              themeText: ui.text,
              themeMuted: ui.label,
              themeBorder: ui.border,
              themeBg: ui.bg,
              pointSize: exp.pointSize,
              channelInvert: ac.channelInvert ?? undefined,
              yaw: exp.sceneOrbit.yaw,
              pitch: exp.sceneOrbit.pitch,
              zoom: exp.sceneOrbit.zoom,
            };
            const cols = exp.sampleRows.columns;
            const rows = exp.sampleRows.rows;
            const packed = extractGpuScenePoints(rows, cols, {
              xField: ac.xField,
              yField: ac.yField,
              zField: ac.zField,
              colorField: ac.colorField,
              sizeField: ac.sizeField,
              timeField: ac.timeField,
              trailId: ac.trailId,
              invertSize: !!ac.channelInvert?.size,
              invertZ: !!ac.channelInvert?.z,
            });
            if (packed) {
              renderGpuSceneCanvas(ac.kind as GpuSceneKind, ctx, packed, cssW, cssH, pad, sceneOpts);
            }
            ctx.restore();
          } else {
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
          }
          if (axesOverlay && axesOverlay.width > 0 && axesOverlay.height > 0) {
            try {
              ctx.drawImage(axesOverlay, 0, 0);
            } catch {
              /* ignore */
            }
          }
        }
        // Pinned readouts + focus rings: the highlighted story travels with the PNG.
        const focusLayer = focusLayerRef.current;
        if (focusLayer && focusLayer.width === w && focusLayer.height === h) {
          try {
            ctx.drawImage(focusLayer, 0, 0);
          } catch {
            /* ignore */
          }
        }
        drawCanvasAnnotations(ctx, w, h, st.chartAnnotations[ac.id] ?? [], themeUi, { width: canvas2D.width / stageDpr(), height: canvas2D.height / stageDpr() }, { fontFamily: resolveChartFontFamily(overrides.fontFamily, st.appSettings.font, st.appSettings.faces), axisFontSize: overrides.axisFontSize });
        // Attribution burn-in for platform / social PNG exports.
        // When the canvas already has a source/time footnote, skip the burn-in bar.
        if (st.socialExportTarget) {
          const footnoteOnChart = Boolean(exportStateRef.current.chartFootnoteText);
          if (!footnoteOnChart) {
            const { drawExportBurnIn } = await import("@/lib/socialExport");
            const { formatSourceFootnote, resolveDataProvenance } = await import("@/lib/dataProvenance");
            const prov = resolveDataProvenance(st.selectedFile, {
              loadedRows: st.sampleRows?.rows.length ?? null,
              totalRows: st.sampleRows?.total_rows ?? st.selectedFile?.row_count ?? null,
            });
            const sourceLabel = prov
              ? formatSourceFootnote(prov, "credit")
              : st.selectedFile?.name ?? null;
            drawExportBurnIn(ctx, w, h, {
              burnIn: st.exportBurnIn,
              sourceLabel,
              themeText: themeUi.text,
              themeMuted: themeUi.label,
              themeBg: themeUi.bg,
            });
          }
        }
        return new Promise<Blob | null>((resolve) => {
          off.toBlob((blob) => resolve(blob), "image/png");
        });
      } catch {
        return null;
      }
    });
    const svgMode = svgExportMode(vegaSpec);
    setSvgExportLabel(
      (svgMode === "approx" || ARRANGEMENT_KEYS.some((key) => savedChartVisualOverrides[key] != null))
        ? "Vega approximation — use PNG to preserve canvas arrangement"
        : null,
    );
    setSvgExportHandler(
      svgMode === "off"
        ? null
        : async (): Promise<string | null> => {
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
        const { vegaExportConfigForTheme } = await import("@/lib/vegaThemeConfig");
        const current = useLoomStore.getState();
        const visual = resolveThemeChartStyle(resolveRuntimeTheme(current.appSettings.theme), current.chartVisualOverrides);
        const exportConfig = vegaExportConfigForTheme(resolveRuntimeTheme(current.appSettings.theme), { ...visual, colorblindCharts: current.appSettings.colorblindCharts, fontFamily: resolveChartFontFamily(visual.fontFamily, current.appSettings.font, current.appSettings.faces) });
        const base = (spec as { config?: Record<string, unknown> }).config ?? {};
        const specWithData = {
          ...spec,
          data: { values },
          config: {
            ...base,
            ...exportConfig,
            axis: { ...(base.axis as object | undefined), ...(exportConfig.axis as object) },
            title: { ...(base.title as object | undefined), ...(exportConfig.title as object) },
            legend: { ...(base.legend as object | undefined), ...(exportConfig.legend as object) },
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
    },
    );
    return () => {
      setPngExportHandler(null);
      setSvgExportHandler(null);
      setSvgExportLabel(null);
    };
  }, [setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, savedChartVisualOverrides]);

  const tooltipPresentation = resolveTooltipPresentation(
    chartVisualOverrides.tooltipMode,
    isMobile,
  );
  /** Glass / dock stay put on touch — finger leave shouldn't wipe the readout. */
  const stickyTooltip = tooltipPresentation === "glass" || tooltipPresentation === "dock";

  // ---- Mark focus (markFocus.ts) ------------------------------------------
  // A mark's identity is its encoded values, so pins re-find their mark after
  // resizes, live refreshes and share-link round trips.
  const markIdentity = useMemo(
    () =>
      activeChart
        ? [activeChart.xField, activeChart.yField, activeChart.colorField, activeChart.sizeField, activeChart.tooltipKeyField]
        : [],
    [activeChart],
  );
  /** Scatter hovers come from scatterDataRef, not HitTargets — synthesize the circle. */
  const scatterHitForRow = useCallback(
    (rowIndex: number): HitTarget | null => {
      const data = scatterDataRef.current;
      if (!data) return null;
      const i = data.rowIndices.indexOf(rowIndex);
      if (i < 0) return null;
      const { xMin, xMax, yMin, yMax, pad, w, h, points, yScale: ySk, plot } = data;
      const yKind = (ySk ?? "linear") as YScaleKind;
      const yd = scatterYDomain(yMin, yMax, yKind);
      const chartW = plot ? plot.right - plot.left : w - 2 * pad;
      const chartH = plot ? plot.bottom - plot.top : h - 2 * pad;
      const p = points[i]!;
      return {
        shape: "circle",
        cx: (plot?.left ?? pad) + ((p.x - xMin) / (xMax - xMin || 1)) * chartW,
        cy: (plot?.top ?? pad) + (1 - scaleY(p.y, yd.min, yd.max, yKind)) * chartH,
        r: Math.max(4, pointSize / 2 + 1),
        match: [],
        rowIndex,
      };
    },
    [pointSize],
  );
  const resolveMarkHit = useCallback(
    (ref: MarkRef): HitTarget | null => {
      if (!activeChart) return null;
      if (activeChart.kind === "scatter") {
        const data = scatterDataRef.current;
        const st = useLoomStore.getState().sampleRows;
        if (!data || !st) return null;
        for (const ri of data.rowIndices) {
          if (sameMark(markRefForRow(ri, st.columns, st.rows, markIdentity), ref)) return scatterHitForRow(ri);
        }
        return null;
      }
      const sr = sampleRowsRef.current;
      const targets = canvas2DHitRef.current?.targets;
      return sr && targets?.length ? findHitForMark(targets, ref, sr.columns, sr.rows, markIdentity) : null;
    },
    [activeChart, markIdentity, scatterHitForRow],
  );
  /** Pin (or unpin) the mark under focus, snapshotting its readout. */
  const pinMark = useCallback(
    (hit: HitTarget | null, tip: { rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] } | null) => {
      if (!hit || !tip || !activeChart) return;
      let ref: MarkRef | null = null;
      if (activeChart.kind === "scatter") {
        const st = useLoomStore.getState().sampleRows;
        if (st) ref = markRefForRow(tip.rowIndex, st.columns, st.rows, markIdentity);
      } else {
        const sr = sampleRowsRef.current;
        if (sr) ref = markRefForHit(hit, sr.columns, sr.rows, markIdentity);
      }
      if (!ref) return;
      togglePinnedTooltip({ chartId: activeChart.id, ref, rowIndex: tip.rowIndex, row: tip.row, columns: tip.columns });
    },
    [activeChart, markIdentity, togglePinnedTooltip],
  );

  const handleScatterPointer = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeChart || activeChart.kind !== "scatter") return;
      if (tooltipPresentation === "off") {
        setScatterTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const data = scatterDataRef.current;
      const sample = sampleRowsRef.current;
      const allCols = sample?.columns;
      const fullRows = useLoomStore.getState().sampleRows?.rows;
      if (!data || !allCols || !fullRows) {
        setScatterTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const link = useLoomStore.getState().tooltipLink;
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { xMin, xMax, yMin, yMax, pad, w, h, points, rowIndices, yScale: ySk, plot } = data;
      const yKind = (ySk ?? "linear") as YScaleKind;
      const yd = scatterYDomain(yMin, yMax, yKind);
      const chartW = plot ? plot.right - plot.left : w - 2 * pad;
      const chartH = plot ? plot.bottom - plot.top : h - 2 * pad;
      if (chartW <= 0 || chartH <= 0) return;
      const scaleX = w / rect.width;
      const scaleYPx = h / rect.height;
      const px = sx * scaleX;
      const py = sy * scaleYPx;
      let bestIdx = -1;
      let bestDist = 24;
      for (let i = 0; i < points.length; i++) {
        const rowIndex = rowIndices[i]!;
        if (link && !rowMatchesTooltipLink(allCols, fullRows[rowIndex]!, link)) continue;
        const p = points[i];
        const ppx = (plot?.left ?? pad) + ((p.x - xMin) / (xMax - xMin || 1)) * chartW;
        const ppy = (plot?.top ?? pad) + (1 - scaleY(p.y, yd.min, yd.max, yKind)) * chartH;
        const d = Math.hypot(px - ppx, py - ppy);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const rowIndex = rowIndices[bestIdx];
        const rawRow = fullRows[rowIndex];
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
          setHoverMark((prev) => (prev?.rowIndex === rowIndex ? prev : scatterHitForRow(rowIndex)));
          setHoveredRowIndex(rowIndex);
        } else if (!stickyTooltip) {
          setScatterTooltip(null);
          setHoveredRowIndex(null);
        }
      } else if (!stickyTooltip) {
        setScatterTooltip(null);
        setHoverMark(null);
        setHoveredRowIndex(null);
      }
    },
    [activeChart, setHoveredRowIndex, tooltipPresentation, stickyTooltip, scatterHitForRow],
  );

  const handleScatterPointerLeave = useCallback(() => {
    if (stickyTooltip) return;
    setScatterTooltip(null);
    setHoverMark(null);
    setHoveredRowIndex(null);
  }, [setHoveredRowIndex, stickyTooltip]);

  const handleCanvas2DPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, intent: "move" | "down" = "move") => {
      const hit = canvas2DHitRef.current;
      const ac = activeChart;
      const sr = sampleRowsRef.current;
      if (ac?.kind === "dataCube") {
        const frame = cubeFrameRef.current;
        const el = containerRef.current;
        if (!frame || !el || sceneOrbitDragRef.current) {
          setChartTooltip(null);
        setHoverMark(null);
          setCubeHover(null);
          return;
        }
        const rect = el.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * frame.w;
        const py = ((e.clientY - rect.top) / rect.height) * frame.h;
        const cell = pickDataCubeCell(frame.cube, dataCubeChartView(frame.cube, frame.w, frame.h, frame.opts), px, py, frame.opts);
        if (!cell) {
          setChartTooltip(null);
        setHoverMark(null);
          setCubeHover(null);
          setHoveredRowIndex(null);
          return;
        }
        const tip = cubeCellTooltip(frame.cube, cell);
        const srCube = sampleRowsRef.current;
        const rawCube = srCube?.rows[cell.rowIndex] ?? null;
        const fields = resolveTooltipFieldNames(ac, srCube?.columns ?? []);
        const merged = mergeChartTooltip(tip, srCube?.columns ?? [], rawCube, fields);
        setChartTooltip({
          clientX: e.clientX,
          clientY: e.clientY,
          rowIndex: cell.rowIndex,
          row: merged.row,
          columns: merged.columns,
        });
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
      const scaleY = (hit.frameH ?? hit.h) / rect.height;
      const chartX = relX * scaleX;
      const chartY = relY * scaleY;
      const { pad, w, h } = hit;

      if (tooltipPresentation === "off") {
        setChartTooltip(null);
        setHoverMark(null);
        setHoveredRowIndex(null);
        return;
      }

      if (chartX < 0 || chartX > w || chartY < 0 || chartY > h) {
        if (!stickyTooltip) {
          setChartTooltip(null);
        setHoverMark(null);
          setHoveredRowIndex(null);
        }
        return;
      }
      const link = useLoomStore.getState().tooltipLink;
      const allowed = allowedRowIndices(sr.rows, sr.columns, link);
      // Registered marks resolve against the full sample (density kinds paint a subsample)
      const target = hit.targets?.length ? pickHitTarget(hit.targets, chartX, chartY) : null;
      if (!target) {
        const chrome = pickChartChromeRegion(chartX, chartY, w, h, pad, hit.chromeLayout);
        if (chrome) {
          setChromeHover((prev) => (prev === chrome ? prev : chrome));
          // Hover only outlines the region. A click opens the panel and
          // rings the matching control when you actually choose it.
          if (intent === "down") {
            const section = chromeSectionFor(chrome);
            setChartChromeFocus({ section, target: chrome, source: "chart" });
            setPanelOpen(true);
            setPanelTab("chart");
            setChartPanelSection(section);
          }
          if (!stickyTooltip) {
            setChartTooltip(null);
        setHoverMark(null);
            setHoveredRowIndex(null);
          }
          return;
        }
      }
      if (chromeHover) setChromeHover(null);
      const rowIdx = hit.targets?.length
        ? (target ? rowForHitTarget(target, sr.rows, allowed) : null)
        : pickCanvasTooltipRowIndex(hit, chartX, chartY, allowed);
      if (rowIdx == null) {
        setChartTooltip(null);
        setHoverMark(null);
        setHoveredRowIndex(null);
        return;
      }
      if (rowIdx === -1 && target?.summary) {
        setChartTooltip({
          clientX: e.clientX,
          clientY: e.clientY,
          rowIndex: -1,
          row: target.summary.row,
          columns: target.summary.columns,
        });
        setHoverMark((prev) => (prev === target ? prev : target));
        setHoveredRowIndex(null);
        return;
      }
      const rawRow = sr.rows[rowIdx]!;
      // Aggregated marks keep structural summary (bar value, bin…); Encoding Tooltip fields append.
      const fields = resolveTooltipFieldNames(ac, sr.columns);
      const proj = mergeChartTooltip(target?.summary ?? null, sr.columns, rawRow, fields);
      setChartTooltip({
        clientX: e.clientX,
        clientY: e.clientY,
        rowIndex: rowIdx,
        row: proj.row,
        columns: proj.columns,
      });
      setHoverMark((prev) => (prev === target ? prev : target));
      setHoveredRowIndex(rowIdx);
    },
    [
      activeChart,
      setHoveredRowIndex,
      setChartChromeFocus,
      setPanelOpen,
      setPanelTab,
      setChartPanelSection,
      stickyTooltip,
      tooltipPresentation,
      chromeHover,
    ],
  );
  // A new chart starts with no focus (pins stay per chart id).
  useEffect(() => {
    setHoverMark(null);
    setKeyboardMarkIndex(-1);
  }, [activeChart?.id]);

  // Focus layer: pinned marks (solid) + hover / keyboard focus (lighter), then
  // pinned callouts on top. Redraws whenever marks are repainted (hitsVersion).
  useEffect(() => {
    const layer = focusLayerRef.current;
    if (!layer) return;
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    if (!activeChart || !canvasSized || !layer.width) return;
    const dpr = stageDpr();
    const frame = { w: layer.width / dpr, h: layer.height / dpr };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = { accent: themeUi.accent, bg: themeUi.bg, text: themeUi.text, muted: themeUi.label, border: themeUi.border };
    const pins = pinnedTooltips.filter((t) => t.chartId === activeChart.id);
    const resolved = pins.map((p) => ({ p, hit: resolveMarkHit(p.ref) }));
    for (const { hit } of resolved) if (hit) drawMarkFocus(ctx, hit, markFocusStyle(activeChart.kind, hit), ink, 1);
    if (hoverMark && !resolved.some((r) => r.hit === hoverMark || (r.hit && r.hit.rowIndex != null && r.hit.rowIndex === hoverMark.rowIndex && r.hit.shape === hoverMark.shape))) {
      drawMarkFocus(ctx, hoverMark, markFocusStyle(activeChart.kind, hoverMark), ink, keyboardMarkIndex >= 0 ? 1 : 0.7);
    }
    const taken: CalloutBox[] = [];
    resolved.forEach(({ p, hit }, i) => {
      if (!hit) return;
      const box = drawPinnedCallout(ctx, hit, calloutLines(p.columns, p.row), frame, ink, {
        fontFamily: chartFontStack(chartFontFamily),
        fontSize: chartRenderOpts.axisFontSize ?? 12,
        badge: resolved.length > 1 ? String(i + 1) : undefined,
        taken,
      });
      if (box) taken.push(box);
    });
    pinnedBoxesRef.current = taken;
  }, [activeChart, canvasSized, pinnedTooltips, hoverMark, keyboardMarkIndex, hitsVersion, refreshKey, containerSize.w, containerSize.h, themeUi, chartFontFamily, chartRenderOpts.axisFontSize, resolveMarkHit]);

  /** Arrow keys walk the marks (focus ring + readout); Enter / Space pins; Escape clears. */
  const handleMarkKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const hits = keyboardNavigableHits(canvas2DHitRef.current?.targets);
    const el = containerRef.current;
    const frame = canvas2DHitRef.current;
    if (!hits.length || !el || !frame) return;
    const focusAt = (i: number) => {
      setKeyboardMarkIndex(i);
      const t = hits[i]!;
      // Reuse the pointer path at the mark's anchor so keyboard and mouse show the same readout.
      const rect = el.getBoundingClientRect();
      const a = t.shape === "rect" ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : t.shape === "circle" ? { x: t.cx, y: t.cy } : { x: t.cx + Math.cos((t.a0 + t.a1) / 2) * ((t.r0 + t.r1) / 2), y: t.cy + Math.sin((t.a0 + t.a1) / 2) * ((t.r0 + t.r1) / 2) };
      handleCanvas2DPointerMove(
        { clientX: rect.left + (a.x / frame.w) * rect.width, clientY: rect.top + (a.y / (frame.frameH ?? frame.h)) * rect.height } as React.PointerEvent<HTMLDivElement>,
        "move",
      );
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(nextMarkIndex(keyboardMarkIndex, hits.length, 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(nextMarkIndex(keyboardMarkIndex, hits.length, -1));
    } else if ((e.key === "Enter" || e.key === " ") && keyboardMarkIndex >= 0 && chartTooltip) {
      e.preventDefault();
      pinMark(hoverMark, chartTooltip);
    } else if (e.key === "Escape") {
      setKeyboardMarkIndex(-1);
      setHoverMark(null);
      setChartTooltip(null);
      setHoveredRowIndex(null);
    }
  };

  const handleCanvas2DPointerLeave = useCallback(() => {
    if (!stickyTooltip) {
      setChartTooltip(null);
      setHoverMark(null);
      setCubeHover(null);
      setHoveredRowIndex(null);
    }
    setChromeHover(null);
  }, [setHoveredRowIndex, stickyTooltip]);

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
      const chartW = d.plot ? d.plot.right - d.plot.left : d.w - 2 * d.pad;
      const chartH = d.plot ? d.plot.bottom - d.plot.top : d.h - 2 * d.pad;
      if (chartW <= 0 || chartH <= 0) return;
      setScatterView((v) => {
        const bounds = getEffectiveScatterBounds(d, { ...v, scale: baseScale });
        const yKind = (d.yScale ?? "linear") as YScaleKind;
        const yd = scatterYDomain(bounds.yMin, bounds.yMax, yKind);
        const t = (px - (d.plot?.left ?? d.pad)) / chartW;
        const u = (py - (d.plot?.top ?? d.pad)) / chartH;
        const dataX = bounds.xMin + t * (bounds.xMax - bounds.xMin);
        const dataY = invScaleY(1 - u, yd.min, yd.max, yKind);
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
      const chartW = d.plot ? d.plot.right - d.plot.left : d.w - 2 * d.pad;
      const chartH = d.plot ? d.plot.bottom - d.plot.top : d.h - 2 * d.pad;
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
          const yKind = (d.yScale ?? "linear") as YScaleKind;
          const yd = scatterYDomain(bounds.yMin, bounds.yMax, yKind);
          const t = (px - (d.plot?.left ?? d.pad)) / chartW;
          const u = (py - (d.plot?.top ?? d.pad)) / chartH;
          const dataX = bounds.xMin + t * (bounds.xMax - bounds.xMin);
          const dataY = invScaleY(1 - u, yd.min, yd.max, yKind);
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
      if (chartInteractionMode === "lasso" || chartInteractionMode === "select" || e.shiftKey) {
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
    [activeChart, chartInteractionMode, crosshairPos, rulerPins, setRulerPins, setLassoPoints]
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
          const { xMin, xMax, yMin, yMax, pad, w, h, yScale: ySk, plot } = data;
          const yKind = (ySk ?? "linear") as YScaleKind;
          const yd = scatterYDomain(yMin, yMax, yKind);
          const chartW = plot ? plot.right - plot.left : w - 2 * pad;
          const chartH = plot ? plot.bottom - plot.top : h - 2 * pad;
          const scaleX = w / rect.width;
          const scaleYPx = h / rect.height;
          const px = sx * scaleX;
          const py = sy * scaleYPx;
          if (chartW > 0 && chartH > 0 && px >= (plot?.left ?? pad) && px <= (plot?.right ?? w - pad) && py >= (plot?.top ?? pad) && py <= (plot?.bottom ?? h - pad)) {
            const dataX = xMin + ((px - (plot?.left ?? pad)) / chartW) * (xMax - xMin);
            const dataY = invScaleY(1 - (py - (plot?.top ?? pad)) / chartH, yd.min, yd.max, yKind);
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
          const cw = d.plot ? d.plot.right - d.plot.left : d.w - 2 * d.pad;
          const ch = d.plot ? d.plot.bottom - d.plot.top : d.h - 2 * d.pad;
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
        const { points, rowIndices, xMin, xMax, yMin, yMax, pad, w, h, yScale: ySk, plot } = data;
        const yKind = (ySk ?? "linear") as YScaleKind;
        const yd = scatterYDomain(yMin, yMax, yKind);
        const chartW = plot ? plot.right - plot.left : w - 2 * pad;
        const chartH = plot ? plot.bottom - plot.top : h - 2 * pad;
        const scaleX = w / rect.width;
        const scaleYPx = h / rect.height;
        const polyPx = lassoPoints.map((p) => ({
          x: (p.x - rect.left) * scaleX,
          y: (p.y - rect.top) * scaleYPx,
        }));
        const sel: number[] = [];
        points.forEach((p, i) => {
          const px = (plot?.left ?? pad) + ((p.x - xMin) / (xMax - xMin || 1)) * chartW;
          const py = (plot?.top ?? pad) + (1 - scaleY(p.y, yd.min, yd.max, yKind)) * chartH;
          if (pointInPolygon(px, py, polyPx)) sel.push(rowIndices[i]);
        });
        applyBrushSelection(sel);
        setToast(
          sel.length > 0
            ? `${sel.length} point(s) lassoed`
            : "No points in lasso",
        );
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
        const { points, rowIndices, xMin, xMax, yMin, yMax, pad, w, h, yScale: ySk, plot } = data;
        const yKind = (ySk ?? "linear") as YScaleKind;
        const yd = scatterYDomain(yMin, yMax, yKind);
        const chartW = plot ? plot.right - plot.left : w - 2 * pad;
        const chartH = plot ? plot.bottom - plot.top : h - 2 * pad;
        const scaleX = w / rect.width;
        const scaleYPx = h / rect.height;
        const px1 = (Math.min(br.x1, br.x2) - rect.left) * scaleX;
        const px2 = (Math.max(br.x1, br.x2) - rect.left) * scaleX;
        const py1 = (Math.min(br.y1, br.y2) - rect.top) * scaleYPx;
        const py2 = (Math.max(br.y1, br.y2) - rect.top) * scaleYPx;
        const dataX1 = xMin + ((px1 - (plot?.left ?? pad)) / chartW) * (xMax - xMin);
        const dataX2 = xMin + ((px2 - (plot?.left ?? pad)) / chartW) * (xMax - xMin);
        const dataY2 = invScaleY(1 - (py1 - (plot?.top ?? pad)) / chartH, yd.min, yd.max, yKind);
        const dataY1 = invScaleY(1 - (py2 - (plot?.top ?? pad)) / chartH, yd.min, yd.max, yKind);
        const sel: number[] = [];
        points.forEach((p, i) => {
          if (p.x >= Math.min(dataX1, dataX2) && p.x <= Math.max(dataX1, dataX2) && p.y >= Math.min(dataY1, dataY2) && p.y <= Math.max(dataY1, dataY2)) {
            sel.push(rowIndices[i]);
          }
        });
        applyBrushSelection(sel);
        setToast(
          sel.length > 0
            ? `${sel.length} point(s) selected`
            : "No points in brush",
        );
      }
      brushStartRef.current = null;
      setBrushRect(null);
    }
    panStartRef.current = null;
  }, [applyBrushSelection, setToast, chartInteractionMode, lassoPoints, setLassoPoints]);

  const extractScatterData = useCallback((): { points: GPUScatterPoint[]; rowIndices: number[]; xMin: number; xMax: number; yMin: number; yMax: number } | null => {
    if (!chartSampleRows || !activeChart) return null;
    const spec = activeChart.spec as Record<string, unknown>;
    const encoding = spec.encoding as Record<string, { field: string }> | undefined;
    const xFieldName = encoding?.x?.field ?? activeChart.xField;
    const yFieldName = encoding?.y?.field ?? activeChart.yField;
    if (!xFieldName || !yFieldName) return null;

    const xIdx = chartSampleRows.columns.indexOf(xFieldName);
    const yIdx = chartSampleRows.columns.indexOf(yFieldName);
    const colorField =
      (encoding?.color as { field?: string } | undefined)?.field ?? activeChart.colorField ?? undefined;
    const sizeField = (encoding?.size as { field?: string } | undefined)?.field ?? activeChart.sizeField;
    const cIdx = colorField ? chartSampleRows.columns.indexOf(colorField) : -1;
    const sizeIdx = sizeField ? chartSampleRows.columns.indexOf(sizeField) : -1;
    if (xIdx === -1 || yIdx === -1) return null;

    let sizeMin = Infinity, sizeMax = -Infinity;
    if (sizeIdx >= 0) {
      for (const row of chartSampleRows.rows) {
        const v = chartNumber(row[sizeIdx]);
        if (!isNaN(v)) { sizeMin = Math.min(sizeMin, v); sizeMax = Math.max(sizeMax, v); }
      }
      if (sizeMin === sizeMax) { sizeMin = sizeMin - 1; sizeMax = sizeMax + 1; }
    }
    const sizeRange = sizeMax - sizeMin || 1;

    const catMap = new Map<string, number>();
    let nextCat = 0;
    const catKeys: string[] = [];
    const points: GPUScatterPoint[] = [];
    const rowIndices: number[] = [];
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

    const rowSource = chartSampleRows.rowSourceIndices;
    chartSampleRows.rows.forEach((row, rowIndex) => {
      const x = chartNumber(row[xIdx]), y = chartNumber(row[yIdx]);
      if (isNaN(x) || isNaN(y) || (activeChart.yScale === "log" && y <= 0)) return;
      let cat = 0;
      if (cIdx >= 0) {
        const k = String(row[cIdx]);
        if (!catMap.has(k)) {
          catMap.set(k, nextCat++);
          catKeys.push(k);
        }
        cat = catMap.get(k)!;
      }
      let size: number | undefined;
      if (sizeIdx >= 0) {
        const s = chartNumber(row[sizeIdx]);
        size = isNaN(s) ? undefined : (activeChart.channelInvert?.size ? 1 - (s - sizeMin) / sizeRange : (s - sizeMin) / sizeRange);
      }
      points.push({ x, y, category: cat, size });
      rowIndices.push(rowSource?.[rowIndex] ?? rowIndex);
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    });
    if (points.length === 0) return null;
    const distinct = catMap.size;
    if (distinct > 0) {
      for (let i = 0; i < points.length; i++) {
        points[i]!.category = gpuCategoryIndex(points[i]!.category, distinct);
      }
    }
    const xPad = (xMax - xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || 1;
    return { points, rowIndices, xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
  }, [chartSampleRows, activeChart]);

  /** Packed GPU scatter — recomputed on data/encoding/zoom scale, not pan. */
  const gpuScatterPack = useMemo(() => {
    if (!useWebGPUScatter || !activeChart) return null;
    const sd = extractScatterData();
    if (!sd) return null;
    const gpuBudget = densityPointBudget(isMobile) + (isMobile ? 0 : 1000);
    const subPts = subsampleRowsForDensity(sd.points, gpuBudget, scatterView.scale, sd.rowIndices);
    const subIdx = subsampleRowsForDensity(sd.rowIndices, gpuBudget, scatterView.scale);
    const yScaleKind = (activeChart.yScale ?? "linear") as YScaleKind;
    let yMin = sd.yMin;
    let yMax = sd.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(yMin, yMax, yScaleKind);
      yMin = d.min;
      yMax = d.max;
    }
    const gpuPts =
      yScaleKind === "linear"
        ? subPts.rows
        : subPts.rows.map((p) => ({
            ...p,
            y: scaleY(p.y, yMin, yMax, yScaleKind),
          }));
    return { sd, subPts, subIdx, gpuPts, yMin, yMax, yScaleKind };
  }, [
    useWebGPUScatter,
    activeChart,
    extractScatterData,
    scatterView.scale,
    isMobile,
  ]);

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
        ctx.font = chartFont(chartRenderOpts.axisFontSize ?? 12, chartFontFamily);
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
      // Title + credit live on the axes overlay (raised above the GPU canvas) and are
      // painted by the overlay effect — don't clear it here, or orbiting the scene
      // (which re-runs this effect, not that one) would wipe the title.
      const packed = extractGpuScenePoints(
        chartSampleRows?.rows ?? sampleRows.rows,
        sampleRows.columns,
        {
          xField: activeChart.xField,
          yField: activeChart.yField,
          zField: activeChart.zField,
          colorField: activeChart.colorField,
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
      notifyChartPainted();
      return;
    }

    if (useWebGPUScatter) return;

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
    const hFull = ch / dpr;
    // Footer info owns a carved bottom band; header info grows top pad via margins instead.
    const infoBandOn =
      !!chartFootnoteText || !!chartColorInfo?.stops?.length;
    const chromeBand = chartVisualOverrides.chromeInfoBand ?? "footer";
    const footBand = infoBandOn && chromeBand === "footer" ? FOOTNOTE_BAND_PX : 0;
    const h = hFull - footBand;

    const rowsAll = chartSampleRows?.rows;
    const cols = chartSampleRows?.columns;
    if (!Array.isArray(rowsAll) || !Array.isArray(cols)) return;

    const zoomScale = activeChart.kind === "scatter" ? scatterView.scale : 1;
    const densityKinds =
      activeChart.kind === "scatter" || activeChart.kind === "bubble" || activeChart.kind === "parallel";
    const sourceIndices = chartSampleRows?.rowSourceIndices;
    const sub = densityKinds
      ? subsampleRowsForDensity(rowsAll, densityPointBudget(isMobile), zoomScale, sourceIndices)
      : {
          rows: rowsAll,
          sourceIndices,
          sampled: false,
          shown: rowsAll.length,
          total: rowsAll.length,
        };
    const rows = sub.rows;

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
      ? (activeChart.emojiField ?? activeChart.shapeField)
      : null;
    const cIdx = activeChart.colorField
      ? cols.indexOf(activeChart.colorField)
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
          ctx.beginPath();
          ctx.rect(0, 0, w * clipProgress, hFull);
          ctx.clip();
        }
        ctx.globalCompositeOperation = "source-over";

        // Per-paint scratch: renderers register hover targets + the series they colored
        const hits: HitTarget[] = [];
        const ropts: ChartRenderOpts = {
          ...opts,
          hits,
          analysis: !analysisUnavailable(activeChart) && smartResults?.analysis?.scope === analysisScope(activeChart) ? smartResults.analysis : undefined,
          fieldNames: cols,
          colorField: activeChart.colorField,
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
                colorField: activeChart.colorField,
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
                shapeField: activeChart.shapeField,
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
                  colorField: activeChart.colorField,
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
                  shapeField: activeChart.shapeField,
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
                  colorField: activeChart.colorField,
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
                  axisLabelColor: opts.axisLabelColor,
                  themeText: opts.themeText,
                  themeMuted: opts.themeMuted,
                  themeBorder: opts.themeBorder,
                  showDataLabels: opts.showDataLabels,
                  pointSize: opts.pointSize,
                  markShape: opts.markShape,
                  markerMode: opts.markerMode,
                  markEmoji: opts.markEmoji,
                  shapeField: activeChart.shapeField,
                  emojiField: activeChart.emojiField,
                  emojiMap: activeChart.emojiMap,
                  continuousStops: opts.continuousStops,
                  channelInvert: opts.channelInvert,
                  yAggregate: opts.yAggregate,
                  themeBg: opts.themeBg,
                  legendPosition: opts.legendPosition,
                  topN: opts.topN,
                  bumpMode: opts.bumpMode ?? activeChart.bumpMode ?? undefined,
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
            { ...opts, shapeField: activeChart.shapeField, emojiField: activeChart.emojiField, emojiMap: activeChart.emojiMap },
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
          const seen = new Map<string, number>();
          for (const r of rows) {
            const k = String(r[cIdx]);
            if (!seen.has(k)) seen.set(k, seen.size);
          }
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
        setHitsVersion((v) => v + 1);
        reportArrangementLayout(chromeLayout);
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
        const eased = 1 - Math.pow(1 - t, 3);
        drawOneFrame(eased);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LOOM-617: omit hover/export-only fields so crosshair moves do not rerun the full draw/GPU path.
  }, [canvasSized, activeChart, chartSampleRows, chartFootnoteText, chartColorInfo, footnoteOpts, gpuReady, useWebGPUScatter, useWebGpuScene, useWebGpuGlobe, extractScatterData, getEffectiveScatterBounds, scatterView, chartRenderOpts, chartVisualOverrides.animateEntrance, chartVisualOverrides.sizeScale, chartVisualOverrides.sourceFootnoteAlign, refreshKey, chartTitleOverrides, smartResults, themeUi, colors, opacity, pointSize, isCompact, isMobile, containerSize.w, containerSize.h, sceneOrbit, dataCube, useWebGpuCube, cubeHover, continuousStops, cubeSlice, cubeTableOpen, cubeAnim, connectScatterTrail, showMarginals, customRefLines, monitorLines, geoAtlasBundle, reducedMotion, fontEpoch]);

  // WebGPU scatter: upload packed points when data/zoom scale changes (not pan).
  useEffect(() => {
    if (!canvasSized || !useWebGPUScatter || !gpuScatterPack || !rendererRef.current || !activeChart) return;
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
    canvas2DHitRef.current = null;
    const canvas = canvasRef.current;
    const dpr = stageDpr();
    const w = canvas ? canvas.width / dpr : 800;
    const h = canvas ? canvas.height / dpr : 600;
    const plotInsets = resolveGpuScatterPads({
      kind: "scatter",
      cssWidth: w,
      cssHeight: h,
      basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
      dpr,
      titleLayout: chartRenderOpts.titleLayout,
      tickRotation: chartRenderOpts.tickRotation,
      chartFrame: chartRenderOpts.chartFrame,
      isCompact,
      legendPosition: chartRenderOpts.legendPosition,
      axisFontSize: chartRenderOpts.axisFontSize,
      sourceFootnote: chartRenderOpts.sourceFootnote,
    });
    const pad = plotInsets.padCss;
    const marks = densityAwarePointMarks({
      n: gpuScatterPack.subPts.rows.length,
      plotW: Math.max(1, w - 2 * pad),
      plotH: Math.max(1, h - 2 * pad),
      hasSizeEncoding: !!activeChart.sizeField,
      sizeScale: chartVisualOverrides.sizeScale ?? 1,
      pointSize,
      opacity,
      opacityUserSet: typeof chartVisualOverrides.opacity === "number",
    });
    rendererRef.current.uploadData(gpuScatterPack.gpuPts, {
      pointSize: marks.maxR * 2,
      opacity: marks.opacity,
      sizeScale: 1,
      palette: colors,
      clearColor: hexToRgb01(themeUi.bg),
    });
  }, [
    canvasSized,
    useWebGPUScatter,
    gpuScatterPack,
    activeChart,
    chartRenderOpts,
    chartVisualOverrides.sizeScale,
    chartVisualOverrides.opacity,
    colors,
    themeUi.bg,
    opacity,
    pointSize,
    isCompact,
  ]);

  // WebGPU scatter: pan/zoom via uniforms only.
  useEffect(() => {
    if (!canvasSized || !useWebGPUScatter || !gpuScatterPack || !rendererRef.current || !activeChart) return;
    const canvas = canvasRef.current;
    const dpr = stageDpr();
    const w = canvas ? canvas.width / dpr : 800;
    const h = canvas ? canvas.height / dpr : 600;
    const plotInsets = resolveGpuScatterPads({
      kind: "scatter",
      cssWidth: w,
      cssHeight: h,
      basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
      dpr,
      titleLayout: chartRenderOpts.titleLayout,
      tickRotation: chartRenderOpts.tickRotation,
      chartFrame: chartRenderOpts.chartFrame,
      isCompact,
      legendPosition: chartRenderOpts.legendPosition,
      axisFontSize: chartRenderOpts.axisFontSize,
      sourceFootnote: chartRenderOpts.sourceFootnote,
    });
    const pad = plotInsets.padCss;
    const eff = getEffectiveScatterBounds(gpuScatterPack.sd, scatterView);
    const { yScaleKind, yMin, yMax } = gpuScatterPack;
    let renderYMin = eff.yMin;
    let renderYMax = eff.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(renderYMin, renderYMax, yScaleKind);
      renderYMin = d.min;
      renderYMax = d.max;
    }
    void rendererRef.current
      .render(
        eff.xMin,
        eff.xMax,
        yScaleKind === "linear" ? renderYMin : 0,
        yScaleKind === "linear" ? renderYMax : 1,
        plotInsets.padXDevice,
        plotInsets.padYDevice,
      )
      .then(() => notifyChartPainted());
    if (canvas) {
      scatterDataRef.current = {
        points: gpuScatterPack.subPts.rows,
        rowIndices: gpuScatterPack.subIdx.rows,
        ...eff,
        pad,
        w,
        h,
        columns: sampleRows?.columns ?? [],
        yScale: yScaleKind,
      };
      setHitsVersion((v) => v + 1);
    }
  }, [
    canvasSized,
    useWebGPUScatter,
    gpuScatterPack,
    scatterView,
    activeChart,
    chartRenderOpts,
    getEffectiveScatterBounds,
    sampleRows?.columns,
    isCompact,
  ]);

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

    const paintFootnote = () => {
      if (!chartFootnoteText && !chartColorInfo?.stops?.length) return;
      const ui = getThemeUiColors(effectiveTheme);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawChartSourceFootnote(ctx, w, h, 24, chartFootnoteText ?? "", {
        ...footnoteOpts(ui.label, ui.border),
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    // GPU scenes / globes: title + caption on the overlay above the WebGPU canvas.
    if (
      canvasSized &&
      activeChart &&
      ((useWebGpuScene && isWebGpuDrawableScene(activeChart.kind)) ||
        (useWebGpuGlobe && isWebGpuGlobeKind(activeChart.kind)))
    ) {
      const scenePad = resolveChartPad({
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
      const ui = getThemeUiColors(effectiveTheme);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (activeChart.kind === "firefly" && sampleRows) {
        const packed = extractGpuScenePoints(chartSampleRows?.rows ?? sampleRows.rows, sampleRows.columns, {
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: activeChart.colorField,
          sizeField: activeChart.sizeField,
          timeField: activeChart.timeField,
        });
        if (packed) {
          drawFireflyChrome(ctx, packed, w, h - ((chartFootnoteText || chartColorInfo?.stops?.length) && (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer" ? FOOTNOTE_BAND_PX : 0), scenePad, {
            ...chartRenderOpts,
            fontFamily: chartRenderOpts.fontFamily,
            axisFontSize: chartRenderOpts.axisFontSize,
            themeText: ui.text,
            themeMuted: ui.label,
            themeBorder: ui.border,
            themeBg: ui.bg,
          });
        }
      }
      const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
      drawChartTitleBlock(ctx, w, h, scenePad, titleText, activeChart.subtitle, {
        titleX: chartRenderOpts.titleX, titleY: chartRenderOpts.titleY, titleWidth: chartRenderOpts.titleWidth, titleScale: chartRenderOpts.titleScale,
        titleLayout: chartRenderOpts.titleLayout,
        fontFamily: chartRenderOpts.fontFamily,
        titleFontWeight: chartRenderOpts.titleFontWeight,
        titleItalic: chartRenderOpts.titleItalic,
        themeText: ui.text,
        themeMuted: ui.label,
        themeBorder: ui.border,
        axisLabelColor: chartRenderOpts.axisLabelColor,
        axisFontSize: chartRenderOpts.axisFontSize,
      });
      paintFootnote();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    if (!canvasSized || !activeChart || activeChart.kind !== "scatter" || !gpuReady || !useWebGPUScatter) return;
    const sd = extractScatterData();
    if (!sd) return;
    // Same pad inputs as the GPU upload path so marks and axes share one plot rect.
    const overlayPad = resolveChartPad({
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
      sourceFootnote: chartRenderOpts.sourceFootnote,
      chromeInfoBand: chartRenderOpts.chromeInfoBand,
    });
    const eff = getEffectiveScatterBounds(sd, scatterView);
    const yScaleKind = (activeChart.yScale ?? "linear") as YScaleKind;
    let yMin = eff.yMin;
    let yMax = eff.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(yMin, yMax, yScaleKind);
      yMin = d.min;
      yMax = d.max;
    }
    const ui = getThemeUiColors(effectiveTheme);
    const overlayOpts: ChartRenderOpts = {
      ...chartRenderOpts,
      chartPadding: overlayPad,
      themeBg: ui.bg,
      themeText: ui.text,
      themeMuted: ui.label,
      themeBorder: ui.border,
      yScale: yScaleKind === "linear" ? undefined : yScaleKind,
    };
    const toSX = (v: number) =>
      overlayPad + ((v - eff.xMin) / (eff.xMax - eff.xMin || 1)) * (w - 2 * overlayPad);
    const toSY = (v: number) => {
      if (yScaleKind !== "linear") {
        return h - overlayPad - scaleY(v, yMin, yMax, yScaleKind) * (h - 2 * overlayPad);
      }
      return h - overlayPad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * overlayPad);
    };
    overlayOpts.scales = { x: toSX, y: toSY, valueAxis: "y", rect: plotOf(w, h, overlayPad) };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAxisFrame(ctx, w, h, overlayPad, overlayOpts);
    drawAxisFieldLabels(ctx, w, h, overlayPad, activeChart.xField, activeChart.yField, overlayOpts);
    const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
    drawChartTitleBlock(ctx, w, h, overlayPad, titleText, activeChart.subtitle, {
      titleX: overlayOpts.titleX, titleY: overlayOpts.titleY, titleWidth: overlayOpts.titleWidth, titleScale: overlayOpts.titleScale,
      titleLayout: overlayOpts.titleLayout,
      fontFamily: overlayOpts.fontFamily,
      titleFontWeight: overlayOpts.titleFontWeight,
      titleItalic: overlayOpts.titleItalic,
      themeText: ui.text,
      themeMuted: ui.label,
      themeBorder: ui.border,
      axisLabelColor: overlayOpts.axisLabelColor,
      axisFontSize: overlayOpts.axisFontSize,
    });
    if (chartFootnoteText || chartColorInfo?.stops?.length) {
      drawChartSourceFootnote(ctx, w, h, overlayPad, chartFootnoteText ?? "", {
        ...footnoteOpts(ui.label, ui.border),
        fontFamily: overlayOpts.fontFamily,
      });
    }
    if (overlayOpts.showGrid) {
      drawGridLines(ctx, eff.xMin, eff.xMax, yMin, yMax, w, h, overlayPad, overlayOpts);
    }
    drawAxisTicks(ctx, eff.xMin, eff.xMax, yMin, yMax, w, h, overlayPad, overlayOpts);
    const cIdx = sampleRows?.columns.findIndex((c) => c === activeChart.colorField) ?? -1;
    const legendEntries = buildCategoricalLegendEntries(sampleRows?.rows ?? [], cIdx, chartRenderOpts.colors);
    const legendPos = chartRenderOpts.legendPosition ?? "auto";
    if (legendPos !== "none" && legendEntries && legendEntries.length > 1) {
      drawLegend(
        ctx,
        legendEntries,
        legendPos,
        w,
        h,
        overlayPad,
        overlayOpts.fontFamily ?? "Inter",
        ui.bg,
        ui.border,
        ui.text,
        activeChart.colorField ?? undefined,
        [], { x: chartVisualOverrides.legendOffsetX, y: chartVisualOverrides.legendOffsetY, width: chartVisualOverrides.legendWidth, height: chartVisualOverrides.legendHeight },
        overlayOpts.axisFontSize,
      );
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [canvasSized, activeChart, gpuReady, useWebGPUScatter, useWebGpuScene, useWebGpuGlobe, extractScatterData, getEffectiveScatterBounds, scatterView, chartRenderOpts, refreshKey, effectiveTheme, isCompact, chartTitleOverrides, containerSize.w, containerSize.h, selectedFile, sampleRows, chartSampleRows, chartFootnoteText, chartColorInfo, footnoteOpts, fontEpoch]);

  useEffect(() => {
    if (activeChart?.kind === "scatter") setScatterView({ scale: 1, panX: 0, panY: 0 });
  }, [activeChart?.id, activeChart?.kind]);

  // Globes open facing their data (e.g. US flights), not a fixed meridian over Africa.
  useEffect(() => {
    if (activeChart?.kind !== "globe" && activeChart?.kind !== "globeTrail") return;
    const sr = useLoomStore.getState().sampleRows;
    if (!sr) return;
    const cam = globeCameraForData(sr.rows, sr.columns, activeChart.xField, activeChart.yField);
    if (cam) setSceneOrbit({ yaw: cam.yaw, pitch: cam.pitch, zoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LOOM-617: reset camera only when the chart identity or backing sample changes, not on kind-only toggles within the same id.
  }, [activeChart?.id, sampleRows]);

  // --- Empty states ---
  if (!selectedFile) {
    return (
      <StartHere />
    );
  }

  // Ideas sit left of the chart (“before”); hide frees canvas width.
  const ideasCountLabel =
    chartRecs.length === 1 ? "1 idea" : `${chartRecs.length} ideas`;

  const suggestionHeader = (
    <div className={`flex flex-col border-b border-loom-border flex-shrink-0 ${isMobile && !suggestionsExpanded ? "gap-0 px-3 py-2" : "gap-2 px-2.5 py-2"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-loom-text leading-tight">Ideas</p>
          <p className="text-2xs text-loom-muted/80 tabular-nums leading-snug mt-0.5">
            {ideasCountLabel}
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
            title={suggestionsExpanded ? "Back to chart" : "Browse all ideas"}
            aria-label={suggestionsExpanded ? "Back to chart" : "Browse all ideas"}
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
          <button
            type="button"
            onClick={hideSuggestionsRail}
            className="loom-btn-ghost p-1.5 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent hover:bg-loom-accent/10 transition-colors min-h-10 min-w-10 md:min-h-9 md:min-w-9 flex items-center justify-center"
            title="Hide ideas — more room for the chart"
            aria-label="Hide ideas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
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
            title="Deep scan · swipe Keep / Skip to train ideas"
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
              title="Local Ollama chart idea (requires ollama serve)"
            >
              {aiSuggesting ? "Asking…" : "Ask AI"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const suggestionsRestoreTab = !suggestionsRailOpen && !socialExportReady && !liveEdit && !arranging && (
    <div className={isMobile ? "order-2 flex w-full shrink-0 items-center border-t border-loom-border bg-loom-surface pr-20" : "contents"}>
    <button
      type="button"
      onClick={showSuggestionsRail}
      className={`
        shrink-0 flex items-center justify-center gap-1 border-loom-border bg-loom-surface
        text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors
        ${isMobile
          ? "flex-1 min-h-10 px-3 text-xs font-medium"
          : "w-9 border-r flex-col py-3 gap-2"}
      `}
      title="Show ideas"
      aria-label="Show ideas"
    >
      {isMobile ? (
        <>Ideas · {chartRecs.length}</>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M9 18l6-6-6-6" />
          </svg>
          <span
            className="text-2xs font-medium tracking-wide"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Ideas
          </span>
        </>
      )}
    </button>
    {isMobile && (
      <button type="button" onClick={openChartEditor} className="min-h-10 px-4 text-xs font-medium text-loom-accent border-l border-loom-border">
        Edit chart
      </button>
    )}
    </div>
  );

  if (chartRecs.length === 0) {
    return (
      <div className="flex h-full animate-fade-in flex-col md:flex-row">
        {suggestionsRailOpen ? (
          <div className="hidden md:flex w-[220px] flex-shrink-0 border-r border-loom-border bg-loom-surface flex-col overflow-hidden">
            {suggestionHeader}
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center">
                <p className="text-sm text-loom-muted">No ideas yet</p>
                <p className="text-xs text-loom-muted mt-1">Needs at least 1 numeric or temporal column</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden md:flex">{suggestionsRestoreTab}</div>
        )}
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
  const showSuggestionsPanel = suggestionsRailOpen && !socialExportReady && !liveEdit && !arranging;

  return (
    <div className={`flex h-full animate-fade-in ${suggestionsExpanded || isMobile ? "flex-col" : ""}`}>
      {/* Recommendation panel — desktop left rail, mobile bottom rail, or full browse grid */}
      {showSuggestionsPanel ? (
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
                ? "overflow-x-auto overflow-y-hidden overscroll-x-contain flex flex-row gap-3 px-3 pt-1.5 pb-2.5 scrollbar-none snap-x snap-mandatory touch-pan-x"
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
              micro={!mobileRail && !suggestionsExpanded}
              onClick={() => selectRecommendation(rec)}
            />
          ))}
        </div>
      </div>
      ) : (
        suggestionsRestoreTab
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
        {!socialExportReady && !liveEdit && <ViewCohortBar surface="chart" />}
        {!socialExportReady && titleEditing && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-loom-border bg-loom-surface/60">
            <input
              type="text"
              value={titleEditValue}
              onChange={(e) => setTitleEditValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              className="flex-1 min-w-0 text-xs font-medium text-loom-text bg-loom-elevated border border-loom-border rounded px-2 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-loom-accent focus:border-loom-accent"
              placeholder="Chart title"
              autoFocus
              aria-label="Chart title"
            />
          </div>
        )}
        {!socialExportReady && activeChart?.kind === "scatter" && (
          <div className="flex items-center gap-1 px-3 py-1 border-b border-loom-border/50 bg-transparent" role="group" aria-label="Chart interaction mode">
            {([
              { mode: "pan" as const, label: "Pan", tip: "Drag to pan · pinch to zoom · Shift+drag brush" },
              { mode: "crosshair" as const, label: "Cross", tip: "Read values · tap to pin ruler" },
              ...(isMobile
                ? [{ mode: "select" as const, label: "Select", tip: "Drag to brush-select points" }]
                : [{ mode: "lasso" as const, label: "Lasso", tip: "Draw to select points (G)" }]),
            ]).map(({ mode, label, tip }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChartInteractionMode(mode)}
                aria-pressed={chartInteractionMode === mode}
                title={tip}
                className={`px-2 py-1 text-2xs rounded min-h-8 sm:min-h-0 ${chartInteractionMode === mode ? "bg-loom-accent/25 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
              >
                {label}
              </button>
            ))}
            {densityHint && (
              <>
                <span
                  className="ml-auto loom-badge text-2xs text-loom-accent border-loom-accent/30 max-w-[140px] truncate"
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

        <div
          ref={stageHostRef}
          className={`flex-1 relative min-h-0 min-h-[200px] flex items-center justify-center ${socialExportReady ? "overflow-auto" : ""}`}
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
          {arranging && !socialExportReady && !socialExportTarget && activeChart && (
            <div
              className="absolute top-2 left-1/2 z-30 -translate-x-1/2 flex max-w-[min(36rem,calc(100%-1rem))] flex-wrap items-center justify-center gap-1.5 rounded-lg border border-loom-accent/40 bg-loom-surface/95 px-2 py-1 shadow-sm backdrop-blur-md"
              role="status"
              aria-live="polite"
            >
              <span className="text-2xs font-medium text-loom-text px-1">Arranging</span>
              <span className="hidden sm:inline text-2xs text-loom-muted">
                Drag · resize handles · Esc done · Alt skips snap
              </span>
              <button
                type="button"
                className="loom-btn-ghost min-h-8 px-2 text-2xs"
                title="Restore automatic frame, plot, title and legend placement"
                onClick={resetArrangement}
              >
                Auto layout
              </button>
              <button
                type="button"
                className="min-h-8 px-2.5 text-2xs rounded-md border border-loom-accent/50 bg-loom-accent/15 text-loom-text"
                onClick={finishArranging}
              >
                Done
              </button>
            </div>
          )}
          <div
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {stageLiveMessage}
          </div>
          {loadingSample && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-loom-bg/70" role="status">
              <p className="text-sm text-loom-text">Loading chart data…</p>
            </div>
          )}
          {chartDrawError && (
            <div className="absolute top-2 left-2 right-2 z-20 rounded border border-loom-warning/40 bg-loom-warning/10 px-3 py-2 text-2xs text-loom-text" role="alert">
              {chartDrawError}
            </div>
          )}
          {chartDataTableOpen && !socialExportReady && (
            <div
              className="absolute z-20 left-3 right-3 sm:right-16 bottom-3 max-h-[min(42%,18rem)] overflow-auto rounded-lg border border-loom-border bg-[color-mix(in_srgb,var(--loom-surface)_94%,transparent)] backdrop-blur-md shadow-lg"
              role="region"
              aria-label="Chart data table"
            >
              <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-loom-border/80 bg-loom-surface/90">
                <span className="text-2xs font-medium text-loom-text truncate">
                  Chart data{dataTableRows.length ? ` · ${dataTableRows.length}` : ""}
                </span>
                <button
                  type="button"
                  className="text-loom-muted hover:text-loom-text text-xs px-1.5 py-0.5 rounded"
                  onClick={() => setChartDataTableOpen(false)}
                  aria-label="Close data table"
                >
                  ×
                </button>
              </div>
              {dataTableRows.length === 0 ? (
                <p className="px-3 py-3 text-2xs text-loom-muted leading-relaxed">
                  No mark summaries yet — wait for the chart to finish painting, then try Refresh.
                </p>
              ) : (
                <table className="w-full text-2xs font-mono text-loom-text">
                  <caption className="sr-only">{displayTitle} data</caption>
                  <thead>
                    <tr className="border-b border-loom-border/60 text-loom-muted">
                      {dataTableRows[0]!.columns.map((c) => (
                        <th key={c} scope="col" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataTableRows.map((row) => (
                      <tr key={row.key} className="border-b border-loom-border/40 last:border-0">
                        {row.cells.map((cell, ci) => (
                          <td key={`${row.key}-${ci}`} className="px-2 py-1 whitespace-nowrap max-w-[10rem] truncate">
                            {cell == null ? "—" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          <div
            className={`relative flex max-w-full max-h-full ${
              isMobile ? "flex-col items-stretch gap-1.5" : "flex-row items-start gap-1.5"
            }`}
          >
          {!socialExportReady && activeChart && isMobile && !liveEdit && (
            <div className="flex flex-col items-stretch gap-1.5">
              {whyReasonOpen && (
                <div
                  className="rounded-lg border border-loom-border bg-loom-surface/95 p-2.5 shadow-sm"
                  role="note"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-2xs font-medium text-loom-text">Why this chart</span>
                    <button
                      type="button"
                      className="text-loom-muted hover:text-loom-text text-xs leading-none px-1"
                      onClick={() => setWhyReasonOpen(false)}
                      aria-label="Close why"
                    >
                      ×
                    </button>
                  </div>
                  <p className="text-2xs text-loom-muted leading-snug">
                    {aiSuggestionReason ?? getRecommendationReason(activeChart)}
                  </p>
                </div>
              )}
              <div className="flex justify-end">
              <ChartCellRail orientation="horizontal">
                <CellIconBtn label="Redraw chart" title="Redraw chart" onClick={handleRefresh}>
                  <IconRefresh />
                </CellIconBtn>
                {selectedFile && (
                  <CellIconBtn label="Save chart view" title="Save this chart for dashboards" onClick={saveActiveChartView}>
                    <IconSave />
                  </CellIconBtn>
                )}
                {selectedFile?.path.startsWith("stream://") && (
                  <CellIconBtn
                    label="Monitor this chart"
                    title={chartMonitorCount ? `Watching ${chartMonitorCount} monitor${chartMonitorCount === 1 ? "" : "s"} on this feed. Click to add another` : "Get alerted when this chart does something unusual"}
                    pressed={chartMonitorCount > 0}
                    onClick={() => createChartMonitorDraft()}
                  >
                    <IconBell />
                  </CellIconBtn>
                )}
                <CellIconBtn
                  label="Data table"
                  title="Show chart values as a table"
                  pressed={chartDataTableOpen}
                  onClick={() => setChartDataTableOpen((o) => !o)}
                >
                  <IconDataTable />
                </CellIconBtn>
                <CellIconBtn
                  label="Why this chart"
                  title="Why this chart?"
                  pressed={whyReasonOpen}
                  onClick={() => setWhyReasonOpen((o) => !o)}
                >
                  <IconWhy />
                </CellIconBtn>
                {!socialExportTarget && (
                  <CellIconBtn
                    label={arranging ? "Done arranging" : "Arrange chart layout"}
                    title={arranging ? "Finish arranging" : "Move title, legend, and plot on the canvas"}
                    pressed={arranging}
                    onClick={toggleArranging}
                  >
                    <IconArrange />
                  </CellIconBtn>
                )}
                <CellIconBtn label="Edit chart title" title="Edit title" onClick={handleTitleStartEdit}>
                  <IconEditTitle />
                </CellIconBtn>
              </ChartCellRail>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            role={arranging ? "group" : "img"}
            aria-label={chartA11yLabel}
            tabIndex={activeChart && activeChart.kind !== "scatter" ? 0 : undefined}
            onKeyDown={(e) => {
              if (activeChart?.kind === "scatter") return;
              handleMarkKeyDown(e);
            }}
            className={`relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-loom-accent/60 ${
              !socialExportReady
                ? "rounded-lg border border-loom-border/90 shadow-[0_1px_0_color-mix(in_srgb,var(--loom-border)_40%,transparent),0_18px_40px_-28px_rgba(0,0,0,0.45)]"
                : ""
            } ${orbitEnabled ? "cursor-grab active:cursor-grabbing" : ""}`}
            onPointerDown={(e) => {
              if (!orbitEnabled || arranging) return;
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
              if (!orbitEnabled || arranging) return;
              e.preventDefault();
              e.stopPropagation();
              setSceneOrbit((o) => ({
                ...o,
                zoom: Math.max(0.4, Math.min(3, o.zoom * (e.deltaY > 0 ? 0.92 : 1.08))),
              }));
            }}
            onTouchStart={(e) => {
              if (!orbitEnabled || e.touches.length !== 2) return;
              sceneOrbitDragRef.current = null;
              const [a, b] = [e.touches[0]!, e.touches[1]!];
              scenePinchRef.current = {
                dist: touchDistance(a, b),
                zoom: sceneOrbit.zoom,
              };
            }}
            onTouchMove={(e) => {
              if (!orbitEnabled || e.touches.length !== 2 || !scenePinchRef.current) return;
              e.preventDefault();
              const [a, b] = [e.touches[0]!, e.touches[1]!];
              const dist = touchDistance(a, b);
              if (scenePinchRef.current.dist < 1) return;
              const factor = dist / scenePinchRef.current.dist;
              const base = scenePinchRef.current.zoom;
              setSceneOrbit((o) => ({
                ...o,
                zoom: Math.max(0.4, Math.min(3, base * factor)),
              }));
            }}
            onTouchEnd={() => {
              scenePinchRef.current = null;
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
            style={{ zIndex: useWebGPUScatter || useWebGpuCube || useWebGpuScene || useWebGpuGlobe ? 2 : 0 }}
          />
          {/* Mark focus + pinned readouts (markFocus.ts) — above every chart layer, in exports too. */}
          <canvas
            ref={focusLayerRef}
            data-loom-focus-layer
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 3 }}
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
              className="absolute inset-0 w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-loom-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-loom-bg"
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
                if (!brushStartRef.current) {
                  panStartRef.current = null;
                  setIsPanning(false);
                  setCrosshairPos(null);
                }
              }}
              onMouseDown={handleScatterMouseDown}
              onMouseUp={handleScatterMouseUp}
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
                    const cw = d.plot ? d.plot.right - d.plot.left : d.w - 2 * d.pad;
                    const ch = d.plot ? d.plot.bottom - d.plot.top : d.h - 2 * d.pad;
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
                  pinMark(hoverMark, scatterTooltip);
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
              onPointerMove={(e) => handleCanvas2DPointerMove(e, "move")}
              onPointerDown={(e) => {
                lastPointerTypeRef.current = e.pointerType;
                handleCanvas2DPointerMove(e, "down");
              }}
              onClick={() => {
                // Click pins the hovered mark (touch pins from the readout's Pin button).
                if (lastPointerTypeRef.current === "touch" || sceneOrbitDragRef.current) return;
                pinMark(hoverMark, chartTooltip);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch") handleCanvas2DPointerLeave();
              }}
              aria-hidden
            />
          )}
          {(() => {
            const hit = canvas2DHitRef.current;
            const outline = chromeHover ?? chartChromeFocus?.target ?? null;
            if (!outline || !hit || hit.w <= 0 || hit.h <= 0) return null;
            const r = chromeHighlightRect(outline, hit.w, hit.h, hit.pad);
            if (!r) return null;
            return (
              <div
                className="absolute pointer-events-none rounded-md border-2 border-loom-accent/70 bg-loom-accent/10 transition-[left,top,width,height,opacity] duration-150 z-[3]"
                style={{
                  left: `${(r.x / hit.w) * 100}%`,
                  top: `${(r.y / hit.h) * 100}%`,
                  width: `${(r.w / hit.w) * 100}%`,
                  height: `${(r.h / hit.h) * 100}%`,
                }}
                aria-hidden
              />
            );
          })()}
          {activeChart?.kind === "dataCube" && dataCube && !socialExportReady && !previewCaptureActive && (
            <>
              <DataCubePivotBar
                fontFamily={chartFontFamily}
                axisFontSize={chartRenderOpts.axisFontSize}
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
                  fillStage={isMobile && containerSize.h < 440}
                  fontFamily={chartFontFamily}
                  axisFontSize={chartRenderOpts.axisFontSize}
                  themeBg={themeUi.bg}
                  themeText={themeUi.text}
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
            const xType = activeChart?.xField ? (sampleRows?.types?.[sampleRows.columns.indexOf(activeChart.xField)] ?? "").toLowerCase() : "";
            const xValue = xType.includes("timestamp") || xType.includes("date") || crosshairPos.dataX > 1e11
              ? new Date(crosshairPos.dataX).toISOString().replace("T", " ").slice(0, 19)
              : formatAxisValue(crosshairPos.dataX);
            return (
              <>
                <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: sx, top: 0, width: 1, height: "100%" }} />
                <div className="absolute pointer-events-none bg-loom-accent/30 z-[5]" style={{ left: 0, top: sy, width: "100%", height: 1 }} />
                <ChartTooltipCard
                  tip={{ clientX: crosshairPos.screenX, clientY: crosshairPos.screenY, rowIndex: -1, columns: [activeChart?.xField ?? "x", activeChart?.yField ?? "y"], row: [xValue, formatAxisValue(crosshairPos.dataY)] }}
                  presentation="compact"
                  fontFamily={chartFontFamily}
                  axisFontSize={chartRenderOpts.axisFontSize}
                />
              </>
            );
          })()}
          {/* Ruler measurement */}
          {rulerPins.length === 2 && (
            <div className="absolute bottom-8 left-2 z-[6] max-w-[calc(100%-1rem)] tabular-nums text-loom-text bg-loom-surface/90 border border-loom-border rounded px-1.5 py-0.5" style={{ fontFamily: chartFontStack(chartFontFamily), fontSize: chartRenderOpts.axisFontSize, lineHeight: 1.5 }}>
              Δx={formatAxisValue(Math.abs(rulerPins[1].x - rulerPins[0].x))} Δy={formatAxisValue(Math.abs(rulerPins[1].y - rulerPins[0].y))}
              <button type="button" onClick={() => setRulerPins([])} aria-label="Clear ruler measurement" className="ml-1 text-loom-label hover:text-loom-text">×</button>
            </div>
          )}
          {/* Pinned readouts are drawn on the focus layer; this chip clears them. */}
          {activeChart && pinnedTooltips.some((t) => t.chartId === activeChart.id) && (
            <div className="absolute bottom-2 right-2 z-[6] flex items-center gap-1.5 text-2xs text-loom-text bg-loom-surface/90 border border-loom-border rounded-full pl-2.5 pr-1 py-0.5">
              <span>
                {pinnedTooltips.filter((t) => t.chartId === activeChart.id).length} pinned
                <span className="text-loom-muted"> · in exports &amp; links</span>
              </span>
              <button
                type="button"
                onClick={() => setPinnedTooltips(pinnedTooltips.filter((t) => t.chartId !== activeChart.id))}
                className="px-1.5 py-0.5 rounded-full text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
                aria-label="Clear pinned readouts"
              >
                Clear
              </button>
            </div>
          )}
          {/* Mini-map when zoomed */}
          {activeChart?.kind === "scatter" && scatterView.scale > 1.5 && scatterDataRef.current && (() => {
            const MH = 60, MW = 80;
            const sd = scatterDataRef.current;
            const xRange = sd.xMax - sd.xMin || 1, yRange = sd.yMax - sd.yMin || 1;
            const eff = getEffectiveScatterBounds(sd, scatterView);
            const vw = Math.max(2, ((eff.xMax - eff.xMin) / xRange) * MW);
            const vh = Math.max(2, ((eff.yMax - eff.yMin) / yRange) * MH);
            const vx0 = ((eff.xMin - sd.xMin) / xRange) * MW;
            const vy0 = MH - ((eff.yMax - sd.yMin) / yRange) * MH;
            return (
              <div className="absolute top-2 right-2 z-[6] border border-loom-border rounded bg-loom-surface/80 overflow-hidden" style={{ width: MW, height: MH }}>
                <svg width={MW} height={MH}>
                  {sd.points.slice(0, 500).map((p, i) => (
                    <circle key={i} cx={((p.x - sd.xMin) / xRange) * MW} cy={MH - ((p.y - sd.yMin) / yRange) * MH} r={1} fill="var(--loom-accent)" opacity={0.4} />
                  ))}
                  <rect x={vx0} y={vy0} width={vw} height={vh} fill="none" stroke="var(--loom-accent)" strokeWidth={1} />
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
          {activeChart && (chartAnnotations[activeChart.id] ?? []).map((saved) => {
            const a = arrangementPreview && "annotation" in arrangementPreview && arrangementPreview.annotation.id === saved.id ? { ...saved, ...arrangementPreview.annotation } : saved;
            return (
            <div
              key={a.id}
              className="absolute text-2xs font-mono px-1.5 py-0.5 rounded bg-loom-surface/95 border border-loom-border text-loom-text pointer-events-none z-[4]"
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${(a.width ?? .25) * 100}%`, fontFamily: chartFontStack(chartFontFamily), fontSize: a.fontSize ?? chartTypeRamp(chartRenderOpts.axisFontSize).mark, lineHeight: 1.4, padding: "4px 6px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", transform: "translate(-50%, -50%)" }}
            >
              {a.text}
            </div>
          ); })}
          {arranging && arrangeReady && arrangementLayout && activeChart && !socialExportReady && !socialExportTarget && (
            <CanvasArrangeOverlay
              key={activeChart.id}
              width={containerSize.w}
              height={containerSize.h}
              frameInset={2}
              contentHeight={
                containerSize.h -
                ((chartFootnoteText || chartColorInfo?.stops?.length) &&
                (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer"
                  ? FOOTNOTE_BAND_PX
                  : 0)
              }
              frameMax={chartFrameMax}
              layout={arrangementLayout}
              visual={chartVisualOverrides}
              annotations={chartAnnotations[activeChart.id] ?? []}
              allowPlot={ARRANGE_PLOT_KINDS.has(activeChart.kind) && !activeChart.rowField && !showMarginals}
              onPreview={setArrangementPreview}
              onCommit={commitArrangement}
              onDone={finishArranging}
            />
          )}
          </div>
          {!socialExportReady && activeChart && !isMobile && (
            <div className="flex flex-col gap-1.5 self-start items-start shrink-0">
              {whyReasonOpen && (
                <div
                  className="w-[11.5rem] rounded-lg border border-loom-border bg-[color-mix(in_srgb,var(--loom-surface)_95%,transparent)] backdrop-blur-md p-2.5 shadow-sm"
                  role="note"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-2xs font-medium text-loom-text">Why this chart</span>
                    <button
                      type="button"
                      className="text-loom-muted hover:text-loom-text text-xs leading-none px-1"
                      onClick={() => setWhyReasonOpen(false)}
                      aria-label="Close why"
                    >
                      ×
                    </button>
                  </div>
                  <p className="text-2xs text-loom-muted leading-snug">
                    {aiSuggestionReason ?? getRecommendationReason(activeChart)}
                  </p>
                </div>
              )}
              <ChartCellRail orientation="vertical">
                <CellIconBtn label="Redraw chart" title="Redraw chart" onClick={handleRefresh}>
                  <IconRefresh />
                </CellIconBtn>
                {selectedFile && (
                  <CellIconBtn label="Save chart view" title="Save this chart for dashboards" onClick={saveActiveChartView}>
                    <IconSave />
                  </CellIconBtn>
                )}
                {selectedFile?.path.startsWith("stream://") && (
                  <CellIconBtn
                    label="Monitor this chart"
                    title={chartMonitorCount ? `Watching ${chartMonitorCount} monitor${chartMonitorCount === 1 ? "" : "s"} on this feed. Click to add another` : "Get alerted when this chart does something unusual"}
                    pressed={chartMonitorCount > 0}
                    onClick={() => createChartMonitorDraft()}
                  >
                    <IconBell />
                  </CellIconBtn>
                )}
                <CellIconBtn
                  label="Data table"
                  title="Show chart values as a table"
                  pressed={chartDataTableOpen}
                  onClick={() => setChartDataTableOpen((o) => !o)}
                >
                  <IconDataTable />
                </CellIconBtn>
                <CellIconBtn
                  label="Why this chart"
                  title="Why this chart?"
                  pressed={whyReasonOpen}
                  onClick={() => setWhyReasonOpen((o) => !o)}
                >
                  <IconWhy />
                </CellIconBtn>
                {!socialExportTarget && (
                  <CellIconBtn
                    label={arranging ? "Done arranging" : "Arrange chart layout"}
                    title={arranging ? "Finish arranging" : "Move title, legend, and plot on the canvas"}
                    pressed={arranging}
                    onClick={toggleArranging}
                  >
                    <IconArrange />
                  </CellIconBtn>
                )}
                <CellIconBtn label="Edit chart title" title="Edit title" onClick={handleTitleStartEdit}>
                  <IconEditTitle />
                </CellIconBtn>
              </ChartCellRail>
            </div>
          )}
          </div>
        </div>
        {!readoutsObscured && tooltipPresentation !== "off" && (scatterTooltip || chartTooltip) && (
          <ChartTooltipCard
            fontFamily={chartFontFamily}
            axisFontSize={chartRenderOpts.axisFontSize}
            tip={(scatterTooltip ?? chartTooltip)!}
            presentation={tooltipPresentation}
            link={tooltipLink}
            onPin={hoverMark ? () => pinMark(hoverMark, (scatterTooltip ?? chartTooltip)!) : undefined}
            markPinned={!!hoverMark && pinnedTooltips.some((t) => t.chartId === activeChart?.id && resolveMarkHit(t.ref) === hoverMark)}
            stageRect={containerRef.current?.getBoundingClientRect() ?? null}
            onDismiss={
              stickyTooltip
                ? () => {
                    setScatterTooltip(null);
                    setChartTooltip(null);
                    setHoveredRowIndex(null);
                  }
                : undefined
            }
          />
        )}

        {activeChart && !liveEdit && (
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 border-t border-loom-border text-2xs text-loom-muted font-mono ${
              isMobile
                ? "min-h-7 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
                : "min-h-[var(--statusbar-height)] py-0.5"
            }`}
          >
            <span
              className={`truncate ${isMobile ? "max-w-[min(18rem,70vw)]" : "max-w-[min(28rem,45vw)]"}`}
              title={activeChart.subtitle ?? undefined}
            >
              {CHART_KIND_CATALOG.find((e) => e.value === activeChart.kind)?.label ?? activeChart.kind}
              {" · "}
              {activeChart.xField}
              {activeChart.yField ? ` × ${activeChart.yField}` : ""}
            </span>
            {!isMobile && (
              <>
                <span className="text-loom-border">·</span>
                <span title={aggregationHint || undefined}>
                  {useWebGPUScatter || useWebGpuScene || useWebGpuCube ? "Accelerated" : "Standard"}
                </span>
              </>
            )}
            {sampleHonestyLabel && (
              <>
                <span className="text-loom-border">·</span>
                <span className="tabular-nums" title={`${sampleHonestyLabel}${aggregationHint ? ` · ${aggregationHint}` : ""}`}>
                  {sampleHonestyLabel}
                </span>
              </>
            )}
            {!isMobile && (activeChart.kind === "scatter" || activeChart.kind === "bubble") && (
              <>
                <span className="text-loom-border">·</span>
                <span title="Press L while hovering to lock tooltip across charts">L = link</span>
              </>
            )}
            {tooltipLink && (
              <>
                <span className="text-loom-accent truncate max-w-[160px]">
                  {tooltipLink.field}={tooltipLink.value}
                </span>
                <button
                  type="button"
                  onClick={() => setTooltipLink(null)}
                  className="text-loom-muted hover:text-loom-text underline"
                >
                  Clear
                </button>
              </>
            )}
            {!isMobile &&
              !socialExportReady &&
              (chartAspect !== "free" ||
                chartDevice !== "desktop" ||
                (appSettings.chartDevice ?? "auto") !== "auto") && (
              <span
                className="ml-auto text-2xs font-mono text-loom-muted/80 tabular-nums"
                title="Chart frame aspect · device · pixel size"
              >
                {aspectLabel(chartAspect)}
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

// === Full-size Canvas 2D renderers (ChartRenderOpts in chartRenderTypes.ts) ===

// --- Shape Drawing Helpers ---
