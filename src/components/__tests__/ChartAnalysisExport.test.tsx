import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChartExport } from "../chartView/useChartExport";
import { recordChartPaint } from "@/lib/__tests__/fixtures/chartRecording";
import { useLoomStore } from "@/lib/store";
vi.mock("@/lib/fontCatalog", async importOriginal => ({ ...await importOriginal<object>(), ensureChartFontLoaded: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => useLoomStore.getState().reset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(["scatter", "scatter3d", "firefly"])("%s PNG keeps the painted anomaly layer and avoids stale GPU pixels", async kind => {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 1; });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(Object.assign(recordChartPaint().ctx, { drawImage }) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(fn => fn(new Blob(["png"], { type: "image/png" })));
  const gpu = { width: 800, height: 500 }, painted = { width: 800, height: 500 };
  let handler: (() => Promise<Blob | null>) | null = null;
  renderHook(() => useChartExport({
    setPngExportHandler: (fn: typeof handler) => { handler = fn; }, setSvgExportHandler: vi.fn(), setSvgExportLabel: vi.fn(),
    vegaSpec: {}, savedChartVisualOverrides: {},
    exportStateRef: { current: { activeChart: { id: "a", kind, xField: "x", yField: "y" }, gpuReady: true, hasChartAnomalies: true, chartVisualOverrides: {}, sampleRows: { columns: ["x", "y"], rows: [[0, 1]] } } },
    canvasRef: { current: gpu }, canvas2DRef: { current: painted }, axesOverlayRef: { current: null }, focusLayerRef: { current: null }, cubeFrameRef: { current: null },
  }));
  const result = await handler!();
  expect(result?.type).toBe("image/png");
  expect(drawImage).toHaveBeenCalledWith(painted, 0, 0);
  expect(drawImage.mock.calls.some(([layer]) => layer === gpu)).toBe(false);
  expect(drawImage.mock.calls.some(([layer]) => layer === painted)).toBe(true);
});
