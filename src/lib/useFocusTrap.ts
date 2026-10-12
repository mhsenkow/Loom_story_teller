// =================================================================
// useFocusTrap — trap Tab inside a modal panel while open
// =================================================================

"use client";

import { useEffect, type RefObject } from "react";
import { trapTabKey } from "./focusTrap";

export function useFocusTrap(panelRef: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (panel) trapTabKey(panel, e);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, panelRef]);
}
