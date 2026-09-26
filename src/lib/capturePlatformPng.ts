// =================================================================
// Platform PNG capture — resize stage → paint → export → restore
// =================================================================
// Used by Export tab and story carousel packs so platform presets
// always yield the advertised pixel size (not the window size).
// =================================================================

import { useLoomStore } from "./store";
import {
  getSocialPreset,
  type SocialPresetId,
  drawExportBurnIn,
  blobToDataUrl,
} from "./socialExport";
import { getThemeUiColors } from "./chartPalettes";

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForPngHandler(timeoutMs: number): Promise<boolean> {
  const getState = useLoomStore.getState;
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (getState().pngExportHandler) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

/** True when PNG is a failed near-black slab (GPU race). */
export async function looksLikeFailedCapture(blob: Blob): Promise<boolean> {
  if (blob.size < 80) return true;
  try {
    const bmp = await createImageBitmap(blob);
    const sw = Math.min(48, bmp.width);
    const sh = Math.min(48, bmp.height);
    if (sw < 4 || sh < 4) {
      bmp.close();
      return true;
    }
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      return false;
    }
    ctx.drawImage(bmp, 0, 0, sw, sh);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, sw, sh);
    let sum = 0;
    let n = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      const lum = a < 8 ? 0 : 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      n++;
    }
    if (n === 0) return true;
    const mean = sum / n;
    const range = max - min;
    return mean < 28 && range < 10;
  } catch {
    return false;
  }
}

/**
 * Capture the current chart at a social platform size.
 * Temporarily forces stage geometry + Canvas path, then restores.
 */
export async function capturePlatformPng(
  presetId: SocialPresetId,
  options?: { supersample?: 1 | 2; attempts?: number },
): Promise<Blob | null> {
  const getState = useLoomStore.getState;
  const preset = getSocialPreset(presetId);
  const supersample = options?.supersample ?? getState().exportSupersample;
  const attempts = options?.attempts ?? 3;

  const prevTarget = getState().socialExportTarget;
  const prevAspect = getState().appSettings.chartAspect;
  const prevSidebar = getState().sidebarOpen;

  try {
    getState().setViewMode("chart");
    getState().setDashboardsExpanded(false);
    // Keep the detail panel mounted (Export tab runs from there). Only collapse the sidebar.
    useLoomStore.setState({ sidebarOpen: false });

    if (preset.width && preset.height) {
      if (preset.aspectId) {
        getState().setAppSettings((s) => ({ ...s, chartAspect: preset.aspectId! }));
      }
      getState().setSocialExportTarget({
        width: preset.width,
        height: preset.height,
        pixelRatio: supersample,
        presetId,
      });
    } else {
      getState().setSocialExportTarget(null);
    }

    await sleep(350);
    await afterPaint();
    const hasHandler = await waitForPngHandler(5000);
    if (!hasHandler) return null;

    const kind = getState().activeChart?.kind;
    const baseWait = kind === "scatter" || kind === "bubble" ? 900 : 550;

    for (let attempt = 0; attempt < attempts; attempt++) {
      await sleep(baseWait + attempt * 400);
      await afterPaint();
      const handler = getState().pngExportHandler;
      if (!handler) continue;
      try {
        let blob = await handler();
        if (!blob) continue;
        if (await looksLikeFailedCapture(blob)) continue;

        // If supersampled, downscale to exact preset pixels
        if (supersample === 2 && preset.width && preset.height) {
          blob = (await downscaleBlob(blob, preset.width, preset.height)) ?? blob;
        }
        // Current-frame path: burn-in isn't applied in the handler (no target) — post-process.
        if (!preset.width || !preset.height) {
          blob = await applyBurnInToPng(blob, getState().selectedFile?.name);
        }
        return blob;
      } catch {
        // retry
      }
    }
    return null;
  } finally {
    getState().setSocialExportTarget(prevTarget);
    getState().setAppSettings((s) => ({ ...s, chartAspect: prevAspect }));
    useLoomStore.setState({ sidebarOpen: prevSidebar });
    await sleep(100);
  }
}

async function downscaleBlob(
  blob: Blob,
  width: number,
  height: number,
): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    return new Promise((resolve) => {
      c.toBlob((b) => resolve(b), "image/png");
    });
  } catch {
    return null;
  }
}

/** Apply burn-in footer onto a PNG blob (post-process). */
export async function applyBurnInToPng(
  blob: Blob,
  sourceLabel?: string | null,
): Promise<Blob> {
  const burnIn = useLoomStore.getState().exportBurnIn;
  if (
    !burnIn.includeSource &&
    !burnIn.includeTimestamp &&
    !burnIn.includeHandle &&
    !burnIn.includeLoomMark
  ) {
    return blob;
  }
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) {
      bmp.close();
      return blob;
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const theme = getThemeUiColors(useLoomStore.getState().appSettings.theme);
    drawExportBurnIn(ctx, c.width, c.height, {
      burnIn,
      sourceLabel,
      themeText: theme.text,
      themeMuted: theme.muted,
      themeBg: theme.bg,
    });
    return new Promise((resolve) => {
      c.toBlob((b) => resolve(b ?? blob), "image/png");
    });
  } catch {
    return blob;
  }
}

export { blobToDataUrl };
