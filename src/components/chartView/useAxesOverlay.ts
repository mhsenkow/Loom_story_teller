// Canvas 2D axes/title/legend overlay above WebGPU scatter and scenes (LOOM-141).
// @ts-nocheck — LOOM-141: ChartViewRuntime bag until typed
import { useEffect } from "react";
import type { MutableRefObject, RefObject } from "react";
import { groupChartChannels } from "@/lib/channelGroups";
import { drawAxisFieldLabels, drawAxisFrame, drawChartSourceFootnote, drawChartTitleBlock } from "@/lib/chartLooks";
import { FOOTNOTE_BAND_PX, resolveChartPad } from "@/lib/chartLayout";
import { buildCategoricalLegendEntries, drawLegend } from "@/lib/chartLegend";
import { getThemeUiColors } from "@/lib/chartPalettes";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import { drawAxisTicks, drawGridLines } from "@/lib/canvasCharts/primitives";
import { DEFAULT_PAD } from "@/lib/canvasCharts/shared";
import { plotOf } from "@/lib/canvasCharts/plumbing";
import { scaleDomain, scaleY, type YScaleKind } from "@/lib/dsTransforms";
import { drawFireflyChrome, extractGpuScenePoints, isWebGpuDrawableScene } from "@/lib/gpuScenes";
import { isWebGpuGlobeKind } from "@/lib/geoMaps";
import type { ScatterDataBounds } from "./extractScatterData";
import { getEffectiveScatterBounds } from "./extractScatterData";
import { stageDpr } from "./constants";

export type UseAxesOverlayArgs = {
  axesOverlayRef: RefObject<HTMLCanvasElement | null>;
  canvasSized: boolean;
  activeChart: {
    id: string;
    kind: string;
    title: string;
    subtitle?: string | null;
    xField?: string;
    yField?: string;
    colorField?: string | null;
    sizeField?: string | null;
    timeField?: string | null;
    yScale?: string;
  } | null;
  gpuReady: boolean;
  useWebGPUScatter: boolean;
  useWebGpuScene: boolean;
  useWebGpuGlobe: boolean;
  extractScatterData: () => ScatterDataBounds | null;
  scatterView: { scale: number; panX: number; panY: number };
  chartRenderOpts: ChartRenderOpts;
  refreshKey: number;
  effectiveTheme: string;
  isCompact: boolean;
  chartTitleOverrides: Record<string, string | null | undefined>;
  containerSize: { w: number; h: number };
  selectedFile: unknown;
  sampleRows: { rows: unknown[][]; columns: string[] } | null | undefined;
  chartSampleRows: { rows: unknown[][]; columns: string[] } | null | undefined;
  chartFootnoteText: string | null;
  chartColorInfo: { stops?: unknown[] } | null;
  footnoteOpts: (themeMuted?: string, themeBorder?: string) => Record<string, unknown>;
  fontEpoch: number;
  chartVisualOverrides: {
    chromeInfoBand?: string;
    legendOffsetX?: number;
    legendOffsetY?: number;
    legendWidth?: number;
    legendHeight?: number;
  };
};

