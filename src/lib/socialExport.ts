// =================================================================
// Social media export — platform presets, captions, share, burn-in
// =================================================================
// Pixel targets for IG / Stories / X / LinkedIn / OG, caption seeds,
// attribution burn-in on PNG composites, Web Share helpers, and
// short vertical video via MediaRecorder (Canvas-only).
// =================================================================

import type { ChartAspectId } from "./chartViewport";
import { downloadBlob } from "./download";
import { buildZip } from "./zipStore";
import { truncateTextToWidth } from "./captureHelpers";

export type SocialPresetId =
  | "current"
  | "ig-square"
  | "ig-portrait"
  | "stories"
  | "x-landscape"
  | "linkedin-og"
  | "youtube-thumb";

export interface SocialPreset {
  id: SocialPresetId;
  label: string;
  blurb: string;
  /** null = use on-screen stage size */
  width: number | null;
  height: number | null;
  aspectId: ChartAspectId | null;
  /** Show Stories/Reels safe-zone guides when framing */
  safeZones?: boolean;
}

export const SOCIAL_PRESETS: SocialPreset[] = [
  {
    id: "current",
    label: "Current frame",
    blurb: "Whatever size the chart stage is now",
    width: null,
    height: null,
    aspectId: null,
  },
  {
    id: "ig-square",
    label: "Instagram Square",
    blurb: "1080×1080 feed",
    width: 1080,
    height: 1080,
    aspectId: "square",
  },
  {
    id: "ig-portrait",
    label: "Instagram Portrait",
    blurb: "1080×1350 feed",
    width: 1080,
    height: 1350,
    aspectId: "4:5",
  },
  {
    id: "stories",
    label: "Stories / Reels / TikTok",
    blurb: "1080×1920 vertical",
    width: 1080,
    height: 1920,
    aspectId: "9:16",
    safeZones: true,
  },
  {
    id: "x-landscape",
    label: "X / Twitter",
    blurb: "1200×675 post image",
    width: 1200,
    height: 675,
    aspectId: "16:9",
  },
  {
    id: "linkedin-og",
    label: "LinkedIn / Open Graph",
    blurb: "1200×627 link preview",
    width: 1200,
    height: 627,
    aspectId: "1.91:1",
  },
  {
    id: "youtube-thumb",
    label: "YouTube thumb",
    blurb: "1280×720",
    width: 1280,
    height: 720,
    aspectId: "16:9",
  },
];

export function getSocialPreset(id: SocialPresetId): SocialPreset {
  return SOCIAL_PRESETS.find((p) => p.id === id) ?? SOCIAL_PRESETS[0]!;
}

/** Forced stage size while capturing a platform preset (CSS pixels). */
export interface SocialExportTarget {
  width: number;
  height: number;
  /** Backing-store scale during capture (layout scale × supersample). */
  pixelRatio: number;
  presetId: SocialPresetId;
}

export interface ExportBurnInOptions {
  /** Title is already drawn on-canvas; keep for caption / footer parity */
  includeTitle: boolean;
  includeSubtitle: boolean;
  includeSource: boolean;
  includeTimestamp: boolean;
  includeHandle: boolean;
  handleText: string;
  includeLoomMark: boolean;
}

export const DEFAULT_BURN_IN: ExportBurnInOptions = {
  includeTitle: true,
  includeSubtitle: true,
  includeSource: true,
  includeTimestamp: false,
  includeHandle: false,
  handleText: "",
  includeLoomMark: true,
};

export interface CaptionInput {
  title: string;
  subtitle?: string | null;
  reason?: string | null;
  source?: string | null;
  handle?: string | null;
}

/** Threads rejects posts longer than 500 characters. */
export const THREADS_TEXT_MAX = 500;
/** Bluesky posts are capped at 300 characters (graphemes). */
export const BLUESKY_TEXT_MAX = 300;
/** Mastodon's default instance limit. */
export const MASTODON_TEXT_MAX = 500;

/**
 * Caption plus the public URL, clipped to `max` characters. The link always
 * survives; the caption is shortened with an ellipsis to make room.
 */
