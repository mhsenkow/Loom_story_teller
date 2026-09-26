import { describe, expect, it } from "vitest";
import { detectDevice, fitChartFrame, resolveDevice } from "../chartViewport";

describe("chartViewport", () => {
  it("detects mobile / tablet / desktop breakpoints", () => {
    expect(detectDevice(390)).toBe("mobile");
    expect(detectDevice(900)).toBe("tablet");
    expect(detectDevice(1400)).toBe("desktop");
  });

  it("auto resolves to detected device", () => {
    expect(resolveDevice("auto", 400)).toBe("mobile");
    expect(resolveDevice("desktop", 400)).toBe("desktop");
  });

  it("fits 9:16 inside a wide host", () => {
    const f = fitChartFrame({
      hostW: 1000,
      hostH: 700,
      aspectId: "9:16",
      device: "desktop",
    });
    expect(f.aspectLocked).toBe(true);
    expect(f.height / f.width).toBeCloseTo(16 / 9, 2);
    expect(f.height).toBeLessThanOrEqual(700);
  });

  it("caps free mobile width", () => {
    const f = fitChartFrame({
      hostW: 1200,
      hostH: 800,
      aspectId: "free",
      device: "mobile",
    });
    expect(f.width).toBeLessThanOrEqual(390);
    expect(f.height).toBe(800 - 24); // default gutter 12*2
  });
});
