"use client";

// "What happened": every alert kept as a moment card — the number, the rule,
// and the history that led up to it — with one-tap share, NeoSpace, image,
// and a jump back to the chart.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { MOMENT_THEME, momentSvg, momentText, type Moment } from "@/lib/monitoring/moments";
import { downloadMomentPng, postMomentToNeoSpace, publishMoment } from "@/lib/monitoring/shareMoment";
import { openMonitorChart } from "@/lib/monitoring/openChart";
import { copyTextToClipboard } from "@/lib/socialExport";
import { isNativeShell, openExternalUrl } from "@/lib/tauri";

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function MomentActions({ mo, large }: { mo: Moment; large?: boolean }) {
  const monitor = useLoomStore((s) => s.monitors.find((m) => m.id === mo.monitorId));
  const { setToast, removeMoment, focusMoment } = useLoomStore.getState();
  const [busy, setBusy] = useState<null | "link" | "neo" | "png">(null);
  const btn = `loom-btn${large ? "" : "-ghost"} text-2xs px-2 py-1 rounded-md`;
  const shareLink = async () => {
    setBusy("link");
    try {
      const r = await publishMoment(mo);
      if (!r.url) { setToast(r.error ?? "Couldn't publish"); return; }
      const copied = await copyTextToClipboard(r.url);
      setToast(copied ? "Moment link copied" : r.url);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" className={btn} disabled={!!busy} onClick={shareLink}>{busy === "link" ? "Publishing…" : mo.storyUrl ? "Copy link" : "Share link"}</button>
      {/* NeoSpace compose needs a real browser window (native webviews can't open one). */}
      {!isNativeShell() && (
        <button type="button" className={btn} disabled={!!busy} onClick={async () => { setBusy("neo"); try { await postMomentToNeoSpace(mo); } finally { setBusy(null); } }}>
          {busy === "neo" ? "Sending…" : "Post to NeoSpace"}
        </button>
      )}
      <button type="button" className={btn} disabled={!!busy} onClick={async () => { setBusy("png"); try { await downloadMomentPng(mo); } finally { setBusy(null); } }}>Image</button>
      {monitor && <button type="button" className={btn} onClick={() => { focusMoment(null); void openMonitorChart(monitor); }}>{monitor.chart ? "Open chart" : "Chart feed"}</button>}
      {large && <button type="button" className={`${btn} text-loom-error ml-auto`} onClick={() => { removeMoment(mo.id); focusMoment(null); }}>Delete</button>}
    </div>
  );
}

function MomentCard({ mo }: { mo: Moment }) {
  const focusMoment = useLoomStore((s) => s.focusMoment);
  const svg = useMemo(() => momentSvg(mo, { palette: MOMENT_THEME, compact: true }), [mo]);
  const sev = mo.severity === "critical" ? "border-loom-error" : mo.severity === "warning" ? "border-loom-warning" : "border-loom-accent";
  return (
    <article className={`loom-card rounded-md border border-loom-border border-l-2 ${sev} p-2.5 space-y-1.5 min-w-0`} aria-label={momentText(mo)}>
      <button type="button" className="block w-full text-left space-y-1" onClick={() => focusMoment(mo.id)}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-loom-text truncate">{mo.monitorName}</span>
          <span className="text-2xs text-loom-muted shrink-0">{ago(mo.at)}{mo.cloud ? " · always on" : ""}</span>
        </span>
        <span className="block text-xs text-loom-text/90">{mo.reason}</span>
        {/* Our own SVG string (all text escaped in momentSvg). */}
        <span className="block [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      </button>
      <MomentActions mo={mo} />
    </article>
  );
}

function FocusedMoment({ mo }: { mo: Moment }) {
  const focusMoment = useLoomStore((s) => s.focusMoment);
  const svg = useMemo(() => momentSvg(mo, { palette: MOMENT_THEME }), [mo]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center loom-overlay animate-fade-in p-4" onClick={() => focusMoment(null)} onKeyDown={(e) => { if (e.key === "Escape") focusMoment(null); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={mo.monitorName} className="loom-focus-panel w-full max-w-3xl max-h-[92vh] overflow-y-auto bg-loom-surface border border-loom-border rounded-lg p-4 space-y-3 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs uppercase tracking-wide text-loom-label">Moment · {new Date(mo.at).toLocaleString()}</p>
          <button type="button" className="loom-btn-ghost text-xs px-2 py-1 rounded-md" onClick={() => focusMoment(null)}>Close</button>
        </div>
        <div className="rounded-md overflow-hidden [&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />
        {mo.decision && <p className="text-sm text-loom-text"><span className="text-loom-label">Plan:</span> {mo.decision}</p>}
        {mo.storyUrl && <p className="text-2xs text-loom-muted break-all">Published at <a className="underline" href={mo.storyUrl} target="_blank" rel="noreferrer" onClick={(e) => { if (isNativeShell()) { e.preventDefault(); void openExternalUrl(mo.storyUrl!); } }}>{mo.storyUrl}</a></p>}
        <MomentActions mo={mo} large />
      </div>
    </div>
  );
}

export function MomentsSection() {
  const moments = useLoomStore((s) => s.monitorMoments);
  const focusedId = useLoomStore((s) => s.focusedMomentId);
  const [all, setAll] = useState(false);
  const focused = moments.find((m) => m.id === focusedId);
  if (!moments.length) return focused ? <FocusedMoment mo={focused} /> : null;
  const shown = all ? moments : moments.slice(0, 6);
  return (
    <section className="space-y-2" aria-labelledby="mon-moments">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="mon-moments" className="text-sm font-medium text-loom-text">What happened <span className="text-loom-muted font-normal">· {moments.length} moment{moments.length === 1 ? "" : "s"}</span></h2>
        {moments.length > 6 && <button type="button" className="text-2xs text-loom-muted underline" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : "Show all"}</button>}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {shown.map((m) => <MomentCard key={m.id} mo={m} />)}
      </div>
      {focused && <FocusedMoment mo={focused} />}
    </section>
  );
}
