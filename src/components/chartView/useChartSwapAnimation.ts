// Chart-kind swap entrance on canvas layers (LOOM-141).
// @ts-nocheck — LOOM-141: ChartViewRuntime bag until typed
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { playChartSwap } from "@/lib/motion";

export type UseChartSwapAnimationArgs = {
  activeChart: { id: string; kind: string; xField?: string; yField?: string } | null;
  socialExportReady: boolean;
  arranging: boolean;
  reducedMotion: boolean;
  useWebGPUScatter: boolean;
  useWebGpuScene: boolean;
  useWebGpuGlobe: boolean;
  useWebGpuCube: boolean;
  axesOverlayRef: RefObject<HTMLCanvasElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  prevChartSwapKeyRef: React.MutableRefObject<string | null>;
  chartSwapAnimsRef: React.MutableRefObject<Animation[]>;
};

export function useChartSwapAnimation(args: UseChartSwapAnimationArgs) {
  const {
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
  } = args;

  const chartSwapKey = activeChart
    ? [activeChart.id, activeChart.kind, activeChart.xField, activeChart.yField].join("\u0001")
    : "";

  useEffect(() => {
    const prev = prevChartSwapKeyRef.current;
    prevChartSwapKeyRef.current = chartSwapKey;
    if (prev === null || !chartSwapKey || prev === chartSwapKey) return;
    if (socialExportReady || arranging) return;
    for (const a of chartSwapAnimsRef.current) a.cancel();
    const gpu = useWebGPUScatter || useWebGpuScene || useWebGpuGlobe || useWebGpuCube;
    chartSwapAnimsRef.current = playChartSwap(
      gpu ? [axesOverlayRef.current, canvasRef.current, canvas2DRef.current] : [canvas2DRef.current],
      reducedMotion,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replay only when the chart key changes
  }, [chartSwapKey]);
}

export function useChartSwapRefs() {
  return {
    prevChartSwapKeyRef: useRef<string | null>(null),
    chartSwapAnimsRef: useRef<Animation[]>([]),
  };
}
