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
import { useLoomStore } from "@/lib/store";
import { ChartCard } from "@/components/ChartCard";
import { LoomRenderer, type GPUScatterPoint } from "@/lib/webgpu";
import { getPaletteColors } from "@/lib/chartPalettes";
import { getBestSuggestion, getRecommendationReason, createChartRec } from "@/lib/recommendations";
import { suggestChartFromOllama } from "@/lib/ollama";

const DEFAULT_COLORS = ["#6c5ce7", "#00d68f", "#ff6b6b", "#ffd93d", "#00b4d8", "#e77c5c", "#a29bfe", "#74b9ff"];

const PAD = 50;

function isNumericType(dt: string): boolean {
  const t = dt.toUpperCase();
  return ["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"].some(n => t.includes(n));
}

export function ChartView() {
  const {
    selectedFile, sampleRows, chartRecs, activeChart, setActiveChart, setPanelTab, columnStats,
    chartVisualOverrides, aiSuggestionReason, chartTitleOverrides, setChartTitleOverride,
    setPngExportHandler, setSvgExportHandler, vegaSpec,
  } = useLoomStore();

  const colors = useMemo(
    () => getPaletteColors(chartVisualOverrides.colorPalette),
    [chartVisualOverrides.colorPalette],
  );
  const opacity = chartVisualOverrides.opacity ?? 0.7;
  const pointSize = chartVisualOverrides.pointSize ?? 12;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas2DRef = useRef<HTMLCanvasElement>(null);
  const axesOverlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LoomRenderer | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  const [canvasSized, setCanvasSized] = useState(false);
  const exportStateRef = useRef({ activeChart, gpuReady, vegaSpec, sampleRows });
  exportStateRef.current = { activeChart, gpuReady, vegaSpec, sampleRows };
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiSuggesting, setAiSuggesting] = useState(false);
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
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [suggestionsExpanded]);

  // Register PNG/SVG export handlers for the Export tab
  useEffect(() => {
    setPngExportHandler(async (): Promise<Blob | null> => {
      const { activeChart: ac, gpuReady: gpu } = exportStateRef.current;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const canvas2D = canvas2DRef.current;
      if (!container || !canvas || !canvas2D || !ac) return null;
      const useWebGPU = ac.kind === "scatter" && gpu;
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

  const extractScatterData = useCallback(() => {
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
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;

    for (const row of sampleRows.rows) {
      const x = Number(row[xIdx]), y = Number(row[yIdx]);
      if (isNaN(x) || isNaN(y)) continue;
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
      xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    }
    if (points.length === 0) return null;
    const xPad = (xMax - xMin) * 0.05 || 1;
    const yPad = (yMax - yMin) * 0.05 || 1;
    return { points, xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
  }, [sampleRows, activeChart]);

  // Render active chart
  useEffect(() => {
    if (!canvasSized || !activeChart || !sampleRows) return;

    const useWebGPU = activeChart.kind === "scatter" && gpuReady;
    if (useWebGPU) {
      // Scatter: clear 2D canvas so it never shows through, then draw with WebGPU
      const canvas2D = canvas2DRef.current;
      if (canvas2D) {
        const ctx = canvas2D.getContext("2d");
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const w = canvas2D.width / dpr;
          const h = canvas2D.height / dpr;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#0a0a0c";
          ctx.fillRect(0, 0, w, h);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      const sd = extractScatterData();
      if (sd && rendererRef.current) {
        rendererRef.current.uploadData(sd.points, {
          pointSize: (pointSize * 0.35),
          opacity,
        });
        rendererRef.current.render(sd.xMin, sd.xMax, sd.yMin, sd.yMax);
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
    const w = canvas2D.width / dpr;
    const h = canvas2D.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, w, h);

    const pad = PAD;
    const rows = sampleRows.rows;
    const xIdx = sampleRows.columns.indexOf(activeChart.xField);
    const yIdx = activeChart.yField ? sampleRows.columns.indexOf(activeChart.yField) : -1;
    const cIdx = activeChart.colorField ? sampleRows.columns.indexOf(activeChart.colorField) : -1;
    const sizeIdx = activeChart.sizeField ? sampleRows.columns.indexOf(activeChart.sizeField) : -1;
    if (xIdx === -1) return;

    // Axis frame
    ctx.strokeStyle = "#2a2a30";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD);
    ctx.lineTo(PAD, h - PAD);
    ctx.lineTo(w - PAD, h - PAD);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#6b6b78";
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(activeChart.xField, w / 2, h - 12);
    if (activeChart.yField) {
      ctx.save();
      ctx.translate(14, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(activeChart.yField, 0, 0);
      ctx.restore();
    }

    // Title (use overridden title if set)
    const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
    ctx.fillStyle = "#e8e8ec";
    ctx.font = "600 13px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(titleText, pad, 28);
    ctx.fillStyle = "#6b6b78";
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText(activeChart.subtitle, pad, 44);

    const opts = { colors, opacity, pointSize };
    switch (activeChart.kind) {
      case "scatter": renderFullScatter(ctx, rows, xIdx, yIdx, cIdx, sizeIdx, w, h, pad, opts); break;
      case "bar": renderFullBar(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
      case "histogram": renderFullHistogram(ctx, rows, xIdx, w, h, pad, opts); break;
      case "line": renderFullLine(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
      case "heatmap": renderFullHeatmap(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
      case "strip": renderFullStrip(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
      case "box": renderFullBox(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
      case "area": renderFullArea(ctx, rows, xIdx, yIdx, cIdx, w, h, pad, opts); break;
      case "pie": renderFullPie(ctx, rows, xIdx, yIdx, w, h, pad, opts); break;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [canvasSized, activeChart, sampleRows, gpuReady, extractScatterData, colors, opacity, pointSize, refreshKey, chartTitleOverrides]);

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

    if (!canvasSized || !activeChart || activeChart.kind !== "scatter" || !gpuReady) return;
    const sd = extractScatterData();
    if (!sd) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#2a2a30";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD);
    ctx.lineTo(PAD, h - PAD);
    ctx.lineTo(w - PAD, h - PAD);
    ctx.stroke();
    const axisFont = chartVisualOverrides.axisFontSize ?? 10;
    ctx.fillStyle = "#6b6b78";
    ctx.font = `${axisFont}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.fillText(activeChart.xField, w / 2, h - 12);
    if (activeChart.yField) {
      ctx.save();
      ctx.translate(14, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(activeChart.yField, 0, 0);
      ctx.restore();
    }
    if (chartVisualOverrides.showGrid !== false) {
      drawGridLines(ctx, sd.xMin, sd.xMax, sd.yMin, sd.yMax, w, h, PAD);
    }
    drawAxisTicks(ctx, sd.xMin, sd.xMax, sd.yMin, sd.yMax, w, h, PAD);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [canvasSized, activeChart, gpuReady, extractScatterData, chartVisualOverrides.axisFontSize, chartVisualOverrides.showGrid, refreshKey]);

  // --- Empty states ---
  if (!selectedFile) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-loom-muted">Select a file to visualize</p>
          <p className="text-xs text-loom-muted mt-1">Charts are auto-generated from column types</p>
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefresh}
                className="px-2 py-1 text-2xs font-mono text-loom-muted hover:text-loom-text border border-loom-border hover:border-loom-accent rounded transition-colors"
                title="Redraw chart (fixes blank display)"
              >
                Refresh
              </button>
              <span className="loom-badge">
                {activeChart.kind === "scatter" && gpuReady ? "WebGPU" : "Canvas 2D"}
              </span>
              <span className="loom-badge">
                {sampleRows?.rows.length.toLocaleString() ?? 0} rows
              </span>
            </div>
          )}
        </div>

        <div ref={containerRef} className="flex-1 relative min-h-0 min-h-[200px]">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: activeChart?.kind === "scatter" && gpuReady ? 1 : 0 }}
          />
          <canvas
            ref={canvas2DRef}
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: activeChart?.kind === "scatter" && gpuReady ? 0 : 1 }}
          />
          <canvas
            ref={axesOverlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: activeChart?.kind === "scatter" && gpuReady ? 2 : 0 }}
          />
        </div>

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
}

function numRange(rows: unknown[][], idx: number): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const v = Number(r[idx]); if (!isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); } }
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

function renderFullScatter(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, sizeIdx: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.7;
  const baseRadius = Math.max(1.5, (opts?.pointSize ?? 12) / 4);
  const [xMin, xMax] = numRange(rows, xi);
  const [yMin, yMax] = numRange(rows, yi);
  const [sizeMin, sizeMax] = sizeIdx >= 0 ? numRange(rows, sizeIdx) : [0, 1];
  const sizeRange = sizeMax - sizeMin || 1;
  const catMap = new Map<string, number>(); let next = 0;

  drawGridLines(ctx, xMin, xMax, yMin, yMax, w, h, pad);

  for (const r of rows) {
    const x = Number(r[xi]), y = Number(r[yi]);
    if (isNaN(x) || isNaN(y)) continue;
    let cat = 0;
    if (ci >= 0) { const k = String(r[ci]); if (!catMap.has(k)) catMap.set(k, next++); cat = catMap.get(k)!; }
    let radius = baseRadius;
    if (sizeIdx >= 0) {
      const s = Number(r[sizeIdx]);
      if (!isNaN(s)) {
        const t = (s - sizeMin) / sizeRange;
        radius = Math.max(1, baseRadius * (0.4 + 1.2 * t));
      }
    }
    const sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = cols[cat % cols.length]; ctx.globalAlpha = alpha; ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawAxisTicks(ctx, xMin, xMax, yMin, yMax, w, h, pad);
}

function renderFullBar(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.85;
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
    ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = alpha;
    ctx.beginPath();
    roundedRect(ctx, x, h - pad - barH, barW, barH, 3);
    ctx.fill();

    ctx.globalAlpha = 1; ctx.fillStyle = "#6b6b78"; ctx.font = "9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.save(); ctx.translate(x + barW / 2, h - pad + 10); ctx.rotate(-0.5);
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
  drawAxisTicks(ctx, min, max, 0, maxC, w, h, pad);
}

function renderFullLine(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  if (yi < 0) return;
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.8;
  const [yMin, yMax] = numRange(rows, yi);
  const sorted = [...rows].sort((a, b) => String(a[xi]).localeCompare(String(b[xi])));

  drawGridLines(ctx, 0, 1, yMin, yMax, w, h, pad);

  if (ci >= 0) {
    const groups = new Map<string, typeof sorted>();
    for (const r of sorted) {
      const k = String(r[ci]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    let gi = 0;
    for (const [, gRows] of groups) {
      ctx.strokeStyle = cols[gi++ % cols.length]; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha;
      ctx.beginPath();
      gRows.forEach((r, i) => {
        const y = Number(r[yi]); if (isNaN(y)) return;
        const sx = pad + (i / Math.max(gRows.length - 1, 1)) * (w - 2 * pad);
        const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = cols[3] ?? cols[0]; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha;
    ctx.beginPath();
    sorted.forEach((r, i) => {
      const y = Number(r[yi]); if (isNaN(y)) return;
      const sx = pad + (i / Math.max(sorted.length - 1, 1)) * (w - 2 * pad);
      const sy = h - pad - ((y - yMin) / (yMax - yMin)) * (h - 2 * pad);
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
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

function renderFullStrip(ctx: CanvasRenderingContext2D, rows: unknown[][], xi: number, yi: number, ci: number, w: number, h: number, pad: number, opts?: ChartRenderOpts) {
  const cols = opts?.colors ?? DEFAULT_COLORS;
  const alpha = opts?.opacity ?? 0.7;
  const [xMin, xMax] = numRange(rows, xi);
  const yLabels = [...new Set(rows.map(r => String(r[yi])))].slice(0, 15);
  const bandH = (h - 2 * pad - 20) / yLabels.length;

  yLabels.forEach((label, i) => {
    ctx.fillStyle = "#6b6b78"; ctx.font = "9px 'JetBrains Mono', monospace"; ctx.textAlign = "right";
    ctx.fillText(label.length > 12 ? label.slice(0, 11) + "\u2026" : label, pad - 6, pad + 20 + i * bandH + bandH / 2 + 3);
  });

  for (const r of rows) {
    const x = Number(r[xi]); if (isNaN(x)) continue;
    const yiL = yLabels.indexOf(String(r[yi])); if (yiL < 0) continue;
    const sx = pad + ((x - xMin) / (xMax - xMin)) * (w - 2 * pad);
    const sy = pad + 20 + yiL * bandH + bandH / 2;
    ctx.beginPath(); ctx.moveTo(sx, sy - bandH * 0.35); ctx.lineTo(sx, sy + bandH * 0.35);
    ctx.strokeStyle = cols[yiL % cols.length]; ctx.globalAlpha = Math.min(0.6, alpha); ctx.lineWidth = 1; ctx.stroke();
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

    ctx.strokeStyle = "#e8e8ec";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxW / 2, q3y, boxW, q1y - q3y);

    ctx.beginPath();
    ctx.moveTo(cx, toY(box.min)); ctx.lineTo(cx, toY(box.q1));
    ctx.moveTo(cx - boxW / 2, toY(box.min)); ctx.lineTo(cx + boxW / 2, toY(box.min));
    ctx.moveTo(cx - boxW / 2, toY(box.max)); ctx.lineTo(cx + boxW / 2, toY(box.max));
    ctx.moveTo(cx, toY(box.q3)); ctx.lineTo(cx, toY(box.max));
    ctx.stroke();

    ctx.fillStyle = "#e8e8ec";
    ctx.fillRect(cx - 4, toY(box.q2) - 1, 8, 2);

    ctx.fillStyle = "#6b6b78";
    ctx.font = "9px 'JetBrains Mono', monospace";
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
    drawGridLines(ctx, 0, 1, yMin, yMax, w, h, pad);
    drawAxisTicks(ctx, 0, 1, yMin, yMax, w, h, pad);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = 1;
  drawGridLines(ctx, 0, 1, 0, maxStack, w, h, pad);
  drawAxisTicks(ctx, 0, 1, 0, maxStack, w, h, pad);
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
    ctx.strokeStyle = "#1a1a1f";
    ctx.lineWidth = 1;
    ctx.stroke();
    start += sweep;
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#6b6b78";
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  entries.slice(0, 6).forEach(([label], i) => {
    ctx.fillText(label.length > 10 ? label.slice(0, 9) + "\u2026" : label, cx, h - pad - 8 - (6 - i) * 12);
  });
}

// --- Helpers ---

function drawGridLines(ctx: CanvasRenderingContext2D, _xMin: number, _xMax: number, _yMin: number, _yMax: number, w: number, h: number, pad: number) {
  ctx.strokeStyle = "#1a1a1f";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (i / 4) * (h - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const x = pad + (i / 4) * (w - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, h - pad);
    ctx.stroke();
  }
}

function drawAxisTicks(ctx: CanvasRenderingContext2D, xMin: number, xMax: number, yMin: number, yMax: number, w: number, h: number, pad: number) {
  ctx.fillStyle = "#6b6b78"; ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++) {
    const v = xMin + (i / 4) * (xMax - xMin);
    const x = pad + (i / 4) * (w - 2 * pad);
    ctx.fillText(formatTick(v), x, h - pad + 14);
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (i / 4) * (yMax - yMin);
    const y = h - pad - (i / 4) * (h - 2 * pad);
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
