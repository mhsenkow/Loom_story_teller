"use client";

import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { activateDataset } from "@/lib/datasetPipeline";
import { sourceClear, sourceSnapshot, sourceStart, sourceStatus, sourceStop } from "@/lib/tauri";
import { SOURCE_EXPLORE_ROWS, sourceStreamPath, type SourceDef } from "@/lib/sourceRegistry";
import { feedRef } from "@/lib/sourceRef";
import { feedHealthNote } from "@/lib/sourceHealth";
import { LoveButton, SaveButton, SourcePrefMenu } from "@/components/SourcePrefControls";
import { friendlyError, ipcErrorMessage, leaveSourcesShowChart } from "./shared";

export function SourceCard({ def }: { def: SourceDef }) {
  const status = useLoomStore((s) => s.sourceStatuses[def.kind]);
  const health = useLoomStore((s) => s.feedHealth[def.kind]);
  const healthNote = feedHealthNote(health);
  const resting = health?.state === "resting";
  const setSourceStatus = useLoomStore((s) => s.setSourceStatus);
  const setToast = useLoomStore((s) => s.setToast);
  const addRecentFile = useLoomStore((s) => s.addRecentFile);
  const setLastSession = useLoomStore((s) => s.setLastSession);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const running = status?.running ?? false;
  const bufferRows = status?.buffer_rows ?? 0;

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await sourceStatus(def.kind);
        setSourceStatus(def.kind, s);
      } catch { /* ignore */ }
    }, 3000);
  };

  const handleExplore = async (opts?: { quiet?: boolean }) => {
    try {
      const snap = await sourceSnapshot(def.kind, SOURCE_EXPLORE_ROWS);
      if (!snap.sample.rows.length) {
        if (!opts?.quiet) setToast(`${def.label} has no rows yet — wait a moment`);
        return false;
      }
      const file = {
        path: sourceStreamPath(def.kind),
        name: def.fileName,
        extension: "stream",
        row_count: snap.sample.total_rows,
        size_bytes: 0,
        sourceHome: def.homepage,
        sourceCredit: def.attribution,
      };
      activateDataset({
        file,
        stats: snap.stats,
        sample: snap.sample,
        shortlist: { type: "source", kind: def.kind },
      });
      addRecentFile(file);
      setLastSession({ folderPath: "web://", filePath: sourceStreamPath(def.kind), viewMode: "chart" });
      leaveSourcesShowChart();
      setToast(`Loaded ${snap.sample.rows.length} ${def.label} rows`);
      return true;
    } catch (e) {
      if (!opts?.quiet) setToast(`Couldn’t open ${def.label} — ${friendlyError(e)}`);
      return false;
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await sourceStart(def.kind);
      const s = await sourceStatus(def.kind);
      setSourceStatus(def.kind, s);
      startPolling();
      // Snapshot feeds (HN, crypto, …) fill on first poll — jump straight to chart.
      if (s.buffer_rows > 0) {
        const opened = await handleExplore({ quiet: true });
        if (opened) return;
      }
      setToast(
        s.last_error
          ? `${def.label} is unavailable right now — Loom will keep retrying`
          : `Connected to ${def.label} — tap Chart it when rows appear`,
      );
    } catch (e) {
      setToast(`Couldn’t connect to ${def.label} — ${friendlyError(e)}`);
    } finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try {
      await sourceStop(def.kind);
      setSourceStatus(def.kind, { running: false, total_events: 0, events_per_sec: 0, buffer_rows: bufferRows, started_at: null });
      setToast(`${def.label} stopped`);
    } catch (e) {
      setToast(`Couldn’t stop ${def.label}: ${ipcErrorMessage(e)}`);
      startPolling();
    }
  };

  const handleClear = async () => {
    try {
      await sourceClear(def.kind);
      setSourceStatus(def.kind, { ...(status ?? { running: false, total_events: 0, events_per_sec: 0, buffer_rows: 0, started_at: null }), buffer_rows: 0 });
      setToast(`${def.label} cleared`);
    } catch (e) {
      setToast(`Couldn’t clear ${def.label}: ${ipcErrorMessage(e)}`);
    }
  };

  return (
    <div className="relative border border-loom-border rounded-md p-3 space-y-2 bg-loom-surface/40" data-source-ref={feedRef(def.kind)}>
      <div className="flex items-start gap-2">
        <span className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${running ? "bg-loom-accent animate-pulse" : "bg-loom-muted"}`} aria-hidden />
        <span className="sr-only">{running ? "Live" : "Stopped"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-loom-text leading-tight">
            {def.label}
            {healthNote && !running && (
              <span
                title={healthNote}
                className={`ml-1.5 align-middle text-2xs font-normal px-1.5 py-px rounded-full border ${
                  resting ? "border-loom-border text-loom-muted" : "border-loom-warning/40 text-loom-warning-text"
                }`}
              >
                {resting ? "Resting" : "Patchy"}
              </span>
            )}
          </p>
          {/* Visible, not a tooltip: touch devices never show title text. */}
          {healthNote && !running && <p className="text-2xs text-loom-muted mt-0.5 leading-snug">{healthNote}</p>}
          <p className="text-2xs text-loom-muted mt-0.5 leading-snug">{def.description}</p>
        </div>
        {!running ? (
          <button type="button" onClick={handleConnect} disabled={connecting}
            aria-label={`${connecting ? "Loading" : resting ? "Try anyway" : "Connect"} ${def.label}`}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50 shrink-0">
            {connecting ? "Loading…" : resting ? "Try anyway" : "Connect"}
          </button>
        ) : (
          <button type="button" onClick={handleDisconnect} aria-label={`Stop ${def.label}`}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-error/50 bg-loom-error/10 text-loom-error hover:bg-loom-error/20 font-medium shrink-0">
            Stop
          </button>
        )}
      </div>
      {running && (
        <div className="flex items-center justify-between pl-4">
          <span className="text-2xs text-loom-muted tabular-nums">{(status?.total_events ?? 0).toLocaleString()} rows</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={handleClear} aria-label={`Clear ${def.label}`} className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated">Clear</button>
            <button type="button" onClick={() => void handleExplore()} disabled={bufferRows === 0} aria-label={`Chart it: ${def.label}`}
              className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50">
              Chart it
            </button>
          </div>
        </div>
      )}
      {running && status?.snapshot_stale && bufferRows > 0 && (
        <p className="text-2xs text-loom-muted pl-4 leading-snug" role="status">
          Cached snapshot
          {status.snapshot_captured_at
            ? ` from ${new Date(status.snapshot_captured_at).toLocaleString()}`
            : ""}
          — refreshing live data…
        </p>
      )}
      {running && status?.last_error && (
        <p className="text-2xs text-loom-warning-text pl-4 leading-snug" role="status">
          {bufferRows > 0 ? "Showing the last good data — " : "Source unavailable right now — "}
          retrying automatically.
          <span className="block text-loom-muted/80 truncate" title={status.last_error}>{status.last_error}</span>
        </p>
      )}
      {!running && bufferRows > 0 && (
        <div className="flex items-center justify-between pl-4">
          <span className="text-2xs text-loom-muted tabular-nums">{bufferRows.toLocaleString()} rows ready</span>
          <button type="button" onClick={() => void handleExplore()} aria-label={`Chart it: ${def.label}`}
            className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium">
            Chart it
          </button>
        </div>
      )}
      <div className="library-card-foot">
        {def.attribution ? (
          <a
            href={def.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0 text-2xs text-loom-label hover:text-loom-accent w-fit"
          >
            {def.attribution}
          </a>
        ) : null}
        <div className="library-card-actions">
          <LoveButton sourceRef={feedRef(def.kind)} label={def.label} />
          <SaveButton sourceRef={feedRef(def.kind)} label={def.label} />
          <SourcePrefMenu sourceRef={feedRef(def.kind)} label={def.label} actions={["spark", "ask", "less", "hide"]} />
        </div>
      </div>
    </div>
  );
}
