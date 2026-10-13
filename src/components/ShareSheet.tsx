// =================================================================
// ShareSheet — one-tap "post this chart" flow
// =================================================================
// Phone: full-width bottom sheet. Tablet / desktop: wide stage with
// preview + vertical action rail. PNG is warmed on Share tap
// (sharePreviewCache) so the image is often ready when the sheet opens;
// every image share-out uses that same blob.
// =================================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { getRecommendationReason } from "@/lib/recommendations";
import {
  buildSocialCaption,
  copyTextPromiseToClipboard,
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
import { isDesktop } from "@/lib/tauri";
import { chartLinkFromState, chartLinkSrc, isPortableChartLink } from "@/lib/chartLink";
import { currentChartShareUrl } from "./ChartLinkSync";
import {
  buildShareDataSnapshot,
  chartEncodedColumnNames,
  defaultIncludeShareData,
} from "@/lib/shareLineage";
import { getFocusableElements, trapTabKey } from "@/lib/focusTrap";
import { useShellMode } from "@/lib/useMediaQuery";
import { useKeyboardBottomInset } from "@/lib/useVisualViewport";
import {
  peekSharePreview,
  sharePreviewKeyFromStore,
  warmSharePreview,
} from "@/lib/sharePreviewCache";

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
    sampleRows,
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

  const shellMode = useShellMode();
  const keyboardInset = useKeyboardBottomInset();
  const wide = shellMode !== "phone";
  const split = shellMode === "tablet" || shellMode === "desktop";

  const presetId: SocialPresetId = FORMATS.some((f) => f.id === socialPresetId) ? socialPresetId : "ig-square";
  const preset = getSocialPreset(presetId);
  const chartTitle = activeChart ? (chartTitleOverrides[activeChart.id] ?? activeChart.title) : "";
  const [draftTitle, setDraftTitle] = useState(chartTitle);
  const [blob, setBlob] = useState<Blob | null>(() => {
    const key = sharePreviewKeyFromStore(presetId);
    return key ? peekSharePreview(key) : null;
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(() => {
    const key = sharePreviewKeyFromStore(presetId);
    return !(key && peekSharePreview(key));
  });
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<null | "share" | "link" | "neospace">(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "caption" | "link" | "loom">(null);
  const [includeData, setIncludeData] = useState(() => defaultIncludeShareData(selectedFile));
  const captureSeq = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const nativeShare = useMemo(canShareFiles, []);
  /** Mac/Windows Tauri only — iPad app is not “desktop” for share labels / NeoSpace. */
  const desktopApp = useMemo(isDesktop, []);
  const close = useCallback(() => {
    setShareSheetOpen(false);
    returnFocusRef.current?.focus();
  }, [setShareSheetOpen]);

  useEffect(() => {
    setIncludeData(defaultIncludeShareData(selectedFile));
  }, [selectedFile?.path, selectedFile?.sourceUrl]);

  // Keep headline field aligned with the chart title (overrides / rec changes).
  useEffect(() => {
    setDraftTitle(chartTitle);
  }, [chartTitle]);

  const shareDataPreview = useMemo(() => {
    const chart = chartLinkFromState(useLoomStore.getState());
    const encoded = chartEncodedColumnNames(chart);
    const allCols = sampleRows?.columns ?? [];
    const cols = encoded.length ? encoded.filter((c) => allCols.includes(c)) : allCols;
    const rows = Math.min(sampleRows?.rows.length ?? 0, 2500);
    return { rows, cols: cols.length, columnNames: cols };
  }, [sampleRows, activeChart?.id, selectedFile?.path]);

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

  // Prefer warm cache; otherwise capture (and stash) for this key.
  useEffect(() => {
    if (!activeChart) return;
    const seq = ++captureSeq.current;
    const key = sharePreviewKeyFromStore(presetId);
    const cached = key ? peekSharePreview(key) : null;
    if (cached) {
      setBlob(cached);
      setCapturing(false);
      setFailed(false);
      return;
    }
    setCapturing(true);
    setFailed(false);
    // Keep the prior preview dimmed while the new format renders (don't flash empty).
    setLink(null);
    void (async () => {
      const out = await warmSharePreview(presetId);
      if (seq !== captureSeq.current) return;
      setCapturing(false);
      if (!out) {
        setFailed(true);
        setBlob(null);
        return;
      }
      setBlob(out);
    })();
  }, [activeChart, presetId, chartTitle, exportBurnIn.includeLoomMark, exportBurnIn.includeSource, retry]);

  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const root = panelRef.current;
    const focusables = getFocusableElements(root);
    (focusables[0] ?? root)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (root) trapTabKey(root, e);
    };
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.documentElement.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [close]);

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
      if (desktopApp) {
        const { saveBinaryAndReveal } = await import("@/lib/tauri");
        const path = await saveBinaryAndReveal(blob, filename);
        setToast(path ? "Saved — revealed in Finder" : "Save cancelled");
        return;
      }
      if (nativeShare || typeof navigator.share === "function") {
        // Publish first so LinkedIn/X get an OG image + reopen link — bare PNG
        // files are often dropped by those share targets on iOS.
        const published = await publishStory();
        const storyUrl = published?.url ?? null;
        if (storyUrl) setLink(storyUrl);
        const { shareWithFallback, buildImageShareAttempts } = await import("@/lib/nativeExport");
        const file = new File([blob], filename, { type: "image/png" });
        const outcome = await shareWithFallback(
          buildImageShareAttempts({
            file,
            title: chartTitle,
            caption,
            url: storyUrl,
          }),
        );
        if (outcome === "cancelled") return;
        if (outcome === "shared") {
          setToast(
            storyUrl
              ? "Shared with image + link — LinkedIn/X can unfurl the chart"
              : "Shared image (link publish failed — try Get link)",
          );
          return;
        }
        if (storyUrl && (await copyTextToClipboard(`${caption}\n\n${storyUrl}`.trim()))) {
          downloadBlob(blob, filename);
          setToast("Image saved · story link copied — paste into LinkedIn if the share sheet dropped it");
          return;
        }
      }
      downloadBlob(blob, filename);
      setToast("Image saved");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
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
    const encodedCols = chartEncodedColumnNames(chart);
    const snapshot =
      includeData
        ? buildShareDataSnapshot({
            sample: st.sampleRows,
            file: st.selectedFile,
            stats: st.columnStats,
            chart,
            columns: encodedCols.length ? encodedCols : null,
          })
        : null;
    const { publicLoomWebOrigin } = await import("@/lib/publicOrigin");
    const html = buildChartSharePageHtml({
      title: chartTitle,
      caption,
      imageDataUrl: image,
      sourceLabel: selectedFile?.name,
      appUrl: desktopApp ? null : publicLoomWebOrigin(),
      openUrl: desktopApp ? null : currentChartShareUrl(),
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

  const handleGetLink = () => {
    if (!blob) return;
    setBusy("link");
    const publishedPromise = publishStory();
    const urlPromise = publishedPromise.then((published) => {
      if (!published?.url) {
        throw new Error(published?.error || "publish-failed");
      }
      return published.url;
    });
    const copyPromise = copyTextPromiseToClipboard(urlPromise);
    void (async () => {
      try {
        const published = await publishedPromise;
        if (!published?.url) {
          setToast(
            desktopApp
              ? "Links need the web app — save the image instead"
              : published?.error || "Couldn’t publish right now — share the image instead",
          );
          return;
        }
        setLink(published.url);
        const copiedOk = await copyPromise;
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
    })();
  };

  const NEOSPACE_ORIGIN = "https://neospace.ibm.io";

  const handlePostToNeoSpace = async () => {
    if (!blob || desktopApp) {
      setToast(desktopApp ? "Post to NeoSpace from the web app at loom.ibm.io" : "Render the chart first");
      return;
    }
    setBusy("neospace");
    const child = window.open("about:blank", "neospace_loom_share");
    try {
      const published = await publishStory();
      if (!published?.url) {
        child?.close();
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

      if (child) {
        child.location.href = dest.toString();
      } else {
        window.location.assign(dest.toString());
        close();
        return;
      }

      try {
        const buffer = await blob.arrayBuffer();
        const nsName = `${slugifyFilename(chartTitle || "chart")}.png`;
        const payload = {
          type: "loom-neospace-share" as const,
          v: 1 as const,
          text: body,
          story: storyUrl,
          image: {
            name: nsName,
            type: "image/png",
            buffer,
          },
        };
        const send = () => {
          if (child.closed) return;
          try {
            child.postMessage(payload, NEOSPACE_ORIGIN);
          } catch {
            /* ignore */
          }
        };
        const onReady = (e: MessageEvent) => {
          if (e.source !== child) return;
          if (e.origin !== NEOSPACE_ORIGIN && !String(e.origin).includes("neospace")) return;
          const type = (e.data as { type?: string } | null)?.type;
          if (type === "neospace-loom-ready" || type === "neospace-loom-ack") send();
          if (type === "neospace-loom-ack") {
            window.removeEventListener("message", onReady);
            window.clearInterval(pump);
          }
        };
        window.addEventListener("message", onReady);
        const pump = window.setInterval(send, 400);
        window.setTimeout(() => {
          window.removeEventListener("message", onReady);
          window.clearInterval(pump);
        }, 10_000);
        send();
      } catch {
        /* NeoSpace will fetch /s/{id}.img instead */
      }

      setToast("Opening NeoSpace with chart + lineage…");
      close();
    } finally {
      setBusy(null);
    }
  };

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
    if (typeof navigator.share === "function" && !desktopApp) {
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
  const ready = !!blob && !capturing && !failed;
  const primaryLabel = busy === "share"
    ? "Preparing link…"
    : desktopApp
      ? "Save image…"
      : nativeShare || (typeof navigator !== "undefined" && typeof navigator.share === "function")
        ? "Share image"
        : "Download image";

  const overlayAlign =
    shellMode === "phone" ? "items-end" : "items-center";
  const panelShape =
    shellMode === "phone"
      ? "rounded-t-2xl max-h-[94dvh]"
      : shellMode === "tablet"
        ? "rounded-2xl max-h-[min(92dvh,58rem)] w-full max-w-[min(56rem,calc(100vw-1.25rem))]"
        : "rounded-2xl max-h-[min(90dvh,54rem)] w-full max-w-[min(68rem,calc(100vw-2rem))]";
  const overlayPad =
    shellMode === "phone" ? "p-0" : "p-2 sm:p-3";
  const previewMaxH = shellMode === "phone"
    ? "min(38dvh, 22rem)"
    : shellMode === "tablet"
      ? "min(62dvh, 34rem)"
      : "min(66dvh, 38rem)";
  const canNativeShare =
    nativeShare || (typeof navigator !== "undefined" && typeof navigator.share === "function");

  const formatPicker = (
    <div
      className={split ? "flex flex-col gap-1" : "grid grid-cols-5 gap-1.5"}
      role="radiogroup"
      aria-label="Image format"
      onKeyDown={(e) => {
        const idx = FORMATS.findIndex((f) => f.id === presetId);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          setSocialPresetId(FORMATS[(idx + 1) % FORMATS.length]!.id);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          setSocialPresetId(FORMATS[(idx - 1 + FORMATS.length) % FORMATS.length]!.id);
        }
      }}
    >
      {FORMATS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={presetId === f.id}
          tabIndex={presetId === f.id ? 0 : -1}
          onClick={() => setSocialPresetId(f.id)}
          className={
            split
              ? `min-h-10 w-full rounded-lg border px-3 py-2 flex items-baseline justify-between gap-2 text-left transition-colors ${
                  presetId === f.id
                    ? "border-loom-accent bg-loom-accent/10 text-loom-text"
                    : "border-transparent bg-loom-elevated/40 text-loom-muted hover:text-loom-text hover:border-loom-border"
                }`
              : `min-h-12 rounded-lg border px-1 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  presetId === f.id
                    ? "border-loom-accent bg-loom-accent/10 text-loom-text"
                    : "border-loom-border text-loom-muted hover:text-loom-text"
                }`
          }
        >
          <span className={`font-semibold ${split ? "text-sm" : "text-xs"}`}>{f.label}</span>
          <span className={`leading-tight ${split ? "text-2xs text-loom-muted shrink-0" : "text-2xs text-center opacity-75"}`}>
            {f.hint}
          </span>
        </button>
      ))}
    </div>
  );

  const optionsBlock = (
    <div className="space-y-4">
      <label className="block">
        <span className="text-2xs font-medium text-loom-muted uppercase tracking-wider">Chart title</span>
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="loom-input w-full mt-1.5 text-sm font-medium"
          placeholder="Title on the shared image"
          enterKeyHint="done"
          maxLength={120}
          aria-describedby="share-title-hint"
        />
        <span id="share-title-hint" className="mt-1 block text-2xs text-loom-muted leading-snug">
          Shown on the image and in the post caption. Blur or press Enter to update the preview.
        </span>
      </label>

      {caption ? (
        <div className="rounded-lg border border-loom-border/70 bg-loom-bg/50 px-3 py-2.5">
          <p className="text-2xs font-medium text-loom-muted uppercase tracking-wider mb-1">Caption</p>
          <p className="text-xs text-loom-text whitespace-pre-wrap leading-relaxed line-clamp-4">{caption}</p>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <label className="flex items-start gap-2.5 text-xs text-loom-text min-h-9 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={exportBurnIn.includeLoomMark}
            onChange={(e) =>
              setExportBurnIn((prev) => ({ ...prev, includeLoomMark: e.target.checked }))
            }
          />
          <span>
            “Made with Loom” footer
            <span className="block text-2xs text-loom-muted mt-0.5">Burned into the PNG corner</span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-xs text-loom-text min-h-9 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={includeData}
            disabled={shareDataPreview.rows === 0 || shareDataPreview.cols === 0}
            onChange={(e) => setIncludeData(e.target.checked)}
          />
          <span>
            Include data with public link
            <span className="block text-2xs text-loom-muted mt-0.5 leading-snug">
              {shareDataPreview.rows.toLocaleString()} rows · {shareDataPreview.cols} column
              {shareDataPreview.cols === 1 ? "" : "s"}
              {shareDataPreview.columnNames.length
                ? ` (${shareDataPreview.columnNames.slice(0, 4).join(", ")}${
                    shareDataPreview.columnNames.length > 4 ? "…" : ""
                  })`
                : ""}
              . Anyone on loom.ibm.io can reopen the chart.
            </span>
          </span>
        </label>
      </div>

      {link && (
        <div className="rounded-lg border border-loom-accent/40 bg-loom-accent/5 p-3 space-y-2">
          <p className="text-2xs text-loom-muted leading-snug">
            Public on <span className="text-loom-text/90 font-medium">loom.ibm.io</span> for 7 days
            {includeData ? " · image + data snapshot" : " · image only"}.
          </p>
          <p className="text-xs font-mono text-loom-text break-all select-all">{link}</p>
          <button type="button" onClick={handleShareLink} className="loom-btn-primary w-full min-h-10 text-sm rounded-lg">
            {copied === "link" ? "Link copied" : canNativeShare ? "Share link" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );

  const previewBlock = (
    <div className={`flex flex-col ${split ? "h-full min-h-0" : ""}`}>
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center rounded-xl border border-loom-border/80 bg-loom-bg p-3 sm:p-5"
        style={{
          minHeight: split ? "14rem" : "11rem",
          maxHeight: previewMaxH,
          backgroundImage:
            "linear-gradient(45deg, color-mix(in srgb, var(--loom-border) 28%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--loom-border) 28%, transparent) 75%), linear-gradient(45deg, color-mix(in srgb, var(--loom-border) 28%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--loom-border) 28%, transparent) 75%)",
          backgroundSize: "14px 14px",
          backgroundPosition: "0 0, 7px 7px",
        }}
      >
        <div
          className="relative w-full max-w-full overflow-hidden rounded-lg shadow-loom-md bg-loom-surface mx-auto"
          style={{
            aspectRatio: aspect,
            maxHeight: "100%",
            maxWidth: "100%",
            width: "auto",
            height: "auto",
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${chartTitle || activeChart.title} — ${preset.label} preview`}
              className={`block w-full h-full object-contain transition-opacity ${capturing ? "opacity-45" : ""}`}
            />
          ) : (
            <div className="w-full h-full min-h-[8rem]" style={{ aspectRatio: aspect }} aria-hidden />
          )}
          {capturing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-loom-surface/50" role="status" aria-live="polite">
              <span className="w-6 h-6 rounded-full border-2 border-loom-border border-t-loom-accent animate-spin" aria-hidden />
              <span className="text-2xs text-loom-muted">
                {blob ? "Updating title…" : `Rendering ${preset.width}×${preset.height}…`}
              </span>
            </div>
          )}
          {failed && !capturing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-loom-surface">
              <p className="text-xs text-loom-muted">Couldn’t render this chart.</p>
              <button type="button" onClick={() => setRetry((n) => n + 1)} className="text-xs text-loom-accent min-h-9 px-3">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2.5 px-1 text-center space-y-0.5 shrink-0">
        <p className="text-sm font-semibold text-loom-text truncate" title={chartTitle || undefined}>
          {chartTitle || "Untitled chart"}
        </p>
        <p className="text-2xs text-loom-muted tabular-nums">
          {preset.label} · {preset.width}×{preset.height}
          {selectedFile?.name ? ` · ${selectedFile.name}` : ""}
        </p>
      </div>
    </div>
  );

  const actionsRail = (
    <div className="flex flex-col gap-2" role="group" aria-label="Share actions">
      <button
        type="button"
        onClick={handleShare}
        disabled={!ready || busy !== null}
        className="loom-btn-primary w-full min-h-12 text-sm font-semibold rounded-lg disabled:opacity-50"
        title="Publishes a loom.ibm.io story link, then opens the system share sheet with image + URL"
      >
        {primaryLabel}
      </button>
      {!desktopApp && canNativeShare ? (
        <p className="text-2xs text-loom-muted text-center leading-snug px-0.5 -mt-0.5">
          PNG + public loom.ibm.io link — works for anyone, not just your device.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {nativeShare && !desktopApp ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={!ready}
            className="loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border disabled:opacity-50"
          >
            Save image
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleGetLink}
          disabled={!ready || busy !== null || !!link}
          className={`loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border disabled:opacity-50 ${
            nativeShare && !desktopApp ? "" : "col-span-2"
          }`}
        >
          {busy === "link" ? "Publishing…" : link ? "Link ready" : "Get link"}
        </button>
        <button
          type="button"
          onClick={handleCopyCaption}
          disabled={!caption}
          className="loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border disabled:opacity-50"
        >
          {copied === "caption" ? "Copied" : "Copy caption"}
        </button>
        {!desktopApp ? (
          <button
            type="button"
            onClick={handleCopyLoomLink}
            className="loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border"
            title="Copies a loom.ibm.io link that reopens this chart"
          >
            {copied === "loom" ? "Copied" : "Chart link"}
          </button>
        ) : (
          <button
            type="button"
            onClick={openMoreExports}
            className="loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border text-loom-muted"
          >
            More…
          </button>
        )}
      </div>

      {!desktopApp && (
        <button
          type="button"
          onClick={handlePostToNeoSpace}
          disabled={!ready || busy !== null}
          className="w-full min-h-11 text-sm font-medium rounded-lg border border-loom-border text-loom-text hover:bg-loom-elevated/60 disabled:opacity-50"
          title="Publishes a public chart link for 7 days, then opens NeoSpace"
        >
          {busy === "neospace" ? "Sending to NeoSpace…" : "Post to NeoSpace"}
        </button>
      )}
      <button
        type="button"
        onClick={openMoreExports}
        className="w-full min-h-9 text-2xs text-loom-muted hover:text-loom-accent rounded-lg"
      >
        More export options…
      </button>
    </div>
  );

  return (
    <div
      className={`fixed inset-0 z-[120] flex ${overlayAlign} justify-center loom-overlay animate-fade-in ${overlayPad}`}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-sheet-title"
    >
      <div
        ref={panelRef}
        className={`bg-loom-surface border border-loom-border shadow-loom-lg animate-slide-up flex flex-col min-h-0 ${panelShape} ${wide ? "" : "w-full"}`}
        style={{
          paddingBottom: keyboardInset > 0
            ? `max(0.75rem, var(--safe-bottom), ${keyboardInset}px)`
            : "max(0.75rem, var(--safe-bottom))",
        }}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 shrink-0 border-b border-loom-border/50">
          <div className="flex-1 min-w-0">
            <h2 id="share-sheet-title" className="text-base font-semibold text-loom-text truncate">
              Share
            </h2>
            <p className="text-2xs text-loom-muted truncate mt-0.5" title={chartTitle || undefined}>
              {chartTitle || "Untitled chart"}
            </p>
          </div>
          {ready && (
            <span className="text-2xs text-loom-muted tabular-nums shrink-0 hidden sm:inline">
              {preset.width}×{preset.height}
            </span>
          )}
          <button
            type="button"
            onClick={close}
            className="loom-btn-ghost min-h-10 min-w-10 flex items-center justify-center text-lg rounded-md shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {split ? (
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.2fr)_minmax(16.5rem,0.8fr)] gap-0 overflow-hidden">
            <div className="min-h-0 overflow-hidden flex flex-col px-4 py-3 border-r border-loom-border/50">
              {previewBlock}
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-y-contain flex flex-col gap-4 px-4 py-3">
              <section>
                <p className="text-2xs font-medium text-loom-muted uppercase tracking-wider mb-1.5">Format</p>
                {formatPicker}
              </section>
              <section>
                <p className="text-2xs font-medium text-loom-muted uppercase tracking-wider mb-1.5">Details</p>
                {optionsBlock}
              </section>
              <section className="mt-auto pt-3 border-t border-loom-border/60 sticky bottom-0 bg-loom-surface pb-0.5">
                {actionsRail}
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {previewBlock}
              <section>
                <p className="text-2xs font-medium text-loom-muted uppercase tracking-wider mb-1.5">Format</p>
                {formatPicker}
              </section>
              <section>
                <p className="text-2xs font-medium text-loom-muted uppercase tracking-wider mb-1.5">Details</p>
                {optionsBlock}
              </section>
            </div>
            <div className="px-4 pt-3 shrink-0 border-t border-loom-border/60">
              {actionsRail}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
