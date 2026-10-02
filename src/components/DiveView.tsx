"use client";

// =================================================================
// Loom — Dive view (Scuba-style slice-and-dice)
// =================================================================
// Left: query builder (time window, filters, group by, metrics,
// derived columns, compare). Right: Time series · Table · Samples over
// the same query. Click a value to drill in (filter + next group),
// ⌥-click to exclude; drag the chart to zoom. Live streams auto-refresh.
// The query lives in the URL (#dive=…): links share a dive, and Back /
// Forward walk your query history. Engine: src/lib/dive.ts (+ derived
// columns in diveExpr.ts); rows: diveSource.ts.
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
  DIVE_FILLS,
  DIVE_OP_LABELS,
  DIVE_RANGES,
  DIVE_TIME_PRESETS,
  badFilterValue,
  decodeDiveLink,
  defaultDiveQuery,
  diveToSql,
  encodeDiveLink,
  formatBucket,
  formatDelta,
  formatDiveNumber,
  metricLabel,
  opTakesValues,
  opsForKind,
  profileDiveColumns,
  runDive,
  sanitizeDiveQuery,
  toTime,
  type DiveColumnProfile,
  type DiveData,
  type DiveFilter,
  type DiveMetric,
  type DiveQuery,
  type DiveViewKind,
} from "@/lib/dive";
import { DIVE_EXPR_FUNCTIONS, applyDerivedColumns, formatExprTime, nextDerivedName, type DiveDerived } from "@/lib/diveExpr";
import { isLiveDivePath, loadDiveDataset, type DiveDataset } from "@/lib/diveSource";
import { DiveTimeSeries } from "@/components/DiveTimeSeries";
import { DiveChipInput } from "@/components/DiveChipInput";

