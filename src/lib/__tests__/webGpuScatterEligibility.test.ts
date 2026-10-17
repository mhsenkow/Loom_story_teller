import { describe, it, expect } from "vitest";
import { canUseWebGpuScatter } from "../webGpuScatterEligibility";

describe("canUseWebGpuScatter", () => {
  const base = {
    kind: "scatter" as const,
    gpuReady: true,
    forceCanvasCapture: false,
    hasSmartOverlays: false,
    connectScatterTrail: false,
    showMarginals: false,
    customRefLineCount: 0,
    chart: { id: "c1", glowField: null, outlineField: null, opacityField: null },
    overrides: {},
  };

  it("disables when marginals or smart overlays are on", () => {
    expect(canUseWebGpuScatter({ ...base, showMarginals: true })).toBe(false);
    expect(canUseWebGpuScatter({ ...base, hasSmartOverlays: true })).toBe(false);
  });

  it("disables during capture", () => {
    expect(canUseWebGpuScatter({ ...base, forceCanvasCapture: true })).toBe(false);
  });

  it("disables for static emoji and per-row marker encodings", () => {
    expect(canUseWebGpuScatter({ ...base, overrides: { markerMode: "emoji" } })).toBe(false);
    expect(canUseWebGpuScatter({ ...base, chart: { ...base.chart, shapeField: "group" } })).toBe(false);
    expect(canUseWebGpuScatter({ ...base, chart: { ...base.chart, emojiField: "mood" } })).toBe(false);
  });
});
