"use client";

// =================================================================
// FeedBrowser — searchable, filterable live feeds + curated packs
// =================================================================
// One search box over `sourceCatalog()`, facet chips (Topic · Where ·
// Freshness · Saved), sort (For you / Freshest / A–Z), a Saved group
// above the registry groups, and a reversible "N hidden · Show" toggle.
// Ordering lives in lib/feedBrowser.ts.
// =================================================================

import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { useLoomStore } from "@/lib/store";
import { sourceCatalog, type CatalogEntry, type CatalogFreshness } from "@/lib/sourceCatalog";
import { SOURCE_BY_KIND, SOURCE_TOPICS, SOURCE_TOPIC_LABELS, type SourceTopic } from "@/lib/sourceRegistry";
import { feedKindFromRef, parseSourceRef } from "@/lib/sourceRef";
import { CURATED_OPEN_PACKS, type CuratedPack } from "@/lib/curatedPacks";
import {
  browseFeeds,
  DEFAULT_FEED_BROWSER_STATE,
  FEED_FRESHNESS_LABELS,
  FEED_WHERE_LABELS,
  feedSortLabel,
  filtersActive,
  type FeedBrowserState,
  type FeedSort,
  type FeedWhere,
} from "@/lib/feedBrowser";
import { SourceCard } from "./SourceCard";
import { WikiStreamSection } from "./WikiStreamSection";

const PACK_BY_ID = new Map(CURATED_OPEN_PACKS.map((p) => [p.id, p]));

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`shrink-0 text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded-full border transition-colors ${
        on ? "border-loom-accent bg-loom-accent/15 text-loom-accent" : "border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
      }`}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function FeedBrowser({ renderPack }: { renderPack: (pack: CuratedPack) => ReactNode }) {
  const prefs = useLoomStore((s) => s.sourcePrefs);
  const statuses = useLoomStore((s) => s.sourceStatuses);
  const [state, setState] = useState<FeedBrowserState>(DEFAULT_FEED_BROWSER_STATE);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const query = useDeferredValue(state.query);
  const searchId = useId();
  const sortId = useId();
  const patch = (p: Partial<FeedBrowserState>) => setState((s) => ({ ...s, ...p }));

  const result = useMemo(
    () =>
      browseFeeds(sourceCatalog(), { ...state, query }, prefs, {
        lastUpdated: (e: CatalogEntry) => {
          const kind = feedKindFromRef(e.ref);
          const st = kind ? statuses[kind] : undefined;
          return st?.last_success_at ?? st?.snapshot_captured_at ?? null;
        },
      }),
    [state, query, prefs, statuses],
  );
  const active = filtersActive(state);
  const clear = () => setState((s) => ({ ...DEFAULT_FEED_BROWSER_STATE, sort: s.sort }));

  const renderEntry = (e: CatalogEntry) => {
    const p = parseSourceRef(e.ref);
    if (!p) return null;
    if (p.scheme === "pack") {
      const pack = PACK_BY_ID.get(p.id);
      return pack ? <div key={e.ref}>{renderPack(pack)}</div> : null;
    }
    if (p.id === "wiki") return <WikiStreamSection key={e.ref} />;
    const def = SOURCE_BY_KIND[p.id as keyof typeof SOURCE_BY_KIND];
    return def ? <SourceCard key={e.ref} def={def} /> : null;
  };

  return (
    <div className="space-y-2.5" data-testid="feed-browser">
      <div className="space-y-2">
        <div className="flex gap-1.5 items-end">
          <div className="flex-1 min-w-0">
            <label htmlFor={searchId} className="sr-only">
              Search feeds and packs
            </label>
            <input
              id={searchId}
              type="search"
              aria-label="Search feeds and packs"
              value={state.query}
              onChange={(e) => patch({ query: e.target.value })}
              placeholder="Search feeds, topics, columns…"
              className="loom-input w-full text-xs py-1.5"
              enterKeyHint="search"
            />
          </div>
          <label htmlFor={sortId} className="sr-only">
            Sort feeds
          </label>
          <select
            id={sortId}
            aria-label="Sort feeds"
            value={state.sort}
            onChange={(e) => patch({ sort: e.target.value as FeedSort })}
            className="loom-input text-xs py-1.5 w-[6.5rem] shrink-0"
          >
            {(["foryou", "freshest", "az"] as FeedSort[]).map((s) => (
              <option key={s} value={s}>
                {feedSortLabel(s, prefs)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter feeds">
          <Chip on={topicsOpen || state.topics.length > 0} onClick={() => setTopicsOpen((o) => !o)} label="Topic filters">
            Topic{state.topics.length ? ` · ${state.topics.length}` : ""} {topicsOpen ? "−" : "+"}
          </Chip>
          {(Object.keys(FEED_WHERE_LABELS) as FeedWhere[]).map((w) => (
            <Chip key={w} on={state.where.includes(w)} onClick={() => patch({ where: toggle(state.where, w) })}>
              {FEED_WHERE_LABELS[w]}
            </Chip>
          ))}
          {(Object.keys(FEED_FRESHNESS_LABELS) as CatalogFreshness[]).map((f) => (
            <Chip key={f} on={state.freshness.includes(f)} onClick={() => patch({ freshness: toggle(state.freshness, f) })}>
              {FEED_FRESHNESS_LABELS[f]}
            </Chip>
          ))}
          <Chip on={state.savedOnly} onClick={() => patch({ savedOnly: !state.savedOnly })}>
            Saved
          </Chip>
        </div>
        {topicsOpen && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Topics">
            {SOURCE_TOPICS.map((t: SourceTopic) => (
              <Chip key={t} on={state.topics.includes(t)} onClick={() => patch({ topics: toggle(state.topics, t) })}>
                {SOURCE_TOPIC_LABELS[t]}
              </Chip>
            ))}
          </div>
        )}
        {(active || result.hiddenCount > 0 || state.showHidden) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-loom-muted" role="status">
            <span>
              {result.total} {result.total === 1 ? "source" : "sources"}
            </span>
            {(result.hiddenCount > 0 || state.showHidden) && (
              <button
                type="button"
                onClick={() => patch({ showHidden: !state.showHidden })}
                className="underline underline-offset-2 hover:text-loom-accent max-md:min-h-9"
              >
                {state.showHidden ? "Hide hidden again" : `${result.hiddenCount} hidden · Show`}
              </button>
            )}
            {active && (
              <button type="button" onClick={clear} className="underline underline-offset-2 hover:text-loom-accent max-md:min-h-9">
                Clear filters
              </button>
            )}
          </p>
        )}
      </div>
      {result.groups.map((g) => (
        <div key={g.id} className="space-y-2.5" data-feed-group={g.id}>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-loom-muted pt-1">
            {g.label}
          </h4>
          {g.entries.map(renderEntry)}
        </div>
      ))}
      {result.total === 0 && (
        <p className="text-2xs text-loom-muted py-2">
          No feeds or packs match.{" "}
          {active && (
            <button type="button" onClick={clear} className="underline underline-offset-2 hover:text-loom-accent">
              Clear filters
            </button>
          )}
        </p>
      )}
    </div>
  );
}
