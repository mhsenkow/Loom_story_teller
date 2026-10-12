// =================================================================
// useVisualViewport — keyboard / browser chrome inset (LOOM-400)
// =================================================================

"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribeVisualViewport(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  if (!vv) {
    window.addEventListener("resize", onStoreChange);
    return () => window.removeEventListener("resize", onStoreChange);
  }
  vv.addEventListener("resize", onStoreChange);
  vv.addEventListener("scroll", onStoreChange);
  window.addEventListener("resize", onStoreChange);
  return () => {
    vv.removeEventListener("resize", onStoreChange);
    vv.removeEventListener("scroll", onStoreChange);
    window.removeEventListener("resize", onStoreChange);
  };
}

export type VisualViewportMetrics = {
  /** Pixels hidden at the bottom (software keyboard, etc.). */
  bottomInset: number;
  /** Usable height in CSS pixels. */
  height: number;
};

const EMPTY: VisualViewportMetrics = { bottomInset: 0, height: 800 };

/** Cached so useSyncExternalStore Object.is stays stable when values unchanged. */
let cachedMetrics: VisualViewportMetrics = EMPTY;

export function readVisualViewportMetrics(): VisualViewportMetrics {
  if (typeof window === "undefined") {
    return EMPTY;
  }
  const vv = window.visualViewport;
  const next: VisualViewportMetrics = !vv
    ? { bottomInset: 0, height: window.innerHeight }
    : {
        bottomInset: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
        height: vv.height,
      };
  if (
    cachedMetrics.bottomInset === next.bottomInset &&
    cachedMetrics.height === next.height
  ) {
    return cachedMetrics;
  }
  cachedMetrics = next;
  return cachedMetrics;
}

/** Test helper — reset cache between cases. */
export function resetVisualViewportMetricsCacheForTests(): void {
  cachedMetrics = EMPTY;
}

export function useVisualViewport(): VisualViewportMetrics {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeVisualViewport(onStoreChange), []);
  const getSnapshot = useCallback(() => readVisualViewportMetrics(), []);
  const getServerSnapshot = useCallback(() => EMPTY, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Bottom padding/margin to keep sheet content above the keyboard. */
export function useKeyboardBottomInset(): number {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeVisualViewport(onStoreChange), []);
  const getSnapshot = useCallback(() => readVisualViewportMetrics().bottomInset, []);
  const getServerSnapshot = useCallback(() => 0, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
