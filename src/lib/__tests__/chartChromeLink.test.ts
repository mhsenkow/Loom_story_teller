/**
 * Unit tests for chart ↔ Encoding / Visual chrome linking geometry.
 */
import { describe, it, expect } from "vitest";
import {
  chromeDomId,
  chromeHighlightRect,
  chromeSectionFor,
  pickChartChromeRegion,
} from "../chartChromeLink";

describe("chartChromeLink", () => {
  const w = 400;
  const h = 300;
  const pad = 56;

  it("maps targets to Encoding vs Visual sections", () => {
    expect(chromeSectionFor("x")).toBe("encoding");
    expect(chromeSectionFor("y")).toBe("encoding");
    expect(chromeSectionFor("yScale")).toBe("encoding");
    expect(chromeSectionFor("title")).toBe("visual");
    expect(chromeSectionFor("axes")).toBe("visual");
    expect(chromeSectionFor("grid")).toBe("visual");
  });

  it("picks Y gutter, X strip, title, and leaves plot interior alone", () => {
    expect(pickChartChromeRegion(20, 150, w, h, pad)).toBe("y");
    expect(pickChartChromeRegion(200, h - 10, w, h, pad)).toBe("x");
    expect(pickChartChromeRegion(200, 12, w, h, pad)).toBe("title");
    expect(pickChartChromeRegion(200, 150, w, h, pad)).toBeNull();
  });

  it("returns highlight rects and stable DOM ids", () => {
    expect(chromeDomId("y")).toBe("loom-chrome-y");
    const y = chromeHighlightRect("y", w, h, pad);
    expect(y).not.toBeNull();
    expect(y!.w).toBeGreaterThan(0);
    expect(y!.x).toBe(0);
    const title = chromeHighlightRect("title", w, h, pad);
    expect(title!.y).toBeLessThan(pad);
  });
});
