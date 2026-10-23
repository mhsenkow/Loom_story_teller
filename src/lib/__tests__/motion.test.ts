import { describe, expect, it, vi } from "vitest";
import {
  CHART_SWAP_STAGGER_MS,
  MOTION_MS,
  chartEntranceReveal,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuint,
  playChartSwap,
  traceEntranceClip,
} from "../motion";

describe("motion easing", () => {
  it.each([easeOutCubic, easeOutQuint, easeInOutCubic])("%o hits endpoints and clamps", (fn) => {
    expect(fn(0)).toBe(0);
    expect(fn(1)).toBe(1);
    expect(fn(-1)).toBe(0);
    expect(fn(2)).toBe(1);
  });

  it("decelerates: ease-out covers more than half the distance by mid-time", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
    expect(easeOutQuint(0.5)).toBeGreaterThan(easeOutCubic(0.5));
  });

  it("ease-in-out is symmetric", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1);
  });

  it("duration palette is ordered", () => {
    const v = Object.values(MOTION_MS);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
  });
});

describe("chart entrance reveal", () => {
  it("rises from the baseline for lines and vertical bars", () => {
    expect(chartEntranceReveal("line", 800, 500)).toBe("rise");
    expect(chartEntranceReveal("area", 800, 500)).toBe("rise");
    expect(chartEntranceReveal("bar", 800, 500)).toBe("rise");
  });

  it("flows from the left baseline when bars turn horizontal", () => {
    expect(chartEntranceReveal("bar", 400, 700)).toBe("flow");
    expect(chartEntranceReveal("lollipop", 400, 700)).toBe("flow");
  });

  it("opens radial kinds from the center", () => {
    expect(chartEntranceReveal("pie", 800, 500)).toBe("radial");
    expect(chartEntranceReveal("sunburst", 400, 700)).toBe("radial");
  });

  it("traces a clip that grows toward the full stage", () => {
    const calls: number[][] = [];
    const ctx = {
      beginPath: () => {},
      rect: (...args: number[]) => calls.push(args),
      arc: () => {},
    } as unknown as CanvasRenderingContext2D;
    traceEntranceClip(ctx, 100, 80, 0.5, "rise");
    expect(calls[0]).toEqual([0, 40, 100, 40]);
    calls.length = 0;
    traceEntranceClip(ctx, 100, 80, 0.5, "flow");
    expect(calls[0]).toEqual([0, 0, 50, 80]);
  });
});

describe("playChartSwap", () => {
  it("does nothing under reduced motion", () => {
    const animate = vi.fn();
    expect(playChartSwap([{ animate } as unknown as Element], true)).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("staggers present layers and skips missing ones", () => {
    const a = vi.fn(() => ({}) as Animation);
    const b = vi.fn(() => ({}) as Animation);
    const out = playChartSwap([null, { animate: a } as unknown as Element, undefined, { animate: b } as unknown as Element], false);
    expect(out).toHaveLength(2);
    expect((a.mock.calls[0] as unknown[])[1]).toMatchObject({ delay: 0, fill: "backwards" });
    expect((b.mock.calls[0] as unknown[])[1]).toMatchObject({ delay: CHART_SWAP_STAGGER_MS });
  });
});
