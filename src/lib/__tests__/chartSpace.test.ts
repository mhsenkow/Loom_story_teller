import { describe, expect, it } from "vitest";
import { automaticPlotBounds, chartSpacePadding, chartStageGutter } from "../chartSpace";
import { resolveChartPad } from "../chartLayout";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";

describe("chart space use", () => {
  it("reclaims side space without taking the title or tick bands", () => {
    const args = { kind: "line" as const, width: 800, height: 560, basePad: 44, axisFontSize: 14, titleWrapPx: 26 };
    const plot = automaticPlotBounds(args)!;
    const oldPad = resolveChartPad(args);
    expect(plot.top).toBeGreaterThanOrEqual(84);
    expect(args.height - plot.bottom).toBeGreaterThanOrEqual(48);
    expect(plot.left).toBeGreaterThanOrEqual(68);
    expect(plot.right - plot.left).toBeGreaterThan(args.width - oldPad * 2);
    expect(automaticPlotBounds({ ...args, kind: "scatter" })).toBeUndefined();
  });

  it("makes Fill larger than Roomy while honoring a specific padding choice on phones", () => {
    expect(chartStageGutter("fill")).toBeLessThan(chartStageGutter("auto"));
    expect(chartStageGutter("auto")).toBeLessThan(chartStageGutter("roomy"));
    for (const width of [320, 500, 1200]) {
      expect(chartSpacePadding("fill", width)).toBeLessThan(chartSpacePadding("auto", width));
      expect(chartSpacePadding("auto", width)).toBeLessThan(chartSpacePadding("roomy", width));
      expect(chartSpacePadding("fill", width, 72)).toBe(72);
    }
    const args = { kind: "line" as const, width: 800, height: 600, basePad: 44 };
    const fill = automaticPlotBounds(args, "fill")!, roomy = automaticPlotBounds(args, "roomy")!;
    expect(fill.right - fill.left).toBeGreaterThan(roomy.right - roomy.left);
  });

  it("persists supported choices through the same sanitizer used by shared charts and looks", () => {
    for (const spaceUse of ["auto", "fill", "roomy"] as const) expect(sanitizeChartVisualOverrides({ spaceUse })).toEqual({ spaceUse });
    expect(sanitizeChartVisualOverrides({ spaceUse: "stretch-everything" })).toBeUndefined();
  });
});
