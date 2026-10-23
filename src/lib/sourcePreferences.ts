// =================================================================
// Loom — Source preferences (♥ Love / 👎 Less / Hide / 🔖 Save)
// =================================================================
// Per-SourceRef reactions + a separate bookmark, plus an implicit "opened"
// signal (decayed, capped small so explicit reactions dominate). Turned
// into one affinity number that Discover, the sidebar feed browser and the
// command palette add to their own scores. All data stays on-device.
// Modeled on vizPreferences.ts (pure + module cache).
// =================================================================

import { catalogEntryFor } from "./sourceCatalog";
import { feedRef, isSourceRef, type FeedKind, type SourceRef } from "./sourceRef";
import type { SourceTopic } from "./sourceRegistry";

export type SourceReaction = "love" | "spark" | "ask" | "less" | "hide";

/** Marks you can filter on. They are not a collection. */
export const MARK_REACTIONS = ["love", "spark", "ask"] as const;

export interface SourcePrefEntry {
  reaction?: SourceReaction;
  reactedAt?: number;
  saved?: boolean;
  savedAt?: number;
  /** Decayed open count as of `openedAt` (implicit "like"). */
  opens?: number;
  openedAt?: number;
}

export interface SourcePreferences {
  version: 1;
  entries: Record<SourceRef, SourcePrefEntry>;
}

export const SOURCE_AFFINITY_CLAMP = 20;
/** Explicit reaction weights (affinity units ≈ Discover score points). */
export const LOVE_BOOST = 10;
export const SPARK_BOOST = 6;
export const ASK_BOOST = 4;
export const LESS_PENALTY = -8;
export const SAVED_BOOST = 3;
/** Implicit opens: +1 per (decayed) open, never more than this. */
export const OPEN_CAP = 3;
/** Each other loved source sharing a topic nudges this one … */
export const TOPIC_SPILLOVER = 2;
/** … up to this much in total. */
export const TOPIC_SPILLOVER_CAP = 4;
/** Discover / scan rank penalty for hidden sources (below every real score). */
export const HIDDEN_RANK_PENALTY = -100;

const OPEN_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 30; // ~30 days
/** Re-activating the same dataset within this window is one open, not many. */
const OPEN_DEDUPE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 400;
const REACTIONS: readonly SourceReaction[] = ["love", "spark", "ask", "less", "hide"];

export function emptySourcePreferences(): SourcePreferences {
  return { version: 1, entries: {} };
}

function decay(age: number): number {
  return Math.pow(0.5, Math.max(0, age) / OPEN_HALF_LIFE_MS);
}

function isExplicit(e: SourcePrefEntry | undefined): boolean {
  return !!e && (!!e.reaction || !!e.saved);
}

/** Open weight right now (decayed from the last open). */
export function openWeight(e: SourcePrefEntry | undefined, now = Date.now()): number {
  if (!e?.opens || !e.openedAt) return 0;
  return e.opens * decay(now - e.openedAt);
}

function withEntry(prefs: SourcePreferences, ref: SourceRef, next: SourcePrefEntry): SourcePreferences {
  const entries = { ...prefs.entries };
  if (!next.reaction && !next.saved && !next.opens) delete entries[ref];
  else entries[ref] = next;
  return { version: 1, entries: pruneEntries(entries) };
}

/** Keep every explicit entry; drop the weakest open-only ones past the cap. */
function pruneEntries(entries: Record<SourceRef, SourcePrefEntry>, now = Date.now()): Record<SourceRef, SourcePrefEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  const implicit = keys
    .filter((k) => !isExplicit(entries[k]))
    .sort((a, b) => openWeight(entries[a], now) - openWeight(entries[b], now));
  const out = { ...entries };
  for (const k of implicit.slice(0, keys.length - MAX_ENTRIES)) delete out[k];
  return out;
}

/** Set (or clear with `null`) the reaction for a source. */
export function setSourceReaction(
  prefs: SourcePreferences,
  ref: SourceRef,
  reaction: SourceReaction | null,
  now = Date.now(),
): SourcePreferences {
  const prev = prefs.entries[ref] ?? {};
  const { reaction: _r, reactedAt: _t, ...rest } = prev;
  void _r;
  void _t;
  return withEntry(prefs, ref, reaction ? { ...rest, reaction, reactedAt: now } : rest);
}

export function toggleSourceSaved(prefs: SourcePreferences, ref: SourceRef, now = Date.now()): SourcePreferences {
  const prev = prefs.entries[ref] ?? {};
  const { saved, savedAt: _s, ...rest } = prev;
  void _s;
  return withEntry(prefs, ref, saved ? rest : { ...rest, saved: true, savedAt: now });
}

