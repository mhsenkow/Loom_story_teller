import { describe, expect, it } from "vitest";
import {
  CATEGORY_MARK_SHAPES,
  CURATED_MARK_EMOJIS,
  MARK_SHAPE_IDS,
  categoryShape,
  isMarkShapeId,
} from "../chartMarks";
import { firstGrapheme } from "../chartText";

describe("chart markers", () => {
  it("keeps the reference silhouettes and legacy shared-link shapes", () => {
    expect(MARK_SHAPE_IDS).toEqual(expect.arrayContaining([
      "circle", "pill-vertical", "dash", "triangle", "rounded-square",
      "pentagon", "ring", "x", "diamond", "pin",
      "square", "cross", "star", "hexagon",
    ]));
    expect(isMarkShapeId("pin")).toBe(true);
    expect(isMarkShapeId("script")).toBe(false);
  });

  it("assigns category shapes deterministically and cycles safely", () => {
    for (let i = 0; i < CATEGORY_MARK_SHAPES.length * 3; i++) {
      expect(categoryShape(i)).toBe(CATEGORY_MARK_SHAPES[i % CATEGORY_MARK_SHAPES.length]);
    }
    expect(categoryShape(-1)).toBe(CATEGORY_MARK_SHAPES[1]);
  });

  it("keeps complete emoji graphemes and provides a curated palette", () => {
    expect(firstGrapheme("👩🏽‍🔬 scientist")).toBe("👩🏽‍🔬");
    expect(firstGrapheme("⚠️ warning")).toBe("⚠️");
    expect(firstGrapheme("")).toBeNull();
    expect(CURATED_MARK_EMOJIS).toContain("📍");
  });
});
