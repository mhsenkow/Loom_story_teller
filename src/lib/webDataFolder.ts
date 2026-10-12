// =================================================================
// Loom — “My Loom data” web vault + optional linked device folder
// =================================================================
// Reinforces the desktop mental model on phone/browser: you have a
// folder just for your data. Inspect rows live in IndexedDB; Chromium
// (incl. Chrome Android) can also link a real on-device folder and
// re-sync it via a stored FileSystemDirectoryHandle.
// =================================================================

import { isSupportedWebUpload } from "./webFormats";

/** Mounted-folder path for the browser vault (shows as a named folder). */
export const WEB_VAULT_PATH = "web://my-data";

/** User-facing name — the “oh, that’s my data folder” label. */
export const WEB_VAULT_LABEL = "My Loom data";

/** Linked-folder scan limits (LOOM-314). */
export const LINKED_FOLDER_MAX_DEPTH = 4;
export const LINKED_FOLDER_MAX_FILES = 200;
export const LINKED_FOLDER_MAX_DIRS = 400;

const HANDLE_DB = "loom-web-folder";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "linked-directory";
const META_KEY = "loom-linked-folder-meta";

export type LinkedFolderMeta = {
  displayName: string;
  linkedAt: number;
};

export type LinkedFolderScanProgress = {
  dirsScanned: number;
  filesFound: number;
  unsupported: number;
  capped: boolean;
};

export type LinkedFolderPermissionResult =
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "prompt" };

export function isWebVaultPath(path: string | null | undefined): boolean {
  return path === "web://" || path === WEB_VAULT_PATH;
}

export function webVaultDisplayName(
  mountedFolder: string | null | undefined,
  linked?: LinkedFolderMeta | null,
): string | null {
  if (!mountedFolder) return null;
  if (isWebVaultPath(mountedFolder)) {
    return linked?.displayName
      ? `${WEB_VAULT_LABEL} · ${linked.displayName}`
      : WEB_VAULT_LABEL;
  }
  if (mountedFolder.startsWith("mock://")) return "Demo data";
  return mountedFolder.split("/").pop() || null;
}

export function getLinkedFolderMeta(): LinkedFolderMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as LinkedFolderMeta;
    if (!j?.displayName) return null;
    return j;
  } catch {
    return null;
  }
}

export function setLinkedFolderMeta(meta: LinkedFolderMeta | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!meta) window.localStorage.removeItem(META_KEY);
    else window.localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

export async function saveLinkedDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("put failed"));
  });
  db.close();
  setLinkedFolderMeta({ displayName: handle.name, linkedAt: Date.now() });
}

export async function loadLinkedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error ?? new Error("get failed"));
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearLinkedDirectory(): Promise<void> {
  setLinkedFolderMeta(null);
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

type PermissionMode = "read" | "readwrite";

async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
  mode: PermissionMode,
): Promise<PermissionState | "prompt" | "unsupported"> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: PermissionMode }) => Promise<PermissionState>;
  };
  if (typeof h.queryPermission !== "function") return "unsupported";
  try {
    return await h.queryPermission({ mode });
  } catch {
    return "prompt";
  }
}

/** Query linked-folder permission without auto-granting (LOOM-252). */
export async function linkedFolderPermissionState(
  handle: FileSystemDirectoryHandle,
  mode: PermissionMode = "read",
): Promise<LinkedFolderPermissionResult> {
  const current = await queryHandlePermission(handle, mode);
  if (current === "unsupported") return { status: "unsupported" };
  if (current === "granted") return { status: "granted" };
  if (current === "denied") return { status: "denied" };
  return { status: "prompt" };
}

export async function ensureLinkedFolderPermission(
  handle: FileSystemDirectoryHandle,
  mode: PermissionMode = "read",
): Promise<boolean> {
  const state = await linkedFolderPermissionState(handle, mode);
  if (state.status === "granted" || state.status === "unsupported") return true;
  if (state.status === "denied") return false;
  const h = handle as FileSystemDirectoryHandle & {
    requestPermission?: (o: { mode: PermissionMode }) => Promise<PermissionState>;
  };
  if (typeof h.requestPermission !== "function") return false;
  try {
    const next = await h.requestPermission({ mode });
    return next === "granted";
  } catch {
    return false;
  }
}

