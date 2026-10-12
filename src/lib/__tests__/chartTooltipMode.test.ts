/**
 * Unit tests for tooltip presentation modes.
 */
import { describe, it, expect } from "vitest";
import {
  CHART_TOOLTIP_MODES,
  parseChartTooltipMode,
  resolveTooltipPresentation,
  tooltipModeIsOn,
} from "../chartTooltipMode";

describe("chartTooltipMode", () => {
  it("ships six modes", () => {
    expect(CHART_TOOLTIP_MODES).toHaveLength(6);
    expect(CHART_TOOLTIP_MODES.map((m) => m.value)).toEqual([
      "auto",
      "hover",
      "glass",
      "dock",
      "compact",
      "off",
    ]);
  });

  it("Auto → hover on desktop, glass on mobile", () => {
    expect(resolveTooltipPresentation("auto", false)).toBe("hover");
    expect(resolveTooltipPresentation("auto", true)).toBe("glass");
    expect(resolveTooltipPresentation(undefined, true)).toBe("glass");
    expect(resolveTooltipPresentation(null, false)).toBe("hover");
  });

  it("explicit modes pass through; off stays off", () => {
    expect(resolveTooltipPresentation("dock", true)).toBe("dock");
    expect(resolveTooltipPresentation("hover", true)).toBe("hover");
    expect(resolveTooltipPresentation("off", false)).toBe("off");
    expect(tooltipModeIsOn("auto")).toBe(true);
    expect(tooltipModeIsOn("off")).toBe(false);
  });

  it("parses known values only", () => {
    expect(parseChartTooltipMode("glass")).toBe("glass");
    expect(parseChartTooltipMode("nope")).toBeUndefined();
  });
});
