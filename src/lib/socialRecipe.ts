// =================================================================
// socialRecipe — the one definition of a community chart's identity
// =================================================================
// Shared by the app (socialKey.ts) and the Worker (socialRoutes.ts), so
// the server can recompute an item's key from the `chart=` link it is
// given and refuse a link that doesn't match. That stops anyone from
// claiming a popular chart's key with a different chart or title.
// Pure, no imports: safe to bundle into the Worker.
// =================================================================

/** Recipe fields: [ChartRecommendation field, compact `chart=` link key]. */
const RECIPE: readonly (readonly [string, string])[] = [
  ["kind", "k"],
  ["xField", "x"],
  ["yField", "y"],
  ["colorField", "c"],
  ["sizeField", "s"],
  ["zField", "z"],
  ["rowField", "r"],
  ["y2Field", "y2"],
  ["yAggregate", "a"],
  ["timeWindow", "tw"],
  ["topN", "tn"],
  ["barStackMode", "bs"],
  ["seriesNormalize", "sn"],
  ["rollingWindow", "rw"],
  ["wordCloudMode", "wm"],
  ["anomalyHighlight", "ah"],
  ["bumpMode", "bm"],
];

/** Defaults and out-of-range values collapse to "absent", exactly as chart links do. */
function normalize(field: string, v: unknown): unknown {
  if (v === undefined || v === null || v === "" || v === false) return undefined;
  switch (field) {
    case "timeWindow":
      return v === "all" ? undefined : v;
    case "barStackMode":
      return v === "stacked" || v === "percent" ? v : undefined;
    case "wordCloudMode":
      return v === "compare" || v === "grid" ? v : undefined;
    case "bumpMode":
      return v === "rank" || v === "delta" ? v : undefined;
    case "seriesNormalize":
      return v === "index100" || v === "zscore" ? v : undefined;
    case "rollingWindow":
      return v === 7 || v === 30 ? v : undefined;
    case "topN":
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    case "anomalyHighlight":
      return v === true ? true : undefined;
    default:
      return typeof v === "string" || typeof v === "number" ? v : undefined;
  }
}

function fnv36(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function keyFrom(kind: string, get: (field: string, linkKey: string) => unknown): string {
  const pairs: [string, unknown][] = [];
  for (const [field, linkKey] of RECIPE) {
    const v = normalize(field, get(field, linkKey));
    if (v !== undefined) pairs.push([field, v]);
  }
  return `${kind}:${fnv36(JSON.stringify(pairs))}`;
}

/** Key from a chart recommendation (app side). */
export function recipeKeyFromChart(kind: string, chart: Record<string, unknown>): string {
  return keyFrom(kind, (field) => chart[field]);
}

/** Key from a decoded `chart=` payload `{ c: {...}, bs? }` (Worker side). */
export function recipeKeyFromLinkPayload(kind: string, payload: { c?: unknown; bs?: unknown }): string | null {
  const c = payload.c;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const compact = c as Record<string, unknown>;
  return keyFrom(kind, (field, linkKey) => (field === "barStackMode" ? payload.bs : compact[linkKey]));
}
