/**
 * Unit tests for chart layout insets and contrast helpers.
 */
import { describe, it, expect } from "vitest";
import {
  resolveChartPad,
  resolveChartMargins,
  titleBandBottom,
  titlePositions,
  titlePreferCenter,
  fitTextEllipsis,
  contrastingInk,
  isLightHex,
  densityAwarePointMarks,
  subsampleRowsForDensity,
} from "../chartLayout";

describe("chartLayout", () => {
  it("pad clears title band for pair layout", () => {
    const pad = resolveChartPad({
      kind: "bar",
      width: 800,
      height: 500,
      basePad: 28,
      titleLayout: "pair",
    });
    expect(pad).toBeGreaterThanOrEqual(titleBandBottom("pair") * 0.9);
  });

  it("margins give left/bottom more room than right for cartesian", () => {
    const m = resolveChartMargins({
      kind: "scatter",
      width: 900,
      height: 560,
      basePad: 56,
      titleLayout: "pair",
      tickRotation: 0,
    });
    expect(m.top).toBeGreaterThanOrEqual(titleBandBottom("pair"));
    expect(m.left).toBeGreaterThanOrEqual(m.right);
    expect(m.bottom).toBeGreaterThanOrEqual(36);
  });

  it("pad stays usable on small canvases", () => {
    const pad = resolveChartPad({
      kind: "pie",
      width: 320,
      height: 240,
      basePad: 64,
      titleLayout: "ticket",
      chartFrame: "hero",
    });
    expect(pad).toBeLessThan(320 * 0.35);
    expect(pad).toBeGreaterThanOrEqual(32);
  });

  it("title positions sit inside the pad band", () => {
    const pad = 52;
    const pos = titlePositions(pad, "pair");
    expect(pos.titleY).toBeLessThan(pad);
    expect(pos.subtitleY).toBeLessThan(pad);
    expect(titlePreferCenter("pair")).toBe(true);
    expect(titlePreferCenter("ticket")).toBe(false);
  });

  it("fitTextEllipsis shortens long strings", () => {
    const ctx = {
      measureText: (s: string) => ({ width: s.length * 8 }),
    } as unknown as CanvasRenderingContext2D;
    const long = "A very long chart title that should not overflow the plot";
    const short = fitTextEllipsis(ctx, long, 80);
    expect(short.length).toBeLessThan(long.length);
    expect(short.endsWith("…")).toBe(true);
  });

  it("contrastingInk picks dark ink on light fills", () => {
    expect(contrastingInk("#f5f5f0")).toBe("#1a1a1a");
    expect(contrastingInk("#1a1030")).toBe("#ffffff");
    expect(isLightHex("#f2f2f0")).toBe(true);
    expect(isLightHex("#0a0a0c")).toBe(false);
  });

  it("densityAwarePointMarks shrinks marks for 10k+ points", () => {
    const sparse = densityAwarePointMarks({
      n: 80,
      plotW: 700,
      plotH: 480,
      hasSizeEncoding: true,
    });
    const dense = densityAwarePointMarks({
      n: 11652,
      plotW: 700,
      plotH: 480,
      hasSizeEncoding: true,
    });
    expect(dense.maxR).toBeLessThan(sparse.maxR);
    expect(dense.maxR).toBeLessThan(12);
    expect(dense.opacity).toBeLessThan(sparse.opacity);
    expect(dense.thinned).toBe(true);
    expect(dense.drawStroke).toBe(false);
  });

  it("subsampleRowsForDensity raises budget when zoomed", () => {
    const rows = Array.from({ length: 10000 }, (_, i) => i);
    const overview = subsampleRowsForDensity(rows, 2000, 1);
    const zoomed = subsampleRowsForDensity(rows, 2000, 2);
    expect(overview.sampled).toBe(true);
    expect(overview.shown).toBe(2000);
    expect(zoomed.shown).toBeGreaterThan(overview.shown);
    expect(zoomed.shown).toBeLessThanOrEqual(10000);
  });
});
