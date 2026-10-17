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