export function clipPostText(caption: string, pageUrl: string, max: number): string {
  const link = pageUrl.trim();
  const body = caption.trim();
  if (!link) return [...body].slice(0, max).join("");
  const joiner = body ? "\n\n" : "";
  const room = max - link.length - joiner.length;
  if (room < 1) return link.slice(0, max);
  const chars = [...body];
  const clipped = chars.length <= room ? body : `${chars.slice(0, room - 1).join("").trimEnd()}…`;
  return clipped ? `${clipped}${joiner}${link}` : link;
}

/** Caption plus the public URL, clipped so a Threads intent stays valid. */
export function threadsPostText(caption: string, pageUrl: string): string {
  return clipPostText(caption, pageUrl, THREADS_TEXT_MAX);
}

/** Bluesky web intent: opens the composer (app or web) with text prefilled. */
export function blueskyShareHref(caption: string, pageUrl: string): string {
  return `https://bsky.app/intent/compose?text=${encodeURIComponent(clipPostText(caption, pageUrl, BLUESKY_TEXT_MAX))}`;
}

/**
 * Normalize what someone types as their Mastodon server: "mastodon.social",
 * "https://hachyderm.io/home", "@me@fosstodon.org" → bare host, or null.
 */
export function normalizeMastodonServer(input: string): string | null {
  let v = input.trim().toLowerCase();
  if (!v) return null;
  const handle = v.match(/^@?[^@\s]+@([^@\s/]+)$/);
  if (handle) v = handle[1]!;
  v = v.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0]!.replace(/:\d+$/, "");
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) ? v : null;
}

/** Mastodon's built-in share endpoint on the person's own server. */
export function mastodonShareHref(server: string, caption: string, pageUrl: string): string {
  return `https://${server}/share?text=${encodeURIComponent(clipPostText(caption, pageUrl, MASTODON_TEXT_MAX))}`;
}

/** SeenU has no share intent; the post starts from its home page. */
export const SEENU_URL = "https://seenu.io/";

/** Instagram's web inbox — messages there accept a pasted link. */
export const INSTAGRAM_DIRECT_URL = "https://www.instagram.com/direct/inbox/";

/**
 * Instagram Stories cover roughly the top 250px (profile, progress bar) and the
 * bottom 340px (reply bar, stickers) of a 1080×1920 frame.
 */
export const STORY_SIZE = { width: 1080, height: 1920 } as const;
export const STORY_SAFE = { top: 250, bottom: 340, side: 48 } as const;

/** Where a w×h chart image lands inside the story's safe band (scaled to fit, centered). */
export function storySafeRect(w: number, h: number): { x: number; y: number; width: number; height: number } {
  const availW = STORY_SIZE.width - 2 * STORY_SAFE.side;
  const availH = STORY_SIZE.height - STORY_SAFE.top - STORY_SAFE.bottom;
  const scale = Math.min(availW / w, availH / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return {
    x: Math.round((STORY_SIZE.width - width) / 2),
    y: STORY_SAFE.top + Math.round((availH - height) / 2),
    width,
    height,
  };
}

/**
 * Place a chart PNG (best: the 4:5 post render) inside a 1080×1920 story frame,
 * clear of Instagram's overlays, on the chart's own background color.
 */
export async function composeStoryImage(chart: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(chart);
    const canvas = document.createElement("canvas");
    canvas.width = STORY_SIZE.width;
    canvas.height = STORY_SIZE.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Sample the chart's corner so the frame reads as one surface.
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const pctx = probe.getContext("2d");
    pctx?.drawImage(bitmap, 2, 2, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = pctx ? pctx.getImageData(0, 0, 1, 1).data : [16, 16, 18];
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rect = storySafeRect(bitmap.width, bitmap.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    bitmap.close?.();
    return await new Promise((resolve) => canvas.toBlob((out) => resolve(out), "image/png"));
  } catch {
    return null;
  }
}

/**
 * LinkedIn's share-offsite composer only accepts the URL. The chart card
 * comes from og:image on that page; prefilled summary text is ignored.
 */
export function linkedInShareHref(pageUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl.trim())}`;
}

/** Threads web intent. Text carries the caption and the reopen link. */
export function threadsShareHref(caption: string, pageUrl: string): string {
  return `https://www.threads.net/intent/post?text=${encodeURIComponent(threadsPostText(caption, pageUrl))}`;
}

