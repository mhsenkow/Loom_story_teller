// Dated context layers for the current chart, separate from statistical analysis.
"use client";
import { useState } from "react";
import { useAnalysisConfig } from "./AnalysisCards";
import { eventPosition } from "@/lib/timeSeriesAnalysis";
import { useLoomStore } from "@/lib/store";

export default function OverlaysTab() {
  const { config, update, unavailable, series } = useAnalysisConfig();
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const kind = series.kind;
  const events = config.events ?? [];
  const issue = unavailable ?? (kind === "band" ? "Choose a date or numeric X axis for event overlays." : null);
  return <div className="p-3 space-y-4">
    <div><h2 className="text-base font-semibold">What else was happening?</h2><p className="mt-1 text-xs text-loom-muted">Put launches, incidents, campaigns, and other context beside your time series. A marker shows when; a shaded range shows how long.</p></div>
    {issue && <p className="text-xs text-loom-muted">{issue}</p>}
    <form className="loom-card p-3 space-y-3" onSubmit={e => {
      e.preventDefault();
      const a = eventPosition(start, kind), b = end ? eventPosition(end, kind) : a;
      if (!label.trim() || a == null || b == null || b < a) { setError("Enter a label and valid positions. End must be on or after start."); return; }
      update({ events: [...events, { id: crypto.randomUUID(), label: label.trim(), start, end, visible: true }] });
      useLoomStore.getState().setViewMode("chart");
      setLabel(""); setStart(""); setEnd(""); setError("");
    }}>
      <h3 className="font-semibold text-sm">Add an event</h3>
      <label className="block text-xs text-loom-muted">Event label<input aria-label="Event label" className="loom-input w-full mt-1" value={label} maxLength={80} required placeholder="Product launch" onChange={e => setLabel(e.target.value)} /></label>
      <label className="block text-xs text-loom-muted">{kind === "time" ? "Start date / time" : "Start X value"}<input aria-label={kind === "time" ? "Start date / time" : "Start X value"} className="loom-input w-full mt-1" value={start} required placeholder={kind === "time" ? "2026-10-18 or ISO timestamp" : "2026"} onChange={e => setStart(e.target.value)} /></label>
      <label className="block text-xs text-loom-muted">End · optional<input aria-label="End · optional" className="loom-input w-full mt-1" value={end} placeholder="Leave empty for a marker" onChange={e => setEnd(e.target.value)} /></label>
      {error && <p role="alert" className="text-xs text-loom-muted">{error}</p>}
      <button disabled={!!issue || events.length >= 20} className="loom-btn-primary w-full text-xs disabled:opacity-50">Add to chart</button>
    </form>
    <p className="text-xs text-loom-muted">{events.length}/20 context layers · alignment suggests timing, not causation. Events outside the visible range stay offscreen.</p>
    {events.map(event => <section key={event.id} className="loom-card p-3 space-y-2">
      <h3 className="text-sm font-semibold break-words">{event.label}</h3><p className="text-xs text-loom-muted break-words">{event.start}{event.end ? ` → ${event.end}` : ""}</p>
      <div className="flex gap-2"><button className="loom-btn-ghost text-xs" aria-pressed={event.visible} onClick={() => update({ events: events.map(item => item.id === event.id ? { ...item, visible: !item.visible } : item) })}>{event.visible ? "Hide" : "Show"}</button><button className="loom-btn-ghost text-xs" aria-label={`Remove ${event.label}`} onClick={() => update({ events: events.filter(item => item.id !== event.id) })}>Remove</button></div>
    </section>)}
    <p className="text-2xs text-loom-muted">Manual context for this chart. Included in PNG captures; not saved in shared links or Vega SVG.</p>
  </div>;
}
