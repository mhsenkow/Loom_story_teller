// =================================================================
// Loom — live feed health (client)
// =================================================================
// The Worker tracks each feed's upstream outcomes (workers/sourceHealth.ts)
// and serves a summary at /api/health. Feeds that have been failing for
// hours are "resting": discover skips them and Digest leaves them out, so
// nobody taps Connect only to wait for an error. Health is advisory — if
// /api/health can't be reached, every feed stays available.
// Desktop does not call the Worker. It reads source status already in the
// store (DuckDB polls) and never marks a feed resting from that.
// =================================================================

export type FeedHealthState = "ok" | "degraded" | "resting" | "unknown";

export interface FeedHealth {
  state: FeedHealthState;
  lastOk?: number;
  lastFail?: number;
  error?: string;
}

const FRESH_MS = 5 * 60_000;
let loadedAt = 0;
let inflight: Promise<Record<string, FeedHealth>> | null = null;

export function parseFeedHealth(body: unknown): Record<string, FeedHealth> {
  const sources = (body as { sources?: Record<string, Partial<FeedHealth>> } | null)?.sources;
  if (!sources || typeof sources !== "object") return {};
  const out: Record<string, FeedHealth> = {};
  for (const [kind, h] of Object.entries(sources)) {
    const state = h?.state;
    if (state !== "ok" && state !== "degraded" && state !== "resting" && state !== "unknown") continue;
    out[kind] = {
      state,
      lastOk: typeof h.lastOk === "number" ? h.lastOk : undefined,
      lastFail: typeof h.lastFail === "number" ? h.lastFail : undefined,
      error: typeof h.error === "string" ? h.error : undefined,
    };
  }
  return out;
}

/** Desktop has no Worker KV. A live error is degraded; never-started feeds stay unknown so Discover still probes them. */
export function feedHealthFromSourceStatus(st: {
  running?: boolean;
  buffer_rows?: number;
  last_error?: string | null;
  /** Unix seconds (desktop) or omit when only `last_success_at` is known. */
  last_ok_at?: number | null;
  last_success_at?: number | null;
} | null | undefined): FeedHealth {
  if (!st) return { state: "unknown" };
  const lastOk = typeof st.last_ok_at === "number"
    ? st.last_ok_at * 1000
    : typeof st.last_success_at === "number"
      ? st.last_success_at
      : undefined;
  const touched = !!st.running || (st.buffer_rows ?? 0) > 0 || lastOk != null || !!st.last_error;
  if (!touched) return { state: "unknown" };
  if (st.last_error) return { state: "degraded", lastOk, error: st.last_error };
  return { state: "ok", lastOk };
}

/** Fetch /api/health (deduped, cached 5 min) and publish it to the store. Never throws. Desktop reads local source status instead. */
export async function loadFeedHealth(opts: { force?: boolean; timeoutMs?: number } = {}): Promise<Record<string, FeedHealth>> {
  const { useLoomStore } = await import("./store");
  const { isDesktop } = await import("./tauri");
  if (isDesktop()) {
    const health: Record<string, FeedHealth> = {};
    for (const [kind, st] of Object.entries(useLoomStore.getState().sourceStatuses)) {
      health[kind] = feedHealthFromSourceStatus(st);
    }
    useLoomStore.getState().setFeedHealth(health);
    return health;
  }
  if (!opts.force && Date.now() - loadedAt < FRESH_MS) return useLoomStore.getState().feedHealth;
  inflight ??= (async () => {
    try {
      const { apiUrl } = await import("./openDataCatalog");
      const res = await fetch(apiUrl("/api/health"), { signal: AbortSignal.timeout(opts.timeoutMs ?? 4_000) });
      if (!res.ok) return useLoomStore.getState().feedHealth;
      const health = parseFeedHealth(await res.json());
      loadedAt = Date.now();
      useLoomStore.getState().setFeedHealth(health);
      return health;
    } catch {
      return useLoomStore.getState().feedHealth;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function isFeedResting(kind: string, health: Record<string, FeedHealth>): boolean {
  return health[kind]?.state === "resting";
}

/** Short human copy for a resting/degraded badge tooltip. */
export function feedHealthNote(h: FeedHealth | undefined, now = Date.now()): string | null {
  if (!h || h.state === "ok" || h.state === "unknown") return null;
  const ago = (t?: number) => {
    if (!t) return null;
    const m = Math.round((now - t) / 60_000);
    return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const last = ago(h.lastOk);
  if (h.state === "resting") return `The upstream service hasn’t answered${last ? ` since ${last}` : " lately"}. Loom will bring it back when it does.`;
  // Shown on stopped cards too, so don't promise data on screen.
  return `The upstream service is patchy${last ? ` — last answered ${last}` : " right now"}.`;
}
