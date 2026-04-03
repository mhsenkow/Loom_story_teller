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
import { getPaletteColors, getThemeUiColors, hexToRgb01 } from "@/lib/chartPalettes";
import {
  getBestSuggestion,
  getRecommendationReason,
  createChartRec,
  recommendStorySequence,
  recommend,
  tryBuildRandomChartRec,
  type YAggregateOption,
} from "@/lib/recommendations";
import { getChartRenderIssue, formatChartAggregationSummary } from "@/lib/chartSupport";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import { suggestChartFromOllama } from "@/lib/ollama";
import {
  allowedRowIndices,
  pickCanvasTooltipRowIndex,
  projectRowForTooltip,
  resolveTooltipFieldNames,
  rowMatchesTooltipLink,
} from "@/lib/chartTooltip";
import { buildBarFacetGrid, type BarFacetHitPayload, type Canvas2DHitContext } from "@/lib/chartTooltip";

const DEFAULT_COLORS = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const DEFAULT_PAD = 50;

function isNumericType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some(n => t.includes(n));
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
  } = useLoomStore();

  const colors = useMemo(
    () => getPaletteColors(chartVisualOverrides.colorPalette ?? "theme"),
    [chartVisualOverrides.colorPalette, appSettings.theme],
  );
  const opacity = chartVisualOverrides.opacity ?? 0.7;
  const pointSize = chartVisualOverrides.pointSize ?? 12;

  const themeUi = useMemo(() => getThemeUiColors(), [appSettings.theme]);

  const [containerWidth, setContainerWidth] = useState(800);
  const isCompact = containerWidth < 400;
  const isMedium = containerWidth < 600;

  const chartRenderOpts = useMemo((): ChartRenderOpts => ({
    colors,
    opacity,
    pointSize: isCompact ? Math.max(4, pointSize * 0.7) : pointSize,
    fontFamily: chartVisualOverrides.fontFamily ?? "Inter",
    titleFontWeight: chartVisualOverrides.titleFontWeight ?? 600,
    titleItalic: chartVisualOverrides.titleItalic ?? false,
    tickRotation: chartVisualOverrides.tickRotation ?? 0,
    axisFontSize: isCompact ? 8 : (chartVisualOverrides.axisFontSize ?? 10),
    markShape: chartVisualOverrides.markShape ?? "circle",
    markStroke: chartVisualOverrides.markStroke ?? false,
    markStrokeWidth: chartVisualOverrides.markStrokeWidth ?? 1,
    markStrokeColor: chartVisualOverrides.markStrokeColor ?? "auto",
    markJitter: chartVisualOverrides.markJitter ?? 0,
    sizeScale: chartVisualOverrides.sizeScale ?? 1,
    barCornerRadius: chartVisualOverrides.barCornerRadius ?? 3,
    lineStrokeStyle: chartVisualOverrides.lineStrokeStyle ?? "solid",
    lineCurveSmooth: chartVisualOverrides.lineCurveSmooth ?? false,
    lineWidth: chartVisualOverrides.lineWidth ?? 1.5,
    axisLineColor: chartVisualOverrides.axisLineColor ?? themeUi.border,
    axisLineWidth: chartVisualOverrides.axisLineWidth ?? 1,
    gridStyle: chartVisualOverrides.gridStyle ?? "solid",
    gridOpacity: chartVisualOverrides.gridOpacity ?? 0.5,
    tickCount: chartVisualOverrides.tickCount ?? 5,
    axisLabelColor: chartVisualOverrides.axisLabelColor ?? themeUi.muted,
    showGrid: isCompact ? false : (chartVisualOverrides.showGrid !== false),
    chartPadding: isCompact ? 25 : isMedium ? 35 : (chartVisualOverrides.chartPadding ?? DEFAULT_PAD),
    legendPosition: isCompact ? "none" : (chartVisualOverrides.legendPosition ?? "none"),
    showDataLabels: chartVisualOverrides.showDataLabels ?? false,
    backgroundStyle: chartVisualOverrides.backgroundStyle ?? "default",
    blendMode: chartVisualOverrides.blendMode ?? "source-over",
    glowEnabled: chartVisualOverrides.glowEnabled ?? false,
    glowIntensity: chartVisualOverrides.glowIntensity ?? 8,
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
  }), [colors, opacity, pointSize, chartVisualOverrides, themeUi, isCompact, isMedium, activeChart?.yField, activeChart?.yAggregate, activeChart?.kind, barStackMode]);

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
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LoomRenderer | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const hasSmartOverlays =
    smartResults &&
    ((smartResults.anomaly?.rowIndices?.length ?? 0) > 0 ||
      (smartResults.trend?.points?.length ?? 0) >= 2 ||
      (smartResults.forecast?.points?.length ?? 0) > 0 ||
      (smartResults.referenceLines?.lines?.length ?? 0) > 0 ||
      (smartResults.clusters && Object.keys(smartResults.clusters.rowToCluster).length > 0));
  const useWebGPUScatter =
    activeChart?.kind === "scatter" &&
    gpuReady &&
    !hasSmartOverlays &&
    (chartVisualOverrides.markShape ?? "circle") === "circle" &&
    !chartVisualOverrides.markStroke &&
    !(chartVisualOverrides.markJitter ?? 0) &&
    !chartVisualOverrides.glowEnabled &&
    !activeChart?.glowField &&
    !activeChart?.outlineField &&
    !activeChart?.opacityField;
  const [canvasSized, setCanvasSized] = useState(false);
  const exportStateRef = useRef({ activeChart, gpuReady, vegaSpec, sampleRows, chartVisualOverrides });
  exportStateRef.current = { activeChart, gpuReady, vegaSpec, sampleRows, chartVisualOverrides };
  const sampleRowsRef = useRef(sampleRows);
  sampleRowsRef.current = sampleRows;
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
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
  const tableName = selectedFile?.name?.replace(/\.\w+$/, "") ?? "";

  const displayTitle = activeChart
    ? (chartTitleOverrides[activeChart.id] ?? activeChart.title)
    : "Select a chart";

  const handleSuggestChart = useCallback(() => {
    if (bestSuggestion) {
      setActiveChart(bestSuggestion);
      setPanelTab("chart");
    }
  }, [bestSuggestion, setActiveChart, setPanelTab]);

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
        } else {
          if (bestSuggestion) {
            setActiveChart(bestSuggestion);
            setPanelTab("chart");
          }
        }
      } else {
        if (bestSuggestion) {
          setActiveChart(bestSuggestion);
          setPanelTab("chart");
        }
      }
    } finally {
      setAiSuggesting(false);
    }
  }, [columnStats, tableName, activeChart, bestSuggestion, setActiveChart, setPanelTab]);

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
        const dpr = window.devicePixelRatio || 1;
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
      if (e.key !== "l" && e.key !== "L") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tooltipLink, setTooltipLink, activeChart, sampleRows, scatterTooltip, chartTooltip]);

  // Initialize WebGPU on its own canvas (a canvas can only have one context: webgpu OR 2d)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new LoomRenderer();
    rendererRef.current = renderer;
    renderer.init(canvas).then((ok) => { if (ok) setGpuReady(true); });
    return () => { renderer.destroy(); rendererRef.current = null; setGpuReady(false); };
  }, []);

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
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(width * dpr);
        const h = Math.round(height * dpr);
        [canvas, canvas2D, axesOverlay].forEach(c => {
          c.width = w;
          c.height = h;
          c.style.width = `${width}px`;
          c.style.height = `${height}px`;
        });
        setCanvasSized(true);
        setContainerWidth(width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [suggestionsExpanded]);

  // Register PNG/SVG export handlers for the Export tab
  useEffect(() => {
    setPngExportHandler(async (): Promise<Blob | null> => {
      const { activeChart: ac, gpuReady: gpu, chartVisualOverrides: overrides } = exportStateRef.current;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const canvas2D = canvas2DRef.current;
      if (!container || !canvas || !canvas2D || !ac) return null;
      const useWebGPU =
        ac.kind === "scatter" &&
        gpu &&
        (overrides.markShape ?? "circle") === "circle" &&
        !overrides.markStroke &&
        !(overrides.markJitter ?? 0) &&
        !overrides.glowEnabled &&
        !ac.glowField &&
        !ac.outlineField &&
        !ac.opacityField;
      const sourceCanvas = useWebGPU ? canvas : canvas2D;
      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      if (w === 0 || h === 0) return null;
      try {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const ctx = off.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#0a0a0c";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(sourceCanvas, 0, 0);
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
        const specWithData = { ...spec, data: { values } };
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
      const rowIdx = pickCanvasTooltipRowIndex(hit, chartX, chartY, allowed);
      if (rowIdx == null) {
        setChartTooltip(null);
        setHoveredRowIndex(null);
        return;
      }
      const rawRow = sr.rows[rowIdx]!;
      const names = resolveTooltipFieldNames(ac, sr.columns);
      const proj = projectRowForTooltip(sr.columns, rawRow, names);
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
    setHoveredRowIndex(null);
  }, [setHoveredRowIndex]);

  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleScatterWheel = useCallback(
    (e: WheelEvent) => {
      if (!activeChart || activeChart.kind !== "scatter") return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScatterView((v) => ({ ...v, scale: Math.max(0.5, Math.min(20, v.scale + delta)) }));
    },
    [activeChart, useWebGPUScatter]
  );
  const overlayRef = useRef<HTMLDivElement>(null);
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
          setScatterView((v) => ({ ...v, panX: v.panX + dx * dataPerPxX, panY: v.panY - dy * dataPerPxY }));
        }
      }
    },
    [handleScatterPointer]
  );
  const handleScatterMouseUp = useCallback(() => {
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
    []
  );

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

    const useWebGPU = useWebGPUScatter;
    if (useWebGPU) {
      canvas2DHitRef.current = null;
      // Scatter: clear 2D canvas to theme bg so it never shows through, then draw with WebGPU
      const canvas2D = canvas2DRef.current;
      if (canvas2D) {
        const ctx = canvas2D.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
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
      const sizeScale = chartVisualOverrides.sizeScale ?? 1;
      if (sd && rendererRef.current) {
        const eff = getEffectiveScatterBounds(sd, scatterView);
        rendererRef.current.uploadData(sd.points, {
          pointSize: pointSize * 0.35,
          opacity,
          sizeScale,
          palette: colors,
          clearColor: hexToRgb01(themeUi.bg),
        });
        rendererRef.current.render(eff.xMin, eff.xMax, eff.yMin, eff.yMax);
        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas.width / dpr;
          const h = canvas.height / dpr;
          const pad = chartRenderOpts.chartPadding ?? DEFAULT_PAD;
          scatterDataRef.current = { points: sd.points, rowIndices: sd.rowIndices, ...eff, pad, w, h, columns: sampleRows.columns };
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

    const dpr = window.devicePixelRatio || 1;
    const cw = (canvas2D as HTMLCanvasElement).width;
    const ch = (canvas2D as HTMLCanvasElement).height;
    if (typeof cw !== "number" || typeof ch !== "number" || cw <= 0 || ch <= 0) return;
    const w = cw / dpr;
    const h = ch / dpr;

    const rows = sampleRows?.rows;
    const cols = sampleRows?.columns;
    if (!Array.isArray(rows) || !Array.isArray(cols)) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const opts = chartRenderOpts;
    const pad = opts.chartPadding ?? DEFAULT_PAD;
    const xIdx = cols.indexOf(activeChart.xField);
    const yIdx = activeChart.yField ? cols.indexOf(activeChart.yField) : -1;
    const cIdx = activeChart.colorField ? cols.indexOf(activeChart.colorField) : -1;
    const sizeIdx = activeChart.sizeField ? cols.indexOf(activeChart.sizeField) : -1;
    const glowIdx = activeChart.glowField ? cols.indexOf(activeChart.glowField) : -1;
    const outlineIdx = activeChart.outlineField ? cols.indexOf(activeChart.outlineField) : -1;
    const opacityIdx = activeChart.opacityField ? cols.indexOf(activeChart.opacityField) : -1;
    if (xIdx === -1) return;

    const fontFamily = opts.fontFamily ?? "Inter";
    const titleWeight = opts.titleFontWeight ?? 600;
    const titleItalic = opts.titleItalic ? "italic" : "normal";
    const axisLabelColor = opts.axisLabelColor ?? "#6b6b78";

    const drawOneFrame = (clipProgress: number) => {
      try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawBackground(ctx, w, h, opts.backgroundStyle, opts.themeBg);
        if (clipProgress < 1) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w * clipProgress, h);
          ctx.clip();
        }
        ctx.globalCompositeOperation = (opts.blendMode as GlobalCompositeOperation) ?? "source-over";

        ctx.strokeStyle = opts.axisLineColor ?? opts.themeBorder ?? "#2a2a30";
        ctx.lineWidth = opts.axisLineWidth ?? 1;
        ctx.beginPath();
        ctx.moveTo(pad, pad);
        ctx.lineTo(pad, h - pad);
        ctx.lineTo(w - pad, h - pad);
        ctx.stroke();

        ctx.fillStyle = axisLabelColor;
        ctx.font = `${opts.axisFontSize ?? 10}px '${fontFamily}', sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(activeChart.xField, w / 2, h - 12);
        if (activeChart.yField) {
          ctx.save();
          ctx.translate(14, h / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(activeChart.yField, 0, 0);
          ctx.restore();
        }

        const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
        ctx.fillStyle = opts.themeText ?? "#e8e8ec";
        ctx.font = `${titleItalic} ${titleWeight} 13px ${fontFamily}, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(titleText, pad, 28);
        ctx.fillStyle = axisLabelColor;
        ctx.font = `11px ${fontFamily}, sans-serif`;
        ctx.fillText(activeChart.subtitle, pad, 44);

        let scatterViewBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | undefined;
        if (activeChart.kind === "scatter") {
          const sd = extractScatterData();
          if (sd) {
            scatterViewBounds = getEffectiveScatterBounds(sd, scatterView);
            scatterDataRef.current = { ...sd, ...scatterViewBounds, pad, w, h, columns: cols };
          }
        }

        const barColorIdx = cIdx >= 0 && cIdx !== xIdx ? cIdx : -1;
        let barEntries: [string, number][] | undefined;
        let barFacetPayload: ReturnType<typeof buildBarFacetGrid> | undefined;
        if (activeChart.kind === "bar") {
          const barAgg: YAggregateOption = yIdx < 0 ? "count" : (opts.yAggregate ?? "sum");
          const stackM = opts.barStackMode ?? "grouped";
          if (barColorIdx >= 0) {
            barFacetPayload = buildBarFacetGrid(rows, xIdx, yIdx, barColorIdx, barAgg, stackM) ?? undefined;
          }
          if (!barFacetPayload) {
            const groups = new Map<string, number[]>();
            for (const r of rows) {
              const k = String(r[xIdx]);
              if (!groups.has(k)) groups.set(k, []);
              if (yIdx < 0) groups.get(k)!.push(1);
              else {
                const v = Number(r[yIdx]);
                if (!isNaN(v)) groups.get(k)!.push(v);
              }
            }
            barEntries = [...groups.entries()]
              .map(([label, vals]) => [label, aggregateValues(vals, barAgg)] as [string, number])
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20);
          }
        }

        switch (activeChart.kind) {
          case "scatter":
            renderFullScatter(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, opts, {
              glowIdx,
              outlineIdx,
              opacityIdx,
            }, smartResults?.clusters?.rowToCluster ?? undefined, scatterViewBounds);
            break;
          case "bar": renderFullBar(ctx, rows, xIdx, yIdx, barColorIdx, w, h, pad, opts, barFacetPayload); break;
          case "histogram": renderFullHistogram(ctx, rows, xIdx, w, h, pad, opts); break;
          case "line": renderFullLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "heatmap": renderFullHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "strip":
            renderFullStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts, { opacityIdx });
            break;
          case "box": renderFullBox(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "area": renderFullArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "pie": renderFullPie(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "bubble": renderFullBubble(ctx, rows, cols, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, opts); break;
          case "violin": renderFullViolin(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "radar": renderFullRadar(ctx, rows, cols, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "waterfall": renderFullWaterfall(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "lollipop": renderFullLollipop(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "treemap": renderFullTreemap(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "sunburst": renderFullSunburst(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "choropleth": renderFullChoropleth(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "forceBubble": renderFullForceBubble(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "sankey": renderFullSankey(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
        }

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
          ...(activeChart.kind === "bar" && !barFacetPayload && barEntries?.length ? { barEntries } : {}),
        };
        canvas2DHitRef.current = baseHit;

        const catMap = new Map<string, number>();
        if (cIdx >= 0) {
          if (activeChart.kind === "bar" && barFacetPayload) {
            barFacetPayload.subLabels.forEach((lab, i) => catMap.set(lab, i));
          } else {
            let next = 0;
            for (const r of rows) {
              const k = String(r[cIdx]);
              if (!catMap.has(k)) catMap.set(k, next++);
            }
          }
        }
        if (opts.legendPosition && opts.legendPosition !== "none") {
          drawLegend(ctx, catMap, opts.colors, opts.legendPosition, w, h, pad, fontFamily, opts.themeBg, opts.themeBorder, opts.themeMuted);
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
  }, [canvasSized, activeChart, sampleRows, gpuReady, useWebGPUScatter, extractScatterData, getEffectiveScatterBounds, scatterView, chartRenderOpts, chartVisualOverrides.animateEntrance, chartVisualOverrides.sizeScale, refreshKey, chartTitleOverrides, smartResults, themeUi]);

  // Axes overlay for WebGPU scatter; clear when not scatter so overlay doesn't sit on top of line/bar
  useEffect(() => {
    const overlay = axesOverlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = overlay.width / dpr;
    const h = overlay.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (!canvasSized || !activeChart || activeChart.kind !== "scatter" || !gpuReady || !useWebGPUScatter) return;
    const sd = extractScatterData();
    if (!sd) return;
    const overlayPad = chartVisualOverrides.chartPadding ?? DEFAULT_PAD;
    const eff = getEffectiveScatterBounds(sd, scatterView);
    const ui = getThemeUiColors();
    const overlayOpts: ChartRenderOpts = {
      colors: [],
      opacity: 1,
      pointSize: 8,
      axisFontSize: chartVisualOverrides.axisFontSize ?? 10,
      fontFamily: chartVisualOverrides.fontFamily ?? "Inter",
      axisLabelColor: chartVisualOverrides.axisLabelColor ?? ui.muted,
      axisLineColor: chartVisualOverrides.axisLineColor ?? ui.border,
      axisLineWidth: chartVisualOverrides.axisLineWidth ?? 1,
      tickCount: chartVisualOverrides.tickCount ?? 5,
      tickRotation: chartVisualOverrides.tickRotation ?? 0,
      showGrid: chartVisualOverrides.showGrid !== false,
      gridStyle: chartVisualOverrides.gridStyle ?? "solid",
      gridOpacity: chartVisualOverrides.gridOpacity ?? 0.5,
      chartPadding: overlayPad,
      themeBg: ui.bg,
      themeText: ui.text,
      themeMuted: ui.muted,
      themeBorder: ui.border,
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = overlayOpts.axisLineColor ?? ui.border;
    ctx.lineWidth = overlayOpts.axisLineWidth ?? 1;
    ctx.beginPath();
    ctx.moveTo(overlayPad, overlayPad);
    ctx.lineTo(overlayPad, h - overlayPad);
    ctx.lineTo(w - overlayPad, h - overlayPad);
    ctx.stroke();
    ctx.fillStyle = overlayOpts.axisLabelColor ?? ui.muted;
    ctx.font = `${overlayOpts.axisFontSize}px '${overlayOpts.fontFamily}', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(activeChart.xField, w / 2, h - 12);
    if (activeChart.yField) {
      ctx.save();
      ctx.translate(14, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(activeChart.yField, 0, 0);
      ctx.restore();
    }
    if (overlayOpts.showGrid) {
      drawGridLines(ctx, eff.xMin, eff.xMax, eff.yMin, eff.yMax, w, h, overlayPad, overlayOpts);
    }
    drawAxisTicks(ctx, eff.xMin, eff.xMax, eff.yMin, eff.yMax, w, h, overlayPad, overlayOpts);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [canvasSized, activeChart, gpuReady, useWebGPUScatter, extractScatterData, getEffectiveScatterBounds, scatterView, chartVisualOverrides, refreshKey, appSettings.theme]);

  useEffect(() => {
    if (activeChart?.kind === "scatter") setScatterView({ scale: 1, panX: 0, panY: 0 });
  }, [activeChart?.id]);

  // --- Empty states ---
  if (!selectedFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
        <div className="w-16 h-16 rounded-xl bg-loom-elevated border border-loom-border flex items-center justify-center text-loom-muted">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M3 3v18h18M7 16l4-8 4 4 4-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-loom-text">No file selected</p>
          <p className="text-xs text-loom-muted mt-1">Select a file from the sidebar to see chart suggestions and visualize your data.</p>
          <p className="text-2xs text-loom-muted mt-3">Use Data & sources to add a folder or load CSV files.</p>
        </div>
      </div>
    );
  }

  // Always show suggestions panel when a file is selected. Expand (first) stays visible; clicking it expands suggestions into the full view.
  const suggestionHeader = (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-loom-border flex-shrink-0 flex-wrap">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-loom-text">Suggestions</p>
        <p className="text-2xs text-loom-muted">{chartRecs.length} charts found</p>
      </div>
      {/* Expand first so it's never cut off; icon-only to save space */}
      <button
        type="button"
        onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
        className="loom-btn-ghost p-2 rounded border border-loom-border hover:border-loom-accent hover:bg-loom-accent/10 transition-colors shrink-0"
        title={suggestionsExpanded ? "Collapse to sidebar" : "Expand to full grid — suggestions fill the view"}
        aria-label={suggestionsExpanded ? "Collapse" : "Expand"}
      >
        {suggestionsExpanded ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 15l-6-6-6 6" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        )}
      </button>
      {bestSuggestion && (
        <button
          type="button"
          onClick={handleSuggestChart}
          className="text-2xs py-1.5 px-2 rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 transition-colors font-medium shrink-0"
          title="Apply best recommendation by score"
        >
          Suggest chart
        </button>
      )}
      <button
        type="button"
        onClick={async () => {
          if (!selectedFile) {
            setToast("Select a file first");
            return;
          }
          const story = recommendStorySequence(columnStats, sampleRows, selectedFile.name);
          if (story.charts.length === 0) {
            setToast("Not enough data variety to build a story");
            return;
          }
          const id = createStoryDashboard(selectedFile.path, selectedFile.name, story.title, story.charts, sampleRows);
          if (!id) {
            setToast("Could not create story dashboard");
            return;
          }
          const dashboard = useLoomStore.getState().dashboards.find((d) => d.id === id);
          const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
          if (chartIds.length > 0) {
            setToast("Capturing chart previews…");
            await captureStoryDashboardPreviews(id);
          } else {
            useLoomStore.getState().setDashboardsExpanded(true);
          }
          setPanelTab("dashboards");
          setToast(`Created "${story.title}" with ${story.charts.length} charts`);
        }}
        disabled={!selectedFile || chartRecs.length === 0}
        className="text-2xs py-1.5 px-2 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-accent transition-colors font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Create a dashboard of charts that tell a story (trend → breakdown → distribution → relationship)"
      >
        Tell a story
      </button>
      <button
        type="button"
        onClick={handleSuggestWithAI}
        disabled={aiSuggesting || columnStats.length === 0}
        className="text-2xs py-1.5 px-2 rounded border border-loom-border text-loom-muted hover:border-loom-accent hover:text-loom-text hover:bg-loom-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Use local Ollama model to suggest a chart (requires Ollama running)"
      >
        {aiSuggesting ? "…" : "Suggest with AI"}
      </button>
    </div>
  );

  if (chartRecs.length === 0) {
    return (
      <div className="flex h-full animate-fade-in">
        <div className="w-[220px] flex-shrink-0 border-r border-loom-border bg-loom-surface flex flex-col overflow-hidden">
          {suggestionHeader}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center">
              <p className="text-sm text-loom-muted">No chart suggestions</p>
              <p className="text-xs text-loom-muted mt-1">Needs at least 1 numeric or temporal column</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-loom-muted">Select encodings in the Chart tab to build a chart</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full animate-fade-in ${suggestionsExpanded ? "flex-col" : ""}`}>
      {/* Recommendation panel — narrow sidebar or expanded full-width grid */}
      <div
        className={`
          border-r border-loom-border bg-loom-surface overflow-hidden transition-[width] duration-200 ease-out
          ${suggestionsExpanded ? "w-full flex-1 flex flex-col min-h-0 border-r-0 border-b border-loom-border" : "w-[220px] flex-shrink-0 overflow-y-auto"}
        `}
      >
        {suggestionHeader}
        <div
          className={`
            overflow-y-auto flex-1 min-h-0
            ${suggestionsExpanded ? "p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 content-start" : "p-2 grid grid-cols-1 gap-2"}
          `}
        >
          {chartRecs.map((rec) => (
            <ChartCard
              key={rec.id}
              rec={rec}
              data={sampleRows}
              isActive={activeChart?.id === rec.id}
              onClick={() => {
                setActiveChart(rec);
                setPanelTab("chart");
              }}
            />
          ))}
        </div>
      </div>

      {/* Full-size chart — always in DOM so refs/ResizeObserver stay valid; zero width when expanded */}
      <div
        className={`
          flex flex-col min-w-0 overflow-hidden transition-[width] duration-200 ease-out
          ${suggestionsExpanded ? "w-0 flex-shrink-0" : "flex-1"}
        `}
      >
        <div className="flex items-center gap-3 px-4 py-2 border-b border-loom-border bg-loom-surface/50">
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
                    title={activeChart ? "Double-click or hover for edit" : undefined}
                  >
                    {displayTitle}
                  </span>
                  {activeChart && showTitleEditButton && (
                    <button
                      type="button"
                      onClick={handleTitleStartEdit}
                      className="shrink-0 p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
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
            {activeChart && !titleEditing && (
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
            <div className="flex items-center gap-1.5">
              {activeChart.kind === "scatter" && (
                <div className="flex items-center gap-0.5 mr-1">
                  {(["pan", "crosshair", "lasso"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setChartInteractionMode(mode)}
                      className={`px-1.5 py-0.5 text-2xs rounded ${chartInteractionMode === mode ? "bg-loom-accent/25 text-loom-text border border-loom-accent/50" : "text-loom-muted border border-transparent hover:border-loom-border"}`}
                    >
                      {mode === "pan" ? "Pan" : mode === "crosshair" ? "Cross" : "Lasso"}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                className="px-1.5 py-0.5 text-2xs font-mono text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded"
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
                  className="px-1.5 py-0.5 text-2xs text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded"
                  title="Save this chart for dashboards"
                >
                  Save view
                </button>
              )}
              <span className="loom-badge text-2xs" title={aggregationHint || undefined}>{useWebGPUScatter ? "GPU" : "2D"}</span>
              <span className="loom-badge text-2xs max-w-[200px] truncate" title={`${sampleHonestyLabel}${aggregationHint ? ` · ${aggregationHint}` : ""}`}>
                {sampleHonestyLabel || "—"}
              </span>
            </div>
          )}
        </div>

        <div ref={containerRef} className="flex-1 relative min-h-0 min-h-[200px]">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: useWebGPUScatter ? 1 : 0 }}
          />
          <canvas
            ref={canvas2DRef}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: useWebGPUScatter ? 0 : 1 }}
          />
          <canvas
            ref={axesOverlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: useWebGPUScatter ? 2 : 0 }}
          />
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
                    onClick={() => setPanelTab("chart")}
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
              style={{ zIndex: 3, cursor: chartInteractionMode === "crosshair" ? "crosshair" : chartInteractionMode === "lasso" ? "default" : "grab" }}
              onMouseMove={handleScatterMouseMove}
              onMouseLeave={() => {
                handleScatterPointerLeave();
                panStartRef.current = null;
                if (brushStartRef.current) { brushStartRef.current = null; setBrushRect(null); setLassoPoints([]); }
                setCrosshairPos(null);
              }}
              onMouseDown={handleScatterMouseDown}
              onMouseUp={handleScatterMouseUp}
              onMouseOut={handleScatterMouseUp}
              onClick={(e) => {
                if (chartInteractionMode === "pan" && scatterTooltip && activeChart) {
                  addPinnedTooltip({ chartId: activeChart.id, x: scatterTooltip.clientX, y: scatterTooltip.clientY, rowIndex: scatterTooltip.rowIndex, row: scatterTooltip.row, columns: scatterTooltip.columns });
                }
              }}
            />
          )}
          {activeChart && activeChart.kind !== "scatter" && (
            <div
              className="absolute inset-0 w-full h-full"
              style={{ zIndex: 2, cursor: "crosshair" }}
              onMouseMove={handleCanvas2DPointerMove}
              onMouseLeave={handleCanvas2DPointerLeave}
              aria-hidden
            />
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
        {(scatterTooltip || chartTooltip) && (
          <div
            className="fixed z-[100] px-2 py-1.5 text-xs font-mono rounded border border-loom-border bg-loom-surface text-loom-text shadow-lg pointer-events-none max-w-[280px]"
            style={{
              left: Math.min((scatterTooltip ?? chartTooltip)!.clientX + 12, window.innerWidth - 290),
              top: (scatterTooltip ?? chartTooltip)!.clientY + 12,
            }}
          >
            <div className="space-y-0.5">
              {(scatterTooltip ?? chartTooltip)!.columns.slice(0, 8).map((col, i) => (
                <div key={col} className="flex gap-2">
                  <span className="text-loom-muted shrink-0">{col}:</span>
                  <span className="truncate">{String((scatterTooltip ?? chartTooltip)!.row[i] ?? "null")}</span>
                </div>
              ))}
              {(scatterTooltip ?? chartTooltip)!.columns.length > 8 && (
                <div className="text-loom-muted">+{(scatterTooltip ?? chartTooltip)!.columns.length - 8} more</div>
              )}
              {tooltipLink && (
                <div className="text-2xs text-loom-accent border-t border-loom-border mt-1 pt-1 truncate" title={`Filter: ${tooltipLink.field} = ${tooltipLink.value}`}>
                  Link: {tooltipLink.field}={tooltipLink.value}
                </div>
              )}
            </div>
          </div>
        )}

        {activeChart && (
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
          </div>
        )}
      </div>
    </div>
  );
}

// === Full-size Canvas 2D renderers ===

export interface ChartRenderOpts {
  colors: string[];
  opacity: number;
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
  // Theme-derived (so chart bg/title/axes follow app theme)
  themeBg?: string;
  themeText?: string;
  themeMuted?: string;
  themeBorder?: string;
  /** Y aggregation for bar/line/area/pie (canvas renderer uses this; Vega spec has it too). */
  yAggregate?: YAggregateOption | null;
  /** Bar + Color: grouped (dodge), stacked, or 100% stacked — canvas + Vega via createChartRec. */
  barStackMode?: "grouped" | "stacked" | "percent";
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

// --- Background presets (themeBg from app theme when provided) ---
function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, style?: string, themeBg?: string) {
  const bg = themeBg ?? "#0a0a0c";
  switch (style) {
    case "gradient": {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      grad.addColorStop(0, bg);
      grad.addColorStop(1, blendTowardBlack(bg, 0.6));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "paper": {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.03;
      for (let i = 0; i < 2000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "transparent":
      ctx.clearRect(0, 0, w, h);
      break;
    default:
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
  }
}
function blendTowardBlack(hex: string, amount: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = Math.round(parseInt(m[1], 16) * (1 - amount));
  const g = Math.round(parseInt(m[2], 16) * (1 - amount));
  const b = Math.round(parseInt(m[3], 16) * (1 - amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// --- Legend renderer (theme colors optional) ---
function drawLegend(ctx: CanvasRenderingContext2D, catMap: Map<string, number>, colors: string[], position: string, w: number, h: number, pad: number, fontFamily: string, themeBg = "#111114", themeBorder = "#2a2a30", themeMuted = "#a0a0aa") {
  if (position === "none" || catMap.size === 0) return;
  const entries = [...catMap.entries()].slice(0, 10);
  const lineH = 16;
  const boxSize = 8;
  const legendW = 120;
  const legendH = entries.length * lineH + 12;

  let lx: number, ly: number;
  switch (position) {
    case "bottom":
      lx = pad; ly = h - pad + 24;
      break;
    case "right":
      lx = w - legendW - 8; ly = pad + 20;
      break;
    default: // top-right
      lx = w - legendW - 8; ly = pad;
  }

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = themeBg;
  ctx.strokeStyle = themeBorder;
  ctx.lineWidth = 1;
  const r = 4;
  ctx.beginPath();
  ctx.moveTo(lx + r, ly); ctx.lineTo(lx + legendW - r, ly);
  ctx.arcTo(lx + legendW, ly, lx + legendW, ly + r, r);
  ctx.lineTo(lx + legendW, ly + legendH - r);
  ctx.arcTo(lx + legendW, ly + legendH, lx + legendW - r, ly + legendH, r);
  ctx.lineTo(lx + r, ly + legendH);
  ctx.arcTo(lx, ly + legendH, lx, ly + legendH - r, r);
  ctx.lineTo(lx, ly + r);
  ctx.arcTo(lx, ly, lx + r, ly, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;

  entries.forEach(([label, catIdx], i) => {
    const ey = ly + 8 + i * lineH;
    ctx.fillStyle = colors[catIdx % colors.length];
    ctx.fillRect(lx + 8, ey, boxSize, boxSize);
    ctx.fillStyle = themeMuted;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(label.length > 12 ? label.slice(0, 11) + "…" : label, lx + 20, ey + 8);
  });
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

// --- Monotone curve interpolation (Catmull-Rom-like) ---
function drawSmoothLine(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 2) return;
  if (pts.length === 2) {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
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
  const baseAlpha = opts?.opacity ?? 0.7;
  const baseRadius = Math.max(1.5, (opts?.pointSize ?? 12) / 4);
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

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);

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
    const scale = opts?.sizeScale ?? 1;
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = Math.max(1, baseRadius * (0.4 + 1.2 * t) * scale);
      }
    } else {
      radius = baseRadius * scale;
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
  }
  ctx.globalAlpha = 1;
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
) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const cornerR = opts?.barCornerRadius ?? 3;
  const showDataLabels = opts?.showDataLabels ?? false;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const plotH = h - 2 * pad - 20;
  const chartW = w - 2 * pad;

  if (facet && ci >= 0 && facet.grid.length > 0 && facet.subLabels.length > 0) {
    const { xLabels, subLabels, grid, stackMode } = facet;
    const nx = xLabels.length;
    const ns = subLabels.length;
    const groupW = chartW / nx;

    if (stackMode === "grouped") {
      let maxVal = 0;
      for (let gi = 0; gi < nx; gi++) {
        for (let si = 0; si < ns; si++) {
          maxVal = Math.max(maxVal, grid[gi]![si]!);
        }
      }
      if (maxVal <= 0) return;
      const innerW = Math.max(2, (groupW - 6) / ns);
      for (let gi = 0; gi < nx; gi++) {
        const xk = xLabels[gi]!;
        for (let si = 0; si < ns; si++) {
          const val = grid[gi]![si]!;
          const barH = (val / maxVal) * plotH;
          const x = pad + gi * groupW + 3 + si * innerW;
          ctx.fillStyle = cols[si % cols.length];
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          roundedRect(ctx, x, h - pad - barH, innerW - 1, barH, cornerR);
          ctx.fill();
          if (showDataLabels && barH > 10) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = axisLabelColor;
            ctx.font = `8px '${fontFamily}', sans-serif`;
            ctx.textAlign = "center";
            const lbl = val >= 1000 || (val > 0 && val < 0.01) ? val.toExponential(1) : String(Math.round(val * 10) / 10);
            ctx.fillText(lbl, x + (innerW - 1) / 2, h - pad - barH - 4);
          }
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = axisLabelColor;
        ctx.font = `9px '${fontFamily}', sans-serif`;
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(pad + gi * groupW + groupW / 2, h - pad + 10);
        ctx.rotate(-0.5);
        const lab = xk.length > 10 ? xk.slice(0, 9) + "\u2026" : xk;
        ctx.fillText(lab, 0, 0);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      return;
    }

    const maxStack = Math.max(1, ...xLabels.map((_, gi) => subLabels.reduce((s, _, si) => s + grid[gi]![si]!, 0)));
    for (let gi = 0; gi < nx; gi++) {
      const xk = xLabels[gi]!;
      const x0 = pad + gi * groupW + 2;
      const bw = Math.max(4, groupW - 4);
      let yCursor = h - pad;
      const rowSum = stackMode === "percent"
        ? Math.max(1, subLabels.reduce((s, _, si) => s + grid[gi]![si]!, 0))
        : maxStack;
      for (let si = 0; si < ns; si++) {
        const v = grid[gi]![si]!;
        const barH = stackMode === "percent" ? (v / rowSum) * plotH : (v / maxStack) * plotH;
        if (barH < 0.25) continue;
        ctx.fillStyle = cols[si % cols.length];
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        roundedRect(ctx, x0, yCursor - barH, bw, barH, cornerR);
        ctx.fill();
        yCursor -= barH;
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = `9px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(pad + gi * groupW + groupW / 2, h - pad + 10);
      ctx.rotate(-0.5);
      const lab = xk.length > 10 ? xk.slice(0, 9) + "\u2026" : xk;
      ctx.fillText(lab, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    return;
  }

  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    if (yi < 0) groups.get(k)!.push(1);
    else {
      const v = Number(r[yi]);
      if (!isNaN(v)) groups.get(k)!.push(v);
    }
  }
  const entries = [...groups.entries()]
    .map(([label, vals]) => [label, aggregateValues(vals, agg)] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (entries.length === 0) return;
  const maxVal = Math.max(...entries.map(e => e[1]), 1);
  const barW = Math.max(4, (w - 2 * pad) / entries.length - 4);

  entries.forEach(([label, val], i) => {
    const barH = (val / maxVal) * plotH;
    const x = pad + i * ((w - 2 * pad) / entries.length) + 2;
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    roundedRect(ctx, x, h - pad - barH, barW, barH, cornerR);
    ctx.fill();

    if (showDataLabels) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = axisLabelColor;
      ctx.font = `9px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      const lbl = typeof val === "number" && (val >= 1000 || val < 0.01) ? val.toExponential(1) : String(Math.round(val * 10) / 10);
      ctx.fillText(lbl, x + barW / 2, h - pad - barH - 6);
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = axisLabelColor;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(x + barW / 2, h - pad + 10);
    ctx.rotate(-0.5);
    ctx.fillText(label.length > 10 ? label.slice(0, 9) + "\u2026" : label, 0, 0);
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

function renderFullHistogram(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const [min, max] = numRange(rows, xi);
  const bins = 30; const counts = new Array(bins).fill(0);
  for (const r of rows) { const v = Number(r[xi]); if (!isNaN(v)) { counts[Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins))]++; } }
  const maxC = Math.max(...counts, 1);
  const barW = (w - 2 * pad) / bins;

  counts.forEach((c, i) => {
    const barH = (c / maxC) * (h - 2 * pad - 20);
    ctx.fillStyle = cols[1] ?? cols[0]; ctx.globalAlpha = alpha;
    ctx.fillRect(pad + i * barW, h - pad - barH, barW - 1, barH);
  });
  ctx.globalAlpha = 1;
  drawAxisTicks(ctx, min, max, 0, maxC, w, h, pad, opts);
}

function renderFullLine(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const lineW = opts?.lineWidth ?? 1.5;
  const agg = opts?.yAggregate ?? "mean";
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));

  const aggregateByX = (gRows: unknown[][]): { xKey: string; yVal: number }[] => {
    const byX = new Map<string, number[]>();
    for (const r of gRows) {
      const xKey = String(r[xi]);
      if (!byX.has(xKey)) byX.set(xKey, []);
      const v = Number(r[yi]);
      if (!isNaN(v)) byX.get(xKey)!.push(v);
    }
    const xKeys = [...byX.keys()].sort((a, b) => String(a).localeCompare(String(b)));
    return xKeys.map((xKey) => ({ xKey, yVal: aggregateValues(byX.get(xKey) ?? [], agg) }));
  };

  const series = aggregateByX(sorted);
  if (series.length === 0) return;
  const yMin = Math.min(...series.map((s) => s.yVal));
  const yMax = Math.max(...series.map((s) => s.yVal));
  const yRange = yMax - yMin || 1;

  drawGridLines(ctx, 0, 1, yMin, yMax, w, h, pad, opts);
  applyLineDash(ctx, opts?.lineStrokeStyle);

  const toPoints = (s: { xKey: string; yVal: number }[]) =>
    s.map((p, i) => ({
      x: pad + (i / Math.max(s.length - 1, 1)) * (w - 2 * pad),
      y: h - pad - ((p.yVal - yMin) / yRange) * (h - 2 * pad),
    }));

  if (ci >= 0) {
    const colorGroups = new Map<string, unknown[][]>();
    for (const r of sorted) {
      const k = String(r[ci]);
      if (!colorGroups.has(k)) colorGroups.set(k, []);
      colorGroups.get(k)!.push(r);
    }
    let gi = 0;
    for (const [, gRows] of colorGroups) {
      const s = aggregateByX(gRows);
      if (s.length === 0) continue;
      ctx.strokeStyle = cols[gi++ % cols.length];
      ctx.lineWidth = lineW;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const pts = toPoints(s);
      if (opts?.lineCurveSmooth && pts.length >= 2) {
        drawSmoothLine(ctx, pts);
      } else {
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      }
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = cols[3] ?? cols[0];
    ctx.lineWidth = lineW;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const pts = toPoints(series);
    if (opts?.lineCurveSmooth && pts.length >= 2) {
      drawSmoothLine(ctx, pts);
    } else {
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  drawAxisTicks(ctx, 0, 1, yMin, yMax, w, h, pad, opts);
}

function renderFullHeatmap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, _opts?: ChartRenderOpts) {
  const xLabels = [...new Set(rows.map(r => String(r[xi])))].slice(0, 20);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 20);
  const counts = new Map<string, number>();
  for (const r of rows) { const k = `${r[xi]}|${r[yi]}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const maxC = Math.max(...counts.values(), 1);
  const cellW = (w - 2 * pad) / xLabels.length;
  const cellH = (h - 2 * pad) / yLabels.length;

  xLabels.forEach((xL, xi2) => {
    yLabels.forEach((yL, yi2) => {
      const c = counts.get(`${xL}|${yL}`) ?? 0;
      const t = c / maxC;
      ctx.fillStyle = `rgba(108, 92, 231, ${0.08 + t * 0.88})`;
      ctx.fillRect(pad + xi2 * cellW, pad + 20 + yi2 * cellH, cellW - 1, cellH - 1);
    });
  });
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
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const [xMin, xMax] = numRange(rows, xi);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 15);
  const bandH = (h - 2 * pad - 20) / yLabels.length;
  const opacityIdx = encodingIndices?.opacityIdx ?? -1;
  const getOpacityNorm = opacityIdx >= 0 ? encodingNorm(rows, opacityIdx) : null;

  yLabels.forEach((label, i) => {
    ctx.fillStyle = axisLabelColor;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(label.length > 12 ? label.slice(0, 11) + "\u2026" : label, pad - 6, pad + 20 + i * bandH + bandH / 2 + 3);
  });

  const ciMap = ci >= 0 ? new Map([...new Set(rows.map(r => String(r[ci])))].map((k, i) => [k, i])) : null;
  let pointIdx = 0;
  for (const r of rows) {
    const x = Number(r[xi]);
    if (isNaN(x)) continue;
    const yiL = yLabels.indexOf(String(r[yi]));
    if (yiL < 0) continue;
    let sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = pad + 20 + yiL * bandH + bandH / 2;
    if (jitterPx > 0) {
      sx += jitter(pointIdx * 2, jitterPx);
    }
    pointIdx++;
    const alpha =
      getOpacityNorm != null
        ? Math.min(0.6, Math.max(0.15, baseAlpha * (0.3 + 0.7 * getOpacityNorm(r))))
        : Math.min(0.6, baseAlpha);
    ctx.beginPath();
    ctx.moveTo(sx, sy - bandH * 0.35);
    ctx.lineTo(sx, sy + bandH * 0.35);
    ctx.strokeStyle = cols[(ciMap && ci >= 0 ? (ciMap.get(String(r[ci])) ?? 0) : yiL) % cols.length];
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function quartiles(sorted: number[]): { q1: number; q2: number; q3: number; min: number; max: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, q2: 0, q3: 0, min: 0, max: 0 };
  const min = sorted[0];
  const max = sorted[n - 1];
  const q2 = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const lo = sorted.slice(0, Math.floor(n / 2));
  const hi = sorted.slice(Math.ceil(n / 2));
  const q1 = lo.length % 2 === 1 ? lo[(lo.length - 1) / 2]! : (lo[lo.length / 2 - 1]! + lo[lo.length / 2]!) / 2;
  const q3 = hi.length % 2 === 1 ? hi[(hi.length - 1) / 2]! : (hi[hi.length / 2 - 1]! + hi[hi.length / 2]!) / 2;
  return { q1, q2, q3, min, max };
}

function renderFullBox(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.7;
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const v = Number(r[yi]);
    if (isNaN(v)) continue;
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const entries = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 20);
  if (entries.length === 0) return;
  let globalMin = Infinity, globalMax = -Infinity;
  const boxes = entries.map(([label, vals]) => {
    const s = [...vals].sort((a, b) => a - b);
    const q = quartiles(s);
    globalMin = Math.min(globalMin, q.min);
    globalMax = Math.max(globalMax, q.max);
    return { label, ...q };
  });
  const range = globalMax - globalMin || 1;
  const boxW = Math.max(8, (w - 2 * pad - 40) / entries.length - 4);
  const plotH = h - 2 * pad - 24;

  boxes.forEach((box, i) => {
    const cx = pad + 24 + (i + 0.5) * ((w - 2 * pad - 40) / entries.length);
    const toY = (v: number) => h - pad - 20 - ((v - globalMin) / range) * plotH;

    ctx.fillStyle = cols[2] ?? cols[0];
    ctx.globalAlpha = alpha;
    const q1y = toY(box.q1), q3y = toY(box.q3);
    ctx.fillRect(cx - boxW / 2, q3y, boxW, q1y - q3y);

    ctx.strokeStyle = opts?.themeText ?? "#e8e8ec";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxW / 2, q3y, boxW, q1y - q3y);

    ctx.beginPath();
    ctx.moveTo(cx, toY(box.min)); ctx.lineTo(cx, toY(box.q1));
    ctx.moveTo(cx - boxW / 2, toY(box.min)); ctx.lineTo(cx + boxW / 2, toY(box.min));
    ctx.moveTo(cx - boxW / 2, toY(box.max)); ctx.lineTo(cx + boxW / 2, toY(box.max));
    ctx.moveTo(cx, toY(box.q3)); ctx.lineTo(cx, toY(box.max));
    ctx.stroke();

    ctx.fillStyle = opts?.themeText ?? "#e8e8ec";
    ctx.fillRect(cx - 4, toY(box.q2) - 1, 8, 2);

    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.font = `9px '${opts?.fontFamily ?? "Inter"}', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(box.label.length > 8 ? box.label.slice(0, 7) + "\u2026" : box.label, cx, h - pad + 2);
  });
  ctx.globalAlpha = 1;
}

function renderFullArea(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.75;
  const agg = opts?.yAggregate ?? "sum";
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));
  const plotH = h - 2 * pad - 20;
  const plotW = w - 2 * pad;
  let maxStack = 0;

  if (ci >= 0) {
    const xToGroupVals = new Map<string, Map<string, number[]>>();
    for (const r of sorted) {
      const xKey = String(r[xi]);
      const g = String(r[ci]);
      const v = Number(r[yi]);
      if (isNaN(v)) continue;
      if (!xToGroupVals.has(xKey)) xToGroupVals.set(xKey, new Map());
      const gm = xToGroupVals.get(xKey)!;
      if (!gm.has(g)) gm.set(g, []);
      gm.get(g)!.push(v);
    }
    const xToGroupSums = new Map<string, Map<string, number>>();
    for (const [xKey, groupMap] of xToGroupVals) {
      xToGroupSums.set(xKey, new Map());
      for (const [g, vals] of groupMap) {
        xToGroupSums.get(xKey)!.set(g, aggregateValues(vals, agg));
      }
    }
    const xKeys = [...xToGroupSums.keys()].sort((a, b) => String(a).localeCompare(String(b)));
    const groupKeys = [...new Set(sorted.map(r => String(r[ci])))];
    const stack: number[] = new Array(xKeys.length).fill(0);
    for (const g of groupKeys) {
      xKeys.forEach((x, i) => {
        const v = xToGroupSums.get(x)?.get(g) ?? 0;
        stack[i] += v;
        maxStack = Math.max(maxStack, stack[i]);
      });
    }
    const range = maxStack || 1;
    let base = new Array(xKeys.length).fill(0);
    for (let j = 0; j < groupKeys.length; j++) {
      const top: number[] = [];
      for (let i = 0; i < xKeys.length; i++) {
        const v = xToGroupSums.get(xKeys[i])?.get(groupKeys[j]) ?? 0;
        top.push(base[i]! + v);
      }
      ctx.fillStyle = cols[j % cols.length];
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let i = 0; i < xKeys.length; i++) {
        const sx = pad + (i / Math.max(xKeys.length - 1, 1)) * plotW;
        const sy = h - pad - 20 - (top[i]! / range) * plotH;
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      for (let i = xKeys.length - 1; i >= 0; i--) {
        const sx = pad + (i / Math.max(xKeys.length - 1, 1)) * plotW;
        const sy = h - pad - 20 - (base[i]! / range) * plotH;
        ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      base = top;
    }
  } else {
    const byX = new Map<string, number[]>();
    for (const r of sorted) {
      const xKey = String(r[xi]);
      if (!byX.has(xKey)) byX.set(xKey, []);
      const v = Number(r[yi]);
      if (!isNaN(v)) byX.get(xKey)!.push(v);
    }
    const xKeys = [...byX.keys()].sort((a, b) => String(a).localeCompare(String(b)));
    const series = xKeys.map((xKey) => aggregateValues(byX.get(xKey) ?? [], agg));
    if (series.length === 0) return;
    const yMin = Math.min(...series);
    const yMax = Math.max(...series);
    const range = yMax - yMin || 1;
    ctx.fillStyle = cols[0];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    xKeys.forEach((_, i) => {
      const y = series[i]!;
      const sx = pad + (i / Math.max(xKeys.length - 1, 1)) * plotW;
      const sy = h - pad - 20 - ((y - yMin) / range) * plotH;
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.lineTo(w - pad, h - pad - 20);
    ctx.lineTo(pad, h - pad - 20);
    ctx.closePath();
    ctx.fill();
    drawGridLines(ctx, 0, 1, yMin, yMax, w, h, pad, opts);
    drawAxisTicks(ctx, 0, 1, yMin, yMax, w, h, pad, opts);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = 1;
  drawGridLines(ctx, 0, 1, 0, maxStack, w, h, pad, opts);
  drawAxisTicks(ctx, 0, 1, 0, maxStack, w, h, pad, opts);
}

function renderFullPie(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.9;
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(yi >= 0 ? Number(r[yi]) : 1);
  }
  const entries = [...groups.entries()]
    .map(([label, vals]) => [label, aggregateValues(vals.filter((v) => !isNaN(v)), agg) || (yi < 0 ? vals.length : 0)] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return;

  const cx = w / 2, cy = (h - pad - 20) / 2;
  const radius = Math.min(w, h - pad - 30) / 2 - 20;

  let start = -Math.PI / 2;
  entries.forEach(([label, val], i) => {
    const sweep = (val / total) * Math.PI * 2;
    ctx.fillStyle = cols[i % cols.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBorder ?? "#1a1a1f";
    ctx.lineWidth = 1;
    ctx.stroke();
    start += sweep;
  });
  if (opts?.showDataLabels) {
    ctx.font = `9px '${opts.fontFamily ?? "Inter"}', sans-serif`;
    ctx.fillStyle = opts.axisLabelColor ?? "#6b6b78";
    ctx.textAlign = "center";
    let startLbl = -Math.PI / 2;
    entries.forEach(([label, val], i) => {
      const sweep = (val / total) * Math.PI * 2;
      const midAngle = startLbl + sweep / 2;
      const r2 = radius * 0.6;
      const tx = cx + Math.cos(midAngle) * r2;
      const ty = cy + Math.sin(midAngle) * r2;
      const pct = ((val / total) * 100).toFixed(0);
      ctx.fillText(`${label.length > 8 ? label.slice(0, 7) + "…" : label} (${pct}%)`, tx, ty + 4);
      startLbl += sweep;
    });
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.font = `9px '${opts?.fontFamily ?? "Inter"}', sans-serif`;
  ctx.textAlign = "center";
  entries.slice(0, 6).forEach(([label], i) => {
    ctx.fillText(label.length > 10 ? label.slice(0, 9) + "\u2026" : label, cx, h - pad - 8 - (6 - i) * 12);
  });
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
  const alpha = opts?.opacity ?? 0.5;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const minR = 3;
  const maxR = Math.min(w, h) * 0.055;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);

  const catMap = new Map<string, number>();
  let nextCat = 0;

  type Bubble = { sx: number; sy: number; r: number; cat: number };
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
        radius = minR + Math.sqrt(t) * (maxR - minR);
      }
    }
    const sx = pad + ((x - xMin) / xRange) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / yRange) * (h - 2 * pad);
    bubbles.push({ sx, sy, r: radius, cat });
  }

  bubbles.sort((a, b) => b.r - a.r);

  for (const b of bubbles) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = palette[b.cat % palette.length];
    ctx.beginPath();
    ctx.arc(b.sx, b.sy, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = Math.min(alpha + 0.3, 0.9);
    ctx.strokeStyle = palette[b.cat % palette.length];
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad, opts);

  if (sizeIdx >= 0) {
    const sizeLabel = sizeIdx < columnNames.length ? columnNames[sizeIdx] : "size";
    const legendX = w - pad - 10;
    let legendY = pad + 60;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
    ctx.textAlign = "right";
    ctx.fillText(`size: ${sizeLabel}`, legendX, legendY);
    legendY += 14;

    const steps = [0.25, 0.5, 1.0];
    for (const t of steps) {
      const r = minR + Math.sqrt(t) * (maxR - minR);
      const val = sizeMin + t * sizeRange;
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(legendX - maxR - 4, legendY, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.textAlign = "left";
      ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val % 1 === 0 ? String(val) : val.toFixed(1), legendX - maxR + r + 2, legendY + 3);
      legendY += Math.max(r * 2 + 4, 14);
    }
    ctx.restore();
  }

  if (ci >= 0 && catMap.size > 1 && catMap.size <= 12) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    let legendY = pad + 60;
    const legendX = pad + 8;
    for (const [label, idx] of catMap) {
      ctx.fillStyle = palette[idx % palette.length];
      ctx.beginPath();
      ctx.arc(legendX + 4, legendY - 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.textAlign = "left";
      ctx.fillText(label.length > 12 ? label.slice(0, 11) + "\u2026" : label, legendX + 12, legendY + 1);
      legendY += 14;
    }
    ctx.restore();
  }
}

// --- Violin ---

function renderFullViolin(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.65;
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = Number(r[yi]);
    if (isNaN(v)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const entries = [...groups.entries()].slice(0, 12);
  if (entries.length === 0) return;
  const allVals = entries.flatMap(([, vs]) => vs);
  const gMin = Math.min(...allVals);
  const gMax = Math.max(...allVals);
  const range = gMax - gMin || 1;
  const bandW = (w - 2 * pad) / entries.length;
  const bins = 20;

  drawGridLines(ctx, gMin, gMax, gMin, gMax, w, h, pad, opts);

  entries.forEach(([, vals], gi) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const counts = new Array(bins).fill(0);
    for (const v of sorted) {
      const b = Math.min(bins - 1, Math.floor(((v - gMin) / range) * bins));
      counts[b]++;
    }
    const maxC = Math.max(...counts, 1);
    const cx = pad + (gi + 0.5) * bandW;
    const halfW = bandW * 0.4;

    ctx.fillStyle = cols[gi % cols.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let b = 0; b < bins; b++) {
      const y = h - pad - (b / bins) * (h - 2 * pad);
      const dx = (counts[b] / maxC) * halfW;
      if (b === 0) ctx.moveTo(cx - dx, y);
      else ctx.lineTo(cx - dx, y);
    }
    for (let b = bins - 1; b >= 0; b--) {
      const y = h - pad - (b / bins) * (h - 2 * pad);
      const dx = (counts[b] / maxC) * halfW;
      ctx.lineTo(cx + dx, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const median = sorted[Math.floor(sorted.length / 2)] ?? gMin;
    const my = h - pad - ((median - gMin) / range) * (h - 2 * pad);
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, my, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.globalAlpha = 1;
  const fontFamily = opts?.fontFamily ?? "Inter";
  ctx.font = `${opts?.axisFontSize ?? 9}px '${fontFamily}', sans-serif`;
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.textAlign = "center";
  entries.forEach(([label], i) => {
    const cx = pad + (i + 0.5) * bandW;
    ctx.fillText(label.length > 8 ? label.slice(0, 7) + "\u2026" : label, cx, h - pad + 12);
  });
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
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const fontFamily = opts?.fontFamily ?? "Inter";

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

  const radarPad = pad + 40;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w - 2 * radarPad, h - 2 * radarPad) / 2;
  if (radius < 20) return;

  const rings = 4;
  ctx.save();
  ctx.strokeStyle = opts?.themeBorder ?? "#2a2a30";
  ctx.lineWidth = 0.5;
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * (ring / rings);
    ctx.globalAlpha = ring === rings ? 0.4 : 0.15;
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

  ctx.globalAlpha = 0.25;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.font = `${opts?.axisFontSize ?? 10}px '${fontFamily}', sans-serif`;
  ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
  ctx.globalAlpha = 1;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const labelR = radius + 14;
    const lx = cx + Math.cos(angle) * labelR;
    const ly = cy + Math.sin(angle) * labelR;
    const name = axes[i].name;
    const label = name.length > 12 ? name.slice(0, 11) + "\u2026" : name;
    ctx.textAlign = Math.abs(Math.cos(angle)) < 0.1 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
    ctx.textBaseline = Math.abs(Math.sin(angle)) < 0.1 ? "middle" : Math.sin(angle) > 0 ? "top" : "bottom";
    ctx.fillText(label, lx, ly);
  }
  ctx.restore();

  groupEntries.forEach(([, gRows], gi) => {
    const normals = axes.map((a, ai) => {
      const vals = gRows.map(r => Number(r[a.idx])).filter(v => !isNaN(v));
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      const [mn, mx] = ranges[ai];
      return mx === mn ? 0.5 : (avg - mn) / (mx - mn);
    });

    const color = palette[gi % palette.length];
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    normals.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, v) * radius;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    normals.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, v) * radius;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    normals.forEach((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = Math.max(0.04, v) * radius;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  if (ci >= 0 && groupEntries.length > 1) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    const legendX = w - pad - 8;
    let legendY = pad + 8;
    groupEntries.forEach(([label], gi) => {
      ctx.fillStyle = palette[gi % palette.length];
      ctx.fillRect(legendX - 50, legendY - 6, 8, 8);
      ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.textAlign = "left";
      ctx.fillText(label.length > 8 ? label.slice(0, 7) + "\u2026" : label, legendX - 38, legendY + 1);
      legendY += 14;
    });
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}

// --- Waterfall ---

function renderFullWaterfall(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
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
    .map(([label, vals]) => [label, aggregateValues(vals.filter(v => !isNaN(v)), agg)] as [string, number])
    .slice(0, 20);
  if (entries.length === 0) return;

  let running = 0;
  const bars: { label: string; start: number; end: number; value: number }[] = [];
  for (const [label, val] of entries) {
    bars.push({ label, start: running, end: running + val, value: val });
    running += val;
  }
  const allY = bars.flatMap(b => [b.start, b.end]);
  const yMin = Math.min(0, ...allY);
  const yMax = Math.max(...allY);
  const range = yMax - yMin || 1;
  const barW = Math.max(4, (w - 2 * pad) / bars.length - 4);

  drawGridLines(ctx, 0, bars.length, yMin, yMax, w, h, pad, opts);

  const toY = (v: number) => h - pad - ((v - yMin) / range) * (h - 2 * pad);

  bars.forEach((bar, i) => {
    const x = pad + i * ((w - 2 * pad) / bars.length) + 2;
    const top = Math.min(toY(bar.start), toY(bar.end));
    const bottom = Math.max(toY(bar.start), toY(bar.end));
    ctx.fillStyle = bar.value >= 0 ? "#00d68f" : "#ff6b6b";
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, top, barW, Math.max(1, bottom - top));

    if (i > 0) {
      ctx.strokeStyle = opts?.themeBorder ?? "#3a3a40";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 2]);
      const prevEnd = toY(bars[i - 1].end);
      ctx.beginPath();
      ctx.moveTo(x - 2, prevEnd);
      ctx.lineTo(x + barW + 2, prevEnd);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  ctx.globalAlpha = 1;
  ctx.font = `${opts?.axisFontSize ?? 9}px '${fontFamily}', sans-serif`;
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.textAlign = "center";
  const rotation = (opts?.tickRotation ?? 0) * Math.PI / 180;
  bars.forEach((bar, i) => {
    const x = pad + (i + 0.5) * ((w - 2 * pad) / bars.length);
    const label = bar.label.length > 8 ? bar.label.slice(0, 7) + "\u2026" : bar.label;
    if (rotation) {
      ctx.save();
      ctx.translate(x, h - pad + 12);
      ctx.rotate(rotation);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(label, x, h - pad + 12);
    }
  });
  drawAxisTicks(ctx, yMin, yMax, yMin, yMax, w, h, pad, opts);
}

// --- Lollipop ---

function renderFullLollipop(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const catColorMap = new Map<string, number>();
  let nextCat = 0;
  if (ci >= 0) {
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
  const maxVal = Math.max(...entries.map(e => e.value), 1);

  drawGridLines(ctx, 0, maxVal, 0, maxVal, w, h, pad, opts);

  const bandH = (h - 2 * pad) / entries.length;
  entries.forEach(({ label, value, cat }, i) => {
    const cy = pad + (i + 0.5) * bandH;
    const barEnd = pad + (value / maxVal) * (w - 2 * pad);
    const baseline = pad;
    const colorIdx = ci >= 0 ? (catColorMap.get(cat) ?? 0) : i;

    ctx.strokeStyle = palette[colorIdx % palette.length];
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha * 0.6;
    ctx.beginPath();
    ctx.moveTo(baseline, cy);
    ctx.lineTo(barEnd, cy);
    ctx.stroke();

    ctx.fillStyle = palette[colorIdx % palette.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(barEnd, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
    ctx.globalAlpha = 1;
    ctx.font = `${opts?.axisFontSize ?? 9}px '${fontFamily}', sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(label.length > 12 ? label.slice(0, 11) + "\u2026" : label, baseline - 4, cy + 3);
  });

  if (ci >= 0 && catColorMap.size > 1 && catColorMap.size <= 12) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    let legendY = pad + 8;
    const legendX = w - pad - 8;
    for (const [label, idx] of catColorMap) {
      ctx.fillStyle = palette[idx % palette.length];
      ctx.beginPath();
      ctx.arc(legendX - 50, legendY - 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.textAlign = "left";
      ctx.fillText(label.length > 8 ? label.slice(0, 7) + "\u2026" : label, legendX - 42, legendY + 1);
      legendY += 14;
    }
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}

// --- Treemap ---

function renderFullTreemap(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { val: number; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    const prev = groups.get(k);
    const catVal = ci >= 0 ? String(r[ci]) : "";
    if (prev) {
      if (agg === "count") prev.val++;
      else if (agg === "sum" || agg === "mean") prev.val += (isNaN(v) ? 0 : v);
      else if (agg === "min") prev.val = Math.min(prev.val, isNaN(v) ? Infinity : v);
      else if (agg === "max") prev.val = Math.max(prev.val, isNaN(v) ? -Infinity : v);
    } else {
      groups.set(k, { val: agg === "count" ? 1 : (isNaN(v) ? 0 : v), cat: catVal });
    }
  }

  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(g.val), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  let nextCat = 0;
  if (ci >= 0) {
    for (const e of entries) {
      if (!catMap.has(e.cat)) catMap.set(e.cat, nextCat++);
    }
  }

  const total = entries.reduce((s, e) => s + e.value, 0);
  const rects: { x: number; y: number; w: number; h: number; label: string; cat: string; value: number }[] = [];

  const treemapLayout = (items: typeof entries, x0: number, y0: number, w0: number, h0: number) => {
    if (items.length === 0 || w0 <= 0 || h0 <= 0) return;
    if (items.length === 1) {
      rects.push({ x: x0, y: y0, w: w0, h: h0, label: items[0].label, cat: items[0].cat, value: items[0].value });
      return;
    }
    const itemTotal = items.reduce((s, e) => s + e.value, 0);
    if (itemTotal <= 0) return;
    const horizontal = w0 >= h0;
    let cumSum = 0;
    let splitIdx = 0;
    const half = itemTotal / 2;
    for (let i = 0; i < items.length; i++) {
      cumSum += items[i].value;
      if (cumSum >= half) { splitIdx = i; break; }
    }
    splitIdx = Math.max(0, Math.min(items.length - 2, splitIdx));
    const left = items.slice(0, splitIdx + 1);
    const right = items.slice(splitIdx + 1);
    const leftSum = left.reduce((s, e) => s + e.value, 0);
    const ratio = leftSum / itemTotal;
    if (horizontal) {
      const splitX = x0 + w0 * ratio;
      treemapLayout(left, x0, y0, splitX - x0, h0);
      treemapLayout(right, splitX, y0, x0 + w0 - splitX, h0);
    } else {
      const splitY = y0 + h0 * ratio;
      treemapLayout(left, x0, y0, w0, splitY - y0);
      treemapLayout(right, x0, splitY, w0, y0 + h0 - splitY);
    }
  };

  treemapLayout(entries, pad, pad + 10, w - 2 * pad, h - 2 * pad - 10);

  for (const rect of rects) {
    const colorIdx = ci >= 0 ? (catMap.get(rect.cat) ?? 0) : (rects.indexOf(rect) % palette.length);
    ctx.fillStyle = palette[colorIdx % palette.length];
    ctx.globalAlpha = alpha;
    ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

    if (rect.w > 30 && rect.h > 16) {
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.9;
      const fontSize = Math.max(8, Math.min(12, rect.w / 8));
      ctx.font = `${fontSize}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const maxLen = Math.floor(rect.w / (fontSize * 0.55));
      const label = rect.label.length > maxLen ? rect.label.slice(0, maxLen - 1) + "\u2026" : rect.label;
      ctx.fillText(label, rect.x + 4, rect.y + 4);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Sunburst ---

function renderFullSunburst(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
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
  const cy = h / 2;
  const outerR = Math.min(w - 2 * pad, h - 2 * pad) / 2 - 10;
  const innerR = outerR * 0.45;
  const hasInner = ci >= 0 && outerEntries.some(e => e.children.length > 1);
  const midR = hasInner ? outerR * 0.7 : outerR;

  let angle = -Math.PI / 2;
  outerEntries.forEach((entry, ei) => {
    const sweep = (entry.total / grandTotal) * Math.PI * 2;
    ctx.fillStyle = palette[ei % palette.length];
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

    if (sweep > 0.2 && midR - innerR > 20) {
      const midAngle = angle + sweep / 2;
      const labelR = (innerR + midR) / 2;
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.9;
      ctx.font = `${Math.max(8, Math.min(11, sweep * 30))}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lbl = entry.label.length > 10 ? entry.label.slice(0, 9) + "\u2026" : entry.label;
      ctx.fillText(lbl, cx + Math.cos(midAngle) * labelR, cy + Math.sin(midAngle) * labelR);
    }

    if (hasInner) {
      let childAngle = angle;
      entry.children.sort((a, b) => b.value - a.value);
      for (const child of entry.children) {
        const childSweep = (child.value / entry.total) * sweep;
        ctx.fillStyle = palette[ei % palette.length];
        ctx.globalAlpha = alpha * 0.65;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, childAngle, childAngle + childSweep);
        ctx.arc(cx, cy, midR, childAngle + childSweep, childAngle, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = opts?.themeBg ?? "#0e0e12";
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        childAngle += childSweep;
      }
    }

    angle += sweep;
  });

  ctx.fillStyle = opts?.themeBg ?? "#0e0e12";
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

// --- Choropleth (simple grid map fallback) ---

function renderFullChoropleth(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
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
  const entries = [...groups.entries()].map(([label, vals]) => ({
    label,
    value: aggregateValues(vals.filter(v => !isNaN(v)), agg),
  })).sort((a, b) => b.value - a.value).slice(0, 60);
  if (entries.length === 0) return;

  const maxVal = Math.max(...entries.map(e => e.value), 1);
  const minVal = Math.min(...entries.map(e => e.value), 0);
  const range = maxVal - minVal || 1;

  const cols = Math.ceil(Math.sqrt(entries.length * (w / h)));
  const rowCount = Math.ceil(entries.length / cols);
  const cellW = (w - 2 * pad) / cols;
  const cellH = (h - 2 * pad - 10) / rowCount;

  entries.forEach((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * cellW;
    const y = pad + 10 + row * cellH;
    const t = (entry.value - minVal) / range;
    const hue = 220 - t * 180;
    const sat = 50 + t * 30;
    const lit = 15 + t * 40;
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`;
    ctx.globalAlpha = alpha;
    const rx = 3;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, cellW - 2, cellH - 2, rx);
    ctx.fill();

    if (cellW > 28 && cellH > 14) {
      ctx.fillStyle = t > 0.5 ? "#000" : "#fff";
      ctx.globalAlpha = 0.85;
      const fs = Math.max(7, Math.min(10, cellW / 5));
      ctx.font = `${fs}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lbl = entry.label.length > Math.floor(cellW / (fs * 0.6)) ? entry.label.slice(0, Math.floor(cellW / (fs * 0.6)) - 1) + "\u2026" : entry.label;
      ctx.fillText(lbl, x + cellW / 2, y + cellH / 2);
    }
  });

  ctx.globalAlpha = 1;
  const legendW = Math.min(120, w - 2 * pad);
  const legendH = 8;
  const lx = w - pad - legendW;
  const ly = h - pad + 4;
  const grad = ctx.createLinearGradient(lx, 0, lx + legendW, 0);
  grad.addColorStop(0, "hsl(220, 50%, 15%)");
  grad.addColorStop(0.5, "hsl(130, 65%, 35%)");
  grad.addColorStop(1, "hsl(40, 80%, 55%)");
  ctx.fillStyle = grad;
  ctx.fillRect(lx, ly, legendW, legendH);
  ctx.font = `8px '${fontFamily}', sans-serif`;
  ctx.fillStyle = opts?.axisLabelColor ?? "#6b6b78";
  ctx.textAlign = "left";
  ctx.fillText(minVal >= 1000 ? `${(minVal/1000).toFixed(1)}k` : String(Math.round(minVal)), lx, ly + legendH + 10);
  ctx.textAlign = "right";
  ctx.fillText(maxVal >= 1000 ? `${(maxVal/1000).toFixed(1)}k` : String(Math.round(maxVal)), lx + legendW, ly + legendH + 10);
}

// --- Force Bubble (packed circles) ---

function renderFullForceBubble(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.75;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const agg: YAggregateOption = yi < 0 ? "count" : (opts?.yAggregate ?? "sum");

  const groups = new Map<string, { val: number; cat: string }>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    const catVal = ci >= 0 ? String(r[ci]) : "";
    const prev = groups.get(k);
    if (prev) {
      if (agg === "count") prev.val++;
      else prev.val += (isNaN(v) ? 0 : v);
    } else {
      groups.set(k, { val: agg === "count" ? 1 : (isNaN(v) ? 0 : v), cat: catVal });
    }
  }

  const entries = [...groups.entries()]
    .map(([label, g]) => ({ label, value: Math.abs(g.val), cat: g.cat }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 50);
  if (entries.length === 0) return;

  const catMap = new Map<string, number>();
  let nextCat = 0;
  if (ci >= 0) {
    for (const e of entries) {
      if (!catMap.has(e.cat)) catMap.set(e.cat, nextCat++);
    }
  }

  const maxVal = Math.max(...entries.map(e => e.value));
  const areaScale = Math.min(w - 2 * pad, h - 2 * pad) / 2;
  const totalArea = entries.reduce((s, e) => s + Math.sqrt(e.value / maxVal), 0);
  const scaleFactor = (areaScale * 0.85) / Math.max(totalArea * 0.18, 1);

  type Circle = { x: number; y: number; r: number; label: string; cat: string; value: number };
  const circles: Circle[] = entries.map(e => ({
    x: w / 2 + (Math.random() - 0.5) * 20,
    y: h / 2 + (Math.random() - 0.5) * 20,
    r: Math.max(8, Math.sqrt(e.value / maxVal) * scaleFactor),
    label: e.label,
    cat: e.cat,
    value: e.value,
  }));

  for (let iter = 0; iter < 120; iter++) {
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i];
      a.x += (w / 2 - a.x) * 0.02;
      a.y += (h / 2 - a.y) * 0.02;
      for (let j = i + 1; j < circles.length; j++) {
        const b = circles[j];
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
    }
  }

  circles.sort((a, b) => b.r - a.r);
  for (const c of circles) {
    const colorIdx = ci >= 0 ? (catMap.get(c.cat) ?? 0) : (circles.indexOf(c) % palette.length);
    ctx.fillStyle = palette[colorIdx % palette.length];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette[colorIdx % palette.length];
    ctx.globalAlpha = Math.min(alpha + 0.2, 1);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (c.r > 18) {
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.9;
      const fs = Math.max(7, Math.min(11, c.r * 0.45));
      ctx.font = `${fs}px '${fontFamily}', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxChars = Math.floor(c.r * 2 / (fs * 0.55));
      const lbl = c.label.length > maxChars ? c.label.slice(0, maxChars - 1) + "\u2026" : c.label;
      ctx.fillText(lbl, c.x, c.y);
    }
  }

  if (ci >= 0 && catMap.size > 1 && catMap.size <= 12) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = `9px '${fontFamily}', sans-serif`;
    let legendY = pad + 8;
    const legendX = w - pad - 8;
    for (const [label, idx] of catMap) {
      ctx.fillStyle = palette[idx % palette.length];
      ctx.beginPath();
      ctx.arc(legendX - 50, legendY - 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
      ctx.textAlign = "left";
      ctx.fillText(label.length > 8 ? label.slice(0, 7) + "\u2026" : label, legendX - 42, legendY + 1);
      legendY += 14;
    }
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}

// --- Sankey ---

function renderFullSankey(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const palette = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.4;
  const fontFamily = opts?.fontFamily ?? "Inter";

  const targetIdx = ci >= 0 ? ci : yi;
  if (targetIdx < 0) return;

  const flows = new Map<string, number>();
  const sourceSet = new Set<string>();
  const targetSet = new Set<string>();
  for (const r of rows) {
    const src = String(r[xi]);
    const tgt = String(r[targetIdx]);
    const v = yi >= 0 && targetIdx !== yi ? Number(r[yi]) : 1;
    const key = `${src}\0${tgt}`;
    flows.set(key, (flows.get(key) ?? 0) + (isNaN(v) ? 1 : Math.abs(v)));
    sourceSet.add(src);
    targetSet.add(tgt);
  }

  const sources = [...sourceSet].slice(0, 15);
  const targets = [...targetSet].slice(0, 15);
  if (sources.length === 0 || targets.length === 0) return;

  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  for (const [key, val] of flows) {
    const [src, tgt] = key.split("\0");
    sourceTotals.set(src, (sourceTotals.get(src) ?? 0) + val);
    targetTotals.set(tgt, (targetTotals.get(tgt) ?? 0) + val);
  }

  const sortedSources = sources.sort((a, b) => (sourceTotals.get(b) ?? 0) - (sourceTotals.get(a) ?? 0));
  const sortedTargets = targets.sort((a, b) => (targetTotals.get(b) ?? 0) - (targetTotals.get(a) ?? 0));

  const grandTotal = [...sourceTotals.values()].reduce((s, v) => s + v, 0) || 1;
  const nodeW = 14;
  const leftX = pad + 50;
  const rightX = w - pad - 50;
  const plotH = h - 2 * pad - 20;
  const nodeGap = 3;

  const sourceY = new Map<string, { y: number; h: number }>();
  let srcCursor = pad + 10;
  const totalSrcGap = nodeGap * (sortedSources.length - 1);
  const srcScale = (plotH - totalSrcGap) / grandTotal;
  for (const s of sortedSources) {
    const sh = Math.max(4, (sourceTotals.get(s) ?? 0) * srcScale);
    sourceY.set(s, { y: srcCursor, h: sh });
    srcCursor += sh + nodeGap;
  }

  const grandTargetTotal = [...targetTotals.values()].reduce((s, v) => s + v, 0) || 1;
  const targetYMap = new Map<string, { y: number; h: number }>();
  let tgtCursor = pad + 10;
  const totalTgtGap = nodeGap * (sortedTargets.length - 1);
  const tgtScale = (plotH - totalTgtGap) / grandTargetTotal;
  for (const t of sortedTargets) {
    const th = Math.max(4, (targetTotals.get(t) ?? 0) * tgtScale);
    targetYMap.set(t, { y: tgtCursor, h: th });
    tgtCursor += th + nodeGap;
  }

  const srcOffsets = new Map<string, number>();
  const tgtOffsets = new Map<string, number>();
  for (const s of sortedSources) srcOffsets.set(s, 0);
  for (const t of sortedTargets) tgtOffsets.set(t, 0);

  for (const [key, val] of [...flows.entries()].sort((a, b) => b[1] - a[1])) {
    const [src, tgt] = key.split("\0");
    const sRect = sourceY.get(src);
    const tRect = targetYMap.get(tgt);
    if (!sRect || !tRect) continue;
    const sOff = srcOffsets.get(src) ?? 0;
    const tOff = tgtOffsets.get(tgt) ?? 0;
    const bandH = Math.max(1, val * srcScale);
    const bandHT = Math.max(1, val * tgtScale);

    const sIdx = sortedSources.indexOf(src);
    ctx.fillStyle = palette[sIdx % palette.length];
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

    srcOffsets.set(src, sOff + bandH);
    tgtOffsets.set(tgt, tOff + bandHT);
  }

  ctx.globalAlpha = 1;
  for (const [i, s] of sortedSources.entries()) {
    const r = sourceY.get(s)!;
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(leftX, r.y, nodeW, r.h);
    ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(s.length > 12 ? s.slice(0, 11) + "\u2026" : s, leftX - 4, r.y + r.h / 2 + 3);
  }

  for (const [i, t] of sortedTargets.entries()) {
    const r = targetYMap.get(t)!;
    ctx.fillStyle = palette[i % palette.length];
    ctx.globalAlpha = 0.7;
    ctx.fillRect(rightX, r.y, nodeW, r.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = opts?.axisLabelColor ?? "#8b8b98";
    ctx.font = `9px '${fontFamily}', sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(t.length > 12 ? t.slice(0, 11) + "\u2026" : t, rightX + nodeW + 4, r.y + r.h / 2 + 3);
  }
}

// --- Helpers ---

function drawGridLines(ctx: CanvasRenderingContext2D, _xMin: number, _xMax: number, _yMin: number, _yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (opts?.showGrid === false) return;
  const style = opts?.gridStyle ?? "solid";
  if (style === "none") return;
  const n = Math.max(2, opts?.tickCount ?? 5);
  const alpha = opts?.gridOpacity ?? 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = opts?.themeBorder ?? "#1a1a1f";
  ctx.lineWidth = 0.5;
  if (style === "dashed") ctx.setLineDash([6, 4]);
  else if (style === "dotted") ctx.setLineDash([2, 3]);
  for (let i = 0; i <= n; i++) {
    const y = pad + (i / n) * (h - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }
  for (let i = 0; i <= n; i++) {
    const x = pad + (i / n) * (w - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAxisTicks(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const n = Math.max(2, opts?.tickCount ?? 5);
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const rotDeg = opts?.tickRotation ?? 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  ctx.fillStyle = axisLabelColor;
  ctx.font = `9px '${fontFamily}', sans-serif`;
  ctx.textAlign = rotDeg === 90 ? "center" : "center";
  for (let i = 0; i <= n; i++) {
    const v = xMin + (i / n) * (xMax - xMin);
    const x = pad + (i / n) * (w - 2 * pad);
    const y = h - pad + 14;
    if (rotDeg !== 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-rotRad);
      ctx.fillText(formatTick(v), 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(formatTick(v), x, y);
    }
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= n; i++) {
    const v = yMin + (i / n) * (yMax - yMin);
    const y = h - pad - (i / n) * (h - 2 * pad);
    ctx.fillText(formatTick(v), pad - 6, y + 3);
  }
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + "M";
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
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
