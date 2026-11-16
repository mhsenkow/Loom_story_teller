"use client";

// Personal library: one searchable inventory and reusable source combinations.
// Collections live in DataCollections — they are temporary on purpose.
import { useEffect, useId, useRef, useMemo, useState } from "react";
import { useLoomStore } from "@/lib/store";
import {
  browseLibrary,
  DEFAULT_LIBRARY_BROWSE,
  LIBRARY_KIND_LABELS,
  libraryAssetKind,
  libraryAssets,
  libraryFiltersActive,
  type LibraryAsset,
  type LibraryBrowse,
  type LibraryKind,
  type LibrarySection,
  type LibrarySort,
} from "@/lib/dataLibrary";
import { pathForRef, refForPath } from "@/lib/sourceRef";
import {
  requestLoadRemoteCsv,
  requestOpenRecentFile,
} from "@/lib/loomDatasetEvents";
import { SaveButton } from "./SourcePrefControls";
import { DataCombinationBuilder } from "./DataCombinationBuilder";
import { openCombination } from "@/lib/dataLibraryRuntime";
import { DataCollections } from "./DataCollections";
import { catalogEntryFor, type CatalogFreshness } from "@/lib/sourceCatalog";
import {
  FEED_FRESHNESS_LABELS,
  FEED_WHERE_LABELS,
  type FeedWhere,
} from "@/lib/feedBrowser";
import {
  SOURCE_TOPICS,
  SOURCE_TOPIC_LABELS,
  type SourceTopic,
} from "@/lib/sourceRegistry";
import { FilterChip, FilterMenu, toggleFilter } from "./LibraryFilterMenu";

