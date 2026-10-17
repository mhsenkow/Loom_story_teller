import { describe, it, expect } from "vitest";
import { contrastRatio, meetsWcagAa, ensureContrast } from "../wcagColor";
import { contrastingInk } from "../chartLayout";
import { corrCellInk } from "../corrMatrixStyle";

describe("wcagColor", () => {
  it("computes contrast ratio", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeGreaterThan(20);
  });

  it("nudges low-contrast ink toward AA", () => {
    const fg = ensureContrast("#888888", "#0a0a0c");
    expect(meetsWcagAa(fg, "#0a0a0c")).toBe(true);
  });

  it.each(["#f0701a", "#888888", "#73a9df", "#dca36b", "#1877f2", "#f7f7f7", "#111114"])("keeps text readable on mid-tone and extreme fills: %s", (fill) => {
    expect(contrastRatio(ensureContrast("#ececf1", fill), fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(contrastingInk(fill), fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(corrCellInk(0, fill, "#111114", "#ececf1"), fill)).toBeGreaterThanOrEqual(4.5);
  });
});
