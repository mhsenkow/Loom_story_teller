// =================================================================
// Loom — Native-capable save/share fallbacks (web + mobile shells)
// =================================================================
// Desktop Tauri uses dialogs; Safari/iOS webviews prefer Web Share when
// programmatic download anchors are ignored.
// LinkedIn / X often drop bare image files — share a public story URL
// (OG image) alongside the PNG so the post keeps a preview + reopen link.
// =================================================================

import { isMobileOs, isTauri } from "./tauri";

export type NativeExportOutcome = "saved" | "shared" | "downloaded" | "cancelled" | "unsupported";

/** Trigger a one-shot browser download (desktop web / fallback). */
export function downloadBlob(blob: Blob, filename: string): NativeExportOutcome {
  if (typeof document === "undefined") return "unsupported";
  // iPhone/iPad Tauri cancels <a download> clicks — don't claim it worked.
  if (isTauri() && isMobileOs()) return "unsupported";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

/** Caption + absolute story URL for share targets that only keep text. */
export function shareCaptionWithLink(caption: string, url?: string | null): string {
  const body = caption.trim();
  const link = url?.trim();
  if (!link) return body;
  if (!body) return link;
  if (body.includes(link)) return body;
  return `${body}\n\n${link}`;
}

/**
 * Ordered Web Share payloads: file+url first (best for Photos/Messages), then
 * URL-only (LinkedIn link card with og:image), then file-only fallback.
 */
export function buildImageShareAttempts(input: {
  file: File;
  title: string;
  caption: string;
  url?: string | null;
}): ShareData[] {
  const title = input.title.trim() || input.file.name;
  const url = input.url?.trim() || undefined;
  const text = shareCaptionWithLink(input.caption, url);
  const attempts: ShareData[] = [];
  if (url) {
    attempts.push({ files: [input.file], title, text, url });
    attempts.push({ files: [input.file], title, text });
    attempts.push({ title, text, url });
  }
  attempts.push({ files: [input.file], title, text: input.caption.trim() || title });
  return attempts;
}

/** Try share payloads until one is accepted (or user cancels). */
export async function shareWithFallback(attempts: ShareData[]): Promise<NativeExportOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav?.share || attempts.length === 0) return "unsupported";
  for (const data of attempts) {
    try {
      if (typeof nav.canShare === "function" && !nav.canShare(data)) continue;
      await nav.share(data);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      /* try next payload shape */
    }
  }
  return "unsupported";
}

/** Web Share API when available (iOS Safari / Capacitor https scheme). */
export async function shareBlob(
  blob: Blob,
  filename: string,
  title?: string,
  opts?: { caption?: string; url?: string | null },
): Promise<NativeExportOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav?.share) return "unsupported";
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  return shareWithFallback(
    buildImageShareAttempts({
      file,
      title: title ?? filename,
      caption: opts?.caption ?? "",
      url: opts?.url,
    }),
  );
}

/** Prefer share on mobile-like UA, else anchor download. */
export async function saveOrShareBlob(
  blob: Blob,
  filename: string,
  opts?: { title?: string; preferShare?: boolean },
): Promise<NativeExportOutcome> {
  // isMobileOs also catches iPadOS, whose webview reports a Macintosh UA.
  const preferShare = opts?.preferShare ?? isMobileOs();
  if (preferShare) {
    const shared = await shareBlob(blob, filename, opts?.title);
    if (shared === "shared" || shared === "cancelled") return shared;
  }
  return downloadBlob(blob, filename);
}
