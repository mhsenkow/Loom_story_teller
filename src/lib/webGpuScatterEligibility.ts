// =================================================================
// WebGPU scatter eligibility — one predicate for draw + PNG export
// =================================================================

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
    "id" | "glowField" | "outlineField" | "opacityField"
  > | null;
  overrides: Pick<
    ChartVisualOverrides,
    | "markShape"
    | "markStroke"
    | "markJitter"
    | "glowEnabled"
  >;
}

export function canUseWebGpuScatter(input: WebGpuScatterEligibilityInput): boolean {
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
    !input.overrides.markStroke &&
    !(input.overrides.markJitter ?? 0) &&
    !input.overrides.glowEnabled &&
    !chart?.glowField &&
    !chart?.outlineField &&
    !chart?.opacityField
  );
}
