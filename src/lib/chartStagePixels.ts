// =================================================================
// Chart stage pixels — CSS size ↔ backing store (desktop / iPad / phone)
// =================================================================
// Screen charts cap DPR so iPhone 3× and large iPads don't allocate huge
// canvases. Exports keep an explicit pixelRatio. Prefer the browser's
// device-pixel content box when ResizeObserver provides it so buffer and
// CSS size cannot drift (blurry stretch).
// =================================================================

/** Max backing-store scale for on-screen charts (matches ChartCard thumbs). */
export const SCREEN_DPR_CAP = 2;

export function screenDevicePixelRatio(
  raw: number | undefined | null = typeof window !== "undefined" ? window.devicePixelRatio : 1,
): number {
  const n = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 1;
  return Math.min(SCREEN_DPR_CAP, n);
}

/**
 * Backing-store scale for the live stage. Social / platform captures pin
 * `exportPixelRatio` so a 1080px export matches every device.
 */
export function stagePixelRatio(exportPixelRatio?: number | null): number {
  if (typeof exportPixelRatio === "number" && Number.isFinite(exportPixelRatio) && exportPixelRatio > 0) {
    return exportPixelRatio;
  }
  return screenDevicePixelRatio();
}

export type StageBoxSize = {
  /** CSS pixels for layout / style.width */
  cssW: number;
  cssH: number;
  /** Device pixels for canvas.width / canvas.height */
  bufW: number;
  bufH: number;
  dpr: number;
};

/**
 * Resolve CSS + buffer sizes from a ResizeObserver entry (or a plain CSS box).
 * When `devicePixelContentBoxSize` is present, use it for the buffer so we
 * never multiply CSS×DPR twice or disagree with the compositor.
 */
export function resolveStageBoxSize(
  args: {
    cssW: number;
    cssH: number;
    dpr?: number;
    devicePixelW?: number | null;
    devicePixelH?: number | null;
  },
): StageBoxSize {
  const cssW = Math.max(0, args.cssW);
  const cssH = Math.max(0, args.cssH);
  const dpr = stagePixelRatio(args.dpr);
  const hasDeviceBox =
    typeof args.devicePixelW === "number" &&
    args.devicePixelW > 0 &&
    typeof args.devicePixelH === "number" &&
    args.devicePixelH > 0;
  // Cap device-pixel box to css×cap so a 3× phone doesn't keep a 3× buffer
  // when we intentionally paint at the screen DPR cap.
  const maxBufW = Math.max(1, Math.round(cssW * dpr));
  const maxBufH = Math.max(1, Math.round(cssH * dpr));
  const bufW = hasDeviceBox
    ? Math.min(maxBufW, Math.round(args.devicePixelW!))
    : maxBufW;
  const bufH = hasDeviceBox
    ? Math.min(maxBufH, Math.round(args.devicePixelH!))
    : maxBufH;
  return { cssW, cssH, bufW, bufH, dpr };
}

/** Density mark budget — phones paint fewer points for steadier touch FPS. */
export function densityPointBudget(isPhone: boolean): number {
  return isPhone ? 1800 : 3500;
}
