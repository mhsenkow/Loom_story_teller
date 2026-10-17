import { describe, expect, it } from "vitest";
import {
  SCREEN_DPR_CAP,
  densityPointBudget,
  resolveStageBoxSize,
  screenDevicePixelRatio,
  stagePixelRatio,
} from "../chartStagePixels";

describe("chartStagePixels", () => {
  it("caps screen DPR for phone / Retina buffers", () => {
    expect(screenDevicePixelRatio(1)).toBe(1);
    expect(screenDevicePixelRatio(2)).toBe(2);
    expect(screenDevicePixelRatio(3)).toBe(SCREEN_DPR_CAP);
    expect(screenDevicePixelRatio(0)).toBe(1);
    expect(screenDevicePixelRatio(NaN)).toBe(1);
  });

  it("keeps explicit export pixel ratios uncapped", () => {
    expect(stagePixelRatio(3)).toBe(3);
    expect(stagePixelRatio(null)).toBe(screenDevicePixelRatio());
  });

  it("sizes buffer from CSS×DPR when no device box", () => {
    const s = resolveStageBoxSize({ cssW: 400, cssH: 300, dpr: 2 });
    expect(s).toMatchObject({ cssW: 400, cssH: 300, bufW: 800, bufH: 600, dpr: 2 });
  });

  it("prefers device-pixel content box but respects the screen DPR cap", () => {
    const s = resolveStageBoxSize({
      cssW: 400,
      cssH: 300,
      dpr: 2,
      devicePixelW: 1200, // 3× phone report
      devicePixelH: 900,
    });
    expect(s.bufW).toBe(800);
    expect(s.bufH).toBe(600);
    expect(s.dpr).toBe(2);
  });

  it("uses a leaner density budget on phone", () => {
    expect(densityPointBudget(true)).toBeLessThan(densityPointBudget(false));
  });
});
