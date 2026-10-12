import { describe, it, expect } from "vitest";
import { contrastRatio, meetsWcagAa, ensureContrast } from "../wcagColor";

describe("wcagColor", () => {
  it("computes contrast ratio", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeGreaterThan(20);
  });

  it("nudges low-contrast ink toward AA", () => {
    const fg = ensureContrast("#888888", "#0a0a0c");
    expect(meetsWcagAa(fg, "#0a0a0c")).toBe(true);
  });
});
