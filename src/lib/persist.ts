// =================================================================
// Loom — Persist state to localStorage (browser)
// =================================================================
// Keys and (de)serialization for app settings, recent files, last session,
// query history, and table preferences. No-op when localStorage is unavailable.
// =================================================================

import {
  parsePersistedAppSettings,
  parsePersistedChartViews,
  parsePersistedDashboards,
  parsePersistedQueryViews,
} from "./persistValidation";
import { migrateAppSettingsV0, unwrapPersist, wrapPersist } from "./persistEnvelope";
import { parseCustomChartLooks, type CustomChartLook } from "./customChartLooks";

const KEY_APP_SETTINGS = "loom-app-settings";
const KEY_CUSTOM_CHART_LOOKS = "loom-custom-chart-looks";
const KEY_RECENT_FILES = "loom-recent-files";
const KEY_LAST_SESSION = "loom-last-session";
const KEY_QUERY_HISTORY = "loom-query-history";
const KEY_TABLE_PREFS = "loom-table-prefs";
const KEY_QUERY_SNIPPETS = "loom-query-snippets";
const KEY_TABLE_VIEWS = "loom-table-views";
const KEY_CHART_VIEWS = "loom-chart-views";
const KEY_QUERY_VIEWS = "loom-query-views";
const KEY_DASHBOARDS = "loom-dashboards";
const KEY_VIZ_PREFERENCES = "loom-viz-preferences";
export const KEY_SOURCE_PREFERENCES = "loom-source-preferences";
const MAX_RECENT_FILES = 20;
const MAX_QUERY_HISTORY = 50;
const MAX_QUERY_SNIPPETS = 30;

function safeGetItem(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @returns false when quota exceeded or storage is unavailable */
export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export interface PersistedAppSettings {
  theme?: string;
  uiChrome?: string;
  font?: string;
  faces?: string;
  fontScale?: number;
  reducedMotion?: boolean;
  colorblindCharts?: boolean;
  chartAspect?: string;
  chartDevice?: string;
}

export function getPersistedAppSettings(): PersistedAppSettings | null {
  const raw = safeGetItem(KEY_APP_SETTINGS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const data = unwrapPersist(parsed, (v, d) =>
      v === 0 ? migrateAppSettingsV0(d) : null,
    );
    if (!data) return null;
    return parsePersistedAppSettings(data);
  } catch {
    return null;
  }
}

export function setPersistedAppSettings(s: PersistedAppSettings): boolean {
  return safeSetItem(KEY_APP_SETTINGS, JSON.stringify(wrapPersist(s)));
}

export function getCustomChartLooks(): CustomChartLook[] {
  const raw = safeGetItem(KEY_CUSTOM_CHART_LOOKS);
  if (!raw) return [];
  try {
    return parseCustomChartLooks(unwrapPersist(JSON.parse(raw)));
  } catch {
    return [];
  }
}

export function setPersistedCustomChartLooks(looks: CustomChartLook[]): boolean {
  return safeSetItem(KEY_CUSTOM_CHART_LOOKS, JSON.stringify(wrapPersist(looks)));
}

export interface RecentFileEntry {
  path: string;
  name: string;
  extension: string;
  row_count: number;
  size_bytes: number;
  /** Remote CSV URL for web re-open (not the row data). */
  sourceUrl?: string;
  sourceHome?: string;
  sourceCredit?: string;
  capturedAt?: string;
  originPath?: string;
}

export function getRecentFiles(): RecentFileEntry[] {
  const raw = safeGetItem(KEY_RECENT_FILES);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RecentFileEntry[];
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT_FILES) : [];
  } catch {
    return [];
  }
}

export function setPersistedRecentFiles(files: RecentFileEntry[]): boolean {
  return safeSetItem(KEY_RECENT_FILES, JSON.stringify(files.slice(0, MAX_RECENT_FILES)));
}

export function setPersistedQueryHistory(items: QueryHistoryItem[]): boolean {
  return safeSetItem(KEY_QUERY_HISTORY, JSON.stringify(items.slice(0, MAX_QUERY_HISTORY)));
}

