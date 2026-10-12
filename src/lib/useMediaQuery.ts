// =================================================================
// useMediaQuery — client matchMedia / viewport hooks
// =================================================================

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLoomStore } from "./store";
import { readBootstrapShellWidth } from "./shellBootstrap";
import { shellModeFromWidth, type ShellMode } from "./shellLayout";

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
    onStoreChange();
  };
  const onResize = () => {
    if (frame != null) return;
    frame = window.requestAnimationFrame(emit);
  };
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("resize", onResize);
    if (frame != null) window.cancelAnimationFrame(frame);
  };
}

function getViewportWidthSnapshot(): number {
  if (typeof window === "undefined") return 1280;
  return readBootstrapShellWidth() ?? window.innerWidth;
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
