// LOOM-141 — ChartView orchestration (state, effects, layout)
// @ts-nocheck
"use client";
import type { ReactNode } from "react";
import { GPU_GLOBE_ENABLED, stageDpr } from "./constants";
import { useChartPaint } from "./useChartPaint";
import { useChartExport } from "./useChartExport";
import { useChartShortcuts } from "./useChartShortcuts";
import { useChartStage } from "./useChartStage";
import { useGpuRenderers } from "./useGpuRenderers";
import { useScatterInteractions } from "./useScatterInteractions";
import { getEffectiveScatterBounds, useExtractScatterData } from "./extractScatterData";
import { useAxesOverlay } from "./useAxesOverlay";
import { buildScatterHitForRow, useCanvas2DInteractions } from "./useCanvas2DInteractions";
import { ChartStage } from "./ChartStage";
import type { ChartViewRuntime } from "./chartViewRuntime";
import { useDataCubeStage } from "./useDataCubeStage";
import { useChartSwapAnimation, useChartSwapRefs } from "./useChartSwapAnimation";
import { useChartRenderOpts } from "./useChartRenderOpts";
import { useChartScatterGlobeEffects } from "./useChartScatterGlobeEffects";
import {
  SuggestionRailHeader,
  SuggestionRailPanel,
  SuggestionsEmptyRail,
  SuggestionsRestoreTab,
} from "./SuggestionRail";
import { chartWhyReasonText } from "./ChartToolbar";
import { useChartTheme } from "@/components/useChartTheme";
import { resolveThemeChartStyle } from "@/lib/themeChartStyle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type LoomState, useLoomStore } from "@/lib/store";
import { createChartMonitorDraft, monitorRefLines } from "@/lib/monitoring/chartBridge";
import { buildChartA11ySummary } from "@/lib/chartA11ySummary";
import { dataTableRowsFromHits } from "@/lib/chartDataTableFromHits";
import { type CalloutBox, type PressStart } from "@/lib/markFocus";
import { chartStageLiveMessage, chartStageStatus } from "@/lib/chartStageStatus";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { describeChartColorStatus, discreteSeriesColors, getThemeUiColors, resolveChartColors } from "@/lib/chartPalettes";
import { useIsMobile, useMediaQuery, useMobileLiveEdit, useShellMode } from "@/lib/useMediaQuery";
import { chartSpacePadding } from "@/lib/chartSpace";
import { type ChartRecommendation, createChartRec, getBestSuggestion, getRecommendationReason, getTopSuggestions, recommend, recommendStorySequence, tryBuildRandomChartRec, type YAggregateOption } from "@/lib/recommendations";
import { chartCapabilities, defaultYAggregate, encodingChannelLabels, formatChartAggregationSummary, getChartRenderIssue } from "@/lib/chartSupport";
import { canUseWebGpuScatter } from "@/lib/webGpuScatterEligibility";
import { type ArrangeChange } from "@/components/CanvasArrangeOverlay";
import { ARRANGEMENT_KEYS, hasCanvasArrangement } from "@/lib/canvasArrangement";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";
import { type ChartChromeLayout, type ChartChromeTarget } from "@/lib/chartChromeLink";
import { type AtlasBundle } from "@/lib/geoAtlas";
import { resolveTooltipPresentation } from "@/lib/chartTooltipMode";
import { isWebGpuDrawableScene } from "@/lib/gpuScenes";
import { isWebGpuGlobeKind } from "@/lib/geoMaps";
import { type CubeHoverCell } from "@/components/DataCubePivot";
import { cubeCellKey, type DataCube, type DataCubeRenderOpts } from "@/lib/dataCube";
import { FOOTNOTE_BAND_PX, titleBandBottom } from "@/lib/chartLayout";
import { resolveChartAxisFontSize } from "@/lib/chartType";
import { ensureChartFontLoaded, resolveChartFontFamily } from "@/lib/fontCatalog";
import { ensureContrast } from "@/lib/wcagColor";
import { formatSourceFootnote, resolveDataProvenance } from "@/lib/dataProvenance";
import { VISUAL_PRESETS } from "@/lib/lookSystem";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  readSuggestionsRailFromSession,
  writeSuggestionsRailToSession,
} from "@/lib/shellLayout";
import { type Canvas2DHitContext, type HitTarget } from "@/lib/chartTooltip";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import { type YScaleKind } from "@/lib/dsTransforms";
import { applyChartTimeWindow, composeChartFootnote, formatChartTimeFootnote, resolveEffectiveTimeRec } from "@/lib/chartTime";
import { applyExplorerViewToRows, explorerFiltersActive } from "@/lib/explorerViewRows";
import { goToDashboardsAfterSave, saveChartView } from "@/lib/saveChartView";
import { isNumericType } from "@/lib/canvasCharts/shared";

