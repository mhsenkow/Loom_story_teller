// =================================================================
// Loom — Global State (Zustand)
// =================================================================
// Single source of truth for application state.
// Components subscribe to slices via selectors for minimal re-renders.
// Prefer narrow selectors (e.g. (s) => s.tablePrefs) so only relevant
// state changes trigger updates; heavy derived data stays in useMemo.
//
// Architecture note: The store holds UI state + cached query results.
// The actual data lives in DuckDB on the Rust side.
// =================================================================

import { create } from "zustand";
import type { ChartRecommendation } from "./recommendations";
import type {
  AnomalyResult,
  ForecastResult,
  TrendResult,
  ReferenceLinesResult,
  ClusterResult,
} from "./smartAnalytics";

export interface SmartResults {
  anomaly?: AnomalyResult | null;
  forecast?: ForecastResult | null;
  trend?: TrendResult | null;
  referenceLines?: ReferenceLinesResult | null;
  clusters?: ClusterResult | null;
}

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
export type PanelTab = "stats" | "chart" | "export" | "smart" | "settings" | "dashboards";

/** Saved chart view: file + chart config + visual overrides + optional snapshot image for dashboards. */
export interface ChartViewItem {
  id: string;
  name: string;
  filePath: string;
  fileName: string;
  chart: ChartRecommendation;
  visualOverrides: ChartVisualOverrides;
  querySql?: string | null;
  snapshotData?: {
    columns: string[];
    types: string[];
    rows: (string | number | boolean | null)[][];
    total_rows: number;
  };
  /** Data URL (PNG) of chart at save time — used for dashboard thumbnails. */
  snapshotImageDataUrl?: string | null;
}

/** Saved table view: UI state + optional data snapshot */
export interface TableViewItem {
  id: string;
  name: string;
  visibleColumns: string[] | null;
  columnOrder: string[] | null;
  columnFilters: Record<string, string>;
  querySql?: string | null;
  snapshotData?: {
    columns: string[];
    types: string[];
    rows: (string | number | boolean | null)[][];
    total_rows: number;
  };
}

/** Saved query view: name + SQL. */
export interface QueryViewItem {
  id: string;
  name: string;
  sql: string;
}

/** Dashboard slot: references a saved view by type and id. */
export interface DashboardSlot {
  id: string;
  viewType: "table" | "chart" | "query" | "snapshot";
  viewId: string;
}

/** Dashboard refresh interval — when to treat data as stale and show "Refresh". */
export type DashboardRefreshInterval = "manual" | "1m" | "5m" | "15m" | "1h" | "1d";

/** Layout template for dashboard grid. */
export type DashboardLayoutTemplate =
  | "auto"      // responsive 1–4 cols
  | "1x1"       // single large
  | "2x1"       // 2 columns 1 row
  | "2x2"       // 2x2 grid
  | "3x2"       // 3 columns 2 rows
  | "1+2"       // 1 large left, 2 stacked right
  | "stream";   // hero + 2×3 grid — optimized for live stream dashboards

/** Dashboard: named layout of view slots + optional refresh and last-updated. */
export interface DashboardItem {
  id: string;
  name: string;
  slots: DashboardSlot[];
  /** Grid layout template. */
  layoutTemplate?: DashboardLayoutTemplate;
  /** How often the dashboard is considered stale (UI hint; actual refresh is manual or future auto). */
  refreshInterval?: DashboardRefreshInterval;
  /** Timestamp (ms) when the dashboard was last refreshed / viewed with fresh data. */
  lastRefreshedAt?: number;
}

export type AppTheme = "dark" | "light" | "high-contrast" | "colorblind";
export type FontScale = 0.9 | 1 | 1.1 | 1.15;

export interface AppSettings {
  theme: AppTheme;
  fontScale: FontScale;
  reducedMotion: boolean;
}

export interface ChartVisualOverrides {
  // — Existing —
  pointSize?: number;
  opacity?: number;
  colorPalette?: string;
  axisFontSize?: number;
  showGrid?: boolean;

  // — Typography —
  fontFamily?: string;           // e.g. "Inter", "JetBrains Mono", "Space Grotesk", "DM Sans", "Instrument Serif"
  titleFontWeight?: number;      // 300 | 400 | 600 | 700
  titleItalic?: boolean;
  tickRotation?: number;         // degrees: 0, 30, 45, 60, 90

  // — Mark Shapes & Representation —
  markShape?: string;            // "circle" | "square" | "diamond" | "triangle" | "cross" | "star" | "hexagon" | "ring"
  markStroke?: boolean;          // outline on marks
  markStrokeWidth?: number;      // 0.5–3
  markStrokeColor?: string;      // hex color or "auto" (derives from fill)
  markJitter?: number;           // 0–10 px random displacement
  sizeScale?: number;            // 0.5–2: scale for size encoding (ratio min–max)
  barCornerRadius?: number;     // 0–16 px
  lineStrokeStyle?: string;      // "solid" | "dashed" | "dotted"
  lineCurveSmooth?: boolean;     // monotone interpolation
  lineWidth?: number;            // 0.5–5

