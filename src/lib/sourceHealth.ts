// =================================================================
// Loom — live feed health (client)
// =================================================================
// The Worker tracks each feed's upstream outcomes (workers/sourceHealth.ts)
// and serves a summary at /api/health. Feeds that have been failing for
// hours are "resting": discover skips them and Digest leaves them out, so
// nobody taps Connect only to wait for an error. Health is advisory — if
// /api/health can't be reached, every feed stays available.
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

/** Fetch /api/health (deduped, cached 5 min) and publish it to the store. Never throws. */
export async function loadFeedHealth(opts: { force?: boolean; timeoutMs?: number } = {}): Promise<Record<string, FeedHealth>> {
  const { useLoomStore } = await import("./store");
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
  return `The upstream service is having trouble — showing the last good copy${last ? ` (${last})` : ""}.`;
}
