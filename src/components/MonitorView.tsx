"use client";

// =================================================================
// MonitorView — alerts inbox, scorecards, and scheduled checks
// =================================================================
// Monitoring is only worth it when it changes a decision. Each card shows the
// decision it supports, and each alert asks what happened next. Over time the
// card says whether the monitor is useful or just noise.
// =================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { SOURCE_BY_KIND } from "@/lib/sourceRegistry";
import { describeRule, fmtValue, monitorUsefulness } from "@/lib/monitoring/engine";
import { describeSchedule } from "@/lib/monitoring/schedule";
import { MONITOR_TEMPLATES } from "@/lib/monitoring/templates";
import { notificationPermission, requestNotificationPermission, type NotifyPermission } from "@/lib/monitoring/notify";
import { runMonitorNow } from "@/lib/monitoring/runner";
import { openMonitorChart } from "@/lib/monitoring/openChart";
import { exportMonitorsJson, parseMonitorsJson } from "@/lib/monitoring/storage";
import { downloadBlob } from "@/lib/download";
import { ALERT_OUTCOME_LABELS, type AlertOutcome, type CheckRecord, type CheckStatus, type Monitor, type MonitorAlert } from "@/lib/monitoring/types";
import { MonitorEditor } from "./monitor/MonitorEditor";
import { ConnectPanel } from "./monitor/ConnectPanel";
import { MomentsSection } from "./monitor/MomentsSection";
import { MonitorPreviewChart } from "./monitor/MonitorPreviewChart";
import { useFeedSample } from "./monitor/useFeedSample";
import { metricSeries, simulate, spanLabel } from "@/lib/monitoring/backfill";
import { suggestMonitorsForFeed } from "@/lib/monitoring/suggest";
import { monitorDraftFromChart } from "@/lib/monitoring/fromChart";
import { chartLinkFromState } from "@/lib/chartLink";
import { sourceKindFromPath, type SourceKind } from "@/lib/sourceRegistry";
import { draftForFeed, type MonitorDraft } from "@/lib/monitoring/templates";
import type { QueryResult } from "@/lib/queryTypes";
import { MonitorSparkline } from "./monitor/MonitorSparkline";
import { friendlyError } from "./sidebar/shared";

const STATUS_STYLE: Record<CheckStatus | "idle" | "paused", { dot: string; label: string }> = {
  ok: { dot: "bg-loom-success", label: "OK" },
  breach: { dot: "bg-loom-warning", label: "Confirming" },
  firing: { dot: "bg-loom-error", label: "Alert" },
  expected: { dot: "bg-loom-muted", label: "Expected" },
  "no-data": { dot: "bg-loom-muted", label: "No data" },
  error: { dot: "bg-loom-warning", label: "Can't read" },
  idle: { dot: "bg-loom-muted", label: "Waiting" },
  paused: { dot: "bg-loom-border", label: "Paused" },
};

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;

