import { describe, it, expect } from "vitest";
import { chartFootnoteReservePx, drawChartTicks } from "../chartLooks";

function mockCtx() {
  const texts: { x: number; y: number; label: string }[] = [];
  const state: Record<string, string | number> = {
    font: "11px Inter",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textAlign: "center",
    textBaseline: "alphabetic",
  };
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: (label: string, x: number, y: number) => texts.push({ x, y, label }),
    measureText: (s: string) => ({ width: String(s).length * 7 }),
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get fillStyle() {
      return state.fillStyle as string;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle as string;
    },
    set font(v: string) {
      state.font = v;
    },
    get font() {
      return state.font as string;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get lineWidth() {
      return state.lineWidth as number;
    },
    set textAlign(v: CanvasTextAlign) {
      state.textAlign = v;
    },
    get textAlign() {
      return state.textAlign as CanvasTextAlign;
    },
    set textBaseline(v: CanvasTextBaseline) {
      state.textBaseline = v;
    },
    get textBaseline() {
      return state.textBaseline as CanvasTextBaseline;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

describe("drawChartTicks (LOOM-675)", () => {
  it("skips overlapping x labels when rotation is 0", () => {
    const { ctx, texts } = mockCtx();
    drawChartTicks(ctx, 0, 100, 0, 1, 400, 200, 40, { tickCount: 12 }, { y: false });
    const labels = texts.map((t) => t.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("draws rotated x labels without collision skip path", () => {
    const { ctx, texts } = mockCtx();
    drawChartTicks(ctx, 0, 100, 0, 1, 400, 200, 40, { tickCount: 8, tickRotation: 45 }, { y: false });
    expect(texts.length).toBeGreaterThan(2);
  });

  it("reserves more bottom space for multi-line footnotes", () => {
    expect(chartFootnoteReservePx(null)).toBe(0);
    const one = chartFootnoteReservePx("Source only");
    const two = chartFootnoteReservePx("Source\nOct 2026");
    expect(two).toBeGreaterThan(one);
    expect(chartFootnoteReservePx(null, { hasColorRamp: true })).toBeGreaterThan(0);
  });
});
