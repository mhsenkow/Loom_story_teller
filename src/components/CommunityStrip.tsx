"use client";

// =================================================================
// CommunityStrip — what people are loving and saying, above the stories
// =================================================================
// Shows the best-received charts and the freshest comments so people run
// into each other's finds. A loved chart opens as its discover story when
// one matches, otherwise from its saved recipe on the live feed. Links
// switch the grid to the community sorts (favorites / discussed / least
// liked) — the "best vs worst" view.
//
// Titles are never taken from the server: they are this device's own
// story headline, or a plain description built from the recipe's columns.
// =================================================================

import { useMemo } from "react";
import { useLoomStore } from "@/lib/store";
import { socialKey, socialTitleFromLink } from "@/lib/socialKey";
import { formatSocialAgo, formatSocialCount, type CommunitySort } from "@/lib/socialRank";
import { openSourceChart } from "@/lib/openSourceChart";
import { SOURCE_BY_KIND, isSourceKind } from "@/lib/sourceRegistry";
import type { DiscoverStory } from "@/lib/discoverStories";
import type { SocialItem } from "@/lib/socialApi";
import { decodeChartLink } from "@/lib/chartLink";
import { chartKindLabel } from "@/lib/chartKindSearch";

type Props = {
  stories: DiscoverStory[];
  onOpenStory: (story: DiscoverStory) => void;
  onBrowse: (mode: CommunitySort) => void;
  onDismissDiscover: () => void;
};

function sourceLabel(kind: string): string {
  return isSourceKind(kind) ? SOURCE_BY_KIND[kind].label : kind === "wiki" ? "Wikipedia Live" : "Live feed";
}

/** "Bar · max · last 24h" from the saved recipe, so remixes of one story read differently. */
function recipeLabel(link: string | null | undefined): string | null {
  const decoded = link ? decodeChartLink(link) : null;
  if (!decoded) return null;
  const c = decoded.chart;
  return [
    chartKindLabel(c.kind),
    c.yAggregate && c.yAggregate !== "sum" && c.yAggregate !== "count" ? (c.yAggregate === "mean" ? "average" : c.yAggregate) : null,
    decoded.barStackMode ?? null,
    c.timeWindow && c.timeWindow !== "all" ? `last ${c.timeWindow}` : null,
    c.topN ? `top ${c.topN}` : null,
    c.yScale && c.yScale !== "linear" ? `${c.yScale} scale` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CommunityStrip({ stories, onOpenStory, onBrowse, onDismissDiscover }: Props) {
  const enabled = useLoomStore((s) => s.socialEnabled);
  const summary = useLoomStore((s) => s.socialSummary);
  const status = useLoomStore((s) => s.socialStatus);
  const openThread = useLoomStore((s) => s.openSocialThread);

  const storyByKey = useMemo(() => {
    const m = new Map<string, DiscoverStory>();
    for (const s of stories) {
      const k = socialKey(s.kind, s.chart);
      if (!m.has(k)) m.set(k, s);
    }
    return m;
  }, [stories]);

  if (!enabled || status === "offline" || !summary) return null;
  const loved = summary.favorites.slice(0, 3);
  const chatter = summary.recent.slice(0, 3);
  const titleOf = (key: string, link: string | null | undefined) =>
    storyByKey.get(key)?.hook ?? socialTitleFromLink(link) ?? "A community chart";

  const openItem = (item: SocialItem) => {
    const story = storyByKey.get(item.key);
    if (story) return onOpenStory(story);
    // No local story and no way to rebuild it here (e.g. Wikipedia Live): show the conversation.
    if (!item.link || !isSourceKind(item.kind)) return openThread({ key: item.key, title: titleOf(item.key, item.link) });
    onDismissDiscover();
    void openSourceChart(item.kind, item.link);
  };

  if (!loved.length && !chatter.length) {
    return (
      <p className="community-invite">
        <span aria-hidden>▲▼</span> Vote on charts you like or don’t — the most-loved rise to the top for everyone. No account needed.
      </p>
    );
  }

  return (
    <section className="community-strip" aria-labelledby="community-strip-title">
      <header className="community-strip-head">
        <h3 id="community-strip-title">From the community</h3>
        <nav aria-label="Community views" className="community-strip-links">
          <button type="button" onClick={() => onBrowse("community")}>Favorites</button>
          <button type="button" onClick={() => onBrowse("discussed")}>Most discussed</button>
          <button type="button" onClick={() => onBrowse("divisive")}>Divisive</button>
          <button type="button" onClick={() => onBrowse("leastLiked")}>Least liked</button>
        </nav>
      </header>
      <div className="community-strip-body">
        {loved.length > 0 && (
          <ol className="community-loved" aria-label="Most loved charts">
            {loved.map((item) => (
              <li key={item.key} data-social-key={item.key}>
                <button type="button" onClick={() => openItem(item)} title={`${item.up} up · ${item.down} down`}>
                  <span className="community-loved-score" aria-label={`${item.up - item.down} net votes`}>
                    ▲ {formatSocialCount(item.up - item.down)}
                  </span>
                  <span className="community-loved-title">{titleOf(item.key, item.link)}</span>
                  <span className="community-loved-source">
                    {[recipeLabel(item.link), sourceLabel(item.kind)].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {chatter.length > 0 && (
          <ul className="community-chatter" aria-label="Recent comments">
            {chatter.map((c) => {
              const title = titleOf(c.key, c.link);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => openThread({ key: c.key, title, link: c.link ?? undefined })}>
                    <span className="community-chatter-body">“{c.body}”</span>
                    <span className="community-chatter-meta">
                      {c.name} · {formatSocialAgo(c.at)} · on {title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
