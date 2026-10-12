// =================================================================
// Loom — Story dashboard chart previews
// =================================================================

import { useLoomStore } from "./store";
import {
  afterPaint,
  blobToDataUrl,
  looksLikeFailedCapture,
  runSerializedCapture,
  sleep,
  waitForPngHandler,
} from "./captureHelpers";

async function captureOne(viewId: string, attempts = 2): Promise<boolean> {
  return runSerializedCapture(async () => {
    const getState = useLoomStore.getState;
    getState().applyChartView(viewId);
    const hasHandler = await waitForPngHandler(4000);
    if (!hasHandler) return false;

    const kind = getState().activeChart?.kind;
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
  });
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

  try {
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

    getState().setDashboardsExpanded(true);
    if (ok < chartIds.length) {
      getState().setToast(
        `Story ready — ${ok}/${chartIds.length} previews captured. Retry any blank tiles.`,
      );
    } else {
      getState().setToast(`Story ready — ${ok} chart previews`);
    }
  } finally {
    getState().setPreviewCapture(null);
  }
}