export function useChartViewCore(): ReactNode | null {
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
  /** Touch tablets (iPad) can't hover-click to pin, so Auto readouts use the glass sheet there too. */
  const coarsePointer = useMediaQuery("(pointer: coarse)");
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
      customColors: chartVisualOverrides.customColors,
      theme: effectiveTheme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    });
    return resolved.continuous ? discreteSeriesColors(resolved, Math.max(8, resolved.colors.length)) : resolved.colors;
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.customColors,
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
      customColors: chartVisualOverrides.customColors,
      theme: effectiveTheme,
      colorblind: !!appSettings.colorblindCharts,
      chartKind: activeChart?.kind ?? null,
      colorFieldType,
      reverse: !!chartVisualOverrides.colorPaletteReverse !== !!activeChart?.channelInvert?.color,
      scaleKind: chartVisualOverrides.colorScaleKind ?? "auto",
    }).colors;
  }, [
    chartVisualOverrides.colorPalette,
    chartVisualOverrides.customColors,
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
      customColors: chartVisualOverrides.customColors,
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
    chartVisualOverrides.customColors,
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
  const [canvasSized, setCanvasSized] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const containerWidth = containerSize.w;
  const isCompact = containerWidth < 400;

  const chartRenderOpts = useChartRenderOpts({
    chartVisualOverrides,
    containerWidth,
    isCompact,
    colors,
    continuousStops,
    opacity,
    pointSize,
    chartFontFamily,
    themeUi,
    activeChart,
    barStackMode,
    chartFootnoteText,
    chartColorInfo,
  });


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
  const { prevChartSwapKeyRef, chartSwapAnimsRef } = useChartSwapRefs();
  /** Last cube frame (data + layout) for hover picking and PNG export. */
  const cubeFrameRef = useRef<{ cube: DataCube; opts: DataCubeRenderOpts; w: number; h: number; baseCamera: { yaw: number; pitch: number; zoom: number } } | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const [sceneOrbit, setSceneOrbit] = useState({ yaw: 0.55, pitch: 0.35, zoom: 1 });
  const sceneOrbitDragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const scenePinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  /** Where the current press began; a click that ends a drag/brush/orbit must not pin. */
  const pointerDownAtRef = useRef<PressStart | null>(null);
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
  const { dataCube, pivotTable, swapCubeAxes, rotateCubeAxes, replaceCubeAxis } = useDataCubeStage({
    activeChart,
    chartSampleRows,
    sampleRows,
    columnStats,
    selectedFile,
    setActiveChart,
    cubeSlice,
    setCubeSlice,
    cubeTableOpen,
    reducedMotion,
    prevCubeRef,
    cubeTransitionRef,
    setCubeAnim,
  });
  const orbitEnabled =
    !!activeChart &&
    (activeChart.kind === "scatter3d" ||
      activeChart.kind === "dataCube" ||
      activeChart.kind === "globe" ||
      activeChart.kind === "globeTrail");
  const exportStateRef = useRef({
    activeChart,
    gpuReady,
    vegaSpec,
    sampleRows: chartSampleRows,
    chartVisualOverrides,
    chartFootnoteText,
    sceneOrbit,
    continuousStops,
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
    continuousStops,
    colors,
    opacity,
    pointSize,
  };
  const sampleRowsRef = useRef(chartSampleRows);
  sampleRowsRef.current = chartSampleRows;
  const hideSuggestionsRail = useCallback(() => {
    setSuggestionsExpanded(false);
    setSuggestionsRailOpen(false);
  }, [setSuggestionsRailOpen]);

  const showSuggestionsRail = useCallback(() => {
    setSuggestionsRailOpen(true);
  }, [setSuggestionsRailOpen]);

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
  /** Zoomed/panned scatter shows "Reset view" bottom-right; the pinned chip lifts above it. */
  const scatterViewMoved = activeChart?.kind === "scatter" && (scatterView.scale !== 1 || scatterView.panX !== 0 || scatterView.panY !== 0);
  const [brushRect, setBrushRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);
  const brushRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  brushRectRef.current = brushRect;
  const lastPointerTypeRef = useRef<string>("mouse");
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
  /** Spoken for keyboard mark steps and pins (the tooltip card itself stays quiet). */
  const [markAnnouncement, setMarkAnnouncement] = useState("");
  /** Set by a keyboard step so only that step's readout is announced (not later hovers). */
  const announceKeyStepRef = useRef(false);
  // Mark focus (markFocus.ts): the hovered / keyboard-focused mark, drawn on its own
  // layer above the chart; pins are drawn there too so exports carry them.
  const focusLayerRef = useRef<HTMLCanvasElement>(null);
  const { chartFrameMax, chartFrameSize } = useChartStage({
    selectedFile,
    suggestionsExpanded,
    socialExportTarget,
    isMobile,
    chartAspect,
    chartDevice,
    chartVisualOverrides,
    hostSize,
    setHostSize,
    containerSize,
    setContainerSize,
    canvasSized,
    setCanvasSized,
    stageHostRef,
    containerRef,
    canvas2DRef,
    canvasRef,
    axesOverlayRef,
    focusLayerRef,
  });
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


  const extractScatterData = useExtractScatterData(chartSampleRows, activeChart);

    useGpuRenderers({
      activeChart,
      sampleRows,
      chartVisualOverrides,
      canvasSized,
      useWebGPUScatter,
      isMobile,
      isCompact,
      scatterView,
      chartRenderOpts,
      colors,
      themeUiBg: themeUi.bg,
      opacity,
      pointSize,
      canvasRef,
      canvas2DRef,
      rendererRef,
      sceneRendererRef,
      cubeRendererRef,
      scatterDataRef,
      canvas2DHitRef,
      gpuReady,
      setGpuReady,
      setGeoAtlasBundle,
      setHitsVersion,
      extractScatterData,
      getEffectiveScatterBounds,
      sampleColumns: sampleRows?.columns,
    });


    useChartShortcuts({
      tooltipLink, setTooltipLink, activeChart, chartSampleRows, scatterTooltipRef, chartTooltipRef,
      getEffectiveScatterBounds, setChartInteractionMode, setToast, applyBrushSelection, setLassoPoints,
      setRulerPins, setCrosshairPos, setScatterView, scatterDataRef, stageHostRef,
    });
    useChartExport({
      setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, savedChartVisualOverrides,
      exportStateRef, canvasRef, canvas2DRef, axesOverlayRef, focusLayerRef, cubeFrameRef,
    });

    const tooltipPresentation = resolveTooltipPresentation(
      chartVisualOverrides.tooltipMode,
      isMobile || coarsePointer,
    );
    /** Glass / dock stay put on touch — finger leave shouldn't wipe the readout. */
    const stickyTooltip = tooltipPresentation === "glass" || tooltipPresentation === "dock";
    /** Scatter and the other canvases keep separate hover state. Show only the active one. */
    const hoverTip = activeChart?.kind === "scatter" ? scatterTooltip : chartTooltip;
    /** Height of the carved footer info band (source footnote / colour stops); overlays sit above it. */
    const footerBandPx =
      (chartFootnoteText || chartColorInfo?.stops?.length) && (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer"
        ? FOOTNOTE_BAND_PX
        : 0;

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
      (rowIndex: number) => buildScatterHitForRow(scatterDataRef.current, rowIndex, pointSize),
      [pointSize],
    );
    const scatterInteractions = useScatterInteractions({
      activeChart,
      chartInteractionMode,
      tooltipPresentation,
      stickyTooltip,
      lassoPoints,
      crosshairPos,
      rulerPins,
      scatterView,
      pointSize,
      setScatterTooltip,
      setHoveredRowIndex,
      setHoverMark,
      setCrosshairPos,
      setRulerPins,
      setLassoPoints,
      setBrushRect,
      setScatterView,
      setToast,
      applyBrushSelection,
      scatterDataRef,
      sampleRowsRef,
      containerRef,
      brushStartRef,
      brushRectRef,
      pointerDownAtRef,
      lastPointerTypeRef,
      getEffectiveScatterBounds,
      scatterHitForRow,
    });
    const {
      overlayRef,
      isPanning,
      setIsPanning,
      panStartRef,
      pinchRef,
      touchDistance,
      applyPinchZoom,
      wasDrag,
      handleScatterPointerLeave,
      handleScatterMouseDown,
      handleScatterMouseMove,
      handleScatterMouseUp,
    } = scatterInteractions;
    const {
      pinMark,
      hoverRef,
      handleCanvas2DPointerMove,
      handleCanvas2DPointerLeave,
      handleMarkKeyDown,
    } = useCanvas2DInteractions({
      activeChart,
      markIdentity,
      pointSize,
      tooltipPresentation,
      stickyTooltip,
      canvasSized,
      pinnedTooltips,
      togglePinnedTooltip,
      hoverMark,
      setHoverMark,
      setChartTooltip,
      setScatterTooltip,
      setHoveredRowIndex,
      setCubeHover,
      setChartChromeFocus,
      setPanelOpen,
      setPanelTab,
      setChartPanelSection,
      chromeHover,
      setChromeHover,
      chartChromeFocus,
      keyboardMarkIndex,
      setKeyboardMarkIndex,
      chartTooltip,
      setMarkAnnouncement,
      announceKeyStepRef,
      hitsVersion,
      refreshKey,
      containerSize,
      themeUi,
      chartFontFamily,
      chartRenderOpts,
      containerRef,
      canvas2DHitRef,
      scatterDataRef,
      sampleRowsRef,
      focusLayerRef,
      pinnedBoxesRef,
      cubeFrameRef,
      sceneOrbitDragRef,
    });

    useChartSwapAnimation({
      activeChart,
      socialExportReady,
      arranging,
      reducedMotion,
      useWebGPUScatter,
      useWebGpuScene,
      useWebGpuGlobe,
      useWebGpuCube,
      axesOverlayRef,
      canvasRef,
      canvas2DRef,
      prevChartSwapKeyRef,
      chartSwapAnimsRef,
    });

    useAxesOverlay({
      axesOverlayRef,
      canvasSized,
      activeChart,
      gpuReady,
      useWebGPUScatter,
      useWebGpuScene,
      useWebGpuGlobe,
      extractScatterData,
      scatterView,
      chartRenderOpts,
      refreshKey,
      effectiveTheme,
      isCompact,
      chartTitleOverrides,
      containerSize,
      selectedFile,
      sampleRows,
      chartSampleRows,
      chartFootnoteText,
      chartColorInfo,
      footnoteOpts,
      fontEpoch,
      chartVisualOverrides,
    });


    useChartScatterGlobeEffects({ activeChart, sampleRows, setScatterView, setSceneOrbit });

  useChartPaint({
    refs: {
      canvasRef, canvas2DRef, axesOverlayRef, focusLayerRef, stageHostRef, containerRef, overlayRef,
      rendererRef, sceneRendererRef, cubeRendererRef, scatterDataRef, canvas2DHitRef, cubeFrameRef,
      cubeTransitionRef, exportStateRef, sampleRowsRef, scatterTooltipRef, chartTooltipRef, brushStartRef,
      brushRectRef, panStartRef, pinchRef, pointerDownAtRef, sceneOrbitDragRef, scenePinchRef,
      lastPointerTypeRef, pinnedBoxesRef, suggestCycleRef, prevChartSwapKeyRef, chartSwapAnimsRef,
      arrangePanelWasOpen, prevCubeRef, announceKeyStepRef,
    },
    canvasSized,
    activeChart: activeChart!,
    sampleRows: sampleRows!,
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
    refreshKey,
    reportArrangementLayout,
    setHitsVersion,
    setChartDrawError,
    setCubeAnim,
  });

  const whyReasonText =
    activeChart != null ? chartWhyReasonText(activeChart, aiSuggestionReason, getRecommendationReason) : "";
  const chartToolRailProps = {
    whyReasonOpen,
    whyReasonText,
    onCloseWhy: () => setWhyReasonOpen(false),
    onRefresh: handleRefresh,
    showSave: !!selectedFile,
    onSave: saveActiveChartView,
    showMonitor: !!selectedFile?.path.startsWith("stream://"),
    chartMonitorCount,
    onMonitor: () => createChartMonitorDraft(),
    chartDataTableOpen,
    onToggleDataTable: () => setChartDataTableOpen((o) => !o),
    onToggleWhy: () => setWhyReasonOpen((o) => !o),
    showArrange: !socialExportTarget,
    arranging,
    onToggleArranging: toggleArranging,
    onEditTitle: handleTitleStartEdit,
  };

  // --- Empty states ---
  if (!selectedFile) return null;

  const suggestionHeader = (
    <SuggestionRailHeader
      isMobile={isMobile}
      suggestionsExpanded={suggestionsExpanded}
      chartRecsCount={chartRecs.length}
      columnStatsLength={columnStats.length}
      hasSampleRows={!!sampleRows}
      bestSuggestion={bestSuggestion}
      topSuggestionsCount={topSuggestions.length}
      topSuggestionsFirstTitle={topSuggestions[0]?.title}
      aiSuggesting={aiSuggesting}
      onToggleExpanded={() => setSuggestionsExpanded(!suggestionsExpanded)}
      onHideRail={hideSuggestionsRail}
      onStartDeepScan={startDeepScan}
      onOpenChartEditor={openChartEditor}
      onSuggestChart={handleSuggestChart}
      onTellStory={handleTellStory}
      onSuggestWithAI={handleSuggestWithAI}
    />
  );

  const suggestionsRestoreTab =
    !suggestionsRailOpen && !socialExportReady && !liveEdit && !arranging ? (
      <SuggestionsRestoreTab
        isMobile={isMobile}
        chartRecsCount={chartRecs.length}
        onShowRail={showSuggestionsRail}
        onOpenChartEditor={openChartEditor}
      />
    ) : null;

  if (chartRecs.length === 0) {
    return (
      <div className="flex h-full animate-enter flex-col md:flex-row">
        <SuggestionsEmptyRail
          suggestionsRailOpen={suggestionsRailOpen}
          restoreTab={suggestionsRestoreTab}
          header={suggestionHeader}
        />
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
    <div className={`flex h-full animate-enter ${suggestionsExpanded || isMobile ? "flex-col" : ""}`}>
      {/* Recommendation panel — desktop left rail, mobile bottom rail, or full browse grid */}
      {showSuggestionsPanel ? (
        <SuggestionRailPanel
          suggestionsExpanded={suggestionsExpanded}
          mobileRail={mobileRail}
          chartRecs={chartRecs}
          sampleRows={sampleRows}
          activeChartId={activeChart?.id}
          header={suggestionHeader}
          onSelectRec={selectRecommendation}
        />
      ) : (
        suggestionsRestoreTab
      )}

      <ChartStage
        d={
          {
            socialExportReady,
            liveEdit,
            suggestionsExpanded,
            titleEditing,
            titleEditValue,
            setTitleEditValue,
            handleTitleSave,
            handleTitleKeyDown,
            displayTitle,
            activeChart,
            isMobile,
            chartInteractionMode,
            densityHint,
            setChartInteractionMode,
            applyClarity,
            stageHostRef,
            chartAspect,
            socialExportTarget,
            arranging,
            resetArrangement,
            finishArranging,
            stageLiveMessage,
            markAnnouncement,
            loadingSample,
            chartDrawError,
            chartDataTableOpen,
            dataTableRows,
            setChartDataTableOpen,
            chartToolRailProps,
            containerRef,
            chartA11yLabel,
            handleMarkKeyDown,
            orbitEnabled,
            sceneOrbit,
            sceneOrbitDragRef,
            setSceneOrbit,
            cubeHover,
            setCubeSlice,
            scenePinchRef,
            touchDistance,
            chartFrameSize,
            themeUi,
            canvasRef,
            canvas2DRef,
            axesOverlayRef,
            focusLayerRef,
            useWebGPUScatter,
            useWebGpuScene,
            useWebGpuGlobe,
            useWebGpuCube,
            renderIssue,
            applyWorkingChart,
            setPanelTab,
            overlayRef,
            isPanning,
            handleScatterMouseMove,
            handleScatterPointerLeave,
            brushStartRef,
            panStartRef,
            setIsPanning,
            setCrosshairPos,
            handleScatterMouseDown,
            handleScatterMouseUp,
            pinchRef,
            applyPinchZoom,
            scatterDataRef,
            setScatterView,
            lastPointerTypeRef,
            wasDrag,
            scatterTooltip,
            chartTooltip,
            chartFootnoteText,
            chartColorInfo,
            pinMark,
            hoverMark,
            handleCanvas2DPointerMove,
            pointerDownAtRef,
            handleCanvas2DPointerLeave,
            canvas2DHitRef,
            chromeHover,
            chartChromeFocus,
            dataCube,
            previewCaptureActive,
            chartFontFamily,
            chartRenderOpts,
            continuousStops,
            chartVisualOverrides,
            cubeSlice,
            cubeTableOpen,
            pivotTable,
            swapCubeAxes,
            rotateCubeAxes,
            replaceCubeAxis,
            setCubeTableOpen,
            setCubeHover,
            setChartTooltip,
            containerSize,
            brushRect,
            lassoPoints,
            crosshairPos,
            sampleRows,
            footerBandPx,
            rulerPins,
            setRulerPins,
            pinnedTooltips,
            setPinnedTooltips,
            scatterViewMoved,
            scatterView,
            getEffectiveScatterBounds,
            chartAnnotations,
            arrangementPreview,
            setArrangementPreview,
            arrangeReady,
            arrangementLayout,
            commitArrangement,
            chartFrameMax,
            showMarginals,
            readoutsObscured,
            tooltipPresentation,
            hoverTip,
            tooltipLink,
            hoverRef,
            stickyTooltip,
            setScatterTooltip,
            setHoveredRowIndex,
            appSettings,
            chartDevice,
            sampleHonestyLabel,
            aggregationHint,
            setTooltipLink,
          } satisfies ChartViewRuntime
        }
      />

    </div>
  );
}
