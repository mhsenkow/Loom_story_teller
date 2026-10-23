import { createDataLibrarySlice } from "./dataLibrarySlice";
// =================================================================
// Loom — Global State (Zustand) — slice composition (LOOM-552)
// =================================================================

import { create } from "zustand";
import type { LoomState } from "./types";
import { initialState } from "./helpers";
import { createCoreSlice } from "./coreSlice";
import { createChartSlice } from "./chartSlice";
import { createQuerySlice } from "./querySlice";
import { createTableSlice } from "./tableSlice";
import { createDashboardSlice } from "./dashboardSlice";
import { createUiSlice } from "./uiSlice";
import { createPointerViewsSlice } from "./pointerViewsSlice";
import { createMonitorSlice } from "./monitorSlice";

export const useLoomStore = create<LoomState>((set, get) => ({
  ...(initialState as unknown as LoomState),
  ...createCoreSlice(set, get, initialState),
  ...createDataLibrarySlice(set),
  ...createChartSlice(set, get),
  ...createQuerySlice(set),
  ...createTableSlice(set),
  ...createDashboardSlice(set),
  ...createPointerViewsSlice(set),
  ...createUiSlice(set, get, initialState),
  ...createMonitorSlice(set, get, undefined as never),
}));

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
} from "./types";