/** Facebook's sharer only takes the page URL; the card comes from Open Graph. */
export function facebookShareHref(pageUrl: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl.trim())}`;
}

/** Mail app compose with the caption and the public chart link. */
export function emailShareHref(subject: string, body: string): string {
  const params = new URLSearchParams();
  const title = subject.trim();
  const text = body.trim();
  if (title) params.set("subject", title);
  if (text) params.set("body", text);
  const q = params.toString();
  return q ? `mailto:?${q}` : "mailto:";
}

/** Short post caption ready to paste under a social image. */
export function buildSocialCaption(input: CaptionInput): string {
  const lines: string[] = [];
  const title = input.title.trim();
  if (title) lines.push(title);
  const sub = input.subtitle?.trim();
  if (sub && sub !== title) lines.push(sub);
  const reason = input.reason?.trim();
  if (reason) lines.push(reason);
  const meta: string[] = [];
  if (input.source?.trim()) meta.push(`Source: ${input.source.trim()}`);
  if (input.handle?.trim()) meta.push(input.handle.trim());
  if (meta.length) lines.push(meta.join(" · "));
  return lines.join("\n");
}

/**
 * Draw attribution footer onto an already-composited export canvas.
 * Title/subtitle stay on the chart layers; this adds source / handle / mark.
 */
export function drawExportBurnIn(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    burnIn: ExportBurnInOptions;
    sourceLabel?: string | null;
    themeText?: string;
    themeMuted?: string;
    themeBg?: string;
  },
): void {
  const { burnIn } = opts;
  const parts: string[] = [];
  if (burnIn.includeSource && opts.sourceLabel?.trim()) {
    parts.push(opts.sourceLabel.trim());
  }
  if (burnIn.includeTimestamp) {
    parts.push(
      new Date().toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
  }
  if (burnIn.includeHandle && burnIn.handleText.trim()) {
    parts.push(burnIn.handleText.trim());
  }
  if (burnIn.includeLoomMark) {
    parts.push("Made with Loom");
  }
  if (parts.length === 0) return;

  const pad = Math.max(12, Math.round(Math.min(w, h) * 0.02));
  const fontSize = Math.max(11, Math.round(Math.min(w, h) * 0.018));
  const line = parts.join("  ·  ");
  const barH = fontSize + pad;

  ctx.save();
  const bg = opts.themeBg ?? "#0a0a0c";
  ctx.fillStyle = bg.length === 7 ? `${bg}cc` : "rgba(10,10,12,0.8)";
  // Prefer semi-transparent bar if we can parse hex
  if (/^#[0-9a-fA-F]{6}$/.test(bg)) {
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r},${g},${b},0.82)`;
  }
  ctx.fillRect(0, h - barH - pad * 0.5, w, barH + pad * 0.5);
  ctx.fillStyle = opts.themeMuted ?? "#6b6b78";
  ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fitted = truncateTextToWidth(ctx, line, w - pad * 2);
  ctx.fillText(fitted, w / 2, h - (barH + pad * 0.5) / 2);
  ctx.restore();
}

/** Safe-zone insets for 9:16 Stories UI chrome (fractions of height). */
export const STORIES_SAFE_ZONE = {
  top: 0.14,
  bottom: 0.2,
} as const;

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export async function shareOrDownloadFile(
  blob: Blob,
  filename: string,
  title = "Loom chart",
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (
    nav &&
    typeof nav.share === "function" &&
    (!nav.canShare || nav.canShare({ files: [file] }))
  ) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      // User cancel → don't fall through to download noise
      if (e instanceof Error && e.name === "AbortError") throw e;
    }
  }
  const saved = await downloadBlob(blob, filename);
  if (saved === "cancelled") throw new DOMException("Share cancelled", "AbortError");
  // Callers toast success on return — don't claim a save that never happened.
  if (saved === "unsupported") throw new Error("Couldn’t save the file on this device");
  return saved === "shared" ? "shared" : "downloaded";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to execCommand */
    }
  }
  return copyTextWithExecCommand(text);
}

