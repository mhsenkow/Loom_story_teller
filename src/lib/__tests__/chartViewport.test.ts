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

  it("fills a squeezed host instead of 16:9 postage-stamp letterbox", () => {
    const f = fitChartFrame({
      hostW: 300,
      hostH: 600,
      aspectId: "16:9",
      device: "mobile",
    });
    expect(f.aspectLocked).toBe(false);
    expect(f.width).toBeGreaterThan(250);
    expect(f.height).toBeGreaterThan(500);
  });

  it("keeps intentional phone 16:9 preview on a wide host", () => {
    const f = fitChartFrame({
      hostW: 1000,
      hostH: 700,
      aspectId: "16:9",
      device: "mobile",
    });
    expect(f.aspectLocked).toBe(true);
    expect(f.width).toBeLessThanOrEqual(390);
    expect(f.height / f.width).toBeCloseTo(9 / 16, 2);
  });
});
