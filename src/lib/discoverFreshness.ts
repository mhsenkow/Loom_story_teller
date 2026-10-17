// =================================================================
// Discovery freshness — source cadence, honest ages and bounded upkeep.
// Observation dates belong to the data; capture dates describe our check.
// =================================================================

import type { DiscoverKind, DiscoverStory } from "./discoverStories";
import { effectivePollIntervalMs } from "./sourceRegistry";

export function discoverRefreshInterval(kind: DiscoverKind): number {
  if (kind === "wiki") return 60_000;
  const cadence = effectivePollIntervalMs(kind);
  return cadence > 0 ? Math.max(60_000, cadence) : 86_400_000;
}

export function discoverFreshness(
  story: DiscoverStory,
  now = Date.now(),
): {
  due: boolean;
  label: string;
  title: string;
} {
  const captured = story.capturedAt;
  if (captured == null || !Number.isFinite(captured) || captured > now + 60_000)
    return {
      due: true,
      label: "Check time unknown",
      title: "This saved snapshot has no verified check time.",
    };
  const age = Math.max(0, now - captured);
  const minutes = Math.floor(age / 60_000);
  const relative =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ago`
          : `${Math.floor(minutes / 1440)}d ago`;
  return {
    due: age >= discoverRefreshInterval(story.kind),
    label: `Checked ${relative}`,
    title: `Snapshot checked ${new Date(captured).toLocaleString()}. Observation dates are shown separately.`,
  };
}

/** Prioritize displayed feeds; failed feeds wait five minutes before retrying. */
export function dueDiscoverKinds(
  stories: DiscoverStory[],
  candidates: readonly DiscoverKind[],
  attempts: ReadonlyMap<DiscoverKind, number>,
  now = Date.now(),
  limit = 6,
): DiscoverKind[] {
  const first = new Map(stories.map((story) => [story.kind, story]));
  return [...new Set(candidates)]
    .filter((kind) => {
      const story = first.get(kind);
      const lastAttempt = attempts.get(kind);
      return (
        story &&
        discoverFreshness(story, now).due &&
        (lastAttempt == null ||
          now - lastAttempt >= Math.max(300_000, discoverRefreshInterval(kind)))
      );
    })
    .slice(0, limit);
}

/** Reserve half the batch for the oldest due feeds so visible fast feeds cannot starve the catalog. */
export function planDiscoverRefresh(
  stories: DiscoverStory[],
  visible: readonly DiscoverKind[],
  catalog: readonly DiscoverKind[],
  attempts: ReadonlyMap<DiscoverKind, number>,
  now = Date.now(),
  limit = 6,
): DiscoverKind[] {
  if (limit <= 0) return [];
  const feeds = new Map(stories.map((s) => [s.kind, s]));
  const due = [...new Set(catalog)].filter((kind) => {
    const story = feeds.get(kind),
      attempt = attempts.get(kind);
    return (
      (!story || discoverFreshness(story, now).due) &&
      (attempt == null ||
        now - attempt >= Math.max(300_000, discoverRefreshInterval(kind)))
    );
  });
  const deadline = (kind: DiscoverKind) => {
    const story = feeds.get(kind);
    return Math.max(
      (story?.capturedAt ?? 0) + discoverRefreshInterval(kind),
      (attempts.get(kind) ?? 0) + 300_000,
    );
  };
  const oldest = due.sort(
    (a, b) => deadline(a) - deadline(b) || a.localeCompare(b),
  );
  const selected = oldest.slice(0, Math.ceil(limit / 2));
  for (const kind of [...visible, ...oldest])
    if (
      oldest.includes(kind) &&
      !selected.includes(kind) &&
      selected.length < limit
    )
      selected.push(kind);
  return selected;
}
