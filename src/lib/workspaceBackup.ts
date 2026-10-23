import { parseDataLibrary, emptyDataLibrary, type DataLibrary } from "./dataLibrary";
// =================================================================
// workspaceBackup — versioned, validated workspace bundle (LOOM-659)
// =================================================================
// A bundle is plain JSON: a manifest (format, version, counts, privacy
// scope, dataset references) plus saved table/chart/query views,
// dashboards, SQL snippets, per-file column prefs and source loves / saves /
// hides (not the on-device "recently opened" signal). Uploaded datasets
// are NOT embedded — only file names/paths are recorded so the user knows
// what to re-add. Import validates every record and never applies
// settings, URLs or anything outside the lists above.
// =================================================================

import {
  parsePersistedChartViews,
  parsePersistedDashboards,
  parsePersistedQueryViews,
} from "./persistValidation";
import type {
  ChartViewItem,
  DashboardItem,
  QueryViewItem,
  TableViewItem,
} from "./store";
import { parseCustomChartLooks, MAX_CUSTOM_CHART_LOOKS, type CustomChartLook } from "./customChartLooks";
import {
  countExplicitSourcePreferences,
  emptySourcePreferences,
  explicitOnly,
  mergeSourcePreferences,
  parseSourcePreferences,
  type SourcePreferences,
} from "./sourcePreferences";

export const WORKSPACE_BUNDLE_FORMAT = "loom-workspace";
export const WORKSPACE_BUNDLE_VERSION = 1;
/** Hard cap so a pasted/selected file can't freeze the tab. */
export const WORKSPACE_BUNDLE_MAX_BYTES = 20 * 1024 * 1024;

export interface WorkspaceTablePrefs {
  visibleColumns: string[] | null;
  columnOrder: string[] | null;
}

export interface WorkspaceSnippet {
  name: string;
  sql: string;
}

export interface WorkspaceBundleContent {
  dataLibrary?: DataLibrary;
  customChartLooks?: CustomChartLook[];
  tableViews: TableViewItem[];
  chartViews: ChartViewItem[];
  queryViews: QueryViewItem[];
  dashboards: DashboardItem[];
  snippets: WorkspaceSnippet[];
  tablePrefsByPath: Record<string, WorkspaceTablePrefs>;
  /** Source ♥ / 👎 / Hide / 🔖 (explicit only). */
  sourcePrefs?: SourcePreferences;
}

export interface WorkspaceManifest {
  format: typeof WORKSPACE_BUNDLE_FORMAT;
  version: number;
  createdAt: string;
  counts: Record<keyof WorkspaceBundleContent, number>;
  includesThumbnails: boolean;
  /** Dataset files the views point at (not embedded; re-add them to use data-backed views). */
  datasetRefs: { path: string; name: string }[];
  privacyNote: string;
}

export interface WorkspaceBundle {
  manifest: WorkspaceManifest;
  content: WorkspaceBundleContent;
}

export type WorkspaceParseResult =
  | { ok: true; bundle: WorkspaceBundle }
  | { ok: false; code: "empty" | "too-large" | "not-json" | "not-loom" | "future-version" | "invalid"; message: string };

export interface WorkspaceExportScope {
  dataLibrary?: boolean;
  customChartLooks?: boolean;
  tableViews: boolean;
  chartViews: boolean;
  queryViews: boolean;
  dashboards: boolean;
  snippets: boolean;
  tablePrefs: boolean;
  sourcePrefs?: boolean;
  /** Chart view PNG thumbnails — large, and may show data. */
  thumbnails: boolean;
}

export const DEFAULT_EXPORT_SCOPE: WorkspaceExportScope = {
  dataLibrary: true,
  customChartLooks: true,
  tableViews: true,
  chartViews: true,
  queryViews: true,
  dashboards: true,
  snippets: true,
  tablePrefs: true,
  sourcePrefs: true,
  thumbnails: false,
};

export const WORKSPACE_PRIVACY_NOTE =
  "Contains view names, SQL, column names, filters, dataset file names, source URLs and combination recipes. Dataset rows are not included (chart thumbnails only if you opt in, and they can show data).";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function strListOrNull(v: unknown): string[] | null {
  return Array.isArray(v) && v.every(isStr) ? (v as string[]) : null;
}

