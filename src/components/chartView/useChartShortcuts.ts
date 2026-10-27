// LOOM-141
// @ts-nocheck
import { useEffect } from "react";

export function useChartShortcuts(ctx: {
  setPngExportHandler?: unknown;
  setSvgExportHandler?: unknown;
  setSvgExportLabel?: unknown;
  vegaSpec?: unknown;
  savedChartVisualOverrides?: unknown;
  exportStateRef?: unknown;
  canvasRef?: unknown;
  canvas2DRef?: unknown;
  axesOverlayRef?: unknown;
  focusLayerRef?: unknown;
  cubeFrameRef?: unknown;
  tooltipLink?: unknown;
  setTooltipLink?: unknown;
  activeChart?: unknown;
  chartSampleRows?: unknown;
  scatterTooltipRef?: unknown;
  chartTooltipRef?: unknown;
  getEffectiveScatterBounds?: unknown;
  setChartInteractionMode?: unknown;
  setToast?: unknown;
  applyBrushSelection?: unknown;
  setLassoPoints?: unknown;
  setRulerPins?: unknown;
  setCrosshairPos?: unknown;
  setScatterView?: unknown;
  scatterDataRef?: unknown;
  stageHostRef?: unknown;
}): void {
  const {
    setPngExportHandler, setSvgExportHandler, setSvgExportLabel, vegaSpec, savedChartVisualOverrides,
    exportStateRef, canvasRef, canvas2DRef, axesOverlayRef, focusLayerRef, cubeFrameRef,
    tooltipLink, setTooltipLink, activeChart, chartSampleRows, scatterTooltipRef, chartTooltipRef,
    getEffectiveScatterBounds, setChartInteractionMode, setToast, applyBrushSelection, setLassoPoints,
    setRulerPins, setCrosshairPos, setScatterView, scatterDataRef, stageHostRef,
  } = ctx as Record<string, never>;
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

}
