import { describe, expect, it } from "vitest";
import { keyboardNavigableHits, nextMarkIndex } from "../chartMarkKeyboard";
import type { HitTarget } from "../chartTooltip";

describe("chartMarkKeyboard", () => {
  it("wraps mark index", () => {
    expect(nextMarkIndex(2, 3, 1)).toBe(0);
    expect(nextMarkIndex(0, 3, -1)).toBe(2);
  });

  it("skips marks with no data identity", () => {
    const hits: HitTarget[] = [
      { shape: "rect", x: 0, y: 0, w: 1, h: 1, match: [] },
      {
        shape: "rect",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        match: [],
        summary: { columns: ["a"], row: [1] },
      },
    ];
    expect(keyboardNavigableHits(hits)).toHaveLength(1);
  });
});
