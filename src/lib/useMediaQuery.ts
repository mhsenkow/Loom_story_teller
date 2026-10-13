// =================================================================
// useMediaQuery — client matchMedia / viewport hooks
// =================================================================

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLoomStore } from "./store";
import { shellModeFromWidth, type ShellMode } from "./shellLayout";

/** Keep <html data-shell-*> in sync after bootstrap (iPad WKWebView often starts narrow). */
function syncShellDatasetFromWindow(): number {
  const w = window.innerWidth;
  try {
    document.documentElement.dataset.shellWidth = String(w);
    document.documentElement.dataset.shellMode = shellModeFromWidth(w);
  } catch {
    /* ignore */
  }
  return w;
}

function subscribeMediaQuery(query: string, onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(query);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getMediaQuerySnapshot(query: string): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeMediaQuery(query, onStoreChange),
    [query],
  );
  const getSnapshot = useCallback(() => getMediaQuerySnapshot(query), [query]);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribeViewportWidth(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let frame: number | null = null;
  const emit = () => {
    frame = null;
    syncShellDatasetFromWindow();
    onStoreChange();
  };
  const onResize = () => {
    if (frame != null) return;
    frame = window.requestAnimationFrame(emit);
  };
  // Cold-start on Capacitor/iPad can stamp a phone-sized bootstrap width before
  // the webview lays out — remeasure on the next frames and orientation changes.
  syncShellDatasetFromWindow();
  frame = window.requestAnimationFrame(emit);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  // bfcache / iOS restore can revive a narrow bootstrap stamp without a full reload.
  window.addEventListener("pageshow", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    window.removeEventListener("pageshow", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    if (frame != null) window.cancelAnimationFrame(frame);
  };
}

function getViewportWidthSnapshot(): number {
  if (typeof window === "undefined") return 1280;
  // Always prefer the live viewport. Bootstrap width is only for pre-React paint;
  // locking to it left iPad stuck in phone framing after relaunch.
  return window.innerWidth;
}

/** Viewport width for device presets (SSR / server snapshot = 1280). */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribeViewportWidth,
    getViewportWidthSnapshot,
    () => 1280,
  );
}

/** Phone / tablet / desktop shell chrome mode (aligned with chartViewport). */
export function useShellMode(): ShellMode {
  const w = useViewportWidth();
  return shellModeFromWidth(w);
}

/** True when shell is phone (<768px). */
export function useIsMobile(): boolean {
  return useShellMode() === "phone";
}

/** True when data sidebar should use overlay chrome (phone + tablet). */
export function useSidebarOverlays(): boolean {
  const mode = useShellMode();
  return mode === "phone" || mode === "tablet";
}

/** Phone sheet height while editing a chart live (chart re-fits above it). */
export const MOBILE_LIVE_EDIT_SHEET = "56dvh";

/**
 * Phone + Chart view + Chart/Smart panel open: the panel becomes a shorter,
 * undimmed sheet and the chart stage shrinks above it so edits are visible.
 */
export function useMobileLiveEdit(): boolean {
  const isMobile = useIsMobile();
  const live = useLoomStore(
    (s) => s.panelOpen && s.viewMode === "chart" && (s.panelTab === "chart" || s.panelTab === "smart"),
  );
  return isMobile && live;
}
