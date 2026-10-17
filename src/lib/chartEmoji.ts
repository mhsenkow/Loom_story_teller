// Portable, field-bound emoji mappings. Unknown codes keep a geometric marker.
import { firstGrapheme } from "./chartText";

export interface ChartEmojiMap {
  field: string;
  values: Record<string, string>;
  labels?: Record<string, string>;
}

export function chartEmojiLabel(
  value: unknown,
  field?: string | null,
  mapping?: ChartEmojiMap | null,
): string {
  const key = String(value ?? "");
  return mapping &&
    mapping.field === field &&
    mapping.labels &&
    Object.hasOwn(mapping.labels, key)
    ? mapping.labels[key]!
    : key;
}

export function isEmojiGlyph(value: unknown): boolean {
  const glyph = firstGrapheme(value);
  return (
    !!glyph &&
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(glyph)
  );
}

export function chartEmoji(
  value: unknown,
  field?: string | null,
  mapping?: ChartEmojiMap | null,
): string | null {
  if (mapping && mapping.field === field) {
    const key = String(value ?? "");
    return Object.hasOwn(mapping.values, key)
      ? firstGrapheme(mapping.values[key])
      : null;
  }
  return firstGrapheme(value);
}

const FALLBACK_EMOJIS = [
  "⭐", "🔥", "🌊", "🌀", "🌋", "❄️", "🌱", "📍", "💡", "🚀", "✨", "🌍",
];

/** Distinct non-empty values for an emoji column, in first-seen order. */
export function emojiFieldKeys(
  rows: readonly unknown[][],
  columns: readonly string[],
  field: string,
  limit = 24,
): string[] {
  const index = columns.indexOf(field);
  if (index < 0) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of rows) {
    const key = String(row[index] ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}

function mappedGlyph(
  mapping: ChartEmojiMap | null | undefined,
  field: string,
  key: string,
): string | null {
  if (!mapping || mapping.field !== field || !Object.hasOwn(mapping.values, key)) return null;
  const glyph = firstGrapheme(mapping.values[key]);
  return glyph && isEmojiGlyph(glyph) ? glyph : null;
}

/**
 * A complete emoji for every visible category. Existing picks and a known
 * source map win; anything left gets a symbol rather than the first letter.
 */
export function seedEmojiMap(
  field: string,
  keys: readonly string[],
  current: ChartEmojiMap | null | undefined,
  semantic?: ChartEmojiMap | null,
): ChartEmojiMap | undefined {
  if (!field || !keys.length) return undefined;
  const values: Record<string, string> = {};
  const labels: Record<string, string> = {};
  keys.slice(0, 80).forEach((key, index) => {
    const own = isEmojiGlyph(key) ? firstGrapheme(key) : null;
    values[key] =
      mappedGlyph(current, field, key) ??
      mappedGlyph(semantic, field, key) ??
      own ??
      FALLBACK_EMOJIS[index % FALLBACK_EMOJIS.length]!;
    const label =
      (current?.field === field ? current.labels?.[key] : undefined) ??
      (semantic?.field === field ? semantic.labels?.[key] : undefined);
    if (label && label !== key) labels[key] = label;
  });
  return parseChartEmojiMap({
    field,
    values,
    ...(Object.keys(labels).length ? { labels } : {}),
  });
}

/** Replace one category’s symbol and keep the others as emoji, not initials. */
export function assignChartEmoji(
  field: string,
  keys: readonly string[],
  current: ChartEmojiMap | null | undefined,
  key: string,
  glyph: string,
  semantic?: ChartEmojiMap | null,
): ChartEmojiMap | undefined {
  const chosen = firstGrapheme(glyph);
  if (!chosen || !isEmojiGlyph(chosen)) return undefined;
  const seeded = seedEmojiMap(field, [...new Set([...keys, key])], current, semantic);
  if (!seeded) return undefined;
  return parseChartEmojiMap({
    ...seeded,
    values: { ...seeded.values, [key]: chosen },
  });
}

export function parseChartEmojiMap(raw: unknown): ChartEmojiMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { field, values, labels } = raw as ChartEmojiMap;
  if (
    typeof field !== "string" ||
    !field ||
    field.length > 200 ||
    !values ||
    typeof values !== "object" ||
    Array.isArray(values)
  )
    return undefined;
  const entries = Object.entries(values);
  if (
    !entries.length ||
    entries.length > 80 ||
    entries.some(
      ([key, glyph]) =>
        key.length > 100 ||
        typeof glyph !== "string" ||
        glyph.length > 32 ||
        !isEmojiGlyph(glyph),
    )
  )
    return undefined;
  if (
    labels != null &&
    (typeof labels !== "object" ||
      Array.isArray(labels) ||
      Object.keys(labels).length > 80 ||
      Object.entries(labels).some(
        ([key, label]) =>
          !Object.hasOwn(values, key) ||
          typeof label !== "string" ||
          !label ||
          label.length > 100,
      ))
  )
    return undefined;
  return {
    field,
    values: Object.fromEntries(
      entries.map(([key, glyph]) => [key, firstGrapheme(glyph)!]),
    ),
    ...(labels ? { labels: { ...labels } } : {}),
  };
}
