"use client";

// Quick Watch — "Tell me when ___ goes above ___", in one step, over any view.
// The chart is the control: drag the line, see how often it would have fired,
// pick where to hear about it, done. Everything else lives in More options.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { SOURCE_BY_KIND, SOURCE_DEFS, type SourceKind } from "@/lib/sourceRegistry";
import { computeMetric, fmtValue } from "@/lib/monitoring/engine";
import { metricSeries, simulate, spanLabel } from "@/lib/monitoring/backfill";
import { requestNotificationPermission } from "@/lib/monitoring/notify";
import { currentPushSubscription, loadWebhook } from "@/lib/monitoring/cloudSync";
import { draftForFeed, feedMeasures, type MonitorDraft } from "@/lib/monitoring/templates";
import type { MonitorAgg, MonitorRule } from "@/lib/monitoring/types";
import { MonitorPreviewChart } from "./MonitorPreviewChart";
import { useFeedSample } from "./useFeedSample";
import { NumberField } from "./NumberField";

const AGG_WORD: Record<MonitorAgg, string> = {
  latest: "the latest", avg: "the average", max: "the highest", min: "the lowest", median: "the median", p95: "the 95th percentile", sum: "the total", count: "the number of rows", distinct: "the number of distinct",
};

const PLANS = ["Take a look at the chart", "Tell the team", "Post it to NeoSpace", "Check the source"];

type Verb = "above" | "below" | "unusual" | "change";

function verbOf(r: MonitorRule): Verb {
  if (r.kind === "threshold") return r.below != null && r.above == null ? "below" : "above";
  if (r.kind === "anomaly") return "unusual";
  if (r.kind === "change") return "change";
  return "above";
}

function pct(vals: number[], q: number): number {
  const s = [...vals].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.round((s.length - 1) * q))]!.toPrecision(3));
}

