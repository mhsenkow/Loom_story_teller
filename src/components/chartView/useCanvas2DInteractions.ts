// Canvas 2D mark hover, keyboard focus, pins, and tooltip picking (LOOM-141).
// @ts-nocheck — LOOM-141: ChartViewRuntime bag until typed
import { useCallback, useEffect, useMemo, type MutableRefObject, type RefObject } from "react";
import type React from "react";
import { stageDpr } from "./constants";
import { chartFontStack } from "@/lib/fontCatalog";
import { keyboardNavigableHits, nextMarkIndex } from "@/lib/chartMarkKeyboard";
import {
  calloutLines,
  drawMarkFocus,
  drawPinnedCallout,
  findHitForMark,
  markFocusStyle,
  markRefForHit,
  markRefForRow,
  sameMark,
  type CalloutBox,
  type MarkRef,
} from "@/lib/markFocus";
import { scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { scatterYDomain } from "@/lib/canvasCharts/shared";
import {
  allowedRowIndices,
  type Canvas2DHitContext,
  type HitTarget,
  mergeChartTooltip,
  pickCanvasTooltipRowIndex,
  pickHitTarget,
  resolveTooltipFieldNames,
  rowForHitTarget,
} from "@/lib/chartTooltip";
import {
  chromeSectionFor,
  pickChartChromeRegion,
  type ChartChromeTarget,
} from "@/lib/chartChromeLink";
import { cubeCellTooltip, dataCubeChartView, pickDataCubeCell, type DataCube, type DataCubeRenderOpts } from "@/lib/dataCube";
import type { CubeHoverCell } from "@/components/DataCubePivot";
import { useLoomStore } from "@/lib/store";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";

export type ChartTooltipState = {
  clientX: number;
  clientY: number;
  rowIndex: number;
  row: (string | number | boolean | null)[];
  columns: string[];
} | null;

export type UseCanvas2DInteractionsArgs = {
  activeChart: {
    id: string;
    kind: string;
    xField?: string;
    yField?: string;
    colorField?: string | null;
    sizeField?: string | null;
    tooltipKeyField?: string | null;
  } | null;
  markIdentity: string[];
  pointSize: number;
  tooltipPresentation: string;
  stickyTooltip: boolean;
  canvasSized: boolean;
  pinnedTooltips: {
    chartId: string;
    ref: MarkRef;
    rowIndex: number;
    row: (string | number | boolean | null)[];
    columns: string[];
  }[];
  togglePinnedTooltip: (args: {
    chartId: string;
    ref: MarkRef;
    rowIndex: number;
    row: (string | number | boolean | null)[];
    columns: string[];
  }) => void;
  hoverMark: HitTarget | null;
  setHoverMark: React.Dispatch<React.SetStateAction<HitTarget | null>>;
  setChartTooltip: React.Dispatch<React.SetStateAction<ChartTooltipState>>;
  setScatterTooltip?: React.Dispatch<React.SetStateAction<ChartTooltipState>>;
  setHoveredRowIndex: (index: number | null) => void;
  setCubeHover: React.Dispatch<React.SetStateAction<CubeHoverCell | null>>;
  setChartChromeFocus: (focus: { section: string; target: ChartChromeTarget; source: "chart" }) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelTab: (tab: string) => void;
  setChartPanelSection: (section: string) => void;
  chromeHover: ChartChromeTarget | null;
  setChromeHover: React.Dispatch<React.SetStateAction<ChartChromeTarget | null>>;
  chartChromeFocus: { target?: ChartChromeTarget } | null;
  keyboardMarkIndex: number;
  setKeyboardMarkIndex: React.Dispatch<React.SetStateAction<number>>;
  chartTooltip: ChartTooltipState;
  setMarkAnnouncement: React.Dispatch<React.SetStateAction<string>>;
  announceKeyStepRef: MutableRefObject<boolean>;
  hitsVersion: number;
  refreshKey: number;
  containerSize: { w: number; h: number };
  themeUi: { accent: string; bg: string; text: string; label: string; border: string };
  chartFontFamily: string;
  chartRenderOpts: ChartRenderOpts;
  containerRef: RefObject<HTMLDivElement | null>;
  canvas2DHitRef: MutableRefObject<Canvas2DHitContext | null>;
  scatterDataRef: MutableRefObject<{
    rowIndices: number[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    pad: number;
    w: number;
    h: number;
    points: { x: number; y: number }[];
    yScale?: YScaleKind;
    plot?: { left: number; top: number; right: number; bottom: number };
  } | null>;
  sampleRowsRef: MutableRefObject<{ rows: unknown[][]; columns: string[] } | null | undefined>;
  focusLayerRef: RefObject<HTMLCanvasElement | null>;
  pinnedBoxesRef: MutableRefObject<CalloutBox[]>;
  cubeFrameRef: MutableRefObject<{
    cube: DataCube;
    opts: DataCubeRenderOpts;
    w: number;
    h: number;
  } | null>;
  sceneOrbitDragRef: MutableRefObject<{ x: number; y: number; yaw: number; pitch: number } | null>;
};

export function buildScatterHitForRow(
  data: UseCanvas2DInteractionsArgs["scatterDataRef"]["current"],
  rowIndex: number,
  pointSize: number,
): HitTarget | null {
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
}

export function useCanvas2DInteractions(args: UseCanvas2DInteractionsArgs) {
  const {
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
  } = args;

  const resolveMarkHit = useCallback(
    (ref: MarkRef): HitTarget | null => {
      if (!activeChart) return null;
      if (activeChart.kind === "scatter") {
        const data = scatterDataRef.current;
        const st = useLoomStore.getState().sampleRows;
        if (!data || !st) return null;
        for (const ri of data.rowIndices) {
          if (sameMark(markRefForRow(ri, st.columns, st.rows, markIdentity), ref))
            return buildScatterHitForRow(data, ri, pointSize);
        }
        return null;
      }
      const sr = sampleRowsRef.current;
      const targets = canvas2DHitRef.current?.targets;
      return sr && targets?.length ? findHitForMark(targets, ref, sr.columns, sr.rows, markIdentity) : null;
    },
    [activeChart, markIdentity, pointSize, scatterDataRef, sampleRowsRef, canvas2DHitRef],
  );

  const pinMark = useCallback(
    (hit: HitTarget | null, tip: ChartTooltipState) => {
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
    [activeChart, markIdentity, togglePinnedTooltip, sampleRowsRef],
  );

  const hoverRef = useMemo(() => {
    if (!hoverMark || !activeChart) return null;
    if (activeChart.kind === "scatter") {
      const st = useLoomStore.getState().sampleRows;
      return st && hoverMark.rowIndex != null
        ? markRefForRow(hoverMark.rowIndex, st.columns, st.rows, markIdentity)
        : null;
    }
    const sr = sampleRowsRef.current;
    return sr ? markRefForHit(hoverMark, sr.columns, sr.rows, markIdentity) : null;
  }, [hoverMark, activeChart, markIdentity, sampleRowsRef]);

  const resolvedPins = useMemo(
    () =>
      activeChart
        ? pinnedTooltips.filter((t) => t.chartId === activeChart.id).map((p) => ({ p, hit: resolveMarkHit(p.ref) }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hitsVersion/refreshKey/size signal repaints of the ref-held hits
    [activeChart, pinnedTooltips, hitsVersion, refreshKey, containerSize.w, containerSize.h, resolveMarkHit],
  );

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
      const scaleYFactor = (hit.frameH ?? hit.h) / rect.height;
      const chartX = relX * scaleX;
      const chartY = relY * scaleYFactor;
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
      const target = hit.targets?.length ? pickHitTarget(hit.targets, chartX, chartY) : null;
      if (!target) {
        const chrome = pickChartChromeRegion(chartX, chartY, w, h, pad, hit.chromeLayout);
        if (chrome) {
          setChromeHover((prev) => (prev === chrome ? prev : chrome));
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
        ? target
          ? rowForHitTarget(target, sr.rows, allowed)
          : null
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
      setChartTooltip,
      setHoverMark,
      setCubeHover,
      setChromeHover,
      canvas2DHitRef,
      containerRef,
      cubeFrameRef,
      sceneOrbitDragRef,
      sampleRowsRef,
    ],
  );

  useEffect(() => {
    setHoverMark(null);
    setKeyboardMarkIndex(-1);
    setScatterTooltip?.(null);
    setChartTooltip(null);
    setHoveredRowIndex(null);
  }, [activeChart?.id, setHoveredRowIndex, setHoverMark, setKeyboardMarkIndex, setChartTooltip, setScatterTooltip]);

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
    const resolved = resolvedPins;
    for (const { hit } of resolved) if (hit) drawMarkFocus(ctx, hit, markFocusStyle(activeChart.kind, hit), ink, 1);
    if (
      hoverMark &&
      !resolved.some(
        (r) => r.hit === hoverMark || (r.hit && r.hit.rowIndex != null && r.hit.rowIndex === hoverMark.rowIndex && r.hit.shape === hoverMark.shape),
      )
    ) {
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
  }, [
    activeChart,
    canvasSized,
    pinnedTooltips,
    hoverMark,
    keyboardMarkIndex,
    hitsVersion,
    refreshKey,
    containerSize.w,
    containerSize.h,
    themeUi,
    chartFontFamily,
    chartRenderOpts.axisFontSize,
    resolvedPins,
    focusLayerRef,
    pinnedBoxesRef,
  ]);

  const handleMarkKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const hits = keyboardNavigableHits(canvas2DHitRef.current?.targets);
    const el = containerRef.current;
    const frame = canvas2DHitRef.current;
    if (!hits.length || !el || !frame) return;
    const focusAt = (i: number) => {
      announceKeyStepRef.current = true;
      setKeyboardMarkIndex(i);
      const t = hits[i]!;
      const rect = el.getBoundingClientRect();
      const a =
        t.shape === "rect"
          ? { x: t.x + t.w / 2, y: t.y + t.h / 2 }
          : t.shape === "circle"
            ? { x: t.cx, y: t.cy }
            : {
                x: t.cx + Math.cos((t.a0 + t.a1) / 2) * ((t.r0 + t.r1) / 2),
                y: t.cy + Math.sin((t.a0 + t.a1) / 2) * ((t.r0 + t.r1) / 2),
              };
      handleCanvas2DPointerMove(
        {
          clientX: rect.left + (a.x / frame.w) * rect.width,
          clientY: rect.top + (a.y / (frame.frameH ?? frame.h)) * rect.height,
        } as React.PointerEvent<HTMLDivElement>,
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
      const wasPinned = !!hoverRef && pinnedTooltips.some((t) => t.chartId === activeChart?.id && sameMark(t.ref, hoverRef));
      pinMark(hoverMark, chartTooltip);
      setMarkAnnouncement(wasPinned ? "Unpinned" : "Pinned");
    } else if (e.key === "Escape" && (keyboardMarkIndex >= 0 || hoverMark || chartTooltip)) {
      e.preventDefault();
      e.stopPropagation();
      setMarkAnnouncement("");
      setKeyboardMarkIndex(-1);
      setHoverMark(null);
      setChartTooltip(null);
      setHoveredRowIndex(null);
    }
  };

  useEffect(() => {
    if (!announceKeyStepRef.current) return;
    announceKeyStepRef.current = false;
    if (keyboardMarkIndex < 0 || !chartTooltip) return;
    const n = keyboardNavigableHits(canvas2DHitRef.current?.targets).length;
    setMarkAnnouncement(
      `Mark ${keyboardMarkIndex + 1} of ${n}: ${chartTooltip.columns.map((c, j) => `${c} ${chartTooltip.row[j] ?? ""}`).join(", ")}`,
    );
  }, [keyboardMarkIndex, chartTooltip, announceKeyStepRef, canvas2DHitRef, setMarkAnnouncement]);

  const handleCanvas2DPointerLeave = useCallback(() => {
    if (!stickyTooltip) {
      setChartTooltip(null);
      setHoverMark(null);
      setCubeHover(null);
      setHoveredRowIndex(null);
    }
    setChromeHover(null);
  }, [setHoveredRowIndex, stickyTooltip, setChartTooltip, setHoverMark, setCubeHover, setChromeHover]);

  return {
    pinMark,
    hoverRef,
    handleCanvas2DPointerMove,
    handleCanvas2DPointerLeave,
    handleMarkKeyDown,
  };
}