/** Implicit signal: the dataset for `ref` was opened. */
export function recordSourceOpen(prefs: SourcePreferences, ref: SourceRef, now = Date.now()): SourcePreferences {
  const prev = prefs.entries[ref] ?? {};
  if (prev.openedAt && now - prev.openedAt < OPEN_DEDUPE_MS) return prefs;
  const opens = openWeight(prev, now) + 1;
  return withEntry(prefs, ref, { ...prev, opens: Math.round(opens * 1000) / 1000, openedAt: now });
}

export function sourceReaction(ref: SourceRef, prefs: SourcePreferences = cached): SourceReaction | null {
  return prefs.entries[ref]?.reaction ?? null;
}

export function isSourceSaved(ref: SourceRef, prefs: SourcePreferences = cached): boolean {
  return prefs.entries[ref]?.saved === true;
}

/** Heart, spark, or curious — the filterable marks, separate from collections. */
export function isSourceMarked(ref: SourceRef, prefs: SourcePreferences = cached): boolean {
  const reaction = prefs.entries[ref]?.reaction;
  return !!reaction && (MARK_REACTIONS as readonly string[]).includes(reaction);
}

export function isHidden(ref: SourceRef, prefs: SourcePreferences = cached): boolean {
  return prefs.entries[ref]?.reaction === "hide";
}

/** True once the person has loved, lessened, hidden or saved anything. */
export function hasExplicitSourcePreferences(prefs: SourcePreferences = cached): boolean {
  return Object.values(prefs.entries).some(isExplicit);
}

function topicsFor(ref: SourceRef): SourceTopic[] {
  return catalogEntryFor(ref)?.topics ?? [];
}

const lovedTopicCache = new WeakMap<SourcePreferences, Map<SourceTopic, SourceRef[]>>();

function lovedByTopic(prefs: SourcePreferences): Map<SourceTopic, SourceRef[]> {
  let map = lovedTopicCache.get(prefs);
  if (map) return map;
  map = new Map();
  for (const [ref, e] of Object.entries(prefs.entries)) {
    if (e.reaction !== "love") continue;
    for (const t of topicsFor(ref)) {
      const list = map.get(t);
      if (list) list.push(ref);
      else map.set(t, [ref]);
    }
  }
  lovedTopicCache.set(prefs, map);
  return map;
}

/**
 * Affinity in about −20…+20 score points: explicit reaction + bookmark +
 * capped recent opens + a light spillover from loved sources on the same
 * topic. Hidden sources sit at the floor (callers filter them out).
 */
export function sourceAffinity(ref: SourceRef, prefs: SourcePreferences = cached, now = Date.now()): number {
  const e = prefs.entries[ref];
  if (e?.reaction === "hide") return -SOURCE_AFFINITY_CLAMP;
  let score = 0;
  if (e?.reaction === "love") score += LOVE_BOOST;
  if (e?.reaction === "spark") score += SPARK_BOOST;
  if (e?.reaction === "ask") score += ASK_BOOST;
  if (e?.reaction === "less") score += LESS_PENALTY;
  if (e?.saved) score += SAVED_BOOST;
  score += Math.min(OPEN_CAP, openWeight(e, now));
  const topics = topicsFor(ref);
  if (topics.length) {
    const loved = lovedByTopic(prefs);
    const others = new Set<SourceRef>();
    for (const t of topics) for (const r of loved.get(t) ?? []) if (r !== ref) others.add(r);
    score += Math.min(TOPIC_SPILLOVER_CAP, others.size * TOPIC_SPILLOVER);
  }
  const clamped = Math.max(-SOURCE_AFFINITY_CLAMP, Math.min(SOURCE_AFFINITY_CLAMP, score));
  return Math.round(clamped * 100) / 100;
}

/**
 * Per-feed rank adjustment for Discover (keys are feed kinds incl. `wiki`):
 * affinity, or HIDDEN_RANK_PENALTY for hidden feeds. Only non-zero kinds appear.
 */
export function discoverAffinityMap(
  kinds: readonly FeedKind[],
  prefs: SourcePreferences = cached,
  now = Date.now(),
): Partial<Record<FeedKind, number>> {
  const out: Partial<Record<FeedKind, number>> = {};
  for (const kind of kinds) {
    const ref = feedRef(kind);
    const v = isHidden(ref, prefs) ? HIDDEN_RANK_PENALTY : sourceAffinity(ref, prefs, now);
    if (v !== 0) out[kind] = v;
  }
  return out;
}

