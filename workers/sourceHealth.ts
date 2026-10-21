// =================================================================
// Loom — live feed health (Worker side)
// =================================================================
// Every real upstream attempt for /api/source/<kind> reports an outcome.
// State lives in KV (`srch:<kind>`) but is only written when a feed flips
// between working and failing, or every WRITE_EVERY_MS while steady — KV
// writes stay ~proportional to incidents, not traffic. /api/health turns
// the records into ok / degraded / resting for the app and the nightly probe.
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

export const WRITE_EVERY_MS = 30 * 60_000;
/** No success for this long (and repeated failures) → hide the feed ("resting"). */
export const RESTING_AFTER_MS = 3 * 3_600_000;
const KEY_PREFIX = "srch:";

export function healthKey(kind: string): string {
  return KEY_PREFIX + kind;
}

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
  const persist = flipped || now - base.written >= WRITE_EVERY_MS;
  if (persist) record.written = now;
  return { record, persist };
}

export function classifySourceHealth(rec: SourceHealthRecord | null, now: number): SourceHealthState {
  if (!rec) return "unknown";
  if (rec.streak === 0) return "ok";
  // Two+ failures in a row with no success in the last few hours (or ever) → resting.
  const longDown = !rec.lastOk || now - rec.lastOk >= RESTING_AFTER_MS;
  return rec.streak >= 2 && longDown ? "resting" : "degraded";
}

// Per-isolate memory so steady traffic needs no KV read per fetch.
const memo = new Map<string, SourceHealthRecord>();

interface Kv {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export async function noteSourceOutcome(
  kv: Kv | undefined,
  kind: string,
  outcome: SourceOutcome,
  now = Date.now(),
): Promise<void> {
  if (!kv) return;
  try {
    let prev = memo.get(kind) ?? null;
    if (!prev) prev = ((await kv.get(healthKey(kind), "json")) as SourceHealthRecord | null) ?? null;
    const { record, persist } = nextSourceHealth(prev, outcome, now);
    memo.set(kind, record);
    // 30-day expiry: a feed nobody requests for a month simply reads as "unknown".
    if (persist) await kv.put(healthKey(kind), JSON.stringify(record), { expirationTtl: 30 * 86_400 });
  } catch {
    /* health is best-effort — never break the feed response */
  }
}

export async function readSourceHealth(
  kv: Kv | undefined,
  kinds: string[],
  now = Date.now(),
): Promise<Record<string, { state: SourceHealthState } & Partial<SourceHealthRecord>>> {
  const out: Record<string, { state: SourceHealthState } & Partial<SourceHealthRecord>> = {};
  await Promise.all(
    kinds.map(async (kind) => {
      let rec = memo.get(kind) ?? null;
      if (!rec && kv) rec = ((await kv.get(healthKey(kind), "json").catch(() => null)) as SourceHealthRecord | null) ?? null;
      const { written: _w, ...rest } = rec ?? ({ streak: 0, written: 0 } as SourceHealthRecord);
      out[kind] = rec ? { state: classifySourceHealth(rec, now), ...rest } : { state: "unknown" };
    }),
  );
  return out;
}
