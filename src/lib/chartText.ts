// Shared, measured chart text fitting. Truncate whole graphemes, never parts
// of an emoji or accented letter; wrap long identifiers without losing text.

type TextMeasure = { measureText(text: string): { width: number } };
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const boundariesCache = new Map<string, number[]>();
const CACHE_LIMIT = 128;

/** UTF-16 offsets after complete visible characters; ASCII needs no allocation. */
function boundaries(text: string): number[] | null {
  if (/^[\x20-\x7e]*$/.test(text)) return null;
  const cached = boundariesCache.get(text);
  if (cached) return cached;
  const ends: number[] = [];
  if (segmenter) {
    for (const part of segmenter.segment(text)) ends.push(part.index + part.segment.length);
  } else {
    let offset = 0;
    let join = false;
    let regionalCount = 0;
    for (const char of text) {
      offset += char.length;
      const regional = /[\u{1f1e6}-\u{1f1ff}]/u.test(char);
      const continuation = join || /[\p{Mark}\p{Emoji_Modifier}\u200d]/u.test(char) || (regional && regionalCount % 2 === 1);
      if (continuation && ends.length) ends[ends.length - 1] = offset;
      else ends.push(offset);
      join = char === "\u200d";
      regionalCount = regional ? regionalCount + 1 : 0;
    }
  }
  if (text.length <= 512) {
    if (boundariesCache.size >= CACHE_LIMIT) boundariesCache.delete(boundariesCache.keys().next().value!);
    boundariesCache.set(text, ends);
  }
  return ends;
}

function fittingEnd(ctx: TextMeasure, text: string, width: number, suffix = ""): number {
  const ends = boundaries(text);
  const endAt = (count: number) => count === 0 ? 0 : ends ? ends[count - 1]! : count;
  let lo = 0;
  let hi = ends?.length ?? text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, endAt(mid)).trimEnd() + suffix).width <= width) lo = mid;
    else hi = mid - 1;
  }
  return endAt(lo);
}

export function firstGrapheme(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ends = boundaries(text);
  return text.slice(0, ends?.[0] ?? 1);
}

export function fitTextEllipsis(ctx: TextMeasure, text: string, maxWidth: number): string {
  if (!text || !(maxWidth > 0)) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  return text.slice(0, fittingEnd(ctx, text, maxWidth, ellipsis)).trimEnd() + ellipsis;
}

export function fitTextWrap(ctx: TextMeasure, text: string, maxWidth: number, maxLines: number): string[] {
  // Preserve non-breaking spaces inside formatted values.
  let remaining = text.replace(/[\t\n\v\f\r \u2028\u2029]+/g, " ").trim();
  if (!remaining || !(maxWidth > 0) || !Number.isFinite(maxLines) || maxLines < 1) return [];
  const lines: string[] = [];
  const limit = Math.floor(maxLines);
  while (remaining && lines.length < limit) {
    if (ctx.measureText(remaining).width <= maxWidth) { lines.push(remaining); break; }
    if (lines.length === limit - 1) {
      const last = fitTextEllipsis(ctx, remaining, maxWidth);
      if (last) lines.push(last);
      break;
    }
    let end = fittingEnd(ctx, remaining, maxWidth);
    if (end === 0) {
      const last = fitTextEllipsis(ctx, remaining, maxWidth);
      if (last) lines.push(last);
      break;
    }
    const prefix = remaining.slice(0, end);
    const wordBreak = prefix.lastIndexOf(" ");
    if (wordBreak > 0 && remaining[end] !== " ") end = wordBreak;
    lines.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  return lines;
}
