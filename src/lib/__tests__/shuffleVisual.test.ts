import { describe, expect, it } from "vitest";
import { shuffleVisualOverrides, type VisualShuffleLocks } from "../lookSystem";
import type { ChartVisualOverrides } from "../store";

describe("shuffleVisualOverrides", () => {
  const base: ChartVisualOverrides = {
    colorPalette: "categorical",
    colorScaleKind: "categorical",
    opacity: 0.7,
    pointSize: 12,
    backgroundStyle: "default",
    axisStyle: "rule",
    fontFamily: "Inter",
  };

  it("keeps locked color when shuffling", () => {
    const locks: VisualShuffleLocks = { color: true };
    let kept = 0;
    for (let i = 0; i < 20; i++) {
      const next = shuffleVisualOverrides(base, locks);
      if (next.colorPalette === "categorical" && next.opacity === 0.7) kept++;
    }
    expect(kept).toBe(20);
  });

  it("changes color when unlocked", () => {
    const locks: VisualShuffleLocks = { design: true, marks: true, axes: true, atmosphere: true, type: true };
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const next = shuffleVisualOverrides(base, locks);
      if (next.colorPalette) seen.add(next.colorPalette);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
