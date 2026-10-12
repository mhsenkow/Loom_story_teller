"use client";

// =================================================================
// OfflineBanner — honest offline state (LOOM-416)
// =================================================================
// Probes our own origin (navigator.onLine is only a trigger), lists how
// many durable uploads can still be reopened, and names live data that
// can't refresh. Dispatches `loom:reconnected` so only remote work retries.
// =================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { isDesktop } from "@/lib/tauri";
import { probeConnection, describeOfflineImpact } from "@/lib/connectionStatus";
import { loadWebFileIndex } from "@/lib/webFileStore";
import { readSourceSnapshotCache } from "@/lib/sourceSnapshotCache";
import { sourceKindFromPath } from "@/lib/sourceRegistry";

export const RECONNECTED_EVENT = "loom:reconnected";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [uploads, setUploads] = useState(0);
  const selectedPath = useLoomStore((s) => s.selectedFile?.path ?? null);
  const selectedName = useLoomStore((s) => s.selectedFile?.name ?? null);

  const wasOffline = useRef(false);

  const check = useCallback(async () => {
    const ok = await probeConnection();
    if (ok && wasOffline.current && typeof window !== "undefined") window.dispatchEvent(new Event(RECONNECTED_EVENT));
    wasOffline.current = !ok;
    setOffline(!ok);
    return ok;
  }, []);

  useEffect(() => {
    if (isDesktop()) return;
    const run = () => void check();
    const first = window.setTimeout(run, 0);
    window.addEventListener("online", run);
    window.addEventListener("offline", run);
    const poll = window.setInterval(run, 30_000);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", run);
      window.clearInterval(poll);
    };
  }, [check]);

  useEffect(() => {
    if (!offline) return;
    let alive = true;
    void loadWebFileIndex()
      .then((rows) => alive && setUploads(rows.length))
      .catch(() => alive && setUploads(0));
    return () => {
      alive = false;
    };
  }, [offline]);

  if (!offline) return null;
  const kind = sourceKindFromPath(selectedPath);
  const impact = describeOfflineImpact({
    activePath: selectedPath,
    activeName: selectedName,
    durableUploadCount: uploads,
    snapshotCapturedAt: kind ? (readSourceSnapshotCache(kind)?.capturedAt ?? null) : null,
  });

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="fixed top-2 left-2 right-2 md:left-auto md:right-4 md:max-w-md z-[200] p-3 rounded-lg border border-loom-warning/40 bg-loom-surface shadow-lg text-xs text-loom-text space-y-1"
    >
      <p className="font-semibold">{impact.headline}</p>
      <p className="text-loom-muted">{impact.detail}</p>
      <button type="button" className="loom-btn-ghost border border-loom-border text-2xs px-2 py-1" onClick={() => void check()}>
        Retry connection
      </button>
    </div>
  );
}