/**
 * Start a clipboard write inside a user gesture with a deferred text promise
 * (iOS Safari drops activation after awaited network work — LOOM-413).
 */
export function copyTextPromiseToClipboard(textPromise: Promise<string>): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof ClipboardItem === "undefined") {
    return textPromise.then((t) => copyTextToClipboard(t)).catch(() => false);
  }
  const write = navigator.clipboard?.write;
  if (!write) {
    return textPromise.then((t) => copyTextToClipboard(t)).catch(() => false);
  }
  try {
    const blobPromise = textPromise.then((t) => new Blob([t], { type: "text/plain" }));
    void Promise.resolve(write.call(navigator.clipboard, [new ClipboardItem({ "text/plain": blobPromise })])).catch(
      () => undefined,
    );
    return blobPromise.then(() => true).catch(() =>
      textPromise.then((t) => copyTextToClipboard(t)).catch(() => false),
    );
  } catch {
    return textPromise.then((t) => copyTextToClipboard(t)).catch(() => false);
  }
}

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function slugifyFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "loom-export";
  const safe = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return (safe || "loom-export").slice(0, 80);
}

export async function buildCarouselZip(
  slides: { filename: string; blob: Blob }[],
  extras?: { name: string; text: string }[],
): Promise<Blob> {
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const slide of slides) {
    const buf = new Uint8Array(await slide.blob.arrayBuffer());
    entries.push({ name: slide.filename, data: buf });
  }
  if (extras) {
    const enc = new TextEncoder();
    for (const ex of extras) {
      entries.push({ name: ex.name, data: enc.encode(ex.text) });
    }
  }
  const zip = buildZip(entries);
  const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
  return new Blob([ab], { type: "application/zip" });
}

/**
 * Record a short vertical (or preset-sized) clip from a canvas stream.
 * Caller must keep painting frames while recording.
 */
export async function recordCanvasVideo(
  canvas: HTMLCanvasElement,
  opts: {
    durationMs?: number;
    fps?: number;
    mimeType?: string;
  } = {},
): Promise<Blob | null> {
  const durationMs = opts.durationMs ?? 6000;
  const fps = opts.fps ?? 30;
  const mimeCandidates = [
    opts.mimeType,
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ].filter(Boolean) as string[];

  let mimeType = "";
  for (const m of mimeCandidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      mimeType = m;
      break;
    }
  }
  if (!mimeType || typeof canvas.captureStream !== "function") return null;

  const stream = canvas.captureStream(fps);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });

  return new Promise((resolve) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => resolve(null);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.start(200);
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationMs);
  });
}

/** Open Graph / link-preview canvas size (≈1.91:1). */
export const LINK_PREVIEW_SIZE = { width: 1200, height: 627 } as const;

/**
 * Place the real chart on a 1200×627 JPEG for link unfurls.
 * Landscape charts fill the card. A square or tall chart keeps its pixels
 * and gains a title band so the wide card does not look empty.
 */
export async function toLinkPreviewJpeg(
  blob: Blob,
  opts?: { quality?: number; fill?: string; title?: string; source?: string },
): Promise<string> {
  const quality = opts?.quality ?? 0.92;
  const fill = opts?.fill ?? "#0a0a0c";
  const { width: W, height: H } = LINK_PREVIEW_SIZE;
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    const matte = sampleEdgeColor(bmp) ?? fill;
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, W, H);
    const contain = Math.min(W / bmp.width, H / bmp.height);
    const dw0 = bmp.width * contain;
    const dh0 = bmp.height * contain;
    const coverage = (dw0 * dh0) / (W * H);
    const title = (opts?.title || "").trim();
    const source = (opts?.source || "").trim();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (coverage < 0.78 && (title || source)) {
      paintLinkPlate(ctx, bmp, W, H, matte, title, source);
    } else {
      ctx.drawImage(bmp, (W - dw0) / 2, (H - dh0) / 2, dw0, dh0);
    }
    bmp.close();
    return c.toDataURL("image/jpeg", quality);
  } catch {
    return blobToDataUrl(blob);
  }
}

