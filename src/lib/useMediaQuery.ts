// =================================================================
// useMediaQuery — client matchMedia hook
// =================================================================

"use client";

import { useEffect, useState } from "react";
import { useLoomStore } from "./store";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const apply = () => setMatches(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [query]);

  return matches;
}

/** Tailwind `md` breakpoint — below this we treat the shell as mobile. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/** Viewport width for device presets (client-only; 1280 SSR fallback). */
export function useViewportWidth(): number {
  const [w, setW] = useState(1280);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => setW(window.innerWidth);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return w;
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
