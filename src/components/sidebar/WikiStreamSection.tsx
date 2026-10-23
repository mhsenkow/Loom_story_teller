"use client";

import { useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { activateDataset } from "@/lib/datasetPipeline";
import {
  streamClear,
  streamSnapshot,
  streamStart,
  streamStatus,
  streamStop,
} from "@/lib/tauri";
import { feedRef } from "@/lib/sourceRef";
import {
  LoveButton,
  SaveButton,
  SourcePrefMenu,
} from "@/components/SourcePrefControls";
import { ipcErrorMessage, leaveSourcesShowChart } from "./shared";

function useElapsedSeconds(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!running || startedAt == null) return;
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running, startedAt]);
  return running && startedAt != null ? Math.max(0, now - startedAt) : 0;
}

export function WikiStreamSection() {
  const streamRunning = useLoomStore((s) => s.streamRunning);
  const streamTotalEvents = useLoomStore((s) => s.streamTotalEvents);
  const streamEventsPerSec = useLoomStore((s) => s.streamEventsPerSec);
  const streamBufferRows = useLoomStore((s) => s.streamBufferRows);
  const streamWikisSeen = useLoomStore((s) => s.streamWikisSeen);
  const streamStartedAt = useLoomStore((s) => s.streamStartedAt);
  const setStreamStatus = useLoomStore((s) => s.setStreamStatus);
  const setToast = useLoomStore((s) => s.setToast);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedStreamSecs = useElapsedSeconds(streamStartedAt, streamRunning);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await streamStatus();
        setStreamStatus(s);
      } catch {
        /* ignore */
      }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await streamStart();
      startPolling();
      setToast("Connected to Wikipedia live stream");
    } catch (e) {
      setToast(`Stream failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    stopPolling();
    try {
      await streamStop();
      setStreamStatus({
        running: false,
        total_events: 0,
        events_per_sec: 0,
        buffer_rows: streamBufferRows,
        wikis_seen: streamWikisSeen,
        started_at: null,
      });
      setToast("Stream stopped");
    } catch (e) {
      setToast(`Couldn’t stop stream: ${ipcErrorMessage(e)}`);
      startPolling();
    }
  };

  const handleLoadSnapshot = async () => {
    try {
      const snap = await streamSnapshot(500);
      if (!snap.sample.rows.length) {
        setToast(
          "No Wikipedia events yet — wait a second and try Explore again",
        );
        return;
      }
      const streamFile = {
        path: "stream://wiki",
        name: "Wikipedia Live",
        extension: "stream",
        row_count: snap.sample.total_rows,
        size_bytes: 0,
        sourceHome: "https://www.wikimedia.org/",
        sourceCredit: "Wikimedia recent changes · CC BY-SA",
      };
      activateDataset({
        file: streamFile,
        stats: snap.stats,
        sample: snap.sample,
        shortlist: { type: "stream" },
      });
      leaveSourcesShowChart();
      setToast(`Loaded ${snap.sample.rows.length} stream events`);
    } catch (e) {
      setToast(
        `Failed to load snapshot: ${e instanceof Error ? e.message : e}`,
      );
    }
  };

  const handleClear = async () => {
    try {
      await streamClear();
      setStreamStatus({
        running: streamRunning,
        total_events: streamTotalEvents,
        events_per_sec: streamEventsPerSec,
        buffer_rows: 0,
        wikis_seen: 0,
        started_at: streamRunning
          ? useLoomStore.getState().streamStartedAt
          : null,
      });
      setToast("Stream buffer cleared");
    } catch (e) {
      setToast(`Couldn’t clear stream: ${ipcErrorMessage(e)}`);
    }
  };

  const formatUptime = (secs: number) => {
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600)
      return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  return (
    <div
      className="relative border border-loom-border rounded-md p-3 space-y-2.5 bg-loom-surface/40"
      data-source-ref={feedRef("wiki")}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${streamRunning ? "bg-loom-success animate-pulse" : "bg-loom-muted"}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-loom-text leading-tight">
            Wikipedia
          </p>
          <p className="text-2xs text-loom-muted">Recent changes · real-time</p>
        </div>

        {!streamRunning ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50 shrink-0"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDisconnect}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-error/50 bg-loom-error/10 text-loom-error hover:bg-loom-error/20 font-medium shrink-0"
          >
            Stop
          </button>
        )}
      </div>

      {streamRunning && (
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-loom-border/60">
          <div>
            <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">
              {streamEventsPerSec.toFixed(1)}
            </p>
            <p className="text-2xs text-loom-muted">events/s</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">
              {streamBufferRows.toLocaleString()}
            </p>
            <p className="text-2xs text-loom-muted">buffered</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">
              {streamWikisSeen}
            </p>
            <p className="text-2xs text-loom-muted">wikis</p>
          </div>
        </div>
      )}

      {streamRunning && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-loom-muted">
            {formatUptime(elapsedStreamSecs)} ·{" "}
            {streamTotalEvents.toLocaleString()} total
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleClear}
              className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleLoadSnapshot}
              disabled={streamBufferRows === 0}
              className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50"
            >
              Explore
            </button>
          </div>
        </div>
      )}

      {!streamRunning && streamBufferRows > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-2xs text-loom-muted">
            {streamBufferRows.toLocaleString()} rows ready
          </span>
          <button
            type="button"
            onClick={handleLoadSnapshot}
            className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium"
          >
            Explore
          </button>
        </div>
      )}
      <div className="library-card-foot">
        <span className="text-2xs text-loom-muted">Wikimedia · live edits</span>
        <div className="library-card-actions">
          <LoveButton sourceRef={feedRef("wiki")} label="Wikipedia Live" />
          <SaveButton sourceRef={feedRef("wiki")} label="Wikipedia Live" />
          <SourcePrefMenu
            sourceRef={feedRef("wiki")}
            label="Wikipedia Live"
            actions={["spark", "ask", "less", "hide"]}
          />
        </div>
      </div>
    </div>
  );
}
