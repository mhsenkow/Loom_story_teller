// =================================================================
// Loom — Global State (Zustand)
// =================================================================
// Thin composition root (LOOM-552). Types live in store/types.ts;
// actions live in store/*Slice.ts; initialState in store/helpers.ts.
// =================================================================

export { useLoomStore } from "./store/index";
export type {
  SmartResults,
  FileEntry,
  ViewMode,
  PanelTab,
  ChartViewItem,
  TableViewItem,
  QueryViewItem,
  DashboardSlot,
  DashboardRefreshInterval,
  DashboardLayoutTemplate,
  DashboardItem,
  PromptDialogConfig,
  AppTheme,
  FontScale,
  UiChrome,
  AppFontId,
  FacesSource,
  AppSettings,
  LoomState,
  ChartAspectId,
  ChartDeviceId,
  ChartVisualOverrides,
  ColumnInfo,
  QueryResult,
} from "./store/types";
