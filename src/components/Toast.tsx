// =================================================================
// Toast — Brief global message (e.g. errors, copy confirmations)
// =================================================================

"use client";

import { useEffect, useState } from "react";
import { useLoomStore } from "@/lib/store";

export function Toast() {
  const toastMessage = useLoomStore((s) => s.toastMessage);
  const toastShowUndo = useLoomStore((s) => s.toastShowUndo);
  const dashboardUndoSnapshot = useLoomStore((s) => s.dashboardUndoSnapshot);
  const chartEditUndoStack = useLoomStore((s) => s.chartEditUndoStack);
  const setToast = useLoomStore((s) => s.setToast);
  const restoreDashboardUndo = useLoomStore((s) => s.restoreDashboardUndo);
  const undoChartEdit = useLoomStore((s) => s.undoChartEdit);
  const clearDashboardUndo = useLoomStore((s) => s.clearDashboardUndo);
  const [paused, setPaused] = useState(false);

  const canUndoDashboard = toastShowUndo && !!dashboardUndoSnapshot;
  const canUndoChart = chartEditUndoStack.length > 0;

  useEffect(() => {
    setPaused(false);
  }, [toastMessage]);

  useEffect(() => {
    if (!toastMessage || paused) return;
    const extra = canUndoDashboard || canUndoChart ? 4000 : 0;
    const ms = Math.max(5000, Math.min(12000, 3000 + toastMessage.length * 40 + extra));
    const t = setTimeout(() => {
      setToast(null);
      clearDashboardUndo();
    }, ms);
    return () => clearTimeout(t);
  }, [toastMessage, setToast, paused, canUndoDashboard, canUndoChart, clearDashboardUndo]);

  const onUndo = () => {
    if (canUndoDashboard) restoreDashboardUndo();
    else if (canUndoChart) undoChartEdit();
    else setToast(null);
  };

  const showUndo = canUndoDashboard || (toastShowUndo && canUndoChart);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed z-[130] left-1/2 -translate-x-1/2 top-[calc(var(--topbar-height)+var(--safe-top)+0.5rem)] sm:top-auto sm:left-auto sm:translate-x-0 sm:right-[max(1rem,var(--safe-right))] sm:bottom-[max(1rem,var(--safe-bottom))] max-w-[min(24rem,calc(100vw-2rem))] pointer-events-none"
    >
      {toastMessage ? (
        <div
          className="pointer-events-auto px-3.5 py-2.5 text-xs text-loom-text bg-loom-surface/95 backdrop-blur-md border border-loom-border rounded-lg shadow-loom-lg flex items-center justify-between gap-3 animate-slide-up"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className="min-w-0 break-words leading-snug">{toastMessage}</span>
          <div className="flex items-center gap-1 shrink-0">
            {showUndo ? (
              <button
                type="button"
                onClick={onUndo}
                className="px-2 py-1 rounded-md text-loom-accent hover:bg-loom-elevated font-medium"
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setToast(null)}
              className="flex-shrink-0 grid place-items-center size-7 rounded-md text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
