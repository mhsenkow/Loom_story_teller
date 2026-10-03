// =================================================================
// PublicCatalogSections — Data & sources: Socrata city/state search +
// TidyTuesday weekly shelf. Pure parsing lives in src/lib/publicCatalogs.ts;
// loading goes through the Sidebar's remote-CSV path (web Explore via
// /api/fetch-csv, desktop Save to folder).
// =================================================================

"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import {
  SOCRATA_PORTALS,
  SOCRATA_SUGGESTIONS,
  fetchTidyTuesdayIndex,
  fetchTidyTuesdayYearTitles,
  filterTidyTuesdayWeeks,
  searchSocrata,
  socrataCsvUrl,
  socrataFileName,
  socrataPortalLabel,
  socrataRowLimit,
  tidyTuesdayTitle,
  tidyTuesdayWeekUrl,
  TIDYTUESDAY_HOME,
  type SocrataDataset,
  type SocrataSort,
  type TidyTuesdayFile,
  type TidyTuesdayWeek,
} from "@/lib/publicCatalogs";

type HeadingProps = { title: string; lede?: string; meta?: string };

export interface CatalogSectionProps {
  /** Sidebar's `SectionHeading`, so both sections match the others. */
  Heading: ComponentType<HeadingProps>;
  /** CSS `order` inside the Data & sources column. */
  order: number;
  expanded: boolean;
  canLoadInBrowser: boolean;
  canSaveToFolder: boolean;
  isScanning: boolean;
  loadingId: string | null;
  savingId: string | null;
  onExplore: (url: string, filename: string, id: string, opts?: { rowLimit?: number }) => void;
  onSave: (url: string, filename: string, id: string) => void;
}

const BTN_EXPLORE =
  "text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10 disabled:opacity-50";
const BTN_SAVE =
  "text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text disabled:opacity-50";
const EXTERNAL_ICON = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function formatDay(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ---- City & state open data (Socrata) -------------------------------------

const SOCRATA_SORTS: { value: SocrataSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "popular", label: "Most viewed" },
  { value: "updated", label: "Recently updated" },
];

