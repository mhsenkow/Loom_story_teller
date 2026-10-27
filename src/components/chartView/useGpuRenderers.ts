// WebGPU renderer lifecycle, geo atlas, and scatter upload/pan passes (LOOM-141).
import { useEffect, useMemo } from "react";
import type { MutableRefObject, RefObject } from "react";
import { DEFAULT_PAD } from "@/lib/canvasCharts/shared";
import { densityAwarePointMarks, subsampleRowsForDensity } from "@/lib/chartLayout";
import { resolveGpuScatterPads } from "@/lib/chartPlotRect";
import { hexToRgb01 } from "@/lib/chartPalettes";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";
import { scaleDomain, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { type AtlasBundle, type AtlasKind, loadAtlas, pickAtlasKind } from "@/lib/geoAtlas";
import { isGeoFamilyKind } from "@/lib/geoMaps";
import { notifyChartPainted } from "@/lib/chartPaintSignal";
import { densityPointBudget } from "@/lib/chartStagePixels";
import type { GPUScatterPoint } from "@/lib/webgpu";
import { isWebGpuDrawableScene } from "@/lib/gpuScenes";
import { acquireSharedGpuDevice } from "@/lib/gpuDevice";
import type { GpuCubeRenderer, GpuScatterRenderer, GpuSceneRenderer } from "./chartStageRefs";
import { stageDpr } from "./constants";

export type GpuScatterPack = {
  sd: { points: GPUScatterPoint[]; rowIndices: number[]; xMin: number; xMax: number; yMin: number; yMax: number };
  subPts: { rows: GPUScatterPoint[] };
  subIdx: { rows: number[] };
  gpuPts: GPUScatterPoint[];
  yMin: number;
  yMax: number;
  yScaleKind: YScaleKind;
};

export type UseGpuRenderersArgs = {
  activeChart: {
    id: string;
    kind: string;
    xField?: string;
    sizeField?: string | null;
    yScale?: string;
  } | null;
  sampleRows: { rows: unknown[][]; columns: string[] } | null | undefined;
  chartVisualOverrides: ChartVisualOverrides;
  canvasSized: boolean;
  useWebGPUScatter: boolean;
  isMobile: boolean;
  isCompact: boolean;
  scatterView: { scale: number; panX: number; panY: number };
  chartRenderOpts: ChartRenderOpts;
  colors: string[];
  themeUiBg: string;
  opacity: number;
  pointSize: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
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
  canvas2DHitRef: MutableRefObject<unknown>;
  gpuReady: boolean;
  setGpuReady: React.Dispatch<React.SetStateAction<boolean>>;
  setGeoAtlasBundle: React.Dispatch<React.SetStateAction<AtlasBundle | null>>;
  setHitsVersion: React.Dispatch<React.SetStateAction<number>>;
  extractScatterData: () => {
    points: GPUScatterPoint[];
    rowIndices: number[];
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  } | null;
  getEffectiveScatterBounds: (
    sd: { xMin: number; xMax: number; yMin: number; yMax: number },
    view: { scale: number; panX: number; panY: number },
  ) => { xMin: number; xMax: number; yMin: number; yMax: number };
  sampleColumns: string[] | undefined;
};

export type UseGpuRenderersResult = {
  gpuScatterPack: GpuScatterPack | null;
};

/** Init/destroy shared GPU renderers; load geo atlases; upload scatter buffers on data/zoom. */
export function useGpuRenderers(args: UseGpuRenderersArgs): UseGpuRenderersResult {
  const {
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
    themeUiBg,
    opacity,
    pointSize,
    canvasRef,
    canvas2DRef,
    rendererRef,
    sceneRendererRef,
    cubeRendererRef,
    scatterDataRef,
    canvas2DHitRef,
    setGpuReady,
    setGeoAtlasBundle,
    setHitsVersion,
    extractScatterData,
    getEffectiveScatterBounds,
    sampleColumns,
  } = args;

  const gpuScatterPack = useMemo((): GpuScatterPack | null => {
    if (!useWebGPUScatter || !activeChart) return null;
    const sd = extractScatterData();
    if (!sd) return null;
    const gpuBudget = densityPointBudget(isMobile) + (isMobile ? 0 : 1000);
    const subPts = subsampleRowsForDensity(sd.points, gpuBudget, scatterView.scale, sd.rowIndices);
    const subIdx = subsampleRowsForDensity(sd.rowIndices, gpuBudget, scatterView.scale);
    const yScaleKind = (activeChart.yScale ?? "linear") as YScaleKind;
    let yMin = sd.yMin;
    let yMax = sd.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(yMin, yMax, yScaleKind);
      yMin = d.min;
      yMax = d.max;
    }
    const gpuPts =
      yScaleKind === "linear"
        ? subPts.rows
        : subPts.rows.map((p) => ({
            ...p,
            y: scaleY(p.y, yMin, yMax, yScaleKind),
          }));
    return { sd, subPts, subIdx, gpuPts, yMin, yMax, yScaleKind };
  }, [useWebGPUScatter, activeChart, extractScatterData, scatterView.scale, isMobile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const kind = activeChart?.kind ?? "";
    const wantScene = isWebGpuDrawableScene(kind);
    const wantCube = kind === "dataCube";
    const wantScatter = kind === "scatter";

    setGpuReady(false);
    if (!wantCube && !wantScene && !wantScatter) return;
    if ((wantCube && cubeRendererRef.current) || (wantScene && sceneRendererRef.current) || (wantScatter && rendererRef.current)) {
      setGpuReady(true);
      return;
    }

    void (async () => {
      const lease = await acquireSharedGpuDevice();
      if (!lease) return;
      if (wantCube) {
        const { LoomCubeRenderer } = await import("@/lib/webgpuCube");
        const cubeRenderer = new LoomCubeRenderer();
        cubeRendererRef.current = cubeRenderer;
        const ok = await cubeRenderer.init(canvas, lease);
        if (!cancelled && ok) setGpuReady(true);
        else if (cubeRendererRef.current === cubeRenderer) cubeRendererRef.current = null;
        if (!ok) lease.release();
      } else if (wantScene) {
        const { LoomSceneRenderer } = await import("@/lib/webgpuScenes");
        const scene = new LoomSceneRenderer();
        sceneRendererRef.current = scene;
        const ok = await scene.init(canvas, lease);
        if (!cancelled && ok) setGpuReady(true);
        else if (sceneRendererRef.current === scene) sceneRendererRef.current = null;
        if (!ok) lease.release();
      } else if (wantScatter) {
        const { LoomRenderer } = await import("@/lib/webgpu");
        const renderer = new LoomRenderer();
        rendererRef.current = renderer;
        const ok = await renderer.init(canvas, lease);
        if (!cancelled && ok && !renderer.deviceLost) setGpuReady(true);
        else if (rendererRef.current === renderer) rendererRef.current = null;
        if (!ok) lease.release();
      } else {
        lease.release();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChart?.kind, canvasRef, cubeRendererRef, rendererRef, sceneRendererRef, setGpuReady]);

  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      sceneRendererRef.current?.destroy();
      cubeRendererRef.current?.destroy();
      rendererRef.current = null;
      sceneRendererRef.current = null;
      cubeRendererRef.current = null;
      setGpuReady(false);
    };
  }, [cubeRendererRef, rendererRef, sceneRendererRef, setGpuReady]);

  useEffect(() => {
    const kind = activeChart?.kind ?? "";
    if (!isGeoFamilyKind(kind)) {
      setGeoAtlasBundle(null);
      return;
    }
    const override = chartVisualOverrides.geoAtlas;
    const regionField = activeChart?.xField ?? "";
    const samples =
      sampleRows?.rows.slice(0, 40).map((r) => {
        const xi = sampleRows.columns.indexOf(regionField);
        return xi >= 0 ? r[xi] : null;
      }) ?? [];
    const atlasKind: AtlasKind =
      override && override !== "auto"
        ? override
        : kind === "choropleth"
          ? pickAtlasKind(regionField, samples)
          : "world";
    let cancelled = false;
    void loadAtlas(atlasKind).then((bundle) => {
      if (!cancelled) setGeoAtlasBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [activeChart?.kind, activeChart?.xField, sampleRows, chartVisualOverrides.geoAtlas, setGeoAtlasBundle]);

  useEffect(() => {
    if (!canvasSized || !useWebGPUScatter || !gpuScatterPack || !rendererRef.current || !activeChart) return;
    const canvas2D = canvas2DRef.current;
    if (canvas2D) {
      const ctx = canvas2D.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        const dpr = stageDpr();
        const w = canvas2D.width / dpr;
        const h = canvas2D.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = themeUiBg;
        ctx.fillRect(0, 0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    canvas2DHitRef.current = null;
    const canvas = canvasRef.current;
    const dpr = stageDpr();
    const w = canvas ? canvas.width / dpr : 800;
    const h = canvas ? canvas.height / dpr : 600;
    const plotInsets = resolveGpuScatterPads({
      kind: "scatter",
      cssWidth: w,
      cssHeight: h,
      basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
      dpr,
      titleLayout: chartRenderOpts.titleLayout,
      tickRotation: chartRenderOpts.tickRotation,
      chartFrame: chartRenderOpts.chartFrame,
      isCompact,
      legendPosition: chartRenderOpts.legendPosition,
      axisFontSize: chartRenderOpts.axisFontSize,
      sourceFootnote: chartRenderOpts.sourceFootnote,
    });
    const pad = plotInsets.padCss;
    const marks = densityAwarePointMarks({
      n: gpuScatterPack.subPts.rows.length,
      plotW: Math.max(1, w - 2 * pad),
      plotH: Math.max(1, h - 2 * pad),
      hasSizeEncoding: !!activeChart.sizeField,
      sizeScale: chartVisualOverrides.sizeScale ?? 1,
      pointSize,
      opacity,
      opacityUserSet: typeof chartVisualOverrides.opacity === "number",
    });
    rendererRef.current.uploadData(gpuScatterPack.gpuPts, {
      pointSize: marks.maxR * 2,
      opacity: marks.opacity,
      sizeScale: 1,
      palette: colors,
      clearColor: hexToRgb01(themeUiBg),
    });
  }, [
    canvasSized,
    useWebGPUScatter,
    gpuScatterPack,
    activeChart,
    chartRenderOpts,
    chartVisualOverrides.sizeScale,
    chartVisualOverrides.opacity,
    colors,
    themeUiBg,
    opacity,
    pointSize,
    isCompact,
    canvasRef,
    canvas2DRef,
    canvas2DHitRef,
    rendererRef,
  ]);

  useEffect(() => {
    if (!canvasSized || !useWebGPUScatter || !gpuScatterPack || !rendererRef.current || !activeChart) return;
    const canvas = canvasRef.current;
    const dpr = stageDpr();
    const w = canvas ? canvas.width / dpr : 800;
    const h = canvas ? canvas.height / dpr : 600;
    const plotInsets = resolveGpuScatterPads({
      kind: "scatter",
      cssWidth: w,
      cssHeight: h,
      basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
      dpr,
      titleLayout: chartRenderOpts.titleLayout,
      tickRotation: chartRenderOpts.tickRotation,
      chartFrame: chartRenderOpts.chartFrame,
      isCompact,
      legendPosition: chartRenderOpts.legendPosition,
      axisFontSize: chartRenderOpts.axisFontSize,
      sourceFootnote: chartRenderOpts.sourceFootnote,
    });
    const pad = plotInsets.padCss;
    const eff = getEffectiveScatterBounds(gpuScatterPack.sd, scatterView);
    const { yScaleKind, yMin, yMax } = gpuScatterPack;
    let renderYMin = eff.yMin;
    let renderYMax = eff.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(renderYMin, renderYMax, yScaleKind);
      renderYMin = d.min;
      renderYMax = d.max;
    }
    void rendererRef.current
      .render(
        eff.xMin,
        eff.xMax,
        yScaleKind === "linear" ? renderYMin : 0,
        yScaleKind === "linear" ? renderYMax : 1,
        plotInsets.padXDevice,
        plotInsets.padYDevice,
      )
      .then(() => notifyChartPainted());
    if (canvas) {
      scatterDataRef.current = {
        points: gpuScatterPack.subPts.rows,
        rowIndices: gpuScatterPack.subIdx.rows,
        ...eff,
        pad,
        w,
        h,
        columns: sampleColumns ?? [],
        yScale: yScaleKind,
      };
      setHitsVersion((v) => v + 1);
    }
  }, [
    canvasSized,
    useWebGPUScatter,
    gpuScatterPack,
    scatterView,
    activeChart,
    chartRenderOpts,
    getEffectiveScatterBounds,
    sampleColumns,
    isCompact,
    canvasRef,
    rendererRef,
    scatterDataRef,
    setHitsVersion,
  ]);

  return { gpuScatterPack };
}
