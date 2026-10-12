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
} from "./socialExport";
import { getThemeUiColors } from "./chartPalettes";
import { waitForChartPaint } from "./chartPaintSignal";
import {
  afterPaint,
  blobToDataUrl,
  looksLikeFailedCapture,
  runSerializedCapture,
  sleep,
  waitForPngHandler,
} from "./captureHelpers";

export { blobToDataUrl, looksLikeFailedCapture };

/**
 * Capture the current chart at a social platform size.
 * Temporarily forces stage geometry + Canvas path, then restores.
 */
export function capturePlatformPng(
  presetId: SocialPresetId,
  options?: {
    supersample?: 1 | 2;
    attempts?: number;
    /** Checked once this capture's turn comes; return false to skip (superseded). */
    shouldRun?: () => boolean;
  },
): Promise<Blob | null> {
  return runSerializedCapture(() =>
    options?.shouldRun && !options.shouldRun() ? Promise.resolve(null) : captureNow(presetId, options),
  );
}

async function captureNow(
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
  const prevViewMode = getState().viewMode;
  const prevDashboardsExpanded = getState().dashboardsExpanded;

  try {
    getState().setViewMode("chart");
    getState().setDashboardsExpanded(false);
    useLoomStore.setState({ sidebarOpen: false });

    if (preset.width && preset.height) {
      if (preset.aspectId) {
        getState().setAppSettings((s) => ({ ...s, chartAspect: preset.aspectId! }));
      }
      const layoutScale = Math.min(2.4, Math.max(1, preset.width / 450));
      getState().setSocialExportTarget({
        width: Math.round(preset.width / layoutScale),
        height: Math.round(preset.height / layoutScale),
        pixelRatio: layoutScale * supersample,
        presetId,
      });
    } else {
      getState().setSocialExportTarget(null);
    }

    await afterPaint();
    await waitForChartPaint(4000);
    const hasHandler = await waitForPngHandler(5000);
    if (!hasHandler) return null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      await waitForChartPaint(attempt === 0 ? 2500 : 1800);
      await afterPaint();
      const handler = getState().pngExportHandler;
      if (!handler) continue;
      try {
        let blob = await handler();
        if (!blob) continue;
        if (await looksLikeFailedCapture(blob)) continue;

        if (preset.width && preset.height) {
          const bmp = await createImageBitmap(blob);
          const exact = bmp.width === preset.width && bmp.height === preset.height;
          bmp.close();
          if (!exact) blob = (await downscaleBlob(blob, preset.width, preset.height)) ?? blob;
        }
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
    getState().setViewMode(prevViewMode);
    getState().setDashboardsExpanded(prevDashboardsExpanded);
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
  const st = useLoomStore.getState();
  if ((st.chartVisualOverrides.sourceFootnote ?? "credit") !== "off") {
    return blob;
  }
  try {
    const { formatChartTimeFootnote } = await import("@/lib/chartTime");
    const rows = st.sampleRows;
    const timeLine = formatChartTimeFootnote(
      rows?.rows,
      rows?.columns,
      st.activeChart,
      st.columnStats,
    );
    if (timeLine) return blob;
  } catch {
    /* keep burn-in path */
  }
  const burnIn = st.exportBurnIn;
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
