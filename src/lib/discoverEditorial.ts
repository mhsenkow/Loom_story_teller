// =================================================================
// Discovery copy — readable field names without inventing findings.
// Existing evidence-based hooks remain the source of numerical claims.
// =================================================================

import type { DiscoverStory } from "./discoverStories";

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
};

export function discoverFieldLabel(field: string): string {
  return (
    FIELD_LABELS[field] ??
    field.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}

export function readableDiscoverText(
  text: string,
  fields: readonly string[],
): string {
  let readable = text;
  for (const field of [...fields].sort((a, b) => b.length - a.length)) {
    const label = discoverFieldLabel(field);
    if (!field || field === label) continue;
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    readable = readable.replace(
      new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "g"),
      label,
    );
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
