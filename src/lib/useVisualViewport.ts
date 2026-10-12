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

function readMetrics(): VisualViewportMetrics {
  if (typeof window === "undefined") {
    return { bottomInset: 0, height: 800 };
  }
  const vv = window.visualViewport;
  if (!vv) {
    return { bottomInset: 0, height: window.innerHeight };
  }
  const bottomInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  return { bottomInset, height: vv.height };
}

const EMPTY: VisualViewportMetrics = { bottomInset: 0, height: 800 };

export function useVisualViewport(): VisualViewportMetrics {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeVisualViewport(onStoreChange), []);
  const getSnapshot = useCallback(() => readMetrics(), []);
  const getServerSnapshot = useCallback(() => EMPTY, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Bottom padding/margin to keep sheet content above the keyboard. */
export function useKeyboardBottomInset(): number {
  return useVisualViewport().bottomInset;
}
