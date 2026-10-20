// =================================================================
// WebGPU scatter eligibility — one predicate for draw + PNG export
// =================================================================

import { hasCanvasArrangement } from "./canvasArrangement";
import type { ChartRecommendation } from "./recommendations";
import type { ChartVisualOverrides } from "./store";

export interface WebGpuScatterEligibilityInput {
  kind: string | undefined;
  gpuReady: boolean;
  /** Story/social capture must use Canvas 2D (readback races). */
  forceCanvasCapture: boolean;
  hasSmartOverlays: boolean;
  connectScatterTrail: boolean;
  showMarginals: boolean;
  customRefLineCount: number;
  chart: Pick<
    ChartRecommendation,
    "id" | "glowField" | "outlineField" | "opacityField" | "shapeField" | "emojiField" | "rowField" | "residualOverlay" | "anomalyHighlight"
  > | null;
  overrides: Pick<
    ChartVisualOverrides,
    | "plotX"
    | "titleX"
    | "titleY"
    | "titleWidth"
    | "titleScale"
    | "legendOffsetX"
    | "legendOffsetY"
    | "legendWidth"
    | "legendHeight"
    | "markShape"
    | "markerMode"
    | "markStroke"
    | "markJitter"
    | "glowEnabled"
    | "blendMode"
  >;
}

export function canUseWebGpuScatter(input: WebGpuScatterEligibilityInput): boolean {
  if (hasCanvasArrangement(input.overrides)) return false;
  const chart = input.chart;
  return (
    input.kind === "scatter" &&
    input.gpuReady &&
    !input.forceCanvasCapture &&
    !input.hasSmartOverlays &&
    !input.connectScatterTrail &&
    !input.showMarginals &&
    input.customRefLineCount === 0 &&
    (input.overrides.markShape ?? "circle") === "circle" &&
    (input.overrides.markerMode ?? "shape") === "shape" &&
    !input.overrides.markStroke &&
    !(input.overrides.markJitter ?? 0) &&
    !input.overrides.glowEnabled &&
    (!input.overrides.blendMode || input.overrides.blendMode === "source-over") &&
    !chart?.glowField &&
    !chart?.outlineField &&
    !chart?.opacityField &&
    !chart?.shapeField &&
    !chart?.emojiField &&
    !chart?.rowField &&
    !chart?.residualOverlay &&
    !chart?.anomalyHighlight
  );
}
