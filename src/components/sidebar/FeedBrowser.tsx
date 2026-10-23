"use client";

// =================================================================
// FeedBrowser — searchable, filterable live feeds + curated packs
// =================================================================
// One search box over `sourceCatalog()`, facet chips (Topic · Where ·
// Freshness · Saved), sort (For you / Freshest / A–Z), a Saved group
// above the registry groups, and a reversible "N hidden · Show" toggle.
// Digest = newspaper leads; Directory = the full grouped listing.
// Ordering lives in lib/feedBrowser.ts.
// =================================================================

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLoomStore } from "@/lib/store";
import {
  sourceCatalog,
  type CatalogEntry,
  type CatalogFreshness,
} from "@/lib/sourceCatalog";
import {
  SOURCE_BY_KIND,
  SOURCE_TOPICS,
  SOURCE_TOPIC_LABELS,
  type SourceTopic,
} from "@/lib/sourceRegistry";
import { feedKindFromRef, parseSourceRef } from "@/lib/sourceRef";
import { CURATED_OPEN_PACKS, type CuratedPack } from "@/lib/curatedPacks";
import {
  browseFeeds,
  DEFAULT_FEED_BROWSER_STATE,
  digestEntries,
  FEED_FRESHNESS_LABELS,
  FEED_WHERE_LABELS,
  feedSortLabel,
  filtersActive,
  type FeedBrowserState,
  type FeedSort,
  type FeedWhere,
} from "@/lib/feedBrowser";
import { isFeedResting, loadFeedHealth } from "@/lib/sourceHealth";
import { SourceCard } from "./SourceCard";
import { WikiStreamSection } from "./WikiStreamSection";

const PACK_BY_ID = new Map(CURATED_OPEN_PACKS.map((p) => [p.id, p]));

function DigestIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 6h16M4 11h10M4 16h16M4 21h7" />
    </svg>
  );
}

function DirectoryIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r=".8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r=".8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

type FeedView = "digest" | "directory";

function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`shrink-0 text-2xs px-2 py-0.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded-full border transition-colors ${
        on
          ? "border-loom-accent bg-loom-accent/15 text-loom-accent"
          : "border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
      }`}
    >
      {children}
    </button>
  );
}

