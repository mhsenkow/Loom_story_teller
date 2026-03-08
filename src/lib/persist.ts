// =================================================================
// Loom — Persist state to localStorage (browser)
// =================================================================
// Keys and (de)serialization for app settings, recent files, last session,
// query history, and table preferences. No-op when localStorage is unavailable.
// =================================================================

const KEY_APP_SETTINGS = "loom-app-settings";
const KEY_RECENT_FILES = "loom-recent-files";
const KEY_LAST_SESSION = "loom-last-session";
const KEY_QUERY_HISTORY = "loom-query-history";
const KEY_TABLE_PREFS = "loom-table-prefs";
const KEY_QUERY_SNIPPETS = "loom-query-snippets";
const KEY_TABLE_VIEWS = "loom-table-views";
const KEY_CHART_VIEWS = "loom-chart-views";
const KEY_QUERY_VIEWS = "loom-query-views";
const KEY_DASHBOARDS = "loom-dashboards";
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

function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // quota or disabled
  }
}

export interface PersistedAppSettings {
  theme?: string;
  fontScale?: number;
  reducedMotion?: boolean;
}

export function getPersistedAppSettings(): PersistedAppSettings | null {
  const raw = safeGetItem(KEY_APP_SETTINGS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedAppSettings;
  } catch {
    return null;
  }
}

export function setPersistedAppSettings(s: PersistedAppSettings): void {
  safeSetItem(KEY_APP_SETTINGS, JSON.stringify(s));
}

export interface RecentFileEntry {
  path: string;
  name: string;
  extension: string;
  row_count: number;
  size_bytes: number;
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

export function addRecentFile(entry: RecentFileEntry): RecentFileEntry[] {
  const list = getRecentFiles().filter((f) => f.path !== entry.path);
  list.unshift(entry);
  const out = list.slice(0, MAX_RECENT_FILES);
  safeSetItem(KEY_RECENT_FILES, JSON.stringify(out));
  return out;
}

export function setPersistedRecentFiles(files: RecentFileEntry[]): void {
  safeSetItem(KEY_RECENT_FILES, JSON.stringify(files.slice(0, MAX_RECENT_FILES)));
}

export function setPersistedQueryHistory(items: QueryHistoryItem[]): void {
  safeSetItem(KEY_QUERY_HISTORY, JSON.stringify(items.slice(0, MAX_QUERY_HISTORY)));
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

export function appendQueryHistory(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) return;
  let list = getQueryHistory().filter((q) => q.sql !== trimmed);
  list.unshift({ sql: trimmed, at: Date.now() });
  list = list.slice(0, MAX_QUERY_HISTORY);
  safeSetItem(KEY_QUERY_HISTORY, JSON.stringify(list));
}

export interface TablePrefs {
  visibleColumns: string[] | null;
  columnOrder: string[] | null;
}

export function getTablePrefs(): TablePrefs | null {
  const raw = safeGetItem(KEY_TABLE_PREFS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TablePrefs;
  } catch {
    return null;
  }
}

export function setTablePrefs(p: TablePrefs): void {
  safeSetItem(KEY_TABLE_PREFS, JSON.stringify(p));
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

export function setPersistedQuerySnippets(items: QuerySnippetItem[]): void {
  safeSetItem(KEY_QUERY_SNIPPETS, JSON.stringify(items.slice(0, MAX_QUERY_SNIPPETS)));
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

export function setPersistedTableViews(items: TableViewItem[]): void {
  safeSetItem(KEY_TABLE_VIEWS, JSON.stringify(items.slice(0, 20)));
}

export interface ChartViewItemPersist {
  id: string;
  name: string;
  filePath: string;
  fileName: string;
  chart: Record<string, unknown>;
  visualOverrides: Record<string, unknown>;
  snapshotImageDataUrl?: string | null;
}

export function getChartViews(): ChartViewItemPersist[] {
  const raw = safeGetItem(KEY_CHART_VIEWS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ChartViewItemPersist[];
    return Array.isArray(arr) ? arr.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function setPersistedChartViews(items: ChartViewItemPersist[]): void {
  safeSetItem(KEY_CHART_VIEWS, JSON.stringify(items.slice(0, 30)));
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
    const arr = JSON.parse(raw) as QueryViewItemPersist[];
    return Array.isArray(arr) ? arr.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function setPersistedQueryViews(items: QueryViewItemPersist[]): void {
  safeSetItem(KEY_QUERY_VIEWS, JSON.stringify(items.slice(0, 30)));
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
  refreshInterval?: string | null;
  lastRefreshedAt?: number | null;
}

export function getDashboards(): DashboardItemPersist[] {
  const raw = safeGetItem(KEY_DASHBOARDS);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as DashboardItemPersist[];
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function setPersistedDashboards(items: DashboardItemPersist[]): void {
  safeSetItem(KEY_DASHBOARDS, JSON.stringify(items.slice(0, 20)));
}
