import { describe, expect, it } from "vitest";
import type { HitTarget } from "../chartTooltip";
import { calloutLines, findHitForMark, markAnchor, markFocusStyle, markRefForHit, markRefForRow, placeCallout, sameMark } from "../markFocus";
import { keyboardNavigableHits } from "../chartMarkKeyboard";

const columns = ["city", "temp", "region"];
const rows = [
  ["Oslo", 4, "N"],
  ["Rome", 21, "S"],
];
const identity = ["city", "temp", null];

describe("markFocus", () => {
  it("identifies marks by values, not position or order", () => {
    const bar: HitTarget = { shape: "rect", x: 10, y: 20, w: 30, h: 40, match: [[0, "Rome"]] };
    const moved: HitTarget = { shape: "rect", x: 300, y: 5, w: 12, h: 90, match: [[0, "Rome"]] };
    const ref = markRefForHit(bar, columns, rows, identity)!;
    expect(ref).toEqual({ fields: [["city", "Rome"]] });
    expect(findHitForMark([moved], ref, columns, rows, identity)).toBe(moved);
    // Row-only marks (scatter, odd glyphs) use the encoded fields of their row.
    const point: HitTarget = { shape: "circle", cx: 1, cy: 1, r: 3, match: [], rowIndex: 1 };
    expect(markRefForHit(point, columns, rows, identity)).toEqual(markRefForRow(1, columns, rows, identity));
    expect(markRefForRow(1, columns, rows, identity)).toEqual({ fields: [["city", "Rome"], ["temp", "21"]] });
    // Aggregates fall back to their summary label.
    const bin: HitTarget = { shape: "rect", x: 0, y: 0, w: 1, h: 1, match: [], summary: { columns: ["bin"], row: ["10–20"] } };
    expect(markRefForHit(bin, columns, rows, identity)).toEqual({ fields: [["#bin", "10–20"]] });
    expect(sameMark({ fields: [["a", "1"]] }, { fields: [["a", "2"]] })).toBe(false);
  });

  it("themes focus to how each chart draws its marks", () => {
    const rect: HitTarget = { shape: "rect", x: 0, y: 0, w: 1, h: 1, match: [] };
    expect(markFocusStyle("bar", rect)).toBe("bar");
    expect(markFocusStyle("heatmap", rect)).toBe("cell");
    expect(markFocusStyle("box", rect)).toBe("band");
    expect(markFocusStyle("pie", { shape: "arc", cx: 0, cy: 0, r0: 0, r1: 5, a0: 0, a1: 1, match: [] })).toBe("wedge");
    expect(markFocusStyle("bar", { shape: "circle", cx: 0, cy: 0, r: 2, match: [] })).toBe("point");
  });

  it("keeps callouts inside the frame and clear of each other", () => {
    const frame = { w: 400, h: 300 };
    const a = placeCallout({ x: 390, y: 10 }, { w: 120, h: 60 }, frame);
    expect(a.x + a.w).toBeLessThanOrEqual(394);
    expect(a.y).toBeGreaterThanOrEqual(6);
    const b = placeCallout({ x: 390, y: 12 }, { w: 120, h: 60 }, frame, [a]);
    const overlap = b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y;
    expect(overlap).toBe(false);
    expect(markAnchor({ shape: "circle", cx: 5, cy: 6, r: 2, match: [] })).toEqual({ x: 5, y: 6 });
  });

  it("formats readout lines and skips empty values", () => {
    expect(calloutLines(["a", "b", "c"], [1234.5678, null, "x"])).toEqual([["a", "1,234.568"], ["c", "x"]]);
  });

  it("walks every mark in reading order", () => {
    const hits: HitTarget[] = [
      { shape: "rect", x: 100, y: 0, w: 10, h: 10, match: [[0, "b"]] },
      { shape: "rect", x: 0, y: 0, w: 10, h: 10, match: [[0, "a"]] },
      { shape: "rect", x: 0, y: 0, w: 10, h: 10, match: [[0, "a"]] },
      { shape: "rect", x: 50, y: 0, w: 10, h: 10, match: [] },
    ];
    expect(keyboardNavigableHits(hits).map((h) => h.match[0]?.[1])).toEqual(["a", "b"]);
  });
});
