import { describe, expect, it } from "vitest";
import { getThemeUiColors } from "../chartPalettes";
import { refLineColor, smartOverlayLegendItems, smartOverlayPalette } from "../chartSmartOverlayStyle";

describe("chartSmartOverlayStyle", () => {
  it("returns distinct ref line colours", () => {
    const p = smartOverlayPalette(getThemeUiColors("dark"), false);
    expect(refLineColor(p, "mean")).not.toBe(refLineColor(p, "median"));
  });

  it("includes legend entries", () => {
    const p = smartOverlayPalette(getThemeUiColors("light"), true);
    expect(smartOverlayLegendItems(p).length).toBeGreaterThan(3);
  });
});
