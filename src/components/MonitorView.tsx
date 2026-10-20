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
import { exportMonitorsJson, parseMonitorsJson } from "@/lib/monitoring/storage";
import { ALERT_OUTCOME_LABELS, type AlertOutcome, type CheckRecord, type CheckStatus, type Monitor, type MonitorAlert } from "@/lib/monitoring/types";
import { MonitorEditor } from "./monitor/MonitorEditor";
import { AlwaysOnPanel } from "./monitor/AlwaysOnPanel";
import { MonitorSparkline } from "./monitor/MonitorSparkline";

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
          <p className="text-2xs text-loom-muted">{feed?.label ?? m.metric.source} · {describeRule(m.rule, m.metric.unit)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono text-loom-text">{fmtValue(last?.value, m.metric.unit)}</p>
          <p className="text-2xs text-loom-muted">{running ? "Checking…" : st.label}</p>
        </div>
      </header>
      <MonitorSparkline checks={checks} rule={m.rule} unit={m.metric.unit} />
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
        <button type="button" className="loom-btn text-2xs px-2 py-1 rounded-md" disabled={running} onClick={() => void runMonitorNow(m.id)}>Check now</button>
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
  const { openMonitorEditor, addMonitor, setToast } = useLoomStore.getState();
  const [perm, setPerm] = useState<NotifyPermission>("unsupported");
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const exportAll = () => {
    const blob = new Blob([exportMonitorsJson(monitors)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "loom-monitors.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importFile = async (f: File) => {
    try {
      const list = parseMonitorsJson(await f.text());
      for (const { id: _i, createdAt: _c, nextRunAt: _n, ...draft } of list) addMonitor(draft);
      setToast(`Imported ${list.length} monitor${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      setToast(`Import failed: ${e instanceof Error ? e.message : e}`);
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
            <button type="button" className="loom-btn-primary text-sm px-3 py-1.5 rounded-md" onClick={() => openMonitorEditor("new")}>New monitor</button>
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

        {monitors.length === 0 ? (
          <section className="space-y-3" aria-labelledby="mon-start">
            <h2 id="mon-start" className="text-sm font-medium text-loom-text">Start from an example</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {MONITOR_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="loom-card text-left rounded-md border border-loom-border p-3 hover:border-loom-accent" onClick={() => openMonitorEditor("new", t.draft)}>
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
                <button key={t.id} type="button" className="loom-btn-ghost text-2xs px-2 py-1 rounded-md border border-loom-border" onClick={() => openMonitorEditor("new", t.draft)}>{t.title}</button>
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

        <AlwaysOnPanel cloudCount={monitors.filter((m) => m.cloud).length} />

        <p className="text-2xs text-loom-muted">
          Checks run while Loom is open, unless a monitor is Always on. On the web, browsers slow background tabs, so keep a tab open or use the desktop app for steady schedules.
        </p>
      </div>
      {editingId && <MonitorEditor key={editingId} />}
    </div>
  );
}
