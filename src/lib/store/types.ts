// =================================================================
// Loom Store — Shared Type Definitions (LOOM-552)
// =================================================================
// All types that define the shape of LoomState live here.
// Slices and store.ts import from this module to avoid circular deps.
// =================================================================

import type { DiveLink, DiveQuery } from "../dive";
import type { ChartLink } from "../chartLink";
import type { ChartRecommendation } from "../recommendations";
import type { ChartChromeFocus, ChartChromeSection } from "../chartChromeLink";
import type {
  AnomalyResult,
  ForecastResult,
  TrendResult,
  ReferenceLinesResult,
  ClusterResult,
} from "../smartAnalytics";
import type { ChartAspectId, ChartDeviceId } from "../chartViewport";
import type {
  ExportBurnInOptions,
  SocialExportTarget,
  SocialPresetId,
} from "../socialExport";
import type { VizPreferenceModel } from "../vizPreferences";
import type { SourcePreferences, SourceReaction } from "../sourcePreferences";
import type { SourceRef } from "../sourceRef";
import type { ChartVisualOverrides } from "../chartVisualTypes";
import type { ColumnInfo, QueryResult } from "../queryTypes";

export type { ChartAspectId, ChartDeviceId };
export type { ChartVisualOverrides } from "../chartVisualTypes";
export type { ColumnInfo, QueryResult } from "../queryTypes";

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
  linkedLastModified?: number;
  sourceUrl?: string;
  sourceHome?: string;
  sourceCredit?: string;
  capturedAt?: string;
  originPath?: string;
}

export type ViewMode = "explorer" | "chart" | "query" | "dive";
export type PanelTab = "stats" | "chart" | "export" | "smart" | "settings" | "dashboards";

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
  snapshotImageDataUrl?: string | null;
}

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

export interface QueryViewItem {
  id: string;
  name: string;
  sql: string;
}

export interface DashboardSlot {
  id: string;
  viewType: "table" | "chart" | "query" | "snapshot";
  viewId: string;
}

export type DashboardRefreshInterval = "manual" | "1m" | "5m" | "15m" | "1h" | "1d";

export type DashboardLayoutTemplate =
  | "auto"
  | "1x1"
  | "2x1"
  | "2x2"
  | "3x2"
  | "1+2"
  | "stream";

export interface DashboardItem {
  id: string;
  name: string;
  slots: DashboardSlot[];
  layoutTemplate?: DashboardLayoutTemplate;
  refreshInterval?: DashboardRefreshInterval;
  lastRefreshedAt?: number;
}

export type PromptDialogConfig = {
  title: string;
  defaultValue?: string;
  message?: string;
  confirmLabel?: string;
  /** Optional second confirm (e.g. “Save and go to Dashboards”). */
  secondaryConfirmLabel?: string;
  onConfirm: (val: string | null) => void | Promise<void>;
  onSecondaryConfirm?: (val: string) => void | Promise<void>;
};

export type AppTheme =
  | "system"
  | "light"
  | "dark"
  | "contrast"
  | "paper"
  | "glass"
  | "frost"
  | "brutal"
  | "loom"
  | "tank"
  | "nes"
  | "high-contrast"
  | "colorblind";

export type FontScale = 0.9 | 1 | 1.1 | 1.15;

export type UiChrome =
  | "braun"
  | "monocle"
  | "bauhaus"
  | "noyes"
  | "ikea"
  | "military"
  | "terminal"
  | "nyt";

export type AppFontId =
  | "libre-baskerville"
  | "lora"
  | "ibm-plex"
  | "inter"
  | "geist"
  | "jetbrains-mono"
  | "fira-code";

export type FacesSource = "auto" | "web" | "local";

export interface AppSettings {
  theme: AppTheme;
  uiChrome: UiChrome;
  font: AppFontId;
  faces: FacesSource;
  fontScale: FontScale;
  reducedMotion: boolean;
  colorblindCharts: boolean;
  chartAspect: ChartAspectId;
  chartDevice: ChartDeviceId;
}

export interface LoomState {
  // Folder
  mountedFolder: string | null;
  files: FileEntry[];
  isScanning: boolean;
  inspectingFilePath: string | null;