  // — Axes & Grid —
  axisLineColor?: string;
  axisLineWidth?: number;        // 0.5–4
  gridStyle?: string;            // "solid" | "dashed" | "dotted"
  gridOpacity?: number;          // 0–1
  tickCount?: number;            // 3–12
  axisLabelColor?: string;

  // — Layout —
  chartPadding?: number;         // 20–80
  legendPosition?: string;       // "none" | "top-right" | "bottom" | "right"
  showDataLabels?: boolean;
  facetField?: string | null;    // column name for small multiples; null = off

  // — Atmosphere —
  backgroundStyle?: string;      // "default" | "gradient" | "paper" | "transparent"
  blendMode?: GlobalCompositeOperation; // "source-over" | "screen" | "multiply" | "lighten"
  glowEnabled?: boolean;
  glowIntensity?: number;        // 1–20
  animateEntrance?: boolean;
}

interface LoomState {
  // Folder
  mountedFolder: string | null;
  files: FileEntry[];
  isScanning: boolean;
  /** Path of file currently being inspected (loading stats/sample). Enables loading UI. */
  inspectingFilePath: string | null;

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
  /** When true, Data & sources expands to full width (grid of Data.gov etc.). */
  dataSourcesExpanded: boolean;

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
  /** Per-chart custom title (chart id -> title). */
  chartTitleOverrides: Record<string, string>;
  /** Called from Export tab to capture chart as PNG. Set by ChartView. */
  pngExportHandler: (() => Promise<Blob | null>) | null;
  /** Called from Export tab to render chart as SVG. Set by ChartView. */
  svgExportHandler: (() => Promise<string | null>) | null;

  /** Smart analytics: results from Anomaly / Forecast / Trend / etc. Visualized on chart when set. */
  smartResults: SmartResults | null;

  /** App-wide appearance and accessibility. */
  appSettings: AppSettings;

