// =================================================================
// useMediaQuery — client matchMedia hook
// =================================================================

"use client";

import { useEffect, useState } from "react";

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
