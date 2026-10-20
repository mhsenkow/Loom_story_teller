// =================================================================
// Loom — Last-good `/api/source/<kind>` snapshot (LOOM-459)
// =================================================================
// Persists successful poll JSON in localStorage for offline / slow
// reopen. Stale payloads are labeled — never shown as live without
// a fresh network success.
// =================================================================

import type { SourceKind } from "./sourceRegistry";

const KEY_PREFIX = "loom-source-snapshot:";

export type SourceSnapshotCacheEntry = {
  body: unknown;
  capturedAt: number;
};

export function readSourceSnapshotCache(kind: SourceKind): SourceSnapshotCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${kind}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SourceSnapshotCacheEntry;
    if (parsed?.body == null || typeof parsed.capturedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSourceSnapshotCache(kind: SourceKind, body: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const entry: SourceSnapshotCacheEntry = { body, capturedAt: Date.now() };
    window.localStorage.setItem(`${KEY_PREFIX}${kind}`, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function clearSourceSnapshotCache(kind: SourceKind): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${KEY_PREFIX}${kind}`);
  } catch {
    /* ignore */
  }
}
