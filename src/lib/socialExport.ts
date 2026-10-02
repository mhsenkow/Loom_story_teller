// =================================================================
// Social media export — platform presets, captions, share, burn-in
// =================================================================
// Pixel targets for IG / Stories / X / LinkedIn / OG, caption seeds,
// attribution burn-in on PNG composites, Web Share helpers, and
// short vertical video via MediaRecorder (Canvas-only).
// =================================================================

import type { ChartAspectId } from "./chartViewport";
import { buildZip, downloadBlob } from "./zipStore";

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
  ctx.fillText(line, w / 2, h - (barH + pad * 0.5) / 2, w - pad * 2);
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
  downloadBlob(blob, filename);
  return "downloaded";
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function slugifyFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 80) || "loom-export"
  );
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

/** Publish HTML story to Loom Worker; returns public URL or null. */
export async function publishStoryToWorker(input: {
  html: string;
  title: string;
  ogImageDataUrl?: string | null;
}): Promise<{ url: string; id: string } | null> {
  try {
    const res = await fetch("/api/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: input.html,
        title: input.title,
        ogImage: input.ogImageDataUrl ?? undefined,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string; id?: string };
    if (!data.url || !data.id) return null;
    return { url: data.url, id: data.id };
  } catch {
    return null;
  }
}