  // Selection
  selectedFile: FileEntry | null;
  columnStats: ColumnInfo[];
  sampleRows: QueryResult | null;

  // View
  viewMode: ViewMode;
  panelTab: PanelTab;
  chartPanelSection: ChartChromeSection;
  chartChromeFocus: ChartChromeFocus | null;
  sidebarOpen: boolean;
  panelOpen: boolean;
  dataRegionOpen: boolean;
  dataSourcesExpanded: boolean;
  /** Chart view: suggestion thumbnails left of the canvas (hide for max chart width). */
  suggestionsRailOpen: boolean;

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
  aiSuggestionReason: string | null;
  webFileCache: Record<string, { stats: ColumnInfo[]; sample: QueryResult }>;
  webImportOperationId: number;
  chartTitleOverrides: Record<string, string>;
  pngExportHandler: (() => Promise<Blob | null>) | null;
  svgExportHandler: (() => Promise<string | null>) | null;
  svgExportLabel: string | null;

  smartResults: SmartResults | null;

  appSettings: AppSettings;

  recentFiles: FileEntry[];
  lastSession: { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null;
  queryHistory: { sql: string; at: number }[];
  querySnippets: { name: string; sql: string }[];
  tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null };
  tableFilterRowIndices: number[] | null;
  tableColumnFilters: Record<string, string>;
  /** Explorer sort — shared with Chart so order can match the table. */
  tableSortColumn: string | null;
  tableSortDir: "asc" | "desc" | null;
  /** Shared time slice (Explorer + Chart). */
  viewTimeField: string | null;
  viewTimeWindow: import("../chartTime").ChartTimeRange;
  /** Keep this color field when switching chart kinds. */
  lockedColorField: string | null;
  /** Lasso/brush selection also filters the Explorer/Chart cohort. */
  brushLinksFilter: boolean;
  /** Stats tab scrolls to this column when set. */
  statsFocusColumn: string | null;
  tableUndoStack: { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[];
  tableRedoStack: { tablePrefs: { visibleColumns: string[] | null; columnOrder: string[] | null }; tableColumnFilters: Record<string, string> }[];
  selectedRowIndices: number[];
  tableViews: TableViewItem[];
  queryResultPage: number;
  queryResultPageSize: number;
  chartAnnotations: Record<string, { id: string; text: string; x: number; y: number; width?: number; fontSize?: number }[]>;
  hoveredRowIndex: number | null;
  tooltipLink: { field: string; value: string } | null;
  pinnedTooltips: { id: string; chartId: string; x: number; y: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] }[];
  customRefLines: Record<string, { id: string; axis: "x" | "y"; value: number; label: string }[]>;
  chartInteractionMode: "pan" | "crosshair" | "lasso" | "select";
  crosshairPos: { dataX: number; dataY: number; screenX: number; screenY: number } | null;
  rulerPins: { x: number; y: number }[];
  lassoPoints: { x: number; y: number }[];
  barStackMode: "grouped" | "stacked" | "percent";
  connectScatterTrail: boolean;
  showMarginals: boolean;
  querySnapshots: { id: string; name: string; columns: string[]; rows: (string | number | boolean | null)[][]; at: number }[];
  diveQuery: { src: string; query: DiveQuery } | null;
  diveLink: DiveLink | null;
  chartLink: ChartLink | null;
  nlQueryInput: string;
  toastMessage: string | null;
  toastShowUndo: boolean;
  dashboardUndoSnapshot: { dashboards: DashboardItem[]; activeDashboardId: string | null } | null;
  chartEditUndoStack: import("../chartEditHistory").ChartEditSnapshot[];
  chartEditRedoStack: import("../chartEditHistory").ChartEditSnapshot[];
  chartEditGroup: { key: string; at: number } | null;
  customChartLooks: import("../customChartLooks").CustomChartLook[];
  chartViews: ChartViewItem[];
  queryViews: QueryViewItem[];
  dashboards: DashboardItem[];
  activeDashboardId: string | null;
  dashboardsExpanded: boolean;
  previewCapture: {
    dashboardId: string;
    current: number;
    total: number;
    label: string;
  } | null;

