// =================================================================
// Loom — Global State (Zustand)
// =================================================================
// Single source of truth for application state.
// Components subscribe to slices via selectors for minimal re-renders.
//
// Architecture note: The store holds UI state + cached query results.
// The actual data lives in DuckDB on the Rust side.
// =================================================================

import { create } from "zustand";
import type { ChartRecommendation } from "./recommendations";

export interface FileEntry {
  path: string;
  name: string;
  extension: string;
  row_count: number;
  size_bytes: number;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  null_count: number;
  distinct_count: number;
  min_value: string | null;
  max_value: string | null;
}

export interface QueryResult {
  columns: string[];
  types: string[];
  rows: (string | number | boolean | null)[][];
  total_rows: number;
}

export type ViewMode = "explorer" | "chart" | "query";
export type PanelTab = "stats" | "chart";

export interface ChartVisualOverrides {
  pointSize?: number;
  opacity?: number;
  colorPalette?: string;
  axisFontSize?: number;
  showGrid?: boolean;
}

interface LoomState {
  // Folder
  mountedFolder: string | null;
  files: FileEntry[];
  isScanning: boolean;

  // Selection
  selectedFile: FileEntry | null;
  columnStats: ColumnInfo[];
  sampleRows: QueryResult | null;

  // View
  viewMode: ViewMode;
  panelTab: PanelTab;
  sidebarOpen: boolean;
  panelOpen: boolean;
  dataRegionOpen: boolean;

  // Query
  querySql: string;
  queryResult: QueryResult | null;
  queryError: string | null;
  isQuerying: boolean;

  // Chart
  vegaSpec: object | null;
  chartRecs: ChartRecommendation[];
  activeChart: ChartRecommendation | null;
  chartVisualOverrides: ChartVisualOverrides;
  /** When set, "Why?" tooltip shows this instead of heuristic reason (e.g. from Ollama). */
  aiSuggestionReason: string | null;
  /** Web-only: cache of parsed file data (path -> inspect result) when user loads files in browser. */
  webFileCache: Record<string, { stats: ColumnInfo[]; sample: QueryResult }>;

  // Actions
  setMountedFolder: (folder: string | null) => void;
  setFiles: (files: FileEntry[]) => void;
  setIsScanning: (v: boolean) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  setColumnStats: (stats: ColumnInfo[]) => void;
  setSampleRows: (rows: QueryResult | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setPanelTab: (tab: PanelTab) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setDataRegionOpen: (open: boolean) => void;
  setQuerySql: (sql: string) => void;
  setQueryResult: (result: QueryResult | null) => void;
  setQueryError: (error: string | null) => void;
  setIsQuerying: (v: boolean) => void;
  setVegaSpec: (spec: object | null) => void;
  setChartRecs: (recs: ChartRecommendation[]) => void;
  setActiveChart: (chart: ChartRecommendation | null, opts?: { fromAI?: boolean; aiReason?: string | null }) => void;
  setChartVisualOverrides: (overrides: ChartVisualOverrides | ((prev: ChartVisualOverrides) => ChartVisualOverrides)) => void;
  setAISuggestionReason: (reason: string | null) => void;
  setWebFileCache: (cache: Record<string, { stats: ColumnInfo[]; sample: QueryResult }>) => void;
  reset: () => void;
}

const initialState = {
  mountedFolder: null,
  files: [],
  isScanning: false,
  selectedFile: null,
  columnStats: [],
  sampleRows: null,
  viewMode: "explorer" as ViewMode,
  panelTab: "chart" as PanelTab,
  sidebarOpen: true,
  panelOpen: true,
  dataRegionOpen: false,
  querySql: "",
  queryResult: null,
  queryError: null,
  isQuerying: false,
  vegaSpec: null,
  chartRecs: [] as ChartRecommendation[],
  activeChart: null as ChartRecommendation | null,
  chartVisualOverrides: {} as ChartVisualOverrides,
  aiSuggestionReason: null as string | null,
  webFileCache: {} as Record<string, { stats: ColumnInfo[]; sample: QueryResult }>,
};

export const useLoomStore = create<LoomState>((set) => ({
  ...initialState,

  setMountedFolder: (folder) => set({ mountedFolder: folder }),
  setFiles: (files) => set({ files }),
  setIsScanning: (v) => set({ isScanning: v }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setColumnStats: (stats) => set({ columnStats: stats }),
  setSampleRows: (rows) => set({ sampleRows: rows }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setDataRegionOpen: (open) => set({ dataRegionOpen: open }),
  setQuerySql: (sql) => set({ querySql: sql }),
  setQueryResult: (result) => set({ queryResult: result }),
  setQueryError: (error) => set({ queryError: error }),
  setIsQuerying: (v) => set({ isQuerying: v }),
  setVegaSpec: (spec) => set({ vegaSpec: spec }),
  setChartRecs: (recs) => set({ chartRecs: recs }),
  setActiveChart: (chart, opts) =>
    set({
      activeChart: chart,
      vegaSpec: chart?.spec ?? null,
      aiSuggestionReason: opts?.fromAI ? (opts.aiReason ?? null) : null,
    }),
  setChartVisualOverrides: (overrides) =>
    set((s) => ({
      chartVisualOverrides:
        typeof overrides === "function" ? overrides(s.chartVisualOverrides) : overrides,
    })),
  setAISuggestionReason: (reason) => set({ aiSuggestionReason: reason }),
  setWebFileCache: (cache) => set({ webFileCache: cache }),
  reset: () => set(initialState),
}));
