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
  buildSocialCaption,
  copyTextToClipboard,
  getSocialPreset,
  publishStoryToWorker,
  slugifyFilename,
  toLinkPreviewJpeg,
  type SocialPresetId,
} from "@/lib/socialExport";
import { getThemeUiColors } from "@/lib/chartPalettes";
import { downloadBlob } from "@/lib/zipStore";
import { buildChartSharePageHtml } from "@/lib/dashboardMicrosite";
import { isTauri } from "@/lib/tauri";
import { chartLinkFromState, chartLinkSrc, isPortableChartLink } from "@/lib/chartLink";
import { currentChartShareUrl } from "./ChartLinkSync";
import { buildShareDataSnapshot } from "@/lib/shareLineage";

const FORMATS: { id: SocialPresetId; label: string; hint: string }[] = [
  { id: "ig-square", label: "Square", hint: "Feed posts" },
  { id: "ig-portrait", label: "Portrait", hint: "Instagram 4:5" },
  { id: "stories", label: "Story", hint: "Reels · TikTok" },
  { id: "x-landscape", label: "Wide", hint: "X · LinkedIn" },
  { id: "linkedin-og", label: "Link", hint: "1.91:1 preview" },
];

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
  const [busy, setBusy] = useState<null | "share" | "link" | "neospace">(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "caption" | "link" | "loom">(null);
  const captureSeq = useRef(0);
  const nativeShare = useMemo(canShareFiles, []);
  const desktop = useMemo(isTauri, []);
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
  }, [activeChart, presetId, chartTitle, exportBurnIn.includeLoomMark, exportBurnIn.includeSource, retry]);

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

  const publishStory = async () => {
    if (!blob) return null;
    const st = useLoomStore.getState();
    const fill = getThemeUiColors(st.appSettings.theme).bg;
    // Letterbox into 1200×627 so Slack / iMessage / LinkedIn unfurls stay sharp.
    const image = await toLinkPreviewJpeg(blob, { fill, quality: 0.9 });
    const chart = chartLinkFromState(st);
    const snapshot = buildShareDataSnapshot({
      sample: st.sampleRows,
      file: st.selectedFile,
      stats: st.columnStats,
      chart,
    });
    const html = buildChartSharePageHtml({
      title: chartTitle,
      caption,
      imageDataUrl: image,
      sourceLabel: selectedFile?.name,
      appUrl: typeof window !== "undefined" && !desktop ? window.location.origin : null,
      openUrl: desktop ? null : currentChartShareUrl(),
      lineage: snapshot
        ? {
            capturedAt: snapshot.capturedAt,
            rowCount: snapshot.rows.length,
            totalRows: snapshot.totalRows,
            truncated: snapshot.truncated,
            columns: snapshot.columns,
          }
        : null,
    });
    return publishStoryToWorker({
      html,
      title: chartTitle,
      ogImageDataUrl: image,
      data: snapshot ?? undefined,
    });
  };

  const handleGetLink = async () => {
    if (!blob) return;
    setBusy("link");
    try {
      const published = await publishStory();
      if (!published?.url) {
        setToast(
          desktop
            ? "Links need the web app — save the image instead"
            : published?.error || "Couldn’t publish right now — share the image instead",
        );
        return;
      }
      setLink(published.url);
      const copiedOk = await copyTextToClipboard(published.url);
      setCopied(copiedOk ? "link" : null);
      if (copiedOk) window.setTimeout(() => setCopied(null), 2200);
      setToast(
        published.hasData
          ? copiedOk
            ? "Link copied — image + data snapshot (7 days)"
            : "Link ready — image + data snapshot (7 days)"
          : copiedOk
            ? "Link copied — chart image (7 days)"
            : "Link ready — chart image (7 days)",
      );
    } finally {
      setBusy(null);
    }
  };

  const NEOSPACE_ORIGIN = "https://neospace.ibm.io";

  /**
   * One tap: publish chart to Loom KV (`/s/{id}.img` JPEG), then open NeoSpace
   * with the story URL. NeoSpace fetches the hosted JPEG over HTTPS — postMessage
   * of the sheet PNG is best-effort only.
   */
  const handlePostToNeoSpace = async () => {
    if (!blob || desktop) {
      setToast(desktop ? "Post to NeoSpace from the web app at loom.ibm.io" : "Render the chart first");
      return;
    }
    setBusy("neospace");
    try {
      const published = await publishStory();
      if (!published?.url) {
        setToast(published?.error || "Couldn’t publish the chart image — try again in a moment");
        return;
      }
      setLink(published.url);
      const storyUrl = published.url;
      const body = [caption.trim(), `\n${storyUrl}`].join("").trim();
      const dest = new URL(NEOSPACE_ORIGIN);
      dest.searchParams.set("compose", "loom");
      dest.searchParams.set("story", storyUrl);
      dest.searchParams.set("text", body);

      const child = window.open(dest.toString(), "neospace_loom_share");
      if (!child) {
        window.location.assign(dest.toString());
        close();
        return;
      }

      // Best-effort: send the preview PNG; NeoSpace can also fetch /s/{id}.img (JPEG).
      try {
        const buffer = await blob.arrayBuffer();
        const filename = `${slugifyFilename(chartTitle || "chart")}.png`;
        const send = () => {
          if (child.closed) return;
          try {
            child.postMessage(
              {
                type: "loom-neospace-share",
                v: 1,
                text: body,
                story: storyUrl,
                image: {
                  name: filename,
                  type: "image/png",
                  buffer,
                },
              },
              NEOSPACE_ORIGIN,
            );
          } catch {
            /* ignore */
          }
        };
        send();
        window.setTimeout(send, 800);
        window.setTimeout(send, 1800);
      } catch {
        /* NeoSpace will fetch /s/{id}.img instead */
      }

      setToast("Opening NeoSpace with chart + lineage…");
      close();
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
              checked={exportBurnIn.includeLoomMark}
              onChange={(e) =>
                setExportBurnIn((prev) => ({ ...prev, includeLoomMark: e.target.checked }))
              }
            />
            “Made with Loom” footer
            <span className="text-2xs text-loom-muted">(source note is Chart → Visual → Footnote)</span>
          </label>

          {link && (
            <div className="rounded-lg border border-loom-accent/40 bg-loom-accent/5 p-2.5 space-y-2">
              <p className="text-2xs text-loom-muted">
                Public for 7 days — anyone with the link can open the chart image and data lineage.
              </p>
              <p className="text-xs font-mono text-loom-text break-all">{link}</p>
              <button type="button" onClick={handleShareLink} className="loom-btn-primary w-full min-h-10 text-sm rounded-lg">
                {copied === "link" ? "Link copied" : nativeShare || (typeof navigator !== "undefined" && typeof navigator.share === "function") ? "Share link" : "Copy link"}
              </button>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 space-y-2 shrink-0 border-t border-loom-border/60 mt-3">
          {!desktop && (
            <>
              <button
                type="button"
                onClick={handlePostToNeoSpace}
                disabled={!ready || busy !== null}
                className="w-full min-h-12 text-sm font-semibold rounded-lg border border-loom-accent/50 bg-loom-accent/15 text-loom-text hover:bg-loom-accent/25 disabled:opacity-50"
                title="Publishes a public chart link (image + data lineage, 7 days), then opens NeoSpace ready to post"
              >
                {busy === "neospace" ? "Sending to NeoSpace…" : "Post to NeoSpace"}
              </button>
              <p className="text-2xs text-loom-muted text-center leading-snug px-1">
                Publishes a <strong className="font-medium text-loom-text/80">public</strong> link
                for 7 days (chart image + data lineage). Don’t share private or PII datasets.
              </p>
            </>
          )}
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