function FilterMenu({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      ref={ref}
      className="library-filter-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={`${label}: ${value}`}
        data-active={active || undefined}
      >
        <span>{value}</span>
        <span aria-hidden>⌄</span>
      </summary>
      <div className="library-filter-options" role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function digestKicker(entry: CatalogEntry): string {
  const t = entry.topics[0];
  return t ? SOURCE_TOPIC_LABELS[t] : entry.type === "pack" ? "Pack" : "Feed";
}

export function FeedBrowser({
  renderPack,
  collectionControl,
  action,
  expanded = false,
}: {
  renderPack: (pack: CuratedPack) => ReactNode;
  collectionControl?: ReactNode;
  action?: ReactNode;
  /** Wide Data region → default Digest; narrow rail → Directory. */
  expanded?: boolean;
}) {
  const prefs = useLoomStore((s) => s.sourcePrefs);
  const statuses = useLoomStore((s) => s.sourceStatuses);
  const feedHealth = useLoomStore((s) => s.feedHealth);
  const [state, setState] = useState<FeedBrowserState>(
    DEFAULT_FEED_BROWSER_STATE,
  );
  const [view, setView] = useState<FeedView>(expanded ? "digest" : "directory");
  const query = useDeferredValue(state.query);
  const searchId = useId();
  const sortId = useId();
  const patch = (p: Partial<FeedBrowserState>) =>
    setState((s) => ({ ...s, ...p }));

  useEffect(() => {
    void loadFeedHealth();
  }, []);

  const lastUpdated = useCallback(
    (e: CatalogEntry) => {
      const kind = feedKindFromRef(e.ref);
      const st = kind ? statuses[kind] : undefined;
      return st?.last_success_at ?? st?.snapshot_captured_at ?? null;
    },
    [statuses],
  );

  const result = useMemo(
    () =>
      browseFeeds(sourceCatalog(), { ...state, query }, prefs, { lastUpdated }),
    [state, query, prefs, lastUpdated],
  );
  const leads = useMemo(
    () =>
      digestEntries(sourceCatalog(), prefs, {
        fromBrowse: result,
        lastUpdated,
        limit: expanded ? 6 : 4,
        // Leads are “worth opening now” — never a feed that's been down for hours.
        skip: (e) => {
          const kind = feedKindFromRef(e.ref);
          return !!kind && isFeedResting(kind, feedHealth);
        },
      }),
    [result, prefs, lastUpdated, expanded, feedHealth],
  );
  const active = filtersActive(state);
  const clear = () =>
    setState((s) => ({ ...DEFAULT_FEED_BROWSER_STATE, sort: s.sort }));

  const renderEntry = (e: CatalogEntry, digest = false) => {
    const p = parseSourceRef(e.ref);
    if (!p) return null;
    if (p.scheme === "pack") {
      const pack = PACK_BY_ID.get(p.id);
      if (!pack) return null;
      return (
        <div
          key={e.ref}
          className={`library-source-tile ${digest ? "feed-digest-item" : ""}`}
        >
          {digest && <p className="discover-kicker">{digestKicker(e)}</p>}
          {renderPack(pack)}
        </div>
      );
    }
    if (p.id === "wiki") {
      return (
        <div
          key={e.ref}
          className={`library-source-tile ${digest ? "feed-digest-item" : ""}`}
        >
          {digest && <p className="discover-kicker">{digestKicker(e)}</p>}
          <WikiStreamSection />
        </div>
      );
    }
    const def = SOURCE_BY_KIND[p.id as keyof typeof SOURCE_BY_KIND];
    if (!def) return null;
    return (
      <div
        key={e.ref}
        className={`library-source-tile ${digest ? "feed-digest-item" : ""}`}
      >
        {digest && <p className="discover-kicker">{digestKicker(e)}</p>}
        <SourceCard def={def} />
      </div>
    );
  };

  return (
    <div
      className="library-feed-workspace"
      data-testid="feed-browser"
      data-feed-view={view}
    >
      <header className="library-feed-header">
        <div className="library-feed-masthead">
          <h2>Discover.</h2>
          <div className="library-sentence">
            {collectionControl ? (
              <span className="library-sentence-phrase">
                <span className="library-sentence-lead">showing</span>
                {collectionControl}
              </span>
            ) : null}
            <span className="library-sentence-phrase">
              <span aria-hidden>{collectionControl ? "in" : "showing"}</span>
              <FilterMenu
                label="Topic"
                value={
                  state.topics.length === 1
                    ? SOURCE_TOPIC_LABELS[state.topics[0]]
                    : state.topics.length
                      ? `${state.topics.length} topics`
                      : "All topics"
                }
                active={state.topics.length > 0}
              >
                {SOURCE_TOPICS.map((t: SourceTopic) => (
                  <Chip
                    key={t}
                    on={state.topics.includes(t)}
                    onClick={() => patch({ topics: toggle(state.topics, t) })}
                  >
                    {SOURCE_TOPIC_LABELS[t]}
                  </Chip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>from</span>
              <FilterMenu
                label="Where"
                value={
                  state.where.length === 1
                    ? FEED_WHERE_LABELS[state.where[0]]
                    : state.where.length
                      ? `${state.where.length} regions`
                      : "Anywhere"
                }
                active={state.where.length > 0}
              >
                {(Object.keys(FEED_WHERE_LABELS) as FeedWhere[]).map((w) => (
                  <Chip
                    key={w}
                    on={state.where.includes(w)}
                    onClick={() => patch({ where: toggle(state.where, w) })}
                  >
                    {FEED_WHERE_LABELS[w]}
                  </Chip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>updated</span>
              <FilterMenu
                label="Updates"
                value={
                  state.freshness.length === 1
                    ? FEED_FRESHNESS_LABELS[state.freshness[0]]
                    : state.freshness.length
                      ? `${state.freshness.length} cadences`
                      : "Any cadence"
                }
                active={state.freshness.length > 0}
              >
                {(Object.keys(FEED_FRESHNESS_LABELS) as CatalogFreshness[]).map(
                  (f) => (
                    <Chip
                      key={f}
                      on={state.freshness.includes(f)}
                      onClick={() =>
                        patch({ freshness: toggle(state.freshness, f) })
                      }
                    >
                      {FEED_FRESHNESS_LABELS[f]}
                    </Chip>
                  ),
                )}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>by</span>
              <label htmlFor={sortId}>
                <span className="sr-only">Sort feeds</span>
                <select
                  id={sortId}
                  value={state.sort}
                  onChange={(e) => patch({ sort: e.target.value as FeedSort })}
                >
                  {(["foryou", "freshest", "az"] as FeedSort[]).map((s) => (
                    <option key={s} value={s}>
                      {feedSortLabel(s, prefs)}
                    </option>
                  ))}
                </select>
              </label>
            </span>
            {active && (
              <button
                type="button"
                className="discover-clear-inline"
                onClick={clear}
              >
                Clear
              </button>
            )}
          </div>
          <div className="library-feed-tools">
            <div
              className="discover-layout-picker"
              role="group"
              aria-label="Feed layout"
            >
              <button
                type="button"
                aria-pressed={view === "digest"}
                aria-label="Digest view"
                title="Digest: a few picks worth opening"
                onClick={() => setView("digest")}
              >
                <DigestIcon />
                <span className="discover-layout-label">Digest</span>
              </button>
              <button
                type="button"
                aria-pressed={view === "directory"}
                aria-label="Directory view"
                title="Directory: every matching source"
                onClick={() => setView("directory")}
              >
                <DirectoryIcon />
                <span className="discover-layout-label">List</span>
              </button>
            </div>
            <button
              type="button"
              className="discover-icon-button"
              aria-pressed={state.markedOnly}
              aria-label="Marked only"
              title={
                state.markedOnly
                  ? "Showing hearted, marked, and curious sources"
                  : "Only sources you’ve marked"
              }
              onClick={() => patch({ markedOnly: !state.markedOnly })}
            >
              <span aria-hidden>{state.markedOnly ? "♥" : "♡"}</span>
            </button>
            {action}
          </div>
        </div>
        {(result.hiddenCount > 0 || state.showHidden) && (
          <p className="library-feed-status" role="status">
            <span>
              {result.total} {result.total === 1 ? "source" : "sources"}
            </span>
            <button
              type="button"
              onClick={() => patch({ showHidden: !state.showHidden })}
              className="underline underline-offset-2 hover:text-loom-accent max-md:min-h-9"
            >
              {state.showHidden
                ? "Hide hidden again"
                : `${result.hiddenCount} hidden · Show`}
            </button>
          </p>
        )}
      </header>

      <div
        className="library-feed-results"
        tabIndex={0}
        aria-label="Dataset results"
      >
        {view === "digest" ? (
          <div className="feed-digest space-y-3" data-testid="feed-digest">
            <div className="library-grid-heading">
              <h3>Worth exploring</h3>
              <span>{leads.length} picks for you</span>
            </div>
            <div className="library-source-grid">
              {leads.map((e) => renderEntry(e, true))}
            </div>
            {leads.length === 0 && (
              <p className="text-2xs text-loom-muted py-2">
                No feeds match.{" "}
                {active && (
                  <button
                    type="button"
                    onClick={clear}
                    className="underline underline-offset-2 hover:text-loom-accent"
                  >
                    Clear filters
                  </button>
                )}
              </p>
            )}
            {leads.length > 0 && (
              <button
                type="button"
                onClick={() => setView("directory")}
                className="text-2xs text-loom-accent underline underline-offset-2 hover:text-loom-text max-md:min-h-9"
              >
                Browse all {result.total} in Directory
              </button>
            )}
          </div>
        ) : (
          <>
            {result.groups.map((g) => (
              <div key={g.id} className="space-y-2.5" data-feed-group={g.id}>
                <h4 className="text-2xs font-medium uppercase tracking-wide text-loom-muted pt-1">
                  {g.label}
                </h4>
                <div className="library-source-grid">
                  {g.entries.map((e) => renderEntry(e))}
                </div>
              </div>
            ))}
            {result.total === 0 && (
              <p className="text-2xs text-loom-muted py-2">
                No feeds or packs match.{" "}
                {active && (
                  <button
                    type="button"
                    onClick={clear}
                    className="underline underline-offset-2 hover:text-loom-accent"
                  >
                    Clear filters
                  </button>
                )}
              </p>
            )}
          </>
        )}
      </div>
      <footer className="library-feed-footer">
        <p role="status" className="library-feed-count">
          {view === "digest"
            ? `${leads.length} picks`
            : `${result.total} sources`}
          <span> · Explore, mark, collect</span>
        </p>
        <div className="library-feed-search">
          <label htmlFor={searchId} className="sr-only">
            Search feeds and packs
          </label>
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id={searchId}
            type="search"
            aria-label="Search feeds and packs"
            value={state.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Find a dataset, topic, or field…"
            className="loom-input w-full text-xs min-h-11"
            enterKeyHint="search"
          />
        </div>
      </footer>
    </div>
  );
}
