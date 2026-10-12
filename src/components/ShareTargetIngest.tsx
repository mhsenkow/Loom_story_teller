"use client";

import { useEffect, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import { loadSharedTargetFile, parseShareIngestToken } from "@/lib/shareTargetIngest";
import { isSupportedWebUpload } from "@/lib/webFormats";

/** Pull a file stashed by the service worker share target into the normal import flow. */
export function ShareTargetIngest({ onFiles }: { onFiles: (files: File[]) => void }) {
  const started = useRef(false);
  const setToast = useLoomStore((s) => s.setToast);

  useEffect(() => {
    if (started.current || typeof window === "undefined") return;
    const token = parseShareIngestToken(window.location.hash);
    if (!token) return;
    started.current = true;
    void (async () => {
      const file = await loadSharedTargetFile(token);
      if (!file) {
        setToast("Shared file not found — import from Files instead");
        return;
      }
      if (!isSupportedWebUpload(file.name)) {
        setToast("That shared file type is not supported — try CSV or JSON");
        return;
      }
      onFiles([file]);
      setToast(`Imported shared file “${file.name}”`);
      const clean = window.location.hash.replace(/[#&]?ingest=share:[^&]+/, "");
      window.history.replaceState(null, "", window.location.pathname + window.location.search + clean);
    })();
  }, [onFiles, setToast]);

  return null;
}