  socialExportTarget: SocialExportTarget | null;
  socialExportReady: boolean;
  exportBurnIn: ExportBurnInOptions;
  exportSupersample: 1 | 2;
  socialPresetId: SocialPresetId;
  shareSheetOpen: boolean;
  whatsNewOpen: boolean;

  promptDialog: PromptDialogConfig | null;

  // Live Stream
  streamRunning: boolean;
  streamTotalEvents: number;
  streamEventsPerSec: number;
  streamBufferRows: number;
  streamWikisSeen: number;
  streamStartedAt: number | null;
  sourceStatuses: Record<
    string,
    {
      running: boolean;
      total_events: number;
      events_per_sec: number;
      buffer_rows: number;
      started_at: number | null;
      last_error?: string | null;
      last_success_at?: number | null;
      snapshot_stale?: boolean;
      snapshot_captured_at?: number | null;
    }
  >;

  /** Per-source ♥ / 👎 / Hide / 🔖 + implicit opens (sourcePreferences.ts). */
  sourcePrefs: SourcePreferences;

  // Deep scan / viz swipe
  vizPreferences: VizPreferenceModel;
  vizSwipeOpen: boolean;
  vizSwipeDeck: ChartRecommendation[];
  vizSwipeIndex: number;
  vizScanStatus: "idle" | "scanning" | "ready" | "done";
  vizScanMessage: string | null;
  vizSwipeKept: number;
  vizSwipeSkipped: number;
  vizSchemaSignature: string | null;

