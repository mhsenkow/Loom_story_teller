"use client";

// =================================================================
// Loom — Dive view (Scuba-style slice-and-dice)
// =================================================================
// Left: query builder (time window, filters, group by, metrics,
// compare). Right: Time series · Table · Samples over the same query.
// Click a value to drill in (filter + next group), ⌥-click to exclude.
// Live streams auto-refresh; the query lives in the URL (#dive=…) so a
// dive can be shared. Engine: src/lib/dive.ts; rows: diveSource.ts.
// =================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StartHere } from "@/components/StartHere";
import { useLoomStore } from "@/lib/store";
import { createChartRec, type YAggregateOption } from "@/lib/recommendations";
import { isTauri } from "@/lib/tauri";
import {
  DIVE_AGGS,
  DIVE_BUCKETS,
  DIVE_COMPARES,
  DIVE_OPS,
  DIVE_RANGES,
  defaultDiveQuery,
  diveToSql,
  encodeDiveLink,
  formatBucket,
  formatDelta,
  formatDiveNumber,
  metricLabel,
  profileDiveColumns,
  runDive,
  sanitizeDiveQuery,
  type DiveColumnProfile,
  type DiveFilter,
  type DiveMetric,
  type DiveQuery,
  type DiveViewKind,
} from "@/lib/dive";
import { isLiveDivePath, loadDiveDataset, type DiveDataset } from "@/lib/diveSource";
import { DiveTimeSeries } from "@/components/DiveTimeSeries";

const LIMITS = [5, 10, 25, 50, 100];
const KIND_ICON: Record<DiveColumnProfile["kind"], string> = { time: "◷", number: "#", category: "Aa" };

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="text-2xs uppercase tracking-wider text-loom-muted font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const selectCls = "loom-input text-xs py-1 min-h-7 min-w-0";
const smallBtn = "text-2xs text-loom-accent hover:underline";
const xBtn = "shrink-0 w-6 h-6 rounded text-loom-muted hover:text-loom-text hover:bg-loom-elevated";