export function SocrataCatalogSection({
  Heading,
  order,
  expanded,
  canLoadInBrowser,
  canSaveToFolder,
  isScanning,
  loadingId,
  savingId,
  onExplore,
  onSave,
}: CatalogSectionProps) {
  const uid = useId();
  const [draft, setDraft] = useState("311");
  const [request, setRequest] = useState<{ q: string; domain: string; sort: SocrataSort }>({
    q: "311",
    domain: "",
    sort: "relevance",
  });
  const [datasets, setDatasets] = useState<SocrataDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchSocrata({ query: request.q, domain: request.domain || undefined, sort: request.sort, limit: 30 })
      .then((rows) => {
        if (!cancelled) setDatasets(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorText(e, "City & state search failed"));
        setDatasets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const runSearch = (q: string) => {
    setDraft(q);
    setRequest((r) => ({ ...r, q: q.trim() }));
  };

  return (
    <section aria-label="City and state open data" style={{ order }}>
      <Heading
          title="City & state open data"
          lede={
            canLoadInBrowser
              ? "Search every Socrata portal — NYC, Chicago, SF, Seattle, Austin, states, CDC. Explore loads the rows straight into Chart."
              : "Search every Socrata portal — NYC, Chicago, SF, Seattle, states. Save CSVs into your folder."
          }
          meta={!loading && datasets.length > 0 ? `${datasets.length}` : undefined}
        />
      <div className="space-y-2 px-1 mb-2">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(draft);
          }}
        >
          <label htmlFor={`${uid}-q`} className="text-2xs text-loom-muted">
            Search city &amp; state portals
          </label>
          <div className="flex gap-1.5 mt-0.5">
            <input
              id={`${uid}-q`}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="311, trees, crashes, permits…"
              className="loom-input flex-1 min-w-0 text-xs py-1.5"
              enterKeyHint="search"
            />
            <button type="submit" className="loom-btn-primary text-2xs px-2.5 py-1.5 shrink-0" disabled={loading}>
              Search
            </button>
          </div>
        </form>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested searches">
          {SOCRATA_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => runSearch(s)}
              aria-pressed={request.q === s}
              className={`text-2xs px-2 py-0.5 max-md:min-h-8 max-md:px-2.5 rounded-full border transition-colors ${
                request.q === s
                  ? "border-loom-accent bg-loom-accent/10 text-loom-accent"
                  : "border-loom-border text-loom-muted hover:text-loom-text hover:border-loom-accent/50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${uid}-portal`} className="text-2xs text-loom-muted block mb-0.5">
              Portal
            </label>
            <select
              id={`${uid}-portal`}
              value={request.domain}
              onChange={(e) => setRequest((r) => ({ ...r, domain: e.target.value }))}
              className="loom-input w-full text-xs py-1.5"
            >
              <option value="">All portals</option>
              {SOCRATA_PORTALS.map((p) => (
                <option key={p.domain} value={p.domain}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${uid}-sort`} className="text-2xs text-loom-muted block mb-0.5">
              Sort
            </label>
            <select
              id={`${uid}-sort`}
              value={request.sort}
              onChange={(e) => setRequest((r) => ({ ...r, sort: e.target.value as SocrataSort }))}
              className="loom-input w-full text-xs py-1.5"
            >
              {SOCRATA_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div aria-live="polite">
        {loading && <p className="text-2xs text-loom-muted px-1 py-2">Searching portals…</p>}
        {error && (
          <p className="text-2xs text-loom-warning px-1 py-1" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && datasets.length === 0 && (
          <p className="text-2xs text-loom-muted px-1 py-2">No tables matched. Try fewer or different words.</p>
        )}
      </div>
      <ul className={expanded ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 content-start" : "space-y-2.5"}>
        {datasets.map((ds) => (
          <SocrataCard
            key={`${ds.domain}/${ds.id}`}
            ds={ds}
            canLoadInBrowser={canLoadInBrowser}
            canSaveToFolder={canSaveToFolder}
            isScanning={isScanning}
            loadingId={loadingId}
            savingId={savingId}
            onExplore={onExplore}
            onSave={onSave}
          />
        ))}
      </ul>
      <a
        href="https://dev.socrata.com/docs/other/discovery"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent"
      >
        Powered by the Socrata Discovery API
        {EXTERNAL_ICON}
      </a>
    </section>
  );
}

function SocrataCard({
  ds,
  canLoadInBrowser,
  canSaveToFolder,
  isScanning,
  loadingId,
  savingId,
  onExplore,
  onSave,
}: Omit<CatalogSectionProps, "Heading" | "order" | "expanded"> & { ds: SocrataDataset }) {
  const id = `socrata:${ds.domain}/${ds.id}`;
  const rowLimit = socrataRowLimit(ds.columnCount);
  const url = socrataCsvUrl(ds, rowLimit);
  const filename = socrataFileName(ds);
  const portal = socrataPortalLabel(ds.domain);
  const updated = formatDay(ds.updatedAt);
  return (
    <li className="border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-1.5 min-w-0">
      <p className="text-2xs text-loom-muted truncate" title={ds.domain}>
        {portal !== ds.domain ? (
          <>
            {portal} <span className="text-loom-muted/70">· {ds.domain}</span>
          </>
        ) : (
          ds.domain
        )}
      </p>
      <p className="text-sm font-medium text-loom-text leading-snug line-clamp-2">{ds.name}</p>
      {ds.description && (
        <p className="text-2xs text-loom-muted leading-snug line-clamp-2" title={ds.description.slice(0, 400)}>
          {ds.description}
        </p>
      )}
      <p className="text-2xs text-loom-muted/80 tabular-nums">
        {[updated && `Updated ${updated}`, ds.columnCount > 0 && `${ds.columnCount} columns`].filter(Boolean).join(" · ")}
      </p>
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {canLoadInBrowser && (
          <button
            type="button"
            disabled={loadingId === id || isScanning}
            onClick={() => onExplore(url, filename, id, { rowLimit })}
            className={BTN_EXPLORE}
            aria-label={`Explore ${ds.name} from ${ds.domain}`}
          >
            {loadingId === id ? "Loading…" : "Explore"}
          </button>
        )}
        {canSaveToFolder && (
          <button
            type="button"
            disabled={savingId === id}
            onClick={() => onSave(url, filename, id)}
            className={BTN_SAVE}
            aria-label={`Save ${ds.name} to folder`}
          >
            {savingId === id ? "Saving…" : "Save to folder"}
          </button>
        )}
        <a
          href={ds.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xs text-loom-muted hover:text-loom-accent"
          aria-label={`Open ${ds.name} on ${ds.domain}`}
        >
          Portal
        </a>
      </div>
    </li>
  );
}

// ---- TidyTuesday shelf ----------------------------------------------------

const TT_PAGE = 12;

export function TidyTuesdaySection({
  Heading,
  order,
  expanded,
  canLoadInBrowser,
  canSaveToFolder,
  isScanning,
  loadingId,
  savingId,
  onExplore,
  onSave,
}: CatalogSectionProps) {
  const uid = useId();
  const [weeks, setWeeks] = useState<TidyTuesdayWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(TT_PAGE);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const requestedYears = useRef<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTidyTuesdayIndex()
      .then((w) => {
        if (!cancelled) setWeeks(w);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e, "Couldn’t load the TidyTuesday index"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const filtered = useMemo(() => filterTidyTuesdayWeeks(weeks, filter, titles), [weeks, filter, titles]);
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);

  // Week titles come from each year's readme table — fetch only the years on
  // screen, or every year once someone filters (so titles are searchable).
  const yearsKey = useMemo(() => {
    const years = new Set<number>((filter.trim() ? weeks : visible).map((w) => w.year));
    return [...years].sort().join(",");
  }, [filter, weeks, visible]);

  useEffect(() => {
    if (!yearsKey) return;
    const missing = yearsKey
      .split(",")
      .map(Number)
      .filter((y) => !requestedYears.current.has(y));
    for (const year of missing) {
      requestedYears.current.add(year);
      fetchTidyTuesdayYearTitles(year)
        .then((t) => setTitles((prev) => ({ ...t, ...prev })))
        .catch(() => {
          // Titles are optional (dates + file names still work); allow a retry later.
          requestedYears.current.delete(year);
        });
    }
  }, [yearsKey]);

  const handleFile = (week: TidyTuesdayWeek, file: TidyTuesdayFile) => {
    const id = `tt:${week.date}/${file.name}`;
    if (canLoadInBrowser) onExplore(file.url, file.loomName, id);
    else if (canSaveToFolder) onSave(file.url, file.loomName, id);
  };
  const actionable = canLoadInBrowser || canSaveToFolder;

  return (
    <section aria-label="TidyTuesday weekly datasets" style={{ order }}>
      <Heading
          title="TidyTuesday"
          lede={
            canLoadInBrowser
              ? "A new community dataset every week since 2018. Tap a file to chart it."
              : actionable
                ? "A new community dataset every week since 2018. Tap a file to save it."
                : "A new community dataset every week since 2018. Choose a folder to save files."
          }
          meta={
            !loading && weeks.length > 0
              ? filter.trim()
                ? `${filtered.length}/${weeks.length}`
                : `${weeks.length} weeks`
              : undefined
          }
        />
      <div className="px-1 mb-2">
        <label htmlFor={`${uid}-f`} className="text-2xs text-loom-muted">
          Filter weeks
        </label>
        <input
          id={`${uid}-f`}
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setShown(TT_PAGE);
          }}
          placeholder="Topic, file name, or year…"
          className="loom-input w-full text-xs py-1.5 mt-0.5"
        />
      </div>

      <div aria-live="polite">
        {loading && <p className="text-2xs text-loom-muted px-1 py-2">Loading weeks…</p>}
        {error && (
          <p className="text-2xs text-loom-warning px-1 py-1" role="alert">
            {error}{" "}
            <button type="button" onClick={() => setReload((n) => n + 1)} className="underline hover:text-loom-text">
              Retry
            </button>
          </p>
        )}
        {!loading && !error && weeks.length > 0 && filtered.length === 0 && (
          <p className="text-2xs text-loom-muted px-1 py-2">No weeks match “{filter.trim()}”.</p>
        )}
      </div>

      <ul className={expanded ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 content-start" : "space-y-2"}>
        {visible.map((week) => {
          const title = tidyTuesdayTitle(week, titles);
          return (
            <li key={week.date} className="border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-1.5 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-2xs text-loom-muted tabular-nums">
                  <time dateTime={week.date}>{formatDay(`${week.date}T12:00:00`) ?? week.date}</time>
                  {week.week > 0 && <span className="text-loom-muted/70"> · week {week.week}</span>}
                </p>
                <a
                  href={tidyTuesdayWeekUrl(week)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-2xs text-loom-muted hover:text-loom-accent shrink-0"
                  aria-label={`Read about the ${week.date} TidyTuesday dataset`}
                >
                  About
                </a>
              </div>
              {title && <p className="text-sm font-medium text-loom-text leading-snug line-clamp-2">{title}</p>}
              <div className="flex flex-wrap gap-1.5">
                {week.files.map((file) => {
                  const id = `tt:${week.date}/${file.name}`;
                  const busy = loadingId === id || savingId === id;
                  return actionable ? (
                    <button
                      key={file.name}
                      type="button"
                      disabled={busy || (canLoadInBrowser && isScanning)}
                      onClick={() => handleFile(week, file)}
                      className={`${BTN_EXPLORE} font-mono max-w-full truncate`}
                      title={file.name}
                      aria-label={`${canLoadInBrowser ? "Explore" : "Save"} ${file.name} from ${title ?? week.date}`}
                    >
                      {busy ? (canLoadInBrowser ? "Loading…" : "Saving…") : file.name}
                    </button>
                  ) : (
                    <a
                      key={file.name}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-2xs font-mono text-loom-muted hover:text-loom-accent truncate max-w-full"
                    >
                      {file.name}
                    </a>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {filtered.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + TT_PAGE * 2)}
          className="loom-btn-ghost w-full text-xs mt-2 border border-loom-border"
        >
          Show more weeks ({(filtered.length - shown).toLocaleString()} left)
        </button>
      )}
      <a
        href={TIDYTUESDAY_HOME}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent"
      >
        TidyTuesday on GitHub (R for Data Science community)
        {EXTERNAL_ICON}
      </a>
    </section>
  );
}
