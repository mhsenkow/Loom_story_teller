// Compare content separately from check times; repeated polls are quiet.
import type { DiscoverKind, DiscoverStory } from "./discoverStories";
import type { QueryResult } from "./queryTypes";
import { discoverRecipeKey } from "./discoverChartCatalog";

const snapshots = new WeakMap<QueryResult, string>();
const recipes = new WeakMap<DiscoverStory["chart"], string>();
export function discoverSnapshotFingerprint(sample: QueryResult): string {
  const hit = snapshots.get(sample);
  if (hit) return hit;
  let sum = 0,
    xor = 0;
  for (const row of sample.rows) {
    let h = 2166136261;
    const text = JSON.stringify(row);
    for (let i = 0; i < text.length; i++)
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    sum = (sum + (h >>> 0)) >>> 0;
    xor ^= h;
  }
  const key = JSON.stringify([
    sample.columns,
    sample.types,
    sample.total_rows,
    sample.rows.length,
    sum,
    xor >>> 0,
  ]);
  snapshots.set(sample, key);
  return key;
}

export function changedDiscoverKinds(
  previous: DiscoverStory[],
  next: DiscoverStory[],
): Set<DiscoverKind> {
  const signature = (stories: DiscoverStory[]) => {
    const feeds = new Map<
      DiscoverKind,
      { sample: string; recipes: string[] }
    >();
    for (const story of stories) {
      const feed = feeds.get(story.kind) ?? {
        sample: discoverSnapshotFingerprint(story.sample),
        recipes: [],
      };
      let recipe = recipes.get(story.chart);
      if (!recipe) {
        recipe = discoverRecipeKey(story.chart);
        recipes.set(story.chart, recipe);
      }
      feed.recipes.push(recipe);
      feeds.set(story.kind, feed);
    }
    return new Map(
      [...feeds].map(([kind, feed]) => [
        kind,
        JSON.stringify([feed.sample, feed.recipes.sort()]),
      ]),
    );
  };
  const before = signature(previous),
    after = signature(next);
  return new Set(
    [...new Set([...before.keys(), ...after.keys()])].filter(
      (kind) => before.get(kind) !== after.get(kind),
    ),
  );
}

export function stampDiscoverDataChanges(
  previous: DiscoverStory[],
  next: DiscoverStory[],
): DiscoverStory[] {
  if (!previous.length) return next;
  const old = new Map(previous.map((story) => [story.kind, story]));
  return next.map((story) => {
    const before = old.get(story.kind);
    const changed =
      !before ||
      discoverSnapshotFingerprint(before.sample) !==
        discoverSnapshotFingerprint(story.sample);
    return {
      ...story,
      dataChangedAt: changed ? story.capturedAt : before?.dataChangedAt,
    };
  });
}

/** Refresh the check labels without repainting/reordering identical chart snapshots. */
export function withDiscoverCheckTimes(
  stories: DiscoverStory[],
  latest: DiscoverStory[],
): DiscoverStory[] {
  const feeds = new Map(latest.map((s) => [s.kind, s]));
  return stories.map((story) => {
    const fresh = feeds.get(story.kind);
    if (
      !fresh ||
      (fresh.capturedAt === story.capturedAt &&
        fresh.snapshotCached === story.snapshotCached)
    )
      return story;
    return {
      ...story,
      capturedAt: fresh.capturedAt,
      snapshotCached: fresh.snapshotCached,
    };
  });
}
