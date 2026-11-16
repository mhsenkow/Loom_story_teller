"use client";

import { useEffect, useRef, useState } from "react";
import {
  consumeOneShotReload,
  deployMismatchFromError,
  fetchDeployBuildId,
  installDeployMismatchListeners,
  markReloadOnce,
  storeBuildId,
  type DeployMismatchState,
} from "@/lib/deployVersionGuard";

export function DeployMismatchBanner() {
  const [state, setState] = useState<DeployMismatchState | null>(null);
  const pendingBuildId = useRef<string | null>(null);

  useEffect(() => {
    // The id deployed when this page loaded is the code it is running. Comparing with an id
    // remembered from an earlier load in the same tab (sessionStorage) flagged every fresh
    // load after a deploy as stale — the banner came back even after "Reload Loom".
    let loadedId: string | null = null;
    let disposed = false;
    const check = async () => {
      const remote = await fetchDeployBuildId();
      if (!remote || disposed) return;
      if (!loadedId) {
        loadedId = remote;
        consumeOneShotReload();
        storeBuildId(remote);
        return;
      }
      if (remote !== loadedId) {
        pendingBuildId.current = remote;
        setState({
          message:
            "A new version of Loom is available. Reload once to continue — uploads and settings on this device are kept.",
          canReload: true,
        });
      }
    };
    void check();
    // A tab left open across a deploy: look again when it comes back, and now and then.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void check(), 10 * 60_000);
    const uninstall = installDeployMismatchListeners((next) => setState(next));
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      uninstall();
    };
  }, []);

  if (!state) return null;

  return (
    <div
      className="fixed bottom-[max(1rem,calc(var(--safe-bottom)+0.5rem))] left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[200] p-3 rounded-lg border border-loom-warning/40 bg-loom-surface shadow-lg text-xs text-loom-text space-y-2"
      role="status"
    >
      <p>{state.message}</p>
      {state.canReload && (
        <button
          type="button"
          className="loom-btn-primary text-xs"
          onClick={() => {
            const next = pendingBuildId.current;
            if (next) storeBuildId(next);
            markReloadOnce();
            window.location.reload();
          }}
        >
          Reload Loom
        </button>
      )}
    </div>
  );
}

export { deployMismatchFromError };
