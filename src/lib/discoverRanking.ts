// Quality with diminishing returns: a page should answer different questions.
import type { DiscoverStory } from "./discoverStories";
import { discoverFamily, discoverQuestionKey } from "./discoverChartCatalog";

export function orderDiscoverStories(
  stories: DiscoverStory[],
  scoreOf: (story: DiscoverStory) => number,
  limit = stories.length,
  sourceCap = Infinity,
): DiscoverStory[] {
  const pool = stories
    .map((story) => ({
      story,
      score: scoreOf(story),
      family: discoverFamily(story.chartKind),
      question: discoverQuestionKey(story.kind, story.chart),
      settings: [
        story.chart.rowField ? "facet" : "",
        story.chart.timeWindow && story.chart.timeWindow !== "all"
          ? "window"
          : "",
        story.chart.seriesNormalize ?? "",
        story.chart.rollingWindow ? "smooth" : "",
        story.chart.anomalyHighlight ? "outliers" : "",
        story.chart.barStackMode ?? "",
        story.chart.deltaDisplay ?? "",
        story.chart.emojiField ? "emoji" : story.chart.shapeField ? "shapes" : "",
      ]
        .filter(Boolean)
        .join("|"),
    }))
    .map((item) => ({
      ...item,
      keys: [
        `source:${item.story.kind}`,
        `kind:${item.story.chartKind}`,
        `family:${item.family}`,
        `topic:${item.story.category}`,
        `question:${item.question}`,
        `settings:${item.settings}`,
      ],
    }))
    .sort((a, b) => b.score - a.score || a.story.id.localeCompare(b.story.id));
  const chosen: DiscoverStory[] = [];
  const used = new Set<string>();
  const lifetime = new Map<string, number>();
  const counts = new Map<string, number>();
  const count = (key: string) => counts.get(key) ?? 0;
  let pagePool: typeof pool = [];
  while (chosen.length < Math.min(limit, stories.length)) {
    if (chosen.length % 24 === 0) {
      counts.clear();
      // Bound per-pick work, but always include the best remaining representative
      // of every source, kind and family, even below the score-sorted lookahead.
      pagePool = pool.slice(0, 96);
      const represented = new Set(
        pagePool.flatMap((item) => item.keys.slice(0, 3)),
      );
      for (const item of pool.slice(96)) {
        if (!item.keys.slice(0, 3).some((key) => !represented.has(key)))
          continue;
        pagePool.push(item);
        for (const key of item.keys.slice(0, 3)) represented.add(key);
      }
    }
    let best = -1,
      bestScore = -Infinity;
    for (let i = 0; i < pagePool.length; i++) {
      const item = pagePool[i]!;
      if (
        used.has(item.story.id) ||
        (lifetime.get(item.story.kind) ?? 0) >= sourceCap
      )
        continue;
      const score =
        item.score -
        20 * count(item.keys[0]!) -
        9 * count(item.keys[1]!) -
        5 * count(item.keys[2]!) -
        5 * count(item.keys[3]!) -
        28 * count(item.keys[4]!) -
        (item.settings ? 3 * count(item.keys[5]!) : 0) -
        2 * Math.sqrt(lifetime.get(item.story.kind) ?? 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) {
      // Refill an exhausted shortlist before relaxing any source caps.
      pagePool = pool
        .filter(
          (item) =>
            !used.has(item.story.id) &&
            (lifetime.get(item.story.kind) ?? 0) < sourceCap,
        )
        .slice(0, 96);
      if (!pagePool.length) break;
      continue;
    }
    const item = pagePool.splice(best, 1)[0]!;
    pool.splice(pool.indexOf(item), 1);
    chosen.push(item.story);
    used.add(item.story.id);
    lifetime.set(item.story.kind, (lifetime.get(item.story.kind) ?? 0) + 1);
    for (const key of item.keys) counts.set(key, count(key) + 1);
  }
  return chosen;
}

/** Public tables kept in a capped gallery even when live feeds fill it with variants. */
export const DISCOVER_PACK_LEAD_SLOTS = 8;

/** How many public tables to pull into the opening screen. */
export const DISCOVER_PACKS_ON_FIRST_SCREEN = 4;

const FIRST_SCREEN = 12;

function isPackStory(kind: string): boolean {
  return kind.startsWith("pack:");
}

/**
 * Keep the best headline from each public table inside a capped gallery.
 * Extra variants of a live feed are dropped first. A unique live headline
 * is only dropped when every public-table slot is still empty.
 */
export function keepDiscoverPackLeads(
  selected: DiscoverStory[],
  pool: DiscoverStory[],
  limit: number,
): DiscoverStory[] {
  const best = new Map<string, DiscoverStory>();
  for (const story of pool) {
    if (!isPackStory(story.kind) || !story.headline) continue;
    const prev = best.get(story.kind);
    if (!prev || story.score > prev.score) best.set(story.kind, story);
  }
  const leads = [...best.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, DISCOVER_PACK_LEAD_SLOTS);
  const next = [...selected];
  const have = new Set(next.map((story) => story.kind));
  for (const lead of leads) {
    if (have.has(lead.kind)) continue;
    if (next.length < limit) {
      next.push(lead);
      have.add(lead.kind);
      continue;
    }
    const counts = new Map<string, number>();
    for (const story of next) counts.set(story.kind, (counts.get(story.kind) ?? 0) + 1);
    let drop = -1;
    let worst = Infinity;
    next.forEach((story, index) => {
      if (isPackStory(story.kind)) return;
      const extra = (counts.get(story.kind) ?? 0) >= 2;
      const score = extra ? story.score : story.score + 1_000;
      if (score < worst) {
        worst = score;
        drop = index;
      }
    });
    if (drop < 0) break;
    next.splice(drop, 1, lead);
    have.add(lead.kind);
  }
  return next;
}

/**
 * iPad and iPhone keep 120 cards. Above this, the desktop gallery is large
 * enough that every public-table variant can stay.
 */
const PACK_GALLERY_BALANCE_LIMIT = 200;

/** Share of a short gallery reserved for public tables. The rest stays live. */
const PACK_GALLERY_SHARE = 0.4;

/** Charts kept per public table on iPad / iPhone. */
const PACK_VARIANTS_KEPT = 2;

/**
 * On a short gallery, keep a couple of charts per public table and fill the
 * rest with live feeds. Desktop keeps the diversity pick as-is.
 */
export function balanceDiscoverPacks(
  selected: DiscoverStory[],
  pool: DiscoverStory[],
  limit: number,
): DiscoverStory[] {
  if (limit > PACK_GALLERY_BALANCE_LIMIT) return selected;
  const packBudget = Math.max(1, Math.round(limit * PACK_GALLERY_SHARE));
  const counts = new Map<string, number>();
  const keptPacks: DiscoverStory[] = [];
  const rankedPacks = pool
    .filter((story) => isPackStory(story.kind))
    .sort(
      (a, b) =>
        Number(Boolean(b.headline)) - Number(Boolean(a.headline)) ||
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );
  for (const story of rankedPacks) {
    const n = counts.get(story.kind) ?? 0;
    if (n >= PACK_VARIANTS_KEPT || keptPacks.length >= packBudget) continue;
    counts.set(story.kind, n + 1);
    keptPacks.push(story);
  }
  const room = Math.max(0, limit - keptPacks.length);
  const selectedLive = new Set(
    selected.filter((story) => !isPackStory(story.kind)).map((story) => story.id),
  );
  const maxLive = Math.max(2, Math.ceil(limit * 0.2));
  const liveCounts = new Map<string, number>();
  const keptLive: DiscoverStory[] = [];
  const rankedLive = pool
    .filter((story) => !isPackStory(story.kind))
    .sort(
      (a, b) =>
        Number(selectedLive.has(b.id)) - Number(selectedLive.has(a.id)) ||
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );
  for (const story of rankedLive) {
    if (keptLive.length >= room) break;
    const n = liveCounts.get(story.kind) ?? 0;
    if (n >= maxLive) continue;
    liveCounts.set(story.kind, n + 1);
    keptLive.push(story);
  }
  return [...keptPacks, ...keptLive];
}

/**
 * Opening screen mixes live feeds with a few public tables. Every other
 * table gets its best card next, then the live gallery, then extra table charts.
 */
export function surfaceDiscoverPacks<T extends { stories: { kind: string }[] }>(
  groups: T[],
  want = DISCOVER_PACKS_ON_FIRST_SCREEN,
  within = FIRST_SCREEN,
): T[] {
  if (groups.length <= 1) return groups;
  const isPack = (group: T) => isPackStory(group.stories[0]?.kind ?? "");
  const packs: T[] = [];
  const live: T[] = [];
  for (const group of groups) (isPack(group) ? packs : live).push(group);
  if (!packs.length || !live.length) return groups;

  const openingPacks = packs.slice(0, Math.max(0, want));
  const openingLive = live.slice(0, Math.max(0, within - openingPacks.length));
  const woven: T[] = [];
  let packIndex = 0;
  openingLive.forEach((group, index) => {
    woven.push(group);
    if (packIndex < openingPacks.length && (index + 1) % 2 === 0) {
      woven.push(openingPacks[packIndex++]!);
    }
  });
  while (packIndex < openingPacks.length) woven.push(openingPacks[packIndex++]!);

  const seen = new Set(openingPacks.map((group) => group.stories[0]?.kind ?? ""));
  const intro: T[] = [];
  const laterPacks: T[] = [];
  for (const group of packs.slice(openingPacks.length)) {
    const kind = group.stories[0]?.kind ?? "";
    if (kind && !seen.has(kind)) {
      seen.add(kind);
      intro.push(group);
    } else laterPacks.push(group);
  }
  return [...woven, ...intro, ...live.slice(openingLive.length), ...laterPacks];
}

/** Feature quality, with space between picks and no repeated source or question. */
export function discoverSpotlights(stories: DiscoverStory[]): Set<string> {
  const selected = new Set<string>(),
    sources = new Set<string>(),
    families = new Set<string>();
  for (let i = 0; i < stories.length; i++) {
    const story = stories[i]!;
    const family = discoverFamily(story.chartKind);
    if (i > 0 && (i % 8 > 2 || selected.size >= Math.ceil((i + 1) / 8)))
      continue;
    if (
      sources.has(story.kind) ||
      families.has(family) ||
      (story.quality != null && story.quality < 72)
    )
      continue;
    selected.add(story.id);
    sources.add(story.kind);
    families.add(family);
  }
  return selected;
}
