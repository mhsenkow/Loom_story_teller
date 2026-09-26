// =================================================================
// Loom — Viz preference model (local swipe feedback)
// =================================================================
// Learns from Keep/Skip swipes: Laplace-smoothed like-rates per feature,
// then boosts heuristic chart scores. All data stays on-device.
// =================================================================

import type { ChartKind, ChartRecommendation, YAggregateOption } from "./recommendations";

export type VizSwipeAction = "like" | "dislike";

export type ColTypeHint = "quantitative" | "nominal" | "temporal" | "unknown";

/** Stable features extracted from a recommendation (not ephemeral id). */
export interface VizFeatures {
  kind: ChartKind;
  xType: ColTypeHint;
  yType: ColTypeHint;
  hasColor: boolean;
  yAggregate: YAggregateOption | "none";
  rateLike: boolean;
  geoLike: boolean;
  temporalLike: boolean;
  idLike: boolean;
  schemaSignature?: string;
}

export interface VizPreferenceEvent {
  ts: number;
  action: VizSwipeAction;
  features: VizFeatures;
  schemaSignature?: string;
}

export interface VizPreferenceModel {
  events: VizPreferenceEvent[];
  /** likes/dislikes per feature key (kind:scatter, tag:rateLike, …) */
  counts: Record<string, { likes: number; dislikes: number }>;
  version: 1;
}

const MAX_EVENTS = 500;
const BOOST_CLAMP = 25;
const HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 45; // ~45 days

export function emptyVizPreferenceModel(): VizPreferenceModel {
  return { events: [], counts: {}, version: 1 };
}

function isRateLike(name: string): boolean {
  return /(percent|percentage|proportion|ratio|rate|pct|\(%\)|%)/i.test(name);
}

function isGeoLike(name: string): boolean {
  return /\b(lat|lon|lng|longitude|latitude|geo|country|state|region|city|county)\b/i.test(name);
}

function isTemporalLike(name: string): boolean {
  return /\b(date|time|year|month|day|timestamp|created|updated|ts)\b/i.test(name);
}

function isIdLike(name: string): boolean {
  return /\b(code|id|uuid|key|ref|index)\b/i.test(name) || /(_id|_code)$/i.test(name);
}

function inferFieldType(
  field: string | null | undefined,
  columns: { name: string; data_type: string }[] | null | undefined,
): ColTypeHint {
  if (!field) return "unknown";
  const col = columns?.find((c) => c.name === field);
  const t = (col?.data_type ?? "").toUpperCase();
  if (["INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL", "HUGEINT", "TINYINT", "SMALLINT"].some((n) => t.includes(n))) {
    return "quantitative";
  }
  if (["DATE", "TIMESTAMP", "TIME", "INTERVAL"].some((n) => t.includes(n))) return "temporal";
  if (isTemporalLike(field)) return "temporal";
  if (col) return "nominal";
  return "unknown";
}

/** Extract preference features from a chart recommendation. */
export function extractVizFeatures(
  rec: ChartRecommendation,
  columns?: { name: string; data_type: string }[] | null,
  schemaSignature?: string,
): VizFeatures {
  const fields = [rec.xField, rec.yField, rec.colorField, rec.sizeField].filter(Boolean) as string[];
  return {
    kind: rec.kind,
    xType: inferFieldType(rec.xField, columns),
    yType: inferFieldType(rec.yField, columns),
    hasColor: Boolean(rec.colorField),
    yAggregate: rec.yAggregate ?? "none",
    rateLike: fields.some(isRateLike),
    geoLike: fields.some(isGeoLike),
    temporalLike: fields.some(isTemporalLike) || inferFieldType(rec.xField, columns) === "temporal",
    idLike: fields.some(isIdLike),
    schemaSignature,
  };
}

/** Flatten features into discrete keys for counting. */
export function featureKeys(f: VizFeatures): string[] {
  const keys = [
    `kind:${f.kind}`,
    `xType:${f.xType}`,
    `yType:${f.yType}`,
    `hasColor:${f.hasColor ? "1" : "0"}`,
    `agg:${f.yAggregate}`,
  ];
  if (f.rateLike) keys.push("tag:rateLike");
  if (f.geoLike) keys.push("tag:geoLike");
  if (f.temporalLike) keys.push("tag:temporalLike");
  if (f.idLike) keys.push("tag:idLike");
  if (f.schemaSignature) keys.push(`schema:${f.schemaSignature.slice(0, 16)}`);
  return keys;
}