function parseTableViews(raw: unknown): TableViewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TableViewItem[] = [];
  for (const it of raw) {
    if (!isRecord(it) || !isStr(it.id) || !isStr(it.name)) continue;
    const filters: Record<string, string> = {};
    if (isRecord(it.columnFilters)) {
      for (const [k, v] of Object.entries(it.columnFilters)) if (isStr(v)) filters[k] = v;
    }
    out.push({
      id: it.id,
      name: it.name,
      visibleColumns: strListOrNull(it.visibleColumns),
      columnOrder: strListOrNull(it.columnOrder),
      columnFilters: filters,
      querySql: isStr(it.querySql) ? it.querySql : null,
    });
  }
  return out.slice(0, 20);
}

function parseSnippets(raw: unknown): WorkspaceSnippet[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceSnippet[] = [];
  for (const it of raw) {
    if (isRecord(it) && isStr(it.name) && isStr(it.sql)) out.push({ name: it.name, sql: it.sql });
  }
  return out.slice(0, 30);
}

function parsePrefsByPath(raw: unknown): Record<string, WorkspaceTablePrefs> {
  if (!isRecord(raw)) return {};
  const out: Record<string, WorkspaceTablePrefs> = {};
  for (const [path, v] of Object.entries(raw).slice(0, 100)) {
    if (!isRecord(v)) continue;
    const visibleColumns = strListOrNull(v.visibleColumns);
    const columnOrder = strListOrNull(v.columnOrder);
    if (visibleColumns || columnOrder) out[path] = { visibleColumns, columnOrder };
  }
  return out;
}

function collectDatasetRefs(c: WorkspaceBundleContent): { path: string; name: string }[] {
  const map = new Map<string, string>();
  const assets = [...(c.dataLibrary?.assets ?? []), ...(c.dataLibrary?.combinations.flatMap(r => [r.left, r.right]) ?? [])];
  for (const a of assets) if (a.file && !a.url) map.set(a.file.path, a.file.name);
  for (const v of c.chartViews) map.set(v.filePath, v.fileName);
  for (const p of Object.keys(c.tablePrefsByPath)) if (!map.has(p)) map.set(p, p.split("/").pop() || p);
  return [...map].map(([path, name]) => ({ path, name })).sort((a, b) => a.path.localeCompare(b.path));
}

export function buildWorkspaceBundle(
  input: Partial<WorkspaceBundleContent>,
  scope: WorkspaceExportScope = DEFAULT_EXPORT_SCOPE,
  now: Date = new Date(),
): WorkspaceBundle {
  const content: WorkspaceBundleContent = {
    dataLibrary: scope.dataLibrary === false ? emptyDataLibrary() : parseDataLibrary(input.dataLibrary),
    customChartLooks: scope.customChartLooks === false ? [] : parseCustomChartLooks(input.customChartLooks),
    tableViews: scope.tableViews
      ? (input.tableViews ?? []).map((v) => ({
          id: v.id,
          name: v.name,
          visibleColumns: v.visibleColumns,
          columnOrder: v.columnOrder,
          columnFilters: { ...v.columnFilters },
          querySql: v.querySql ?? null,
        }))
      : [],
    chartViews: scope.chartViews
      ? (input.chartViews ?? []).map((v) => {
          const { snapshotData: _snap, ...rest } = v;
          void _snap;
          return scope.thumbnails ? rest : { ...rest, snapshotImageDataUrl: null };
        })
      : [],
    queryViews: scope.queryViews ? [...(input.queryViews ?? [])] : [],
    dashboards: scope.dashboards ? [...(input.dashboards ?? [])] : [],
    snippets: scope.snippets ? [...(input.snippets ?? [])] : [],
    tablePrefsByPath: scope.tablePrefs ? { ...(input.tablePrefsByPath ?? {}) } : {},
    sourcePrefs: scope.sourcePrefs === false ? emptySourcePreferences() : explicitOnly(input.sourcePrefs ?? emptySourcePreferences()),
  };
  const manifest: WorkspaceManifest = {
    format: WORKSPACE_BUNDLE_FORMAT,
    version: WORKSPACE_BUNDLE_VERSION,
    createdAt: now.toISOString(),
    counts: {
      dataLibrary: (content.dataLibrary?.assets.length ?? 0) + (content.dataLibrary?.combinations.length ?? 0),
      customChartLooks: content.customChartLooks?.length ?? 0,
      tableViews: content.tableViews.length,
      chartViews: content.chartViews.length,
      queryViews: content.queryViews.length,
      dashboards: content.dashboards.length,
      snippets: content.snippets.length,
      tablePrefsByPath: Object.keys(content.tablePrefsByPath).length,
      sourcePrefs: countExplicitSourcePreferences(content.sourcePrefs),
    },
    includesThumbnails: scope.thumbnails && content.chartViews.some((v) => !!v.snapshotImageDataUrl),
    datasetRefs: collectDatasetRefs(content),
    privacyNote: WORKSPACE_PRIVACY_NOTE,
  };
  return { manifest, content };
}

