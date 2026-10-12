// =================================================================
// chartViewThumbnails — IndexedDB PNG/JPEG previews (LOOM-028)
// =================================================================
// Full-size chart PNG data URLs must not live in localStorage; store
// blobs here and keep only view id references in persisted JSON.
// =================================================================

const DB_NAME = "loom-chart-thumbs";
const DB_VERSION = 1;
const STORE = "thumbs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "viewId" });
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

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Persist thumbnail; returns stable id (view id). */
export async function putChartViewThumbnail(viewId: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  try {
    const blob = await dataUrlToBlob(dataUrl);
    const tx = db.transaction(STORE, "readwrite");
    const done = waitTx(tx);
    tx.objectStore(STORE).put({ viewId, blob, updatedAt: Date.now() });
    await done;
  } finally {
    db.close();
  }
}

export async function getChartViewThumbnailDataUrl(viewId: string): Promise<string | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const done = waitTx(tx);
    const row = (await idbReq(tx.objectStore(STORE).get(viewId))) as
      | { blob?: Blob }
      | undefined;
    await done;
    const blob = row?.blob;
    if (!blob) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function removeChartViewThumbnail(viewId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const done = waitTx(tx);
    tx.objectStore(STORE).delete(viewId);
    await done;
  } catch {
    /* ignore */
  } finally {
    db.close();
  }
}

/** Hydrate many views after localStorage load. */
export async function hydrateChartViewThumbnails(
  viewIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    viewIds.map(async (id) => {
      const url = await getChartViewThumbnailDataUrl(id);
      if (url) out[id] = url;
    }),
  );
  return out;
}
