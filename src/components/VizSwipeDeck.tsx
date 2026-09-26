// =================================================================
// VizSwipeDeck — Deep-scan Tinder-style chart recommendations
// =================================================================
// Full-screen overlay: swipe right to Keep (apply + learn), left to Skip.
// Native pointer events only; Keep/Skip buttons for accessibility.
// =================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { ChartCard } from "@/components/ChartCard";
import { getRecommendationReason } from "@/lib/recommendations";
import { eventCount } from "@/lib/vizPreferences";

const SWIPE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.45;

export function VizSwipeDeck() {
  const open = useLoomStore((s) => s.vizSwipeOpen);
  const status = useLoomStore((s) => s.vizScanStatus);
  const message = useLoomStore((s) => s.vizScanMessage);
  const deck = useLoomStore((s) => s.vizSwipeDeck);
  const index = useLoomStore((s) => s.vizSwipeIndex);
  const kept = useLoomStore((s) => s.vizSwipeKept);
  const skipped = useLoomStore((s) => s.vizSwipeSkipped);
  const sampleRows = useLoomStore((s) => s.sampleRows);
  const queryResult = useLoomStore((s) => s.queryResult);
  const prefs = useLoomStore((s) => s.vizPreferences);
  const swipeViz = useLoomStore((s) => s.swipeViz);
  const closeVizSwipe = useLoomStore((s) => s.closeVizSwipe);

  const data = sampleRows ?? queryResult;
  const current = deck[index] ?? null;
  const next = deck[index + 1] ?? null;

  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const pointerId = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0, t: 0 });

  const commit = useCallback(
    (dir: "left" | "right") => {
      setExitDir(dir);
      setDragX(dir === "right" ? 420 : -420);
      window.setTimeout(() => {
        swipeViz(dir);
        setExitDir(null);
        setDragX(0);
        setDragY(0);
        setDragging(false);
      }, 180);
    },
    [swipeViz],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeVizSwipe();
        return;
      }
      if (status !== "ready" || !current) return;
      if (e.key === "ArrowRight" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        commit("right");
      } else if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        commit("left");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, status, current, closeVizSwipe, commit]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (status !== "ready" || !current || exitDir) return;
    pointerId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId || !dragging) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    setDragX(dx);
    setDragY(dy * 0.35);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    const dt = Math.max(1, performance.now() - start.current.t);
    const vx = dragX / dt;
    const shouldRight = dragX > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD;
    const shouldLeft = dragX < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD;
    if (shouldRight) commit("right");
    else if (shouldLeft) commit("left");
    else {
      setDragging(false);
      setDragX(0);
      setDragY(0);
    }
  };

  if (!open) return null;

  const rot = dragX * 0.04;
  const likeOpacity = Math.min(1, Math.max(0, dragX / SWIPE_THRESHOLD));
  const skipOpacity = Math.min(1, Math.max(0, -dragX / SWIPE_THRESHOLD));
  const learned = eventCount(prefs);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-loom-bg/95 backdrop-blur-sm"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Deep scan chart suggestions"
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-loom-border shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-loom-text truncate">Deep scan</p>
          <p className="text-2xs text-loom-muted truncate">
            {status === "scanning"
              ? message ?? "Scanning…"
              : status === "done"
                ? `Kept ${kept} · Skipped ${skipped}`
                : `${Math.min(index + 1, deck.length)} / ${deck.length}`}
            {learned > 0 ? ` · learning from ${learned} swipes` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => closeVizSwipe()}
          className="loom-btn-ghost min-h-10 px-3 text-xs"
          aria-label="Close deep scan"
        >
          Done
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-3 min-h-0 relative overflow-hidden">
        {status === "scanning" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-loom-accent border-t-transparent animate-spin" />
            <p className="text-sm text-loom-text">{message ?? "Scanning…"}</p>
            <p className="text-2xs text-loom-muted max-w-xs">
              Profiling columns, scoring encodings, and ranking charts for this dataset.
            </p>
          </div>
        )}

        {status === "done" && (
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <p className="text-lg font-semibold text-loom-text">Scan complete</p>
            <p className="text-sm text-loom-muted">
              Kept {kept} · Skipped {skipped}. Future suggestions will lean toward what you kept.
            </p>
            <button type="button" className="loom-btn-primary min-h-11 px-5" onClick={() => closeVizSwipe()}>
              Back to chart
            </button>
          </div>
        )}

        {status === "ready" && current && (
          <>
            {next && (
              <div
                className="absolute w-[min(100%,22rem)] sm:w-[min(100%,26rem)] opacity-40 scale-[0.94] translate-y-3 pointer-events-none"
                aria-hidden
              >
                <div className="rounded-xl border border-loom-border bg-loom-elevated overflow-hidden shadow-lg">
                  <ChartCard rec={next} data={data} isActive={false} onClick={() => {}} hero />
                </div>
              </div>
            )}

            <div
              className="relative w-[min(100%,22rem)] sm:w-[min(100%,26rem)] touch-none select-none"
              style={{
                transform: `translate(${dragX}px, ${dragY}px) rotate(${rot}deg)`,
                transition: dragging || exitDir ? undefined : "transform 0.2s ease-out",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="rounded-xl border border-loom-border bg-loom-elevated overflow-hidden shadow-xl relative">
                <ChartCard rec={current} data={data} isActive onClick={() => {}} hero />
                <p className="px-4 pb-3 text-2xs text-loom-muted leading-snug">
                  {getRecommendationReason(current)}
                </p>

                <div
                  className="absolute top-4 left-4 px-2.5 py-1 rounded-md border-2 border-red-400 text-red-400 text-xs font-bold tracking-wider rotate-[-12deg] bg-loom-bg/80"
                  style={{ opacity: skipOpacity }}
                  aria-hidden
                >
                  SKIP
                </div>
                <div
                  className="absolute top-4 right-4 px-2.5 py-1 rounded-md border-2 border-emerald-400 text-emerald-400 text-xs font-bold tracking-wider rotate-[12deg] bg-loom-bg/80"
                  style={{ opacity: likeOpacity }}
                  aria-hidden
                >
                  KEEP
                </div>
              </div>
            </div>
          </>
        )}

        {status === "ready" && !current && (
          <p className="text-sm text-loom-muted">No chart suggestions for this dataset.</p>
        )}
      </div>

      {status === "ready" && current && (
        <footer className="shrink-0 flex items-center justify-center gap-6 px-4 py-4 border-t border-loom-border">
          <button
            type="button"
            onClick={() => commit("left")}
            className="min-h-12 min-w-[7.5rem] rounded-full border border-loom-border bg-loom-elevated text-sm font-medium text-loom-text hover:border-red-400/60"
            aria-label="Skip this chart"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => commit("right")}
            className="min-h-12 min-w-[7.5rem] rounded-full bg-loom-accent text-white text-sm font-medium shadow-sm"
            aria-label="Keep this chart"
          >
            Keep
          </button>
        </footer>
      )}
    </div>
  );
}
