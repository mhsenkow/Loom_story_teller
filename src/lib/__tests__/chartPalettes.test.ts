import { describe, expect, it } from "vitest";
import {
  COLOR_PALETTES,
  VIZ_CATEGORICAL,
  discretizeContinuous,
  formatChartColorStatus,
  getPaletteById,
  resolveChartColors,
  sampleContinuous,
  sampleCategorical,
} from "../chartPalettes";

describe("chartPalettes catalog", () => {
  it("includes categorical with 11 stops", () => {
    expect(VIZ_CATEGORICAL).toHaveLength(11);
    expect(VIZ_CATEGORICAL[0]).toBe("#1877F2");
    expect(getPaletteById("categorical")?.colors).toHaveLength(11);
  });

  it("maps legacy palette ids", () => {
    expect(getPaletteById("xds")?.id).toBe("categorical");
    expect(resolveChartColors({ paletteId: "xds-seq-blue" }).paletteId).toBe("seq-blue");
  });

  it("has sequential blue endpoints", () => {
    const p = getPaletteById("seq-blue")!;
    expect(p.colors[0]).toBe("#05214D");
    expect(p.colors[p.colors.length - 1]).toBe("#ABD1FF");
  });

  it("sampleContinuous hits endpoints", () => {
    const stops = ["#000000", "#ffffff"];
    expect(sampleContinuous(stops, 0).toLowerCase()).toBe("#000000");
    expect(sampleContinuous(stops, 1).toLowerCase()).toBe("#ffffff");
  });

  it("auto heatmap → sequential continuous", () => {
    const r = resolveChartColors({ paletteId: "auto", chartKind: "heatmap" });
    expect(r.paletteId).toBe("seq-blue");
    expect(r.continuous).toBe(true);
    expect(r.kind).toBe("sequential");
  });

  it("auto treemap → sequential continuous (value ramp)", () => {
    const r = resolveChartColors({ paletteId: "auto", chartKind: "treemap" });
    expect(r.paletteId).toBe("seq-blue");
    expect(r.continuous).toBe(true);
  });

  it("formatChartColorStatus names field + palette when color is in play", () => {
    expect(
      formatChartColorStatus(
        { kind: "treemap", xField: "article", yField: "views" },
        { paletteId: "div-hot-cold" },
      ),
    ).toBe("color: views · Diverging Hot–Cold");
    expect(
      formatChartColorStatus(
        { kind: "scatter", xField: "a", yField: "b", colorField: "region" },
        { paletteId: "categorical" },
      ),
    ).toBe("color: region · Categorical");
    expect(
      formatChartColorStatus(
        { kind: "bar", xField: "a", yField: "b" },
        { paletteId: "auto" },
      ),
    ).toBeNull();
  });

  it("auto waterfall → semantic", () => {
    const r = resolveChartColors({ paletteId: "auto", chartKind: "waterfall" });
    expect(r.paletteId).toBe("semantic");
    expect(r.kind).toBe("semantic");
  });

  it("auto quantitative color field → sequential", () => {
    const r = resolveChartColors({
      paletteId: "auto",
      chartKind: "scatter",
      colorFieldType: "quantitative",
    });
    expect(r.paletteId).toBe("seq-blue");
    expect(r.continuous).toBe(true);
  });

  it("auto scatter nominal → categorical", () => {
    const r = resolveChartColors({ paletteId: "auto", chartKind: "scatter" });
    expect(r.paletteId).toBe("categorical");
    expect(r.continuous).toBe(false);
  });

  it("colorblind overrides auto to okabe/cividis", () => {
    const cat = resolveChartColors({ paletteId: "auto", chartKind: "bar", colorblind: true });
    expect(cat.paletteId).toBe("okabe");
    const seq = resolveChartColors({ paletteId: "auto", chartKind: "heatmap", colorblind: true });
    expect(seq.paletteId).toBe("cividis");
  });

  it("reverse flips stops", () => {
    const a = resolveChartColors({ paletteId: "seq-blue" });
    const b = resolveChartColors({ paletteId: "seq-blue", reverse: true });
    expect(b.colors[0]).toBe(a.colors[a.colors.length - 1]);
  });

  it("discretizeContinuous returns n colors", () => {
    const p = getPaletteById("seq-blue")!;
    expect(discretizeContinuous(p.colors, 8)).toHaveLength(8);
  });

  it("sampleCategorical cycles when n > length", () => {
    expect(sampleCategorical(["#a", "#b"], 4)).toEqual(["#a", "#b", "#a", "#b"]);
  });

  it("catalog has no duplicate ids", () => {
    const ids = COLOR_PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