function decayWeight(ts: number, now: number): number {
  const age = Math.max(0, now - ts);
  return Math.pow(0.5, age / HALF_LIFE_MS);
}

/** Rebuild counts from the event log with time decay. */
export function rebuildCounts(events: VizPreferenceEvent[], now = Date.now()): VizPreferenceModel["counts"] {
  const counts: VizPreferenceModel["counts"] = {};
  for (const ev of events) {
    const w = decayWeight(ev.ts, now);
    for (const key of featureKeys(ev.features)) {
      const slot = counts[key] ?? { likes: 0, dislikes: 0 };
      if (ev.action === "like") slot.likes += w;
      else slot.dislikes += w;
      counts[key] = slot;
    }
  }
  return counts;
}

/** Record a like/dislike and return the updated model. */
export function recordVizSwipe(
  model: VizPreferenceModel,
  action: VizSwipeAction,
  features: VizFeatures,
): VizPreferenceModel {
  const event: VizPreferenceEvent = {
    ts: Date.now(),
    action,
    features,
    schemaSignature: features.schemaSignature,
  };
  const events = [...model.events, event].slice(-MAX_EVENTS);
  return {
    version: 1,
    events,
    counts: rebuildCounts(events),
  };
}

/**
 * Laplace-smoothed like-rate → log-odds sum, clamped to ±BOOST_CLAMP.
 * Added to heuristic recommendation scores.
 */
export function preferenceBoost(features: VizFeatures, model: VizPreferenceModel | null | undefined): number {
  if (!model || model.events.length === 0) return 0;
  const keys = featureKeys(features);
  let logOdds = 0;
  let used = 0;
  for (const key of keys) {
    const c = model.counts[key];
    if (!c) continue;
    const p = (c.likes + 1) / (c.likes + c.dislikes + 2);
    // log odds relative to 0.5 prior
    const odds = p / (1 - p);
    logOdds += Math.log(odds);
    used += 1;
  }
  if (used === 0) return 0;
  // Scale: typical |logOdds| per feature ~0–1.5 → multiply for score units
  const boost = (logOdds / Math.sqrt(used)) * 8;
  return Math.max(-BOOST_CLAMP, Math.min(BOOST_CLAMP, boost));
}

/** Apply preference boost to a single recommendation (mutates score copy). */
export function applyPreferenceBoost(
  rec: ChartRecommendation,
  model: VizPreferenceModel | null | undefined,
  columns?: { name: string; data_type: string }[] | null,
  schemaSignature?: string,
): ChartRecommendation {
  const features = extractVizFeatures(rec, columns, schemaSignature);
  const boost = preferenceBoost(features, model);
  if (boost === 0) return rec;
  return { ...rec, score: rec.score + boost };
}

/** Apply boosts to a list in place order (returns new array). */
export function applyPreferenceBoosts(
  recs: ChartRecommendation[],
  model: VizPreferenceModel | null | undefined,
  columns?: { name: string; data_type: string }[] | null,
  schemaSignature?: string,
): ChartRecommendation[] {
  if (!model || model.events.length === 0) return recs;
  return recs.map((r) => applyPreferenceBoost(r, model, columns, schemaSignature));
}

export function eventCount(model: VizPreferenceModel | null | undefined): number {
  return model?.events.length ?? 0;
}

/** Parse persisted JSON safely. */
export function parseVizPreferenceModel(raw: unknown): VizPreferenceModel {
  if (!raw || typeof raw !== "object") return emptyVizPreferenceModel();
  const o = raw as Partial<VizPreferenceModel>;
  const events = Array.isArray(o.events) ? o.events.filter(isValidEvent) : [];
  return {
    version: 1,
    events: events.slice(-MAX_EVENTS),
    counts: rebuildCounts(events),
  };
}

function isValidEvent(e: unknown): e is VizPreferenceEvent {
  if (!e || typeof e !== "object") return false;
  const o = e as Partial<VizPreferenceEvent>;
  return (
    (o.action === "like" || o.action === "dislike") &&
    typeof o.ts === "number" &&
    o.features != null &&
    typeof o.features === "object" &&
    typeof (o.features as VizFeatures).kind === "string"
  );
}

/** Module cache so recommend() can re-rank without every call site passing prefs. */
let cachedModel: VizPreferenceModel = emptyVizPreferenceModel();

export function getCachedVizPreferences(): VizPreferenceModel {
  return cachedModel;
}

export function setCachedVizPreferences(model: VizPreferenceModel): void {
  cachedModel = model;
}
