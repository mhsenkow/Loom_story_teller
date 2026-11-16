// =================================================================
// Reader-facing column names for chart axes, legends and tooltips.
// Display only: logic keeps matching on the raw column name.
// =================================================================

import { discoverFieldLabel, discoverFieldUnit } from "./discoverEditorial";

/** Units that read well in parentheses after a name; others (count, rank, stat) add nothing. */
const AXIS_UNITS = new Set([
  "%", "°C", "°F", "K", "km", "m", "mm", "ft", "hPa", "mph", "km/h", "m/s",
  "km/s", "ft³/s", "MW", "MB", "kt TNT", "µg/m³", "gCO₂/kWh", "kg", "USD",
  "minutes", "seconds", "years", "degrees", "people/km²", "km²",
]);

/**
 * "anomaly_c" from the climate feed → "temperature anomaly (°C)";
 * "Revenue_USD" → "Revenue (USD)"; plain names ("Revenue", "iPhone") pass through.
 */
export function fieldDisplayName(field: string, source?: string | null): string {
  if (!field) return field;
  const unit = discoverFieldUnit(field, source ?? undefined) ?? suffixUnit(field);
  const label = discoverFieldLabel(field);
  // Only rewrite snake_case and known feed columns; respect names people typed themselves.
  const base = field.includes("_") || label !== field.replace(/([a-z])([A-Z])/g, "$1 $2")
    ? label
    : field;
  if (!unit || !AXIS_UNITS.has(unit) || base.includes(`(${unit})`)) return base;
  return `${base} (${unit})`;
}

function suffixUnit(field: string): string | undefined {
  const m = /_(usd|pct)$/i.exec(field);
  if (!m) return undefined;
  return m[1]!.toLowerCase() === "usd" ? "USD" : "%";
}

export function fieldDisplayNames(columns: readonly string[], source?: string | null): string[] {
  return columns.map((c) => fieldDisplayName(c, source));
}
