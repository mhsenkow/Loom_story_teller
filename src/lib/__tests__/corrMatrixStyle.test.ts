import { describe, it, expect } from "vitest";
import { corrFillT, corrCellInk, sampleCorrDiverging } from "../corrMatrixStyle";

describe("corrMatrixStyle", () => {
  it("maps r=-1..1 to 0..1", () => {
    expect(corrFillT(-1)).toBe(0);
    expect(corrFillT(1)).toBe(1);
    expect(corrFillT(0)).toBe(0.5);
  });

  it("uses diverging stops and contrasting ink", () => {
    const fill = sampleCorrDiverging(["#2166ac", "#fff", "#b2182b"], 0.9);
    expect(fill.startsWith("#")).toBe(true);
    expect(corrCellInk(0.9, fill, "#0a0a0c", "#ececf1")).toMatch(/^#/);
  });
});
