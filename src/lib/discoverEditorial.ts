// =================================================================
// Discovery copy — readable field names without inventing findings.
// Existing evidence-based hooks remain the source of numerical claims.
// =================================================================

import type { DiscoverStory } from "./discoverStories";
import { SOURCE_BY_KIND, type SourceKind } from "./sourceRegistry";

const FIELD_LABELS: Record<string, string> = {
  ts: "time",
  yr: "year",
  kp: "Kp index",
  a_running: "A index",
  pm2_5: "PM2.5",
  pm10: "PM10",
  no2: "NO₂",
  co2: "CO₂",
  num_comments: "comments",
  comment_count: "comments",
  gdp_per_capita: "GDP per person",
  life_expectancy: "life expectancy",
  market_cap: "market value",
  market_cap_usd: "market value",
  volume_24h: "24-hour trading volume",
  volume_24h_usd: "24-hour trading volume",
  change_24h_pct: "24-hour change",
  price_usd: "price in USD",
  bright_ti4: "I4 brightness temperature",
  bright_ti5: "I5 brightness temperature",
  bikes_available: "available bikes",
  docks_available: "open docks",
  ebikes_available: "available e-bikes",
  discharge_cfs: "river discharge",
  gage_height_ft: "river level",
  temp_anomaly: "temperature anomaly",
  anomaly_c: "temperature anomaly",
  payrolls_k: "payrolls (thousands)",
  sig: "significance",
  daynight: "day or night",
  on_ground: "ground status",
  frp: "fire power",
  bachelors_or_higher_pct: "bachelor's degree share",
  median_household_income: "median household income",
  n_issues: "issue count",
  mag_type: "magnitude type",
  pct_full: "share full",
  positive_pct: "positive reviews",
  distance_ld: "distance (lunar)",
  abs_magnitude: "absolute magnitude",
  baro_altitude: "altitude",
  true_track: "heading",
};

/** Trailing unit tokens a column name carries; the unit is shown on values instead. */
const UNIT_SUFFIX = /_(usd|pct|c|f|ms|kmh|kms|km|m|ft|cfs|hpa|kg|mb|min|s|secs|btc|kt|mph)$/i;

export function discoverFieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const stem = UNIT_SUFFIX.test(field) ? field.replace(UNIT_SUFFIX, "") : field;
  return (stem || field)
    .replace(/_k$/, " (thousands)")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Units short enough to sit on a number in prose ("4.9%", "12 km"). */
const INLINE_UNITS = new Set([
  "%", "°C", "°F", "K", "km", "m", "mm", "ft", "hPa", "mph", "km/h", "m/s",
  "km/s", "ft³/s", "MW", "MB", "kt TNT", "µg/m³", "gCO₂/kWh", "kg",
]);

/** The registry unit for a source column, when one is known. */
export function discoverFieldUnit(
  field: string | null | undefined,
  source?: string,
): string | undefined {
  if (!field) return undefined;
  const fromRegistry = source
    ? SOURCE_BY_KIND[source as SourceKind]?.units?.[field]
    : undefined;
  if (fromRegistry) return fromRegistry;
  if (/_pct$/.test(field)) return "%";
  if (/_usd$/.test(field)) return "USD";
  return undefined;
}

const MINUS = "−";
const compactFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Prose-friendly number: sensible precision, a true minus sign, and the unit when it reads well. */
export function formatDiscoverValue(
  n: number,
  field?: string | null,
  source?: string,
  { signed = false }: { signed?: boolean } = {},
): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const body =
    abs >= 10_000
      ? compactFmt.format(abs)
      : abs > 0 && abs < 1
        ? new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(abs)
        : new Intl.NumberFormat("en", {
            maximumFractionDigits: abs >= 100 ? 0 : 1,
            useGrouping: false,
          }).format(abs);
  const sign = n < 0 && body !== "0" ? MINUS : signed && n > 0 ? "+" : "";
  const unit = discoverFieldUnit(field, source);
  if (unit === "USD" || unit === "USD/coin") return `${sign}$${body}`;
  if (unit === "%" || unit === "°C" || unit === "°F") return `${sign}${body}${unit}`;
  if (unit && INLINE_UNITS.has(unit)) return `${sign}${body} ${unit}`;
  return `${sign}${body}`;
}

export function readableDiscoverText(
  text: string,
  fields: readonly string[],
): string {
  let readable = text;
  for (const field of [...fields].sort((a, b) => b.length - a.length)) {
    const label = discoverFieldLabel(field);
    if (!field || field === label) continue;
    // Generated titles often already turned underscores into spaces ("payrolls k").
    const spaced = field.replace(/_/g, " ");
    for (const form of spaced !== field ? [field, spaced] : [field]) {
      if (form === label) continue;
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      readable = readable.replace(
        new RegExp(`(?<![\\w])${escaped}(?![\\w])`, form.length >= 3 ? "gi" : "g"),
        (match) =>
          /^[A-Z]/.test(match) ? label[0]!.toUpperCase() + label.slice(1) : label,
      );
    }
  }
  return readable.replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

export function editorialDiscoverStory(story: DiscoverStory): DiscoverStory {
  const hook = readableDiscoverText(story.hook, story.sample.columns);
  const blurb = readableDiscoverText(story.blurb, story.sample.columns);
  return hook === story.hook && blurb === story.blurb
    ? story
    : { ...story, hook, blurb };
}
