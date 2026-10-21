import { describe, expect, it } from "vitest";
import {
  RESTING_AFTER_MS,
  WRITE_EVERY_MS,
  classifySourceHealth,
  nextSourceHealth,
  noteSourceOutcome,
  readSourceHealth,
} from "../sourceHealth";

const H = 3_600_000;

describe("feed health", () => {
  it("writes KV only on flips or after the steady-state interval", () => {
    const a = nextSourceHealth(null, { ok: true, rows: 10 }, 1_000);
    expect(a.persist).toBe(true);
    const b = nextSourceHealth(a.record, { ok: true, rows: 12 }, 2_000);
    expect(b.persist).toBe(false);
    expect(b.record.rows).toBe(12);
    const c = nextSourceHealth(b.record, { ok: false, error: "502" }, 3_000);
    expect(c.persist).toBe(true);
    expect(c.record.streak).toBe(1);
    const d = nextSourceHealth(c.record, { ok: false, error: "502" }, 4_000);
    expect(d.persist).toBe(false);
    expect(nextSourceHealth(d.record, { ok: false, error: "502" }, 3_000 + WRITE_EVERY_MS).persist).toBe(true);
    const e = nextSourceHealth(d.record, { ok: true, rows: 5 }, 5_000);
    expect(e.persist).toBe(true);
    expect(e.record.streak).toBe(0);
    expect(c.record.failingSince).toBe(3_000);
    expect(d.record.failingSince).toBe(3_000);
    expect(e.record.failingSince).toBeUndefined();
    expect(e.record.error).toBeUndefined();
  });

  it("is degraded while a recent success exists, resting once down for hours", () => {
    const now = 100 * H;
    expect(classifySourceHealth(null, now)).toBe("unknown");
    expect(classifySourceHealth({ streak: 0, written: now }, now)).toBe("ok");
    expect(classifySourceHealth({ streak: 5, lastOk: now - H, written: now }, now)).toBe("degraded");
    expect(classifySourceHealth({ streak: 1, lastOk: now - RESTING_AFTER_MS, written: now }, now)).toBe("degraded");
    expect(classifySourceHealth({ streak: 2, lastOk: now - RESTING_AFTER_MS, written: now }, now)).toBe("resting");
    expect(classifySourceHealth({ streak: 2, written: now }, now)).toBe("resting");
  });

  it("round-trips through KV and never throws on storage errors", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
      put: async (k: string, v: string) => void store.set(k, v),
    };
    await noteSourceOutcome(kv, "met", { ok: false, error: "Met Museum 410" }, 10 * H);
    await noteSourceOutcome(kv, "met", { ok: false, error: "Met Museum 410" }, 14 * H);
    const health = await readSourceHealth(kv, ["met", "never"], 14 * H);
    expect(health.met).toMatchObject({ state: "resting", error: "Met Museum 410", streak: 2 });
    expect(health.never).toEqual({ state: "unknown" });
    const broken = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
    await expect(noteSourceOutcome(broken, "x", { ok: true, rows: 1 })).resolves.toBeUndefined();
  });
});
