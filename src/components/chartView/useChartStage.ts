// Stage host sizing, frame fit, and canvas ResizeObservers (LOOM-141).
import { useEffect, useMemo } from "react";
import type { RefObject } from "react";
import { arrangedFrameSize } from "@/lib/canvasArrangement";
import { fitChartFrame, type ChartAspectId, type DetectedDevice } from "@/lib/chartViewport";
import { chartStageGutter } from "@/lib/chartSpace";
import { resolveStageBoxSize } from "@/lib/chartStagePixels";
import { useLoomStore } from "@/lib/store";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";
import { stageDpr } from "./constants";

export type ChartFrameSize = { width: number; height: number; aspectLocked: boolean };

export type UseChartStageArgs = {
  selectedFile: { path: string } | null;
  suggestionsExpanded: boolean;
  socialExportTarget: { width: number; height: number; presetId?: string } | null;
  isMobile: boolean;
  chartAspect: ChartAspectId;
  chartDevice: DetectedDevice | "auto";
  chartVisualOverrides: ChartVisualOverrides;
  hostSize: { w: number; h: number };
  setHostSize: React.Dispatch<React.SetStateAction<{ w: number; h: number }>>;
  containerSize: { w: number; h: number };
  setContainerSize: React.Dispatch<React.SetStateAction<{ w: number; h: number }>>;
  canvasSized: boolean;
  setCanvasSized: React.Dispatch<React.SetStateAction<boolean>>;
  stageHostRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  axesOverlayRef: RefObject<HTMLCanvasElement | null>;
  focusLayerRef: RefObject<HTMLCanvasElement | null>;
};

export type UseChartStageResult = {
  chartFrameMax: ChartFrameSize;
  chartFrameSize: ChartFrameSize;
  stageMounted: boolean;
};

/** Measure stage host, fit social/device frames, sync canvas buffer sizes. */
export function useChartStage(args: UseChartStageArgs): UseChartStageResult {
  const {
    selectedFile,
    suggestionsExpanded,
    socialExportTarget,
    isMobile,
    chartAspect,
    chartDevice,
    chartVisualOverrides,
    hostSize,
    setHostSize,
    setContainerSize,
    setCanvasSized,
    stageHostRef,
    containerRef,
    canvasRef,
    canvas2DRef,
    axesOverlayRef,
    focusLayerRef,
  } = args;

  const stageMounted = !!selectedFile;

  const chartFrameMax = useMemo((): ChartFrameSize => {
    if (socialExportTarget) {
      return {
        width: socialExportTarget.width,
        height: socialExportTarget.height,
        aspectLocked: true,
      };
    }
    const railReserve = !isMobile ? 48 : 0;
    return fitChartFrame({
      hostW: Math.max(40, hostSize.w - railReserve),
      hostH: hostSize.h,
      aspectId: chartAspect,
      device: chartDevice,
      gutter: chartStageGutter(chartVisualOverrides.spaceUse),
    });
  }, [hostSize.w, hostSize.h, chartAspect, chartDevice, socialExportTarget, isMobile, chartVisualOverrides.spaceUse]);

  const chartFrameSize = useMemo((): ChartFrameSize => {
    if (socialExportTarget) return chartFrameMax;
    return arrangedFrameSize(chartFrameMax, chartVisualOverrides);
  }, [chartFrameMax, chartVisualOverrides.canvasWidth, chartVisualOverrides.canvasHeight, socialExportTarget]);

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
  }, [suggestionsExpanded, stageMounted, setHostSize, stageHostRef]);

  useEffect(() => {
    if (suggestionsExpanded) return;
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
  }, [
    suggestionsExpanded,
    chartFrameSize.width,
    chartFrameSize.height,
    socialExportTarget,
    stageMounted,
    containerRef,
    canvasRef,
    canvas2DRef,
    axesOverlayRef,
    focusLayerRef,
  ]);

  return { chartFrameMax, chartFrameSize, stageMounted };
}
