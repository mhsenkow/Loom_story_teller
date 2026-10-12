// =================================================================
// chartSmartOverlayStyle — themed smart overlay colours (LOOM-351)
// =================================================================

import { VIZ_SEMANTIC, type ThemeUiColors } from "./chartPalettes";

export type SmartOverlayPalette = {
  anomaly: string;
  trend: string;
  forecast: string;
  forecastFill: string;
  refMean: string;
  refMedian: string;
  refQ1: string;
  refQ3: string;
  refFallback: string;
};

export type SmartOverlayLegendItem = {
  id: string;
  label: string;
  dash: number[];
  color: string;
};

export function smartOverlayPalette(theme: ThemeUiColors, colorblind: boolean): SmartOverlayPalette {
  const accent = theme.accent ?? "#6a5ce0";
  const warn = VIZ_SEMANTIC.warning;
  const success = VIZ_SEMANTIC.positive;
  const danger = VIZ_SEMANTIC.negative;
  const muted = theme.muted ?? "#8a8a96";
  if (colorblind) {
    return {
      anomaly: danger,
      trend: accent,
      forecast: warn,
      forecastFill: warn,
      refMean: accent,
      refMedian: success,
      refQ1: muted,
      refQ3: warn,
      refFallback: muted,
    };
  }
  return {
    anomaly: danger,
    trend: success,
    forecast: warn,
    forecastFill: warn,
    refMean: success,
    refMedian: accent,
    refQ1: "#74b9ff",
    refQ3: "#e77c5c",
    refFallback: muted,
  };
}

export function smartOverlayLegendItems(palette: SmartOverlayPalette): SmartOverlayLegendItem[] {
  return [
    { id: "anomaly", label: "Anomaly", dash: [4, 3], color: palette.anomaly },
    { id: "trend", label: "Trend", dash: [6, 4], color: palette.trend },
    { id: "forecast", label: "Forecast", dash: [4, 2], color: palette.forecast },
    { id: "ref-mean", label: "Mean", dash: [3, 3], color: palette.refMean },
    { id: "ref-median", label: "Median", dash: [2, 2], color: palette.refMedian },
  ];
}

export function refLineColor(palette: SmartOverlayPalette, type: string): string {
  switch (type) {
    case "mean":
      return palette.refMean;
    case "median":
      return palette.refMedian;
    case "q1":
      return palette.refQ1;
    case "q3":
      return palette.refQ3;
    default:
      return palette.refFallback;
  }
}
