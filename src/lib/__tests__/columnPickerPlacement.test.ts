import { describe, expect, it } from "vitest";
import { placeColumnPicker } from "../columnPickerPlacement";

describe("column picker placement", () => {
  it("opens below a field with enough room", () => {
    const pos = placeColumnPicker(
      { left: 100, top: 50, bottom: 86, width: 260 },
      { left: 0, top: 0, width: 1024, height: 768 },
    );
    expect(pos).toMatchObject({
      left: 100,
      top: 90,
      width: 260,
      upwards: false,
    });
  });

  it("opens upwards at the bottom and clamps the right edge", () => {
    const pos = placeColumnPicker(
      { left: 290, top: 600, bottom: 636, width: 180 },
      { left: 0, top: 0, width: 390, height: 664 },
    );
    expect(pos.upwards).toBe(true);
    expect(pos.left + pos.width).toBe(382);
    expect(pos.top + pos.maxH).toBe(596);
    expect(pos.top).toBeGreaterThanOrEqual(8);
  });

  it("stays inside an offset visual viewport when the mobile keyboard opens", () => {
    const viewport = { left: 20, top: 120, width: 320, height: 260 };
    const pos = placeColumnPicker(
      { left: 0, top: 310, bottom: 346, width: 400 },
      viewport,
    );
    expect(pos.upwards).toBe(true);
    expect(pos.left).toBe(28);
    expect(pos.width).toBe(304);
    expect(pos.top).toBeGreaterThanOrEqual(128);
    expect(pos.top + pos.maxH).toBeLessThanOrEqual(372);
  });
});