export type CollectLinkedFolderOptions = {
  signal?: AbortSignal;
  onProgress?: (p: LinkedFolderScanProgress) => void;
  maxDepth?: number;
  maxFiles?: number;
  maxDirs?: number;
};

async function collectSupportedFiles(
  dir: FileSystemDirectoryHandle,
  out: File[],
  opts: Required<Pick<CollectLinkedFolderOptions, "maxDepth" | "maxFiles" | "maxDirs">> & {
    signal?: AbortSignal;
    onProgress?: (p: LinkedFolderScanProgress) => void;
  },
  prefix = "",
  depth = 0,
  progress: LinkedFolderScanProgress = { dirsScanned: 0, filesFound: 0, unsupported: 0, capped: false },
): Promise<LinkedFolderScanProgress> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  progress.dirsScanned += 1;
  opts.onProgress?.({ ...progress });
  if (progress.dirsScanned > opts.maxDirs) {
    progress.capped = true;
    return progress;
  }
  for await (const [name, handle] of dir.entries()) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (out.length >= opts.maxFiles) {
      progress.capped = true;
      opts.onProgress?.({ ...progress });
      return progress;
    }
    if (handle.kind === "file") {
      if (!isSupportedWebUpload(name)) {
        progress.unsupported += 1;
        opts.onProgress?.({ ...progress });
        continue;
      }
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const file = await handle.getFile();
      out.push(
        new File([file], relativePath, {
          type: file.type,
          lastModified: file.lastModified,
        }),
      );
      progress.filesFound = out.length;
      opts.onProgress?.({ ...progress });
    } else if (handle.kind === "directory" && depth < opts.maxDepth) {
      const nextPrefix = prefix ? `${prefix}/${name}` : name;
      await collectSupportedFiles(handle, out, opts, nextPrefix, depth + 1, progress);
      if (progress.capped) return progress;
    }
  }
  return progress;
}

/** Pick a device folder, remember the handle, return supported files. */
export async function linkDeviceDataFolder(
  collectOpts?: CollectLinkedFolderOptions,
): Promise<{
  files: File[];
  meta: LinkedFolderMeta;
  scan: LinkedFolderScanProgress;
} | null> {
  const pick = typeof window !== "undefined" ? window.showDirectoryPicker : undefined;
  if (!pick) return null;
  try {
    const dir = await pick({ mode: "read" });
    await saveLinkedDirectoryHandle(dir);
    const files: File[] = [];
    const scan = await collectSupportedFiles(dir, files, {
      signal: collectOpts?.signal,
      onProgress: collectOpts?.onProgress,
      maxDepth: collectOpts?.maxDepth ?? LINKED_FOLDER_MAX_DEPTH,
      maxFiles: collectOpts?.maxFiles ?? LINKED_FOLDER_MAX_FILES,
      maxDirs: collectOpts?.maxDirs ?? LINKED_FOLDER_MAX_DIRS,
    });
    const meta = getLinkedFolderMeta()!;
    return { files, meta, scan };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** Re-open the linked folder (may prompt once) and return fresh File list. */
export async function resyncLinkedDataFolder(
  collectOpts?: CollectLinkedFolderOptions,
): Promise<{
  files: File[];
  meta: LinkedFolderMeta;
  scan: LinkedFolderScanProgress;
} | null> {
  const handle = await loadLinkedDirectoryHandle();
  if (!handle) return null;
  const perm = await linkedFolderPermissionState(handle, "read");
  if (perm.status === "denied") {
    throw new Error("Folder access was revoked — tap Reconnect folder to allow read access again");
  }
  if (perm.status === "prompt") {
    const ok = await ensureLinkedFolderPermission(handle, "read");
    if (!ok) throw new Error("Permission needed to read your Loom data folder");
  }
  setLinkedFolderMeta({ displayName: handle.name, linkedAt: Date.now() });
  const files: File[] = [];
  const scan = await collectSupportedFiles(handle, files, {
    signal: collectOpts?.signal,
    onProgress: collectOpts?.onProgress,
    maxDepth: collectOpts?.maxDepth ?? LINKED_FOLDER_MAX_DEPTH,
    maxFiles: collectOpts?.maxFiles ?? LINKED_FOLDER_MAX_FILES,
    maxDirs: collectOpts?.maxDirs ?? LINKED_FOLDER_MAX_DIRS,
  });
  return { files, meta: getLinkedFolderMeta()!, scan };
}

export function canLinkDeviceFolder(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}
