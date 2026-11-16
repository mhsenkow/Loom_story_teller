import { describe, it, expect } from "vitest";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";

describe("sanitizeChartVisualOverrides", () => {
  it("drops unknown keys and clamps numeric overrides", () => {
    const out = sanitizeChartVisualOverrides({
      pointSize: 1e6,
      chartPadding: -500,
      evilKey: "x",
      showGrid: true,
    });
    expect(out?.pointSize).toBe(24);
    expect(out?.chartPadding).toBe(16);
    expect(out?.showGrid).toBe(true);
    expect(out).not.toHaveProperty("evilKey");
  });

  it("rejects invalid enum values", () => {
    const out = sanitizeChartVisualOverrides({
      legendPosition: "center" as never,
      markerMode: "html" as never,
      markEmoji: "<script>",
      showGrid: true,
    });
    expect(out?.legendPosition).toBeUndefined();
    expect(out?.markerMode).toBeUndefined();
    expect(out?.markEmoji).toBeUndefined();
    expect(out?.showGrid).toBe(true);
  });

  it("keeps every design value the Visual panel and looks can produce", () => {
    const authored = {
      titleLayout: "ticket",
      chartFrame: "hero",
      chartDetail: "deep",
      markMotif: "ring",
      axisStyle: "mercury",
      emphasisStyle: "alarm",
      backgroundStyle: "blueprint",
      markShape: "hexagon",
      markerMode: "emoji",
      markEmoji: "📍",
      gridStyle: "none",
      blendMode: "lighten",
      legendPosition: "right",
    } as const;
    expect(sanitizeChartVisualOverrides(authored)).toEqual(authored);
  });

  it("clamps to the Visual panel slider ranges", () => {
    const out = sanitizeChartVisualOverrides({ glowIntensity: 12, chartPadding: 20 });
    expect(out?.glowIntensity).toBe(12);
    expect(out?.chartPadding).toBe(20);
  });

  it("keeps custom legend offsets and chrome info band", () => {
    const out = sanitizeChartVisualOverrides({
      legendPosition: "custom",
      legendOffsetX: 0.82,
      legendOffsetY: 0.12,
      legendWidth: 0.2,
      legendHeight: 0.35,
      chromeInfoBand: "header",
      sourceFootnote: "credit",
    });
    expect(out).toMatchObject({
      legendPosition: "custom",
      legendOffsetX: 0.82,
      legendOffsetY: 0.12,
      legendWidth: 0.2,
      legendHeight: 0.35,
      chromeInfoBand: "header",
      sourceFootnote: "credit",
    });
  });

  it("keeps word-cloud look and drops a bad arrangement", () => {
    const out = sanitizeChartVisualOverrides({
      wordCloudFont: "Lora",
      wordCloudArrange: "rows",
      wordCloudScale: 4,
      wordCloudWeight: "heavy",
    });
    expect(out).toMatchObject({
      wordCloudFont: "Lora",
      wordCloudArrange: "rows",
      wordCloudScale: 1.6,
      wordCloudWeight: "heavy",
    });
    expect(sanitizeChartVisualOverrides({ wordCloudArrange: "circle" as never })?.wordCloudArrange).toBeUndefined();
  });

  it("drops custom legend geometry when position is not custom", () => {
    const out = sanitizeChartVisualOverrides({
      legendPosition: "top-right",
      legendOffsetX: 0.5,
      legendOffsetY: 0.5,
      legendWidth: 0.2,
      legendHeight: 0.3,
    });
    expect(out?.legendPosition).toBe("top-right");
    expect(out).not.toHaveProperty("legendOffsetX");
    expect(out).not.toHaveProperty("legendOffsetY");
    expect(out).not.toHaveProperty("legendWidth");
    expect(out).not.toHaveProperty("legendHeight");
  });
});
