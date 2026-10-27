// ChartRenderOpts memo from visual overrides + active chart (LOOM-141).
// @ts-nocheck
import { useMemo } from "react";
import { chartSpacePadding } from "@/lib/chartSpace";
import { chartCapabilities, defaultYAggregate, type YAggregateOption } from "@/lib/chartSupport";
import { resolveChartAxisFontSize } from "@/lib/chartType";
import { ensureContrast } from "@/lib/wcagColor";
import type { ChartRenderOpts } from "@/lib/chartRenderTypes";
import type { ChartVisualOverrides } from "@/lib/chartVisualTypes";

export type UseChartRenderOptsArgs = {
  chartVisualOverrides: ChartVisualOverrides;
  containerWidth: number;
  isCompact: boolean;
  colors: string[];
  continuousStops: string[];
  opacity: number;
  pointSize: number;
  chartFontFamily: string;
  themeUi: { bg: string; text: string; label: string; border: string };
  activeChart: Record<string, unknown> | null;
  barStackMode: string | undefined;
  chartFootnoteText: string | null;
  chartColorInfo: { stops?: unknown[] } | null;
};

export function useChartRenderOpts(args: UseChartRenderOptsArgs): ChartRenderOpts {
  const {
    chartVisualOverrides,
    containerWidth,
    isCompact,
    colors,
    continuousStops,
    opacity,
    pointSize,
    chartFontFamily,
    themeUi,
    activeChart,
    barStackMode,
    chartFootnoteText,
    chartColorInfo,
  } = args;
    return useMemo((): ChartRenderOpts => {
    const frame = chartVisualOverrides.chartFrame ?? "focus";
    const framePad = chartSpacePadding(chartVisualOverrides.spaceUse, containerWidth, chartVisualOverrides.chartPadding, frame);
    const axisStyle = chartVisualOverrides.axisStyle ?? "rule";
    const axisFromStyle =
      axisStyle === "ladder"
        ? { axisLineWidth: 2, gridStyle: "solid" as const, gridOpacity: 0.7 }
        : axisStyle === "mercury"
          ? { axisLineWidth: 3, gridStyle: "none" as const, gridOpacity: 0 }
          : axisStyle === "spine"
            ? { axisLineWidth: 1.5, gridStyle: "dashed" as const, gridOpacity: 0.35 }
            : axisStyle === "index"
              ? { axisLineWidth: 1, gridStyle: "dotted" as const, gridOpacity: 0.45 }
              : axisStyle === "tape"
                ? { axisLineWidth: 1, gridStyle: "solid" as const, gridOpacity: 0.25 }
                : {};
    const motif = chartVisualOverrides.markMotif ?? "dots";
    const motifShape =
      chartVisualOverrides.markShape ??
      (motif === "squares" ? "square" : motif === "ring" ? "ring" : motif === "ticks" ? "cross" : "circle");
    const detail = chartVisualOverrides.chartDetail ?? "viz";
    const showDataLabels =
      chartVisualOverrides.showDataLabels ?? (detail === "deep");
    const caps = activeChart ? chartCapabilities(activeChart.kind) : null;
    const showGrid =
      !caps?.cartesian || (isCompact && chartVisualOverrides.showGrid == null)
        ? false
        : chartVisualOverrides.showGrid !== false &&
          (chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid") !== "none" &&
          (chartVisualOverrides.showGrid === true || detail !== "plain");

    const blendMode = chartVisualOverrides.blendMode ?? "source-over";

    return {
      titleX: chartVisualOverrides.titleX,
      titleY: chartVisualOverrides.titleY,
      titleWidth: chartVisualOverrides.titleWidth,
      titleScale: chartVisualOverrides.titleScale,
      colors,
      continuousStops,
      opacity,
      opacityUserSet: typeof chartVisualOverrides.opacity === "number",
      pointSize: isCompact ? Math.max(4, pointSize * 0.7) : pointSize,
      fontFamily: chartFontFamily,
      titleFontWeight: chartVisualOverrides.titleFontWeight ?? 600,
      titleItalic: chartVisualOverrides.titleItalic ?? false,
      tickRotation: chartVisualOverrides.tickRotation ?? 0,
      axisFontSize: resolveChartAxisFontSize(chartVisualOverrides.axisFontSize, isCompact),
      markShape: motifShape,
      markerMode: chartVisualOverrides.markerMode ?? "shape",
      markEmoji: chartVisualOverrides.markEmoji ?? "😀",
      shapeField: activeChart?.shapeField ?? null,
      emojiField: activeChart?.emojiField ?? null,
      emojiMap: activeChart?.emojiMap,
      markMaterial: chartVisualOverrides.markMaterial,
      markStroke: chartVisualOverrides.markStroke ?? motif === "ring",
      markStrokeWidth: chartVisualOverrides.markStrokeWidth ?? 1,
      markStrokeColor: chartVisualOverrides.markStrokeColor ?? "auto",
      markJitter: chartVisualOverrides.markJitter ?? 0,
      sizeScale: chartVisualOverrides.sizeScale ?? 1,
      barCornerRadius: chartVisualOverrides.barCornerRadius ?? (motif === "bar" ? 0 : 3),
      lineStrokeStyle: chartVisualOverrides.lineStrokeStyle ?? "solid",
      lineCap: chartVisualOverrides.lineCap,
      lineJoin: chartVisualOverrides.lineJoin,
      lineCurveSmooth: chartVisualOverrides.lineCurveSmooth ?? false,
      lineWidth: chartVisualOverrides.lineWidth ?? (motif === "ticks" ? 1 : 1.5),
      axisLineColor: chartVisualOverrides.axisLineColor ?? themeUi.border,
      axisLineWidth: chartVisualOverrides.axisLineWidth ?? axisFromStyle.axisLineWidth ?? 1,
      gridStyle: chartVisualOverrides.gridStyle ?? axisFromStyle.gridStyle ?? "solid",
      gridOpacity: chartVisualOverrides.gridOpacity ?? axisFromStyle.gridOpacity ?? 0.5,
      tickCount: chartVisualOverrides.tickCount ?? 5,
      axisLabelColor: ensureContrast(chartVisualOverrides.axisLabelColor ?? themeUi.label, themeUi.bg),
      showGrid,
      chartPadding: framePad,
      spaceUse: chartVisualOverrides.spaceUse ?? "auto",
      // "auto" shows a key only when a color field is encoded, in the emptiest corner
      legendOffsetX: chartVisualOverrides.legendOffsetX,
      legendOffsetY: chartVisualOverrides.legendOffsetY,
      legendWidth: chartVisualOverrides.legendWidth,
      legendHeight: chartVisualOverrides.legendHeight,
      plotX: chartVisualOverrides.plotX, plotY: chartVisualOverrides.plotY, plotWidth: chartVisualOverrides.plotWidth, plotHeight: chartVisualOverrides.plotHeight,
      legendPosition: !caps?.legend ? "none" : (chartVisualOverrides.legendPosition ?? "auto"),
      showDataLabels,
      backgroundStyle: chartVisualOverrides.backgroundStyle ?? "default",
      blendMode,
      glowEnabled: caps?.markPoints ? (chartVisualOverrides.glowEnabled ?? false) : false,
      glowIntensity: chartVisualOverrides.glowIntensity ?? 8,
      chartDetail: detail,
      markMotif: motif,
      axisStyle,
      emphasisStyle: chartVisualOverrides.emphasisStyle ?? "tint",
      ghostEnabled: chartVisualOverrides.ghostEnabled ?? false,
      ghostWeight: chartVisualOverrides.ghostWeight ?? "soft",
      ghostPlace: chartVisualOverrides.ghostPlace ?? "se",
      titleLayout: chartVisualOverrides.titleLayout ?? "pair",
      chartFrame: frame,
      sourceFootnote: Boolean(chartFootnoteText || chartColorInfo?.stops?.length),
      sourceFootnoteAlign: chartVisualOverrides.sourceFootnoteAlign ?? "left",
      chromeInfoBand: chartVisualOverrides.chromeInfoBand ?? "footer",
      themeBg: themeUi.bg,
      themeText: themeUi.text,
      themeMuted: themeUi.label,
      themeBorder: themeUi.border,
      yAggregate: (() => {
        if (!activeChart) return undefined;
        if (!activeChart.yField) return "count" as YAggregateOption;
        return activeChart.yAggregate ?? defaultYAggregate(activeChart.kind);
      })(),
      barStackMode: activeChart?.kind === "bar" ? barStackMode : undefined,
      topN: activeChart?.topN ?? undefined,
      y2Field: activeChart?.y2Field ?? undefined,
      comparePrevious: activeChart?.comparePrevious ?? undefined,
      rollingWindow: activeChart?.rollingWindow ?? undefined,
      yScale: activeChart?.yScale ?? undefined,
      seriesNormalize: activeChart?.seriesNormalize ?? undefined,
      residualOverlay: activeChart?.residualOverlay ?? undefined,
      anomalyHighlight: activeChart?.anomalyHighlight ?? undefined,
      bumpMode: activeChart?.bumpMode ?? undefined,
      wordCloudMode: activeChart?.wordCloudMode ?? undefined,
      wordCloudFont: chartVisualOverrides.wordCloudFont,
      wordCloudArrange: chartVisualOverrides.wordCloudArrange,
      wordCloudScale: chartVisualOverrides.wordCloudScale,
      wordCloudWeight: chartVisualOverrides.wordCloudWeight,
      pyramidScaleMode: activeChart?.pyramidScaleMode ?? undefined,
      deltaDisplay: activeChart?.deltaDisplay ?? undefined,
      layoutDirection: activeChart?.layoutDirection ?? undefined,
      channelInvert: activeChart?.channelInvert ?? undefined,
    };
  }, [colors, continuousStops, opacity, pointSize, chartVisualOverrides, chartFontFamily, themeUi, isCompact, containerWidth, activeChart, barStackMode, chartFootnoteText, chartColorInfo]);
}

