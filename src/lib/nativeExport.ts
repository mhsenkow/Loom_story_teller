// =================================================================
// Loom — Native-capable save/share fallbacks (web + mobile shells)
// =================================================================
// Desktop Tauri uses dialogs; Safari/iOS webviews prefer Web Share when
// programmatic download anchors are ignored.
// =================================================================

export type NativeExportOutcome = "saved" | "shared" | "downloaded" | "cancelled" | "unsupported";

/** Trigger a one-shot browser download (desktop web / fallback). */
export function downloadBlob(blob: Blob, filename: string): NativeExportOutcome {
  if (typeof document === "undefined") return "unsupported";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

/** Web Share API when available (iOS Safari / Capacitor https scheme). */
export async function shareBlob(blob: Blob, filename: string, title?: string): Promise<NativeExportOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav?.share) return "unsupported";
  try {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const payload: ShareData = { title: title ?? filename, files: [file] };
    if (nav.canShare && !nav.canShare(payload)) return "unsupported";
    await nav.share(payload);
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

/** Prefer share on mobile-like UA, else anchor download. */
export async function saveOrShareBlob(
  blob: Blob,
  filename: string,
  opts?: { title?: string; preferShare?: boolean },
): Promise<NativeExportOutcome> {
  const preferShare =
    opts?.preferShare ??
    (typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  if (preferShare) {
    const shared = await shareBlob(blob, filename, opts?.title);
    if (shared === "shared" || shared === "cancelled") return shared;
  }
  return downloadBlob(blob, filename);
}
