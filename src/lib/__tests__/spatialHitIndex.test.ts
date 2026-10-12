import { describe, expect, it } from "vitest";
import { buildSpatialHitIndex, spatialCandidates } from "../spatialHitIndex";
import type { HitTarget } from "../chartTooltip";

describe("spatialHitIndex", () => {
  it("returns nearby targets only", () => {
    const targets: HitTarget[] = [
      { shape: "circle", cx: 10, cy: 10, r: 4, match: [[0, "a"]] },
      { shape: "circle", cx: 200, cy: 200, r: 4, match: [[0, "b"]] },
    ];
    const index = buildSpatialHitIndex(targets, { w: 300, h: 300 }, 48);
    const near = spatialCandidates(index, 12, 12);
    expect(near).toHaveLength(1);
    expect(near[0]!.match[0]![1]).toBe("a");
  });
});
