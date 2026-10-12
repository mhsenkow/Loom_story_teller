// =================================================================
// Loom — Static deploy mismatch recovery (LOOM-660)
// =================================================================
// Detects stale JS chunks after a Worker deploy and offers a one-shot
// reload without discarding durable localStorage / IndexedDB uploads.
// =================================================================

const RELOAD_KEY = "loom-deploy-reload-once";
const BUILD_ID_PATH = "/build-id.txt";

export type DeployMismatchState = {
  message: string;
  canReload: boolean;
};

function isChunkLoadError(message: string): boolean {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    message,
  );
}

/** Fetch current deploy id (generated at build time). */
export async function fetchDeployBuildId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(BUILD_ID_PATH, { cache: "no-store" });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}

export function readStoredBuildId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem("loom-build-id");
  } catch {
    return null;
  }
}

export function storeBuildId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("loom-build-id", id);
  } catch {
    /* ignore */
  }
}

export function consumeOneShotReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY) === "1") {
      window.sessionStorage.removeItem(RELOAD_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function markReloadOnce(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function deployMismatchFromError(error: unknown): DeployMismatchState | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (!isChunkLoadError(msg)) return null;
  const canReload = !consumeOneShotReload();
  return {
    message:
      "Loom was updated while this tab stayed open. Reload to pick up the new version — your saved uploads and settings stay on this device.",
    canReload,
  };
}

export function installDeployMismatchListeners(onMismatch: (state: DeployMismatchState) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onError = (ev: ErrorEvent) => {
    const state = deployMismatchFromError(ev.error ?? ev.message);
    if (state) onMismatch(state);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    const state = deployMismatchFromError(ev.reason);
    if (state) onMismatch(state);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
