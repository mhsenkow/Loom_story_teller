// =================================================================
// Loom — Chart type ramp (legibility scale for canvas text)
// =================================================================
// One base size → consistent title / tick / legend / footnote / mark
// steps. Defaults favor reading at arm’s length on laptop + phone.
// Logical sizes here are CSS px; social/export capture scales backing
// store via stage pixelRatio — do not shrink type to fit dense charts.
// =================================================================

/** Fallback axis/label ink when theme tokens weren’t passed (mid-gray that works on dark + light better than #6b6b78). */
export const CHART_LABEL_FALLBACK = "#8a8a96";

/** Fallback primary text (near-white; themes should override). */
export const CHART_TEXT_FALLBACK = "#ececf1";

export type ChartTypeRamp = {
  /** Resolved base (tick) size after compact floor. */
  base: number;
  title: number;
  titleSlab: number;
  titleCompact: number;
  subtitle: number;
  tick: number;
  axisField: number;
  legend: number;
  legendTitle: number;
  footnote: number;
  footnoteMeta: number;
  mark: number;
  cell: number;
  /** CSS font-size floor used in gutters / layout. */
  layoutFloor: number;
};

/**
 * Build a type ramp from the Visual → Axis font size control.
 * Compact frames drop one step so gutters still fit.
 */
export function chartTypeRamp(
  axisFontSize?: number | null,
  opts?: { compact?: boolean },
): ChartTypeRamp {
  const compact = !!opts?.compact;
  const requested = axisFontSize ?? 11;
  const base = compact
    ? Math.max(10, Math.min(14, requested - (requested >= 12 ? 1 : 0)))
    : Math.max(11, Math.min(16, requested));

  return {
    base,
    title: Math.round(base * 1.3), // ~14 at 11
    titleSlab: Math.round(base * 1.55), // ~17
    titleCompact: Math.max(11, Math.round(base * 1.05)),
    subtitle: Math.max(10, base - (compact ? 1 : 0)),
    tick: base,
    axisField: base,
    legend: Math.max(10, base - (compact ? 1 : 0)),
    legendTitle: Math.max(10, base),
    footnote: Math.max(10, base),
    footnoteMeta: Math.max(10, base - 2),
    mark: Math.max(10, base - 1),
    cell: Math.max(10, Math.min(13, base)),
    layoutFloor: Math.max(10, base),
  };
}

/** Canvas `font` shorthand for a ramp step. */
export function chartFont(
  size: number,
  fontFamily?: string | null,
  weight: number | string = 400,
  style: "normal" | "italic" = "normal",
): string {
  const fam = fontFamily?.trim() || "Inter";
  const st = style === "italic" ? "italic " : "";
  return `${st}${weight} ${size}px '${fam}', system-ui, sans-serif`;
}

/**
 * Wrap text into up to `maxLines` lines within maxWidth, ellipsizing the last
 * line if needed. Prefer this for titles/subtitles before hard truncation.
 */
export function fitTextWrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || maxLines < 1) return [];
  if (maxWidth <= 8 || maxLines === 1 || ctx.measureText(cleaned).width <= maxWidth) {
    return [fitLine(ctx, cleaned, maxWidth)];
  }

  const words = cleaned.split(" ");
  const lines: string[] = [];
  let cur = "";
  let i = 0;

  while (i < words.length) {
    const word = words[i]!;
    const trial = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(trial).width <= maxWidth) {
      cur = trial;
      i++;
      continue;
    }
    if (!cur) {
      lines.push(fitLine(ctx, word, maxWidth));
      i++;
    } else {
      lines.push(cur);
      cur = "";
    }
    if (lines.length >= maxLines) {
      // Overflow: rewrite last line with remaining words
      const rest = words.slice(i).join(" ");
      const last = lines[maxLines - 1]!;
      lines[maxLines - 1] = fitLine(ctx, rest ? `${last} ${rest}` : last, maxWidth);
      return lines.slice(0, maxLines);
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function fitLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return text;
  if (maxWidth <= 8 || ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ell : text.slice(0, lo) + ell;
}