function sampleEdgeColor(bmp: ImageBitmap): string | null {
  try {
    const n = 4;
    const c = document.createElement("canvas");
    c.width = n;
    c.height = n;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const corners: Array<[number, number]> = [
      [0, 0],
      [Math.max(0, bmp.width - n), 0],
      [0, Math.max(0, bmp.height - n)],
      [Math.max(0, bmp.width - n), Math.max(0, bmp.height - n)],
    ];
    for (const [sx, sy] of corners) {
      ctx.clearRect(0, 0, n, n);
      ctx.drawImage(bmp, sx, sy, n, n, 0, 0, n, n);
      const data = ctx.getImageData(0, 0, n, n).data;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
        count += 1;
      }
    }
    if (!count) return null;
    return `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
  } catch {
    return null;
  }
}

function parseRgb(input: string): [number, number, number] | null {
  const hex = input.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = input.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

function paintLinkPlate(
  ctx: CanvasRenderingContext2D,
  bmp: ImageBitmap,
  W: number,
  H: number,
  matte: string,
  title: string,
  source: string,
): void {
  const rgb = parseRgb(matte) ?? [10, 10, 12];
  const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const ink = luma > 0.62 ? "#16161a" : "#f5f5f7";
  const quiet = luma > 0.62 ? "rgba(22, 22, 26, 0.55)" : "rgba(245, 245, 247, 0.62)";
  const hair = luma > 0.62 ? "rgba(22, 22, 26, 0.12)" : "rgba(245, 245, 247, 0.16)";
  const side = 32;
  const header = title ? 72 : 20;
  const footer = source ? 40 : 20;
  const availW = W - side * 2;
  const availH = H - header - footer;
  const scale = Math.min(availW / bmp.width, availH / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  const x = (W - dw) / 2;
  const y = header + (availH - dh) / 2;
  ctx.drawImage(bmp, x, y, dw, dh);
  ctx.strokeStyle = hair;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, dw - 1), Math.max(0, dh - 1));

  ctx.textBaseline = "middle";
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  const mark = "LOOM";
  const markW = ctx.measureText(mark).width;
  if (title) {
    ctx.fillStyle = ink;
    ctx.font = "600 30px ui-sans-serif, system-ui, sans-serif";
    const label = truncateTextToWidth(ctx, title, availW - markW - 24);
    ctx.fillText(label, side, 38);
    ctx.fillStyle = quiet;
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(mark, W - side - markW, 38);
  }
  if (source) {
    ctx.fillStyle = quiet;
    ctx.font = "500 15px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(truncateTextToWidth(ctx, source, availW), side, H - 22);
  }
}

export type PublishStoryResult = {
  url: string;
  id: string;
  hasData?: boolean;
  error?: string;
};

/** Publish HTML story to Loom Worker; returns public URL or an error message. */
export async function publishStoryToWorker(input: {
  html: string;
  title: string;
  ogImageDataUrl?: string | null;
  /** Optional data lineage companion (capped JSON) stored at `/s/{id}.data`. */
  data?: unknown;
}): Promise<PublishStoryResult | null> {
  try {
    const { apiUrl } = await import("./openDataCatalog");
    const res = await fetch(apiUrl("/api/stories"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: input.html,
        title: input.title,
        ogImage: input.ogImageDataUrl ?? undefined,
        data: input.data ?? undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      id?: string;
      hasData?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return { url: "", id: "", error: data.error || `Publish failed (${res.status})` };
    }
    if (!data.url || !data.id) {
      return { url: "", id: "", error: data.error || "Publish returned no URL" };
    }
    const { toPublicLoomUrl } = await import("./publicOrigin");
    // Never hand recipients a workers.dev / localhost URL (Cap API host).
    return { url: toPublicLoomUrl(data.url), id: data.id, hasData: !!data.hasData };
  } catch {
    return { url: "", id: "", error: "Couldn’t reach the publish service" };
  }
}
