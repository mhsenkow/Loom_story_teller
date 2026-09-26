// =================================================================
// Loom — Story dashboard chart previews
// =================================================================
// After createStoryDashboard, briefly applies each chart slot, waits for
// render, and uses the registered PNG export handler to fill thumbnails.
// Rejects near-black / empty captures (common WebGPU race) and retries.
// =================================================================

import { useLoomStore } from "./store";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
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

/**
 * True when the PNG is basically a solid dark slab (failed GPU/export race).
 * Samples a downscaled bitmap so we don't walk megapixel buffers.
 */
async function looksLikeFailedCapture(blob: Blob): Promise<boolean> {
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
    // Failed GPU capture ≈ solid near-black (low mean + almost no contrast).
    // Real dark-theme charts still have mark/axis contrast (range ≫ 8).
    return mean < 28 && range < 10;
  } catch {
    return false;
  }
}

async function captureOne(viewId: string, attempts = 2): Promise<boolean> {
  const getState = useLoomStore.getState;
  getState().applyChartView(viewId);
  const hasHandler = await waitForPngHandler(4000);
  if (!hasHandler) return false;

  const kind = getState().activeChart?.kind;
  // Scatter/bubble: Canvas 2D path during capture still needs draw-effect settle
  const baseWait = kind === "scatter" || kind === "bubble" ? 1000 : 650;

  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(baseWait + attempt * 500);
    await afterPaint();
    const handler = getState().pngExportHandler;
    if (!handler) continue;
    try {
      const blob = await handler();
      if (!blob) continue;
      if (await looksLikeFailedCapture(blob)) continue;
      const dataUrl = await blobToDataUrl(blob);
      getState().setChartViewSnapshot(viewId, dataUrl);
      return true;
    } catch {
      // retry
    }
  }
  return false;
}

export async function captureChartViewPreview(viewId: string): Promise<boolean> {
  const getState = useLoomStore.getState;
  getState().setDashboardsExpanded(false);
  getState().setViewMode("chart");
  getState().setPreviewCapture({
    dashboardId: getState().activeDashboardId ?? "",
    current: 0,
    total: 1,
    label: "Capturing preview…",
  });
  await sleep(200);
  await afterPaint();
  try {
    return await captureOne(viewId, 3);
  } finally {
    getState().setPreviewCapture(null);
  }
}

export async function captureStoryDashboardPreviews(dashboardId: string): Promise<void> {
  const getState = useLoomStore.getState;
  const dashboard = getState().dashboards.find((d) => d.id === dashboardId);
  const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
  if (chartIds.length === 0) return;

  getState().setDashboardsExpanded(false);
  getState().setViewMode("chart");
  getState().setPreviewCapture({
    dashboardId,
    current: 0,
    total: chartIds.length,
    label: "Preparing story previews…",
  });

  // Let layout settle and ChartView mount with a non-zero size
  await sleep(400);
  await afterPaint();

  let ok = 0;
  for (let i = 0; i < chartIds.length; i++) {
    const cid = chartIds[i]!;
    const name =
      getState().chartViews.find((v) => v.id === cid)?.name ?? `Chart ${i + 1}`;
    getState().setPreviewCapture({
      dashboardId,
      current: i + 1,
      total: chartIds.length,
      label: `Capturing ${i + 1}/${chartIds.length}: ${name}`,
    });
    getState().setToast(`Capturing previews ${i + 1}/${chartIds.length}…`);
    if (await captureOne(cid, 2)) ok++;
  }

  getState().setPreviewCapture(null);
  getState().setDashboardsExpanded(true);
  if (ok < chartIds.length) {
    getState().setToast(
      `Story ready — ${ok}/${chartIds.length} previews captured. Retry any blank tiles.`,
    );
  } else {
    getState().setToast(`Story ready — ${ok} chart previews`);
  }
}
