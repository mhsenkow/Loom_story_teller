import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  clearSourceSnapshotCache,
  readSourceSnapshotCache,
  writeSourceSnapshotCache,
} from "../sourceSnapshotCache";

describe("sourceSnapshotCache (LOOM-459)", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    const ls = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => storage.clear(),
      length: 0,
      key: () => null,
    };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { localStorage: ls });
    clearSourceSnapshotCache("hn");
  });

  it("round-trips snapshot metadata", () => {
    writeSourceSnapshotCache("hn", { hits: [{ objectID: "1", title: "T" }] });
    const row = readSourceSnapshotCache("hn");
    expect(row?.body).toEqual({ hits: [{ objectID: "1", title: "T" }] });
    expect(typeof row?.capturedAt).toBe("number");
  });
});
