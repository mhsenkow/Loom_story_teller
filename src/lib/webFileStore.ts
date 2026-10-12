// =================================================================
// Loom — Durable web upload store (IndexedDB)
// =================================================================
// Keeps inspected tabular payloads across reloads so Recent → Open
// still works for local uploads (Zustand webFileCache alone does not).
// Caps total entries; oldest by updatedAt are evicted.
// Writes are revisioned (LOOM-560): puts take a revision when called, deletes
// leave a short-lived tombstone, and `shouldAcceptWebFilePut` decides
// newest-wins so a slow save never recreates a deleted upload.
// =================================================================

import type { ColumnInfo, QueryResult } from "./store";
import { webFileStoragePathCandidates } from "./webFileIdentity";
import { parseWebFilePersist } from "./webFileValidation";

const DB_NAME = "loom-web-files";
const DB_VERSION = 2;
const STORE = "inspects";
const INDEX_UPDATED = "byUpdatedAt";
const MAX_ENTRIES = 24;

export type WebFilePersist = {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  stats: ColumnInfo[];
  sample: QueryResult;
  updatedAt: number;
  /** Monotonic revision for newest-wins races (LOOM-560). */
  revision?: number;
};

const TOMBSTONE_TTL_MS = 60_000;
/** Paths deleted recently — late puts must not resurrect them. */
const deletedTombstones = new Map<string, { deletedAt: number; revision: number }>();
let revisionClock = 0;

function nextRevision(updatedAt: number): number {
  revisionClock = Math.max(revisionClock + 1, updatedAt);
  return revisionClock;
}

function pruneTombstones(now = Date.now()): void {
  for (const [path, t] of deletedTombstones) {
    if (now - t.deletedAt > TOMBSTONE_TTL_MS) deletedTombstones.delete(path);
  }
}

/** Pure race policy for tests + putWebFileInspect (LOOM-560). */
export function shouldAcceptWebFilePut(
  entry: { path: string; updatedAt: number; revision?: number },
  existing: { updatedAt: number; revision?: number } | null,
  tombstone: { deletedAt: number; revision: number } | null,
): boolean {
  if (tombstone && (entry.revision ?? entry.updatedAt) <= tombstone.revision) {
    return false;
  }
  if (!existing) return true;
  const incoming = entry.revision ?? entry.updatedAt;
  const current = existing.revision ?? existing.updatedAt;
  return incoming >= current;
}

function notifyWebFileLibraryChanged(path: string, op: "put" | "delete"): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel("loom-web-files");
    ch.postMessage({ type: "library", op, path, at: Date.now() });
    ch.close();
  } catch {
    /* ignore */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: "path" });
      } else {
        store = req.transaction!.objectStore(STORE);
      }
      if (!store.indexNames.contains(INDEX_UPDATED)) {
        store.createIndex(INDEX_UPDATED, "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function waitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function evictOldestEntries(store: IDBObjectStore, keepPath: string): Promise<void> {
  const count = await idbReq(store.count());
  if (count <= MAX_ENTRIES) return;
  const toDrop = count - MAX_ENTRIES;
  const idx = store.index(INDEX_UPDATED);
  let dropped = 0;
  await new Promise<void>((resolve, reject) => {
    const cursorReq = idx.openCursor();
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cursor failed"));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || dropped >= toDrop) {
        resolve();
        return;
      }
      const row = cursor.value as WebFilePersist;
      if (row.path !== keepPath) {
        cursor.delete();
        dropped += 1;
      }
      cursor.continue();
    };
  });
}

export async function putWebFileInspect(entry: WebFilePersist): Promise<void> {
  pruneTombstones();
  const revision = entry.revision ?? nextRevision(entry.updatedAt);
  const row: WebFilePersist = { ...entry, revision };
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const txDone = waitTx(tx);
    const existing = parseWebFilePersist(await idbReq(store.get(row.path)));
    if (!shouldAcceptWebFilePut(row, existing, deletedTombstones.get(row.path) ?? null)) {
      tx.abort();
      await txDone.catch(() => undefined);
      return;
    }
    store.put({ ...row, payloadVersion: DB_VERSION });
    await evictOldestEntries(store, row.path);
    await txDone;
    notifyWebFileLibraryChanged(row.path, "put");
  } catch {
    /* quota / private mode — cache stays in-memory only */
  } finally {
    db?.close();
  }
}

export async function getWebFileInspect(path: string): Promise<WebFilePersist | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const txDone = waitTx(tx);
    for (const key of webFileStoragePathCandidates(path)) {
      const raw = await idbReq(store.get(key));
      const row = parseWebFilePersist(raw);
      if (row) {
        await txDone;
        return row;
      }
    }
    await txDone;
    return null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function loadAllWebFileInspects(): Promise<WebFilePersist[]> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = (await idbReq(tx.objectStore(STORE).getAll())) as unknown[];
    await waitTx(tx);
    return (all ?? []).map(parseWebFilePersist).filter((r): r is WebFilePersist => r != null);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function clearAllWebFileInspects(): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const txDone = waitTx(tx);
    store.clear();
    await txDone;
  } catch {
    /* ignore */
  } finally {
    db?.close();
  }
}

export async function deleteWebFileInspect(path: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    const revision = nextRevision(Date.now());
    deletedTombstones.set(path, { deletedAt: Date.now(), revision });
    db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const txDone = waitTx(tx);
    for (const key of webFileStoragePathCandidates(path)) {
      store.delete(key);
    }
    await txDone;
    notifyWebFileLibraryChanged(path, "delete");
  } catch {
    /* ignore */
  } finally {
    db?.close();
  }
}

/** Test helper — reset in-memory tombstones/revision clock. */
export function resetWebFileRaceStateForTests(): void {
  deletedTombstones.clear();
  revisionClock = 0;
}

export type WebFileIndexEntry = {
  path: string;
  name: string;
  extension: string;
  row_count: number;
  size_bytes: number;
  updatedAt: number;
};

/** Metadata only — no sample rows loaded into the returned structure. */
export async function loadWebFileIndex(): Promise<WebFileIndexEntry[]> {
  const rows = await loadAllWebFileInspects();
  return rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({
      path: r.path,
      name: r.name,
      extension: r.extension,
      row_count: r.sample.total_rows ?? r.sample.rows.length,
      size_bytes: r.sizeBytes,
      updatedAt: r.updatedAt,
    }));
}

export async function loadWebFileInspectPayload(
  path: string,
): Promise<{ stats: ColumnInfo[]; sample: QueryResult } | null> {
  const row = await getWebFileInspect(path);
  if (!row) return null;
  return { stats: row.stats, sample: row.sample };
}

/** Rebuild Zustand webFileCache + FileEntry stubs from IndexedDB (eager). */
export async function hydrateWebFileCache(): Promise<{
  cache: Record<string, { stats: ColumnInfo[]; sample: QueryResult }>;
  entries: Omit<WebFileIndexEntry, "updatedAt">[];
}> {
  const rows = await loadAllWebFileInspects();
  const cache: Record<string, { stats: ColumnInfo[]; sample: QueryResult }> = {};
  const entries = rows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => {
      cache[r.path] = { stats: r.stats, sample: r.sample };
      return {
        path: r.path,
        name: r.name,
        extension: r.extension,
        row_count: r.sample.total_rows ?? r.sample.rows.length,
        size_bytes: r.sizeBytes,
      };
    });
  return { cache, entries };
}