export function serializeWorkspaceBundle(bundle: WorkspaceBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Size shown in the export UI before the user commits. */
export function estimateBundleBytes(bundle: WorkspaceBundle): number {
  return new TextEncoder().encode(serializeWorkspaceBundle(bundle)).length;
}

export function parseWorkspaceBundle(text: string): WorkspaceParseResult {
  if (!text || !text.trim()) {
    return { ok: false, code: "empty", message: "That file is empty. Choose a Loom workspace backup (.json)." };
  }
  if (text.length > WORKSPACE_BUNDLE_MAX_BYTES) {
    return { ok: false, code: "too-large", message: "That file is over 20 MB — it is probably not a Loom workspace backup." };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "not-json", message: "That file isn't valid JSON. Export a fresh backup from Settings → Local data." };
  }
  if (!isRecord(raw) || !isRecord(raw.manifest) || raw.manifest.format !== WORKSPACE_BUNDLE_FORMAT) {
    return { ok: false, code: "not-loom", message: "That isn't a Loom workspace backup (missing manifest). Nothing was imported." };
  }
  const version = raw.manifest.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, code: "invalid", message: "The backup has no usable version number. Nothing was imported." };
  }
  if (version > WORKSPACE_BUNDLE_VERSION) {
    return {
      ok: false,
      code: "future-version",
      message: `This backup is from a newer Loom (format v${version}; this app reads v${WORKSPACE_BUNDLE_VERSION}). Update Loom, then import again. Nothing was changed.`,
    };
  }
  if (!isRecord(raw.content)) {
    return { ok: false, code: "invalid", message: "The backup has no content section. Nothing was imported." };
  }
  const c = raw.content;
  const content: WorkspaceBundleContent = {
    dataLibrary: parseDataLibrary(c.dataLibrary),
    customChartLooks: parseCustomChartLooks(c.customChartLooks),
    tableViews: parseTableViews(c.tableViews),
    chartViews: parsePersistedChartViews(c.chartViews),
    queryViews: parsePersistedQueryViews(c.queryViews),
    dashboards: parsePersistedDashboards(c.dashboards),
    snippets: parseSnippets(c.snippets),
    tablePrefsByPath: parsePrefsByPath(c.tablePrefsByPath),
    sourcePrefs: explicitOnly(parseSourcePreferences(c.sourcePrefs)),
  };
  const total =
    (content.dataLibrary?.assets.length ?? 0) + (content.dataLibrary?.combinations.length ?? 0) +
    (content.customChartLooks?.length ?? 0) +
    content.tableViews.length +
    content.chartViews.length +
    content.queryViews.length +
    content.dashboards.length +
    content.snippets.length +
    Object.keys(content.tablePrefsByPath).length +
    countExplicitSourcePreferences(content.sourcePrefs);
  if (total === 0) {
    return { ok: false, code: "invalid", message: "The backup contains no valid saved work (every record failed validation). Nothing was imported." };
  }
  const created = new Date(String(raw.manifest.createdAt));
  const bundle = buildWorkspaceBundle(
    content,
    { ...DEFAULT_EXPORT_SCOPE, thumbnails: true },
    Number.isNaN(created.getTime()) ? new Date(0) : created,
  );
  return { ok: true, bundle };
}

