import { describe, expect, it } from "vitest";
import { isEmojiGlyph, seedEmojiMap, emojiFieldKeys } from "../chartEmoji";
import { markSymbols } from "../markSymbols";
import { chartCapabilities } from "../chartSupport";

const columns = ["state", "region", "pop"];
const rows = [
  ["WA", "West", 7],
  ["TX", "South", 29],
  ["OR", "West", 4],
  ["NY", "Northeast", 19],
];

describe("markSymbols", () => {
  it("gives every unmapped category an emoji, never its first letter", () => {
    const sym = markSymbols({ emojiField: "region" }, columns, rows);
    const glyphs = rows.map((r) => sym.of(r).glyph);
    for (const g of glyphs) expect(isEmojiGlyph(g)).toBe(true);
    expect(glyphs).not.toContain("W");
    expect(sym.of(rows[0]).glyph).toBe(sym.of(rows[2]).glyph);
    expect(sym.of(rows[0]).glyph).not.toBe(sym.of(rows[1]).glyph);
  });

  it("matches the glyphs the Encoding panel seeds for the same rows", () => {
    const keys = emojiFieldKeys(rows, columns, "region");
    const seeded = seedEmojiMap("region", keys, null)!;
    const sym = markSymbols({ emojiField: "region" }, columns, rows);
    for (const r of rows) expect(sym.of(r).glyph).toBe(seeded.values[String(r[1])]);
  });

  it("honors a saved map and its labels in the legend", () => {
    const sym = markSymbols(
      { emojiField: "region", emojiMap: { field: "region", values: { West: "🌲", South: "🌵" }, labels: { West: "Pacific" } } },
      columns,
      rows,
    );
    expect(sym.of(rows[0]).glyph).toBe("🌲");
    expect(sym.of(rows[1]).glyph).toBe("🌵");
    const legend = sym.legend(() => "#000")!;
    expect(legend.map((e) => e.label)).toEqual(["Pacific", "South", "Northeast"]);
    expect(legend[0]!.glyph).toBe("🌲");
  });

  it("uses one marker for all when no column is chosen", () => {
    const sym = markSymbols({ markerMode: "emoji", markEmoji: "🚀" }, columns, rows);
    expect(sym.active).toBe(true);
    expect(sym.categorical).toBe(false);
    expect(sym.of(rows[3]).glyph).toBe("🚀");
    expect(sym.legend(() => "#000")).toBeNull();
    expect(markSymbols({}, columns, rows).active).toBe(false);
  });

  it("cycles category shapes from a shape column", () => {
    const sym = markSymbols({ shapeField: "region" }, columns, rows);
    expect(sym.of(rows[0]).glyph).toBeNull();
    expect(sym.of(rows[0]).shape).toBe(sym.of(rows[2]).shape);
    expect(sym.of(rows[0]).shape).not.toBe(sym.of(rows[1]).shape);
  });
});

describe("point marker capabilities", () => {
  it.each(["bubble", "line", "radar", "lollipop", "isoScatter", "beeswarm", "slope", "bump"] as const)(
    "%s exposes markers and per-category symbols",
    (kind) => {
      const caps = chartCapabilities(kind);
      expect(caps.pointMarker).toBe(true);
      expect(caps.symbolChannel).toBe(true);
    },
  );

  it("keeps bars and pies free of point markers", () => {
    expect(chartCapabilities("bar").pointMarker).toBe(false);
    expect(chartCapabilities("pie").symbolChannel).toBe(false);
  });
});
