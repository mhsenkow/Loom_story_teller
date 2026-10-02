// =================================================================
// ShareSheet — one-tap "post this chart" flow
// =================================================================
// Bottom sheet on phones, dialog on desktop. Renders the chart at a
// social size as soon as it opens (so the native share sheet fires
// inside the tap — iOS drops navigator.share after slow async work),
// then offers Share image / Save / Get link / Copy caption.
// The Export tab keeps the long tail (SVG, carousel, video, CSV…).
// =================================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { getRecommendationReason } from "@/lib/recommendations";
import {
  blobToDataUrl,
  buildSocialCaption,
  copyTextToClipboard,
  getSocialPreset,
  publishStoryToWorker,
  slugifyFilename,
  type SocialPresetId,
} from "@/lib/socialExport";
import { downloadBlob } from "@/lib/zipStore";
import { buildChartSharePageHtml } from "@/lib/dashboardMicrosite";
import { isTauri } from "@/lib/tauri";
import { chartLinkSrc, isPortableChartLink } from "@/lib/chartLink";
import { currentChartShareUrl } from "./ChartLinkSync";

const FORMATS: { id: SocialPresetId; label: string; hint: string }[] = [
  { id: "ig-square", label: "Square", hint: "Feed posts" },
  { id: "ig-portrait", label: "Portrait", hint: "Instagram 4:5" },
  { id: "stories", label: "Story", hint: "Reels · TikTok" },
  { id: "x-landscape", label: "Wide", hint: "X · LinkedIn" },
];

/** Re-encode as JPEG so the published page (image appears 3× in its HTML) stays small. */
async function toJpegDataUrl(blob: Blob, quality = 0.88): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return c.toDataURL("image/jpeg", quality);
  } catch {
    return blobToDataUrl(blob);
  }
}

function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    const probe = new File([new Blob(["x"], { type: "image/png" })], "probe.png", { type: "image/png" });
    return !navigator.canShare || navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function ShareSheet() {
  const open = useLoomStore((s) => s.shareSheetOpen);
  if (!open) return null;
  return <ShareSheetBody />;
}

