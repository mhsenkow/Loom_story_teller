"use client";

// Create / edit a monitor. The decision field is required: monitoring that
// isn't tied to an action is just a dashboard that beeps.

import { useEffect, useMemo, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { viewModeName } from "@/lib/viewModes";
import { SOURCE_DEFS, SOURCE_BY_KIND, type SourceKind } from "@/lib/sourceRegistry";
import { computeMetric, describeRule, fmtValue } from "@/lib/monitoring/engine";
import { describeSchedule, nextRunAfter, scheduleError } from "@/lib/monitoring/schedule";
import { requestNotificationPermission } from "@/lib/monitoring/notify";
import type { MonitorDraft } from "@/lib/monitoring/templates";
import { metricSeries, simulate, spanLabel } from "@/lib/monitoring/backfill";
import { MonitorPreviewChart } from "./MonitorPreviewChart";
import { useFeedSample } from "./useFeedSample";
import { NumberField } from "./NumberField";
import { CLOUD_MIN_INTERVAL_MINUTES, WEBHOOK_KIND_LABEL, loadWebhook } from "@/lib/monitoring/cloudSync";
import type { ExpectedWindow, MetricFilter, MonitorAgg, MonitorRule, MonitorSchedule } from "@/lib/monitoring/types";

const AGGS: { id: MonitorAgg; label: string }[] = [
  { id: "latest", label: "Latest value" },
  { id: "avg", label: "Average" },
  { id: "max", label: "Maximum" },
  { id: "min", label: "Minimum" },
  { id: "median", label: "Median" },
  { id: "p95", label: "95th percentile" },
  { id: "sum", label: "Sum" },
  { id: "count", label: "Row count" },
  { id: "distinct", label: "Distinct values" },
];

const RULE_KINDS: { id: MonitorRule["kind"]; label: string; hint: string }[] = [
  { id: "threshold", label: "Limit", hint: "Above or below a number you choose" },
  { id: "range", label: "Healthy range", hint: "Alert outside low–high" },
  { id: "change", label: "Sudden change", hint: "% jump vs last check or recent median" },
  { id: "anomaly", label: "Unusual for now", hint: "Far from normal for this hour or weekday" },
  { id: "stale", label: "Feed went quiet", hint: "No new rows for a while" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NUMERIC = new Set(["DOUBLE", "INTEGER", "BIGINT", "BOOLEAN"]);
const TIME = new Set(["TIMESTAMP", "DATE"]);

function q(vals: number[], p: number): number | undefined {
  if (!vals.length) return undefined;
  const s = [...vals].sort((a, b) => a - b);
  const v = s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!;
  return Number(v.toPrecision(3));
}

/** New rules start from the data: limits at the high end of what the feed has shown. */
function defaultRule(kind: MonitorRule["kind"], vals: number[] = []): MonitorRule {
  switch (kind) {
    case "threshold": return { kind, above: q(vals, 0.95) ?? 0 };
    case "range": return { kind, low: q(vals, 0.05) ?? 0, high: q(vals, 0.95) ?? 100 };
    case "change": return { kind, pct: 10, direction: "either", versus: "previous" };
    case "anomaly": return { kind, sensitivity: 3.5, window: 30, seasonal: "none" };
    case "stale": return { kind, maxAgeMinutes: 120 };
  }
}

function blankDraft(): MonitorDraft {
  return {
    name: "",
    decision: "",
    metric: { source: "usgs", agg: "max", column: "magnitude", timeColumn: "ts", lookbackMinutes: 60, unit: "M" },
    rule: { kind: "threshold", above: 6 },
    confirmChecks: 1,
    severity: "warning",
    schedule: { kind: "interval", minutes: 15 },
    notify: { inApp: true, system: false, cooldownMinutes: 60 },
    expected: [],
    enabled: true,
  };
}

const numOr = (s: string, fallback?: number) => (s.trim() === "" || !Number.isFinite(Number(s)) ? fallback : Number(s));
const label = "block text-2xs font-medium uppercase tracking-wide text-loom-label mb-1";

export function MonitorEditor() {
  const editingId = useLoomStore((s) => s.monitorEditingId);
  const seed = useLoomStore((s) => s.monitorDraftSeed);
  const existing = useLoomStore((s) => s.monitors.find((m) => m.id === s.monitorEditingId));
  const allMonitors = useLoomStore((s) => s.monitors);
  const scorecards = useMemo(() => [...new Set(allMonitors.map((m) => m.scorecard).filter(Boolean) as string[])], [allMonitors]);
  const { addMonitor, updateMonitor, openMonitorEditor, setToast } = useLoomStore.getState();

  const [d, setD] = useState<MonitorDraft>(() => {
    if (existing) {
      const { id: _i, createdAt: _c, nextRunAt: _n, ...rest } = existing;
      return structuredClone(rest);
    }
    return structuredClone(seed ?? blankDraft());
  });
  const [newWin, setNewWin] = useState<{ label: string; mode: "recurring" | "once"; weekdays: number[]; from: string; to: string; start: string; end: string }>(
    { label: "", mode: "recurring", weekdays: [1, 2, 3, 4, 5], from: "2", to: "4", start: "", end: "" },
  );

  const def = SOURCE_BY_KIND[d.metric.source];
  const cols = useMemo(() => def.columns.map((c, i) => ({ name: c, type: def.types[i]! })), [def]);
  const numericCols = cols.filter((c) => NUMERIC.has(c.type));
  const timeCols = cols.filter((c) => TIME.has(c.type));

  const set = (patch: Partial<MonitorDraft>) => setD((x) => ({ ...x, ...patch }));
  const setMetric = (patch: Partial<MonitorDraft["metric"]>) => setD((x) => ({ ...x, metric: { ...x.metric, ...patch } }));
  const setRule = (rule: MonitorRule) => set({ rule });
  const setSchedule = (schedule: MonitorSchedule) => set({ schedule });
  const setNotify = (patch: Partial<MonitorDraft["notify"]>) => setD((x) => ({ ...x, notify: { ...x.notify, ...patch } }));

  const changeSource = (kind: SourceKind) => {
    const nd = SOURCE_BY_KIND[kind];
    const firstNum = nd.columns.find((_, i) => NUMERIC.has(nd.types[i]!));
    const firstTime = nd.columns.find((_, i) => TIME.has(nd.types[i]!));
    setReseed(true);
    setMetric({ source: kind, column: firstNum, timeColumn: firstTime, filters: [], unit: firstNum ? nd.units?.[firstNum] : undefined });
  };

  const feed = useFeedSample(d.metric.source);
  const series = useMemo(() => (feed.sample ? metricSeries(d.metric, feed.sample) : []), [feed.sample, d.metric]);
  const sim = useMemo(() => simulate({ ...d, id: "preview" }, series), [d, series]);
  const nowValue = useMemo(() => (feed.sample ? computeMetric(d.metric, feed.sample, Date.now()) : null), [feed.sample, d.metric]);
  const seriesVals = series.map((p) => p.value);
  // A blank monitor, or a new feed / column, takes its limits from the data once it loads.
  const [reseed, setReseed] = useState(() => !existing && !seed);
  useEffect(() => {
    if (!reseed || feed.loading || !feed.sample) return;
    const vals = seriesVals.length ? seriesVals : nowValue?.value != null ? [nowValue.value] : [];
    if (!vals.length) return;
    setReseed(false);
    if (d.rule.kind === "threshold" || d.rule.kind === "range") setD((x) => ({ ...x, rule: defaultRule(x.rule.kind, vals) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseed, feed.loading, feed.sample, series]);

  const schedErr = scheduleError(d.schedule, d.tz);
  const upcoming = useMemo(() => {
    if (schedErr) return [];
    const out: number[] = [];
    let t = Date.now();
    for (let i = 0; i < 3; i++) { t = nextRunAfter(d.schedule, t, d.tz); out.push(t); }
    return out;
  }, [d.schedule, schedErr]);

  const problems: string[] = [];
  if (!d.name.trim()) problems.push("Give it a name");
  if (!d.decision.trim()) problems.push("Say what you'll do when it fires");
  if (d.metric.agg !== "count" && !d.metric.column) problems.push("Pick a column");
  if (d.rule.kind === "stale" && !d.metric.timeColumn) problems.push("“Feed went quiet” needs a time column");
  if (d.rule.kind === "range" && d.rule.low >= d.rule.high) problems.push("Low must be below high");
  if (d.rule.kind === "threshold" && d.rule.above == null && d.rule.below == null) problems.push("Set a limit");
  if (schedErr) problems.push(schedErr);

  const save = async () => {
    if (problems.length) return;
    if (d.notify.system) {
      const p = await requestNotificationPermission();
      if (p !== "granted") setToast("System notifications are off for Loom. Alerts will show in the app only.");
    }
    if (existing) {
      updateMonitor(existing.id, d);
      setToast(`Updated “${d.name}”`);
    } else {
      addMonitor(d);
      setToast(`Watching “${d.name}”. First check runs now.`);
    }
    openMonitorEditor(null);
  };

  const addWindow = () => {
    const w: ExpectedWindow = newWin.mode === "once"
      ? { id: "", label: newWin.label || "Planned event", start: Date.parse(newWin.start), end: Date.parse(newWin.end), origin: "manual" }
      : { id: "", label: newWin.label || "Recurring window", weekdays: newWin.weekdays, fromHour: Number(newWin.from), toHour: Number(newWin.to), origin: "manual" };
    if (newWin.mode === "once" && (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end! <= w.start!)) {
      setToast("Pick a start and an end after it");
      return;
    }
    set({ expected: [...d.expected, { ...w, id: `exp_${Date.now().toString(36)}` }] });
    setNewWin((x) => ({ ...x, label: "" }));
  };

  if (!editingId) return null;
  const r = d.rule;
  const hook = loadWebhook();

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-end loom-overlay animate-fade-in"
      onClick={() => openMonitorEditor(null)}
      onKeyDown={(e) => { if (e.key === "Escape") openMonitorEditor(null); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={existing ? `Edit ${existing.name}` : "New monitor"}
        className="loom-focus-panel h-full w-full max-w-xl overflow-y-auto bg-loom-surface border-l border-loom-border p-4 pt-[max(1rem,var(--safe-top))] sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-loom-text">{existing ? "Edit monitor" : "New monitor"}</h2>
          <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => openMonitorEditor(null)}>Close</button>
        </div>

        {d.chart && (
          <p className="text-xs text-loom-text bg-loom-accent/10 border border-loom-accent/30 rounded-md p-2">
            Watching the chart <strong>“{d.chart.title}”</strong>. The measure, calculation and lookback below match what it plots{d.rule.kind === "anomaly" && d.rule.sensitivity <= 2.5 ? ", and \"unusual\" uses the same |z| > 2.5 as its anomaly rings" : ""}. Adjust anything that doesn&apos;t fit.
            <button type="button" className="ml-1 underline text-loom-muted" onClick={() => set({ chart: undefined })}>Unlink</button>
          </p>
        )}
        <section className="space-y-3">
          <div>
            <label className={label} htmlFor="mon-name">Name</label>
            <input id="mon-name" className="loom-input w-full" value={d.name} placeholder="e.g. Warehouse heat" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="mon-decision">If this fires, I will…</label>
            <textarea id="mon-decision" className="loom-input w-full min-h-16" value={d.decision} placeholder="The decision or action this monitor exists for" onChange={(e) => set({ decision: e.target.value })} />
            <p className="text-2xs text-loom-muted mt-1">Tie it to something you&apos;d actually do. You&apos;ll be asked afterward whether each alert led to that.</p>
          </div>
          <div>
            <label className={label} htmlFor="mon-why">Why it matters (optional)</label>
            <input id="mon-why" className="loom-input w-full" value={d.rationale ?? ""} placeholder="Who is affected, what it costs" onChange={(e) => set({ rationale: e.target.value || undefined })} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-loom-text">What to measure</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={label} htmlFor="mon-src">Feed</label>
              <select id="mon-src" className="loom-input w-full" value={d.metric.source} onChange={(e) => changeSource(e.target.value as SourceKind)}>
                {SOURCE_DEFS.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="mon-agg">Calculation</label>
              <select id="mon-agg" className="loom-input w-full" value={d.metric.agg} onChange={(e) => setMetric({ agg: e.target.value as MonitorAgg })}>
                {AGGS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="mon-col">Column</label>
              <select
                id="mon-col"
                className="loom-input w-full"
                disabled={d.metric.agg === "count"}
                value={d.metric.column ?? ""}
                onChange={(e) => { setReseed(true); setMetric({ column: e.target.value, unit: def.units?.[e.target.value] ?? d.metric.unit }); }}
              >
                {(d.metric.agg === "distinct" ? cols : numericCols).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="mon-time">Time column</label>
              <select id="mon-time" className="loom-input w-full" value={d.metric.timeColumn ?? ""} onChange={(e) => setMetric({ timeColumn: e.target.value || undefined })}>
                <option value="">None</option>
                {timeCols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="mon-look">Only the last … minutes</label>
              <input id="mon-look" className="loom-input w-full" inputMode="numeric" disabled={!d.metric.timeColumn} value={d.metric.lookbackMinutes ?? ""} placeholder="All rows" onChange={(e) => setMetric({ lookbackMinutes: numOr(e.target.value) })} />
            </div>
            <div>
              <label className={label} htmlFor="mon-unit">Unit</label>
              <input id="mon-unit" className="loom-input w-full" value={d.metric.unit ?? ""} onChange={(e) => setMetric({ unit: e.target.value || undefined })} />
            </div>
          </div>

          <div className="space-y-2">
            <span className={label}>Only rows where</span>
            {(d.metric.filters ?? []).map((f, i) => (
              <div key={i} className="flex gap-1.5">
                <select className="loom-input flex-1 min-w-0" aria-label="Filter column" value={f.column} onChange={(e) => setMetric({ filters: d.metric.filters!.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })}>
                  {cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <select className="loom-input w-20" aria-label="Operator" value={f.op} onChange={(e) => setMetric({ filters: d.metric.filters!.map((x, j) => (j === i ? { ...x, op: e.target.value as MetricFilter["op"] } : x)) })}>
                  {["=", "!=", ">", ">=", "<", "<=", "contains"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <input className="loom-input flex-1 min-w-0" aria-label="Value" value={f.value} onChange={(e) => setMetric({ filters: d.metric.filters!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <button type="button" className="loom-btn-ghost px-2 rounded-md text-xs" aria-label="Remove filter" onClick={() => setMetric({ filters: d.metric.filters!.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => setMetric({ filters: [...(d.metric.filters ?? []), { column: cols[0]!.name, op: "=", value: "" }] })}>+ Filter</button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-loom-text">When is it a problem?</h3>
          <div className="rounded-md border border-loom-border bg-loom-bg/60 p-2 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs text-loom-text min-w-0 truncate">
                {AGGS.find((a) => a.id === d.metric.agg)?.label ?? d.metric.agg} {d.metric.agg !== "count" && d.metric.column ? `of ${d.metric.column}` : "rows"}
                {d.metric.lookbackMinutes ? ` · last ${d.metric.lookbackMinutes >= 1440 ? `${Math.round(d.metric.lookbackMinutes / 1440)} d` : d.metric.lookbackMinutes >= 60 ? `${Math.round(d.metric.lookbackMinutes / 60)} h` : `${d.metric.lookbackMinutes} min`}` : ""}
              </p>
              <p className="text-sm font-mono text-loom-text shrink-0">{feed.loading ? "…" : fmtValue(nowValue?.value, d.metric.unit)} <span className="text-2xs text-loom-muted font-sans">now</span></p>
            </div>
            {feed.loading ? (
              <div className="h-24 flex items-center justify-center text-xs text-loom-muted">Loading {def.label}…</div>
            ) : feed.error ? (
              <p className="text-xs text-loom-error">{feed.error}</p>
            ) : nowValue?.error ? (
              <p className="text-xs text-loom-error">{nowValue.error}</p>
            ) : (
              <MonitorPreviewChart series={series} records={sim.records} rule={d.rule} unit={d.metric.unit} liveValue={nowValue?.value} onRuleChange={setRule} />
            )}
            {!feed.loading && sim.span && d.rule.kind !== "stale" && (
              <p className="text-2xs text-loom-muted" role="status">
                Over the last {spanLabel(sim.span.to - sim.span.from)} loaded, this would have alerted{" "}
                <strong className={sim.alerts ? "text-loom-error" : "text-loom-text"}>{sim.alerts === 0 ? "never" : sim.alerts === 1 ? "once" : `${sim.alerts} times`}</strong>
                {sim.suppressed ? `; ${sim.suppressed} breach${sim.suppressed === 1 ? " was" : "es were"} inside expected windows` : ""}.
                {sim.alerts > 6 ? " That's a lot. Raise the limit or confirm over more checks." : ""}
                {(r.kind === "threshold" || r.kind === "range") && " Drag the dashed line to change the limit."}
              </p>
            )}
            {!feed.loading && !sim.span && !nowValue?.error && (
              <p className="text-2xs text-loom-muted">{d.metric.timeColumn ? "Not enough timestamped rows yet to replay history." : "This feed is a snapshot without timestamps, so only the current value is shown. Checks build the history from here."}</p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label="Rule">
            {RULE_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={r.kind === k.id}
                className={`text-left rounded-md border px-2 py-1.5 ${r.kind === k.id ? "border-loom-accent bg-loom-accent/10" : "border-loom-border"}`}
                onClick={() => r.kind !== k.id && setRule(defaultRule(k.id, seriesVals.length ? seriesVals : nowValue?.value != null ? [nowValue.value] : []))}
              >
                <span className="block text-xs font-medium text-loom-text">{k.label}</span>
                <span className="block text-2xs text-loom-muted">{k.hint}</span>
              </button>
            ))}
          </div>

          {r.kind === "threshold" && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className={label} htmlFor="r-above">Above</label><NumberField id="r-above" className="loom-input w-full" allowEmpty value={r.above} onChange={(v) => setRule({ ...r, above: v })} /></div>
              <div><label className={label} htmlFor="r-below">Below</label><NumberField id="r-below" className="loom-input w-full" allowEmpty value={r.below} onChange={(v) => setRule({ ...r, below: v })} /></div>
            </div>
          )}
          {r.kind === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className={label} htmlFor="r-low">Low</label><NumberField id="r-low" className="loom-input w-full" value={r.low} onChange={(v) => v != null && setRule({ ...r, low: v })} /></div>
              <div><label className={label} htmlFor="r-high">High</label><NumberField id="r-high" className="loom-input w-full" value={r.high} onChange={(v) => v != null && setRule({ ...r, high: v })} /></div>
            </div>
          )}
          {r.kind === "change" && (
            <div className="grid grid-cols-3 gap-2">
              <div><label className={label} htmlFor="r-pct">By %</label><NumberField id="r-pct" className="loom-input w-full" value={r.pct} onChange={(v) => v != null && setRule({ ...r, pct: Math.abs(v) })} /></div>
              <div><label className={label} htmlFor="r-dir">Direction</label>
                <select id="r-dir" className="loom-input w-full" value={r.direction} onChange={(e) => setRule({ ...r, direction: e.target.value as "up" | "down" | "either" })}>
                  <option value="either">Either</option><option value="up">Rise</option><option value="down">Drop</option>
                </select></div>
              <div><label className={label} htmlFor="r-vs">Compared with</label>
                <select id="r-vs" className="loom-input w-full" value={r.versus} onChange={(e) => setRule({ ...r, versus: e.target.value as "previous" | "baseline" })}>
                  <option value="previous">Last check</option><option value="baseline">Recent median</option>
                </select></div>
            </div>
          )}
          {r.kind === "anomaly" && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div><label className={label} htmlFor="r-sens">Sensitivity</label>
                  <select id="r-sens" className="loom-input w-full" value={r.sensitivity} onChange={(e) => setRule({ ...r, sensitivity: Number(e.target.value) })}>
                    <option value={2.5}>Sensitive</option><option value={3.5}>Balanced</option><option value={5}>Conservative</option>
                  </select></div>
                <div><label className={label} htmlFor="r-win">Baseline checks</label><input id="r-win" className="loom-input w-full" inputMode="numeric" value={r.window} onChange={(e) => setRule({ ...r, window: Math.max(5, Math.min(200, numOr(e.target.value, 30)!)) })} /></div>
                <div><label className={label} htmlFor="r-seas">Normal for</label>
                  <select id="r-seas" className="loom-input w-full" value={r.seasonal} onChange={(e) => setRule({ ...r, seasonal: e.target.value as "none" | "hour" | "weekday-hour" })}>
                    <option value="none">Any time</option><option value="hour">This hour of day</option><option value="weekday-hour">This weekday + hour</option>
                  </select></div>
              </div>
              <p className="text-2xs text-loom-muted leading-relaxed">
                Out of range isn&apos;t automatically wrong. &quot;Unusual&quot; here means far from the median of earlier checks, using a robust score (median and MAD), so one old spike doesn&apos;t widen the band.
                Choose &quot;this hour of day&quot; when daily cycles are normal. Add expected windows below for maintenance, planned events or deliberate tests.
                It needs at least 5 comparable checks before it judges anything.
              </p>
            </div>
          )}
          {r.kind === "stale" && (
            <div><label className={label} htmlFor="r-age">No new rows for (minutes)</label><input id="r-age" className="loom-input w-full" inputMode="numeric" value={r.maxAgeMinutes} onChange={(e) => setRule({ ...r, maxAgeMinutes: numOr(e.target.value, 60)! })} /></div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div><label className={label} htmlFor="r-confirm">Confirm over … checks</label>
              <input id="r-confirm" className="loom-input w-full" inputMode="numeric" value={d.confirmChecks} onChange={(e) => set({ confirmChecks: Math.max(1, Math.min(20, numOr(e.target.value, 1)!)) })} /></div>
            <div><label className={label} htmlFor="r-sev">Severity</label>
              <select id="r-sev" className="loom-input w-full" value={d.severity} onChange={(e) => set({ severity: e.target.value as MonitorDraft["severity"] })}>
                <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
              </select></div>
          </div>
          <p className="text-2xs text-loom-muted">{describeRule(d.rule, d.metric.unit)}{d.confirmChecks > 1 ? `, after ${d.confirmChecks} checks in a row` : ""}.</p>

        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-loom-text">Expected: don&apos;t alert during</h3>
          {d.expected.length === 0 && <p className="text-2xs text-loom-muted">Nothing yet. Reviewing an alert as &quot;expected&quot; can add one for you.</p>}
          <ul className="space-y-1">
            {d.expected.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 text-xs border border-loom-border rounded-md px-2 py-1">
                <span className="min-w-0 truncate">
                  {w.label} · {w.start != null ? `${new Date(w.start).toLocaleString()} → ${new Date(w.end!).toLocaleString()}` : `${(w.weekdays ?? []).map((x) => WEEKDAYS[x]).join(" ") || "Daily"} ${w.fromHour}:00–${w.toHour}:00`}
                  {w.origin === "review" && <span className="ml-1 text-loom-muted">(learned)</span>}
                </span>
                <button type="button" className="loom-btn-ghost px-1.5 rounded text-2xs" aria-label={`Remove ${w.label}`} onClick={() => set({ expected: d.expected.filter((x) => x.id !== w.id) })}>✕</button>
              </li>
            ))}
          </ul>
          <div className="space-y-2 border border-dashed border-loom-border rounded-md p-2">
            <div className="flex gap-1.5">
              <input className="loom-input flex-1 min-w-0" aria-label="Window label" placeholder="e.g. Nightly backup, product launch" value={newWin.label} onChange={(e) => setNewWin({ ...newWin, label: e.target.value })} />
              <select className="loom-input w-28" aria-label="Window type" value={newWin.mode} onChange={(e) => setNewWin({ ...newWin, mode: e.target.value as "recurring" | "once" })}>
                <option value="recurring">Recurring</option><option value="once">One-off</option>
              </select>
            </div>
            {newWin.mode === "recurring" ? (
              <div className="flex flex-wrap items-center gap-1">
                {WEEKDAYS.map((w, i) => (
                  <button key={w} type="button" aria-pressed={newWin.weekdays.includes(i)}
                    className={`text-2xs px-1.5 py-0.5 rounded border ${newWin.weekdays.includes(i) ? "border-loom-accent text-loom-accent-text bg-loom-accent/10" : "border-loom-border text-loom-muted"}`}
                    onClick={() => setNewWin({ ...newWin, weekdays: newWin.weekdays.includes(i) ? newWin.weekdays.filter((x) => x !== i) : [...newWin.weekdays, i].sort() })}>{w}</button>
                ))}
                <input className="loom-input w-14" aria-label="From hour" inputMode="numeric" value={newWin.from} onChange={(e) => setNewWin({ ...newWin, from: e.target.value })} />
                <span className="text-2xs text-loom-muted">to</span>
                <input className="loom-input w-14" aria-label="To hour" inputMode="numeric" value={newWin.to} onChange={(e) => setNewWin({ ...newWin, to: e.target.value })} />
                <span className="text-2xs text-loom-muted">h</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <input type="datetime-local" className="loom-input" aria-label="Start" value={newWin.start} onChange={(e) => setNewWin({ ...newWin, start: e.target.value })} />
                <input type="datetime-local" className="loom-input" aria-label="End" value={newWin.end} onChange={(e) => setNewWin({ ...newWin, end: e.target.value })} />
              </div>
            )}
            <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={addWindow}>+ Add window</button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-loom-text">When to check</h3>
          <div className="flex flex-wrap gap-1.5">
            <select className="loom-input" aria-label="Schedule type" value={d.schedule.kind} onChange={(e) => {
              const k = e.target.value as MonitorSchedule["kind"];
              setSchedule(k === "interval" ? { kind: k, minutes: 15 } : k === "daily" ? { kind: k, hour: 8, minute: 0 } : k === "weekly" ? { kind: k, weekday: 1, hour: 8, minute: 0 } : { kind: k, expr: "*/30 8-18 * * 1-5" });
            }}>
              <option value="interval">Every…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="cron">Cron</option>
            </select>
            {d.schedule.kind === "interval" && (() => { const s = d.schedule; return (
              <select className="loom-input" aria-label="Interval" value={s.minutes} onChange={(e) => setSchedule({ ...s, minutes: Number(e.target.value) })}>
                {[1, 5, 10, 15, 30, 60, 180, 360, 720, 1440].map((m) => <option key={m} value={m}>{describeSchedule({ kind: "interval", minutes: m })}</option>)}
              </select>); })()}
            {(d.schedule.kind === "daily" || d.schedule.kind === "weekly") && (() => { const s = d.schedule; return (
              <>
                {s.kind === "weekly" && (
                  <select className="loom-input" aria-label="Weekday" value={s.weekday} onChange={(e) => setSchedule({ ...s, weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                  </select>
                )}
                <input type="time" className="loom-input" aria-label="Time" value={`${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`}
                  onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); setSchedule({ ...s, hour: h ?? 0, minute: m ?? 0 }); }} />
              </>); })()}
            {d.schedule.kind === "cron" && (() => { const s = d.schedule; return (
              <input className="loom-input font-mono flex-1 min-w-40" aria-label="Cron expression" value={s.expr} onChange={(e) => setSchedule({ ...s, expr: e.target.value })} />
            ); })()}
          </div>
          {schedErr ? <p className="text-2xs text-loom-error">{schedErr}</p> : (
            <p className="text-2xs text-loom-muted">Next: {upcoming.map((t) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })).join(" · ")}</p>
          )}
          {d.schedule.kind === "cron" && <p className="text-2xs text-loom-muted font-mono">minute hour day month weekday · e.g. 0 7 * * 1-5 = 7:00 on weekdays</p>}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-loom-text">How to tell you</h3>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={d.notify.inApp} onChange={(e) => setNotify({ inApp: e.target.checked })} /> In-app banner</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={d.notify.system} onChange={(e) => setNotify({ system: e.target.checked })} /> System notification</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!d.onFire?.chime} onChange={(e) => set({ onFire: { ...d.onFire, chime: e.target.checked } })} /> Chime</label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={!!d.onFire?.shareMoment} onChange={(e) => set({ onFire: { ...d.onFire, shareMoment: e.target.checked } })} />
            <span>Auto-share the moment<span className="block text-2xs text-loom-muted">Publishes a public story page with the chart of what happened, ready to send or post to NeoSpace.</span></span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={label} htmlFor="n-cool">Remind every (min)</label>
              <input id="n-cool" className="loom-input w-full" inputMode="numeric" value={d.notify.cooldownMinutes} onChange={(e) => setNotify({ cooldownMinutes: Math.max(0, numOr(e.target.value, 0)!) })} /></div>
            <div><label className={label} htmlFor="n-qf">Quiet from (h)</label>
              <input id="n-qf" className="loom-input w-full" inputMode="numeric" value={d.notify.quietFromHour ?? ""} placeholder="—" onChange={(e) => setNotify({ quietFromHour: numOr(e.target.value) })} /></div>
            <div><label className={label} htmlFor="n-qt">Quiet to (h)</label>
              <input id="n-qt" className="loom-input w-full" inputMode="numeric" value={d.notify.quietToHour ?? ""} placeholder="—" onChange={(e) => setNotify({ quietToHour: numOr(e.target.value) })} /></div>
          </div>
          <p className="text-2xs text-loom-muted">0 = tell me once per alert. Quiet hours still record checks; they just skip the system notification.</p>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={!!d.cloud} onChange={(e) => set({ cloud: e.target.checked || undefined })} />
            <span>
              Always on: Loom&apos;s server runs this check on its schedule (at most every {CLOUD_MIN_INTERVAL_MINUTES} min), even when the app is closed, and sends alerts to your channel.
              <span className="block text-2xs text-loom-muted">
                {hook ? `Alerts go to ${WEBHOOK_KIND_LABEL[hook.kind]}.` : `Set up a channel in ${viewModeName("monitor")} → Where alerts go first, or alerts are only logged.`}
              </span>
            </span>
          </label>
          <div>
            <label className={label} htmlFor="mon-card">Scorecard</label>
            <input id="mon-card" className="loom-input w-full" list="mon-cards" value={d.scorecard ?? ""} placeholder="Group related metrics, e.g. City heat health" onChange={(e) => set({ scorecard: e.target.value || undefined })} />
            <datalist id="mon-cards">{scorecards.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
        </section>

        <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-[max(0.75rem,var(--safe-bottom))] bg-loom-surface border-t border-loom-border flex items-center justify-between gap-2">
          <p className="text-2xs text-loom-muted min-w-0">{problems[0] ?? `${describeSchedule(d.schedule)} · ${def.label}`}</p>
          <button type="button" className="loom-btn-primary text-sm px-4 py-1.5 rounded-md shrink-0" disabled={problems.length > 0} onClick={save}>
            {existing ? "Save" : "Start watching"}
          </button>
        </div>
      </div>
    </div>
  );
}