  // Actions
  setMountedFolder: (folder: string | null) => void;
  setFiles: (files: FileEntry[]) => void;
  setIsScanning: (v: boolean) => void;
  setInspectingFilePath: (path: string | null) => void;
  setSelectedFile: (file: FileEntry | null) => void;
  resetDatasetScoped: () => void;
  openDataset: (payload: {
    file: FileEntry;
    stats?: ColumnInfo[];
    sample?: QueryResult | null;
    chartRecs?: ChartRecommendation[];
    activeChart?: ChartRecommendation | null;
    inspectingFilePath?: string | null;
    extra?: Partial<LoomState>;
  }) => void;
  setColumnStats: (stats: ColumnInfo[]) => void;
  setSampleRows: (rows: QueryResult | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setDiveQuery: (v: { src: string; query: DiveQuery } | null) => void;
  setDiveLink: (v: DiveLink | null) => void;
  setChartLink: (v: ChartLink | null) => void;
  setPanelTab: (tab: PanelTab) => void;
  setChartPanelSection: (section: ChartChromeSection) => void;
  setChartChromeFocus: (focus: ChartChromeFocus | null) => void;
  setPanelOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setDataRegionOpen: (open: boolean) => void;
  setDataSourcesExpanded: (v: boolean) => void;
  setSuggestionsRailOpen: (open: boolean) => void;
  toggleSuggestionsRail: () => void;
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
  beginWebImport: () => number;
  isActiveWebImport: (id: number) => boolean;
  setChartTitleOverride: (chartId: string, title: string | null) => void;
  setPngExportHandler: (fn: (() => Promise<Blob | null>) | null) => void;
  setSvgExportHandler: (fn: (() => Promise<string | null>) | null) => void;
  setSvgExportLabel: (label: string | null) => void;
  setSmartResults: (results: SmartResults | null | ((prev: SmartResults | null) => SmartResults | null)) => void;
  setAppSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  setRecentFiles: (files: FileEntry[]) => void;
  addRecentFile: (file: FileEntry) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  setLastSession: (s: { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null) => void;
  setQueryHistory: (h: { sql: string; at: number }[]) => void;
  appendQueryHistory: (sql: string) => void;
  setQuerySnippets: (s: { name: string; sql: string }[]) => void;
  addQuerySnippet: (name: string, sql: string) => void;
  setTablePrefs: (p: { visibleColumns: string[] | null; columnOrder: string[] | null }) => void;
  setTableFilterRowIndices: (indices: number[] | null) => void;
  setTableColumnFilter: (column: string, value: string) => void;
  setTableColumnFilters: (filters: Record<string, string>) => void;
  setTableSort: (column: string | null, dir: "asc" | "desc" | null) => void;
  setViewTimeWindow: (field: string | null, range: import("../chartTime").ChartTimeRange) => void;
  setLockedColorField: (field: string | null) => void;
  setBrushLinksFilter: (v: boolean) => void;
  setStatsFocusColumn: (column: string | null) => void;
  applyBrushSelection: (indices: number[]) => void;
  resetViewCohort: () => void;
  unlockColorAndResetLocks: () => void;
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
  updateChartAnnotation: (chartId: string, id: string, patch: { x?: number; y?: number; width?: number; fontSize?: number }) => void;
  removeChartAnnotation: (chartId: string, id: string) => void;
  setHoveredRowIndex: (idx: number | null) => void;
  setTooltipLink: (link: { field: string; value: string } | null) => void;
  addPinnedTooltip: (tt: { chartId: string; x: number; y: number; rowIndex: number; row: (string | number | boolean | null)[]; columns: string[] }) => void;
  removePinnedTooltip: (id: string) => void;
  clearPinnedTooltips: () => void;
  addCustomRefLine: (chartId: string, axis: "x" | "y", value: number, label: string) => void;
  removeCustomRefLine: (chartId: string, id: string) => void;
  setChartInteractionMode: (mode: "pan" | "crosshair" | "lasso" | "select") => void;
  setCrosshairPos: (pos: { dataX: number; dataY: number; screenX: number; screenY: number } | null) => void;
  setRulerPins: (pins: { x: number; y: number }[]) => void;
  setLassoPoints: (points: { x: number; y: number }[]) => void;
  setBarStackMode: (mode: "grouped" | "stacked" | "percent") => void;
  setConnectScatterTrail: (v: boolean) => void;
  setShowMarginals: (v: boolean) => void;
  addQuerySnapshot: (name: string, columns: string[], rows: (string | number | boolean | null)[][]) => void;
  removeQuerySnapshot: (id: string) => void;
  setNlQueryInput: (v: string) => void;
  setToast: (msg: string | null, options?: { undo?: boolean }) => void;
  restoreDashboardUndo: () => void;
  clearDashboardUndo: () => void;
  pushChartEditUndo: () => void;
  undoChartEdit: () => void;
  redoChartEdit: () => void;
  editChartVisualOverrides: (patch: ChartVisualOverrides, groupKey?: string) => void;
  saveCustomChartLook: (name: string) => string | null;
  applyCustomChartLook: (id: string) => void;
  removeCustomChartLook: (id: string) => void;
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
  setPreviewCapture: (
    v: {
      dashboardId: string;
      current: number;
      total: number;
      label: string;
    } | null,
  ) => void;
  setSocialExportTarget: (v: SocialExportTarget | null) => void;
  setSocialExportReady: (v: boolean) => void;
  setExportBurnIn: (
    v: ExportBurnInOptions | ((prev: ExportBurnInOptions) => ExportBurnInOptions),
  ) => void;
  setExportSupersample: (v: 1 | 2) => void;
  setSocialPresetId: (v: SocialPresetId) => void;
  setShareSheetOpen: (v: boolean) => void;
  setWhatsNewOpen: (v: boolean) => void;
  applyQuerySnapshot: (id: string) => void;
  setPromptDialog: (config: PromptDialogConfig | null) => void;
  setStreamStatus: (status: { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; wikis_seen: number; started_at: number | null }) => void;
  setSourceStatus: (
    kind: string,
    status: {
      running: boolean;
      total_events: number;
      events_per_sec: number;
      buffer_rows: number;
      started_at: number | null;
      last_error?: string | null;
      last_success_at?: number | null;
      snapshot_stale?: boolean;
      snapshot_captured_at?: number | null;
    },
  ) => void;
  setVizPreferences: (model: VizPreferenceModel) => void;
  setSourcePrefs: (prefs: SourcePreferences) => void;
  /** Set or clear (null) a source's reaction. */
  reactToSource: (ref: SourceRef, reaction: SourceReaction | null) => void;
  toggleSavedSource: (ref: SourceRef) => void;
  noteSourceOpened: (ref: SourceRef) => void;
  startDeepScan: () => void;
  swipeViz: (direction: "left" | "right") => void;
  closeVizSwipe: () => void;
  resetWorkspace: () => void;
  resetPreferencesInStore: () => void;
  clearRetainedLocalData: () => Promise<void>;
  reset: () => void;
}
