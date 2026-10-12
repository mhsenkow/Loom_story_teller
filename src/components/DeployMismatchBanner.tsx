"use client";

import { useEffect, useState } from "react";
import {
  deployMismatchFromError,
  fetchDeployBuildId,
  installDeployMismatchListeners,
  markReloadOnce,
  readStoredBuildId,
  storeBuildId,
  type DeployMismatchState,
} from "@/lib/deployVersionGuard";

export function DeployMismatchBanner() {
  const [state, setState] = useState<DeployMismatchState | null>(null);

  useEffect(() => {
    void (async () => {
      const remote = await fetchDeployBuildId();
      if (!remote) return;
      const local = readStoredBuildId();
      if (local && local !== remote) {
        setState({
          message:
            "A new version of Loom is available. Reload once to continue — uploads and settings on this device are kept.",
          canReload: true,
        });
        return;
      }
      storeBuildId(remote);
    })();
    return installDeployMismatchListeners((next) => setState(next));
  }, []);

  if (!state) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-[200] p-3 rounded-lg border border-loom-warning/40 bg-loom-surface shadow-lg text-xs text-loom-text space-y-2"
      role="status"
    >
      <p>{state.message}</p>
      {state.canReload && (
        <button
          type="button"
          className="loom-btn-primary text-xs"
          onClick={() => {
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
