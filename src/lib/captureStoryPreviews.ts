// =================================================================
// Loom — Story dashboard chart previews
// =================================================================
// After createStoryDashboard, briefly applies each chart slot, waits for
// render, and uses the registered PNG export handler to fill thumbnails.
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

export async function captureStoryDashboardPreviews(dashboardId: string): Promise<void> {
  const getState = useLoomStore.getState;
  const dashboard = getState().dashboards.find((d) => d.id === dashboardId);
  const chartIds = dashboard?.slots.filter((s) => s.viewType === "chart").map((s) => s.viewId) ?? [];
  if (chartIds.length === 0) return;

  getState().setDashboardsExpanded(false);
  getState().setViewMode("chart");

  // Let layout settle and ChartView mount and get a non-zero size
  await new Promise((r) => setTimeout(r, 350));
  await afterPaint();

  for (const cid of chartIds) {
    getState().applyChartView(cid);
    const hasHandler = await waitForPngHandler(3000);
    if (!hasHandler) continue;
    // Give ResizeObserver + draw effect time to run (canvas size + paint)
    await new Promise((r) => setTimeout(r, 900));
    await afterPaint();
    const handler = getState().pngExportHandler;
    if (handler) {
      try {
        const blob = await handler();
        if (blob) {
          const dataUrl = await blobToDataUrl(blob);
          getState().setChartViewSnapshot(cid, dataUrl);
        }
      } catch {
        // ignore single chart capture failure
      }
    }
  }

  getState().setDashboardsExpanded(true);
}
