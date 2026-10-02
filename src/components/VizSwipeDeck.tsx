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

const SWIPE_THRESHOLD = 88;
const VELOCITY_THRESHOLD = 0.5;
const EXIT_MS = 200;

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
  const reducedMotion = useLoomStore((s) => s.appSettings.reducedMotion);
  const swipeViz = useLoomStore((s) => s.swipeViz);
  const closeVizSwipe = useLoomStore((s) => s.closeVizSwipe);

  const data = sampleRows ?? queryResult;
  const current = deck[index] ?? null;
  const next = deck[index + 1] ?? null;
  const progress = deck.length > 0 ? Math.min(index, deck.length) / deck.length : 0;

  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const pointerId = useRef<number | null>(null);
  const start = useRef({ x: 0, y: 0, t: 0 });
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committing = useRef(false);

  // Reset drag state when the active card changes
  useEffect(() => {
    setDragX(0);
    setDragY(0);
    setDragging(false);
    setExitDir(null);
    committing.current = false;
  }, [index, open]);

  // Lock body scroll while the overlay is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const commit = useCallback(
    (dir: "left" | "right") => {
      if (committing.current) return;
      committing.current = true;
      setExitDir(dir);
      const distance = typeof window !== "undefined" ? Math.max(420, window.innerWidth * 0.7) : 420;
      setDragX(dir === "right" ? distance : -distance);
      const delay = reducedMotion ? 0 : EXIT_MS;
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        swipeViz(dir);
        setExitDir(null);
        setDragX(0);
        setDragY(0);
        setDragging(false);
        committing.current = false;
      }, delay);
    },
    [swipeViz, reducedMotion],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeVizSwipe();
        return;
      }
      if (status !== "ready" || !current || committing.current) return;
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
    if (status !== "ready" || !current || exitDir || committing.current) return;
    if (e.button !== 0) return;
    pointerId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId || !dragging || committing.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    setDragX(dx);
    setDragY(dy * 0.28);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (committing.current) return;
    const dt = Math.max(16, performance.now() - start.current.t);
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

  const rot = reducedMotion ? 0 : dragX * 0.035;
  const likeOpacity = Math.min(1, Math.max(0, dragX / SWIPE_THRESHOLD));
  const skipOpacity = Math.min(1, Math.max(0, -dragX / SWIPE_THRESHOLD));
  const learned = eventCount(prefs);
  const transition =
    reducedMotion || dragging || exitDir
      ? exitDir && !reducedMotion
        ? `transform ${EXIT_MS}ms ease-in`
        : undefined
      : "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";

  const subtitle =
    status === "scanning"
      ? (message ?? "Scanning…")
      : status === "done"
        ? `Kept ${kept} · Skipped ${skipped}`
        : deck.length
          ? `${Math.min(index + 1, deck.length)} of ${deck.length}`
          : "No charts";

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-loom-bg/97 backdrop-blur-md"
      style={{
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
        paddingLeft: "var(--safe-left)",
        paddingRight: "var(--safe-right)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Deep scan chart suggestions"
    >
      <header className="shrink-0 border-b border-loom-border">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-loom-text truncate tracking-tight">Deep scan</p>
            <p className="text-2xs text-loom-muted truncate mt-0.5">
              {subtitle}
              {learned > 0 && status !== "scanning" ? ` · ${learned} learned` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => closeVizSwipe()}
            className="loom-btn-ghost min-h-10 px-3 text-xs shrink-0"
            aria-label="Close deep scan"
          >
            {status === "done" ? "Close" : "Done"}
          </button>
        </div>
        {status === "ready" && deck.length > 0 && (
          <div className="h-0.5 w-full bg-loom-elevated" aria-hidden>
            <div
              className="h-full bg-loom-accent transition-[width] duration-200 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 min-h-0 relative overflow-hidden">
        {status === "scanning" && (
          <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
            <div
              className={`w-11 h-11 rounded-full border-2 border-loom-accent/30 border-t-loom-accent ${reducedMotion ? "" : "animate-spin"}`}
              aria-hidden
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-loom-text">{message ?? "Scanning…"}</p>
              <p className="text-2xs text-loom-muted max-w-[16rem] leading-relaxed">
                Profiling columns, scoring encodings, ranking for your taste.
              </p>
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="flex flex-col items-center gap-5 text-center max-w-sm animate-fade-in px-2">
            <div className="w-12 h-12 rounded-full bg-loom-accent/15 border border-loom-accent/35 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-loom-accent" aria-hidden>
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="space-y-2">
              <p className="text-lg font-semibold text-loom-text tracking-tight">Scan complete</p>
              <p className="text-sm text-loom-muted leading-relaxed">
                Kept <span className="text-loom-text font-medium tabular-nums">{kept}</span>
                {" · "}
                Skipped <span className="text-loom-text font-medium tabular-nums">{skipped}</span>
                {kept + skipped > 0
                  ? ". Suggestions will lean toward what you kept."
                  : "."}
              </p>
            </div>
            <button type="button" className="loom-btn-primary min-h-11 px-6" onClick={() => closeVizSwipe()}>
              Back to chart
            </button>
          </div>
        )}

        {status === "ready" && current && (
          <>
            {next && (
              <div
                className="absolute w-[min(100%,22rem)] sm:w-[min(100%,26rem)] opacity-35 scale-[0.94] translate-y-4 pointer-events-none"
                aria-hidden
              >
                <div className="rounded-xl border border-loom-border bg-loom-elevated overflow-hidden">
                  <ChartCard rec={next} data={data} isActive={false} onClick={() => {}} hero />
                </div>
              </div>
            )}

            <div
              className="relative w-[min(100%,22rem)] sm:w-[min(100%,26rem)] touch-none select-none will-change-transform"
              style={{
                transform: `translate3d(${dragX}px, ${dragY}px, 0) rotate(${rot}deg)`,
                transition,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                className="rounded-xl border border-loom-border bg-loom-elevated overflow-hidden relative"
                style={{
                  boxShadow:
                    likeOpacity > 0.05
                      ? `0 16px 48px -16px rgba(0,0,0,0.5), 0 0 0 1.5px color-mix(in srgb, var(--loom-success) ${Math.round(likeOpacity * 60)}%, transparent)`
                      : skipOpacity > 0.05
                        ? `0 16px 48px -16px rgba(0,0,0,0.5), 0 0 0 1.5px color-mix(in srgb, var(--loom-error) ${Math.round(skipOpacity * 60)}%, transparent)`
                        : "0 16px 48px -16px rgba(0,0,0,0.45)",
                }}
              >
                <ChartCard rec={current} data={data} isActive onClick={() => {}} hero />
                <p className="px-4 pb-3.5 pt-2.5 text-2xs text-loom-muted leading-relaxed">
                  {getRecommendationReason(current)}
                </p>

                <div
                  className="absolute top-3.5 left-3.5 px-2.5 py-1 rounded-md border-2 text-xs font-bold tracking-widest -rotate-12 bg-loom-bg/85"
                  style={{
                    opacity: skipOpacity,
                    borderColor: "var(--loom-error)",
                    color: "var(--loom-error)",
                  }}
                  aria-hidden
                >
                  SKIP
                </div>
                <div
                  className="absolute top-3.5 right-3.5 px-2.5 py-1 rounded-md border-2 text-xs font-bold tracking-widest rotate-12 bg-loom-bg/85"
                  style={{
                    opacity: likeOpacity,
                    borderColor: "var(--loom-success)",
                    color: "var(--loom-success)",
                  }}
                  aria-hidden
                >
                  KEEP
                </div>
              </div>
            </div>
          </>
        )}

        {status === "ready" && !current && (
          <div className="text-center space-y-3 animate-fade-in">
            <p className="text-sm text-loom-muted">No chart suggestions for this dataset.</p>
            <button type="button" className="loom-btn-ghost min-h-10 px-4 text-xs" onClick={() => closeVizSwipe()}>
              Close
            </button>
          </div>
        )}
      </div>

      {status === "ready" && current && (
        <footer
          className="shrink-0 flex items-center justify-center gap-4 sm:gap-6 px-4 pt-4 border-t border-loom-border"
          style={{ paddingBottom: "max(1rem, var(--safe-bottom))" }}
        >
          <button
            type="button"
            onClick={() => commit("left")}
            disabled={!!exitDir}
            className="min-h-12 min-w-[7rem] sm:min-w-[7.5rem] rounded-full border border-loom-border bg-loom-elevated text-sm font-medium text-loom-text transition-colors hover:border-[color:var(--loom-error)]/55 hover:text-[color:var(--loom-error)] disabled:opacity-50"
            aria-label="Skip this chart"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => commit("right")}
            disabled={!!exitDir}
            className="min-h-12 min-w-[7rem] sm:min-w-[7.5rem] rounded-full bg-loom-accent text-white text-sm font-medium shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            aria-label="Keep this chart"
          >
            Keep
          </button>
        </footer>
      )}

      {status === "ready" && current && (
        <p className="sr-only">Swipe right or press K to keep, swipe left or press J to skip, Escape to close.</p>
      )}
    </div>
  );
}
