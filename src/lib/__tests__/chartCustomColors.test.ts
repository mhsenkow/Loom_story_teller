import { describe, expect, it } from "vitest";
import { normalizeChartHex, parseCustomColors } from "../chartCustomColors";
import { resolveChartColors, describeChartColorStatus } from "../chartPalettes";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";
import { packGpuPalette } from "../gpuPalette";
import { applyChartSpecColors } from "../chartSpecColors";
import { shuffleVisualOverrides } from "../lookSystem";
import { vegaExportConfigForTheme } from "../vegaThemeConfig";

const customColors = "#123456,#abcdef,#654321";
describe("custom chart colors", () => {
  it("accepts hex entry and rejects invalid or unbounded palettes", () => {
    expect(normalizeChartHex("AbC")).toBe("#aabbcc");
    expect(parseCustomColors("#123,ABCDEF")).toEqual(["#112233", "#abcdef"]);
    for (const v of [
      "",
      "red",
      "#123456,",
      "url(example)",
      Array(17).fill("#123456").join(","),
    ])
      expect(parseCustomColors(v)).toBeNull();
    expect(
      sanitizeChartVisualOverrides({ customColors: "#abc,#123" })?.customColors,
    ).toBe("#aabbcc,#112233");
    expect(
      sanitizeChartVisualOverrides({ customColors: "#bad,input" }),
    ).toBeUndefined();
  });
  it("keeps the same three-slot cycle for canvas, GPU and export", () => {
    const resolved = resolveChartColors({
      paletteId: "categorical",
      customColors,
      colorblind: true,
    });
    expect(resolved.colors).toEqual(customColors.split(","));
    expect(packGpuPalette(resolved.colors).size).toBe(3);
    expect(
      vegaExportConfigForTheme("dark", {
        customColors,
        colorPalette: "categorical",
      }).range.category,
    ).toEqual(resolved.colors);
    expect(resolveChartColors({ customColors, reverse: true }).colors).toEqual(
      [...resolved.colors].reverse(),
    );
  });
  it.each([
    "bar",
    "scatter",
    "pie",
    "line",
    "heatmap",
    "hexbin",
    "contour",
    "treemap",
    "corrMatrix",
    "dataCube",
  ])("%s respects custom stops", (chartKind) => {
    const result = resolveChartColors({ chartKind, customColors });
    expect(result.colors).toEqual(customColors.split(","));
    expect(
      describeChartColorStatus({ kind: chartKind }, { customColors })
        ?.paletteName,
    ).toBe("Custom colors");
  });
  it("preserves authored hex colors with automatic accessibility enabled", () => {
    expect(resolveChartColors({ theme: "light", colorblind: true, customColors: "#ffff00,#ffffff" }).colors).toEqual(["#ffff00", "#ffffff"]);
  });
  it("preserves locked custom colors and clears them when color is shuffled", () => {
    expect(
      shuffleVisualOverrides({ customColors }, { color: true }).customColors,
    ).toBe(customColors);
    expect(
      shuffleVisualOverrides({ customColors }).customColors,
    ).toBeUndefined();
  });
  it("replaces hard-coded SVG ranges recursively without mutating the source", () => {
    const original = {
      layer: [
        {
          mark: "bar",
          encoding: {
            color: {
              field: "city",
              type: "nominal",
              scale: { range: ["red"], domain: ["a", "b"], reverse: true },
            },
          },
        },
        {
          mark: "rect",
          encoding: {
            color: {
              field: "heat",
              type: "quantitative",
              scale: { scheme: "viridis" },
            },
          },
        },
      ],
    };
    const result = applyChartSpecColors(
      original,
      ["#123456"],
      ["#abcdef", "#654321"],
    ) as typeof original;
    expect(result.layer[0].encoding.color.scale).toEqual({
      range: ["#123456"],
      domain: ["a", "b"],
    });
    expect(result.layer[1].encoding.color.scale).toEqual({
      range: ["#abcdef", "#654321"],
    });
    expect(original.layer[0].encoding.color.scale.range).toEqual(["red"]);
    expect(
      applyChartSpecColors({ mark: "bar" }, ["#123456"], ["#123456"]).mark,
    ).toEqual({ type: "bar", color: "#123456" });
  });
});

it("renders custom categorical and single-stop quantitative colors into SVG", async () => {
  const { compile } = await import("vega-lite/build/src/index.js");
  const vega = await import("vega");
  for (const type of ["nominal", "quantitative"]) {
    const source = {
      mark: "bar",
      data: {
        values: [
          { category: "A", value: 1 },
          { category: "B", value: 2 },
        ],
      },
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
        color: {
          field: type === "nominal" ? "category" : "value",
          type,
          scale: { scheme: "viridis" },
        },
      },
    };
    const spec = applyChartSpecColors(
      source,
      ["#123456", "#abcdef"],
      ["#123456"],
    );
    const compiled = compile(spec as unknown as Parameters<typeof compile>[0]);
    const view = new vega.View(vega.parse(compiled.spec), { renderer: "none" });
    try {
      await view.runAsync();
      const svg = await view.toSVG();
      expect(svg).toContain(
        type === "nominal" ? 'fill="#123456"' : 'fill="rgb(18, 52, 86)"',
      );
      if (type === "nominal") expect(svg).toContain('fill="#abcdef"');
    } finally {
      view.finalize();
    }
  }
});
