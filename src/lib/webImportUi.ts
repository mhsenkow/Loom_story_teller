// =================================================================
// Loom — User-facing web / mobile import error copy (LOOM-414)
// =================================================================

import { WebIngestAbortedError } from "./webIngest";

/** Normalize picker + ingest failures for toasts (never throws). */
export function formatWebImportError(err: unknown): string {
  if (err instanceof WebIngestAbortedError) return "";
  if (err instanceof DOMException) {
    if (err.name === "AbortError") return "";
    if (err.name === "NotAllowedError") {
      return "File access was denied — try again and allow access when your device prompts.";
    }
    if (err.name === "SecurityError") {
      return "This browser blocked file access. Use Add files and pick from your device storage.";
    }
    if (err.name === "NotReadableError") {
      return "Couldn’t read that file — if it’s in iCloud or Files, wait for it to finish downloading, then retry.";
    }
  }
  if (err instanceof Error) {
    if (err.message.includes("browser imports are limited")) return err.message;
    if (err.message.includes("Permission needed to read")) {
      return "Allow folder access to sync — tap Sync again and choose Allow.";
    }
    return err.message;
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}