export interface LastSession {
  folderPath: string | null;
  filePath: string | null;
  viewMode: string;
}

export function getLastSession(): LastSession | null {
  const raw = safeGetItem(KEY_LAST_SESSION);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastSession;
  } catch {
    return null;
  }
}

export function setLastSession(s: LastSession): void {
  safeSetItem(KEY_LAST_SESSION, JSON.stringify(s));
}

export interface QueryHistoryItem {
  sql: string;
  at: number;
}

export function getQueryHistory(): QueryHistoryItem[] {
  const raw = safeGetItem(KEY_QUERY_HISTORY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as QueryHistoryItem[];
    return Array.isArray(arr) ? arr.slice(0, MAX_QUERY_HISTORY) : [];
  } catch {
    return [];
  }
}

export interface TablePrefs {
  visibleColumns: string[] | null;
  columnOrder: string[] | null;
}

/** Path-keyed explorer column prefs (LOOM-205). */
export type TablePrefsByPath = Record<string, TablePrefs>;

function isFlatTablePrefs(v: unknown): v is TablePrefs {
  return (
    !!v &&
    typeof v === "object" &&
    ("visibleColumns" in v || "columnOrder" in v) &&
    !("byPath" in v)
  );
}

/** Load path-keyed prefs; migrates legacy flat `{ visibleColumns, columnOrder }`. */
export function getTablePrefsByPath(): TablePrefsByPath {
  const raw = safeGetItem(KEY_TABLE_PREFS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isFlatTablePrefs(parsed)) {
      return { __legacy__: parsed };
    }
    if (parsed && typeof parsed === "object" && parsed !== null && "byPath" in parsed) {
      const byPath = (parsed as { byPath?: unknown }).byPath;
      return byPath && typeof byPath === "object" && byPath !== null
        ? (byPath as TablePrefsByPath)
        : {};
    }
    if (parsed && typeof parsed === "object" && parsed !== null) {
      return parsed as TablePrefsByPath;
    }
    return {};
  } catch {
    return {};
  }
}

export function getTablePrefsForPath(path: string): TablePrefs | null {
  const map = getTablePrefsByPath();
  return map[path] ?? map.__legacy__ ?? null;
}

export function setTablePrefsForPath(path: string, p: TablePrefs): void {
  const map = getTablePrefsByPath();
  const next: TablePrefsByPath = { ...map, [path]: p };
  delete next.__legacy__;
  safeSetItem(KEY_TABLE_PREFS, JSON.stringify({ byPath: next }));
}

/** @deprecated Prefer getTablePrefsForPath — kept for callers during migration. */
export function getTablePrefs(): TablePrefs | null {
  const map = getTablePrefsByPath();
  const keys = Object.keys(map);
  if (keys.length === 1 && keys[0] === "__legacy__") return map.__legacy__ ?? null;
  return null;
}

/** @deprecated Prefer setTablePrefsForPath */
export function setTablePrefs(p: TablePrefs): void {
  safeSetItem(KEY_TABLE_PREFS, JSON.stringify({ byPath: { __legacy__: p } }));
}

export interface QuerySnippetItem {
  name: string;
  sql: string;
}

export function getQuerySnippets(): QuerySnippetItem[] {
  const raw = safeGetItem(KEY_QUERY_SNIPPETS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as QuerySnippetItem[];
    return Array.isArray(arr) ? arr.slice(0, MAX_QUERY_SNIPPETS) : [];
  } catch {
    return [];
  }
}

export function setPersistedQuerySnippets(items: QuerySnippetItem[]): boolean {
  return safeSetItem(KEY_QUERY_SNIPPETS, JSON.stringify(items.slice(0, MAX_QUERY_SNIPPETS)));
}

export interface TableViewItem {
  id: string;
  name: string;
  visibleColumns: string[] | null;
  columnOrder: string[] | null;
  columnFilters: Record<string, string>;
}