export function QuickWatch() {
  const seed = useLoomStore((s) => s.monitorDraftSeed);
  const { openMonitorEditor, addMonitor, setToast, setViewMode, focusMoment } = useLoomStore.getState();
  const [d, setD] = useState<MonitorDraft>(() => structuredClone(seed!));
  const [plan, setPlan] = useState(d.decision || PLANS[0]!);
  const [hasPhone] = useState(() => !!loadWebhook());
  const [hasPush, setHasPush] = useState(false);
  useEffect(() => { void currentPushSubscription().then((s) => setHasPush(!!s)); }, []);
  const remote = hasPhone || hasPush;
  const [alwaysOn, setAlwaysOn] = useState(() => d.cloud ?? remote);
  useEffect(() => { if (remote && d.cloud === undefined) setAlwaysOn(true); }, [remote, d.cloud]);

  const def = SOURCE_BY_KIND[d.metric.source];
  const feed = useFeedSample(d.metric.source);
  const series = useMemo(() => (feed.sample ? metricSeries(d.metric, feed.sample) : []), [feed.sample, d.metric]);
  const sim = useMemo(() => simulate({ ...d, id: "quick" }, series), [d, series]);
  const now = useMemo(() => (feed.sample ? computeMetric(d.metric, feed.sample, Date.now()).value : null), [feed.sample, d.metric]);
  const vals = series.map((p) => p.value);
  const verb = verbOf(d.rule);

  // New feed / measure (or a starter draft): put the limit near the top of what the data has shown.
  useEffect(() => {
    if (!d.reseed || feed.loading || !feed.sample) return;
    const base = vals.length ? vals : now != null ? [now] : [];
    if (!base.length) return;
    setD((x) => {
      const { reseed: _r, ...rest } = x;
      if (x.rule.kind !== "threshold") return rest;
      return { ...rest, rule: x.rule.below != null && x.rule.above == null ? { kind: "threshold", below: pct(base, 0.05) } : { kind: "threshold", above: pct(base, 0.95) } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.reseed, feed.loading, feed.sample, series, now]);

  const changeFeed = (kind: SourceKind) => {
    const next = draftForFeed(kind);
    setD((x) => ({ ...next, decision: x.decision, notify: x.notify, onFire: x.onFire, cloud: x.cloud, rule: verb === "below" ? { kind: "threshold", below: 0 } : next.rule }));
  };
  const changeMeasure = (key: string) => {
    const next = draftForFeed(d.metric.source, key === "__rows" ? undefined : key);
    if (key === "__rows") next.metric = { source: d.metric.source, agg: "count", timeColumn: next.metric.timeColumn, lookbackMinutes: next.metric.timeColumn ? 60 : undefined };
    setD((x) => ({ ...x, name: x.chart ? x.name : next.name, metric: next.metric, chart: undefined, reseed: true, rule: x.rule.kind === "threshold" ? x.rule : next.rule }));
  };
  const measures = feedMeasures(d.metric.source);

  const setRule = (rule: MonitorRule) => setD((x) => ({ ...x, rule }));
  const setVerb = (v: Verb) => {
    const base = vals.length ? vals : now != null ? [now] : [0];
    if (v === "above") setRule({ kind: "threshold", above: d.rule.kind === "threshold" && d.rule.above != null ? d.rule.above : pct(base, 0.95) });
    if (v === "below") setRule({ kind: "threshold", below: d.rule.kind === "threshold" && d.rule.below != null ? d.rule.below : pct(base, 0.05) });
    if (v === "unusual") setRule({ kind: "anomaly", sensitivity: 3.5, window: 30, seasonal: def.grain === "reading" ? "hour" : "none" });
    if (v === "change") setRule({ kind: "change", pct: 10, direction: "either", versus: "previous" });
  };
  const limit = d.rule.kind === "threshold" ? (d.rule.above ?? d.rule.below) : d.rule.kind === "change" ? d.rule.pct : undefined;

  const close = () => openMonitorEditor(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus lands inside so Escape and Tab work straight away.
  useEffect(() => { panelRef.current?.focus(); }, []);
  const draftNow = (): MonitorDraft => ({
    ...d,
    decision: plan.trim() || PLANS[0]!,
    cloud: alwaysOn || undefined,
    onFire: { ...d.onFire, chime: d.onFire?.chime ?? true },
  });
  const save = async () => {
    const final = draftNow();
    if (final.notify.system) {
      const p = await requestNotificationPermission();
      if (p !== "granted" && !remote) setToast("System notifications are off. Alerts will show in Loom.");
    }
    addMonitor(final);
    close();
    setToast(`Watching “${final.name}”${final.cloud ? ", always on" : ""}.`);
  };

  const measure = `${AGG_WORD[d.metric.agg]} ${d.metric.agg === "count" ? "" : (d.metric.column ?? "").replace(/_/g, " ")}`.trim();
  const look = d.metric.lookbackMinutes ? ` over the last ${d.metric.lookbackMinutes >= 1440 ? `${Math.round(d.metric.lookbackMinutes / 1440)} days` : d.metric.lookbackMinutes >= 60 ? `${Math.round(d.metric.lookbackMinutes / 60)} h` : `${d.metric.lookbackMinutes} min`}` : "";

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center loom-overlay animate-fade-in" onClick={close} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Quick watch" className="outline-none loom-focus-panel w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-loom-surface border border-loom-border rounded-t-xl sm:rounded-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wide text-loom-label flex items-center gap-1">
              Watch ·
              <select aria-label="Feed" className="bg-transparent uppercase tracking-wide text-2xs text-loom-label outline-none focus:underline max-w-[14rem]" value={d.metric.source} onChange={(e) => changeFeed(e.target.value as SourceKind)}>
                {SOURCE_DEFS.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
              </select>
              {d.chart ? <span className="truncate">· {d.chart.title}</span> : null}
            </p>
            <input className="bg-transparent text-base font-semibold text-loom-text w-full outline-none focus:underline" aria-label="Monitor name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </div>
          <p className="text-right shrink-0"><span className="block text-lg font-mono text-loom-text">{feed.loading ? "…" : fmtValue(now, d.metric.unit)}</span><span className="text-2xs text-loom-muted">now</span></p>
        </div>

        {feed.loading ? (
          <div className="h-40 flex items-center justify-center text-xs text-loom-muted">Loading {def.label}…</div>
        ) : (
          <MonitorPreviewChart series={series} records={sim.records} rule={d.rule} unit={d.metric.unit} liveValue={now} onRuleChange={setRule} height={170} />
        )}

        <p className="text-sm text-loom-text leading-relaxed">
          Tell me when{" "}
          {measures.length > 0 && !d.chart ? (
            <select aria-label="Measure" className="loom-input inline-block w-auto py-0.5 text-sm font-semibold" value={d.metric.agg === "count" ? "__rows" : d.metric.column ?? ""} onChange={(e) => changeMeasure(e.target.value)}>
              {measures.map((c) => <option key={c} value={c}>{AGG_WORD[d.metric.agg === "count" ? (def.grain === "event" ? "max" : "latest") : d.metric.agg]} {c.replace(/_/g, " ")}</option>)}
              <option value="__rows">the number of new rows</option>
            </select>
          ) : <strong>{measure}</strong>}
          {look}{" "}
          <select aria-label="Condition" className="loom-input inline-block w-auto py-0.5 text-sm" value={verb} onChange={(e) => setVerb(e.target.value as Verb)}>
            <option value="above">goes above</option>
            <option value="below">goes below</option>
            <option value="unusual">looks unusual</option>
            <option value="change">jumps by</option>
          </select>{" "}
          {limit != null && (
            <>
              <NumberField
                aria-label="Limit"
                className="loom-input inline-block w-24 py-0.5 text-sm font-mono"
                value={limit}
                onChange={(v) => {
                  if (v == null) return;
                  if (d.rule.kind === "threshold") setRule(verb === "below" ? { kind: "threshold", below: v } : { kind: "threshold", above: v });
                  if (d.rule.kind === "change") setRule({ ...d.rule, pct: v });
                }}
              />{" "}
              {d.rule.kind === "change" ? "%" : d.metric.unit}
            </>
          )}
        </p>
        {sim.span && (
          <p className="text-2xs text-loom-muted" role="status">
            In the last {spanLabel(sim.span.to - sim.span.from)} that would have happened <strong className={sim.alerts ? "text-loom-error" : "text-loom-text"}>{sim.alerts === 0 ? "never" : sim.alerts === 1 ? "once" : `${sim.alerts} times`}</strong>.
            {d.rule.kind === "threshold" && " Drag the dashed line to adjust."}
          </p>
        )}

        <div className="space-y-1">
          <p className="text-2xs uppercase tracking-wide text-loom-label">Then I&apos;ll</p>
          <div className="flex flex-wrap gap-1">
            {PLANS.map((p) => (
              <button key={p} type="button" aria-pressed={plan === p} className={`text-2xs px-2 py-1 rounded-full border ${plan === p ? "border-loom-accent bg-loom-accent/10 text-loom-text" : "border-loom-border text-loom-muted"}`} onClick={() => setPlan(p)}>{p}</button>
            ))}
          </div>
          <input className="loom-input w-full text-xs" aria-label="Your plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </div>

        <div className="space-y-1">
          <p className="text-2xs uppercase tracking-wide text-loom-label">Tell me</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={d.notify.system} onChange={(e) => setD({ ...d, notify: { ...d.notify, system: e.target.checked } })} /> On this screen</label>
            <label className="flex items-center gap-1" title={remote ? undefined : "Set up your phone or browser push in Monitor → Where alerts go"}>
              <input type="checkbox" checked={alwaysOn} onChange={(e) => setAlwaysOn(e.target.checked)} /> Even when Loom is closed{remote ? ` (${[hasPhone ? "phone" : null, hasPush ? "browser push" : null].filter(Boolean).join(" + ")})` : ""}
            </label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={d.onFire?.chime ?? true} onChange={(e) => setD({ ...d, onFire: { ...d.onFire, chime: e.target.checked } })} /> Chime</label>
            <label className="flex items-center gap-1" title="Publishes a public story page with the moment card when it fires"><input type="checkbox" checked={!!d.onFire?.shareMoment} onChange={(e) => setD({ ...d, onFire: { ...d.onFire, shareMoment: e.target.checked } })} /> Auto-share the moment</label>
          </div>
          {alwaysOn && !remote && (
            <p className="text-2xs text-loom-warning-text">
              No phone or browser push yet, so always-on alerts are only logged.{" "}
              <button type="button" className="underline" onClick={() => { close(); setViewMode("monitor"); focusMoment(null); }}>Set one up</button>
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" className="loom-btn-ghost text-xs px-2 py-1.5 rounded-md" onClick={() => { openMonitorEditor("new", draftNow(), "full"); setViewMode("monitor"); }}>More options</button>
          <div className="flex gap-1.5">
            <button type="button" className="loom-btn-ghost text-xs px-3 py-1.5 rounded-md" onClick={close}>Cancel</button>
            <button type="button" className="loom-btn-primary text-sm px-4 py-1.5 rounded-md" disabled={!d.name.trim()} onClick={save}>Start watching</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const seedIds = new WeakMap<object, number>();
let seedCounter = 0;

/** Mounted once in the app shell so Quick Watch opens over Chart, Explorer, or Monitor. */
export function QuickWatchHost() {
  const open = useLoomStore((s) => s.monitorEditingId === "new" && s.monitorEditorMode === "quick" && !!s.monitorDraftSeed);
  const seed = useLoomStore((s) => s.monitorDraftSeed);
  if (!open || !seed) return null;
  let key = seedIds.get(seed);
  if (key == null) { key = ++seedCounter; seedIds.set(seed, key); }
  return <QuickWatch key={key} />;
}
