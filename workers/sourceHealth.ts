// =================================================================
// Loom — live feed health (Worker side)
// =================================================================
// Every real upstream attempt for /api/source/<kind> reports an outcome.
// All feeds share one KV record (`srch:_all`). It is written when a feed
// flips between working and failing, when a second failure in a row is
// recorded (so other locations can classify "resting"), or every
// WRITE_EVERY_MS while steady. Parallel updates in one isolate are folded
// into that single write. The free KV plan allows 1,000 writes and
// 100,000 reads a day, so /api/health is one read, not one per feed.
// /api/health turns the records into ok / degraded / resting.
// =================================================================

export interface SourceHealthRecord {
  /** Last successful upstream fetch (ms). */
  lastOk?: number;
  /** Last failed upstream fetch (ms). */
  lastFail?: number;
  /** Most recent failure reason (trimmed). */
  error?: string;
  /** Consecutive failed attempts (0 = currently healthy). */
  streak: number;
  /** When the current failing run began (ms); cleared on success. */
  failingSince?: number;
  /** Row count of the last good payload. */
  rows?: number;
  /** When this record was last persisted (ms). */
  written: number;
}

export type SourceHealthState = "ok" | "degraded" | "resting" | "unknown";

export type SourceOutcome =
  | { ok: true; rows: number | null }
  | { ok: false; error: string };

export const WRITE_EVERY_MS = 6 * 3_600_000;
/** Failing continuously for this long (repeated failures) → hide the feed ("resting"). */
export const RESTING_AFTER_MS = 3 * 3_600_000;
/** One KV key for every feed. Per-feed keys made /api/health a read per kind. */
export const SOURCE_HEALTH_KEY = "srch:_all";
const INDEX_TTL_SECS = 30 * 86_400;

/** Fold one outcome into a record; `persist` says whether KV needs the write. */
export function nextSourceHealth(
  prev: SourceHealthRecord | null,
  outcome: SourceOutcome,
  now: number,
): { record: SourceHealthRecord; persist: boolean } {
  const base: SourceHealthRecord = prev ?? { streak: 0, written: 0 };
  const record: SourceHealthRecord = outcome.ok
    ? { ...base, lastOk: now, streak: 0, rows: outcome.rows ?? base.rows, error: undefined, failingSince: undefined }
    : {
        ...base,
        lastFail: now,
        streak: base.streak + 1,
        error: outcome.error.slice(0, 200),
        failingSince: base.streak > 0 ? (base.failingSince ?? now) : now,
      };
  const flipped = !prev || (outcome.ok ? prev.streak > 0 : prev.streak === 0);
  const prevStreak = prev?.streak ?? 0;
  const crossedRestingStreak = !outcome.ok && prevStreak < 2 && prevStreak + 1 >= 2;
  const persist = flipped || crossedRestingStreak || now - base.written >= WRITE_EVERY_MS;
  if (persist) record.written = now;
  return { record, persist };
}

export function classifySourceHealth(rec: SourceHealthRecord | null, now: number): SourceHealthState {
  if (!rec) return "unknown";
  if (rec.streak === 0) return "ok";
  // Two+ failures in a row and the current failing run began hours ago → resting.
  // Measured from failingSince, not lastOk: long-TTL feeds succeed rarely by design.
  const since = rec.failingSince ?? rec.lastFail ?? now;
  const longDown = now - since >= RESTING_AFTER_MS;
  return rec.streak >= 2 && longDown ? "resting" : "degraded";
}

type HealthIndex = Record<string, SourceHealthRecord>;

interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// Per-isolate copy so steady traffic needs no KV read per fetch.
let memo: HealthIndex | null = null;
let loading: Promise<void> | null = null;
let dirty = false;
let flushing: Promise<void> | null = null;

export function resetSourceHealthCache(): void {
  memo = null;
  loading = null;
  dirty = false;
  flushing = null;
}

function isIndex(value: unknown): value is HealthIndex {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function ensureLoaded(kv: Kv): Promise<HealthIndex> {
  if (memo) return memo;
  if (!loading) {
    loading = (async () => {
      const raw = await kv.get(SOURCE_HEALTH_KEY, "json");
      if (!memo) memo = isIndex(raw) ? raw : {};
    })().finally(() => {
      loading = null;
    });
  }
  await loading;
  return memo ?? {};
}

function mergeIndex(remote: unknown, local: HealthIndex): HealthIndex {
  const out: HealthIndex = isIndex(remote) ? { ...remote } : {};
  for (const [kind, rec] of Object.entries(local)) {
    if (!rec || typeof rec.streak !== "number") continue;
    const other = out[kind];
    if (!other || rec.written >= other.written) out[kind] = rec;
  }
  return out;
}

async function flush(kv: Kv): Promise<void> {
  // Let other outcomes in this turn join the same write.
  await Promise.resolve();
  while (dirty && memo) {
    dirty = false;
    const merged = mergeIndex(await kv.get(SOURCE_HEALTH_KEY, "json"), memo);
    memo = merged;
    await kv.put(SOURCE_HEALTH_KEY, JSON.stringify(merged), { expirationTtl: INDEX_TTL_SECS });
  }
}

export async function noteSourceOutcome(
  kv: Kv | undefined,
  kind: string,
  outcome: SourceOutcome,
  now = Date.now(),
): Promise<void> {
  if (!kv) return;
  try {
    const index = await ensureLoaded(kv);
    const { record, persist } = nextSourceHealth(index[kind] ?? null, outcome, now);
    index[kind] = record;
    if (!persist) return;
    dirty = true;
    if (!flushing) {
      flushing = flush(kv).finally(() => {
        flushing = null;
      });
    }
    await flushing;
  } catch {
    /* health is best-effort — never break the feed response */
  }
}

export async function readSourceHealth(
  kv: Kv | undefined,
  kinds: string[],
  now = Date.now(),
): Promise<Record<string, { state: SourceHealthState } & Partial<SourceHealthRecord>>> {
  let index: HealthIndex = memo ?? {};
  if (!memo && kv) {
    try {
      index = await ensureLoaded(kv);
    } catch {
      index = {};
    }
  }
  const out: Record<string, { state: SourceHealthState } & Partial<SourceHealthRecord>> = {};
  for (const kind of kinds) {
    const rec = index[kind] ?? null;
    const { written: _w, ...rest } = rec ?? ({ streak: 0, written: 0 } as SourceHealthRecord);
    out[kind] = rec ? { state: classifySourceHealth(rec, now), ...rest } : { state: "unknown" };
  }
  return out;
}
