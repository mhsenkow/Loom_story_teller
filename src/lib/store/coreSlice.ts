// =================================================================
// coreSlice — folder, files, selection, view mode, shell drawers
// =================================================================

import type { ChartRecommendation } from "../recommendations";
import type { ChartChromeSection, ChartChromeFocus } from "../chartChromeLink";
import type { DiveLink, DiveQuery } from "../dive";
import type { ChartLink } from "../chartLink";
import type { LoomState, ViewMode, PanelTab, FileEntry, ColumnInfo, QueryResult, ChartVisualOverrides } from "./types";

export function chartActivationPatch(rec: ChartRecommendation): Partial<LoomState> {
  return {
    activeChart: rec,
    vegaSpec: rec.spec ?? null,
    aiSuggestionReason: null,
    ...(rec.kind === "bar" ? { barStackMode: rec.barStackMode ?? "grouped" } : {}),
  };
}

export function liveChartIds(s: LoomState, next?: {
  chartRecs?: ChartRecommendation[];
  activeChart?: ChartRecommendation | null;
  chartViews?: LoomState["chartViews"];
}): Set<string> {
  return new Set([
    ...(next?.chartRecs ?? s.chartRecs).map((c) => c.id),
    ...((next?.activeChart ?? s.activeChart) ? [(next?.activeChart ?? s.activeChart)!.id] : []),
    ...(next?.chartViews ?? s.chartViews).map((v) => v.chart.id),
  ]);
}

export function pruneMapKeys<T>(map: Record<string, T>, keep: Set<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    const emptyArray = Array.isArray(value) && value.length === 0;
    if (keep.has(key) && !emptyArray) next[key] = value;
    else changed = true;
  }
  return changed ? next : map;
}

export function prunedChartMaps(s: LoomState, next?: {
  chartRecs?: ChartRecommendation[];
  activeChart?: ChartRecommendation | null;
  chartViews?: LoomState["chartViews"];
}): Pick<LoomState, "chartTitleOverrides" | "chartAnnotations" | "customRefLines"> {
  const keep = liveChartIds(s, next);
  return {
    chartTitleOverrides: pruneMapKeys(s.chartTitleOverrides, keep),
    chartAnnotations: pruneMapKeys(s.chartAnnotations, keep),
    customRefLines: pruneMapKeys(s.customRefLines, keep),
  };
}

export function snapshotTableState(s: LoomState) {
  return {
    tablePrefs: {
      ...s.tablePrefs,
      visibleColumns: s.tablePrefs.visibleColumns ? [...s.tablePrefs.visibleColumns] : null,
      columnOrder: s.tablePrefs.columnOrder ? [...s.tablePrefs.columnOrder] : null,
    },
    tableColumnFilters: { ...s.tableColumnFilters },
  };
}

/** Keys cleared whenever the active dataset identity changes. */
const DATASET_SCOPED_KEYS = [
  "tableFilterRowIndices", "tableColumnFilters", "tableUndoStack", "tableRedoStack",
  "tablePrefs", "selectedRowIndices", "smartResults", "hoveredRowIndex", "tooltipLink",
  "pinnedTooltips", "crosshairPos", "rulerPins", "lassoPoints", "chartAnnotations",
  "customRefLines", "chartTitleOverrides", "chartVisualOverrides", "querySql",
  "queryResult", "queryError", "isQuerying", "queryResultPage", "querySnapshots",
  "nlQueryInput", "diveQuery", "aiSuggestionReason", "vizSwipeOpen", "vizSwipeDeck",
  "vizSwipeIndex", "vizScanStatus", "vizScanMessage", "vizSwipeKept", "vizSwipeSkipped",
  "vizSchemaSignature",
] as const;

export type DatasetScopedKey = (typeof DATASET_SCOPED_KEYS)[number];

export function datasetScopedResetSlice(initial: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DATASET_SCOPED_KEYS) {
    const v = initial[key];
    out[key] = Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...(v as object) } : v;
  }
  return out;
}

export function coreInitialState() {
  return {
    mountedFolder: null as string | null,
    files: [] as FileEntry[],
    isScanning: false,
    inspectingFilePath: null as string | null,
    selectedFile: null as FileEntry | null,
    columnStats: [] as ColumnInfo[],
    sampleRows: null as QueryResult | null,
    viewMode: "explorer" as ViewMode,
    panelTab: "chart" as PanelTab,
    chartPanelSection: "encoding" as ChartChromeSection,
    chartChromeFocus: null as ChartChromeFocus | null,
    // SSR-safe defaults — page shell effect applies real drawers after mount
    // (readInitialShellDrawers() used window and mismatched the static HTML).
    sidebarOpen: false,
    panelOpen: false,
    dataRegionOpen: false,
    dataSourcesExpanded: false,
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;
type Getter = () => LoomState;

export function createCoreSlice(set: Setter, _get: Getter, initialState: Record<string, unknown>) {
  return {
    setMountedFolder: (folder: string | null) => set({ mountedFolder: folder }),
    setFiles: (files: FileEntry[]) => set({ files }),
    setIsScanning: (v: boolean) => set({ isScanning: v }),
    setInspectingFilePath: (path: string | null) => set({ inspectingFilePath: path }),
    setSelectedFile: (file: FileEntry | null) => set({ selectedFile: file }),
    resetDatasetScoped: () => set(datasetScopedResetSlice(initialState) as Partial<LoomState>),
    openDataset: (payload: {
      file: FileEntry;
      stats?: ColumnInfo[];
      sample?: QueryResult | null;
      chartRecs?: ChartRecommendation[];
      activeChart?: ChartRecommendation | null;
      inspectingFilePath?: string | null;
      extra?: Partial<LoomState>;
    }) =>
      set((s) => ({
        ...datasetScopedResetSlice(initialState),
        selectedFile: payload.file,
        columnStats: payload.stats ?? [],
        sampleRows: payload.sample ?? null,
        chartRecs: payload.chartRecs ?? [],
        activeChart: payload.activeChart ?? null,
        vegaSpec: payload.activeChart?.spec ?? null,
        inspectingFilePath: payload.inspectingFilePath !== undefined ? payload.inspectingFilePath : s.inspectingFilePath,
        ...prunedChartMaps(s, { chartRecs: payload.chartRecs ?? [], activeChart: payload.activeChart ?? null }),
        ...(payload.activeChart?.kind === "bar" ? { barStackMode: payload.activeChart.barStackMode ?? "grouped" } : {}),
        ...(payload.extra ?? {}),
      } as Partial<LoomState>)),
    setColumnStats: (stats: ColumnInfo[]) => set({ columnStats: stats }),
    setSampleRows: (rows: QueryResult | null) => set({ sampleRows: rows }),
    setViewMode: (mode: ViewMode) => set({ viewMode: mode }),
    setDiveQuery: (v: { src: string; query: DiveQuery } | null) => set({ diveQuery: v }),
    setDiveLink: (v: DiveLink | null) => set({ diveLink: v }),
    setChartLink: (v: ChartLink | null) => set({ chartLink: v }),
    setPanelTab: (tab: PanelTab) => set({ panelTab: tab }),
    setChartPanelSection: (section: ChartChromeSection) => set({ chartPanelSection: section }),
    setChartChromeFocus: (focus: ChartChromeFocus | null) => set({ chartChromeFocus: focus }),
    setPanelOpen: (open: boolean) => set({ panelOpen: open }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
    setDataRegionOpen: (open: boolean) => set({ dataRegionOpen: open }),
    setDataSourcesExpanded: (v: boolean) => set({ dataSourcesExpanded: v }),
  };
}
