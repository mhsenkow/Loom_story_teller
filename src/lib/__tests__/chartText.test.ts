import { describe, expect, it } from "vitest";
import { fitTextEllipsis, fitTextWrap } from "../chartText";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const measure = { measureText: (text: string) => ({ width: [...segmenter.segment(text)].length * 10 }) };

describe("measured chart text", () => {
  it.each(["👩🏽‍🔬", "🇨🇦", "e\u0301", "👨‍👩‍👧‍👦"])("keeps %s intact at an ellipsis", (cluster) => {
    expect(fitTextEllipsis(measure, `${cluster}abcdef`, 30)).toBe(`${cluster}a…`);
    expect(fitTextEllipsis(measure, `${cluster}abcdef`, 20)).toBe(`${cluster}…`);
  });

  it("continues long identifiers and CJK labels across lines without dropping text", () => {
    expect(fitTextWrap(measure, "abcdefghij", 40, 3)).toEqual(["abcd", "efgh", "ij"]);
    expect(fitTextWrap(measure, "東京大阪京都神戸", 30, 3)).toEqual(["東京大", "阪京都", "神戸"]);
    expect(fitTextWrap(measure, "👩🏽‍🔬🇨🇦e\u0301abcdefgh", 30, 2)).toEqual(["👩🏽‍🔬🇨🇦e\u0301", "ab…"]);
  });

  it("prefers word boundaries and uses one ellipsis on the last available line", () => {
    expect(fitTextWrap(measure, "North America annual revenue", 100, 2)).toEqual(["North", "America a…"]);
    const lines = fitTextWrap(measure, "North America annual revenue", 100, 4);
    expect(lines).toEqual(["North", "America", "annual", "revenue"]);
    for (const line of lines) expect(measure.measureText(line).width).toBeLessThanOrEqual(100);
  });

  it("preserves formatted non-breaking spaces and normalizes ordinary line breaks", () => {
    expect(fitTextWrap(measure, "12\u202f345\u00a0kg", 100, 2)).toEqual(["12\u202f345\u00a0kg"]);
    expect(fitTextWrap(measure, "  one\n\ttwo  ", 100, 2)).toEqual(["one two"]);
  });

  it("handles empty or unusable bounds without partial glyphs or loops", () => {
    for (const width of [0, -1, NaN, 5]) {
      expect(fitTextEllipsis(measure, "👩🏽‍🔬label", width)).toBe("");
      expect(fitTextWrap(measure, "👩🏽‍🔬label", width, 3)).toEqual([]);
    }
    expect(fitTextWrap(measure, "label", 100, Infinity)).toEqual([]);
    expect(fitTextWrap(measure, "label", 100, 0)).toEqual([]);
    expect(fitTextEllipsis(measure, "", 100)).toBe("");
  });
});
