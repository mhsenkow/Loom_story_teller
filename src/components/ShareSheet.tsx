// =================================================================
// ShareSheet — one-tap "post this chart" flow
// =================================================================
// Phone: full-width bottom sheet. Tablet / desktop: wide stage with
// preview + vertical action rail. PNG is warmed on Share tap
// (sharePreviewCache) so the image is often ready when the sheet opens;
// every image share-out uses that same blob.
// =================================================================

"use client";

import { handOffToNeoSpace } from "@/lib/neospaceShare";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { getRecommendationReason } from "@/lib/recommendations";
import {
  blueskyShareHref,
  buildSocialCaption,
  composeStoryImage,
  copyTextToClipboard,
  emailShareHref,
  INSTAGRAM_DIRECT_URL,
  mastodonShareHref,
  normalizeMastodonServer,
  SEENU_URL,
  facebookShareHref,
  linkedInShareHref,
  redditShareHref,
  telegramShareHref,
  whatsappShareHref,
  xShareHref,
  publishStoryToWorker,
  shareHeadline,
  slugifyFilename,
  threadsShareHref,
  toLinkPreviewJpeg,
  type SocialPresetId,
} from "@/lib/socialExport";
import { getThemeUiColors } from "@/lib/chartPalettes";
import { downloadBlob, savedToast } from "@/lib/download";
import { buildChartSharePageHtml } from "@/lib/dashboardMicrosite";
import { isCapacitor, isDesktop, isNativeShell } from "@/lib/tauri";
import { chartLinkFromState } from "@/lib/chartLink";
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

const CURRENT_FRAME: SocialPresetId = "current";
/** Remembered Mastodon server (per device). */
const MASTODON_SERVER_KEY = "loom-mastodon-server";

function readMastodonServer(): string | null {
  try {
    return normalizeMastodonServer(localStorage.getItem(MASTODON_SERVER_KEY) ?? "");
  } catch {
    return null;
  }
}

