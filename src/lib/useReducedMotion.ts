// =================================================================
// useReducedMotion — OS + app setting (LOOM-355)
// =================================================================

"use client";

import { useMediaQuery } from "./useMediaQuery";
import { useLoomStore } from "./store";

/** True when chart/UI motion should be minimized. */
export function useReducedMotion(): boolean {
  const osReduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const appReduce = useLoomStore((s) => s.appSettings.reducedMotion);
  return osReduce || appReduce;
}
