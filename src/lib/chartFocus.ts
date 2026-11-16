// =================================================================
// chartFocus — full-screen chart, with the shell slid out of the way
// =================================================================
// The flag lives on the store. This module owns the browser Fullscreen
// API beside it: request it on the way in, leave it on the way out,
// and drop the flag if the browser exits fullscreen on its own (Esc).
// =================================================================

import { useLoomStore } from "./store";

let ownsFullscreen = false;

function canEnter(s: ReturnType<typeof useLoomStore.getState>): boolean {
  return s.viewMode === "chart"
    && !!s.activeChart
    && !s.socialExportReady
    && !s.dataSourcesExpanded
    && !s.dashboardsExpanded;
}

/** Enter or leave chart focus. Returns false when there is nothing to focus. */
export function toggleChartFocus(): boolean {
  if (useLoomStore.getState().chartFocus) {
    exitChartFocus();
    return true;
  }
  if (!canEnter(useLoomStore.getState())) return false;
  useLoomStore.getState().setChartFocus(true);
  const req = typeof document !== "undefined" ? document.documentElement.requestFullscreen?.() : undefined;
  if (req) {
    ownsFullscreen = true;
    void req.catch(() => { ownsFullscreen = false; });
  }
  return true;
}

export function exitChartFocus(): void {
  if (useLoomStore.getState().chartFocus) useLoomStore.getState().setChartFocus(false);
  if (typeof document === "undefined") return;
  if (ownsFullscreen && document.fullscreenElement) {
    ownsFullscreen = false;
    void document.exitFullscreen?.().catch(() => {});
    return;
  }
  ownsFullscreen = false;
}

/** Browser left fullscreen (Esc) while we were the ones who entered it. */
export function onFullscreenChange(): void {
  if (typeof document === "undefined") return;
  if (!document.fullscreenElement && ownsFullscreen) {
    ownsFullscreen = false;
    if (useLoomStore.getState().chartFocus) useLoomStore.getState().setChartFocus(false);
  }
}
