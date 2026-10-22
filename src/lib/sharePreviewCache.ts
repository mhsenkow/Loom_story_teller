// =================================================================
// sharePreviewCache — warm PNG before / while the Share sheet opens
// =================================================================
// TopBar starts capture on Share tap; ShareSheet reuses the blob when
// the key still matches so actions can fire with the pre-rendered file.
// =================================================================

import { useLoomStore } from "./store";
import type { SocialPresetId } from "./socialExport";

export type SharePreviewKeyParts = {
  chartId: string;
  presetId: SocialPresetId;
  title: string;
  includeLoomMark: boolean;
  includeSource: boolean;
  includeTimestamp: boolean;
  includeHandle: boolean;
  handleText: string;
  supersample: 1 | 2;
  /** Bumps whenever anything that changes the painted chart changes (see render epoch below). */
  epoch: number;
};

export function buildSharePreviewKey(parts: SharePreviewKeyParts): string {
  return [
    parts.chartId,
    parts.presetId,
    parts.title,
    parts.includeLoomMark ? "1" : "0",
    parts.includeSource ? "1" : "0",
    parts.includeTimestamp ? "1" : "0",
    parts.includeHandle ? `h:${parts.handleText}` : "0",
    `ss${parts.supersample}`,
    `e${parts.epoch}`,
  ].join("|");
}

// ---- Render epoch ------------------------------------------------------------
// Chart ids encode only kind + fields, so palette / theme / annotation / pin / data
// changes would otherwise keep serving the old PNG. Any change to what the stage
// paints bumps the epoch. Captures temporarily swap aspect / export target and then
// restore them; those swaps are ignored and compared against the pre-capture state.
let renderEpoch = 0;
let lastDeps: unknown[] | null = null;
let subscribed = false;
let captureDepth = 0;

/** capturePlatformPng brackets its stage swap with +1 / -1. */
export function noteShareCapture(delta: 1 | -1): void {
  captureDepth = Math.max(0, captureDepth + delta);
}

function renderDeps(s: ReturnType<typeof useLoomStore.getState>): unknown[] {
  return [
    s.activeChart,
    s.chartVisualOverrides,
    s.appSettings.theme,
    s.appSettings.chartAspect,
    s.appSettings.chartDevice,
    s.chartAnnotations,
    s.pinnedTooltips,
    s.customRefLines,
    s.barStackMode,
    s.showMarginals,
    s.connectScatterTrail,
    s.sampleRows,
    s.chartTitleOverrides,
  ];
}

function ensureEpochSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  lastDeps = renderDeps(useLoomStore.getState());
  useLoomStore.subscribe((s) => {
    if (captureDepth > 0 || s.socialExportTarget) return;
    const deps = renderDeps(s);
    if (lastDeps && deps.some((d, i) => d !== lastDeps![i])) renderEpoch++;
    lastDeps = deps;
  });
}

export function sharePreviewKeyFromStore(presetId: SocialPresetId): string | null {
  ensureEpochSubscription();
  const s = useLoomStore.getState();
  const chart = s.activeChart;
  if (!chart) return null;
  const title = s.chartTitleOverrides[chart.id] ?? chart.title;
  return buildSharePreviewKey({
    chartId: chart.id,
    presetId,
    title,
    includeLoomMark: !!s.exportBurnIn.includeLoomMark,
    includeSource: !!s.exportBurnIn.includeSource,
    includeTimestamp: !!s.exportBurnIn.includeTimestamp,
    includeHandle: !!s.exportBurnIn.includeHandle,
    handleText: s.exportBurnIn.handleText ?? "",
    supersample: s.exportSupersample === 2 ? 2 : 1,
    epoch: renderEpoch,
  });
}

type CacheEntry = {
  key: string;
  blob: Blob | null;
  promise: Promise<Blob | null> | null;
  seq: number;
};

let entry: CacheEntry | null = null;

/** Instant hit when a warm capture already finished for this key. */
export function peekSharePreview(key: string): Blob | null {
  if (!entry || entry.key !== key) return null;
  return entry.blob;
}

/** In-flight warm capture for this key, if any. */
export function sharePreviewInFlight(key: string): Promise<Blob | null> | null {
  if (!entry || entry.key !== key) return null;
  return entry.promise;
}

/**
 * Start (or reuse) a platform PNG capture for the current chart + preset.
 * Safe to call from Share tap before the sheet mounts.
 */
export function warmSharePreview(presetId?: SocialPresetId): Promise<Blob | null> {
  const s = useLoomStore.getState();
  const id = (presetId ?? s.socialPresetId) as SocialPresetId;
  const key = sharePreviewKeyFromStore(id);
  if (!key) return Promise.resolve(null);

  if (entry?.key === key && entry.blob) return Promise.resolve(entry.blob);
  if (entry?.key === key && entry.promise) return entry.promise;

  const seq = (entry?.seq ?? 0) + 1;
  const supersample = useLoomStore.getState().exportSupersample === 2 ? 2 : 1;
  const promise = (async () => {
    const { capturePlatformPng } = await import("./capturePlatformPng");
    const out = await capturePlatformPng(id, {
      supersample,
      shouldRun: () => entry?.seq === seq && entry.key === key,
    });
    if (entry?.seq === seq && entry.key === key) {
      entry.blob = out;
      entry.promise = null;
    }
    return out;
  })();

  entry = { key, blob: null, promise, seq };
  return promise;
}

/** Drop cache (chart change / tests). */
export function invalidateSharePreview(): void {
  if (entry) entry.seq += 1;
  entry = null;
}

/** Test helper — seed a finished blob. */
export function seedSharePreview(key: string, blob: Blob): void {
  entry = { key, blob, promise: null, seq: (entry?.seq ?? 0) + 1 };
}
