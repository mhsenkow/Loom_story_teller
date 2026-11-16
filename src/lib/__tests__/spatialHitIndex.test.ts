import { describe, expect, it } from "vitest";
import { buildSpatialHitIndex, spatialCandidates } from "../spatialHitIndex";
import { pickHitTarget, spatialIndexFor, type HitTarget } from "../chartTooltip";

describe("spatialHitIndex", () => {
  it("returns nearby targets only", () => {
    const targets: HitTarget[] = [
      { shape: "circle", cx: 10, cy: 10, r: 4, match: [[0, "a"]] },
      { shape: "circle", cx: 200, cy: 200, r: 4, match: [[0, "b"]] },
    ];
    const index = buildSpatialHitIndex(targets, { w: 300, h: 300 }, 48);
    const near = spatialCandidates(index, 12, 12, targets);
    expect(near).toHaveLength(1);
    expect(near[0]!.match[0]![1]).toBe("a");
  });

  it("finds long bars from any point along them", () => {
    // 60 horizontal bars, 10px tall, lengths 900 → 15: centers sit far from most of each bar.
    const bars: HitTarget[] = Array.from({ length: 60 }, (_, i) => ({
      shape: "rect",
      x: 100,
      y: i * 12,
      w: 900 - i * 15,
      h: 10,
      match: [[0, `bar${i}`]],
    }));
    let misses = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i] as Extract<HitTarget, { shape: "rect" }>;
      for (let x = b.x + 1; x < b.x + b.w; x += 7) {
        if (pickHitTarget(bars, x, b.y + 5) !== b) misses++;
      }
    }
    expect(misses).toBe(0);
  });

  it("keeps topmost-wins order for overlapping marks", () => {
    const targets: HitTarget[] = Array.from({ length: 50 }, (_, i) => ({
      shape: "circle",
      cx: 20 + i * 40,
      cy: 20,
      r: 4,
      match: [[0, `p${i}`]],
    }));
    const under: HitTarget = { shape: "rect", x: 0, y: 0, w: 60, h: 60, match: [[0, "under"]] };
    const over: HitTarget = { shape: "rect", x: 0, y: 0, w: 60, h: 60, match: [[0, "over"]] };
    const all = [...targets, under, over];
    expect(pickHitTarget(all, 40, 40)).toBe(over);
    const near = spatialCandidates(buildSpatialHitIndex(all, { w: 0, h: 0 }), 40, 40, all);
    expect(near.map((t) => all.indexOf(t))).toEqual([...near.map((t) => all.indexOf(t))].sort((a, b) => a - b));
  });

  it("checks arcs and huge boxes at every point", () => {
    const targets: HitTarget[] = [
      { shape: "arc", cx: 500, cy: 500, r0: 0, r1: 400, a0: 0, a1: Math.PI * 2, match: [[0, "pie"]] },
      { shape: "rect", x: 0, y: 0, w: 4000, h: 4000, match: [[0, "band"]] },
    ];
    const idx = buildSpatialHitIndex(targets, { w: 0, h: 0 });
    expect(idx.always).toEqual([0, 1]);
    expect(spatialCandidates(idx, 3000, 3000, targets)).toEqual(targets);
  });

  it("builds the index once per painted target list", () => {
    const targets: HitTarget[] = Array.from({ length: 60 }, (_, i) => ({
      shape: "circle",
      cx: i * 10,
      cy: 10,
      r: 3,
      match: [[0, `p${i}`]],
    }));
    const first = spatialIndexFor(targets);
    pickHitTarget(targets, 50, 10);
    pickHitTarget(targets, 300, 10);
    expect(spatialIndexFor(targets)).toBe(first);
    targets.push({ shape: "circle", cx: 700, cy: 10, r: 3, match: [[0, "late"]] });
    expect(spatialIndexFor(targets)).not.toBe(first);
  });
});
