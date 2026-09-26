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
      className="fixed bottom-[max(1rem,var(--safe-bottom))] right-[max(1rem,var(--safe-right))] z-[100] max-w-[min(24rem,calc(100vw-2rem))] px-3 py-2 text-xs text-loom-text bg-loom-surface border border-loom-border rounded shadow-lg flex items-center justify-between gap-2"
    >
      <span className="min-w-0 break-words">{toastMessage}</span>
      <button
        type="button"
        onClick={() => setToast(null)}
        className="flex-shrink-0 text-loom-muted hover:text-loom-text"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
