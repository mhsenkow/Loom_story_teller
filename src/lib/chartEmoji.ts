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