/** Refs with an explicit preference, newest first (Settings → Your sources). */
export function explicitSourceRefs(prefs: SourcePreferences = cached): SourceRef[] {
  const at = (e: SourcePrefEntry) => Math.max(e.reactedAt ?? 0, e.savedAt ?? 0);
  return Object.entries(prefs.entries)
    .filter(([, e]) => isExplicit(e))
    .sort((a, b) => at(b[1]) - at(a[1]) || a[0].localeCompare(b[0]))
    .map(([ref]) => ref);
}

/** Only loves / lessens / hides / saves — the part that travels in workspace backups. */
export function explicitOnly(prefs: SourcePreferences): SourcePreferences {
  const entries: Record<SourceRef, SourcePrefEntry> = {};
  for (const [ref, e] of Object.entries(prefs.entries)) {
    if (!isExplicit(e)) continue;
    const { opens: _o, openedAt: _a, ...rest } = e;
    void _o;
    void _a;
    entries[ref] = rest;
  }
  return { version: 1, entries };
}

/**
 * Non-destructive merge (backup import): a ref the person already reacted to
 * or saved here keeps its local entry; otherwise the incoming one is added.
 */
export function mergeSourcePreferences(
  current: SourcePreferences,
  incoming: SourcePreferences,
): { merged: SourcePreferences; added: number; skipped: number } {
  const entries = { ...current.entries };
  let added = 0;
  let skipped = 0;
  for (const [ref, e] of Object.entries(incoming.entries)) {
    if (!isExplicit(e)) continue;
    const local = entries[ref];
    if (isExplicit(local)) {
      skipped += 1;
      continue;
    }
    entries[ref] = { ...local, ...e };
    added += 1;
  }
  return { merged: { version: 1, entries: pruneEntries(entries) }, added, skipped };
}

export function countExplicitSourcePreferences(prefs: SourcePreferences | null | undefined): number {
  return prefs ? Object.values(prefs.entries).filter(isExplicit).length : 0;
}

const finiteTs = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

function parseEntry(raw: unknown): SourcePrefEntry | null {
  // v0 / shorthand: `{ "feed:usgs": "love" }`. Plan-era "like" becomes one open.
  if (typeof raw === "string") {
    if ((REACTIONS as readonly string[]).includes(raw)) return { reaction: raw as SourceReaction };
    if (raw === "like") return { opens: 1, openedAt: Date.now() };
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: SourcePrefEntry = {};
  if (typeof o.reaction === "string" && (REACTIONS as readonly string[]).includes(o.reaction)) {
    out.reaction = o.reaction as SourceReaction;
    const t = finiteTs(o.reactedAt);
    if (t) out.reactedAt = t;
  } else if (o.reaction === "like") {
    out.opens = 1;
    out.openedAt = finiteTs(o.reactedAt) ?? Date.now();
  }
  if (o.saved === true) {
    out.saved = true;
    const t = finiteTs(o.savedAt);
    if (t) out.savedAt = t;
  }
  const opens = typeof o.opens === "number" && Number.isFinite(o.opens) && o.opens > 0 ? Math.min(o.opens, 1000) : 0;
  const openedAt = finiteTs(o.openedAt);
  if (opens && openedAt) {
    out.opens = (out.opens ?? 0) + opens;
    out.openedAt = Math.max(out.openedAt ?? 0, openedAt);
  }
  return out.reaction || out.saved || out.opens ? out : null;
}

/**
 * Parse persisted / imported JSON. Accepts the `{v,data}` envelope, a bare
 * `{entries}` model, or a v0 `{ ref: reaction }` map. Unknown refs and junk
 * values are dropped.
 */
export function parseSourcePreferences(raw: unknown): SourcePreferences {
  let data = raw;
  if (data && typeof data === "object" && !Array.isArray(data) && "v" in data && "data" in data) {
    data = (data as { data: unknown }).data;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return emptySourcePreferences();
  const o = data as Record<string, unknown>;
  const source = o.entries && typeof o.entries === "object" && !Array.isArray(o.entries) ? (o.entries as Record<string, unknown>) : o;
  const entries: Record<SourceRef, SourcePrefEntry> = {};
  for (const [ref, v] of Object.entries(source)) {
    if (!isSourceRef(ref)) continue;
    const e = parseEntry(v);
    if (e) entries[ref] = e;
  }
  return { version: 1, entries: pruneEntries(entries) };
}

/** Module cache so Discover scan / palette can rank without threading prefs through. */
let cached: SourcePreferences = emptySourcePreferences();

export function getCachedSourcePreferences(): SourcePreferences {
  return cached;
}

export function setCachedSourcePreferences(prefs: SourcePreferences): void {
  cached = prefs;
}
