// =================================================================
// Daily discovery cache — one IndexedDB record, one copy per feed.
// Recent opens reuse prepared charts and snapshots without a network
// scan. A new local calendar day makes the results eligible to refresh.
// =================================================================

import type { DiscoverStory } from "./discoverStories";
import { CHART_KIND_OPTIONS } from "./recommendations";
import { qualifyDiscoverChart } from "./discoverChartQuality";
import {
  SOURCE_BY_KIND,
  SOURCE_DEFS,
  SOURCE_EXPLORE_ROWS,
} from "./sourceRegistry";

const DATABASE = "loom-discovery";
const STORE = "daily";
const KEY = "latest";
const MAX_AGE = 7 * 86_400_000;

type FeedSnapshot = Pick<
  DiscoverStory,
  "kind" | "stats" | "sample" | "capturedAt" | "snapshotCached"
>;
type CachedIdea = Omit<
  DiscoverStory,
  "kind" | "stats" | "sample" | "capturedAt" | "snapshotCached"
> & { feed: number };
export interface DailyDiscoverCache {
  version: 1;
  algorithm?: number;
  savedAt: number;
  feeds: FeedSnapshot[];
  ideas: CachedIdea[];
}

export function isDiscoverCacheFresh(
  savedAt: number | null,
  now = Date.now(),
): boolean {
  if (savedAt == null || savedAt > now || now - savedAt > 25 * 3_600_000)
    return false;
  return new Date(savedAt).toDateString() === new Date(now).toDateString();
}

export function packDiscoverCache(
  stories: DiscoverStory[],
  savedAt = Date.now(),
): DailyDiscoverCache {
  const feeds: FeedSnapshot[] = [];
  const feedIndices = new Map<DiscoverStory["sample"], number>();
  const ideas = stories.map(
    ({ kind, stats, sample, capturedAt, snapshotCached, ...idea }) => {
      let feed = feedIndices.get(sample);
      if (feed == null) {
        feed = feeds.length;
        feedIndices.set(sample, feed);
        feeds.push({ kind, stats, sample, capturedAt, snapshotCached });
      }
      return { ...idea, feed };
    },
  );
  return { version: 1, algorithm: 3, savedAt, feeds, ideas };
}

