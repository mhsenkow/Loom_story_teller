"use client";

// Collections: an intent that can mix datasets and charts.
// A span of 3, 6, or 9 months lets an untouched one leave. ∞ keeps it.
import { useEffect, useId, useMemo, useState } from "react";
import { FilterChip, FilterMenu, toggleFilter } from "./LibraryFilterMenu";
import { useLoomStore } from "@/lib/store";
import {
  catalogEntryFor,
  filterCatalog,
  sourceCatalog,
  type CatalogFreshness,
} from "@/lib/sourceCatalog";
import { pathForRef, refForPath } from "@/lib/sourceRef";
import {
  requestLoadRemoteCsv,
  requestOpenRecentFile,
} from "@/lib/loomDatasetEvents";
import {
  browseCollections,
  brokenPieces,
  collectionFiltersActive,
  collectionLife,
  COLLECTION_SPANS,
  DEFAULT_COLLECTION_BROWSE,
  pieceKey,
  spanLabel,
  type CollectionBrowse,
  type CollectionPiece,
  type CollectionShow,
  type CollectionSort,
  type CollectionSpan,
  type DataCollection,
} from "@/lib/collections";
import {
  FEED_FRESHNESS_LABELS,
  FEED_WHERE_LABELS,
  geosForWhere,
  type FeedWhere,
} from "@/lib/feedBrowser";
import {
  SOURCE_TOPICS,
  SOURCE_TOPIC_LABELS,
  type SourceTopic,
} from "@/lib/sourceRegistry";
import type { FileEntry } from "@/lib/store/types";

const SHOW_LABELS: Record<CollectionShow, string> = {
  all: "All collections",
  data: "Datasets",
  charts: "Charts",
  broken: "Broken",
  empty: "Empty",
};

