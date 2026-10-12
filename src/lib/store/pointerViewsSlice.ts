// =================================================================
// pointerViewsSlice — interaction chrome + saved chart views (LOOM-552)
// =================================================================

import type { ChartRecommendation } from "../recommendations";
import type { ChartVisualOverrides } from "../chartVisualTypes";
import type {
  ChartViewItem,
  DashboardItem,
  DashboardLayoutTemplate,
  DashboardSlot,
  LoomState,
  QueryResult,
} from "./types";
import { chartActivationPatch } from "./coreSlice";
import { newLoomId } from "../loomId";
import { putChartViewThumbnail, removeChartViewThumbnail } from "../chartViewThumbnails";

export function pointerViewsInitialState() {
  return {
    hoveredRowIndex: null as number | null,
    tooltipLink: null as { field: string; value: string } | null,
    pinnedTooltips: [] as LoomState["pinnedTooltips"],
    chartInteractionMode: "pan" as LoomState["chartInteractionMode"],
    crosshairPos: null as LoomState["crosshairPos"],
    rulerPins: [] as { x: number; y: number }[],
    lassoPoints: [] as { x: number; y: number }[],
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;

export function createPointerViewsSlice(set: Setter) {
  return {
    setPngExportHandler: (fn: (() => Promise<Blob | null>) | null) => set({ pngExportHandler: fn }),
    setSvgExportHandler: (fn: (() => Promise<string | null>) | null) => set({ svgExportHandler: fn }),
    setSvgExportLabel: (label: string | null) => set({ svgExportLabel: label }),
    setHoveredRowIndex: (idx: number | null) => set({ hoveredRowIndex: idx }),
    setTooltipLink: (link: { field: string; value: string } | null) => set({ tooltipLink: link }),
    addPinnedTooltip: (tt: {
      chartId: string;
      x: number;
      y: number;
      rowIndex: number;
      row: (string | number | boolean | null)[];
      columns: string[];
    }) =>
      set((s) => ({
        pinnedTooltips: [...s.pinnedTooltips.slice(-4), { ...tt, id: newLoomId("pt-") }],
      })),
    removePinnedTooltip: (id: string) =>
      set((s) => ({ pinnedTooltips: s.pinnedTooltips.filter((t) => t.id !== id) })),
    clearPinnedTooltips: () => set({ pinnedTooltips: [] }),
    setChartInteractionMode: (mode: LoomState["chartInteractionMode"]) =>
      set({ chartInteractionMode: mode }),
    setCrosshairPos: (pos: LoomState["crosshairPos"]) => set({ crosshairPos: pos }),
    setRulerPins: (pins: { x: number; y: number }[]) => set({ rulerPins: pins }),
    setLassoPoints: (points: { x: number; y: number }[]) => set({ lassoPoints: points }),
    setChartViews: (views: ChartViewItem[]) => set({ chartViews: views.slice(0, 30) }),
    addChartView: (
      name: string,
      filePath: string,
      fileName: string,
      chart: ChartRecommendation,
      visualOverrides: ChartVisualOverrides,
      querySql?: string | null,
      snapshotData?: QueryResult,
      snapshotImageDataUrl?: string | null,
    ): string | null => {
      const id = newLoomId("cv-");
      const image = snapshotImageDataUrl ?? null;
      let ok = false;
      set((s) => {
        try {
          ok = true;
          return {
            chartViews: [
              {
                id,
                name: name.trim() || "Chart view",
                filePath,
                fileName,
                chart: JSON.parse(JSON.stringify(chart)) as ChartRecommendation,
                visualOverrides: JSON.parse(JSON.stringify(visualOverrides)) as ChartVisualOverrides,
                querySql,
                snapshotData,
                snapshotImageDataUrl: image,
              },
              ...s.chartViews.slice(0, 29),
            ],
          };
        } catch {
          return s;
        }
      });
      if (ok && image) void putChartViewThumbnail(id, image).catch(() => {});
      return ok ? id : null;
    },
    createStoryDashboard: (
      filePath: string,
      fileName: string,
      storyTitle: string,
      charts: ChartRecommendation[],
      sampleData?: QueryResult | null,
    ): string | null => {
      if (charts.length === 0) return null;
      const now = Date.now();
      const dbId = newLoomId("db-");
      const snapshotData =
        sampleData?.columns && sampleData?.rows
          ? {
              columns: sampleData.columns,
              types: sampleData.types ?? sampleData.columns.map(() => "VARCHAR"),
              rows: sampleData.rows,
              total_rows: sampleData.total_rows ?? sampleData.rows.length,
            }
          : undefined;
      set((s) => {
        try {
          const newChartViews: ChartViewItem[] = [];
          const slots: DashboardSlot[] = [];
          for (const rec of charts) {
            const id = newLoomId("cv-");
            newChartViews.push({
              id,
              name: (rec.title || `${rec.kind} chart`).trim(),
              filePath,
              fileName,
              chart: JSON.parse(JSON.stringify(rec)) as ChartRecommendation,
              visualOverrides: JSON.parse(JSON.stringify(s.chartVisualOverrides)) as ChartVisualOverrides,
              querySql: null,
              snapshotData,
              snapshotImageDataUrl: null,
            });
            slots.push({ id: newLoomId("ds-"), viewType: "chart", viewId: id });
          }
          const isStream = filePath.startsWith("stream://");
          const layoutTemplate: DashboardLayoutTemplate = isStream
            ? "stream"
            : charts.length <= 2
              ? "2x1"
              : charts.length <= 4
                ? "2x2"
                : "3x2";
          const newDashboard: DashboardItem = {
            id: dbId,
            name: storyTitle.trim() || "Story",
            slots,
            layoutTemplate,
            refreshInterval: "manual",
            lastRefreshedAt: now,
          };
          return {
            chartViews: [...newChartViews, ...s.chartViews].slice(0, 30),
            dashboards: [newDashboard, ...s.dashboards].slice(0, 20),
            activeDashboardId: dbId,
          };
        } catch {
          return s;
        }
      });
      return dbId;
    },
    removeChartView: (id: string) => {
      set((s) => ({
        chartViews: s.chartViews.filter((v) => v.id !== id),
        dashboards: s.dashboards.map((d) => ({
          ...d,
          slots: d.slots.filter((slot) => !(slot.viewType === "chart" && slot.viewId === id)),
        })),
      }));
      void removeChartViewThumbnail(id).catch(() => {});
    },
    setChartViewSnapshot: (viewId: string, dataUrl: string | null) => {
      set((s) => ({
        chartViews: s.chartViews.map((v) =>
          v.id === viewId ? { ...v, snapshotImageDataUrl: dataUrl } : v,
        ),
      }));
      if (dataUrl) void putChartViewThumbnail(viewId, dataUrl).catch(() => {});
      else void removeChartViewThumbnail(viewId).catch(() => {});
    },
    applyChartView: (id: string) =>
      set((s) => {
        const v = s.chartViews.find((x) => x.id === id);
        if (!v) return s;
        const file =
          s.files.find((f) => f.path === v.filePath) ??
          (v.filePath
            ? {
                path: v.filePath,
                name: v.fileName || v.filePath.split("/").pop() || "data",
                extension: v.filePath.includes(".")
                  ? v.filePath.split(".").pop() || "csv"
                  : v.filePath.startsWith("stream://")
                    ? "stream"
                    : "csv",
                row_count: v.snapshotData?.total_rows ?? 0,
                size_bytes: 0,
              }
            : null);
        return {
          ...chartActivationPatch(v.chart),
          chartVisualOverrides: v.visualOverrides,
          viewMode: "chart" as const,
          dashboardsExpanded: false,
          ...(file ? { selectedFile: file } : {}),
          ...(v.snapshotData
            ? {
                sampleRows: v.snapshotData,
                columnStats: v.snapshotData.columns.map((c, i) => ({
                  name: c,
                  data_type: v.snapshotData?.types[i] || "VARCHAR",
                  null_count: 0,
                  distinct_count: 0,
                  min_value: null,
                  max_value: null,
                })),
              }
            : {}),
          ...(v.querySql ? { querySql: v.querySql } : {}),
        };
      }),
  };
}
