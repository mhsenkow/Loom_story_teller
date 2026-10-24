/** Extruded faces shade toward the theme, not fixed black / white. */
import { describe, it, expect } from "vitest";
import { inkHighlight, inkShadow, type ChartInk } from "../chartInk";

const dark: ChartInk = { bg: "#101014", text: "#ececf1", muted: "#8a8a96", border: "#2e2e36", paintBg: true, light: false };
const light: ChartInk = { bg: "#fbfaf7", text: "#1d1d22", muted: "#6b6b78", border: "#e2e0da", paintBg: true, light: true };

describe("theme shade inks", () => {
  it("shadows toward the darkest theme ink", () => {
    expect(inkShadow(dark)).toBe(dark.bg);
    expect(inkShadow(light)).toBe(light.text);
  });
  it("highlights toward the lightest theme ink", () => {
    expect(inkHighlight(dark)).toBe(dark.text);
    expect(inkHighlight(light)).toBe(light.bg);
  });
});
