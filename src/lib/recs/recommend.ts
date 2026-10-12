// =================================================================
// recommend() entry point, story sequences and top-suggestion helpers.
// (split from recommendations.ts — LOOM-195; public API re-exported there)
// =================================================================

import { diversifyRecommendations } from "./columns";
import { type ColumnInfo, type QueryResult } from "../queryTypes";
import { recommendSeeded } from "./recommendSeeded";
import { schemaRecommendSeed, withSeededRandom } from "../seededRandom";
import { type ChartKind, type ChartRecommendation } from "./types";
import { type VizPreferenceModel } from "../vizPreferences";

export function recommend(
  columns: ColumnInfo[],
  data: QueryResult | null,
  fileName: string,
  prefs?: VizPreferenceModel | null,
): ChartRecommendation[] {
  return withSeededRandom(schemaRecommendSeed(columns, fileName), () =>
    recommendSeeded(columns, data, fileName, prefs),
  );
}

export interface StorySequence {
  title: string;
  charts: ChartRecommendation[];
}

/**
 * Returns an ordered sequence of 3–5 charts that "tell a story" about the data:
 * trend → breakdown → distribution → relationship (no AI). Used for "Create story dashboard".
 */
export function recommendStorySequence(
  columns: ColumnInfo[],
  data: QueryResult | null,
  fileName: string,
): StorySequence {
  const all = recommend(columns, data, fileName);
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ") || "Data";
  const title = `Story: ${baseName}`;

  if (all.length === 0) {
    return { title, charts: [] };
  }

  const byKind = new Map<ChartKind, ChartRecommendation[]>();
  for (const r of all) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }

  const pick = (kind: ChartKind): ChartRecommendation | null => {
    const list = byKind.get(kind);
    if (!list?.length) return null;
    return list.shift() ?? null;
  };

  const sequence: ChartRecommendation[] = [];
  const used = new Set<string>();

  // 1. Trend (line or area) — "what happened over time"
  const lineOrArea = pick("line") ?? pick("area");
  if (lineOrArea && !used.has(lineOrArea.id)) {
    sequence.push(lineOrArea);
    used.add(lineOrArea.id);
  }

  // 2. Breakdown (bar or pie) — "by category"
  const barOrPie = pick("bar") ?? pick("pie");
  if (barOrPie && !used.has(barOrPie.id)) {
    sequence.push(barOrPie);
    used.add(barOrPie.id);
  }

  // 3. Distribution (histogram)
  const hist = pick("histogram");
  if (hist && !used.has(hist.id)) {
    sequence.push(hist);
    used.add(hist.id);
  }

  // 4. Relationship (scatter) or map when lat/lon / regions dominate
  const scatter = pick("scatter");
  if (scatter && !used.has(scatter.id)) {
    sequence.push(scatter);
    used.add(scatter.id);
  }

  // 4b. Geography when the schema supports it
  const geoStory =
    pick("choropleth") ??
    pick("geoPoints") ??
    pick("geoBubbles") ??
    pick("globe") ??
    pick("geoHex") ??
    pick("globeTrail") ??
    pick("arcMap");
  if (geoStory && !used.has(geoStory.id)) {
    sequence.push(geoStory);
    used.add(geoStory.id);
  }

  // 5. Fill to 3–5 with next best variety (avoid duplicate kind)
  const remaining = all.filter((r) => !used.has(r.id));
  const kindUsed = new Set(sequence.map((r) => r.kind));
  for (const r of remaining) {
    if (sequence.length >= 5) break;
    if (kindUsed.has(r.kind)) continue;
    sequence.push(r);
    used.add(r.id);
    kindUsed.add(r.kind);
  }
  for (const r of remaining) {
    if (sequence.length >= 5) break;
    if (used.has(r.id)) continue;
    sequence.push(r);
    used.add(r.id);
  }

  return { title, charts: sequence.slice(0, 5) };
}

/** Picks the single best recommendation (highest score). Use for "Suggest chart". */
export function getBestSuggestion(recs: ChartRecommendation[]): ChartRecommendation | null {
  if (recs.length === 0) return null;
  return diversifyRecommendations(recs, 1)[0] ?? null;
}

/**
 * Top suggestions for Suggest chart cycling — high score + kind/encoding variety.
 * Clicking Suggest repeatedly walks this list.
 */
export function getTopSuggestions(
  recs: ChartRecommendation[],
  limit = 10,
): ChartRecommendation[] {
  if (recs.length === 0) return [];
  // Soften per-kind cap for the short Suggest cycle so we get ~8 distinct stories
  // (allow Facet / Top N / Compare variants of the same kind).
  const sorted = [...recs].sort((a, b) => b.score - a.score);
  const out: ChartRecommendation[] = [];
  const kindCount = new Map<ChartKind, number>();
  const encKey = (r: ChartRecommendation) =>
    `${r.kind}|${r.xField}|${r.yField ?? ""}|${r.colorField ?? ""}|${r.rowField ?? ""}|${r.topN ?? ""}|${r.y2Field ?? ""}|${r.comparePrevious ? "1" : ""}`;
  const seenEnc = new Set<string>();
  for (const r of sorted) {
    if (out.length >= limit) break;
    const ek = encKey(r);
    if (seenEnc.has(ek)) continue;
    const kc = kindCount.get(r.kind) ?? 0;
    if (kc >= 3) continue;
    out.push(r);
    seenEnc.add(ek);
    kindCount.set(r.kind, kc + 1);
  }
  for (const r of sorted) {
    if (out.length >= limit) break;
    if (out.some((o) => o.id === r.id)) continue;
    out.push(r);
  }
  return out;
}