/** Reject incompatible/corrupt caches and keep every variant on its own feed. */
export function unpackDiscoverCache(
  raw: unknown,
  now = Date.now(),
): { stories: DiscoverStory[]; savedAt: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as DailyDiscoverCache;
  if (
    entry.version !== 1 ||
    !Number.isFinite(entry.savedAt) ||
    entry.savedAt > now + 300_000 ||
    now - entry.savedAt > MAX_AGE ||
    !Array.isArray(entry.feeds) ||
    entry.feeds.length > SOURCE_DEFS.length + 1 ||
    !Array.isArray(entry.ideas) ||
    entry.ideas.length > 10_000
  )
    return null;
  const validKind = (kind: unknown): kind is DiscoverStory["kind"] =>
    typeof kind === "string" &&
    (kind === "wiki" || Object.hasOwn(SOURCE_BY_KIND, kind));
  const feeds = entry.feeds.map((feed) => {
    if (
      !feed ||
      !validKind(feed.kind) ||
      !Array.isArray(feed.stats) ||
      !feed.sample
    )
      return null;
    const { columns, types, rows, total_rows } = feed.sample;
    if (
      !Array.isArray(columns) ||
      !columns.length ||
      columns.length > 256 ||
      !columns.every((c) => typeof c === "string") ||
      !Array.isArray(types) ||
      !types.every((t) => typeof t === "string") ||
      !Array.isArray(rows) ||
      rows.length > SOURCE_EXPLORE_ROWS ||
      !Number.isFinite(total_rows) ||
      total_rows < 0 ||
      !rows.every((r) => Array.isArray(r) && r.length <= columns.length)
    )
      return null;
    if (
      !feed.stats.every(
        (column) =>
          column &&
          typeof column.name === "string" &&
          typeof column.data_type === "string",
      )
    )
      return null;
    return feed;
  });
  const kinds = new Set<string>(
    CHART_KIND_OPTIONS.map((option) => option.value),
  );
  const stories: DiscoverStory[] = [];
  for (const idea of entry.ideas) {
    if (!idea || !Number.isInteger(idea.feed)) continue;
    const feed = feeds[idea.feed];
    if (
      !feed ||
      typeof idea.id !== "string" ||
      typeof idea.hook !== "string" ||
      typeof idea.blurb !== "string" ||
      typeof idea.category !== "string" ||
      !Number.isFinite(idea.score) ||
      (idea.dataChangedAt != null &&
        (!Number.isFinite(idea.dataChangedAt) ||
          idea.dataChangedAt > now + 60_000)) ||
      (idea.quality != null &&
        (!Number.isFinite(idea.quality) ||
          idea.quality < 0 ||
          idea.quality > 100)) ||
      (idea.insight != null &&
        (typeof idea.insight.label !== "string" ||
          typeof idea.insight.detail !== "string" ||
          !Number.isFinite(idea.insight.strength) ||
          idea.insight.strength < 0 ||
          idea.insight.strength > 1)) ||
      !idea.chart ||
      !kinds.has(idea.chart.kind) ||
      typeof idea.chart.id !== "string" ||
      typeof idea.chart.xField !== "string" ||
      typeof idea.chart.title !== "string" ||
      typeof idea.chart.subtitle !== "string" ||
      ![
        idea.chart.xField,
        idea.chart.yField,
        idea.chart.colorField,
        idea.chart.sizeField,
        idea.chart.rowField,
        idea.chart.y2Field,
        idea.chart.timeWindowField,
        idea.chart.zField,
        idea.chart.timeField,
        idea.chart.trailId,
        idea.chart.shapeField,
        idea.chart.emojiField,
        idea.chart.opacityField,
        idea.chart.glowField,
        idea.chart.outlineField,
      ].every(
        (field) =>
          field == null ||
          (typeof field === "string" && feed.sample.columns.includes(field)),
      )
    )
      continue;
    const { feed: feedIndex, ...story } = idea;
    void feedIndex;
    const chart = qualifyDiscoverChart(feed.kind, idea.chart);
    if (!chart) continue;
    stories.push({
      ...story,
      ...feed,
      chart,
      hook: idea.hook === idea.chart.title ? chart.title : idea.hook,
      blurb: chart === idea.chart ? idea.blurb : chart.subtitle,
      streamPath: `stream://${feed.kind}`,
      fileName:
        feed.kind === "wiki"
          ? "Wikipedia Live"
          : SOURCE_BY_KIND[feed.kind].fileName,
      chartKind: idea.chart.kind,
      snapshotCached: true,
    });
  }
  // Old picks stay visible while the expanded catalog refreshes in the background.
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const savedAt =
    entry.algorithm === 3
      ? entry.savedAt
      : Math.min(entry.savedAt, startOfDay - 1);
  return stories.length ? { stories, savedAt } : null;
}

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(db);
    };
    const timeout = setTimeout(() => finish(null), 1_000);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => finish(request.result);
    request.onerror = request.onblocked = () => finish(null);
  });
}

export async function readDiscoverDailyCache(): Promise<{
  stories: DiscoverStory[];
  savedAt: number;
} | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openCache();
    if (!db) return null;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const request = db!
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return unpackDiscoverCache(raw);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function writeDiscoverDailyCache(
  stories: DiscoverStory[],
  savedAt = Date.now(),
): Promise<void> {
  if (!stories.length) return;
  let db: IDBDatabase | null = null;
  try {
    db = await openCache();
    if (!db) return;
    const packed = packDiscoverCache(stories, savedAt);
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const previous = store.get(KEY);
      previous.onsuccess = () => {
        if (!previous.result || previous.result.savedAt <= savedAt)
          store.put(packed, KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* Private mode/quota failures leave the in-memory cache usable. */
  } finally {
    db?.close();
  }
}