export function DataLibraryAssets({ section }: { section: LibrarySection }) {
  const files = useLoomStore((s) => s.files);
  const recent = useLoomStore((s) => s.recentFiles);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const library = useLoomStore((s) => s.dataLibrary);
  const prefs = useLoomStore((s) => s.sourcePrefs);
  const setSection = useLoomStore((s) => s.setLibrarySection);
  const searchId = useId();
  const [browse, setBrowse] = useState<LibraryBrowse>(DEFAULT_LIBRARY_BROWSE);
  const patch = (next: Partial<LibraryBrowse>) => setBrowse((s) => ({ ...s, ...next }));
  const [picked, setPicked] = useState<string[]>([]);
  const [builder, setBuilder] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [error, setError] = useState("");
  const knownFiles = useMemo(
    () => [
      ...new Map(
        [...recent, ...files, ...(selectedFile ? [selectedFile] : [])].map(
          (f) => [f.path, f],
        ),
      ).values(),
    ],
    [files, recent, selectedFile],
  );
  const assets = useMemo(() => {
    const list = libraryAssets(knownFiles, library.assets);
    // Keep old saved references removable even if their original metadata is unavailable.
    for (const [ref, pref] of Object.entries(prefs.entries))
      if (pref.saved && !list.some((a) => a.ref === ref))
        list.push({ ref, name: pathForRef(ref)?.split("/").pop() || ref });
    return list;
  }, [knownFiles, library.assets, prefs]);
  const mine = new Set(
    knownFiles
      .filter(
        (f) =>
          !f.path.startsWith("stream://") &&
          !f.path.startsWith("combination://"),
      )
      .map((f) => refForPath(f.path, f)),
  );
  const owned = assets.filter(
    (a) =>
      mine.has(a.ref) ||
      (!!a.file &&
        knownFiles.some((f) => f.path === a.file!.path) &&
        !a.file.path.startsWith("combination://")),
  );
  const visible = browseLibrary(owned, browse, (ref) => prefs.entries[ref]?.openedAt ?? 0);
  const filtering = libraryFiltersActive(browse);
  function clearBrowse() {
    setBrowse((s) => ({ ...DEFAULT_LIBRARY_BROWSE, sort: s.sort }));
  }
  function open(a: LibraryAsset) {
    const path = a.file?.path ?? pathForRef(a.ref);
    if (path)
      requestOpenRecentFile(
        a.file ?? {
          path,
          name: a.name,
          extension: "stream",
          row_count: 0,
          size_bytes: 0,
        },
      );
    else if (a.url)
      requestLoadRemoteCsv({
        url: a.url,
        filename: `${a.name.replace(/[^\w .-]/g, "_")}.csv`,
        sourceCredit: a.credit,
      });
    else
      setError(
        "This dataset has no download location. Find it in Discover and collect it again.",
      );
  }
  if (section === "saved") return <DataCollections />;
  if (builder)
    return (
      <DataCombinationBuilder
        assets={assets}
        initialRefs={picked}
        onClose={() => {
          setBuilder(false);
          setPicked([]);
          setSection("combinations");
        }}
      />
    );
  if (section === "combinations")
    return (
      <section className="space-y-5">
        <header className="library-page-masthead">
          <h2>Combinations.</h2>
          <p className="library-sentence">
            Two sources, joined once and opened again.
          </p>
          <div className="library-page-actions">
            <button
              type="button"
              className="loom-btn-primary min-h-11"
              onClick={() => setBuilder(true)}
            >
              ＋ New combination
            </button>
          </div>
        </header>
        <div className="library-note">
          <strong>Sources → matching fields → reusable result</strong>
          <p className="mt-1">
            Each open rebuilds the result from available source rows. Files
            remain local; connected feeds follow their own update schedule.
            Charts show the result from the time you opened it.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-loom-danger">
            {error}
          </p>
        )}
        {!library.combinations.length && (
          <div className="library-empty">
            <span aria-hidden className="text-3xl text-loom-accent">
              ⋈
            </span>
            <h3>Make a dataset you can come back to</h3>
            <p>
              Match a table of observations to a lookup table using a shared
              key, such as a station ID or country code. You’ll see how well the
              records match before saving.
            </p>
            <button
              type="button"
              className="loom-btn-ghost min-h-11"
              onClick={() => setBuilder(true)}
            >
              Create your first combination
            </button>
          </div>
        )}
        {library.combinations.map((c) => (
          <article key={c.id} className="library-recipe">
            <p className="library-eyebrow">Refreshes on open</p>
            <h3 className="font-semibold">{c.name}</h3>
            <p className="text-sm text-loom-muted break-words">
              {c.left.name} <span className="text-loom-accent">＋</span>{" "}
              {c.right.name}
            </p>
            <p className="text-xs text-loom-muted break-words">
              {c.leftKey} → {c.rightKey} ·{" "}
              {c.mode === "left"
                ? "Keep all primary records"
                : "Matching records only"}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                className="loom-btn-primary min-h-11"
                onClick={async () => {
                  setBusy(c.id);
                  setError("");
                  try {
                    await openCombination(c, () => active.current);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not open the combination.",
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === c.id ? "Refreshing…" : "Refresh & open"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                className="loom-btn-ghost min-h-11"
                onClick={() => {
                  useLoomStore.getState().removeCombination(c.id);
                  useLoomStore
                    .getState()
                    .setToast(
                      `Removed recipe “${c.name}”. Source datasets are unchanged.`,
                    );
                }}
              >
                Remove recipe
              </button>
            </div>
          </article>
        ))}
      </section>
    );
  const kindValue =
    browse.kinds.length === 1
      ? LIBRARY_KIND_LABELS[browse.kinds[0]!]
      : browse.kinds.length
        ? `${browse.kinds.length} types`
        : "All datasets";
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
  const freshValue =
    browse.freshness.length === 1
      ? FEED_FRESHNESS_LABELS[browse.freshness[0]!]
      : browse.freshness.length
        ? `${browse.freshness.length} cadences`
        : "Any cadence";
  const kindLine: Record<LibraryKind, string> = {
    file: "File on this device",
    feed: "Connected feed",
    remote: "Remote dataset",
    demo: "Sample data",
  };

  return (
    <section className="library-feed-section">
      <div className="library-feed-workspace" data-testid="my-data">
      <header className="library-feed-header">
        <div className="library-feed-masthead">
          <h2>My data.</h2>
          <div className="library-sentence">
            <span className="library-sentence-phrase">
              <span className="library-sentence-lead">showing</span>
              <FilterMenu label="Showing" value={kindValue} active={browse.kinds.length > 0}>
                {(Object.keys(LIBRARY_KIND_LABELS) as LibraryKind[]).map((id) => (
                  <FilterChip
                    key={id}
                    on={browse.kinds.includes(id)}
                    onClick={() => patch({ kinds: toggleFilter(browse.kinds, id) })}
                  >
                    {LIBRARY_KIND_LABELS[id]}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>in</span>
              <FilterMenu label="Topic" value={topicValue} active={browse.topics.length > 0}>
                {SOURCE_TOPICS.map((t: SourceTopic) => (
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
              <span aria-hidden>updated</span>
              <FilterMenu label="Updates" value={freshValue} active={browse.freshness.length > 0}>
                {(Object.keys(FEED_FRESHNESS_LABELS) as CatalogFreshness[]).map((f) => (
                  <FilterChip
                    key={f}
                    on={browse.freshness.includes(f)}
                    onClick={() => patch({ freshness: toggleFilter(browse.freshness, f) })}
                  >
                    {FEED_FRESHNESS_LABELS[f]}
                  </FilterChip>
                ))}
              </FilterMenu>
            </span>
            <span className="library-sentence-phrase">
              <span aria-hidden>by</span>
              <label>
                <span className="sr-only">Sort my data</span>
                <select
                  value={browse.sort}
                  onChange={(e) => patch({ sort: e.target.value as LibrarySort })}
                >
                  <option value="recent">Recently opened</option>
                  <option value="az">A–Z</option>
                </select>
              </label>
            </span>
            {filtering && (
              <button type="button" className="discover-clear-inline" onClick={clearBrowse}>
                Clear
              </button>
            )}
          </div>
          <div className="library-feed-tools">
            <button
              type="button"
              className="loom-btn-primary library-discover-action min-h-11"
              onClick={() => setSection("import")}
            >
              <span aria-hidden>＋</span>
              Add data
            </button>
          </div>
        </div>
      </header>
      <div className="library-feed-results" tabIndex={0} aria-label="My data">
      <p className="sr-only">
        Your uploads, opened datasets, and local files in one place. Search by name or field, and filter by topic, place, and how often the data updates.
      </p>
      <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-loom-muted">
        <p aria-live="polite">
          {visible.length} {visible.length === 1 ? "dataset" : "datasets"}
          {picked.length > 0 ? ` · ${picked.length} selected` : ""}
        </p>
        <button
          type="button"
          className="loom-btn-ghost min-h-11"
          disabled={picked.length !== 2}
          onClick={() => setBuilder(true)}
        >
          {picked.length
            ? `Combine ${picked.length} selected`
            : "Select two to combine"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-loom-danger">
          {error}
        </p>
      )}
      {!visible.length && (
        <div className="library-empty">
          <span aria-hidden className="text-3xl text-loom-accent">
            ▦
          </span>
          <h3>{filtering ? "No datasets match" : "A home for your data"}</h3>
          <p>
            {filtering
              ? "Try a different search, topic, or place."
              : "Add a file from your device, connect a folder, or discover a public dataset to start exploring."}
          </p>
          <button
            type="button"
            className="loom-btn-ghost min-h-11"
            onClick={() => {
              if (filtering) clearBrowse();
              else setSection("discover");
            }}
          >
            {filtering ? "Clear filters" : "Discover data →"}
          </button>
        </div>
      )}
      <div className="library-list">
        {visible.map((a) => (
          <article key={a.ref} className="library-row">
            <div className="library-row-main">
              <label className="library-select">
                <input
                  type="checkbox"
                  aria-label={`Select ${a.name} to combine`}
                  checked={picked.includes(a.ref)}
                  disabled={!picked.includes(a.ref) && picked.length === 2}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked
                        ? [...p, a.ref]
                        : p.filter((r) => r !== a.ref),
                    )
                  }
                />
              </label>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="library-title"
                  onClick={() => open(a)}
                >
                  {a.name}
                </button>
                <p className="text-xs text-loom-muted mt-1">
                  {kindLine[libraryAssetKind(a)]}
                  {a.file?.row_count
                    ? ` · ${a.file.row_count.toLocaleString()} rows`
                    : ""}
                  {a.credit ? ` · ${a.credit}` : ""}
                </p>
              </div>
              <SaveButton
                sourceRef={a.ref}
                label={a.name}
                asset={a}
                className="!min-h-11 !min-w-11"
              />
            </div>
            <p className="library-card-description">
              {a.description ||
                (libraryAssetKind(a) === "feed"
                  ? "Explore the latest data from this connected source."
                  : "Ready to explore, chart, or combine with another dataset.")}
            </p>
            <div className="library-row-actions">
              <button
                type="button"
                className="loom-btn-ghost min-h-11"
                aria-expanded={details === a.ref}
                onClick={() => setDetails(details === a.ref ? null : a.ref)}
              >
                Details
              </button>
              <button
                type="button"
                className="loom-btn-ghost min-h-11 text-loom-accent"
                onClick={() => open(a)}
              >
                Open →
              </button>
            </div>
            {details === a.ref && (
              <div className="library-details">
                <p>
                  {a.description ||
                    "Dataset available for exploration and source combinations."}
                </p>
                <p>
                  {libraryAssetKind(a) === "feed"
                    ? "Connected source. Opening uses the current buffer; upstream refresh follows the feed’s schedule."
                    : a.url
                      ? "Remote source. Combinations read this URL again when opened."
                      : "Local copy. Add or sync the file again when your original data changes."}
                </p>
                {catalogEntryFor(a.ref)?.columns.length ? (
                  <p>Fields: {catalogEntryFor(a.ref)!.columns.join(", ")}</p>
                ) : null}
                {a.url && (
                  <a
                    className="text-loom-accent underline"
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View original source ↗
                  </a>
                )}
                {a.file && <p className="break-all">{a.file.path}</p>}
              </div>
            )}
          </article>
        ))}
      </div>
      </div>
      <footer className="library-feed-footer">
        <p role="status" className="library-feed-count">
          {visible.length} {visible.length === 1 ? "dataset" : "datasets"}
          <span> · On this device</span>
        </p>
        <div className="library-feed-search">
          <label htmlFor={searchId} className="sr-only">
            Search my data
          </label>
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            id={searchId}
            type="search"
            aria-label="Search my data"
            value={browse.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Find a dataset, topic, or field…"
            className="loom-input w-full text-xs min-h-11"
            enterKeyHint="search"
          />
        </div>
      </footer>
      </div>
    </section>
  );
}
