/**
 * LOOM-601 — IndexedDB + localStorage failure modes under jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDomStorageHarness } from "./setupDomIdb";
import {
  getWebFileInspect,
  hydrateWebFileCache,
  loadAllWebFileInspects,
  putWebFileInspect,
  type WebFilePersist,
} from "../webFileStore";
import { stagedHydrateWebFileCache } from "../webHydration";
import { safeSetItem, setPersistedAppSettings, getPersistedAppSettings } from "../persist";

const SAMPLE_ROW = {
  path: "web://demo.csv",
  name: "demo.csv",
  extension: "csv",
  sizeBytes: 12,
  updatedAt: 1_700_000_000_000,
  stats: [
    {
      name: "x",
      data_type: "DOUBLE",
      null_count: 0,
      distinct_count: 1,
      min_value: "1",
      max_value: "1",
    },
  ],
  sample: {
    columns: ["x"],
    types: ["DOUBLE"],
    rows: [[1]],
    total_rows: 1,
  },
} satisfies WebFilePersist;

describe("webFileStore resilience", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    resetDomStorageHarness();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("loom-web-files");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a payload through fake IndexedDB", async () => {
    await putWebFileInspect(SAMPLE_ROW);
    const row = await getWebFileInspect(SAMPLE_ROW.path);
    expect(row?.name).toBe("demo.csv");
    const hydrated = await hydrateWebFileCache();
    expect(hydrated.entries[0]?.path).toBe(SAMPLE_ROW.path);
    expect(hydrated.cache[SAMPLE_ROW.path]?.sample.rows).toEqual([[1]]);
  });

  it("returns empty reads when IndexedDB is unavailable (private mode)", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(putWebFileInspect(SAMPLE_ROW)).resolves.toBeUndefined();
    await expect(getWebFileInspect(SAMPLE_ROW.path)).resolves.toBeNull();
    await expect(loadAllWebFileInspects()).resolves.toEqual([]);
  });

  it("settled put on quota exhaustion — reload does not resurrect a failed persist", async () => {
    await putWebFileInspect(SAMPLE_ROW);
    let failWrite = true;
    const origTx = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const tx = origTx.apply(this, args);
      const mode = args[1];
      if (failWrite && mode === "readwrite") {
        failWrite = false;
        tx.abort();
      }
      return tx;
    });

    await putWebFileInspect({ ...SAMPLE_ROW, path: "web://other.csv", name: "other.csv" });
    vi.restoreAllMocks();

    const all = await loadAllWebFileInspects();
    expect(all.some((r) => r.path === "web://other.csv")).toBe(false);
    expect(all.some((r) => r.path === SAMPLE_ROW.path)).toBe(true);
  });

  it("skips malformed records without throwing", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("loom-web-files", 2);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore("inspects", { keyPath: "path" });
        s.createIndex("byUpdatedAt", "updatedAt");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("inspects", "readwrite");
      tx.objectStore("inspects").put({ path: "web://bad", garbage: true });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    await putWebFileInspect(SAMPLE_ROW);
    const rows = await loadAllWebFileInspects();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe(SAMPLE_ROW.path);
  });

  it("hydration settles with an empty index when storage fails", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const phases: string[] = [];
    await stagedHydrateWebFileCache({
      onPhase: (p) => phases.push(p),
      onIndex: (entries) => {
        expect(entries).toEqual([]);
      },
    });
    expect(phases).toEqual(["index", "ready"]);
  });
});

describe("persist localStorage resilience", () => {
  afterEach(() => {
    resetDomStorageHarness();
    vi.unstubAllGlobals();
  });

  it("returns false on QuotaExceededError without throwing", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
        getItem: () => null,
        removeItem: () => {},
      },
    });
    expect(safeSetItem("loom-test", "x")).toBe(false);
    expect(setPersistedAppSettings({ theme: "dark" })).toBe(false);
    expect(getPersistedAppSettings()).toBeNull();
  });

  it("upgrade open failure yields null reads, not a hang", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const req = {
        result: null as unknown as IDBDatabase,
        error: new DOMException("blocked", "VersionError"),
        onsuccess: null as ((this: IDBOpenDBRequest, ev: Event) => void) | null,
        onerror: null as ((this: IDBOpenDBRequest, ev: Event) => void) | null,
        onupgradeneeded: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.call(req, new Event("error")));
      return req;
    });
    await expect(getWebFileInspect("web://missing.csv")).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});
