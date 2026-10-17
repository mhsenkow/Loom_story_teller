import { describe, expect, it } from "vitest";
import { chartTooltipLayout } from "../chartTooltipLayout";

describe("chart readout placement", () => {
  it("keeps wrapped readouts within phone and desktop edges, including stale pinned coordinates", () => {
    for (const presentation of ["hover", "compact", "glass", "dock"] as const) {
      for (const [viewportWidth, viewportHeight] of [[390, 844], [320, 320], [1043, 1050]]) {
        for (const [x, y] of [[0, 0], [380, 800], [2000, 2000]]) {
          const box = chartTooltipLayout({ presentation, x, y, viewportWidth, viewportHeight, height: 900, stage: { left: 300, top: 40, width: 800, height: 900, bottom: 940 } });
          expect(box.left).toBeGreaterThanOrEqual(8);
          expect(box.top).toBeGreaterThanOrEqual(8);
          expect(box.left + box.width).toBeLessThanOrEqual(viewportWidth - 8);
          expect(box.top + Math.min(900, box.maxHeight)).toBeLessThanOrEqual(viewportHeight - 8);
        }
      }
    }
  });
  it("places a measured hover above the pointer when its text would overflow below", () => {
    const box = chartTooltipLayout({ presentation: "hover", x: 380, y: 800, viewportWidth: 390, viewportHeight: 844, height: 300 });
    expect(box.left).toBe(88);
    expect(box.top).toBe(492);
    expect(box.width).toBe(280);
  });
});
