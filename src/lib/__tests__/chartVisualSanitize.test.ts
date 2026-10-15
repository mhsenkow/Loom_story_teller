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
    const out = sanitizeChartVisualOverrides({ legendPosition: "center" as never, showGrid: true });
    expect(out?.legendPosition).toBeUndefined();
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
});
