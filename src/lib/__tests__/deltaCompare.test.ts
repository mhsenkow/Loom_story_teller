import { describe, expect, it } from "vitest";
import { deltaPct, formatDeltaLabel } from "../deltaCompare";

describe("deltaCompare", () => {
  it("formats signed diffs", () => {
    expect(formatDeltaLabel(10, 15, "diff")).toMatch(/^\+/);
    expect(formatDeltaLabel(15, 10, "diff")).toMatch(/^-/);
    expect(formatDeltaLabel(10, 10, "diff")).toBe("0");
    expect(formatDeltaLabel(10, 15, "off")).toBe("");
  });

  it("formats percent change and skips zero bases", () => {
    expect(deltaPct(100, 110)).toBeCloseTo(10);
    expect(formatDeltaLabel(100, 110, "pct")).toBe("+10%");
    expect(formatDeltaLabel(0, 5, "pct")).toBe("");
  });
});
