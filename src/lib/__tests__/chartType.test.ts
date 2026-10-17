import { describe, expect, it } from "vitest";
import { chartFont, chartTypeRamp, fitTextWrap, resolveChartAxisFontSize } from "../chartType";

describe("chartTypeRamp", () => {
  it("defaults to a readable 12px tick with consistent secondary type", () => {
    const r = chartTypeRamp();
    expect(r.tick).toBe(12);
    expect(r.title).toBeGreaterThanOrEqual(14);
    expect(r.subtitle).toBeGreaterThanOrEqual(11);
    expect(r.footnote).toBeGreaterThanOrEqual(11);
    expect(r.mark).toBeGreaterThanOrEqual(11);
  });

  it("compact uses an 11px default and honors larger explicit sizes", () => {
    expect(chartTypeRamp(undefined, { compact: true }).tick).toBe(11);
    expect(chartTypeRamp(16, { compact: true }).tick).toBe(16);
    expect(resolveChartAxisFontSize(NaN)).toBe(12);
    expect(resolveChartAxisFontSize(8, true)).toBe(11);
    expect(chartFont(7)).toContain("11px");
  });
});

describe("fitTextWrap", () => {
  it("wraps long titles into two lines", () => {
    const measure = (s: string) => s.length * 7;
    const ctx = {
      measureText: (s: string) => ({ width: measure(s) }),
    } as unknown as CanvasRenderingContext2D;
    const lines = fitTextWrap(ctx, "Wikipedia Most Read articles this week", 120, 2);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.join(" ").replace(/…/g, "")).toContain("Wikipedia");
  });
});
