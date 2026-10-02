// =================================================================
// WhatsNew — changelog modal
// =================================================================
// Pops once for returning visitors when `CHANGELOG` has a release they
// haven't seen, ahead of the discover sheet (which waits behind it).
// Brand-new visitors skip straight to discover — everything is new to
// them. Reopen any time via `requestWhatsNew()` (sidebar, Settings, Help).
// =================================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import { useLoomStore } from "@/lib/store";
import {
  CHANGELOG,
  WHATS_NEW_SEEN_KEY,
  latestRelease,
  unseenReleases,
  type ChangelogRelease,
} from "@/lib/changelog";
import { DISCOVER_SEEN_KEY } from "@/lib/discoverStories";

/** Keys that prove this browser has used Loom before the changelog existed. */
const HISTORY_KEYS = ["loom-discover-v1", "loom-last-session", "loom-app-settings", "loom-recent-files"];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Snapshot at module load (client), before any component effect runs —
 * HydrateStore & co. write settings on mount, which would make every
 * first visit look like a returning one.
 */
const HAD_HISTORY_AT_LOAD =
  typeof window !== "undefined" && HISTORY_KEYS.some((k) => readStorage(k) != null);

function markSeen(): void {
  const latest = latestRelease();
  if (!latest) return;
  try {
    window.localStorage.setItem(WHATS_NEW_SEEN_KEY, latest.id);
  } catch {
    /* private mode — it'll just show again next visit */
  }
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function WhatsNew() {
  const open = useLoomStore((s) => s.whatsNewOpen);
  const setOpen = useLoomStore((s) => s.setWhatsNewOpen);
  /** Releases flagged "New" (auto-open) — empty when browsing from a link. */
  const [fresh, setFresh] = useState<ChangelogRelease[]>([]);
  /** The discover sheet is queued behind this one — offer a direct hand-off. */
  const [discoverNext, setDiscoverNext] = useState(false);

  // Decide on mount, synchronously enough that Onboarding (which waits a tick) sees the flag.
  useEffect(() => {
    const latest = latestRelease();
    if (!latest) return;
    const seen = readStorage(WHATS_NEW_SEEN_KEY);
    if (seen === latest.id) return;
    if (!seen && !HAD_HISTORY_AT_LOAD) {
      markSeen(); // first visit: skip the changelog, go straight to discover
      return;
    }
    // Visitors from before the changelog existed only need the latest release.
    setFresh(seen ? unseenReleases(seen) : [latest]);
    setDiscoverNext(readStorage(DISCOVER_SEEN_KEY) == null);
    setOpen(true);
  }, [setOpen]);

  useEffect(() => {
    const onRequest = () => {
      setFresh([]);
      setDiscoverNext(false);
      setOpen(true);
    };
    window.addEventListener("loom-whats-new", onRequest);
    return () => window.removeEventListener("loom-whats-new", onRequest);
  }, [setOpen]);

  const close = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const freshIds = new Set(fresh.map((r) => r.id));
  const highlighted = fresh.length ? fresh : CHANGELOG.slice(0, 1);
  const earlier = CHANGELOG.filter((r) => !highlighted.includes(r));

  return (
    <div
      className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center p-0 sm:p-4 loom-overlay animate-fade-in"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
    >
      <div
        className="w-full sm:max-w-lg bg-loom-surface border border-loom-border shadow-loom-lg rounded-t-2xl sm:rounded-xl animate-slide-up flex flex-col max-h-[88dvh]"
        style={{ paddingBottom: "max(0.75rem, var(--safe-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 shrink-0 border-b border-loom-border/60">
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-loom-accent">
              {fresh.length ? "New in Loom" : "What’s new"}
            </p>
            <h2 id="whats-new-title" className="text-lg font-semibold text-loom-text tracking-tight leading-snug mt-0.5">
              {highlighted[0]!.title}
            </h2>
            {highlighted[0]!.summary && (
              <p className="text-sm text-loom-muted leading-relaxed mt-1">{highlighted[0]!.summary}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="loom-btn-ghost min-h-10 min-w-10 flex items-center justify-center text-lg rounded-md -mr-2 -mt-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          {highlighted.map((release, i) => (
            <section key={release.id} className="space-y-3" aria-label={release.title}>
              {(i > 0 || highlighted.length > 1) && (
                <h3 className="text-sm font-semibold text-loom-text">{release.title}</h3>
              )}
              <p className="text-2xs text-loom-muted flex items-center gap-2">
                {formatDate(release.date)}
                {freshIds.has(release.id) && (
                  <span className="px-1.5 py-px rounded bg-loom-accent/15 text-loom-accent font-medium">New</span>
                )}
              </p>
              <ul className="space-y-3 list-none m-0 p-0">
                {release.items.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-loom-accent shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-loom-text leading-snug">{item.title}</p>
                      <p className="text-xs text-loom-muted leading-relaxed mt-0.5">{item.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {earlier.length > 0 && (
            <section className="space-y-1 pt-1 border-t border-loom-border/60">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-loom-muted pt-3 pb-1">Earlier updates</h3>
              {earlier.map((release) => (
                <details key={release.id} className="group rounded-lg">
                  <summary className="flex items-center justify-between gap-2 cursor-pointer list-none min-h-10 text-sm text-loom-text">
                    <span className="min-w-0 truncate">{release.title}</span>
                    <span className="text-2xs text-loom-muted shrink-0 flex items-center gap-1.5">
                      {formatDate(release.date)}
                      <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
                    </span>
                  </summary>
                  <ul className="space-y-2 list-none m-0 pl-3 pb-2 border-l border-loom-border/70">
                    {release.items.map((item) => (
                      <li key={item.title}>
                        <p className="text-xs font-medium text-loom-text">{item.title}</p>
                        <p className="text-2xs text-loom-muted leading-relaxed">{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          )}
        </div>

        <div className="px-5 pt-3 shrink-0 border-t border-loom-border/60">
          <button type="button" onClick={close} className="loom-btn-primary w-full min-h-11 text-sm font-semibold rounded-lg">
            {discoverNext ? "See what’s interesting right now →" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