export function DataCollections() {
  const library = useLoomStore((s) => s.dataLibrary);
  const files = useLoomStore((s) => s.files);
  const recent = useLoomStore((s) => s.recentFiles);
  const selected = useLoomStore((s) => s.selectedFile);
  const charts = useLoomStore((s) => s.chartViews);
  const refreshCollections = useLoomStore((s) => s.refreshCollections);
  const createCollection = useLoomStore((s) => s.createCollection);
  const removeCollection = useLoomStore((s) => s.removeCollection);
  const setCollectionSpan = useLoomStore((s) => s.setCollectionSpan);
  const renameCollection = useLoomStore((s) => s.renameCollection);
  const touchLibraryCollection = useLoomStore((s) => s.touchLibraryCollection);
  const addCollectionPiece = useLoomStore((s) => s.addCollectionPiece);
  const removeCollectionPiece = useLoomStore((s) => s.removeCollectionPiece);
  const applyChartView = useLoomStore((s) => s.applyChartView);
  const setToast = useLoomStore((s) => s.setToast);
  const searchId = useId();
  const [browse, setBrowse] = useState<CollectionBrowse>(DEFAULT_COLLECTION_BROWSE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const [addTopics, setAddTopics] = useState<SourceTopic[]>([]);
  const [addWhere, setAddWhere] = useState<FeedWhere[]>([]);
  const [addFresh, setAddFresh] = useState<CatalogFreshness[]>([]);
  const patch = (next: Partial<CollectionBrowse>) => setBrowse((s) => ({ ...s, ...next }));

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  const known = useMemo(() => {
    const dataRefs = new Set<string>();
    for (const entry of library.assets) dataRefs.add(entry.ref);
    for (const file of [...recent, ...files, ...(selected ? [selected] : [])]) {
      dataRefs.add(refForPath(file.path, file));
    }
    for (const entry of sourceCatalog()) dataRefs.add(entry.ref);
    return { dataRefs, chartIds: new Set(charts.map((c) => c.id)) };
  }, [library.assets, files, recent, selected, charts]);

  const catalog = useMemo(() => {
    const items: { ref: string; name: string }[] = [];
    const seen = new Set<string>();
    const push = (ref: string, name: string) => {
      if (!ref || seen.has(ref)) return;
      seen.add(ref);
      items.push({ ref, name });
    };
    for (const file of [...(selected ? [selected] : []), ...recent, ...files]) {
      push(refForPath(file.path, file), file.name);
    }
    for (const asset of library.assets) push(asset.ref, asset.name);
    for (const entry of sourceCatalog()) push(entry.ref, entry.label);
    return items;
  }, [library.assets, files, recent, selected]);

  const visible = useMemo(
    () => browseCollections(library.collections, browse, known),
    [library.collections, browse, known],
  );
  const filtering = collectionFiltersActive(browse);

  function start() {
    const span = browse.spans.length === 1 ? browse.spans[0]! : 3;
    const name = "New collection";
    const id = createCollection({ intent: name, span });
    setOpenId(id);
    setToast(
      span === 0
        ? `“${name}” keeps going until you remove it.`
        : `“${name}” lasts ${spanLabel(span)} from the last time you touch it.`,
    );
  }

  function datasetsToAdd(c: DataCollection) {
    const held = new Set(
      c.pieces.filter((p) => p.kind === "data").map((p) => p.ref),
    );
    const q = addQuery.trim().toLowerCase();
    const faceted = addTopics.length > 0 || addWhere.length > 0 || addFresh.length > 0;
    const catalogRefs = new Set(sourceCatalog().map((e) => e.ref));
    const locals = catalog.filter((item) => {
      if (held.has(item.ref) || catalogRefs.has(item.ref)) return false;
      if (faceted) return false;
      return !q || item.name.toLowerCase().includes(q);
    });
    if (!q && !faceted) return locals.slice(0, 6);
    const seen = new Set(locals.map((item) => item.ref));
    const fromCatalog = filterCatalog(sourceCatalog(), {
      query: addQuery,
      topics: addTopics,
      geo: geosForWhere(addWhere),
      freshness: addFresh,
    })
      .filter((e) => !held.has(e.ref) && !seen.has(e.ref))
      .map((e) => ({ ref: e.ref, name: e.label }));
    return [...locals, ...fromCatalog].slice(0, 40);
  }

  function fileForRef(ref: string): FileEntry | null {
    const asset = library.assets.find((a) => a.ref === ref);
    if (asset?.file) return asset.file;
    const path = pathForRef(ref);
    if (!path) return null;
    const knownFile = [...files, ...recent, ...(selected ? [selected] : [])].find(
      (f) => f.path === path || refForPath(f.path, f) === ref,
    );
    return (
      knownFile ?? {
        path,
        name: asset?.name || path.split("/").pop() || "data",
        extension: path.startsWith("stream://") ? "stream" : "csv",
        row_count: 0,
        size_bytes: 0,
        sourceUrl: asset?.url,
        sourceCredit: asset?.credit,
      }
    );
  }

  function exploreData(c: DataCollection, piece: Extract<CollectionPiece, { kind: "data" }>) {
    touchLibraryCollection(c.id);
    const file = fileForRef(piece.ref);
    if (file) {
      requestOpenRecentFile(file);
      return;
    }
    const asset = library.assets.find((a) => a.ref === piece.ref);
    const url = asset?.url || catalogEntryFor(piece.ref)?.url;
    if (url) {
      requestLoadRemoteCsv({
        url,
        filename: `${piece.name.replace(/[^\w .-]/g, "_")}.csv`,
        sourceCredit: asset?.credit,
      });
      return;
    }
    setToast(`“${piece.name}” has no rows to open from here.`);
  }

  function openSource(piece: Extract<CollectionPiece, { kind: "data" }>) {
    const home =
      catalogEntryFor(piece.ref)?.homepage ||
      library.assets.find((a) => a.ref === piece.ref)?.url;
    if (!home) {
      setToast(`“${piece.name}” has no source page.`);
      return;
    }
    window.open(home, "_blank", "noopener,noreferrer");
  }

  function exploreChart(c: DataCollection, id: string) {
    touchLibraryCollection(c.id);
    applyChartView(id);
  }

  const showValue = SHOW_LABELS[browse.show];
  const spanValue =
    browse.spans.length === 1
      ? spanLabel(browse.spans[0]!)
      : browse.spans.length
        ? `${browse.spans.length} spans`
        : "Any span";
  const topicValue =
    browse.topics.length === 1
      ? SOURCE_TOPIC_LABELS[browse.topics[0]!]
      : browse.topics.length
        ? `${browse.topics.length} topics`
        : "All topics";
  const whereValue =
    browse.where.length === 1
      ? FEED_WHERE_LABELS[browse.where[0]!]
      : browse.where.length
        ? `${browse.where.length} regions`
        : "Anywhere";

  return (
    <section className="library-feed-section">
      <div className="library-feed-workspace" data-testid="collections-browser">
      <header className="library-feed-header">
        <div className="library-feed-masthead">
          <h2>Collections.</h2>
          <div className="library-sentence">
            <span className="library-sentence-phrase">
              <span className="library-sentence-lead">showing</span>
              <FilterMenu label="Showing" value={showValue} active={browse.show !== "all"}>
                {(Object.keys(SHOW_LABELS) as CollectionShow[]).map((id) => (
                  <FilterChip
                    key={id}
                    on={browse.show === id}
                    onClick={() => patch({ show: browse.show === id && id !== "all" ? "all" : id })}
                  >
                    {SHOW_LABELS[id]}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>in</span>
              <FilterMenu label="Topic" value={topicValue} active={browse.topics.length > 0}>
                {SOURCE_TOPICS.map((t) => (
                  <FilterChip
                    key={t}
                    on={browse.topics.includes(t)}
                    onClick={() => patch({ topics: toggleFilter(browse.topics, t) })}
                  >
                    {SOURCE_TOPIC_LABELS[t]}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>from</span>
              <FilterMenu label="Where" value={whereValue} active={browse.where.length > 0}>
                {(Object.keys(FEED_WHERE_LABELS) as FeedWhere[]).map((w) => (
                  <FilterChip
                    key={w}
                    on={browse.where.includes(w)}
                    onClick={() => patch({ where: toggleFilter(browse.where, w) })}
                  >
                    {FEED_WHERE_LABELS[w]}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>holding</span>
              <FilterMenu label="Lifespan" value={spanValue} active={browse.spans.length > 0}>
                {COLLECTION_SPANS.map((n) => (
                  <FilterChip
                    key={n}
                    on={browse.spans.includes(n)}
                    onClick={() => patch({ spans: toggleFilter(browse.spans, n) })}
                  >
                    {spanLabel(n)}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>by</span>
              <label>
                <span className="sr-only">Sort collections</span>
                <select
                  value={browse.sort}
                  onChange={(e) => patch({ sort: e.target.value as CollectionSort })}
                >
                  <option value="touched">Recently touched</option>
                  <option value="leaving">Leaving soon</option>
                  <option value="az">A–Z</option>
                </select>
              </label>
            </span>
            {filtering && (
              <button
                type="button"
                className="discover-clear-inline"
                onClick={() => setBrowse((s) => ({ ...DEFAULT_COLLECTION_BROWSE, sort: s.sort }))}
              >
                Clear
              </button>
            )}
          </div>
          <div className="library-feed-tools">
            <button type="button" className="loom-btn-primary library-discover-action min-h-11" onClick={start}>
              <span aria-hidden>＋</span>
              Start collection
            </button>
          </div>
        </div>
      </header>
      <div className="library-feed-results" tabIndex={0} aria-label="Collections">
      <p className="sr-only">
        A collection mixes datasets and charts for one reason. Search by name, dataset, or field. Filter by topic, place, and how long it lasts.
      </p>
      {!library.collections.length && (
        <div className="library-empty">
          <span aria-hidden className="text-3xl text-loom-accent">
            ◇
          </span>
          <h3>A collection is a reason</h3>
          <p>
            Start one even before you name it. Then add datasets and charts.
            Hearts stay as filters. A timed collection leaves if you don’t touch
            it. Infinity keeps going.
          </p>
        </div>
      )}
      {library.collections.length > 0 && visible.length === 0 && (
        <p className="text-sm text-loom-muted py-2">
          No collections match.{" "}
          <button
            type="button"
            onClick={() => setBrowse((s) => ({ ...DEFAULT_COLLECTION_BROWSE, sort: s.sort }))}
            className="underline underline-offset-2 hover:text-loom-accent"
          >
            Clear filters
          </button>
        </p>
      )}
      <div className="library-list">
        {visible.map((c) => {
          const broken = brokenPieces(c, known);
          const dataN = c.pieces.filter((p) => p.kind === "data").length;
          const chartN = c.pieces.filter((p) => p.kind === "chart").length;
          const open = openId === c.id;
          const matches = open ? datasetsToAdd(c) : [];
          const adding = addQuery.trim() || addTopics.length || addWhere.length || addFresh.length;
          return (
            <article key={c.id} className="library-row">
              <div className="library-row-main">
                <div className="min-w-0 flex-1">
                  <h3 className="library-title">{c.intent}</h3>
                  <p className="text-xs text-loom-muted mt-1">
                    {dataN} {dataN === 1 ? "dataset" : "datasets"} · {chartN}{" "}
                    {chartN === 1 ? "chart" : "charts"} · {collectionLife(c)}
                  </p>
                  {broken.length > 0 && (
                    <p className="text-xs text-loom-danger mt-1">
                      {broken.length === 1
                        ? `“${broken[0]!.name}” no longer opens.`
                        : `${broken.length} pieces no longer open.`}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="loom-btn-ghost min-h-11"
                  aria-expanded={open}
                  onClick={() => {
                    touchLibraryCollection(c.id);
                    setOpenId(open ? null : c.id);
                    setAddQuery("");
                  }}
                >
                  {open ? "Close" : "Open"}
                </button>
              </div>
              {open && (
                <div className="library-details">
                  <label className="block">
                    <span className="sr-only">Rename {c.intent}</span>
                    <input
                      className="library-intent"
                      type="text"
                      defaultValue={c.intent}
                      key={c.intent}
                      maxLength={120}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== c.intent) renameCollection(c.id, next);
                      }}
                    />
                  </label>
                  <SpanPicker
                    span={c.span}
                    label={`Lifespan for ${c.intent}`}
                    onPick={(n) => setCollectionSpan(c.id, n)}
                  />
                  <ul className="space-y-2">
                    {c.pieces.length === 0 && (
                      <li className="text-loom-muted">Nothing in here yet.</li>
                    )}
                    {c.pieces.map((p) => {
                      const missing = broken.includes(p);
                      const sourceUrl =
                        p.kind === "data"
                          ? catalogEntryFor(p.ref)?.homepage ||
                            library.assets.find((a) => a.ref === p.ref)?.url
                          : null;
                      return (
                        <li key={pieceKey(p)} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="min-w-0 truncate text-left hover:text-loom-accent disabled:hover:text-inherit"
                            disabled={missing}
                            onClick={() =>
                              p.kind === "data" ? exploreData(c, p) : exploreChart(c, p.id)
                            }
                          >
                            {p.kind === "chart" ? "Chart" : "Data"} · {p.name}
                            {missing ? " · broken" : ""}
                          </button>
                          <span className="flex items-center gap-1 shrink-0">
                            {p.kind === "data" ? (
                              <>
                                <button
                                  type="button"
                                  className="library-micro"
                                  disabled={!sourceUrl || missing}
                                  onClick={() => openSource(p)}
                                >
                                  Source
                                </button>
                                <button
                                  type="button"
                                  className="library-micro"
                                  disabled={missing}
                                  onClick={() => exploreData(c, p)}
                                >
                                  Explore
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="library-micro"
                                  disabled={missing}
                                  onClick={() => {
                                    const view = charts.find((v) => v.id === p.id);
                                    if (!view?.filePath) {
                                      setToast(`“${p.name}” has no dataset to open.`);
                                      return;
                                    }
                                    requestOpenRecentFile({
                                      path: view.filePath,
                                      name: view.fileName || p.name,
                                      extension: view.filePath.startsWith("stream://") ? "stream" : "csv",
                                      row_count: view.snapshotData?.total_rows ?? 0,
                                      size_bytes: 0,
                                    });
                                  }}
                                >
                                  Source
                                </button>
                                <button
                                  type="button"
                                  className="library-micro"
                                  disabled={missing}
                                  onClick={() => exploreChart(c, p.id)}
                                >
                                  Explore
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className="library-micro"
                              onClick={() => removeCollectionPiece(c.id, pieceKey(p))}
                            >
                              Drop
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="library-sentence">
                    <span className="library-sentence-phrase">
                      <span className="library-sentence-lead">adding</span>
                      <FilterMenu
                        label={`Topic for ${c.intent}`}
                        value={
                          addTopics.length === 1
                            ? SOURCE_TOPIC_LABELS[addTopics[0]!]
                            : addTopics.length
                              ? `${addTopics.length} topics`
                              : "All topics"
                        }
                        active={addTopics.length > 0}
                      >
                        {SOURCE_TOPICS.map((t) => (
                          <FilterChip key={t} on={addTopics.includes(t)} onClick={() => setAddTopics(toggleFilter(addTopics, t))}>
                            {SOURCE_TOPIC_LABELS[t]}
                          </FilterChip>
                        ))}
                      </FilterMenu>
                    </span>
                    <span className="library-sentence-phrase">
                      <span aria-hidden>from</span>
                      <FilterMenu
                        label={`Where for ${c.intent}`}
                        value={
                          addWhere.length === 1
                            ? FEED_WHERE_LABELS[addWhere[0]!]
                            : addWhere.length
                              ? `${addWhere.length} regions`
                              : "Anywhere"
                        }
                        active={addWhere.length > 0}
                      >
                        {(Object.keys(FEED_WHERE_LABELS) as FeedWhere[]).map((w) => (
                          <FilterChip key={w} on={addWhere.includes(w)} onClick={() => setAddWhere(toggleFilter(addWhere, w))}>
                            {FEED_WHERE_LABELS[w]}
                          </FilterChip>
                        ))}
                      </FilterMenu>
                    </span>
                    <span className="library-sentence-phrase">
                      <span aria-hidden>updated</span>
                      <FilterMenu
                        label={`Updates for ${c.intent}`}
                        value={
                          addFresh.length === 1
                            ? FEED_FRESHNESS_LABELS[addFresh[0]!]
                            : addFresh.length
                              ? `${addFresh.length} cadences`
                              : "Any cadence"
                        }
                        active={addFresh.length > 0}
                      >
                        {(Object.keys(FEED_FRESHNESS_LABELS) as CatalogFreshness[]).map((f) => (
                          <FilterChip key={f} on={addFresh.includes(f)} onClick={() => setAddFresh(toggleFilter(addFresh, f))}>
                            {FEED_FRESHNESS_LABELS[f]}
                          </FilterChip>
                        ))}
                      </FilterMenu>
                    </span>
                  </div>
                  <label className="library-feed-search block">
                    <span className="sr-only">Add a dataset to {c.intent}</span>
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="10.5" cy="10.5" r="6.5" />
                      <path d="m16 16 4 4" />
                    </svg>
                    <input
                      type="search"
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Find a dataset, topic, or field…"
                      className="loom-input w-full text-xs min-h-11"
                      enterKeyHint="search"
                    />
                  </label>
                  {adding && matches.length === 0 && (
                    <p className="text-xs text-loom-muted">No datasets match.</p>
                  )}
                  {matches.length > 0 && (
                    <ul className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                      {matches.map((item) => (
                        <li key={item.ref}>
                          <button
                            type="button"
                            className="library-micro"
                            onClick={() => {
                              addCollectionPiece(c.id, { kind: "data", ref: item.ref, name: item.name });
                              setAddQuery("");
                              setToast(`${item.name} joined “${c.intent}”.`);
                            }}
                          >
                            + {item.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {charts
                      .filter((v) => !c.pieces.some((p) => p.kind === "chart" && p.id === v.id))
                      .slice(0, 3)
                      .map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          className="library-micro"
                          onClick={() => {
                            addCollectionPiece(c.id, { kind: "chart", id: v.id, name: v.name });
                            setToast(`${v.name} joined “${c.intent}”.`);
                          }}
                        >
                          + chart {v.name}
                        </button>
                      ))}
                    <button
                      type="button"
                      className="loom-btn-ghost min-h-11"
                      onClick={() => {
                        removeCollection(c.id);
                        setToast(`Removed “${c.intent}”. The datasets and charts are unchanged.`);
                      }}
                    >
                      Remove collection
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
      </div>
      <footer className="library-feed-footer">
        <p role="status" className="library-feed-count">
          {visible.length} {visible.length === 1 ? "collection" : "collections"}
          <span> · Source, explore, collect</span>
        </p>
        <div className="library-feed-search">
          <label htmlFor={searchId} className="sr-only">
            Search collections
          </label>
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id={searchId}
            type="search"
            aria-label="Search collections"
            value={browse.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Find a collection, dataset, or field…"
            className="loom-input w-full text-xs min-h-11"
            enterKeyHint="search"
          />
        </div>
      </footer>
      </div>
    </section>
  );
}

function SpanPicker({
  span,
  onPick,
  label,
}: {
  span: CollectionSpan;
  onPick: (span: CollectionSpan) => void;
  label: string;
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap gap-1">
      {COLLECTION_SPANS.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={span === n}
          className="loom-btn-ghost min-h-9 px-2 text-xs"
          onClick={() => onPick(n)}
        >
          {spanLabel(n)}
        </button>
      ))}
    </span>
  );
}
