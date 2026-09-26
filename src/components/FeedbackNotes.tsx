// =================================================================
// FeedbackNotes — Leave-a-note FAB → GitHub issue
// =================================================================
// Patterned after Judge / Salesforce Notes: quiet corner control,
// dialog with kind + title + body + optional screenshot, submits
// via createGitHubIssue (Worker secret on web, env on desktop).
// =================================================================

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createGitHubIssue,
  getGitHubNewIssueUrl,
  isTauri,
  openExternalUrl,
} from "@/lib/tauri";
import { useLoomStore } from "@/lib/store";

const KINDS = [
  { id: "ux", label: "UX" },
  { id: "bug", label: "Bug" },
  { id: "idea", label: "Idea" },
  { id: "data", label: "Data" },
] as const;

type Kind = (typeof KINDS)[number]["id"];

const MAX_SHOT_CHARS = 350_000;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function shrinkImageDataUrl(dataUrl: string, maxChars: number): Promise<string | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode"));
      img.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    let w = img.width;
    let h = img.height;
    const maxSide = 1280;
    if (Math.max(w, h) > maxSide) {
      const s = maxSide / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.72;
    let out = canvas.toDataURL("image/jpeg", quality);
    while (out.length > maxChars && quality > 0.35) {
      quality -= 0.1;
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out.length <= maxChars ? out : null;
  } catch {
    return null;
  }
}

async function openUrl(url: string) {
  if (isTauri()) await openExternalUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function FeedbackNotes() {
  const setToast = useLoomStore((s) => s.setToast);
  const viewMode = useLoomStore((s) => s.viewMode);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("ux");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  function reset() {
    setTitle("");
    setBody("");
    setKind("ux");
    setShot(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    try {
      let dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > MAX_SHOT_CHARS) {
        const smaller = await shrinkImageDataUrl(dataUrl, MAX_SHOT_CHARS);
        if (!smaller) {
          setToast("Screenshot too large — try a smaller image.");
          return;
        }
        dataUrl = smaller;
      }
      setShot(dataUrl);
    } catch {
      setToast("Could not read that image.");
    }
  }

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const fullTitle = `[${kind}] ${title.trim()}`;
    const fullBody = body.trim() || "(no description)";
    try {
      const url = await createGitHubIssue(fullTitle, fullBody, shot);
      setToast("Note filed as a GitHub issue");
      await openUrl(url);
      reset();
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const fallback = getGitHubNewIssueUrl(fullTitle, fullBody);
      await openUrl(fallback);
      setToast(
        msg.includes("GITHUB_TOKEN") || msg.includes("not configured")
          ? "Opened GitHub — paste your note there (API token not set yet)."
          : `Opened GitHub form (${msg.slice(0, 80)})`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;

  return (
    <>
      {!open &&
        createPortal(
          <button
            type="button"
            data-notes-fab=""
            aria-label="Leave a note"
            title="Leave a note"
            onClick={() => setOpen(true)}
            className={`fixed left-[max(0.75rem,var(--safe-left))] z-[60] grid size-11 place-items-center rounded-md border border-loom-border bg-loom-surface text-loom-muted shadow-md transition-colors hover:text-loom-text hover:border-loom-accent/50 md:size-9 ${
              viewMode === "chart"
                ? "bottom-[max(11.5rem,calc(var(--safe-bottom)+10.75rem))] md:bottom-[max(2rem,calc(var(--safe-bottom)+0.75rem))]"
                : "bottom-[max(2rem,calc(var(--safe-bottom)+0.75rem))]"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>,
          document.body,
        )}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 loom-overlay animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-label="Leave a note"
            onClick={() => setOpen(false)}
          >
            <div
              className="loom-card w-full max-w-md p-4 sm:p-5 space-y-3 bg-loom-surface border border-loom-border shadow-loom-lg rounded-t-2xl sm:rounded-xl animate-slide-up mb-[var(--safe-bottom)] sm:mb-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-loom-text">Leave a note</h2>
                <button type="button" className="loom-btn-ghost p-1 rounded text-loom-muted" onClick={() => setOpen(false)} aria-label="Close">
                  ×
                </button>
              </div>
              <p className="text-2xs text-loom-muted">
                Files as a GitHub issue on Loom — bugs, UX, ideas, data gaps.
              </p>
              <div className="flex flex-wrap gap-1">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    className={`px-2 py-1 text-2xs rounded border ${
                      kind === k.id
                        ? "border-loom-accent bg-loom-accent/15 text-loom-text"
                        : "border-loom-border text-loom-muted hover:text-loom-text"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                className="loom-input w-full text-xs"
                placeholder="Short title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className="loom-input w-full text-xs min-h-[88px] resize-y"
                placeholder="What happened / what would help…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id="loom-note-shot"
                  onChange={(e) => onUpload(e.target.files?.[0])}
                />
                <label htmlFor="loom-note-shot" className="loom-btn-ghost text-2xs px-2 py-1 rounded border border-loom-border cursor-pointer">
                  {shot ? "Replace screenshot" : "Attach screenshot"}
                </label>
                {shot && (
                  <button type="button" className="text-2xs text-loom-muted hover:text-loom-text" onClick={() => setShot(null)}>
                    Remove
                  </button>
                )}
              </div>
              {shot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot} alt="Screenshot preview" className="max-h-28 rounded border border-loom-border object-contain bg-loom-elevated" />
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="loom-btn-ghost text-xs px-3 py-1.5" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="loom-btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                  disabled={!title.trim() || busy}
                  onClick={() => void submit()}
                >
                  {busy ? "Filing…" : "File note"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