type InstagramKind = "post" | "story";
/** A platform-sized image waiting for a fresh tap (iOS drops share() after a slow render). */
type PendingImage = { kind: InstagramKind; blob: Blob; name: string; text: string };

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

  const presetId: SocialPresetId = CURRENT_FRAME;
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
  const [busy, setBusy] = useState<null | "share" | "neospace" | "instagram" | "seenu">(null);
  /** After a desktop SeenU handoff: what landed, plus redo buttons. */
  const [seenuHelp, setSeenuHelp] = useState<{ saved: boolean; copied: boolean } | null>(null);
  const [instagramOpen, setInstagramOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [mastodonServer, setMastodonServer] = useState<string | null>(readMastodonServer);
  const [mastodonAsk, setMastodonAsk] = useState(false);
  const [mastodonDraft, setMastodonDraft] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [destinations, setDestinations] = useState(false);
  const [copied, setCopied] = useState<null | "caption" | "link">(null);
  const [includeData, setIncludeData] = useState(() => defaultIncludeShareData(selectedFile));
  const captureSeq = useRef(0);
  /** 1200×627 render for link cards (LinkedIn, X, Slack, iMessage…) — its own memo, not the one-slot preview cache. */
  const linkCardRef = useRef<{ key: string; promise: Promise<Blob | null> } | null>(null);
  /** 4:5 render for photo feeds (SeenU) — warmed once the destinations show so the tap stays a tap. */
  const portraitRef = useRef<{ key: string; promise: Promise<Blob | null> } | null>(null);
  const portraitCapture = useCallback((): Promise<Blob | null> => {
    const key = sharePreviewKeyFromStore("ig-portrait");
    if (!key) return Promise.resolve(null);
    if (portraitRef.current?.key === key) return portraitRef.current.promise;
    const promise = import("@/lib/capturePlatformPng").then(({ capturePlatformPng }) =>
      capturePlatformPng("ig-portrait", { supersample: useLoomStore.getState().exportSupersample === 2 ? 2 : 1 }),
    );
    portraitRef.current = { key, promise };
    return promise;
  }, []);
  // Destinations are showing: render SeenU's 4:5 image next (captures run one at a time).
  useEffect(() => {
    if (destinations) void portraitCapture();
  }, [destinations, portraitCapture]);
  const linkCardCapture = useCallback((): Promise<Blob | null> => {
    const key = sharePreviewKeyFromStore("linkedin-og");
    if (!key) return Promise.resolve(null);
    if (linkCardRef.current?.key === key) return linkCardRef.current.promise;
    const promise = import("@/lib/capturePlatformPng").then(({ capturePlatformPng }) =>
      capturePlatformPng("linkedin-og", { supersample: 1 }),
    );
    linkCardRef.current = { key, promise };
    return promise;
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Mac/Windows Tauri only — iPad app is not “desktop” for share labels / NeoSpace. */
  const desktopApp = useMemo(isDesktop, []);
  const nativeShell = useMemo(isNativeShell, []);
  /** Capacitor has no external-URL opener, so the handoff would strand the user. */
  const neoSpaceAvailable = useMemo(() => !desktopApp && !isCapacitor(), [desktopApp]);
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
    // Keep the prior preview dimmed while this frame is grabbed again.
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
    // Once the visible frame is in, quietly render the link-card size so publishing doesn't wait.
    void linkCardCapture();
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

  const filename = `${slugifyFilename(chartTitle || "chart")}.png`;

  const ensureLink = async () => {
    if (link) return link;
    const published = await publishStory();
    if (published?.url) {
      setLink(published.url);
      return published.url;
    }
    setToast(published?.error || "Couldn’t publish the link — try again");
    return null;
  };

  const handleShare = async () => {
    if (!blob) return;
    setDestinations(true);
    if (link) return;
    setBusy("share");
    try {
      await ensureLink();
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!blob) return;
    const msg = savedToast(await downloadBlob(blob, filename), "Image saved");
    if (msg) setToast(msg);
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
    // Link cards are 1.91:1 — re-render the chart at 1200×627 rather than shrinking
    // a tall frame into the middle of a wide card. Fall back to the visible frame.
    const cardBlob = (await linkCardCapture().catch(() => null)) ?? blob;
    const headline = shareHeadline(chartTitle, selectedFile?.name);
    const image = await toLinkPreviewJpeg(cardBlob, {
      fill,
      title: headline,
      source: selectedFile?.name,
    });
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
      title: headline,
      caption,
      imageDataUrl: image,
      sourceLabel: selectedFile?.name,
      appUrl: publicLoomWebOrigin(),
      openUrl: currentChartShareUrl(),
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
      title: headline,
      ogImageDataUrl: image,
      data: snapshot ?? undefined,
    });
  };

  const handlePostToNeoSpace = async () => {
    if (!blob || desktopApp) {
      setToast(desktopApp ? "Post to NeoSpace from the web app at loom.ibm.io" : "Render the chart first");
      return;
    }
    setBusy("neospace");
    // iOS webviews can't open a second window; the handoff goes to Safari there.
    const child = nativeShell ? null : window.open("about:blank", "neospace_loom_share");
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
      if (!child) close();
      await handOffToNeoSpace(child, {
        storyUrl,
        text: body,
        image: { blob, name: `${slugifyFilename(chartTitle || "chart")}.png` },
      });
      if (!child) return;

      setToast("Opening NeoSpace with chart + lineage…");
      close();
    } finally {
      setBusy(null);
    }
  };

  const handleShareLink = async () => {
    if (!link) return;
    if (typeof navigator.share === "function" && !desktopApp) {
      try {
        await navigator.share({ url: link, title: chartTitle, text: caption || chartTitle });
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

  const openExternal = async (href: string) => {
    const { isTauri, openExternalUrl } = await import("@/lib/tauri");
    if (isTauri()) {
      try {
        await openExternalUrl(href);
        return true;
      } catch {
        return false;
      }
    }
    // iPad WKWebView hands _blank to Safari and often returns null anyway.
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (opened) return true;
    const { isCapacitor } = await import("@/lib/tauri");
    return isCapacitor();
  };

  const openLinkedIn = () => {
    if (!link) return;
    void (async () => {
      const opened = await openExternal(linkedInShareHref(link));
      void copyTextToClipboard(caption);
      setToast(
        opened
          ? "LinkedIn opened — paste the caption above the chart card"
          : "Couldn’t open LinkedIn — caption copied",
      );
    })();
  };

  /** Link-card destinations: open the composer, report whether it opened. */
  const openLinkCard = (name: string, href: string, copyCaption = false) => {
    if (!link) return;
    void (async () => {
      if (copyCaption && caption) await copyTextToClipboard(caption);
      const opened = await openExternal(href);
      setToast(opened ? `${name} opened with the chart card${copyCaption ? " — caption copied" : ""}` : `Couldn’t open ${name}`);
    })();
  };

  const openThreads = () => {
    if (!link) return;
    void (async () => {
      const opened = await openExternal(threadsShareHref(caption, link));
      setToast(opened ? "Threads opened with your caption and link" : "Couldn’t open Threads");
    })();
  };

  const openFacebook = () => {
    if (!link) return;
    void (async () => {
      if (caption) await copyTextToClipboard(caption);
      const opened = await openExternal(facebookShareHref(link));
      setToast(opened ? "Facebook opened — caption copied if you want to paste it" : "Couldn’t open Facebook");
    })();
  };

  const openEmail = () => {
    if (!link) return;
    const body = [caption.trim(), link].filter(Boolean).join("\n\n");
    void (async () => {
      const opened = await openExternal(emailShareHref(chartTitle || "Chart", body));
      setToast(opened ? "Mail opened with the caption and link" : "Couldn’t open Mail");
    })();
  };

  /**
   * Hand an image (plus text) to another app. Phones: the system share sheet,
   * where Instagram / SeenU appear as targets. Desktop app: Finder + clipboard.
   * Elsewhere: save the file, copy the text, open the site.
   * Returns "retry" when the browser refused share() because the tap expired.
   */
  const shareImage = async (
    img: Blob,
    name: string,
    text: string,
    copy: { webUrl: string; desktop: string; saved: string },
  ): Promise<"done" | "retry"> => {
    if (desktopApp) {
      if (text) await copyTextToClipboard(text);
      const { saveBinaryAndReveal, openExternalUrl } = await import("@/lib/tauri");
      const path = await saveBinaryAndReveal(img, name);
      try {
        await openExternalUrl(copy.webUrl);
      } catch {
        /* Finder + clipboard still land the post */
      }
      setToast(path ? copy.desktop : "Text copied — save the image, then add it there");
      return "done";
    }
    const file = new File([img], name, { type: "image/png" });
    if (typeof navigator.share === "function") {
      const data: ShareData = { files: [file], ...(text ? { text } : {}) };
      if (!navigator.canShare || navigator.canShare(data)) {
        try {
          await navigator.share(data);
          return "done";
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return "done";
          if (e instanceof Error && e.name === "NotAllowedError") return "retry";
        }
      }
    }
    const outcome = await downloadBlob(img, name);
    if (outcome === "cancelled") return "done";
    if (text) await copyTextToClipboard(text);
    if (outcome !== "unsupported") void openExternal(copy.webUrl);
    setToast(outcome === "unsupported" ? "Couldn’t save the image on this device" : copy.saved);
    return "done";
  };

  const instagramCopy: Record<InstagramKind, { webUrl: string; desktop: string; saved: string }> = {
    post: {
      webUrl: "https://www.instagram.com/",
      desktop: "4:5 post image in Finder, caption copied — drag it into Instagram",
      saved: "4:5 post image saved and caption copied — add them in Instagram",
    },
    story: {
      webUrl: "https://www.instagram.com/",
      desktop: "9:16 story image in Finder, link copied — Stories post from the Instagram phone app",
      saved: "9:16 story image saved, link copied — add it with Instagram’s link sticker",
    },
  };

  /** Render the chart at Instagram's size for this kind, then hand it off. */
  const openInstagram = async (kind: InstagramKind) => {
    if (busy) return;
    setBusy("instagram");
    try {
      const { capturePlatformPng } = await import("@/lib/capturePlatformPng");
      const st = useLoomStore.getState();
      // Stories reuse the 4:5 render, framed inside the 9:16 safe band so
      // Instagram's top bar and reply field never cover the chart.
      const rendered = await capturePlatformPng("ig-portrait", {
        supersample: st.exportSupersample === 2 ? 2 : 1,
      });
      const img = rendered && kind === "story" ? await composeStoryImage(rendered) : rendered;
      if (!img) {
        setToast("Couldn’t render the Instagram image — try again");
        return;
      }
      const slug = slugifyFilename(chartTitle || "chart");
      const name = `${slug}-instagram-${kind}.png`;
      // Stories can't carry caption text; the link goes on a link sticker instead.
      const text = kind === "post" ? caption.trim() : "";
      if (kind === "story" && link) await copyTextToClipboard(link);
      const result = await shareImage(img, name, text, instagramCopy[kind]);
      if (result === "retry") setPendingImage({ kind, blob: img, name, text });
    } finally {
      setBusy(null);
    }
  };

  const sendPendingImage = async () => {
    const pending = pendingImage;
    if (!pending) return;
    setPendingImage(null);
    await shareImage(pending.blob, pending.name, pending.text, instagramCopy[pending.kind]);
  };

  /** Instagram messages take a link: system sheet on phones, the web inbox elsewhere. */
  const openInstagramMessage = async () => {
    if (!link) return;
    const text = [caption.trim(), link].filter(Boolean).join("\n\n");
    if (typeof navigator.share === "function" && !desktopApp) {
      try {
        await navigator.share({ url: link, text: caption.trim() || chartTitle });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    await copyTextToClipboard(text);
    const opened = await openExternal(INSTAGRAM_DIRECT_URL);
    setToast(opened ? "Instagram messages opened — the caption and link are copied to paste" : "Caption and link copied — paste them in an Instagram message");
  };

  const openBluesky = () => {
    if (!link) return;
    void (async () => {
      const opened = await openExternal(blueskyShareHref(caption, link));
      setToast(opened ? "Bluesky opened with your caption and link" : "Couldn’t open Bluesky");
    })();
  };

  const openMastodonOn = (server: string) => {
    if (!link) return;
    void (async () => {
      const opened = await openExternal(mastodonShareHref(server, caption, link));
      setToast(opened ? `Mastodon opened on ${server}` : `Couldn’t open ${server}`);
    })();
  };

  const openMastodon = () => {
    if (!link) return;
    if (!mastodonServer) {
      setMastodonAsk(true);
      return;
    }
    openMastodonOn(mastodonServer);
  };

  const saveMastodonServer = () => {
    const server = normalizeMastodonServer(mastodonDraft);
    if (!server) {
      setToast("That doesn’t look like a server — try something like mastodon.social");
      return;
    }
    try {
      localStorage.setItem(MASTODON_SERVER_KEY, server);
    } catch {
      /* still works for this share */
    }
    setMastodonServer(server);
    setMastodonAsk(false);
    openMastodonOn(server);
  };

  const seenuText = () => [caption.trim(), link ?? ""].filter(Boolean).join("\n\n");
  const seenuFilename = `${slugifyFilename(chartTitle || "chart")}-seenu.png`;
  const copySeenuText = async () => {
    const ok = await copyTextToClipboard(seenuText());
    setToast(ok ? "Caption and link copied" : "Couldn’t reach the clipboard");
    return ok;
  };
  const saveSeenuImage = async () => {
    const img = (await portraitCapture().catch(() => null)) ?? blob;
    if (!img) return false;
    const outcome = await downloadBlob(img, seenuFilename);
    return outcome !== "unsupported" && outcome !== "cancelled";
  };

  /**
   * SeenU has no web share link (no compose URL or share target), but its apps own
   * every seenu.io link. Phones: the system share sheet hands the 4:5 image and
   * caption to the SeenU app. Desktop web: the macOS / Windows sheet never lists
   * SeenU, so save the image, copy the caption + link, and open SeenU.
   */
  const openSeenU = async () => {
    if (!blob || !link || busy) return;
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    setBusy("seenu");
    try {
      const img = (await portraitCapture().catch(() => null)) ?? blob;
      if (desktopApp || coarse) {
        await shareImage(img, seenuFilename, seenuText(), {
          webUrl: SEENU_URL,
          desktop: "4:5 image in Finder, caption and link copied — post them on SeenU",
          saved: "4:5 image saved, caption and link copied — post them on SeenU",
        });
        if (desktopApp) setSeenuHelp({ saved: true, copied: true });
        return;
      }
      // Clipboard first, while this page still has focus; the new tab takes it.
      const copied = await copyTextToClipboard(seenuText());
      const outcome = await downloadBlob(img, seenuFilename);
      const saved = outcome !== "unsupported" && outcome !== "cancelled";
      setSeenuHelp({ saved, copied });
      const opened = await openExternal(SEENU_URL);
      setToast(opened ? "SeenU opened — attach the image and paste your caption" : "Image and caption ready — open SeenU from the steps below");
    } finally {
      setBusy(null);
    }
  };

  const openMoreExports = () => {
    close();
    setPanelTab("export");
    if (!panelOpen) togglePanel();
  };

  if (!activeChart) return null;

  const ready = !!blob && !capturing && !failed;
  const primaryLabel = busy === "share" ? "Preparing link…" : "Share";

  const overlayAlign =
    shellMode === "phone" ? "items-end" : "items-center";
  const panelShape =
    shellMode === "phone"
      ? "rounded-t-[var(--radius-lg)] max-h-[94dvh]"
      : shellMode === "tablet"
        ? "rounded-[var(--radius-lg)] max-h-[min(92dvh,58rem)] w-full max-w-[min(56rem,calc(100vw-1.25rem))]"
        : "rounded-[var(--radius-lg)] max-h-[min(90dvh,54rem)] w-full max-w-[min(68rem,calc(100vw-2rem))]";
  const overlayPad =
    shellMode === "phone" ? "p-0" : "p-2 sm:p-3";
  const previewMaxH = shellMode === "phone"
    ? "min(38dvh, 22rem)"
    : shellMode === "tablet"
      ? "min(62dvh, 34rem)"
      : "min(66dvh, 38rem)";
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
          On the image and in the caption.
        </span>
      </label>

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
              {shareDataPreview.rows.toLocaleString()} rows · {shareDataPreview.cols} column{shareDataPreview.cols === 1 ? "" : "s"}
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

    </div>
  );

  const previewBlock = (
    <div className={`flex flex-col ${split ? "h-full min-h-0" : ""}`}>
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center rounded-[var(--radius-lg)] bg-loom-bg/80 p-4 sm:p-6"
        style={{
          minHeight: split ? "14rem" : "11rem",
          maxHeight: previewMaxH,
        }}
      >
        <div className="relative max-w-full max-h-full overflow-hidden rounded-[var(--radius-lg)] shadow-loom-md bg-loom-surface">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={chartTitle || activeChart.title}
              className={`block max-w-full object-contain transition-opacity ${capturing ? "opacity-45" : ""}`}
              style={{ maxHeight: previewMaxH }}
            />
          ) : (
            <div className="w-48 h-32" aria-hidden />
          )}
          {capturing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-loom-surface/50" role="status" aria-live="polite">
              <span className="w-6 h-6 rounded-full border-2 border-loom-border border-t-loom-accent animate-spin" aria-hidden />
              <span className="text-2xs text-loom-muted">
                {blob ? "Updating title…" : "Grabbing this chart…"}
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
      {selectedFile?.name || caption ? (
        <div className="mt-2 px-1 flex items-center justify-center gap-3 shrink-0 min-w-0">
          {selectedFile?.name ? (
            <p className="text-2xs text-loom-muted truncate">{selectedFile.name}</p>
          ) : null}
          {caption ? (
            <button
              type="button"
              onClick={handleCopyCaption}
              className="shrink-0 text-2xs text-loom-accent min-h-9 px-1"
            >
              {copied === "caption" ? "Caption copied" : "Copy caption"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const linkReady = Boolean(link) && busy !== "share";
  const destClass =
    "w-full min-h-12 px-4 py-2 text-left hover:bg-loom-elevated/60 disabled:opacity-40 flex flex-col justify-center";
  const dest = ({ label, hint, onClick, disabled, expanded, compact }: { label: string; hint: string; onClick: () => void; disabled?: boolean; expanded?: boolean; compact?: boolean }) => (
    <button key={label} type="button" onClick={onClick} disabled={disabled} className={compact ? destCompactClass : destClass} aria-expanded={expanded}>
      <span className="text-sm text-loom-text flex items-center justify-between gap-2">
        {label}
        {expanded != null ? <span className="text-loom-muted text-xs" aria-hidden>{expanded ? "▾" : "▸"}</span> : null}
      </span>
      <span className="text-2xs text-loom-muted leading-snug">{hint}</span>
    </button>
  );
  const destCompactClass =
    "w-full min-h-11 px-3 py-1.5 text-left hover:bg-loom-elevated/60 disabled:opacity-40 flex flex-col justify-center";
  /** Big tile for the featured networks. */
  const feature = ({ label, hint, onClick, disabled }: { label: string; hint: string; onClick: () => void; disabled?: boolean }) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-16 rounded-[var(--radius-lg)] border border-loom-border bg-loom-elevated/40 px-3 py-2.5 text-left hover:border-loom-accent/60 hover:bg-loom-elevated disabled:opacity-40 flex flex-col justify-center gap-0.5 transition-colors"
    >
      <span className="text-sm font-semibold text-loom-text">{label}</span>
      <span className="text-2xs text-loom-muted leading-snug truncate">{hint}</span>
    </button>
  );
  const chipClass =
    "flex-1 min-h-11 rounded-md border border-loom-border text-xs text-loom-text hover:bg-loom-elevated/60 disabled:opacity-40 flex flex-col items-center justify-center leading-tight";
  const imageVia = desktopApp ? "Saved to Finder" : "Share sheet";

  const destinationList = destinations ? (
    <div role="group" aria-label="Where to share">
      {/* Featured: the open, people-first networks — then LinkedIn — then everywhere else. */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Featured">
        {feature({ label: "Mastodon", hint: mastodonServer ? `On ${mastodonServer}` : "On your server", onClick: openMastodon, disabled: !linkReady })}
        {feature({ label: "SeenU", hint: busy === "seenu" ? "Sizing the image…" : "Image + caption", onClick: () => void openSeenU(), disabled: !ready || !linkReady || busy !== null })}
        {feature({ label: "Bluesky", hint: "Caption + chart card", onClick: openBluesky, disabled: !linkReady })}
      </div>
        {mastodonAsk ? (
          <form
            className="mt-2 px-3 py-2.5 flex gap-2 rounded-[var(--radius-md)] border border-loom-border bg-loom-bg/40"
            onSubmit={(e) => {
              e.preventDefault();
              saveMastodonServer();
            }}
          >
            <label className="sr-only" htmlFor="share-mastodon-server">Your Mastodon server</label>
            <input
              id="share-mastodon-server"
              className="loom-input flex-1 min-w-0 text-sm"
              placeholder="Your server, e.g. mastodon.social"
              value={mastodonDraft}
              onChange={(e) => setMastodonDraft(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
              enterKeyHint="go"
              autoFocus
            />
            <button type="submit" className="loom-btn-primary min-h-10 px-3 text-sm rounded-md">Post</button>
          </form>
        ) : null}
      {seenuHelp ? (
        <div className="mt-2 rounded-[var(--radius-md)] border border-loom-border bg-loom-bg/40 px-3 py-2.5 text-2xs text-loom-muted leading-relaxed" role="status">
          <p className="text-loom-text font-medium mb-1">Finish on SeenU</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>{seenuHelp.saved ? "The 4:5 chart image is in your Downloads." : "Save the chart image (button below)."}</li>
            <li>{seenuHelp.copied ? "Caption and link are copied." : "Copy the caption and link."}</li>
            <li>On SeenU, start a post, attach the image and paste.</li>
          </ol>
          <div className="mt-2 flex gap-3">
            <button type="button" className="text-loom-accent min-h-8" onClick={() => void copySeenuText()}>Copy caption again</button>
            <button type="button" className="text-loom-accent min-h-8" onClick={() => void saveSeenuImage()}>Save image again</button>
            <a className="text-loom-accent min-h-8 inline-flex items-center" href={SEENU_URL} target="_blank" rel="noreferrer">Open SeenU</a>
          </div>
        </div>
      ) : null}
      <div className="mt-2 rounded-[var(--radius-lg)] border border-loom-border overflow-hidden">
        {dest({ label: "LinkedIn", hint: "Chart card · caption copied to paste", onClick: openLinkedIn, disabled: !linkReady })}
      </div>
      <p className="mt-3 mb-1 px-1 text-2xs font-medium uppercase tracking-wider text-loom-muted">More places</p>
      <div className="rounded-[var(--radius-lg)] border border-loom-border overflow-hidden grid grid-cols-2 [&>*]:border-loom-border/70 [&>*]:border-b [&>*:nth-child(odd)]:border-r">
        {dest({ label: "X", hint: "Caption + chart card", onClick: () => link && openLinkCard("X", xShareHref(caption, link)), disabled: !linkReady, compact: true })}
        {dest({ label: "Threads", hint: "Caption + link", onClick: openThreads, disabled: !linkReady, compact: true })}
        {dest({
          label: "Instagram",
          hint: "Post, story or message",
          onClick: () => setInstagramOpen((v) => !v),
          disabled: !ready,
          expanded: instagramOpen,
          compact: true,
        })}
        {dest({ label: "Facebook", hint: "Chart card", onClick: openFacebook, disabled: !linkReady, compact: true })}
        {instagramOpen ? (
          <div className="col-span-2 px-3 py-2.5 space-y-2 bg-loom-bg/40">
            <div className="flex gap-2" role="group" aria-label="Instagram format">
              <button type="button" className={chipClass} disabled={!ready || busy !== null} onClick={() => void openInstagram("post")}>
                <span className="font-medium">Post</span>
                <span className="text-2xs text-loom-muted">4:5 · caption</span>
              </button>
              <button type="button" className={chipClass} disabled={!ready || busy !== null} onClick={() => void openInstagram("story")}>
                <span className="font-medium">Story</span>
                <span className="text-2xs text-loom-muted">9:16 · link sticker</span>
              </button>
              <button type="button" className={chipClass} disabled={!linkReady} onClick={() => void openInstagramMessage()}>
                <span className="font-medium">Message</span>
                <span className="text-2xs text-loom-muted">link + caption</span>
              </button>
            </div>
            {busy === "instagram" ? (
              <p className="text-2xs text-loom-muted" role="status">Sizing the image for Instagram…</p>
            ) : pendingImage ? (
              <button type="button" onClick={() => void sendPendingImage()} className="loom-btn-primary w-full min-h-11 text-sm rounded-md">
                Send {pendingImage.kind === "post" ? "post" : "story"} image to Instagram
              </button>
            ) : (
              <p className="text-2xs text-loom-muted leading-snug">
                {imageVia}{desktopApp ? "" : " → Instagram"}. {desktopApp ? "Stories post from the phone app." : "Pick Feed, Story or Message there."}
              </p>
            )}
          </div>
        ) : null}
        {dest({ label: "Reddit", hint: "Link post + thumbnail", onClick: () => link && openLinkCard("Reddit", redditShareHref(shareHeadline(chartTitle, selectedFile?.name), link), true), disabled: !linkReady, compact: true })}
        {dest({ label: "WhatsApp", hint: "Chat + chart card", onClick: () => link && openLinkCard("WhatsApp", whatsappShareHref(caption, link)), disabled: !linkReady, compact: true })}
        {dest({ label: "Telegram", hint: "Chat + chart card", onClick: () => link && openLinkCard("Telegram", telegramShareHref(caption, link)), disabled: !linkReady, compact: true })}
        {dest({ label: "Email", hint: "Caption + link", onClick: openEmail, disabled: !linkReady, compact: true })}
      </div>
      <p className="mt-2 px-1 text-2xs text-loom-muted">
        {link ? "Same chart. The link carries the picture." : busy === "share" ? "Preparing the link…" : "The picture is ready. The link didn’t publish."}
      </p>
      <div className="flex items-center gap-3 px-1">
        {link ? (
          <button type="button" onClick={handleShareLink} className="text-2xs text-loom-accent min-h-9 text-left">
            {copied === "link" ? "Link copied" : "Copy link"}
          </button>
        ) : busy !== "share" ? (
          <button type="button" onClick={handleShare} className="text-2xs text-loom-accent min-h-9 text-left">
            Try the link again
          </button>
        ) : null}
        {mastodonServer && link ? (
          <button
            type="button"
            onClick={() => {
              setMastodonDraft(mastodonServer);
              setMastodonAsk(true);
            }}
            className="text-2xs text-loom-muted hover:text-loom-text min-h-9 ml-auto"
          >
            Change Mastodon server
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  const actionsRail = (
    <div className="flex flex-col gap-2" role="group" aria-label="Share actions">
      {!destinations ? (
        <button
          type="button"
          onClick={handleShare}
          disabled={!ready || busy !== null}
          className="loom-btn-primary w-full min-h-12 text-sm font-semibold rounded-lg disabled:opacity-50"
        >
          {primaryLabel}
        </button>
      ) : (
        destinationList
      )}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={!ready || busy !== null}
          className="text-2xs text-loom-muted hover:text-loom-text min-h-9 disabled:opacity-50"
        >
          Save image
        </button>
        {neoSpaceAvailable ? (
          <button
            type="button"
            onClick={handlePostToNeoSpace}
            disabled={!ready || busy !== null}
            className="text-2xs text-loom-muted hover:text-loom-text min-h-9 disabled:opacity-50"
          >
            {busy === "neospace" ? "Sending…" : "NeoSpace"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={openMoreExports}
          className="text-2xs text-loom-muted hover:text-loom-accent min-h-9"
        >
          Other sizes…
        </button>
      </div>
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
            {/* Options keep their height; the (long) destination list scrolls in the space left. */}
            <div className="min-h-0 overflow-hidden flex flex-col gap-4 px-4 py-3">
              <section className="shrink-0">
                {optionsBlock}
              </section>
              <section className="mt-auto min-h-0 flex flex-col pt-3 border-t border-loom-border/60">
                <div className="min-h-0 overflow-y-auto overscroll-contain pb-0.5 -mr-2 pr-2">
                  {actionsRail}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {previewBlock}
              <section>
                {optionsBlock}
              </section>
            </div>
            {/* The destination list can be long: cap it so the preview stays visible above. */}
            <div className="px-4 pt-3 shrink-0 border-t border-loom-border/60 max-h-[58dvh] overflow-y-auto overscroll-contain">
              {actionsRail}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
