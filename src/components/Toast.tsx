// =================================================================
// Toast — Brief global message (e.g. errors, copy confirmations)
// =================================================================

"use client";

import { useEffect } from "react";
import { useLoomStore } from "@/lib/store";

export function Toast() {
  const toastMessage = useLoomStore((s) => s.toastMessage);
  const setToast = useLoomStore((s) => s.setToast);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage, setToast]);

  if (!toastMessage) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[130] left-1/2 -translate-x-1/2 top-[calc(var(--topbar-height)+var(--safe-top)+0.5rem)] sm:top-auto sm:left-auto sm:right-[max(1rem,var(--safe-right))] sm:translate-x-0 sm:bottom-[max(1rem,var(--safe-bottom))] max-w-[min(24rem,calc(100vw-2rem))] px-3.5 py-2.5 text-xs text-loom-text bg-loom-surface/95 backdrop-blur-md border border-loom-border rounded-lg shadow-loom-lg flex items-center justify-between gap-3 animate-slide-up"
    >
      <span className="min-w-0 break-words leading-snug">{toastMessage}</span>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="flex-shrink-0 grid place-items-center size-7 rounded-md text-loom-muted hover:text-loom-text hover:bg-loom-elevated transition-colors"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