function ShareSheetBody() {
  const {
    activeChart,
    chartTitleOverrides,
    setChartTitleOverride,
    selectedFile,
    aiSuggestionReason,
    socialPresetId,
    setSocialPresetId,
    exportBurnIn,
    setExportBurnIn,
    setShareSheetOpen,
    setPanelTab,
    panelOpen,
    togglePanel,
    setToast,
  } = useLoomStore();

  const presetId: SocialPresetId = FORMATS.some((f) => f.id === socialPresetId) ? socialPresetId : "ig-square";
  const preset = getSocialPreset(presetId);
  const chartTitle = activeChart ? (chartTitleOverrides[activeChart.id] ?? activeChart.title) : "";
  const [draftTitle, setDraftTitle] = useState(chartTitle);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<null | "share" | "link">(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "caption" | "link" | "loom">(null);
  const captureSeq = useRef(0);
  const nativeShare = useMemo(canShareFiles, []);
  const desktop = useMemo(isTauri, []);
  const creditOn = exportBurnIn.includeSource || exportBurnIn.includeLoomMark;

  const close = useCallback(() => setShareSheetOpen(false), [setShareSheetOpen]);

  const caption = useMemo(() => {
    if (!activeChart) return "";
    return buildSocialCaption({
      title: chartTitle,
      subtitle: activeChart.subtitle,
      reason: aiSuggestionReason ?? getRecommendationReason(activeChart),
      source: selectedFile?.name,
      handle: exportBurnIn.includeHandle ? exportBurnIn.handleText : null,
    });
  }, [activeChart, chartTitle, aiSuggestionReason, selectedFile, exportBurnIn]);

  // Render the chart at the chosen size whenever the format, headline, or credit line changes.
  useEffect(() => {
    if (!activeChart) return;
    const seq = ++captureSeq.current;
    setCapturing(true);
    setFailed(false);
    setLink(null);
    void (async () => {
      const { capturePlatformPng } = await import("@/lib/capturePlatformPng");
      const out = await capturePlatformPng(presetId, { shouldRun: () => seq === captureSeq.current });
      if (seq !== captureSeq.current) return;
      setCapturing(false);
      if (!out) {
        setFailed(true);
        return;
      }
      setBlob(out);
    })();
  }, [activeChart, presetId, chartTitle, creditOn, retry]);

  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Bump the sequence on unmount so a capture finishing late is ignored.
  useEffect(() => () => void captureSeq.current++, []);

  const commitTitle = () => {
    if (!activeChart) return;
    const next = draftTitle.trim();
    if (!next || next === chartTitle) {
      setDraftTitle(chartTitle);
      return;
    }
    setChartTitleOverride(activeChart.id, next === activeChart.title ? null : next);
  };

  const filename = `${slugifyFilename(chartTitle || "chart")}-${preset.id}.png`;

  const handleShare = async () => {
    if (!blob) return;
    setBusy("share");
    try {
      if (desktop) {
        const { saveBinaryAndReveal } = await import("@/lib/tauri");
        const path = await saveBinaryAndReveal(blob, filename);
        setToast(path ? "Saved — revealed in Finder" : "Save cancelled");
        return;
      }
      if (nativeShare) {
        const file = new File([blob], filename, { type: "image/png" });
        await navigator.share({ files: [file], title: chartTitle, text: caption });
        return;
      }
      downloadBlob(blob, filename);
      setToast("Image saved");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      // Activation expired or share target refused — fall back to a download.
      downloadBlob(blob, filename);
      setToast("Image saved");
    } finally {
      setBusy(null);
    }
  };

  const handleSave = () => {
    if (!blob) return;
    downloadBlob(blob, filename);
    setToast("Image saved");
  };

  const handleCopyCaption = async () => {
    if (!caption) return;
    if (await copyTextToClipboard(caption)) {
      setCopied("caption");
      window.setTimeout(() => setCopied(null), 1800);
    } else {
      setToast("Couldn’t reach the clipboard");
    }
  };

  const handleGetLink = async () => {
    if (!blob) return;
    setBusy("link");
    try {
      const image = await toJpegDataUrl(blob);
      const html = buildChartSharePageHtml({
        title: chartTitle,
        caption,
        imageDataUrl: image,
        sourceLabel: selectedFile?.name,
        appUrl: typeof window !== "undefined" && !desktop ? window.location.origin : null,
        openUrl: desktop ? null : currentChartShareUrl(),
      });
      const published = await publishStoryToWorker({ html, title: chartTitle, ogImageDataUrl: image });
      if (!published) {
        setToast(desktop ? "Links need the web app — save the image instead" : "Couldn’t publish right now — share the image instead");
        return;
      }
      setLink(published.url);
    } finally {
      setBusy(null);
    }
  };

  // Loom link (#chart=…): built synchronously from the store so the clipboard
  // write stays inside the tap on iOS.
  const handleCopyLoomLink = async () => {
    const url = currentChartShareUrl();
    if (!url) return;
    if (await copyTextToClipboard(url)) {
      setCopied("loom");
      window.setTimeout(() => setCopied(null), 1800);
      const portable = selectedFile ? isPortableChartLink({ src: chartLinkSrc(selectedFile), url: selectedFile.sourceUrl }) : false;
      setToast(portable ? "Chart link copied — it reopens this exact chart" : "Link copied — recipients need the same file open");
    } else {
      setToast("Couldn’t reach the clipboard");
    }
  };

  const handleShareLink = async () => {
    if (!link) return;
    if (typeof navigator.share === "function" && !desktop) {
      try {
        await navigator.share({ url: link, title: chartTitle, text: chartTitle });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    if (await copyTextToClipboard(link)) {
      setCopied("link");
      window.setTimeout(() => setCopied(null), 1800);
    }
  };

  const openMoreExports = () => {
    close();
    setPanelTab("export");
    if (!panelOpen) togglePanel();
  };

  if (!activeChart) return null;

  const aspect = `${preset.width ?? 1} / ${preset.height ?? 1}`;
  const ready = !!blob && !capturing;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center loom-overlay animate-fade-in"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-sheet-title"
    >
      <div
        className="w-full sm:max-w-md bg-loom-surface border border-loom-border shadow-loom-lg rounded-t-2xl sm:rounded-xl animate-slide-up flex flex-col max-h-[94dvh]"
        style={{ paddingBottom: "max(0.75rem, var(--safe-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
          <h2 id="share-sheet-title" className="text-base font-semibold text-loom-text flex-1">
            Share chart
          </h2>
          <button
            type="button"
            onClick={close}
            className="loom-btn-ghost min-h-10 min-w-10 flex items-center justify-center text-lg rounded-md"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 space-y-3">
          {/* Preview — this exact image is what gets shared */}
          <div className="flex justify-center">
            <div
              className="relative rounded-lg overflow-hidden border border-loom-border bg-loom-bg"
              style={{ aspectRatio: aspect, height: "min(38dvh, 22rem)", maxWidth: "100%" }}
            >
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Share preview"
                  className={`w-full h-full object-contain transition-opacity ${capturing ? "opacity-40" : ""}`}
                />
              )}
              {capturing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" role="status" aria-live="polite">
                  <span className="w-6 h-6 rounded-full border-2 border-loom-border border-t-loom-accent animate-spin" aria-hidden />
                  <span className="text-2xs text-loom-muted">Rendering {preset.width}×{preset.height}…</span>
                </div>
              )}
              {failed && !capturing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-xs text-loom-muted">Couldn’t render this chart.</p>
                  <button type="button" onClick={() => setRetry((n) => n + 1)} className="text-xs text-loom-accent min-h-9 px-3">
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Image format">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={presetId === f.id}
                onClick={() => setSocialPresetId(f.id)}
                className={`min-h-12 rounded-lg border px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  presetId === f.id
                    ? "border-loom-accent bg-loom-accent/10 text-loom-text"
                    : "border-loom-border text-loom-muted hover:text-loom-text"
                }`}
              >
                <span className="text-xs font-semibold">{f.label}</span>
                <span className="text-2xs opacity-75 leading-tight text-center">{f.hint}</span>
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-2xs font-medium text-loom-muted uppercase tracking-wider">Headline</span>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="loom-input w-full mt-1 text-sm"
              enterKeyHint="done"
              maxLength={120}
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-loom-text min-h-9">
            <input
              type="checkbox"
              checked={creditOn}
              onChange={(e) =>
                setExportBurnIn((prev) => ({ ...prev, includeSource: e.target.checked, includeLoomMark: e.target.checked }))
              }
            />
            Credit the data source on the image
          </label>

          {link && (
            <div className="rounded-lg border border-loom-accent/40 bg-loom-accent/5 p-2.5 space-y-2">
              <p className="text-2xs text-loom-muted">Your chart page (live for 7 days)</p>
              <p className="text-xs font-mono text-loom-text break-all">{link}</p>
              <button type="button" onClick={handleShareLink} className="loom-btn-primary w-full min-h-10 text-sm rounded-lg">
                {copied === "link" ? "Link copied" : nativeShare || (typeof navigator !== "undefined" && typeof navigator.share === "function") ? "Share link" : "Copy link"}
              </button>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 space-y-2 shrink-0 border-t border-loom-border/60 mt-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={!ready || busy !== null}
            className="loom-btn-primary w-full min-h-12 text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            {busy === "share" ? "Opening…" : desktop ? "Save image…" : nativeShare ? "Share image" : "Download image"}
          </button>
          <div className="grid grid-cols-3 gap-2">
            {nativeShare && !desktop ? (
              <button type="button" onClick={handleSave} disabled={!ready} className="loom-btn-ghost min-h-11 text-xs rounded-lg border border-loom-border disabled:opacity-50">
                Save
              </button>
            ) : (
              <button type="button" onClick={openMoreExports} className="loom-btn-ghost min-h-11 text-xs rounded-lg border border-loom-border">
                More…
              </button>
            )}
            <button
              type="button"
              onClick={handleGetLink}
              disabled={!ready || busy !== null || !!link}
              className="loom-btn-ghost min-h-11 text-xs rounded-lg border border-loom-border disabled:opacity-50"
            >
              {busy === "link" ? "Publishing…" : link ? "Link ready" : "Get link"}
            </button>
            <button type="button" onClick={handleCopyCaption} disabled={!caption} className="loom-btn-ghost min-h-11 text-xs rounded-lg border border-loom-border disabled:opacity-50">
              {copied === "caption" ? "Copied" : "Caption"}
            </button>
          </div>
          {!desktop && (
            <button
              type="button"
              onClick={handleCopyLoomLink}
              className="w-full min-h-10 text-xs text-loom-text rounded-lg border border-loom-border loom-btn-ghost"
              title="Copies a Loom link that reopens this chart — same data, settings, and look"
            >
              {copied === "loom" ? "Link copied" : "🔗 Copy chart link"}
            </button>
          )}
          {nativeShare && !desktop && (
            <button type="button" onClick={openMoreExports} className="w-full text-2xs text-loom-muted hover:text-loom-accent py-1.5">
              More export options (SVG, video, story pack…)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