  /** Recent files (from persist). Max 20. */
  recentFiles: FileEntry[];
  /** Last session for reopen (folder + file + viewMode). */
  lastSession: { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null;
  /** Query history for Run (last N SQL strings). */
  queryHistory: { sql: string; at: number }[];
  /** Saved named query snippets (name + sql). Max 30. */
  querySnippets: { name: string; sql: string }[];
  /** Table: visible column names; null = all. Column order; null = data order. */
  tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null };
  /** Filter table to these row indices (original sample order). null = show all. */
  tableFilterRowIndices: number[] | null;
  /** Per-column filter strings (column name -> filter text). Empty string = no filter. */
  tableColumnFilters: Record<string, string>;
  /** Undo/redo stacks for table state (prefs + filters). Max 20. */
  tableUndoStack: { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[];
  tableRedoStack: { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[];
  /** Selected row indices (original sampleRows.rows indices) for export selected. */
  selectedRowIndices: number[];
  /** Saved table views (name + snapshot of visibleColumns, columnOrder, columnFilters, and data). */
  tableViews: TableViewItem[];
  /** Query results paging: current 0-based page and page size. */
  queryResultPage: number;
  queryResultPageSize: number;
  /** Chart annotations (chartId -> list of { id, text, x, y } in 0–1 coords). */
  chartAnnotations: Record<string, { id: string; text: string; x: number; y: number }[]>;
  /** Hovered row index for linked highlighting between table and chart. null = none. */
  hoveredRowIndex: number | null;
  /** Locked tooltip identity (column value) shared across charts; set/clear with L when hovering. */
  tooltipLink: { field: string; value: string } | null;
  /** Pinned tooltips on chart (persist until dismissed). */
  pinnedTooltips: { id: string; chartId: string; x: number; y: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] }[];
  /** User-placed reference lines on chart (chartId -> lines). */
  customRefLines: Record<string, { id: string; axis: "x" | "y"; value: number; label: string }[]>;
  /** Chart interaction modes. */
  chartInteractionMode: "pan" | "crosshair" | "lasso";
  /** Crosshair position in data coords; null = off. */
  crosshairPos: { dataX: number; dataY: number; screenX: number; screenY: number } | null;
  /** Pinned crosshair ruler measurements. */
  rulerPins: { x: number; y: number }[];
  /** Lasso selection points (screen coords, for scatter). */
  lassoPoints: { x: number; y: number }[];
  /** Bar chart stacking mode. */
  barStackMode: "grouped" | "stacked" | "percent";
  /** Connected scatter (trail) mode. */
  connectScatterTrail: boolean;
  /** Show marginal distributions on scatter axes. */
  showMarginals: boolean;
  /** Query snapshots for diffing. */
  querySnapshots: { id: string; name: string; columns: string[]; rows: (string | number | boolean | null)[][]; at: number }[];
  /** NL-to-SQL input. */
  nlQueryInput: string;
  /** Toast message (shown briefly; null = hidden). */
  toastMessage: string | null;
  /** Saved chart views (file + chart + visual overrides). */
  chartViews: ChartViewItem[];
  /** Saved query views (name + SQL). */
  queryViews: QueryViewItem[];
  /** Dashboards: named collections of view slots. */
  dashboards: DashboardItem[];
  /** Currently selected dashboard (for panel and expand). */
  activeDashboardId: string | null;
  /** When true, main area shows dashboard canvas (focus/expand). */
  dashboardsExpanded: boolean;

  /** Global prompt dialog state for replacing window.prompt. */
  promptDialog: { title: string; defaultValue: string; onConfirm: (val: string | null) => void | Promise<void> } | null;

  // --- Live Stream (Wikipedia) ---
  /** Whether the stream is currently connected. */
  streamRunning: boolean;
  /** Total events received since stream started. */
  streamTotalEvents: number;
  /** Current events per second rate. */
  streamEventsPerSec: number;
  /** Number of rows currently buffered in DuckDB. */
  streamBufferRows: number;
  /** Number of distinct wikis seen. */
  streamWikisSeen: number;
  /** Timestamp (epoch secs) when stream started; null if stopped. */
  streamStartedAt: number | null;
  /** Uptime in seconds. */
  streamUptimeSecs: number;
  /** Whether the stream view is active (file selected = stream://wiki). */
  streamActive: boolean;

  // --- Poll-based sources (USGS, Open-Meteo, NWS, World Bank) ---
  sourceStatuses: Record<string, { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; started_at: number | null; uptime_secs: number }>;

  // Actions
  setMountedFolder: (folder: string | null) => void;
  setFiles: (files: FileEntry[]) => void;
  setIsScanning: (v: boolean) => void;
  setInspectingFilePath: (path: string | null) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  setColumnStats: (stats: ColumnInfo[]) => void;
  setSampleRows: (rows: QueryResult | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setPanelTab: (tab: PanelTab) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setDataRegionOpen: (open: boolean) => void;
  setDataSourcesExpanded: (v: boolean) => void;
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
  setChartTitleOverride: (chartId: string, title: string | null) => void;
  setPngExportHandler: (fn: (() => Promise<Blob | null>) | null) => void;
  setSvgExportHandler: (fn: (() => Promise<string | null>) | null) => void;
  setSmartResults: (results: SmartResults | null | ((prev: SmartResults | null) => SmartResults | null)) => void;
  setAppSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  setRecentFiles: (files: FileEntry[]) => void;
  addRecentFile: (file: FileEntry) => void;
  setLastSession: (s: { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null) => void;
  setQueryHistory: (h: { sql: string; at: number }[]) => void;
  appendQueryHistory: (sql: string) => void;
  setQuerySnippets: (s: { name: string; sql: string }[]) => void;
  addQuerySnippet: (name: string, sql: string) => void;
  setTablePrefs: (p: { visibleColumns: string[] | null; columnOrder: string[] | null }) => void;
  setTableFilterRowIndices: (indices: number[] | null) => void;
  setTableColumnFilter: (column: string, value: string) => void;
  setTableColumnFilters: (filters: Record<string, string>) => void;
  pushTableUndo: () => void;
  undoTable: () => void;
  redoTable: () => void;
  setSelectedRowIndices: (indices: number[] | ((prev: number[]) => number[])) => void;
  setTableViews: (views: TableViewItem[]) => void;
  addTableView: (name: string, visibleColumns: string[] | null, columnOrder: string[] | null, columnFilters: Record<string, string>, querySql?: string | null, snapshotData?: { columns: string[]; types: string[]; rows: (string | number | boolean | null)[][]; total_rows: number }) => void;
  removeTableView: (id: string) => void;
  applyTableView: (id: string) => void;
  setQueryResultPage: (page: number) => void;
  setQueryResultPageSize: (size: number) => void;
  addChartAnnotation: (chartId: string, text: string, x?: number, y?: number) => void;
  removeChartAnnotation: (chartId: string, id: string) => void;
  setHoveredRowIndex: (idx: number | null) => void;
  setTooltipLink: (link: { field: string; value: string } | null) => void;
  addPinnedTooltip: (tt: { chartId: string; x: number; y: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] }) => void;
  removePinnedTooltip: (id: string) => void;
  clearPinnedTooltips: () => void;
  addCustomRefLine: (chartId: string, axis: "x" | "y", value: number, label: string) => void;
  removeCustomRefLine: (chartId: string, id: string) => void;
  setChartInteractionMode: (mode: "pan" | "crosshair" | "lasso") => void;
  setCrosshairPos: (pos: { dataX: number; dataY: number; screenX: number; screenY: number } | null) => void;
  setRulerPins: (pins: { x: number; y: number }[]) => void;
  setLassoPoints: (points: { x: number; y: number }[]) => void;
  setBarStackMode: (mode: "grouped" | "stacked" | "percent") => void;
  setConnectScatterTrail: (v: boolean) => void;
  setShowMarginals: (v: boolean) => void;
  addQuerySnapshot: (name: string, columns: string[], rows: (string | number | boolean | null)[][]) => void;
  removeQuerySnapshot: (id: string) => void;
  setNlQueryInput: (v: string) => void;
  setToast: (msg: string | null) => void;
  setChartViews: (views: ChartViewItem[]) => void;
  addChartView: (
    name: string,
    filePath: string,
    fileName: string,
    chart: ChartRecommendation,
    visualOverrides: ChartVisualOverrides,
    querySql?: string | null,
    snapshotData?: { columns: string[]; types: string[]; rows: (string | number | boolean | null)[][]; total_rows: number },
    snapshotImageDataUrl?: string | null
  ) => string | null;
  /** Create a dashboard and add chart views from a story sequence; returns dashboard id or null. Pass sampleData so applied views have data for capture. */
  createStoryDashboard: (
    filePath: string,
    fileName: string,
    storyTitle: string,
    charts: ChartRecommendation[],
    sampleData?: QueryResult | null,
  ) => string | null;
  removeChartView: (id: string) => void;
  setChartViewSnapshot: (viewId: string, dataUrl: string | null) => void;
  applyChartView: (id: string) => void;
  setQueryViews: (views: QueryViewItem[]) => void;
  addQueryView: (name: string, sql: string) => void;
  removeQueryView: (id: string) => void;
  applyQueryView: (id: string) => void;
  setDashboards: (dashboards: DashboardItem[]) => void;
  addDashboard: (name: string) => void;
  removeDashboard: (id: string) => void;
  setDashboardRefresh: (dashboardId: string, interval: DashboardRefreshInterval | null, lastRefreshedAt?: number) => void;
  setDashboardSlots: (dashboardId: string, slots: DashboardSlot[]) => void;
  setDashboardLayout: (dashboardId: string, template: DashboardLayoutTemplate) => void;
  moveDashboardSlot: (dashboardId: string, slotId: string, direction: "up" | "down") => void;
  addDashboardSlot: (dashboardId: string, viewType: "table" | "chart" | "query" | "snapshot", viewId: string) => void;
  removeDashboardSlot: (dashboardId: string, slotId: string) => void;
  setActiveDashboardId: (id: string | null) => void;
  setDashboardsExpanded: (v: boolean) => void;
  applyQuerySnapshot: (id: string) => void;
  setPromptDialog: (config: { title: string; defaultValue: string; onConfirm: (val: string | null) => void | Promise<void> } | null) => void;
  // Live stream actions
  setStreamStatus: (status: { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; wikis_seen: number; started_at: number | null; uptime_secs: number }) => void;
  setStreamActive: (v: boolean) => void;
  setSourceStatus: (kind: string, status: { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; started_at: number | null; uptime_secs: number }) => void;
  reset: () => void;
}

const initialState = {
  mountedFolder: null,
  files: [],
  isScanning: false,
  inspectingFilePath: null,
  selectedFile: null,
  columnStats: [],
  sampleRows: null,
  viewMode: "explorer" as ViewMode,
  panelTab: "chart" as PanelTab,
  sidebarOpen: true,
  panelOpen: true,
  dataRegionOpen: false,
  dataSourcesExpanded: false,
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
  chartTitleOverrides: {} as Record<string, string>,
  pngExportHandler: null as (() => Promise<Blob | null>) | null,
  svgExportHandler: null as (() => Promise<string | null>) | null,
  smartResults: null as SmartResults | null,
  appSettings: {
    theme: "dark" as AppTheme,
    fontScale: 1 as FontScale,
    reducedMotion: false,
  } as AppSettings,
  recentFiles: [] as FileEntry[],
  lastSession: null as { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null,
  queryHistory: [] as { sql: string; at: number }[],
  querySnippets: [] as { name: string; sql: string }[],
  tablePrefs: { visibleColumns: null as string[] | null, columnOrder: null as string[] | null },
  tableFilterRowIndices: null as number[] | null,
  tableColumnFilters: {} as Record<string, string>,
  tableUndoStack: [] as { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[],
  tableRedoStack: [] as { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[],
  selectedRowIndices: [] as number[],
  tableViews: [] as TableViewItem[],
  queryResultPage: 0,
  queryResultPageSize: 500,
  chartAnnotations: {} as Record<string, { id: string; text: string; x: number; y: number }[]>,
  hoveredRowIndex: null as number | null,
  tooltipLink: null as { field: string; value: string } | null,
  pinnedTooltips: [] as { id: string; chartId: string; x: number; y: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] }[],
  customRefLines: {} as Record<string, { id: string; axis: "x" | "y"; value: number; label: string }[]>,
  chartInteractionMode: "pan" as "pan" | "crosshair" | "lasso",
  crosshairPos: null as { dataX: number; dataY: number; screenX: number; screenY: number } | null,
  rulerPins: [] as { x: number; y: number }[],
  lassoPoints: [] as { x: number; y: number }[],
  barStackMode: "grouped" as "grouped" | "stacked" | "percent",
  connectScatterTrail: false,
  showMarginals: false,
  querySnapshots: [] as { id: string; name: string; columns: string[]; rows: (string | number | boolean | null)[][]; at: number }[],
  nlQueryInput: "",
  toastMessage: null as string | null,
  chartViews: [] as ChartViewItem[],
  queryViews: [] as QueryViewItem[],
  dashboards: [] as DashboardItem[],
  activeDashboardId: null as string | null,
  dashboardsExpanded: false,
  promptDialog: null as { title: string; defaultValue: string; onConfirm: (val: string | null) => void | Promise<void> } | null,
  streamRunning: false,
  streamTotalEvents: 0,
  streamEventsPerSec: 0,
  streamBufferRows: 0,
  streamWikisSeen: 0,
  streamStartedAt: null as number | null,
  streamUptimeSecs: 0,
  streamActive: false,
  sourceStatuses: {} as Record<string, { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; started_at: number | null; uptime_secs: number }>,
};

export const useLoomStore = create<LoomState>((set, get) => ({
  ...initialState,

  setMountedFolder: (folder) => set({ mountedFolder: folder }),
  setFiles: (files) => set({ files }),
  setIsScanning: (v) => set({ isScanning: v }),
  setInspectingFilePath: (path) => set({ inspectingFilePath: path }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setColumnStats: (stats) => set({ columnStats: stats }),
  setSampleRows: (rows) => set({ sampleRows: rows }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setDataRegionOpen: (open) => set({ dataRegionOpen: open }),
  setDataSourcesExpanded: (v) => set({ dataSourcesExpanded: v }),
  setQuerySql: (sql) => set({ querySql: sql }),
  setQueryResult: (result) => set({ queryResult: result, queryResultPage: 0 }),
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
  setChartTitleOverride: (chartId, title) =>
    set((s) => ({
      chartTitleOverrides:
        title == null
          ? (() => {
            const next = { ...s.chartTitleOverrides };
            delete next[chartId];
            return next;
          })()
          : { ...s.chartTitleOverrides, [chartId]: title },
    })),
  setPngExportHandler: (fn) => set({ pngExportHandler: fn }),
  setSvgExportHandler: (fn) => set({ svgExportHandler: fn }),
  setSmartResults: (results) =>
    set((s) => ({
      smartResults:
        typeof results === "function" ? results(s.smartResults) : results,
    })),
  setAppSettings: (settings) =>
    set((s) => ({
      appSettings:
        typeof settings === "function" ? settings(s.appSettings) : settings,
    })),
  setRecentFiles: (files) => set({ recentFiles: files }),
  addRecentFile: (file) =>
    set((s) => {
      const list = s.recentFiles.filter((f) => f.path !== file.path);
      list.unshift(file);
      return { recentFiles: list.slice(0, 20) };
    }),
  setLastSession: (sess) => set({ lastSession: sess }),
  setQueryHistory: (h) => set({ queryHistory: h }),
  appendQueryHistory: (sql) =>
    set((s) => {
      const t = sql.trim();
      if (!t) return s;
      const list = s.queryHistory.filter((q) => q.sql !== t);
      list.unshift({ sql: t, at: Date.now() });
      return { queryHistory: list.slice(0, 50) };
    }),
  setQuerySnippets: (s) => set({ querySnippets: s.slice(0, 30) }),
  addQuerySnippet: (name, sql) =>
    set((s) => {
      const trimmed = name.trim();
      if (!trimmed) return s;
      const list = s.querySnippets.filter((x) => x.name !== trimmed);
      list.unshift({ name: trimmed, sql: sql.trim() });
      return { querySnippets: list.slice(0, 30) };
    }),
  setTablePrefs: (p) => set({ tablePrefs: p }),
  setTableFilterRowIndices: (indices) => set({ tableFilterRowIndices: indices }),
  setTableColumnFilter: (column, value) =>
    set((s) => ({
      tableColumnFilters: value.trim() ? { ...s.tableColumnFilters, [column]: value.trim() } : (() => {
        const next = { ...s.tableColumnFilters };
        delete next[column];
        return next;
      })(),
    })),
  setTableColumnFilters: (filters) => set({ tableColumnFilters: { ...filters } }),
  pushTableUndo: () =>
    set((s) => {
      const snapshot = { tablePrefs: { ...s.tablePrefs, visibleColumns: s.tablePrefs.visibleColumns ? [...s.tablePrefs.visibleColumns] : null, columnOrder: s.tablePrefs.columnOrder ? [...s.tablePrefs.columnOrder] : null }, tableColumnFilters: { ...s.tableColumnFilters } };
      return { tableUndoStack: [snapshot, ...s.tableUndoStack].slice(0, 20), tableRedoStack: [] };
    }),
  undoTable: () =>
    set((s) => {
      if (s.tableUndoStack.length === 0) return s;
      const [snap, ...rest] = s.tableUndoStack;
      const current = { tablePrefs: { ...s.tablePrefs, visibleColumns: s.tablePrefs.visibleColumns ? [...s.tablePrefs.visibleColumns] : null, columnOrder: s.tablePrefs.columnOrder ? [...s.tablePrefs.columnOrder] : null }, tableColumnFilters: { ...s.tableColumnFilters } };
      return { tablePrefs: snap.tablePrefs, tableColumnFilters: snap.tableColumnFilters, tableUndoStack: rest, tableRedoStack: [current, ...s.tableRedoStack].slice(0, 20) };
    }),
  redoTable: () =>
    set((s) => {
      if (s.tableRedoStack.length === 0) return s;
      const [snap, ...rest] = s.tableRedoStack;
      const current = { tablePrefs: { ...s.tablePrefs, visibleColumns: s.tablePrefs.visibleColumns ? [...s.tablePrefs.visibleColumns] : null, columnOrder: s.tablePrefs.columnOrder ? [...s.tablePrefs.columnOrder] : null }, tableColumnFilters: { ...s.tableColumnFilters } };
      return { tablePrefs: snap.tablePrefs, tableColumnFilters: snap.tableColumnFilters, tableRedoStack: rest, tableUndoStack: [current, ...s.tableUndoStack].slice(0, 20) };
    }),
  setSelectedRowIndices: (indices) =>
    set((s) => ({
      selectedRowIndices: typeof indices === "function" ? indices(s.selectedRowIndices) : indices,
    })),
  setTableViews: (views) => set({ tableViews: views.slice(0, 20) }),
  addTableView: (name, visibleColumns, columnOrder, columnFilters, querySql, snapshotData) =>
    set((s) => ({
      tableViews: [
        { id: `v-${Date.now()}`, name: name.trim() || "View", visibleColumns, columnOrder, columnFilters: { ...columnFilters }, querySql, snapshotData },
        ...s.tableViews.slice(0, 19),
      ],
    })),
  removeTableView: (id) =>
    set((s) => ({ tableViews: s.tableViews.filter((v) => v.id !== id) })),
  applyTableView: (id) =>
    set((s) => {
      const v = s.tableViews.find((x) => x.id === id);
      if (!v) return s;

      const updateData: Partial<LoomState> = {
        tablePrefs: { visibleColumns: v.visibleColumns, columnOrder: v.columnOrder },
        tableColumnFilters: v.columnFilters,
        viewMode: "explorer" as ViewMode,
        dashboardsExpanded: false,
      };

      if (v.snapshotData) {
        updateData.sampleRows = v.snapshotData;
        updateData.columnStats = v.snapshotData.columns.map((c, i) => ({
          name: c,
          data_type: v.snapshotData?.types[i] || "VARCHAR",
          null_count: 0,
          distinct_count: 0,
          min_value: null,
          max_value: null,
        }));
      }

      if (v.querySql) {
        updateData.querySql = v.querySql;
      }

      return updateData;
    }),
  setQueryResultPage: (page) => set({ queryResultPage: Math.max(0, page) }),
  setQueryResultPageSize: (size) => set({ queryResultPageSize: Math.max(100, Math.min(5000, size)) }),
  addChartAnnotation: (chartId, text, x = 0.5, y = 0.5) =>
    set((s) => {
      const list = s.chartAnnotations[chartId] ?? [];
      return {
        chartAnnotations: {
          ...s.chartAnnotations,
          [chartId]: [...list, { id: `ann-${Date.now()}`, text, x, y }],
        },
      };
    }),
  removeChartAnnotation: (chartId, id) =>
    set((s) => ({
      chartAnnotations: {
        ...s.chartAnnotations,
        [chartId]: (s.chartAnnotations[chartId] ?? []).filter((a) => a.id !== id),
      },
    })),
  setHoveredRowIndex: (idx) => set({ hoveredRowIndex: idx }),
  setTooltipLink: (link) => set({ tooltipLink: link }),
  addPinnedTooltip: (tt) =>
    set((s) => ({
      pinnedTooltips: [...s.pinnedTooltips.slice(-4), { ...tt, id: `pt-${Date.now()}` }],
    })),
  removePinnedTooltip: (id) =>
    set((s) => ({ pinnedTooltips: s.pinnedTooltips.filter((t) => t.id !== id) })),
  clearPinnedTooltips: () => set({ pinnedTooltips: [] }),
  addCustomRefLine: (chartId, axis, value, label) =>
    set((s) => ({
      customRefLines: {
        ...s.customRefLines,
        [chartId]: [...(s.customRefLines[chartId] ?? []), { id: `rl-${Date.now()}`, axis, value, label }],
      },
    })),
  removeCustomRefLine: (chartId, id) =>
    set((s) => ({
      customRefLines: {
        ...s.customRefLines,
        [chartId]: (s.customRefLines[chartId] ?? []).filter((l) => l.id !== id),
      },
    })),
  setChartInteractionMode: (mode) => set({ chartInteractionMode: mode }),
  setCrosshairPos: (pos) => set({ crosshairPos: pos }),
  setRulerPins: (pins) => set({ rulerPins: pins }),
  setLassoPoints: (points) => set({ lassoPoints: points }),
  setBarStackMode: (mode) => set({ barStackMode: mode }),
  setConnectScatterTrail: (v) => set({ connectScatterTrail: v }),
  setShowMarginals: (v) => set({ showMarginals: v }),
  addQuerySnapshot: (name, columns, rows) =>
    set((s) => ({
      querySnapshots: [
        { id: `snap-${Date.now()}`, name, columns, rows, at: Date.now() },
        ...s.querySnapshots.slice(0, 9),
      ],
    })),
  removeQuerySnapshot: (id) =>
    set((s) => ({ querySnapshots: s.querySnapshots.filter((x) => x.id !== id) })),
  setNlQueryInput: (v) => set({ nlQueryInput: v }),
  setToast: (msg) => set({ toastMessage: msg }),
  setChartViews: (views) => set({ chartViews: views.slice(0, 30) }),
  addChartView: (name, filePath, fileName, chart, visualOverrides, querySql, snapshotData, snapshotImageDataUrl) => {
    const id = `cv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let ok = false;
    set((s) => {
      try {
        const chartCopy = JSON.parse(JSON.stringify(chart)) as ChartRecommendation;
        const overridesCopy = JSON.parse(JSON.stringify(visualOverrides)) as ChartVisualOverrides;
        ok = true;
        return {
          chartViews: [
            {
              id,
              name: name.trim() || "Chart view",
              filePath,
              fileName,
              chart: chartCopy,
              visualOverrides: overridesCopy,
              querySql,
              snapshotData,
              snapshotImageDataUrl: snapshotImageDataUrl ?? null,
            },
            ...s.chartViews.slice(0, 29),
          ],
        };
      } catch {
        return s;
      }
    });
    return ok ? id : null;
  },
  createStoryDashboard: (filePath, fileName, storyTitle, charts, sampleData) => {
    if (charts.length === 0) return null;
    const now = Date.now();
    const dbId = `db-${now}`;
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
      const visualOverrides = s.chartVisualOverrides;
      const newChartViews: ChartViewItem[] = [];
      const slots: DashboardSlot[] = [];
      try {
        for (const rec of charts) {
          const id = `cv-${now}-${Math.random().toString(36).slice(2, 8)}`;
          const chartCopy = JSON.parse(JSON.stringify(rec)) as ChartRecommendation;
          const overridesCopy = JSON.parse(JSON.stringify(visualOverrides)) as ChartVisualOverrides;
          newChartViews.push({
            id,
            name: (rec.title || `${rec.kind} chart`).trim(),
            filePath,
            fileName,
            chart: chartCopy,
            visualOverrides: overridesCopy,
            querySql: null,
            snapshotData,
            snapshotImageDataUrl: null,
          });
          slots.push({ id: `ds-${now}-${slots.length}`, viewType: "chart", viewId: id });
        }
        const isStream = filePath.startsWith("stream://");
        const layoutTemplate: DashboardLayoutTemplate = isStream
          ? "stream"
          : charts.length <= 2 ? "2x1" : charts.length <= 4 ? "2x2" : "3x2";
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
    return get().activeDashboardId ?? dbId;
  },
  removeChartView: (id) =>
    set((s) => ({ chartViews: s.chartViews.filter((v) => v.id !== id) })),
  setChartViewSnapshot: (viewId, dataUrl) =>
    set((s) => ({
      chartViews: s.chartViews.map((v) =>
        v.id === viewId ? { ...v, snapshotImageDataUrl: dataUrl ?? null } : v,
      ),
    })),
  applyChartView: (id) =>
    set((s) => {
      const v = s.chartViews.find((x) => x.id === id);
      if (!v) return s;
      const file = s.files.find((f) => f.path === v.filePath) ?? null;
      const updateData: Partial<LoomState> = {
        activeChart: v.chart,
        vegaSpec: v.chart.spec ?? null,
        chartVisualOverrides: v.visualOverrides,
        viewMode: "chart" as ViewMode,
        dashboardsExpanded: false,
      };

      if (v.filePath) {
        updateData.selectedFile = file || s.selectedFile;
      }

      if (v.snapshotData) {
        updateData.sampleRows = v.snapshotData;
        updateData.columnStats = v.snapshotData.columns.map((c, i) => ({
          name: c,
          data_type: v.snapshotData?.types[i] || "VARCHAR",
          null_count: 0,
          distinct_count: 0,
          min_value: null,
          max_value: null,
        }));
      }

      if (v.querySql) {
        updateData.querySql = v.querySql;
      }

      return updateData;
    }),
  setQueryViews: (views) => set({ queryViews: views.slice(0, 30) }),
  addQueryView: (name, sql) =>
    set((s) => ({
      queryViews: [
        { id: `qv-${Date.now()}`, name: name.trim() || "Query view", sql: sql.trim() },
        ...s.queryViews.slice(0, 29),
      ],
    })),
  removeQueryView: (id) =>
    set((s) => ({ queryViews: s.queryViews.filter((v) => v.id !== id) })),
  applyQueryView: (id) =>
    set((s) => {
      const v = s.queryViews.find((x) => x.id === id);
      if (!v) return s;
      return { querySql: v.sql, viewMode: "query" as ViewMode };
    }),
  setDashboards: (dashboards) => set({ dashboards: dashboards.slice(0, 20) }),
  addDashboard: (name) =>
    set((s) => {
      const id = `db-${Date.now()}`;
      const now = Date.now();
        return {
        dashboards: [
          { id, name: name.trim() || "Dashboard", slots: [], layoutTemplate: "auto", refreshInterval: "manual", lastRefreshedAt: now },
          ...s.dashboards.slice(0, 19),
        ],
        activeDashboardId: id,
      };
    }),
  setDashboardRefresh: (dashboardId, interval, lastRefreshedAt) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id === dashboardId
          ? {
              ...d,
              refreshInterval: interval ?? d.refreshInterval,
              lastRefreshedAt: lastRefreshedAt ?? d.lastRefreshedAt,
            }
          : d
      ),
    })),
  removeDashboard: (id) =>
    set((s) => ({
      dashboards: s.dashboards.filter((d) => d.id !== id),
      activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
    })),
  setDashboardSlots: (dashboardId, slots) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, slots: slots.slice(0, 24) } : d
      ),
    })),
  setDashboardLayout: (dashboardId, layoutTemplate) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id === dashboardId ? { ...d, layoutTemplate } : d
      ),
    })),
  moveDashboardSlot: (dashboardId, slotId, direction) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const i = d.slots.findIndex((sl) => sl.id === slotId);
        if (i < 0) return d;
        const next = [...d.slots];
        const j = direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= next.length) return d;
        [next[i], next[j]] = [next[j], next[i]];
        return { ...d, slots: next };
      }),
    })),
  addDashboardSlot: (dashboardId, viewType, viewId) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        return {
          ...d,
          slots: [...d.slots, { id: `ds-${Date.now()}`, viewType, viewId }],
        };
      }),
    })),
  removeDashboardSlot: (dashboardId, slotId) =>
    set((s) => ({
      dashboards: s.dashboards.map((d) =>
        d.id === dashboardId
          ? { ...d, slots: d.slots.filter((sl) => sl.id !== slotId) }
          : d
      ),
    })),
  setActiveDashboardId: (id) => set({ activeDashboardId: id }),
  setDashboardsExpanded: (v) => set({ dashboardsExpanded: v }),
  applyQuerySnapshot: (id) =>
    set((s) => {
      const snap = s.querySnapshots.find((x) => x.id === id);
      if (!snap) return s;
      const fakeResult = {
        columns: snap.columns,
        types: snap.columns.map(() => "VARCHAR"),
        rows: snap.rows,
        total_rows: snap.rows.length,
      };
      return {
        sampleRows: fakeResult,
        columnStats: snap.columns.map((c) => ({
          name: c,
          data_type: "VARCHAR",
          null_count: 0,
          distinct_count: 0,
          min_value: null,
          max_value: null,
        })),
        viewMode: "explorer" as ViewMode,
      };
    }),
  setPromptDialog: (config) => set({ promptDialog: config }),
  setStreamStatus: (status) =>
    set({
      streamRunning: status.running,
      streamTotalEvents: status.total_events,
      streamEventsPerSec: status.events_per_sec,
      streamBufferRows: status.buffer_rows,
      streamWikisSeen: status.wikis_seen,
      streamStartedAt: status.started_at,
      streamUptimeSecs: status.uptime_secs,
    }),
  setStreamActive: (v) => set({ streamActive: v }),
  setSourceStatus: (kind, status) =>
    set((s) => ({ sourceStatuses: { ...s.sourceStatuses, [kind]: status } })),
  reset: () => set(initialState),
}));
