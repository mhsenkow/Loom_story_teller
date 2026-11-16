// Shared canvas / GPU ref bag for ChartView hooks (LOOM-141)
import type { MutableRefObject, RefObject } from "react";
import type { Canvas2DHitContext } from "@/lib/chartTooltip";
import type { DataCube, DataCubeRenderOpts } from "@/lib/dataCube";
import type { PressStart } from "@/lib/markFocus";
import type { YScaleKind } from "@/lib/dsTransforms";

export type GpuScatterRenderer = import("@/lib/webgpu").LoomRenderer;
export type GpuSceneRenderer = import("@/lib/webgpuScenes").LoomSceneRenderer;
export type GpuCubeRenderer = import("@/lib/webgpuCube").LoomCubeRenderer;

export type ChartStageRefs = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  axesOverlayRef: RefObject<HTMLCanvasElement | null>;
  focusLayerRef: RefObject<HTMLCanvasElement | null>;
  stageHostRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  rendererRef: MutableRefObject<GpuScatterRenderer | null>;
  sceneRendererRef: MutableRefObject<GpuSceneRenderer | null>;
  cubeRendererRef: MutableRefObject<GpuCubeRenderer | null>;
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
    columns: string[];
    yScale?: YScaleKind;
    plot?: { left: number; top: number; right: number; bottom: number };
  } | null>;
  canvas2DHitRef: MutableRefObject<Canvas2DHitContext | null>;
  cubeFrameRef: MutableRefObject<{
    cube: DataCube;
    opts: DataCubeRenderOpts;
    w: number;
    h: number;
    baseCamera: { yaw: number; pitch: number; zoom: number };
  } | null>;
  cubeTransitionRef: MutableRefObject<{
    cube: DataCube;
    from: Map<string, [number, number, number]>;
  } | null>;
  exportStateRef: MutableRefObject<Record<string, unknown>>;
  sampleRowsRef: MutableRefObject<{ rows: unknown[][]; columns: string[] } | null | undefined>;
  scatterTooltipRef: MutableRefObject<unknown>;
  chartTooltipRef: MutableRefObject<unknown>;
  brushStartRef: MutableRefObject<{ x: number; y: number } | null>;
  brushRectRef: MutableRefObject<{ x1: number; y1: number; x2: number; y2: number } | null>;
  panStartRef: MutableRefObject<{ x: number; y: number } | null>;
  pinchRef: MutableRefObject<{ dist: number; scale: number; midX: number; midY: number } | null>;
  pointerDownAtRef: MutableRefObject<PressStart | null>;
  sceneOrbitDragRef: MutableRefObject<{ x: number; y: number; yaw: number; pitch: number } | null>;
  scenePinchRef: MutableRefObject<{ dist: number; zoom: number } | null>;
  lastPointerTypeRef: MutableRefObject<string>;
  pinnedBoxesRef: MutableRefObject<import("@/lib/markFocus").CalloutBox[]>;
  suggestCycleRef: MutableRefObject<number>;
  prevChartSwapKeyRef: MutableRefObject<string | null>;
  chartSwapAnimsRef: MutableRefObject<Animation[]>;
  arrangePanelWasOpen: MutableRefObject<boolean>;
  prevCubeRef: MutableRefObject<DataCube | null>;
  announceKeyStepRef: MutableRefObject<boolean>;
};
