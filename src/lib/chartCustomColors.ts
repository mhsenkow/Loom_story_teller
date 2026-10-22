// Bounded, portable custom palette stops shared by the inspector, renderers and links.
export const MAX_CUSTOM_COLORS = 16;

export function normalizeChartHex(value: string): string | null {
  const hex = value.trim().replace(/^#?/, "#");
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex))
    return `#${[...hex.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

/** A comma-separated primitive keeps existing saved looks and share links compatible. */
export function parseCustomColors(value?: string | null): string[] | null {
  if (!value || value.length > MAX_CUSTOM_COLORS * 8) return null;
  const parts = value.split(",");
  if (parts.length > MAX_CUSTOM_COLORS) return null;
  const colors = parts.map(normalizeChartHex);
  return colors.every((c): c is string => c !== null) ? colors : null;
}
