// Scatter pan/zoom, brush, lasso, crosshair, and hover picking (LOOM-141).
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import { pointInPolygon, scatterYDomain } from "@/lib/canvasCharts/shared";
import type { HitTarget } from "@/lib/chartTooltip";
import type { ChartRecommendation } from "@/lib/recommendations";
import { projectRowForTooltip, resolveTooltipFieldNames, rowMatchesTooltipLink } from "@/lib/chartTooltip";
import { invScaleY, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { pressWasDrag, type PressStart } from "@/lib/markFocus";
import { useLoomStore } from "@/lib/store";

export type ScatterTooltipState = {
  clientX: number;
  clientY: number;
  rowIndex: number;
  row: (string | number | boolean | null)[];
  columns: string[];
} | null;

export type UseScatterInteractionsArgs = {
  activeChart: ChartRecommendation | null;
  chartInteractionMode: string;
  tooltipPresentation: string;
  stickyTooltip: boolean;
  lassoPoints: { x: number; y: number }[];
  crosshairPos: { dataX: number; dataY: number; screenX: number; screenY: number } | null;
  rulerPins: { x: number; y: number }[];
  scatterView: { scale: number; panX: number; panY: number };
  pointSize: number;
  setScatterTooltip: React.Dispatch<React.SetStateAction<ScatterTooltipState>>;
  setHoveredRowIndex: (idx: number | null) => void;
  setHoverMark: React.Dispatch<React.SetStateAction<HitTarget | null>>;
  setCrosshairPos: React.Dispatch<
    React.SetStateAction<{ dataX: number; dataY: number; screenX: number; screenY: number } | null>
  >;
  setRulerPins: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setLassoPoints: React.Dispatch<React.SetStateAction<{ x: number; y: number }[]>>;
  setBrushRect: React.Dispatch<React.SetStateAction<{ x1: number; y1: number; x2: number; y2: number } | null>>;
  setScatterView: React.Dispatch<React.SetStateAction<{ scale: number; panX: number; panY: number }>>;
  setToast: (msg: string) => void;
  applyBrushSelection: (indices: number[]) => void;
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
    yScale?: YScaleKind;
    plot?: { left: number; top: number; right: number; bottom: number };
  } | null>;
  sampleRowsRef: MutableRefObject<{ rows: unknown[][]; columns: string[] } | null | undefined>;
  containerRef: RefObject<HTMLDivElement | null>;
  brushStartRef: MutableRefObject<{ x: number; y: number } | null>;
  brushRectRef: MutableRefObject<{ x1: number; y1: number; x2: number; y2: number } | null>;
  pointerDownAtRef: MutableRefObject<PressStart | null>;
  lastPointerTypeRef: MutableRefObject<string>;
  getEffectiveScatterBounds: (
    sd: { xMin: number; xMax: number; yMin: number; yMax: number },
    view: { scale: number; panX: number; panY: number },
  ) => { xMin: number; xMax: number; yMin: number; yMax: number };
  scatterHitForRow: (rowIndex: number) => HitTarget | null;
};

export type UseScatterInteractionsResult = {
  overlayRef: RefObject<HTMLDivElement | null>;
  isPanning: boolean;
  setIsPanning: React.Dispatch<React.SetStateAction<boolean>>;
  panStartRef: MutableRefObject<{ x: number; y: number } | null>;
  pinchRef: MutableRefObject<{ dist: number; scale: number; midX: number; midY: number } | null>;
  touchDistance: (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) => number;
  applyPinchZoom: (clientX: number, clientY: number, newScale: number, baseScale: number) => void;
  wasDrag: (e: React.MouseEvent) => boolean;
  handleScatterPointer: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleScatterPointerLeave: () => void;
  handleScatterMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleScatterMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleScatterMouseUp: () => void;
};

/** Pointer, wheel, and touch handlers for WebGPU/Canvas scatter overlay. */
export function useScatterInteractions(args: UseScatterInteractionsArgs): UseScatterInteractionsResult {
  const {
    activeChart,
    chartInteractionMode,
    tooltipPresentation,
    stickyTooltip,
    lassoPoints,
    crosshairPos,
    rulerPins,
    scatterView,
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
  } = args;

  const overlayRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number } | null>(null);

  const touchDistance = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const wasDrag = (e: React.MouseEvent) => {
    const start = pointerDownAtRef.current;
    pointerDownAtRef.current = null;
    return pressWasDrag(start, e.clientX, e.clientY);
  };

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
    [activeChart, setHoveredRowIndex, tooltipPresentation, stickyTooltip, scatterHitForRow, scatterDataRef, sampleRowsRef, setScatterTooltip, setHoverMark],
  );

  const handleScatterPointerLeave = useCallback(() => {
    if (stickyTooltip) return;
    setScatterTooltip(null);
    setHoverMark(null);
    setHoveredRowIndex(null);
  }, [setHoveredRowIndex, stickyTooltip, setScatterTooltip, setHoverMark]);

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
    [getEffectiveScatterBounds, scatterDataRef, setScatterView],
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

      const looksLikeMouseWheel =
        e.deltaMode === 1 || (e.deltaMode === 0 && Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1);
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
    [activeChart, getEffectiveScatterBounds, scatterDataRef, setScatterView],
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
      pointerDownAtRef.current = { x: e.clientX, y: e.clientY, brush: e.shiftKey || chartInteractionMode !== "pan" };
      if (chartInteractionMode === "lasso" || chartInteractionMode === "select" || e.shiftKey) {
        brushStartRef.current = { x: e.clientX, y: e.clientY };
        if (chartInteractionMode === "lasso") {
          setLassoPoints([{ x: e.clientX, y: e.clientY }]);
        } else {
          setBrushRect({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
        }
      } else if (chartInteractionMode === "crosshair") {
        if (crosshairPos) {
          setRulerPins([...rulerPins, { x: crosshairPos.dataX, y: crosshairPos.dataY }].slice(-2));
        }
      } else {
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setIsPanning(true);
      }
    },
    [activeChart, chartInteractionMode, crosshairPos, rulerPins, setRulerPins, setLassoPoints, setBrushRect, brushStartRef, pointerDownAtRef],
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
    [
      handleScatterPointer,
      chartInteractionMode,
      lassoPoints,
      setLassoPoints,
      setCrosshairPos,
      setBrushRect,
      brushStartRef,
      containerRef,
      scatterDataRef,
      setScatterView,
    ],
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
        setToast(sel.length > 0 ? `${sel.length} point(s) selected` : "No points in brush");
      }
      brushStartRef.current = null;
      setBrushRect(null);
    }
    panStartRef.current = null;
  }, [
    applyBrushSelection,
    setToast,
    chartInteractionMode,
    lassoPoints,
    setLassoPoints,
    setBrushRect,
    brushStartRef,
    brushRectRef,
    containerRef,
    scatterDataRef,
  ]);

  return {
    overlayRef,
    isPanning,
    setIsPanning,
    panStartRef,
    pinchRef,
    touchDistance,
    applyPinchZoom,
    wasDrag,
    handleScatterPointer,
    handleScatterPointerLeave,
    handleScatterMouseDown,
    handleScatterMouseMove,
    handleScatterMouseUp,
  };
}