export function DiveView() {
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const columnStats = useLoomStore((s) => s.columnStats);
  const diveQuery = useLoomStore((s) => s.diveQuery);
  const diveLink = useLoomStore((s) => s.diveLink);
  const { setDiveQuery, setDiveLink, setToast, setActiveChart, setViewMode, setSampleRows, setQuerySql } = useLoomStore.getState();

  const path = selectedFile?.path ?? null;
  const [dataset, setDataset] = useState<DiveDataset | null>(null);
  const [datasetPath, setDatasetPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [showSql, setShowSql] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const sampleRef = useRef(sampleRows);
  sampleRef.current = sampleRows;
  // Layout follows Dive's own width (side panels can squeeze it on any screen).
  const rootRef = useRef<HTMLDivElement>(null);
  // Start narrow on phones so the first paint doesn't flash the side-by-side layout.
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= 720);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWide(e.contentRect.width >= 720));
    ro.observe(el);
    return () => ro.disconnect();
    // Root only exists once a file is open.
  }, [selectedFile]);

  const load = useCallback(
    async (p: string, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const ds = await loadDiveDataset(p, sampleRef.current);
        setDataset(ds);
        setDatasetPath(p);
        setError(null);
        setRefreshedAt(Date.now());
      } catch (e) {
        if (!quiet) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!path) {
      setDataset(null);
      setDatasetPath(null);
      return;
    }
    void load(path);
  }, [path, load]);

  // Live streams keep growing — re-pull rows on an interval while Live is on.
  useEffect(() => {
    if (!path || !live || !isLiveDivePath(path)) return;
    const id = window.setInterval(() => void load(path, true), isTauri() ? 10_000 : 5_000);
    return () => window.clearInterval(id);
  }, [path, live, load]);

  const ready = dataset && datasetPath === path ? dataset : null;
  const profiles = useMemo(() => (ready ? profileDiveColumns(ready.data) : []), [ready]);

  // Apply a shared link once its dataset is open.
  useEffect(() => {
    if (!diveLink || !path || diveLink.src !== path || !profiles.length) return;
    setDiveQuery({ src: path, query: sanitizeDiveQuery(diveLink.query, profiles) });
    setDiveLink(null);
    setToast("Opened shared dive");
  }, [diveLink, path, profiles, setDiveQuery, setDiveLink, setToast]);

  const query: DiveQuery | null = useMemo(() => {
    if (!profiles.length || !path) return null;
    if (diveQuery?.src === path) return sanitizeDiveQuery(diveQuery.query, profiles);
    return defaultDiveQuery(profiles);
  }, [diveQuery, path, profiles]);

  const update = useCallback(
    (patch: Partial<DiveQuery> | ((q: DiveQuery) => DiveQuery)) => {
      if (!query || !path) return;
      const next = typeof patch === "function" ? patch(query) : { ...query, ...patch };
      setDiveQuery({ src: path, query: next });
    },
    [query, path, setDiveQuery],
  );

  const result = useMemo(() => (ready && query ? runDive(ready.data, query, profiles) : null), [ready, query, profiles]);

  // Keep the URL shareable: the whole query rides in the hash.
  useEffect(() => {
    if (!query || !path) return;
    const hash = `#${encodeDiveLink({ src: path, query })}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [query, path]);
  useEffect(
    () => () => {
      if (window.location.hash.startsWith("#dive=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    },
    [],
  );

  const timeCols = profiles.filter((p) => p.kind === "time");
  const numCols = profiles.filter((p) => p.kind === "number");
  const groupable = profiles.filter((p) => p.kind !== "time" && p.distinct > 1);

  const drill = useCallback(
    (column: string, value: string, exclude: boolean) => {
      update((q) => {
        const filters: DiveFilter[] = [...q.filters.filter((f) => !(f.column === column && f.op === (exclude ? "!=" : "="))), { column, op: exclude ? "!=" : "=", value }];
        if (exclude) return { ...q, filters };
        // Drilling in: the value is now fixed, so stop grouping by it.
        return { ...q, filters, groupBy: q.groupBy.filter((g) => g !== column) };
      });
    },
    [update],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast(isLiveDivePath(path) || path?.startsWith("mock://") ? "Dive link copied" : "Link copied — recipients need the same file open");
    } catch {
      setToast("Couldn’t copy link");
    }
  }, [path, setToast]);

  const sql = useMemo(
    () => (query && ready ? diveToSql(query, ready.table, profiles, result?.bucketMs ?? 0) : ""),
    [query, ready, profiles, result?.bucketMs],
  );

  const cubePlan = useMemo(() => {
    if (!query) return null;
    const dims = [...query.groupBy];
    if (dims.length === 2 && query.timeColumn) dims.push(query.timeColumn);
    if (dims.length < 3) return null;
    const m = query.metrics[query.orderBy] ?? query.metrics[0]!;
    const map: Partial<Record<DiveMetric["agg"], YAggregateOption>> = { sum: "sum", avg: "mean", min: "min", max: "max" };
    return { x: dims[0]!, y: dims[1]!, z: dims[2]!, sizeField: map[m.agg] ? m.column : null, agg: map[m.agg] ?? "count", approx: !map[m.agg] && m.agg !== "count" };
  }, [query]);

  const openCube = useCallback(() => {
    if (!cubePlan || !ready || !result || !selectedFile) return;
    const rows = result.matchedIndices.slice(0, 20_000).map((i) => ready.data.rows[i]!);
    setSampleRows({ columns: ready.data.columns, types: ready.data.types ?? ready.data.columns.map(() => "VARCHAR"), rows, total_rows: rows.length });
    const rec = createChartRec("dataCube", columnStats, cubePlan.x, cubePlan.y, null, selectedFile.name.replace(/\.\w+$/, ""), {
      zField: cubePlan.z,
      sizeField: cubePlan.sizeField,
      yAggregate: cubePlan.agg,
    });
    if (!rec) {
      setToast("Couldn’t build a cube from these fields");
      return;
    }
    setActiveChart(rec);
    setViewMode("chart");
    setToast(`Cube of ${rows.length.toLocaleString()} filtered rows${cubePlan.approx ? " · metric shown as row count" : ""}`);
  }, [cubePlan, ready, result, selectedFile, columnStats, setSampleRows, setActiveChart, setViewMode, setToast]);

  // ── Empty / loading states ─────────────────────────────────────
  if (!selectedFile) {
    return (
      <div className="h-full flex flex-col">
        {diveLink && (
          <div className="p-3 shrink-0">
            <LinkBanner src={diveLink.src} onDismiss={() => setDiveLink(null)} />
          </div>
        )}
        <div className="flex-1 min-h-0">
          <StartHere
            title="Dive into a dataset"
            detail="Dive slices event data Scuba-style — time window, filters, group-by, p90 vs last week. Live feeds with timestamps work best."
          />
        </div>
      </div>
    );
  }

  const viewTabs: { key: DiveViewKind; label: string; disabled?: string }[] = [
    { key: "timeseries", label: "Time series", disabled: query?.timeColumn ? undefined : "No time column in this dataset" },
    { key: "table", label: "Table" },
    { key: "samples", label: "Samples" },
  ];
  const ob = query ? Math.min(query.orderBy, query.metrics.length - 1) : 0;
  const compareLabel = query && query.compare !== "none" ? (DIVE_COMPARES.find((c) => c.value === query.compare)?.label ?? null) : null;

  return (
    <div ref={rootRef} className={`h-full flex min-h-0 ${wide ? "flex-row" : "flex-col"}`}>
      {/* ── Query builder ───────────────────────────────────────── */}
      <aside
        className={`shrink-0 border-loom-border overflow-y-auto p-3 space-y-4 bg-loom-surface/40 ${
          wide ? "w-72 border-r" : "max-h-[42%] border-b"
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-loom-text truncate flex-1" title={selectedFile.name}>
              {selectedFile.name}
            </span>
            {ready?.live && (
              <button
                type="button"
                onClick={() => setLive((l) => !l)}
                aria-pressed={live}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-2xs ${live ? "border-emerald-500/50 text-emerald-400" : "border-loom-border text-loom-muted"}`}
                title={live ? "Auto-refreshing — click to pause" : "Paused — click to auto-refresh"}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400 animate-pulse" : "bg-loom-muted"}`} />
                {live ? "Live" : "Paused"}
              </button>
            )}
          </div>
          {ready && (
            <p className="text-2xs text-loom-muted">
              {ready.data.rows.length.toLocaleString()} rows loaded
              {ready.sampled ? ` · sample of ${ready.totalRows.toLocaleString()}` : ""}
              {!isTauri() && !ready.live && !path?.startsWith("mock://") && ready.sampled ? " (web keeps a sample)" : ""}
            </p>
          )}
        </div>

        {diveLink && diveLink.src !== path && <LinkBanner src={diveLink.src} onDismiss={() => setDiveLink(null)} />}

        {query && (
          <>
            <Section title="Time">
              {timeCols.length === 0 ? (
                <p className="text-2xs text-loom-muted">No timestamp column — time window and series are off. Table and Samples still work.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  <select className={`${selectCls} w-full col-span-2`} value={query.timeColumn ?? ""} onChange={(e) => update({ timeColumn: e.target.value || null })} aria-label="Time column">
                    {timeCols.map((c) => (
                      <option key={c.name} value={c.name}>
                        ◷ {c.name}
                      </option>
                    ))}
                    <option value="">No time column</option>
                  </select>
                  <select className={`${selectCls} w-full`} value={query.range} onChange={(e) => update({ range: e.target.value as DiveQuery["range"] })} disabled={!query.timeColumn} aria-label="Time range">
                    {DIVE_RANGES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <select className={`${selectCls} w-full`} value={query.bucket} onChange={(e) => update({ bucket: e.target.value as DiveQuery["bucket"] })} disabled={!query.timeColumn} aria-label="Bucket size">
                    {DIVE_BUCKETS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.value === "auto" ? "Auto bucket" : `per ${b.label}`}
                      </option>
                    ))}
                  </select>
                  <select className={`${selectCls} w-full col-span-2`} value={query.compare} onChange={(e) => update({ compare: e.target.value as DiveQuery["compare"] })} disabled={!query.timeColumn} aria-label="Compare">
                    {DIVE_COMPARES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value === "none" ? "No comparison" : `Compare: ${c.label.toLowerCase()}`}
                      </option>
                    ))}
                  </select>
                  {query.timeColumn && <p className="col-span-2 text-2xs text-loom-muted">Windows end at the latest row.</p>}
                </div>
              )}
            </Section>

            <Section
              title="Filters"
              action={
                <button type="button" className={smallBtn} onClick={() => update((q) => ({ ...q, filters: [...q.filters, { column: groupable[0]?.name ?? profiles[0]!.name, op: "=", value: "" }] }))}>
                  + Add
                </button>
              }
            >
              {query.filters.length === 0 && <p className="text-2xs text-loom-muted">All rows. Click any value in the results to filter.</p>}
              {query.filters.map((f, i) => {
                const prof = profiles.find((p) => p.name === f.column);
                const listId = `dive-vals-${i}`;
                const setF = (patch: Partial<DiveFilter>) => update((q) => ({ ...q, filters: q.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                return (
                  <div key={i} className="rounded-md border border-loom-border p-1.5 space-y-1">
                    <div className="flex gap-1">
                      <select className={`${selectCls} flex-1`} value={f.column} onChange={(e) => setF({ column: e.target.value, value: "" })} aria-label="Filter column">
                        {profiles.map((p) => (
                          <option key={p.name} value={p.name}>
                            {KIND_ICON[p.kind]} {p.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={xBtn} onClick={() => update((q) => ({ ...q, filters: q.filters.filter((_, j) => j !== i) }))} aria-label="Remove filter">
                        ×
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <select className={`${selectCls} w-24 shrink-0`} value={f.op} onChange={(e) => setF({ op: e.target.value as DiveFilter["op"] })} aria-label="Operator">
                        {DIVE_OPS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      {f.op !== "is null" && f.op !== "not null" && (
                        <>
                          <input className={`${selectCls} flex-1`} value={f.value} list={listId} onChange={(e) => setF({ value: e.target.value })} placeholder="value" aria-label="Filter value" />
                          <datalist id={listId}>
                            {(prof?.top ?? []).map((v) => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </Section>

            <Section title="Group by">
              <div className="flex flex-wrap gap-1">
                {query.groupBy.map((g, i) => (
                  <span key={g} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md border border-loom-accent/50 bg-loom-accent/10 text-2xs text-loom-text">
                    <span className="text-loom-muted">{i + 1}</span> {g}
                    <button type="button" className="text-loom-muted hover:text-loom-text px-0.5" onClick={() => update((q) => ({ ...q, groupBy: q.groupBy.filter((x) => x !== g) }))} aria-label={`Stop grouping by ${g}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1">
                <select
                  className={`${selectCls} flex-1`}
                  value=""
                  onChange={(e) => e.target.value && update((q) => ({ ...q, groupBy: [...q.groupBy, e.target.value] }))}
                  aria-label="Add group by"
                >
                  <option value="">{query.groupBy.length ? "+ then by…" : "+ Group by…"}</option>
                  {groupable
                    .filter((p) => !query.groupBy.includes(p.name))
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {KIND_ICON[p.kind]} {p.name} ({p.distinct >= 2000 ? "2k+" : p.distinct})
                      </option>
                    ))}
                </select>
                <select className={`${selectCls} w-20 shrink-0`} value={query.limit} onChange={(e) => update({ limit: Number(e.target.value) })} aria-label="Top groups">
                  {LIMITS.map((l) => (
                    <option key={l} value={l}>
                      top {l}
                    </option>
                  ))}
                </select>
              </div>
            </Section>

            <Section
              title="Metrics"
              action={
                <button type="button" className={smallBtn} onClick={() => update((q) => ({ ...q, metrics: [...q.metrics, { agg: numCols.length ? "avg" : "distinct", column: numCols[0]?.name ?? groupable[0]?.name ?? null }] }))}>
                  + Add
                </button>
              }
            >
              {query.metrics.map((m, i) => {
                const info = DIVE_AGGS.find((a) => a.value === m.agg)!;
                const cols = info.numeric ? numCols : profiles;
                const setM = (patch: Partial<DiveMetric>) =>
                  update((q) => ({ ...q, metrics: q.metrics.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                return (
                  <div key={i} className="flex gap-1 items-center">
                    <input
                      type="radio"
                      name="dive-rank"
                      checked={ob === i}
                      onChange={() => update({ orderBy: i })}
                      title="Rank groups and plot this metric"
                      aria-label={`Rank by ${metricLabel(m)}`}
                      className="accent-[var(--loom-accent)] shrink-0"
                    />
                    <select
                      className={`${selectCls} w-28 shrink-0`}
                      value={m.agg}
                      onChange={(e) => {
                        const agg = e.target.value as DiveMetric["agg"];
                        const next = DIVE_AGGS.find((a) => a.value === agg)!;
                        const keep = m.column && (!next.numeric || numCols.some((c) => c.name === m.column));
                        setM({ agg, column: next.needsColumn ? (keep ? m.column : (next.numeric ? numCols[0]?.name : profiles[0]?.name) ?? null) : null });
                      }}
                      aria-label="Aggregate"
                    >
                      {DIVE_AGGS.map((a) => (
                        <option key={a.value} value={a.value} disabled={a.numeric && numCols.length === 0}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {info.needsColumn ? (
                      <select className={`${selectCls} flex-1`} value={m.column ?? ""} onChange={(e) => setM({ column: e.target.value })} aria-label="Metric column">
                        {cols.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="flex-1 text-2xs text-loom-muted px-1">of rows</span>
                    )}
                    {query.metrics.length > 1 && (
                      <button
                        type="button"
                        className={xBtn}
                        onClick={() => update((q) => ({ ...q, metrics: q.metrics.filter((_, j) => j !== i), orderBy: q.orderBy >= i && q.orderBy > 0 ? q.orderBy - 1 : q.orderBy }))}
                        aria-label="Remove metric"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </Section>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" onClick={copyLink} className="loom-btn-ghost text-2xs px-2 py-1">
                🔗 Copy link
              </button>
              <button type="button" onClick={() => setShowSql((s) => !s)} className="loom-btn-ghost text-2xs px-2 py-1" aria-pressed={showSql}>
                {"</>"} SQL
              </button>
              {cubePlan && (
                <button type="button" onClick={openCube} className="loom-btn-ghost text-2xs px-2 py-1" title={`Rows ${cubePlan.x} × Columns ${cubePlan.y} × Depth ${cubePlan.z}`}>
                  ▦ Open as cube
                </button>
              )}
              <button type="button" onClick={() => path && setDiveQuery({ src: path, query: defaultDiveQuery(profiles) })} className="loom-btn-ghost text-2xs px-2 py-1">
                Reset
              </button>
            </div>
          </>
        )}
      </aside>

      {/* ── Results ─────────────────────────────────────────────── */}
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-loom-border">
          <nav className="loom-seg" aria-label="Dive view">
            {viewTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className="loom-seg-item px-2.5 text-xs"
                aria-pressed={query?.view === t.key}
                disabled={!!t.disabled}
                title={t.disabled}
                onClick={() => update({ view: t.key })}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {result && (
            <p className="text-2xs text-loom-muted font-mono flex-1 min-w-0 truncate">
              <span className="text-loom-text">{result.matched.toLocaleString()}</span> of {result.scanned.toLocaleString()} rows
              {result.compareMatched != null && <> · vs {result.compareMatched.toLocaleString()}</>}
              {result.window && result.bucketMs > 0 && (
                <>
                  {" "}
                  · {formatBucket(result.window[0], result.bucketMs)} → {formatBucket(result.window[1], result.bucketMs)}
                </>
              )}{" "}
              · {result.elapsedMs.toFixed(1)} ms
              {refreshedAt && ready?.live && live && <> · refreshed {new Date(refreshedAt).toLocaleTimeString()}</>}
            </p>
          )}
        </header>

        {showSql && sql && (
          <div className="border-b border-loom-border bg-loom-surface/60 px-3 py-2 space-y-1.5">
            <pre className="text-2xs font-mono text-loom-text whitespace-pre-wrap max-h-40 overflow-auto">{sql}</pre>
            <div className="flex gap-2">
              <button type="button" className={smallBtn} onClick={() => navigator.clipboard.writeText(sql).then(() => setToast("SQL copied"))}>
                Copy
              </button>
              {isTauri() && (
                <button
                  type="button"
                  className={smallBtn}
                  onClick={() => {
                    setQuerySql(sql);
                    setViewMode("query");
                  }}
                >
                  Open in Query
                </button>
              )}
              {!isTauri() && <span className="text-2xs text-loom-muted">DuckDB SQL — runs in the desktop app</span>}
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto p-3">
          {loading && !ready && <p className="text-xs text-loom-muted">Loading rows…</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {result && query && result.matched === 0 && (
            <p className="text-xs text-loom-muted">No rows match. Loosen a filter or widen the time window.</p>
          )}
          {result && query && result.matched > 0 && query.view === "timeseries" && query.timeColumn && (
            <div className="h-full min-h-[260px]">
              <DiveTimeSeries
                buckets={result.buckets}
                bucketMs={result.bucketMs}
                series={result.series}
                metricLabel={result.metricLabels[ob] ?? ""}
                compareLabel={compareLabel}
              />
            </div>
          )}
          {result && query && result.matched > 0 && query.view === "table" && (
            <DiveTable query={query} result={result} onDrill={drill} onSort={(i) => update({ orderBy: i })} />
          )}
          {result && query && result.matched > 0 && query.view === "samples" && ready && (
            <DiveSamples columns={ready.data.columns} rows={result.samples} onDrill={drill} />
          )}
        </div>
      </section>
    </div>
  );
}

function LinkBanner({ src, onDismiss }: { src: string; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-loom-accent/40 bg-loom-accent/10 px-2.5 py-2 text-2xs text-loom-text flex gap-2 items-start text-left">
      <span className="flex-1">
        This shared dive is for <span className="font-mono">{src.replace(/^stream:\/\//, "stream: ")}</span>. Open that dataset from the sidebar and the
        query applies automatically.
      </span>
      <button type="button" onClick={onDismiss} className="text-loom-muted hover:text-loom-text" aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

function DiveTable({
  query,
  result,
  onDrill,
  onSort,
}: {
  query: DiveQuery;
  result: ReturnType<typeof runDive>;
  onDrill: (column: string, value: string, exclude: boolean) => void;
  onSort: (metricIndex: number) => void;
}) {
  const ob = Math.min(query.orderBy, query.metrics.length - 1);
  const maxRank = Math.max(1e-9, ...result.groups.map((g) => g.metrics[ob] ?? 0));
  const comparing = !!result.totalCompare;
  return (
    <div className="space-y-1.5">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="border-b border-loom-border text-2xs text-loom-muted">
            {query.groupBy.map((g) => (
              <th key={g} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">
                {g}
              </th>
            ))}
            {result.metricLabels.map((label, i) => (
              <th key={label + i} className="text-right font-medium px-2 py-1.5 whitespace-nowrap" colSpan={comparing ? 2 : 1}>
                <button type="button" onClick={() => onSort(i)} className={`hover:text-loom-text ${i === ob ? "text-loom-text" : ""}`} title="Rank by this metric">
                  {label}
                  {i === ob ? " ↓" : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {query.groupBy.length > 0 &&
            result.groups.map((g) => (
              <tr key={g.key} className="border-b border-loom-border/50 hover:bg-loom-elevated/50">
                {g.values.map((v, j) => (
                  <td key={j} className="px-2 py-1 max-w-[18rem] truncate">
                    <button
                      type="button"
                      className="text-left text-loom-text hover:text-loom-accent hover:underline truncate max-w-full"
                      onClick={(e) => onDrill(query.groupBy[j]!, v, e.altKey)}
                      title={`Click: only ${v} · ⌥-click: exclude`}
                    >
                      {v}
                    </button>
                  </td>
                ))}
                {g.metrics.map((v, i) => {
                  const d = comparing ? formatDelta(v, g.compare?.[i] ?? null) : null;
                  return [
                    <td
                      key={`v${i}`}
                      className="px-2 py-1 text-right tabular-nums text-loom-text whitespace-nowrap"
                      style={
                        i === ob && v != null
                          ? { background: `linear-gradient(to left, color-mix(in srgb, var(--loom-accent) 18%, transparent) ${Math.max(0, (v / maxRank) * 100)}%, transparent 0)` }
                          : undefined
                      }
                    >
                      {formatDiveNumber(v)}
                    </td>,
                    comparing ? (
                      <td
                        key={`d${i}`}
                        className={`px-1.5 py-1 text-right text-2xs whitespace-nowrap ${d?.sign === 1 ? "text-emerald-400" : d?.sign === -1 ? "text-red-400" : "text-loom-muted"}`}
                        title={`was ${formatDiveNumber(g.compare?.[i] ?? null)}`}
                      >
                        {d?.text ?? "—"}
                      </td>
                    ) : null,
                  ];
                })}
              </tr>
            ))}
          <tr className="text-loom-text font-semibold">
            {query.groupBy.length > 0 && (
              <td className="px-2 py-1.5" colSpan={query.groupBy.length}>
                Total
              </td>
            )}
            {result.total.map((v, i) => {
              const d = comparing ? formatDelta(v, result.totalCompare?.[i] ?? null) : null;
              return [
                <td key={`t${i}`} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {formatDiveNumber(v)}
                </td>,
                comparing ? (
                  <td key={`td${i}`} className={`px-1.5 py-1.5 text-right text-2xs ${d?.sign === 1 ? "text-emerald-400" : d?.sign === -1 ? "text-red-400" : "text-loom-muted"}`}>
                    {d?.text ?? "—"}
                  </td>
                ) : null,
              ];
            })}
          </tr>
        </tbody>
      </table>
      {result.groupCount > result.groups.length && (
        <p className="text-2xs text-loom-muted">
          Top {result.groups.length} of {result.groupCount.toLocaleString()} groups — raise “top N” to see more.
        </p>
      )}
      {query.groupBy.length === 0 && <p className="text-2xs text-loom-muted">Add a Group by to break this down.</p>}
    </div>
  );
}

function DiveSamples({
  columns,
  rows,
  onDrill,
}: {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  onDrill: (column: string, value: string, exclude: boolean) => void;
}) {
  return (
    <div className="overflow-auto">
      <p className="text-2xs text-loom-muted mb-1.5">Newest {rows.length} matching rows · click a value to filter (⌥ to exclude)</p>
      <table className="text-2xs font-mono border-collapse">
        <thead className="sticky top-0 bg-loom-bg">
          <tr className="border-b border-loom-border text-loom-muted">
            {columns.map((c) => (
              <th key={c} className="text-left font-medium px-2 py-1 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-loom-border/40 hover:bg-loom-elevated/50">
              {r.map((v, j) => {
                const s = v == null ? "∅" : String(v);
                return (
                  <td key={j} className="px-2 py-0.5 whitespace-nowrap max-w-[16rem] truncate">
                    <button type="button" className="text-left text-loom-text hover:text-loom-accent truncate max-w-full" onClick={(e) => s.length <= 120 && onDrill(columns[j]!, s, e.altKey)} title={s}>
                      {s}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
