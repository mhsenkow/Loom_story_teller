// =================================================================
// Onboarding — First-run flow for new users
// =================================================================
// Shows a short modal once: pick folder → pick chart or query.
// Dismissing sets loom-onboarding-done in localStorage.
// =================================================================

"use client";

import { useState, useEffect } from "react";

const KEY = "loom-onboarding-done";

export function Onboarding() {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setShow(!window.localStorage.getItem(KEY));
    } catch {
      setShow(false);
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setShow(false);
  };

  if (show !== true) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
    >
      <div className="loom-card max-w-md w-full p-6 space-y-5 bg-loom-surface border border-loom-border shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="onboarding-title" className="text-sm font-semibold text-loom-text">
            Welcome to Loom
          </h2>
          <button
            type="button"
            onClick={dismiss}
            className="text-loom-muted hover:text-loom-text"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p id="onboarding-desc" className="text-xs text-loom-muted">
          Get started in two steps:
        </p>
        <ol className="space-y-3 text-xs text-loom-text list-decimal list-inside">
          <li>
            <strong>Add data</strong> — Use the sidebar to pick a folder with CSV/Parquet files, or load files directly.
          </li>
          <li>
            <strong>Explore</strong> — In Explorer, open a file and use the table. Switch to Chart to see suggestions, or to Query to run SQL.
          </li>
        </ol>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={dismiss}
            className="loom-btn-primary text-xs px-3 py-1.5"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