export function getTableViews(): TableViewItem[] {
  const raw = safeGetItem(KEY_TABLE_VIEWS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as TableViewItem[];
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function setPersistedTableViews(
  items: Array<
    TableViewItem & {
      querySql?: string | null;
      snapshotData?: unknown;
    }
  >,
): boolean {
  const slim = items.slice(0, 20).map(({ id, name, visibleColumns, columnOrder, columnFilters }) => ({
    id,
    name,
    visibleColumns,
    columnOrder,
    columnFilters,
  }));
  return safeSetItem(KEY_TABLE_VIEWS, JSON.stringify(slim));
}

export interface ChartViewItemPersist {
  id: string;
  name: string;
  filePath: string;
  fileName: string;
  chart: Record<string, unknown>;
  visualOverrides: Record<string, unknown>;
  querySql?: string | null;
  snapshotImageDataUrl?: string | null;
}

export function getChartViews(): ReturnType<typeof parsePersistedChartViews> {
  const raw = safeGetItem(KEY_CHART_VIEWS);
  if (!raw) return [];
  try {
    return parsePersistedChartViews(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setPersistedChartViews(items: ChartViewItemPersist[]): boolean {
  return safeSetItem(KEY_CHART_VIEWS, JSON.stringify(items.slice(0, 30)));
}

export interface QueryViewItemPersist {
  id: string;
  name: string;
  sql: string;
}

export function getQueryViews(): QueryViewItemPersist[] {
  const raw = safeGetItem(KEY_QUERY_VIEWS);
  if (!raw) return [];
  try {
    return parsePersistedQueryViews(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setPersistedQueryViews(items: QueryViewItemPersist[]): boolean {
  return safeSetItem(KEY_QUERY_VIEWS, JSON.stringify(items.slice(0, 30)));
}

export interface DashboardSlotPersist {
  id: string;
  viewType: "table" | "chart" | "query" | "snapshot";
  viewId: string;
}

export interface DashboardItemPersist {
  id: string;
  name: string;
  slots: DashboardSlotPersist[];
  layoutTemplate?: string | null;
  refreshInterval?: string | null;
  lastRefreshedAt?: number | null;
}

export function getDashboards(): DashboardItemPersist[] {
  const raw = safeGetItem(KEY_DASHBOARDS);
  if (!raw) return [];
  try {
    return parsePersistedDashboards(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function setPersistedDashboards(items: DashboardItemPersist[]): boolean {
  return safeSetItem(KEY_DASHBOARDS, JSON.stringify(items.slice(0, 20)));
}

export function getVizPreferencesRaw(): string | null {
  return safeGetItem(KEY_VIZ_PREFERENCES);
}

export function setPersistedVizPreferences(model: object): boolean {
  return safeSetItem(KEY_VIZ_PREFERENCES, JSON.stringify(model));
}

/** Raw `{v,data}` envelope JSON — parse with `parseSourcePreferences`. */
export function getSourcePreferencesRaw(): string | null {
  return safeGetItem(KEY_SOURCE_PREFERENCES);
}

export function setPersistedSourcePreferences(prefs: object): boolean {
  return safeSetItem(KEY_SOURCE_PREFERENCES, JSON.stringify(wrapPersist(prefs)));
}

/** Keys cleared by preference reset (LOOM-551) — not uploads/IDB. */
export const LOOM_PREFERENCE_STORAGE_KEYS = [
  KEY_APP_SETTINGS,
  KEY_QUERY_HISTORY,
  KEY_QUERY_SNIPPETS,
  KEY_TABLE_PREFS,
  KEY_TABLE_VIEWS,
  KEY_CHART_VIEWS,
  KEY_CUSTOM_CHART_LOOKS,
  KEY_QUERY_VIEWS,
  KEY_DASHBOARDS,
  KEY_VIZ_PREFERENCES,
  KEY_SOURCE_PREFERENCES,
] as const;

export function clearPersistedPreferences(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const key of LOOM_PREFERENCE_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function clearPersistedSessionKeys(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const key of [KEY_RECENT_FILES, KEY_LAST_SESSION]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