const LIMITS = [5, 10, 25, 50, 100, 250];
const KIND_ICON: Record<DiveColumnProfile["kind"], string> = { time: "◷", number: "#", category: "Aa" };
const NO_DERIVED: DiveDerived[] = [];
const SIDEBAR_KEY = "loom-dive-sidebar";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
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
const deltaCls = (sign: -1 | 0 | 1 | undefined) => (sign === 1 ? "text-loom-success" : sign === -1 ? "text-loom-error" : "text-loom-muted");

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Epoch ms metric (first / last seen) → short readable date. */
function formatWhen(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Zoom = Pick<DiveQuery, "range" | "start" | "end">;

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
  const [zoomStack, setZoomStack] = useState<Zoom[]>([]);
  const sampleRef = useRef(sampleRows);
  sampleRef.current = sampleRows;
  const pathRef = useRef(path);
  pathRef.current = path;
  // Layout follows Dive's own width (side panels can squeeze it on any screen).
  const rootRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  // Start narrow on phones so the first paint doesn't flash the side-by-side layout.
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= 720);
  const [sideW, setSideW] = useState(296);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWide(e.contentRect.width >= 720));
    ro.observe(el);
    return () => ro.disconnect();
    // Root only exists once a file is open.
  }, [selectedFile]);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIDEBAR_KEY));
      if (v >= 240 && v <= 560) setSideW(v);
    } catch {
      /* private mode — keep the default */
    }
  }, []);

  const load = useCallback(async (p: string, quiet = false) => {
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
  }, []);

  useEffect(() => {
    setZoomStack([]);
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

  // Derived columns are appended to every row first, so the rest of the
  // query (filters, group by, metrics) treats them as real columns.
  const rawQuery = diveQuery?.src === path ? diveQuery.query : null;
  const derivedDefs = rawQuery?.derived ?? NO_DERIVED;
  const derivedOut = useMemo(() => (ready ? applyDerivedColumns(ready.data.columns, ready.data.rows, derivedDefs) : null), [ready, derivedDefs]);
  const data: DiveData | null = useMemo(() => {
    if (!ready || !derivedOut) return null;
    const extra = derivedOut.columns.length - ready.data.columns.length;
    const types = ready.data.types ? [...ready.data.types, ...Array.from({ length: extra }, () => "VARCHAR")] : undefined;
    return { columns: derivedOut.columns, rows: derivedOut.rows, types };
  }, [ready, derivedOut]);
  const profiles = useMemo(() => (data ? profileDiveColumns(data) : []), [data]);

  // Apply a shared link once its dataset is open.
  useEffect(() => {
    if (!diveLink || !path || diveLink.src !== path || !profiles.length) return;
    setDiveQuery({ src: path, query: diveLink.query });
    setDiveLink(null);
    setToast("Opened shared dive");
  }, [diveLink, path, profiles, setDiveQuery, setDiveLink, setToast]);

  const query: DiveQuery | null = useMemo(() => {
    if (!profiles.length || !path) return null;
    if (rawQuery) return sanitizeDiveQuery(rawQuery, profiles);
    return defaultDiveQuery(profiles);
  }, [rawQuery, path, profiles]);

  const update = useCallback(
    (patch: Partial<DiveQuery> | ((q: DiveQuery) => DiveQuery)) => {
      if (!query || !path) return;
      const next = typeof patch === "function" ? patch(query) : { ...query, ...patch };
      setDiveQuery({ src: path, query: next });
    },
    [query, path, setDiveQuery],
  );

  const result = useMemo(() => (data && query ? runDive(data, query, profiles) : null), [data, query, profiles]);

  // The whole query rides in the hash. Deliberate changes push a history
  // entry (Back = previous query, like Scuba); rapid edits such as typing
  // collapse into one entry.
  const lastPushRef = useRef(0);
  const fromPopRef = useRef(false);
  useEffect(() => {
    if (!query || !path) return;
    const hash = `#${encodeDiveLink({ src: path, query })}`;
    if (window.location.hash === hash) return;
    const now = Date.now();
    const replace = fromPopRef.current || !window.location.hash.startsWith("#dive=") || now - lastPushRef.current < 1200;
    fromPopRef.current = false;
    if (replace) window.history.replaceState(null, "", hash);
    else window.history.pushState(null, "", hash);
    lastPushRef.current = now;
  }, [query, path]);
  useEffect(() => {
    const onPop = () => {
      const link = decodeDiveLink(window.location.hash);
      if (!link || link.src !== pathRef.current) return;
      fromPopRef.current = true;
      useLoomStore.getState().setDiveQuery({ src: link.src, query: link.query });
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (window.location.hash.startsWith("#dive=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
  }, []);

  const timeCols = profiles.filter((p) => p.kind === "time");
  const numCols = profiles.filter((p) => p.kind === "number");
  const groupable = profiles.filter((p) => p.kind !== "time" && p.distinct > 1);

  // Filter value suggestions: distinct values per column, most common first (built on demand).
  const valueIndexRef = useRef<{ data: DiveData | null; map: Map<string, string[]> }>({ data: null, map: new Map() });
  const suggestFor = useCallback(
    (column: string) => (typed: string) => {
      if (!data) return [];
      if (valueIndexRef.current.data !== data) valueIndexRef.current = { data, map: new Map() };
      const valueIndex = valueIndexRef.current.map;
      let vals = valueIndex.get(column);
      if (!vals) {
        const ci = data.columns.indexOf(column);
        const freq = new Map<string, number>();
        for (const r of data.rows) {
          const v = r[ci];
          if (v == null || v === "") continue;
          const k = String(v);
          if (k.length > 200) continue;
          freq.set(k, (freq.get(k) ?? 0) + 1);
        }
        vals = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5000).map(([k]) => k);
        valueIndex.set(column, vals);
      }
      const t = typed.toLowerCase();
      return (t ? vals.filter((v) => v.toLowerCase().includes(t)) : vals).slice(0, 30);
    },
    [data],
  );

  const drill = useCallback(
    (column: string, value: string, exclude: boolean) => {
      update((q) => {
        const op = exclude ? "!=" : "=";
        const same = q.filters.find((f) => f.column === column && f.op === op);
        // ⌥-clicking a second value excludes both (NOT IN); a plain click narrows to just this one.
        const filters: DiveFilter[] =
          exclude && same
            ? q.filters.map((f) => (f === same ? { ...f, values: [...new Set([...f.values, value])] } : f))
            : [...q.filters.filter((f) => !(f.column === column && f.op === op)), { column, op, values: [value] }];
        if (exclude) return { ...q, filters };
        // Drilling in: the value is now fixed, so stop grouping by it.
        return { ...q, filters, groupBy: q.groupBy.filter((g) => g !== column) };
      });
    },
    [update],
  );

  const zoomTo = useCallback(
    (a: number, b: number) => {
      if (!query) return;
      setZoomStack((s) => [...s, { range: query.range, start: query.start, end: query.end }]);
      update({ range: "custom", start: formatExprTime(a), end: formatExprTime(b) });
    },
    [query, update],
  );
  const zoomOut = useCallback(() => {
    if (!query) return;
    const prev = zoomStack[zoomStack.length - 1];
    if (prev) {
      setZoomStack((s) => s.slice(0, -1));
      update(prev);
    } else if (query.range === "custom") update({ range: "all", start: "", end: "" });
  }, [query, zoomStack, update]);

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
    if (!cubePlan || !data || !result || !selectedFile) return;
    const rows = result.matchedIndices.slice(0, 20_000).map((i) => data.rows[i]!);
    setSampleRows({ columns: data.columns, types: data.types ?? data.columns.map(() => "VARCHAR"), rows, total_rows: rows.length });
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
  }, [cubePlan, data, result, selectedFile, columnStats, setSampleRows, setActiveChart, setViewMode, setToast]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let w = sideW;
    const move = (ev: PointerEvent) => {
      w = Math.max(240, Math.min(560, ev.clientX - left));
      setSideW(w);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(SIDEBAR_KEY, String(Math.round(w)));
      } catch {
        /* not persisted — fine */
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

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
  const derivedErrors = derivedOut?.errors ?? [];
  const metricCols = (agg: DiveMetric["agg"]) => {
    const info = DIVE_AGGS.find((a) => a.value === agg)!;
    if (!info.numeric) return profiles;
    return info.time ? [...numCols, ...timeCols] : numCols;
  };

  return (
    <div ref={rootRef} className={`h-full flex min-h-0 ${wide ? "flex-row" : "flex-col"}`}>
      {/* ── Query builder ───────────────────────────────────────── */}
      <aside
        ref={asideRef}
        className={`shrink-0 border-loom-border overflow-y-auto p-3 space-y-4 bg-loom-surface/40 ${wide ? "border-r" : "max-h-[42%] border-b"}`}
        style={wide ? { width: sideW } : undefined}
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
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-2xs ${live ? "border-loom-success/50 text-loom-success" : "border-loom-border text-loom-muted"}`}
                title={live ? "Auto-refreshing — click to pause" : "Paused — click to auto-refresh"}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-loom-success animate-pulse" : "bg-loom-muted"}`} />
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
            <Section
              title="Time"
              action={
                query.range === "custom" ? (
                  <button type="button" className={smallBtn} onClick={zoomOut} title="Back to the previous window">
                    {zoomStack.length ? "← Zoom out" : "All time"}
                  </button>
                ) : undefined
              }
            >
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
                  <select
                    className={`${selectCls} w-full`}
                    value={query.range}
                    onChange={(e) => {
                      const range = e.target.value as DiveQuery["range"];
                      setZoomStack([]);
                      // Seed a custom window from the current preset so it starts somewhere sensible.
                      if (range === "custom" && !query.start && !query.end) {
                        const preset = DIVE_RANGES.find((r) => r.value === query.range);
                        const hours = preset && Number.isFinite(preset.ms) ? preset.ms / 3_600_000 : null;
                        update({ range, start: hours ? `-${hours} hours` : "", end: "latest" });
                      } else update({ range });
                    }}
                    disabled={!query.timeColumn}
                    aria-label="Time range"
                  >
                    {DIVE_RANGES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <select className={`${selectCls} w-full`} value={query.bucket} onChange={(e) => update({ bucket: e.target.value as DiveQuery["bucket"] })} disabled={!query.timeColumn} aria-label="Bucket size">
                    {DIVE_BUCKETS.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.value === "auto" ? "Auto bucket" : b.value === "fine" ? "Fine buckets" : `per ${b.label}`}
                      </option>
                    ))}
                  </select>
                  {query.range === "custom" && (
                    <div className="col-span-2 grid grid-cols-2 gap-1.5">
                      <TimeBound label="From" value={query.start ?? ""} onCommit={(v) => update({ start: v })} />
                      <TimeBound label="To" value={query.end ?? ""} onCommit={(v) => update({ end: v })} />
                    </div>
                  )}
                  <select className={`${selectCls} w-full col-span-2`} value={query.compare} onChange={(e) => update({ compare: e.target.value as DiveQuery["compare"] })} disabled={!query.timeColumn} aria-label="Compare">
                    {DIVE_COMPARES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value === "none" ? "No comparison" : `Compare: ${c.label.toLowerCase()}`}
                      </option>
                    ))}
                  </select>
                  {query.view === "timeseries" && (
                    <select className={`${selectCls} w-full col-span-2`} value={query.fill ?? "auto"} onChange={(e) => update({ fill: e.target.value as DiveQuery["fill"] })} aria-label="Empty buckets">
                      {DIVE_FILLS.map((f) => (
                        <option key={f.value} value={f.value}>
                          Empty buckets: {f.label.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  )}
                  {result?.timeErrors.map((t) => (
                    <p key={t} className="col-span-2 text-2xs text-loom-error">
                      {t} — try “-3 hours”, “yesterday”, or “2026-09-01 14:00”.
                    </p>
                  ))}
                  {query.timeColumn && (
                    <p className="col-span-2 text-2xs text-loom-muted">
                      {query.range === "custom" ? "Relative times count back from the newest row." : "Windows end at the latest row."}
                    </p>
                  )}
                </div>
              )}
            </Section>

            <Section
              title="Filters"
              action={
                <button
                  type="button"
                  className={smallBtn}
                  onClick={() => update((q) => ({ ...q, filters: [...q.filters, { column: groupable[0]?.name ?? profiles[0]!.name, op: "=", values: [] }] }))}
                >
                  + Add
                </button>
              }
            >
              {query.filters.length === 0 && <p className="text-2xs text-loom-muted">All rows. Click any value in the results to filter.</p>}
              {query.filters.map((f, i) => {
                const prof = profiles.find((p) => p.name === f.column);
                const ops = opsForKind(prof?.kind ?? "category");
                const setF = (patch: Partial<DiveFilter>) => update((q) => ({ ...q, filters: q.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                const bad = badFilterValue(f);
                return (
                  <div key={i} className="rounded-md border border-loom-border p-1.5 space-y-1">
                    <div className="flex gap-1">
                      <select
                        className={`${selectCls} flex-1`}
                        value={f.column}
                        onChange={(e) => {
                          const kind = profiles.find((p) => p.name === e.target.value)?.kind ?? "category";
                          setF({ column: e.target.value, values: [], op: opsForKind(kind).includes(f.op) ? f.op : "=" });
                        }}
                        aria-label="Filter column"
                      >
                        {profiles.map((p) => (
                          <option key={p.name} value={p.name}>
                            {KIND_ICON[p.kind]} {p.name}
                          </option>
                        ))}
                      </select>
                      <select className={`${selectCls} w-[7.5rem] shrink-0`} value={f.op} onChange={(e) => setF({ op: e.target.value as DiveFilter["op"] })} aria-label="Operator">
                        {(ops.includes(f.op) ? ops : [f.op, ...ops]).map((o) => (
                          <option key={o} value={o}>
                            {DIVE_OP_LABELS[o]}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={xBtn} onClick={() => update((q) => ({ ...q, filters: q.filters.filter((_, j) => j !== i) }))} aria-label="Remove filter">
                        ×
                      </button>
                    </div>
                    {opTakesValues(f.op) && (
                      <DiveChipInput
                        values={f.values}
                        onChange={(values) => setF({ values })}
                        suggest={prof?.kind === "category" || prof?.kind === "number" ? suggestFor(f.column) : undefined}
                        placeholder={f.op === "~" || f.op === "!~" ? "regex, e.g. ^en" : f.op === "like" ? "pattern, e.g. Main%" : prof?.kind === "time" ? "2026-09-01 or -1 day" : "value(s)"}
                        ariaLabel="Filter values"
                      />
                    )}
                    {f.values.length > 1 && (f.op === "=" || f.op === "contains" || f.op === "~" || f.op === "like") && <p className="text-2xs text-loom-muted">Matches any of these.</p>}
                    {f.values.length > 1 && (f.op === "!=" || f.op === "!contains" || f.op === "!~") && <p className="text-2xs text-loom-muted">Excludes all of these.</p>}
                    {bad && <p className="text-2xs text-loom-error">{bad}</p>}
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
                  {(LIMITS.includes(query.limit) ? LIMITS : [...LIMITS, query.limit].sort((a, b) => a - b)).map((l) => (
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
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-2xs text-loom-muted hover:text-loom-text"
                    onClick={() => update({ orderDir: query.orderDir === "asc" ? "desc" : "asc" })}
                    title="Which groups count as “top”"
                  >
                    {query.orderDir === "asc" ? "↑ lowest first" : "↓ highest first"}
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => update((q) => ({ ...q, metrics: [...q.metrics, { agg: numCols.length ? "avg" : "distinct", column: numCols[0]?.name ?? groupable[0]?.name ?? null }] }))}
                  >
                    + Add
                  </button>
                </div>
              }
            >
              {query.metrics.map((m, i) => {
                const info = DIVE_AGGS.find((a) => a.value === m.agg)!;
                const cols = metricCols(m.agg);
                const setM = (patch: Partial<DiveMetric>) => update((q) => ({ ...q, metrics: q.metrics.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                return (
                  <div key={i} className="flex gap-1 items-center">
                    <input
                      type="radio"
                      name="dive-rank"
                      checked={ob === i}
                      onChange={() => update({ orderBy: i })}
                      title="Rank groups by this metric"
                      aria-label={`Rank by ${metricLabel(m)}`}
                      className="accent-[var(--loom-accent)] shrink-0"
                    />
                    <select
                      className={`${selectCls} w-28 shrink-0`}
                      value={m.agg}
                      onChange={(e) => {
                        const agg = e.target.value as DiveMetric["agg"];
                        const next = DIVE_AGGS.find((a) => a.value === agg)!;
                        const allowed = metricCols(agg);
                        const keep = m.column && allowed.some((c) => c.name === m.column);
                        setM({ agg, column: next.needsColumn ? (keep ? m.column : (allowed[0]?.name ?? null)) : null });
                      }}
                      aria-label="Aggregate"
                    >
                      {DIVE_AGGS.map((a) => (
                        <option key={a.value} value={a.value} disabled={a.numeric && numCols.length === 0 && !(a.time && timeCols.length)}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                    {info.needsColumn ? (
                      <select className={`${selectCls} flex-1`} value={m.column ?? ""} onChange={(e) => setM({ column: e.target.value })} aria-label="Metric column">
                        {cols.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.kind === "time" ? `◷ ${c.name}` : c.name}
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
              {!query.metrics.some((m) => m.agg === "count") && (
                <label className="flex items-center gap-1.5 text-2xs text-loom-muted">
                  <input type="checkbox" checked={query.hits !== false} onChange={(e) => update({ hits: e.target.checked })} className="accent-[var(--loom-accent)]" />
                  Show hits (rows per group) in the table
                </label>
              )}
              {query.metrics.length > 1 && query.view === "timeseries" && <p className="text-2xs text-loom-muted">Each metric gets its own panel; ● ranks the groups.</p>}
            </Section>

            <Section
              title="Derived columns"
              action={
                <button
                  type="button"
                  className={smallBtn}
                  onClick={() =>
                    update((q) => ({
                      ...q,
                      derived: [...(q.derived ?? []), { name: nextDerivedName([...(ready?.data.columns ?? []), ...(q.derived ?? []).map((d) => d.name)]), expr: "", enabled: true }],
                    }))
                  }
                >
                  + Add
                </button>
              }
            >
              {(query.derived ?? []).length === 0 && (
                <p className="text-2xs text-loom-muted">Fix or reshape data without leaving Dive — e.g. <span className="font-mono">lower(country)</span> or <span className="font-mono">hour(ts)</span>. Group and filter on it like any column.</p>
              )}
              {(query.derived ?? []).map((d, i) => (
                <DerivedRow
                  key={i}
                  def={d}
                  error={derivedErrors[i] ?? null}
                  onChange={(next) => update((q) => ({ ...q, derived: (q.derived ?? []).map((x, j) => (j === i ? next : x)) }))}
                  onRemove={() => update((q) => ({ ...q, derived: (q.derived ?? []).filter((_, j) => j !== i) }))}
                />
              ))}
              {(query.derived ?? []).length > 0 && <ExprHelp />}
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
              <button
                type="button"
                onClick={() => {
                  setZoomStack([]);
                  if (path) setDiveQuery({ src: path, query: defaultDiveQuery(profileDiveColumns(ready!.data)) });
                }}
                className="loom-btn-ghost text-2xs px-2 py-1"
              >
                Reset
              </button>
            </div>
          </>
        )}
      </aside>
      {wide && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize query builder"
          onPointerDown={startResize}
          onDoubleClick={() => {
            setSideW(296);
            try {
              localStorage.removeItem(SIDEBAR_KEY);
            } catch {
              /* ignore */
            }
          }}
          className="w-1 -ml-0.5 shrink-0 cursor-col-resize hover:bg-loom-accent/40 active:bg-loom-accent/60 transition-colors z-10"
          style={{ touchAction: "none" }}
        />
      )}

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
          {error && <p className="text-xs text-loom-error">{error}</p>}
          {result && query && result.matched === 0 && <p className="text-xs text-loom-muted">No rows match. Loosen a filter or widen the time window.</p>}
          {result && query && result.matched > 0 && query.view === "timeseries" && query.timeColumn && (
            <div className="h-full min-h-[260px] flex flex-col gap-2">
              <DrillBar query={query} groupable={groupable} onGroup={(g) => update((q) => ({ ...q, groupBy: [...q.groupBy, g] }))} onUp={() => update((q) => ({ ...q, groupBy: q.groupBy.slice(0, -1) }))} />
              <div className="flex-1 min-h-0">
                <DiveTimeSeries
                  buckets={result.buckets}
                  bucketMs={result.bucketMs}
                  series={result.series}
                  metricLabels={result.metricLabels}
                  metricKinds={result.metricKinds}
                  rankIndex={ob}
                  compareLabel={compareLabel}
                  fill={query.fill ?? "auto"}
                  onZoom={zoomTo}
                  onZoomOut={zoomOut}
                />
              </div>
            </div>
          )}
          {result && query && result.matched > 0 && query.view === "table" && (
            <DiveTable
              query={query}
              result={result}
              onDrill={drill}
              onSort={(i) => (i === ob ? update({ orderDir: query.orderDir === "asc" ? "desc" : "asc" }) : update({ orderBy: i, orderDir: "desc" }))}
            />
          )}
          {result && query && result.matched > 0 && query.view === "samples" && data && (
            <DiveSamples
              columns={data.columns}
              profiles={profiles}
              rows={result.samples}
              visible={query.columns ?? null}
              onVisible={(columns) => update({ columns })}
              onDrill={drill}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/** Custom window bound: free text plus quick picks; commits on Enter / blur / pick. */
function TimeBound({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const listId = `dive-time-${label}`;
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className="text-2xs text-loom-muted">{label}</span>
      <input
        className={`${selectCls} w-full`}
        value={draft}
        list={listId}
        placeholder={label === "From" ? "start of data" : "latest"}
        onChange={(e) => {
          setDraft(e.target.value);
          // Picking from the list commits right away.
          if (label === "To" ? ["latest", "now", ...DIVE_TIME_PRESETS].includes(e.target.value) : DIVE_TIME_PRESETS.includes(e.target.value)) onCommit(e.target.value);
        }}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && onCommit(draft)}
        aria-label={`${label} time`}
      />
      <datalist id={listId}>
        {(label === "To" ? ["latest", "now", ...DIVE_TIME_PRESETS] : DIVE_TIME_PRESETS).map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </label>
  );
}

/** One derived column: name + expression, evaluated after a short pause in typing. */
function DerivedRow({ def, error, onChange, onRemove }: { def: DiveDerived; error: string | null; onChange: (d: DiveDerived) => void; onRemove: () => void }) {
  const [name, setName] = useState(def.name);
  const [expr, setExpr] = useState(def.expr);
  useEffect(() => setName(def.name), [def.name]);
  useEffect(() => setExpr(def.expr), [def.expr]);
  const latest = useRef(def);
  latest.current = def;
  useEffect(() => {
    if (name === latest.current.name && expr === latest.current.expr) return;
    const id = window.setTimeout(() => onChange({ ...latest.current, name, expr }), 450);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, expr]);
  return (
    <div className={`rounded-md border p-1.5 space-y-1 ${error && def.enabled ? "border-loom-error/60" : "border-loom-border"}`}>
      <div className="flex gap-1 items-center">
        <input
          type="checkbox"
          checked={def.enabled}
          onChange={(e) => onChange({ ...def, name, expr, enabled: e.target.checked })}
          className="accent-[var(--loom-accent)] shrink-0"
          title={def.enabled ? "Computed — uncheck to switch off" : "Off"}
          aria-label="Compute this column"
        />
        <input className={`${selectCls} flex-1 font-mono`} value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, "_"))} placeholder="name" aria-label="Derived column name" spellCheck={false} />
        <button type="button" className={xBtn} onClick={onRemove} aria-label="Remove derived column">
          ×
        </button>
      </div>
      <textarea
        className="loom-input text-xs font-mono py-1 min-h-[2.75rem] resize-y"
        rows={2}
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onChange({ ...def, name, expr });
        }}
        placeholder="CASE WHEN delta > 0 THEN 'add' ELSE 'cut' END"
        aria-label="Derived column expression"
        spellCheck={false}
      />
      {error && def.enabled && <p className="text-2xs text-loom-error">{error}</p>}
    </div>
  );
}

function ExprHelp() {
  return (
    <details className="text-2xs text-loom-muted">
      <summary className="cursor-pointer hover:text-loom-text">Expression help</summary>
      <div className="mt-1 space-y-1">
        <p>
          DuckDB-style SQL: <span className="font-mono">+ - * / %</span>, <span className="font-mono">||</span>, <span className="font-mono">= != &lt; &gt;</span>, <span className="font-mono">AND OR NOT</span>,{" "}
          <span className="font-mono">IN (…)</span>, <span className="font-mono">LIKE</span>, <span className="font-mono">BETWEEN</span>, <span className="font-mono">IS NULL</span>, <span className="font-mono">CASE WHEN … END</span>,{" "}
          <span className="font-mono">CAST(x AS INTEGER)</span>. Quote odd names: <span className="font-mono">&quot;my col&quot;</span>. Later columns can use earlier ones.
        </p>
        <p className="font-mono leading-relaxed">{DIVE_EXPR_FUNCTIONS.join(" · ")}</p>
      </div>
    </details>
  );
}

/** Above the chart: break the series down by a column, or drill back up a level. */
function DrillBar({ query, groupable, onGroup, onUp }: { query: DiveQuery; groupable: DiveColumnProfile[]; onGroup: (g: string) => void; onUp: () => void }) {
  if (query.groupBy.length) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-2xs">
        <button type="button" onClick={onUp} className="loom-btn-ghost px-2 py-0.5 text-2xs">
          ← Drill up
        </button>
        <span className="text-loom-muted">
          by {query.groupBy.join(" › ")}
          {query.groupBy.length === 1 ? " · back to the total" : ` · back to ${query.groupBy.slice(0, -1).join(" › ")}`}
        </span>
      </div>
    );
  }
  // Columns with a manageable number of values make the best first split.
  const picks = groupable
    .filter((p) => (p.kind === "category" || p.distinct <= 30) && !query.filters.some((f) => f.column === p.name && f.op === "="))
    .sort((a, b) => Number(a.distinct > 30) - Number(b.distinct > 30) || a.distinct - b.distinct)
    .slice(0, 6);
  if (!picks.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-2xs">
      <span className="text-loom-muted mr-0.5">Break down by</span>
      {picks.map((p) => (
        <button key={p.name} type="button" onClick={() => onGroup(p.name)} className="px-2 py-0.5 rounded border border-loom-border text-loom-text hover:border-loom-accent/60 hover:bg-loom-elevated">
          {p.name}
        </button>
      ))}
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
  const rankVals = result.groups.map((g) => g.metrics[ob] ?? 0);
  const maxRank = Math.max(1e-9, ...rankVals.map(Math.abs));
  const comparing = !!result.totalCompare;
  const grouped = query.groupBy.length > 0;
  const showHits = grouped && query.hits !== false && !query.metrics.some((m) => m.agg === "count");
  const fmt = (i: number, v: number | null | undefined) => (result.metricKinds[i] === "time" ? formatWhen(v) : formatDiveNumber(v));
  const share = (n: number | null | undefined) => (n == null || !result.matched ? "" : `${((n / result.matched) * 100).toFixed(n / result.matched < 0.1 ? 1 : 0)}%`);
  const arrow = query.orderDir === "asc" ? " ↑" : " ↓";
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
                <button type="button" onClick={() => onSort(i)} className={`hover:text-loom-text ${i === ob ? "text-loom-text" : ""}`} title={i === ob ? "Flip sort order" : "Rank by this metric"}>
                  {label}
                  {i === ob ? arrow : ""}
                </button>
              </th>
            ))}
            {showHits && <th className="text-right font-medium px-2 py-1.5 whitespace-nowrap">hits</th>}
          </tr>
        </thead>
        <tbody>
          {grouped &&
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
                  const d = comparing && result.metricKinds[i] !== "time" ? formatDelta(v, g.compare?.[i] ?? null) : null;
                  const isCount = query.metrics[i]?.agg === "count";
                  return [
                    <td
                      key={`v${i}`}
                      className="px-2 py-1 text-right tabular-nums text-loom-text whitespace-nowrap"
                      style={
                        i === ob && v != null && result.metricKinds[i] !== "time"
                          ? { background: `linear-gradient(to left, color-mix(in srgb, var(--loom-accent) 18%, transparent) ${Math.max(0, (Math.abs(v) / maxRank) * 100)}%, transparent 0)` }
                          : undefined
                      }
                    >
                      {fmt(i, v)}
                      {isCount && <span className="text-loom-muted text-2xs ml-1.5">{share(v)}</span>}
                    </td>,
                    comparing ? (
                      <td key={`d${i}`} className={`px-1.5 py-1 text-right text-2xs whitespace-nowrap ${deltaCls(d?.sign)}`} title={`was ${fmt(i, g.compare?.[i] ?? null)}`}>
                        {d?.text ?? "—"}
                      </td>
                    ) : null,
                  ];
                })}
                {showHits && (
                  <td className="px-2 py-1 text-right tabular-nums text-loom-text whitespace-nowrap">
                    {formatDiveNumber(g.hits)}
                    <span className="text-loom-muted text-2xs ml-1.5">{share(g.hits)}</span>
                  </td>
                )}
              </tr>
            ))}
          <tr className="text-loom-text font-semibold">
            {grouped && (
              <td className="px-2 py-1.5" colSpan={query.groupBy.length}>
                Total
              </td>
            )}
            {result.total.map((v, i) => {
              const d = comparing && result.metricKinds[i] !== "time" ? formatDelta(v, result.totalCompare?.[i] ?? null) : null;
              return [
                <td key={`t${i}`} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {fmt(i, v)}
                </td>,
                comparing ? (
                  <td key={`td${i}`} className={`px-1.5 py-1.5 text-right text-2xs ${deltaCls(d?.sign)}`}>
                    {d?.text ?? "—"}
                  </td>
                ) : null,
              ];
            })}
            {showHits && <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{formatDiveNumber(result.matched)}</td>}
          </tr>
        </tbody>
      </table>
      {result.groupCount > result.groups.length && (
        <p className="text-2xs text-loom-muted">
          {query.orderDir === "asc" ? "Bottom" : "Top"} {result.groups.length} of {result.groupCount.toLocaleString()} groups — raise “top N” to see more.
        </p>
      )}
      {!grouped && <p className="text-2xs text-loom-muted">Add a Group by to break this down.</p>}
    </div>
  );
}

function DiveSamples({
  columns,
  profiles,
  rows,
  visible,
  onVisible,
  onDrill,
}: {
  columns: string[];
  profiles: DiveColumnProfile[];
  rows: (string | number | boolean | null)[][];
  visible: string[] | null;
  onVisible: (columns: string[] | null) => void;
  onDrill: (column: string, value: string, exclude: boolean) => void;
}) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [picking, setPicking] = useState(false);
  const shown = columns.map((c, i) => ({ c, i })).filter(({ c }) => !visible || visible.includes(c));
  const kindOf = (c: string) => profiles.find((p) => p.name === c)?.kind ?? "category";

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const kind = kindOf(columns[sort.col]!);
    const key = (v: unknown) => (kind === "time" ? toTime(v) : kind === "number" ? Number(v) : NaN);
    return [...rows].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
      const kx = key(x);
      const ky = key(y);
      const c = Number.isFinite(kx) && Number.isFinite(ky) ? kx - ky : String(x).localeCompare(String(y));
      return sort.dir * c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, columns]);

  // Header click cycles ascending → descending → newest-first default.
  const cycle = (i: number) => setSort((s) => (!s || s.col !== i ? { col: i, dir: 1 } : s.dir === 1 ? { col: i, dir: -1 } : null));
  const toggle = (c: string) => {
    const cur = visible ?? columns;
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : columns.filter((x) => x === c || cur.includes(x));
    onVisible(next.length === columns.length ? null : next);
  };

  const groups: { kind: DiveColumnProfile["kind"]; label: string }[] = [
    { kind: "time", label: "Time" },
    { kind: "number", label: "Numbers" },
    { kind: "category", label: "Text" },
  ];

  return (
    <div className="overflow-auto">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <p className="text-2xs text-loom-muted flex-1 min-w-0">
          {sort ? `${rows.length} newest matching rows, sorted by ${columns[sort.col]}` : `Newest ${rows.length} matching rows`} · click a value to filter (⌥ to exclude)
        </p>
        <button type="button" onClick={() => setPicking((p) => !p)} className="loom-btn-ghost text-2xs px-2 py-0.5" aria-expanded={picking}>
          Columns ({shown.length}/{columns.length})
        </button>
      </div>
      {picking && (
        <div className="mb-2 rounded-md border border-loom-border bg-loom-surface/60 p-2 space-y-1.5">
          <div className="flex gap-3 text-2xs">
            <button type="button" className={smallBtn} onClick={() => onVisible(null)}>
              All
            </button>
            <button type="button" className={smallBtn} onClick={() => onVisible(columns.slice(0, 1))}>
              None
            </button>
          </div>
          {groups.map((g) => {
            const cols = columns.filter((c) => kindOf(c) === g.kind);
            if (!cols.length) return null;
            const allOn = cols.every((c) => !visible || visible.includes(c));
            return (
              <div key={g.kind}>
                <div className="flex items-center gap-2 text-2xs text-loom-muted uppercase tracking-wider">
                  {KIND_ICON[g.kind]} {g.label}
                  <button
                    type="button"
                    className="normal-case tracking-normal text-loom-accent hover:underline"
                    onClick={() => {
                      const cur = visible ?? columns;
                      const next = allOn ? cur.filter((c) => !cols.includes(c)) : columns.filter((c) => cur.includes(c) || cols.includes(c));
                      onVisible(next.length === columns.length ? null : next.length ? next : columns.slice(0, 1));
                    }}
                  >
                    {allOn ? "none" : "all"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {cols.map((c) => (
                    <label key={c} className="flex items-center gap-1 text-2xs text-loom-text font-mono">
                      <input type="checkbox" checked={!visible || visible.includes(c)} onChange={() => toggle(c)} className="accent-[var(--loom-accent)]" />
                      {c}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <table className="text-2xs font-mono border-collapse">
        <thead className="sticky top-0 bg-loom-bg">
          <tr className="border-b border-loom-border text-loom-muted">
            {shown.map(({ c, i }) => (
              <th key={c} className="text-left font-medium px-2 py-1 whitespace-nowrap">
                <button type="button" onClick={() => cycle(i)} className={`hover:text-loom-text ${sort?.col === i ? "text-loom-text" : ""}`} title="Sort">
                  {c}
                  {sort?.col === i ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, ri) => (
            <tr key={ri} className="border-b border-loom-border/40 hover:bg-loom-elevated/50">
              {shown.map(({ c, i }) => {
                const v = r[i];
                const s = v == null ? "∅" : String(v);
                // Epoch numbers in a time column read better as dates (click still filters on the raw value).
                const label = typeof v === "number" && kindOf(c) === "time" && Number.isFinite(toTime(v)) ? formatExprTime(toTime(v)) : s;
                const num = typeof v === "number";
                return (
                  <td key={c} className={`px-2 py-0.5 whitespace-nowrap max-w-[16rem] truncate ${num ? "text-right tabular-nums" : ""}`}>
                    <button
                      type="button"
                      className="text-left text-loom-text hover:text-loom-accent truncate max-w-full"
                      onClick={(e) => s.length <= 120 && onDrill(c, s, e.altKey)}
                      title={label === s ? s : `${label} (${s})`}
                    >
                      {label}
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