function ago(t: number, now: number): string {
  const s = Math.round((now - t) / 1000);
  if (Math.abs(s) < 60) return s >= 0 ? "just now" : "in under a minute";
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return m >= 0 ? `${m} min ago` : `in ${-m} min`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return h >= 0 ? `${h} h ago` : `in ${-h} h`;
  const d = Math.round(h / 24);
  return d >= 0 ? `${d} d ago` : `in ${-d} d`;
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function AlertReview({ alert, monitor }: { alert: MonitorAlert; monitor?: Monitor }) {
  const reviewAlert = useLoomStore((s) => s.reviewAlert);
  const [note, setNote] = useState("");
  const [learn, setLearn] = useState(true);
  const now = useNow();
  const pick = (o: AlertOutcome) => reviewAlert(alert.id, o, note, learn);
  const sev = alert.severity === "critical" ? "border-loom-error" : alert.severity === "warning" ? "border-loom-warning" : "border-loom-accent";
  return (
    <li className={`border-l-2 ${sev} bg-loom-surface/60 rounded-md p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-loom-text">{monitor?.name ?? "Deleted monitor"}</p>
          <p className="text-xs text-loom-text/90">{alert.reason}</p>
          <p className="text-2xs text-loom-muted">
            Opened {ago(alert.openedAt, now)}{alert.closedAt ? ` · back to normal ${ago(alert.closedAt, now)}` : " · still firing"}
            {alert.peakValue != null && ` · peak ${fmtValue(alert.peakValue, monitor?.metric.unit)}`}
          </p>
        </div>
        <span className="loom-badge shrink-0 capitalize">{alert.severity}</span>
      </div>
      {monitor?.decision && <p className="text-xs text-loom-muted"><span className="text-loom-label">Planned action:</span> {monitor.decision}</p>}
      {monitor && (
        <button type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md border border-loom-border" onClick={() => void openMonitorChart(monitor)}>
          {monitor.chart ? `See it on “${monitor.chart.title}”` : "See it on a chart"} →
        </button>
      )}
      <div className="space-y-1.5">
        <p className="text-2xs text-loom-label uppercase tracking-wide">What happened?</p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(ALERT_OUTCOME_LABELS) as AlertOutcome[]).map((o) => (
            <button key={o} type="button" className="loom-btn text-2xs px-2 py-1 rounded-md" onClick={() => pick(o)}>{ALERT_OUTCOME_LABELS[o]}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="loom-input flex-1 min-w-40 text-xs" placeholder="Note (optional): what you did or why it's normal" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
          <label className="flex items-center gap-1 text-2xs text-loom-muted" title="Expected / on purpose → don't alert again at this weekday and hour">
            <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> Remember expected times
          </label>
        </div>
      </div>
    </li>
  );
}

/** Until a monitor has its own history, replay it over the feed's loaded rows. */
function ReplayChart({ draft, height = 96 }: { draft: Pick<Monitor, "metric" | "rule" | "confirmChecks" | "expected" | "notify" | "severity">; height?: number }) {
  const feed = useFeedSample(draft.metric.source);
  const series = useMemo(() => (feed.sample ? metricSeries(draft.metric, feed.sample) : []), [feed.sample, draft.metric]);
  const sim = useMemo(() => simulate({ ...draft, id: "replay" }, series), [draft, series]);
  if (feed.loading) return <div className="text-2xs text-loom-muted" style={{ height }}>Loading feed…</div>;
  if (!series.length || draft.rule.kind === "stale") return <MonitorSparkline checks={[]} rule={draft.rule} unit={draft.metric.unit} />;
  return (
    <div>
      <MonitorPreviewChart series={series} records={sim.records} rule={draft.rule} unit={draft.metric.unit} height={height} />
      <p className="text-2xs text-loom-muted">
        Replayed over the last {spanLabel(sim.span!.to - sim.span!.from)} loaded: would have alerted {sim.alerts === 0 ? "never" : sim.alerts === 1 ? "once" : `${sim.alerts} times`}.
      </p>
    </div>
  );
}

function SuggestionCard({ title, blurb, draft, badge }: { title: string; blurb: string; draft: MonitorDraft; badge?: string }) {
  const openMonitorEditor = useLoomStore((s) => s.openMonitorEditor);
  return (
    <button type="button" className="loom-card text-left rounded-md border border-loom-border p-3 hover:border-loom-accent space-y-1.5 min-w-0" onClick={() => openMonitorEditor("new", draft, "quick")}>
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-loom-text truncate">{title}</span>
        {badge && <span className="loom-badge shrink-0">{badge}</span>}
      </span>
      <span className="block text-2xs text-loom-muted">{blurb}</span>
      <ReplayChart draft={draft} height={84} />
      <span className="block text-2xs text-loom-accent-text">Set it up →</span>
    </button>
  );
}

/** Suggestions from the feed and chart that are open right now. */
function ForYourData() {
  const path = useLoomStore((s) => s.selectedFile?.path ?? null);
  const fileName = useLoomStore((s) => s.selectedFile?.name ?? null);
  const activeChart = useLoomStore((s) => s.activeChart);
  const kind: SourceKind | null = sourceKindFromPath(path);
  const feed = useFeedSample(kind);
  const chartDraft = useMemo(() => {
    if (!kind || !activeChart) return null;
    const s = useLoomStore.getState();
    const title = s.chartTitleOverrides?.[activeChart.id] ?? activeChart.title;
    const r = monitorDraftFromChart(activeChart, path, chartLinkFromState(s), title);
    return "draft" in r ? r.draft : null;
  }, [kind, activeChart, path]);
  const suggestions = useMemo(() => (kind && feed.sample ? suggestMonitorsForFeed(kind, feed.sample as QueryResult) : []), [kind, feed.sample]);

  if (!path) return null;
  if (!kind) {
    return (
      <p className="text-xs text-loom-muted border border-dashed border-loom-border rounded-md p-3">
        You&apos;re looking at <strong className="text-loom-text">{fileName}</strong>, which is a file. Monitors watch live feeds that update on their own. Open one from Data &amp; sources to get suggestions here.
      </p>
    );
  }
  return (
    <section className="space-y-2" aria-labelledby="mon-yours">
      <h2 id="mon-yours" className="text-sm font-medium text-loom-text">For the data you&apos;re looking at <span className="text-loom-muted font-normal">· {fileName}</span></h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {chartDraft && (
          <SuggestionCard
            title={`This chart: ${chartDraft.chart?.title ?? chartDraft.name}`}
            blurb={chartDraft.rationale ?? "Watch the number this chart shows."}
            draft={chartDraft}
            badge="Chart"
          />
        )}
        {feed.loading && <p className="text-xs text-loom-muted p-3">Reading the feed…</p>}
        {suggestions.map((s) => <SuggestionCard key={s.id} title={s.title} blurb={s.blurb} draft={s.draft} />)}
      </div>
    </section>
  );
}

function MonitorCard({ m, checks, alerts }: { m: Monitor; checks: CheckRecord[]; alerts: MonitorAlert[] }) {
  const running = useLoomStore((s) => s.monitorsRunning.includes(m.id));
  const { setMonitorEnabled, removeMonitor, openMonitorEditor, setToast } = useLoomStore.getState();
  const now = useNow();
  const last = checks[checks.length - 1];
  const statusKey = !m.enabled ? "paused" : last ? last.status : "idle";
  const st = STATUS_STYLE[statusKey];
  const use = monitorUsefulness(alerts);
  const feed = SOURCE_BY_KIND[m.metric.source];
  return (
    <article className="loom-card rounded-md border border-loom-border p-3 space-y-2" aria-label={m.name}>
      <header className="flex items-start gap-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${st.dot} ${running ? "animate-pulse" : ""}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-loom-text leading-tight">
            {m.name}
            {m.cloud && <span className="loom-badge ml-1.5 align-middle" title="Checked by Loom's server, even when the app is closed">Always on</span>}
          </p>
          <p className="text-2xs text-loom-muted">{feed?.label ?? m.metric.source}{m.chart ? ` · from chart “${m.chart.title}”` : ""} · {describeRule(m.rule, m.metric.unit)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono text-loom-text">{fmtValue(last?.value, m.metric.unit)}</p>
          <p className="text-2xs text-loom-muted">{running ? "Checking…" : st.label}</p>
        </div>
      </header>
      {checks.filter((c) => c.value != null).length >= 8 ? (
        <MonitorSparkline checks={checks} rule={m.rule} unit={m.metric.unit} />
      ) : (
        <ReplayChart draft={m} />
      )}
      {last && <p className="text-xs text-loom-text/90">{last.reason}</p>}
      <p className="text-2xs text-loom-muted"><span className="text-loom-label">Decision:</span> {m.decision}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-loom-muted">
        <span>{describeSchedule(m.schedule)}</span>
        {last && <span>Last {ago(last.at, now)}</span>}
        {m.enabled && m.nextRunAt != null && <span>Next {m.nextRunAt <= now ? "now" : ago(m.nextRunAt, now)}</span>}
        {m.expected.length > 0 && <span>{m.expected.length} expected window{m.expected.length > 1 ? "s" : ""}</span>}
        <span title="Share of reviewed alerts that led to action">
          {use.verdict === "new" ? `${use.alerts} alert${use.alerts === 1 ? "" : "s"}` : `${Math.round(use.actionRate! * 100)}% acted on · ${use.verdict}`}
        </span>
      </div>
      {use.verdict === "noisy" && (
        <p className="text-2xs text-loom-warning-text">Most alerts here didn&apos;t lead to action. Try a wider limit, more confirm checks, or expected windows.</p>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        {m.cloud ? (
          <span className="text-2xs text-loom-muted px-2 py-1" title="Always-on monitors are checked by Loom's server; results arrive here within a minute">Checked by the server</span>
        ) : (
          <button type="button" className="loom-btn text-2xs px-2 py-1 rounded-md" disabled={running} onClick={() => void runMonitorNow(m.id)}>Check now</button>
        )}
        <button type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md" title={m.chart ? `Open “${m.chart.title}”` : `Chart ${feed?.label ?? "this feed"}`} onClick={() => void openMonitorChart(m)}>
          {m.chart ? "Open chart" : "Chart feed"}
        </button>
        <button type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md" onClick={() => openMonitorEditor(m.id)}>Edit</button>
        <button type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md" onClick={() => setMonitorEnabled(m.id, !m.enabled)}>{m.enabled ? "Pause" : "Resume"}</button>
        <button type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md text-loom-error ml-auto" onClick={() => { removeMonitor(m.id); setToast(`Stopped watching “${m.name}”`); }}>Delete</button>
      </div>
    </article>
  );
}

function worstStatus(ms: Monitor[], checks: Record<string, CheckRecord[]>): CheckStatus | "idle" {
  const order: (CheckStatus | "idle")[] = ["firing", "error", "breach", "no-data", "expected", "ok", "idle"];
  let best: CheckStatus | "idle" = "idle";
  for (const m of ms) {
    const s = checks[m.id]?.at(-1)?.status ?? "idle";
    if (order.indexOf(s) < order.indexOf(best)) best = s;
  }
  return best;
}

export function MonitorView() {
  const monitors = useLoomStore((s) => s.monitors);
  const checks = useLoomStore((s) => s.monitorChecks);
  const alerts = useLoomStore((s) => s.monitorAlerts);
  const editingId = useLoomStore((s) => s.monitorEditingId);
  const editorMode = useLoomStore((s) => s.monitorEditorMode);
  const { openMonitorEditor, addMonitor, setToast } = useLoomStore.getState();
  const [perm, setPerm] = useState<NotifyPermission>("unsupported");
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasFeedOpen = useLoomStore((s) => !!s.selectedFile?.path.startsWith("stream://"));

  useEffect(() => { void notificationPermission().then(setPerm); }, []);

  const byId = useMemo(() => new Map(monitors.map((m) => [m.id, m])), [monitors]);
  const toReview = alerts
    .filter((a) => !a.outcome)
    .sort((a, b) => (Number(!!a.closedAt) - Number(!!b.closedAt)) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.openedAt - a.openedAt);
  const reviewed = alerts.filter((a) => a.outcome);
  const groups = useMemo(() => {
    const g = new Map<string, Monitor[]>();
    for (const m of monitors) {
      const k = m.scorecard?.trim() || "";
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return [...g.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [monitors]);

  const exportAll = async () => {
    const blob = new Blob([exportMonitorsJson(monitors)], { type: "application/json" });
    const outcome = await downloadBlob(blob, "loom-monitors.json");
    if (outcome === "unsupported") setToast("Couldn’t save the file on this device");
  };
  const importFile = async (f: File) => {
    try {
      const list = parseMonitorsJson(await f.text());
      for (const { id: _i, createdAt: _c, nextRunAt: _n, ...draft } of list) addMonitor(draft);
      setToast(`Imported ${list.length} monitor${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      const notExport = e instanceof SyntaxError || e instanceof TypeError || (e instanceof Error && e.message === "Not a Loom monitors file");
      setToast(notExport ? "That file isn’t a Loom monitors export" : `Couldn’t import monitors — ${friendlyError(e)}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-loom-text">Monitor</h1>
            <p className="text-xs text-loom-muted max-w-xl">
              Watch a number on any live feed, on a schedule, and get told when it matters. Every monitor names the decision it supports.
              &quot;Unusual&quot; is judged against what&apos;s normal for that moment, and known causes are excluded first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {perm !== "granted" && perm !== "unsupported" && (
              <button type="button" className="loom-btn-ghost text-xs px-2 py-1.5 rounded-md" onClick={async () => setPerm(await requestNotificationPermission())}>
                {perm === "denied" ? "Notifications blocked" : "Enable notifications"}
              </button>
            )}
            {monitors.length > 0 && <button type="button" className="loom-btn-ghost text-xs px-2 py-1.5 rounded-md" onClick={exportAll}>Export</button>}
            <button type="button" className="loom-btn-ghost text-xs px-2 py-1.5 rounded-md" onClick={() => fileRef.current?.click()}>Import</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
            <button type="button" className="loom-btn-primary text-sm px-3 py-1.5 rounded-md" onClick={() => {
              const kind = sourceKindFromPath(useLoomStore.getState().selectedFile?.path) ?? "usgs";
              openMonitorEditor("new", draftForFeed(kind), "quick");
            }}>New monitor</button>
          </div>
        </header>

        {toReview.length > 0 && (
          <section aria-labelledby="mon-inbox" className="space-y-2">
            <h2 id="mon-inbox" className="text-sm font-medium text-loom-text">To review <span className="text-loom-muted font-normal">({toReview.length})</span></h2>
            <ul className="space-y-2">
              {toReview.slice(0, 20).map((a) => <AlertReview key={a.id} alert={a} monitor={byId.get(a.monitorId)} />)}
            </ul>
          </section>
        )}

        <MomentsSection />

        <ForYourData />

        {monitors.length === 0 ? (
          <section className="space-y-3" aria-labelledby="mon-start">
            <h2 id="mon-start" className="text-sm font-medium text-loom-text">{hasFeedOpen ? "Or start from an example" : "Start from an example"}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {MONITOR_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="loom-card text-left rounded-md border border-loom-border p-3 hover:border-loom-accent" onClick={() => openMonitorEditor("new", t.draft, "quick")}>
                  <span className="block text-sm font-medium text-loom-text">{t.title}</span>
                  <span className="block text-2xs text-loom-muted mt-0.5">{t.blurb}</span>
                  <span className="block text-2xs text-loom-label mt-1.5">→ {t.draft.decision}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          groups.map(([name, ms]) => {
            const worst = worstStatus(ms, checks);
            return (
              <section key={name || "_"} className="space-y-2" aria-label={name || "Monitors"}>
                <div className="flex items-center gap-2">
                  {name && <span className={`w-2 h-2 rounded-full ${STATUS_STYLE[worst].dot}`} aria-hidden />}
                  <h2 className="text-sm font-medium text-loom-text">{name || (groups.length > 1 ? "Other monitors" : "Monitors")}</h2>
                  {name && <span className="text-2xs text-loom-muted">{ms.length} metrics · {STATUS_STYLE[worst].label}</span>}
                </div>
                <div className="grid md:grid-cols-2 gap-2">
                  {ms.map((m) => <MonitorCard key={m.id} m={m} checks={checks[m.id] ?? []} alerts={alerts.filter((a) => a.monitorId === m.id)} />)}
                </div>
              </section>
            );
          })
        )}

        {monitors.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-loom-muted">Add from examples</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MONITOR_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md border border-loom-border" onClick={() => openMonitorEditor("new", t.draft, "quick")}>{t.title}</button>
              ))}
            </div>
          </details>
        )}

        {reviewed.length > 0 && (
          <section className="space-y-2">
            <button type="button" className="text-xs text-loom-muted" aria-expanded={showHistory} onClick={() => setShowHistory((x) => !x)}>
              {showHistory ? "Hide" : "Show"} reviewed alerts ({reviewed.length})
            </button>
            {showHistory && (
              <ul className="divide-y divide-loom-border border border-loom-border rounded-md">
                {reviewed.slice(0, 100).map((a) => (
                  <li key={a.id} className="px-3 py-2 text-xs flex flex-wrap gap-x-3">
                    <span className="text-loom-text">{byId.get(a.monitorId)?.name ?? "Deleted"}</span>
                    <span className="text-loom-muted">{new Date(a.openedAt).toLocaleString()}</span>
                    <span className="text-loom-label">{ALERT_OUTCOME_LABELS[a.outcome!]}</span>
                    {a.note && <span className="text-loom-muted italic">“{a.note}”</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <ConnectPanel />

        <p className="text-2xs text-loom-muted">
          Checks run while Loom is open, unless a monitor is Always on. On the web, browsers slow background tabs, so keep a tab open or use the desktop app for steady schedules.
        </p>
      </div>
      {editingId && editorMode === "full" && <MonitorEditor key={editingId} />}
    </div>
  );
}