export function useAxesOverlay(args: UseAxesOverlayArgs) {
  const {
    axesOverlayRef,
    canvasSized,
    activeChart,
    gpuReady,
    useWebGPUScatter,
    useWebGpuScene,
    useWebGpuGlobe,
    extractScatterData,
    scatterView,
    chartRenderOpts,
    refreshKey,
    effectiveTheme,
    isCompact,
    chartTitleOverrides,
    containerSize,
    selectedFile,
    sampleRows,
    chartSampleRows,
    chartFootnoteText,
    chartColorInfo,
    footnoteOpts,
    fontEpoch,
    chartVisualOverrides,
  } = args;

  useEffect(() => {
    const overlay = axesOverlayRef.current;
    if (!overlay) return;
    if (activeChart?.kind === "dataCube") return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    const dpr = stageDpr();
    const w = overlay.width / dpr;
    const h = overlay.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const paintFootnote = () => {
      if (!chartFootnoteText && !chartColorInfo?.stops?.length) return;
      const ui = getThemeUiColors(effectiveTheme);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawChartSourceFootnote(ctx, w, h, 24, chartFootnoteText ?? "", {
        ...footnoteOpts(ui.label, ui.border),
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    if (
      canvasSized &&
      activeChart &&
      ((useWebGpuScene && isWebGpuDrawableScene(activeChart.kind)) ||
        (useWebGpuGlobe && isWebGpuGlobeKind(activeChart.kind)))
    ) {
      const scenePad = resolveChartPad({
        kind: activeChart.kind,
        width: w,
        height: h,
        basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
        titleLayout: chartRenderOpts.titleLayout,
        tickRotation: chartRenderOpts.tickRotation,
        chartFrame: chartRenderOpts.chartFrame,
        isCompact,
        legendPosition: chartRenderOpts.legendPosition,
        axisFontSize: chartRenderOpts.axisFontSize,
        sourceFootnote: chartRenderOpts.sourceFootnote,
        chromeInfoBand: chartRenderOpts.chromeInfoBand,
      });
      const ui = getThemeUiColors(effectiveTheme);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (activeChart.kind === "firefly" && sampleRows) {
        const flyRows = chartSampleRows?.rows ?? sampleRows.rows;
        const flyCols = chartSampleRows?.columns ?? sampleRows.columns;
        const groupedFly = groupChartChannels(flyRows, flyCols, activeChart);
        const packed = extractGpuScenePoints(groupedFly.rows, groupedFly.columns, {
          xField: activeChart.xField,
          yField: activeChart.yField,
          colorField: groupedFly.colorField,
          sizeField: activeChart.sizeField,
          timeField: activeChart.timeField,
        });
        if (packed) {
          drawFireflyChrome(
            ctx,
            packed,
            w,
            h -
              ((chartFootnoteText || chartColorInfo?.stops?.length) &&
              (chartVisualOverrides.chromeInfoBand ?? "footer") === "footer"
                ? FOOTNOTE_BAND_PX
                : 0),
            scenePad,
            {
              ...chartRenderOpts,
              fontFamily: chartRenderOpts.fontFamily,
              axisFontSize: chartRenderOpts.axisFontSize,
              themeText: ui.text,
              themeMuted: ui.label,
              themeBorder: ui.border,
              themeBg: ui.bg,
            },
          );
        }
      }
      const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
      drawChartTitleBlock(ctx, w, h, scenePad, titleText, activeChart.subtitle, {
        titleX: chartRenderOpts.titleX,
        titleY: chartRenderOpts.titleY,
        titleWidth: chartRenderOpts.titleWidth,
        titleScale: chartRenderOpts.titleScale,
        titleLayout: chartRenderOpts.titleLayout,
        fontFamily: chartRenderOpts.fontFamily,
        titleFontWeight: chartRenderOpts.titleFontWeight,
        titleItalic: chartRenderOpts.titleItalic,
        themeText: ui.text,
        themeMuted: ui.label,
        themeBorder: ui.border,
        axisLabelColor: chartRenderOpts.axisLabelColor,
        axisFontSize: chartRenderOpts.axisFontSize,
      });
      paintFootnote();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    if (!canvasSized || !activeChart || activeChart.kind !== "scatter" || !gpuReady || !useWebGPUScatter) return;
    const sd = extractScatterData();
    if (!sd) return;
    const overlayPad = resolveChartPad({
      kind: "scatter",
      width: w,
      height: h,
      basePad: chartRenderOpts.chartPadding ?? DEFAULT_PAD,
      titleLayout: chartRenderOpts.titleLayout,
      tickRotation: chartRenderOpts.tickRotation,
      chartFrame: chartRenderOpts.chartFrame,
      isCompact,
      legendPosition: chartRenderOpts.legendPosition,
      axisFontSize: chartRenderOpts.axisFontSize,
      sourceFootnote: chartRenderOpts.sourceFootnote,
      chromeInfoBand: chartRenderOpts.chromeInfoBand,
    });
    const eff = getEffectiveScatterBounds(sd, scatterView);
    const yScaleKind = (activeChart.yScale ?? "linear") as YScaleKind;
    let yMin = eff.yMin;
    let yMax = eff.yMax;
    if (yScaleKind !== "linear") {
      const d = scaleDomain(yMin, yMax, yScaleKind);
      yMin = d.min;
      yMax = d.max;
    }
    const ui = getThemeUiColors(effectiveTheme);
    const overlayOpts: ChartRenderOpts = {
      ...chartRenderOpts,
      chartPadding: overlayPad,
      themeBg: ui.bg,
      themeText: ui.text,
      themeMuted: ui.label,
      themeBorder: ui.border,
      yScale: yScaleKind === "linear" ? undefined : yScaleKind,
    };
    const toSX = (v: number) =>
      overlayPad + ((v - eff.xMin) / (eff.xMax - eff.xMin || 1)) * (w - 2 * overlayPad);
    const toSY = (v: number) => {
      if (yScaleKind !== "linear") {
        return h - overlayPad - scaleY(v, yMin, yMax, yScaleKind) * (h - 2 * overlayPad);
      }
      return h - overlayPad - ((v - yMin) / (yMax - yMin || 1)) * (h - 2 * overlayPad);
    };
    overlayOpts.scales = { x: toSX, y: toSY, valueAxis: "y", rect: plotOf(w, h, overlayPad) };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAxisFrame(ctx, w, h, overlayPad, overlayOpts);
    drawAxisFieldLabels(ctx, w, h, overlayPad, activeChart.xField, activeChart.yField, overlayOpts);
    const titleText = chartTitleOverrides[activeChart.id] ?? activeChart.title;
    drawChartTitleBlock(ctx, w, h, overlayPad, titleText, activeChart.subtitle, {
      titleX: overlayOpts.titleX,
      titleY: overlayOpts.titleY,
      titleWidth: overlayOpts.titleWidth,
      titleScale: overlayOpts.titleScale,
      titleLayout: overlayOpts.titleLayout,
      fontFamily: overlayOpts.fontFamily,
      titleFontWeight: overlayOpts.titleFontWeight,
      titleItalic: overlayOpts.titleItalic,
      themeText: ui.text,
      themeMuted: ui.label,
      themeBorder: ui.border,
      axisLabelColor: overlayOpts.axisLabelColor,
      axisFontSize: overlayOpts.axisFontSize,
    });
    if (chartFootnoteText || chartColorInfo?.stops?.length) {
      drawChartSourceFootnote(ctx, w, h, overlayPad, chartFootnoteText ?? "", {
        ...footnoteOpts(ui.label, ui.border),
        fontFamily: overlayOpts.fontFamily,
      });
    }
    if (overlayOpts.showGrid) {
      drawGridLines(ctx, eff.xMin, eff.xMax, yMin, yMax, w, h, overlayPad, overlayOpts);
    }
    drawAxisTicks(ctx, eff.xMin, eff.xMax, yMin, yMax, w, h, overlayPad, overlayOpts);
    const legendRows = chartSampleRows?.rows ?? sampleRows?.rows ?? [];
    const legendCols = chartSampleRows?.columns ?? sampleRows?.columns ?? [];
    const groupedLegend = groupChartChannels(legendRows, legendCols, activeChart);
    const cIdx = groupedLegend.colorField ? groupedLegend.columns.indexOf(groupedLegend.colorField) : -1;
    const legendEntries = buildCategoricalLegendEntries(groupedLegend.rows, cIdx, chartRenderOpts.colors);
    const legendPos = chartRenderOpts.legendPosition ?? "auto";
    if (legendPos !== "none" && legendEntries && legendEntries.length > 1) {
      drawLegend(
        ctx,
        legendEntries,
        legendPos,
        w,
        h,
        overlayPad,
        overlayOpts.fontFamily ?? "Inter",
        ui.bg,
        ui.border,
        ui.text,
        activeChart.colorField ?? undefined,
        [],
        {
          x: chartVisualOverrides.legendOffsetX,
          y: chartVisualOverrides.legendOffsetY,
          width: chartVisualOverrides.legendWidth,
          height: chartVisualOverrides.legendHeight,
        },
        overlayOpts.axisFontSize,
      );
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [
    canvasSized,
    activeChart,
    gpuReady,
    useWebGPUScatter,
    useWebGpuScene,
    useWebGpuGlobe,
    extractScatterData,
    scatterView,
    chartRenderOpts,
    refreshKey,
    effectiveTheme,
    isCompact,
    chartTitleOverrides,
    containerSize.w,
    containerSize.h,
    selectedFile,
    sampleRows,
    chartSampleRows,
    chartFootnoteText,
    chartColorInfo,
    footnoteOpts,
    fontEpoch,
    chartVisualOverrides,
    axesOverlayRef,
  ]);
}
