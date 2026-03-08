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
import { getBestSuggestion, getRecommendationReason, createChartRec } from "@/lib/recommendations";
import { suggestChartFromOllama } from "@/lib/ollama";

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
    setPngExportHandler, setSvgExportHandler, vegaSpec, smartResults, appSettings,
    setSelectedRowIndices, setToast, chartAnnotations,
    hoveredRowIndex, setHoveredRowIndex,
    pinnedTooltips, addPinnedTooltip, removePinnedTooltip,
    customRefLines, chartInteractionMode, setChartInteractionMode,
    crosshairPos, setCrosshairPos,
    lassoPoints, setLassoPoints,
    barStackMode, connectScatterTrail, showMarginals,
    selectedRowIndices,
    rulerPins, setRulerPins,
    addChartView, setPromptDialog, querySql,
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
  }), [colors, opacity, pointSize, chartVisualOverrides, themeUi, isCompact, isMedium]);

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
  const [chartTooltip, setChartTooltip] = useState<{ clientX: number; clientY: number; row: (string | number | boolean | null)[]; columns: string[] } | null>(null);
  const [scatterView, setScatterView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [brushRect, setBrushRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const brushStartRef = useRef<{ x: number; y: number } | null>(null);
  const brushRectRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  brushRectRef.current = brushRect;
  const scatterDataRef = useRef<{ points: { x: number; y: number }[]; rowIndices: number[]; xMin: number; xMax: number; yMin: number; yMax: number; pad: number; w: number; h: number; columns: string[] } | null>(null);
  const canvas2DHitRef = useRef<{ kind: string; rows: (string | number | boolean | null)[][]; columns: string[]; pad: number; w: number; h: number; xIdx: number; yIdx: number; barEntries?: [string, number][] } | null>(null);
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
      if (!data) {
        setScatterTooltip(null);
        return;
      }
      const rect = (e.target as HTMLDivElement).getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { xMin, xMax, yMin, yMax, pad, w, h, points, rowIndices, columns } = data;
      const chartW = w - 2 * pad;
      const chartH = h - 2 * pad;
      if (chartW <= 0 || chartH <= 0) return;
      const dataX = xMin + ((sx - pad) / chartW) * (xMax - xMin);
      const dataY = yMax - ((sy - pad) / chartH) * (yMax - yMin);
      let bestIdx = -1;
      let bestDist = 24;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const px = pad + ((p.x - xMin) / (xMax - xMin)) * chartW;
        const py = pad + (1 - (p.y - yMin) / (yMax - yMin)) * chartH;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const rowIndex = rowIndices[bestIdx];
        const rows = sampleRowsRef.current?.rows;
        const row = rows?.[rowIndex];
        if (row)
          setScatterTooltip({ clientX: e.clientX, clientY: e.clientY, rowIndex, row, columns });
        else setScatterTooltip(null);
      } else setScatterTooltip(null);
    },
    [activeChart]
  );

  const handleScatterPointerLeave = useCallback(() => setScatterTooltip(null), []);

  const handleCanvas2DPointerMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hit = canvas2DHitRef.current;
      if (!hit || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const scaleX = hit.w / rect.width;
      const scaleY = hit.h / rect.height;
      const chartX = relX * scaleX;
      const chartY = relY * scaleY;
      const { pad, w, h, rows, columns, xIdx, yIdx } = hit;
      const chartWidth = w - 2 * pad;
      const chartHeight = h - 2 * pad;
      if (chartX < pad || chartX > w - pad || chartY < pad || chartY > h - pad) {
        setChartTooltip(null);
        return;
      }
      if (hit.kind === "bar" && hit.barEntries?.length) {
        const t = (chartX - pad) / chartWidth;
        const barIndex = Math.floor(t * hit.barEntries.length);
        const idx = Math.max(0, Math.min(barIndex, hit.barEntries.length - 1));
        const [label, value] = hit.barEntries[idx];
        setChartTooltip({
          clientX: e.clientX,
          clientY: e.clientY,
          row: [label, value],
          columns: [activeChart?.xField ?? "x", activeChart?.yField ?? "value"],
        });
        return;
      }
      if (hit.kind === "line" && rows.length > 0) {
        let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
        for (const r of rows) {
          const x = Number(r[xIdx]);
          const y = Number(r[yIdx]);
          if (!isNaN(x)) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
          if (!isNaN(y)) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
        }
        if (xMin === xMax) xMax = xMin + 1;
        if (yMin === yMax) yMax = yMin + 1;
        const dataX = ((chartX - pad) / chartWidth) * (xMax - xMin) + xMin;
        const dataY = yMax - ((chartY - pad) / chartHeight) * (yMax - yMin);
        let bestIdx = 0;
        let bestDist = Infinity;
        rows.forEach((r, i) => {
          const x = Number(r[xIdx]);
          const y = Number(r[yIdx]);
          if (isNaN(x) || isNaN(y)) return;
          const d = (x - dataX) ** 2 + (y - dataY) ** 2;
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        setChartTooltip({ clientX: e.clientX, clientY: e.clientY, row: rows[bestIdx], columns });
        return;
      }
      setChartTooltip(null);
    },
    [activeChart]
  );
  const handleCanvas2DPointerLeave = useCallback(() => setChartTooltip(null), []);

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
    if (!encoding?.x?.field || !encoding?.y?.field) return null;

    const xIdx = sampleRows.columns.indexOf(encoding.x.field);
    const yIdx = sampleRows.columns.indexOf(encoding.y.field);
    const colorField = (encoding.color as { field?: string } | undefined)?.field;
    const sizeField = (encoding.size as { field?: string } | undefined)?.field ?? activeChart.sizeField;
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

        let barEntries: [string, number][] | undefined;
        if (activeChart.kind === "bar") {
          const groups = new Map<string, number>();
          const isCount = yIdx < 0;
          for (const r of rows) {
            const k = String(r[xIdx]);
            if (isCount) groups.set(k, (groups.get(k) ?? 0) + 1);
            else {
              const v = Number(r[yIdx]);
              if (!isNaN(v)) groups.set(k, (groups.get(k) ?? 0) + v);
            }
          }
          barEntries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
        }

        switch (activeChart.kind) {
          case "scatter":
            renderFullScatter(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, opts, {
              glowIdx,
              outlineIdx,
              opacityIdx,
            }, smartResults?.clusters?.rowToCluster ?? undefined, scatterViewBounds);
            break;
          case "bar": renderFullBar(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "histogram": renderFullHistogram(ctx, rows, xIdx, w, h, pad, opts); break;
          case "line": renderFullLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "heatmap": renderFullHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "strip":
            renderFullStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts, { opacityIdx });
            break;
          case "box": renderFullBox(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
          case "area": renderFullArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
          case "pie": renderFullPie(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
        }

        if (activeChart.kind === "bar" && barEntries?.length) {
          canvas2DHitRef.current = { kind: "bar", rows, columns: cols, pad, w, h, xIdx, yIdx, barEntries };
        } else if (activeChart.kind === "line" && rows.length > 0) {
          canvas2DHitRef.current = { kind: "line", rows, columns: cols, pad, w, h, xIdx, yIdx };
        } else {
          canvas2DHitRef.current = null;
        }

        const catMap = new Map<string, number>();
        if (cIdx >= 0) {
          let next = 0;
          for (const r of rows) {
            const k = String(r[cIdx]);
            if (!catMap.has(k)) catMap.set(k, next++);
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
                      onConfirm: (name) => {
                        if (name != null && name.trim()) {
                          const ok = addChartView(name.trim(), selectedFile.path, selectedFile.name, activeChart, { ...chartVisualOverrides }, querySql, sampleRows ?? undefined);
                          setToast(ok ? "Chart view saved. Open the Dashboards tab and use \"Add to dashboard\" or \"+ Add view\"." : "Could not save chart view");
                        }
                      }
                    });
                  }}
                  className="px-1.5 py-0.5 text-2xs text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded"
                  title="Save this chart for dashboards"
                >
                  Save view
                </button>
              )}
              <span className="loom-badge text-2xs">{useWebGPUScatter ? "GPU" : "2D"}</span>
              <span className="loom-badge text-2xs">{sampleRows?.rows.length.toLocaleString() ?? 0}r</span>
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
          {activeChart && (activeChart.kind === "bar" || activeChart.kind === "line") && !useWebGPUScatter && (
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
            </div>
          </div>
        )}

        {activeChart && (
          <div className="flex items-center gap-2 px-3 h-[var(--statusbar-height)] border-t border-loom-border text-2xs text-loom-muted font-mono">
            <span>Vega-Lite spec: {activeChart.kind}</span>
            <span className="text-loom-border">|</span>
            <span>{activeChart.xField}{activeChart.yField ? ` × ${activeChart.yField}` : ""}</span>
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

function renderFullBar(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
  const cornerR = opts?.barCornerRadius ?? 3;
  const showDataLabels = opts?.showDataLabels ?? false;
  const fontFamily = opts?.fontFamily ?? "Inter";
  const axisLabelColor = opts?.axisLabelColor ?? "#6b6b78";
  const groups = new Map<string, number>();
  const isCount = yi < 0;
  for (const r of rows) {
    const k = String(r[xi]);
    if (isCount) {
      groups.set(k, (groups.get(k) ?? 0) + 1);
    } else {
      const v = Number(r[yi]);
      if (isNaN(v)) continue;
      groups.set(k, (groups.get(k) ?? 0) + v);
    }
  }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (entries.length === 0) return;
  const maxVal = Math.max(...entries.map(e => e[1]), 1);
  const barW = Math.max(4, (w - 2 * pad) / entries.length - 4);

  entries.forEach(([label, val], i) => {
    const barH = (val / maxVal) * (h - 2 * pad - 20);
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
  const [yMin, yMax] = numRange(rows, yi);
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));

  drawGridLines(ctx, 0, 1, yMin, yMax, w, h, pad, opts);
  applyLineDash(ctx, opts?.lineStrokeStyle);

  const toPoints = (gRows: unknown[][]) =>
    gRows.map((r, i) => {
      const y = Number(r[yi]);
      if (isNaN(y)) return null;
      const sx = pad + (i / Math.max(gRows.length - 1, 1)) * (w - 2 * pad);
      const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
      return { x: sx, y: sy };
    }).filter((p): p is { x: number; y: number } => p !== null);

  if (ci >= 0) {
    const groups = new Map<string, typeof sorted>();
    for (const r of sorted) {
      const k = String(r[ci]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    let gi = 0;
    for (const [, gRows] of groups) {
      ctx.strokeStyle = cols[gi++ % cols.length];
      ctx.lineWidth = lineW;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const pts = toPoints(gRows);
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
    const pts = toPoints(sorted);
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
    ctx.strokeStyle = cols[yiL % cols.length];
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
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));
  const plotH = h - 2 * pad - 20;
  const plotW = w - 2 * pad;
  let maxStack = 0;

  if (ci >= 0) {
    const xToGroupSums = new Map<string, Map<string, number>>();
    for (const r of sorted) {
      const xKey = String(r[xi]);
      const g = String(r[ci]);
      const v = Number(r[yi]);
      if (isNaN(v)) continue;
      if (!xToGroupSums.has(xKey)) xToGroupSums.set(xKey, new Map());
      const gm = xToGroupSums.get(xKey)!;
      gm.set(g, (gm.get(g) ?? 0) + v);
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
    const [yMin, yMax] = numRange(rows, yi);
    const range = yMax - yMin || 1;
    ctx.fillStyle = cols[0];
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    sorted.forEach((r, i) => {
      const y = Number(r[yi]);
      if (isNaN(y)) return;
      const sx = pad + (i / Math.max(sorted.length - 1, 1)) * plotW;
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
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[xi]);
    const v = yi >= 0 ? Number(r[yi]) : 1;
    groups.set(k, (groups.get(k) ?? 0) + (isNaN(v) ? 1 : v));
  }
  const entries = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
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
