// =================================================================
// Loom — per-mark symbols shared by every point-drawing renderer.
// =================================================================
// One resolver turns Encoding (Shape / Emoji from column) and Visual
// (one marker for all) into a shape or glyph per mark. Categories are
// registered in data order, so a column without a saved map gets the same
// fallback emoji the Encoding panel shows — never the first letter of a name.
// Aggregated marks (a line series, a radar polygon, a lollipop) pass the
// first row of their group.
// =================================================================

import { type ChartEmojiMap, chartEmojiLabel, fallbackEmoji, isEmojiGlyph } from "./chartEmoji";
import { categoryShape, drawMarkerPath } from "./chartMarks";
import { firstGrapheme } from "./chartText";

export interface MarkSymbolOpts {
  markShape?: string;
  markerMode?: "shape" | "emoji";
  markEmoji?: string;
  shapeField?: string | null;
  emojiField?: string | null;
  emojiMap?: ChartEmojiMap | null;
}

export interface MarkSymbol {
  glyph: string | null;
  shape: string;
}

export interface MarkSymbolLegendEntry {
  label: string;
  color: string;
  glyph?: string;
  shape?: string;
}

export interface MarkSymbols {
  /** Marks are something other than the renderer's default dot. */
  active: boolean;
  /** Symbols vary by a category column. */
  categorical: boolean;
  /** Symbol for a row (or the first row of an aggregated mark). */
  of(row: readonly unknown[] | undefined): MarkSymbol;
  /** Glyph / shape key entries when symbols vary by category, else null. */
  legend(colorOf: (row: readonly unknown[]) => string): MarkSymbolLegendEntry[] | null;
}

/** Above this many marks emoji give way to shapes (text draws are costly). */
export const EMOJI_MARK_LIMIT = 4000;

export function markSymbols(
  opts: MarkSymbolOpts | undefined,
  columns: readonly string[] | undefined,
  rows: readonly (readonly unknown[])[] = [],
  markCount = 0,
): MarkSymbols {
  const cols = columns ?? [];
  const glyphsOk = markCount <= EMOJI_MARK_LIMIT;
  const emojiField = glyphsOk ? (opts?.emojiField ?? null) : null;
  const emojiIdx = emojiField ? cols.indexOf(emojiField) : -1;
  const shapeField = opts?.shapeField ?? (glyphsOk ? null : opts?.emojiField) ?? null;
  const shapeIdx = emojiIdx < 0 && shapeField ? cols.indexOf(shapeField) : -1;
  const mapping = opts?.emojiMap && opts.emojiMap.field === emojiField ? opts.emojiMap : null;
  const baseShape = opts?.markShape ?? "circle";
  const singleGlyph = glyphsOk && opts?.markerMode === "emoji" ? firstGrapheme(opts.markEmoji) : null;
  const glyphs = new Map<string, string | null>();
  const shapes = new Map<string, number>();
  const firstRow = new Map<string, readonly unknown[]>();

  // A saved map is authoritative: codes it doesn't list keep a geometric mark.
  const glyphFor = (key: string): string | null => {
    if (glyphs.has(key)) return glyphs.get(key)!;
    let glyph: string | null;
    if (mapping) {
      const mapped = Object.hasOwn(mapping.values, key) ? firstGrapheme(mapping.values[key]) : null;
      glyph = mapped && isEmojiGlyph(mapped) ? mapped : null;
    } else {
      glyph = (isEmojiGlyph(key) ? firstGrapheme(key) : null) ?? fallbackEmoji(glyphs.size);
    }
    glyphs.set(key, glyph);
    return glyph;
  };
  const register = (row: readonly unknown[]) => {
    const idx = emojiIdx >= 0 ? emojiIdx : shapeIdx;
    if (idx < 0) return "";
    const key = String(row[idx] ?? "");
    if (!firstRow.has(key)) {
      firstRow.set(key, row);
      if (emojiIdx >= 0) glyphFor(key);
      else shapes.set(key, shapes.size);
    }
    return key;
  };
  if (emojiIdx >= 0 || shapeIdx >= 0) for (const row of rows) register(row);

  return {
    active: emojiIdx >= 0 || shapeIdx >= 0 || !!singleGlyph || baseShape !== "circle",
    categorical: emojiIdx >= 0 || shapeIdx >= 0,
    of(row) {
      if (row && emojiIdx >= 0) return { glyph: glyphFor(register(row)), shape: baseShape };
      if (row && shapeIdx >= 0) return { glyph: null, shape: categoryShape(shapes.get(register(row)) ?? 0) };
      return { glyph: singleGlyph, shape: baseShape };
    },
    legend(colorOf) {
      if (firstRow.size < 2) return null;
      return [...firstRow.entries()].map(([key, row]) =>
        emojiIdx >= 0
          ? { label: chartEmojiLabel(key, emojiField, mapping), glyph: glyphFor(key) ?? undefined, shape: baseShape, color: colorOf(row) }
          : { label: key, shape: categoryShape(shapes.get(key) ?? 0), color: colorOf(row) },
      );
    },
  };
}

/** Paint one symbol: emoji glyph, or a filled shape (ring strokes). */
export function drawMarkSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: MarkSymbol,
  x: number,
  y: number,
  r: number,
  fill: string,
  alpha: number,
  halo?: string | null,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (symbol.glyph) {
    ctx.font = `${Math.max(8, r * 2.35)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol.glyph, x, y + r * 0.05);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  drawMarkerPath(ctx, symbol.shape, x, y, r);
  if (symbol.shape === "ring") {
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(1, r * 0.4);
    ctx.stroke();
  } else {
    ctx.fillStyle = fill;
    ctx.fill();
    if (halo) {
      ctx.globalAlpha = Math.min(1, alpha + 0.1);
      ctx.strokeStyle = halo;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
  }
  ctx.restore();
}