export interface WorkspaceMergeResult {
  merged: WorkspaceBundleContent;
  added: Record<keyof WorkspaceBundleContent, number>;
  skipped: Record<keyof WorkspaceBundleContent, number>;
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  cap: number,
): { list: T[]; added: number; skipped: number } {
  const ids = new Set(current.map((x) => x.id));
  const fresh = incoming.filter((x) => !ids.has(x.id));
  const list = [...current, ...fresh].slice(0, cap);
  const added = Math.max(0, list.length - current.length);
  return { list, added, skipped: incoming.length - added };
}

/** Non-destructive merge: existing records win on id/name/path collisions. */
export function mergeWorkspaceBundle(
  current: WorkspaceBundleContent,
  incoming: WorkspaceBundleContent,
): WorkspaceMergeResult {
  const t = mergeById(current.tableViews, incoming.tableViews, 20);
  const c = mergeById(current.chartViews, incoming.chartViews, 30);
  const q = mergeById(current.queryViews, incoming.queryViews, 30);
  const d = mergeById(current.dashboards, incoming.dashboards, 20);
  const currentLooks = parseCustomChartLooks(current.customChartLooks);
  const incomingLooks = parseCustomChartLooks(incoming.customChartLooks);
  const lookNames = new Set(currentLooks.map((look) => look.name.toLowerCase()));
  const looks = mergeById(currentLooks, incomingLooks.filter((look) => !lookNames.has(look.name.toLowerCase())), MAX_CUSTOM_CHART_LOOKS);
  const names = new Set(current.snippets.map((s) => s.name));
  const freshSnips = incoming.snippets.filter((s) => !names.has(s.name));
  const snippets = [...current.snippets, ...freshSnips].slice(0, 30);
  const prefs = { ...incoming.tablePrefsByPath, ...current.tablePrefsByPath };
  const prefsAdded = Object.keys(prefs).length - Object.keys(current.tablePrefsByPath).length;
  const sources = mergeSourcePreferences(current.sourcePrefs ?? emptySourcePreferences(), incoming.sourcePrefs ?? emptySourcePreferences());
  const currentLibrary = parseDataLibrary(current.dataLibrary);
  const incomingLibrary = parseDataLibrary(incoming.dataLibrary);
  const combinations = mergeById(currentLibrary.combinations, incomingLibrary.combinations, 100);
  const collections = mergeById(currentLibrary.collections, incomingLibrary.collections, 40);
  const existingRefs = new Set(currentLibrary.assets.map(a => a.ref));
  const assets = [...currentLibrary.assets, ...incomingLibrary.assets.filter(a => !existingRefs.has(a.ref))].slice(0, 500);
  const libraryAdded = combinations.added + collections.added + assets.length - currentLibrary.assets.length;
  return {
    merged: {
      dataLibrary: {
        assets,
        combinations: combinations.list,
        collections: collections.list,
        foldedBookmarks: currentLibrary.foldedBookmarks || incomingLibrary.foldedBookmarks,
      },
      customChartLooks: looks.list,
      tableViews: t.list,
      chartViews: c.list,
      queryViews: q.list,
      dashboards: d.list,
      snippets,
      tablePrefsByPath: prefs,
      sourcePrefs: sources.merged,
    },
    added: {
      dataLibrary: libraryAdded,
      customChartLooks: looks.added,
      tableViews: t.added,
      chartViews: c.added,
      queryViews: q.added,
      dashboards: d.added,
      snippets: snippets.length - current.snippets.length,
      tablePrefsByPath: prefsAdded,
      sourcePrefs: sources.added,
    },
    skipped: {
      dataLibrary: incomingLibrary.assets.length + incomingLibrary.combinations.length - libraryAdded,
      customChartLooks: incomingLooks.length - looks.added,
      tableViews: t.skipped,
      chartViews: c.skipped,
      queryViews: q.skipped,
      dashboards: d.skipped,
      snippets: incoming.snippets.length - (snippets.length - current.snippets.length),
      tablePrefsByPath: Object.keys(incoming.tablePrefsByPath).length - prefsAdded,
      sourcePrefs: sources.skipped,
    },
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
