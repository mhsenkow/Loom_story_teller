import { describe, expect, it } from "vitest";
import { chartTypeRamp, fitTextWrap } from "../chartType";

describe("chartTypeRamp", () => {
  it("defaults to a readable 11px tick floor", () => {
    const r = chartTypeRamp();
    expect(r.tick).toBe(11);
    expect(r.title).toBeGreaterThanOrEqual(14);
    expect(r.subtitle).toBeGreaterThanOrEqual(10);
    expect(r.footnote).toBeGreaterThanOrEqual(10);
    expect(r.mark).toBeGreaterThanOrEqual(10);
  });

  it("compact drops one step but stays ≥10", () => {
    const r = chartTypeRamp(12, { compact: true });
    expect(r.tick).toBeGreaterThanOrEqual(10);
    expect(r.tick).toBeLessThanOrEqual(12);
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
