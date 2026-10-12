// =================================================================
// Loom — Validate localStorage JSON before hydrating the store
// =================================================================

import type { PersistedAppSettings } from "./persist";
import { CHART_ASPECTS, type ChartAspectId, type ChartDeviceId } from "./chartViewport";
import {
  normalizeUi,
  normalizeFont,
  normalizeFaces,
  THEMES,
  UI_CHROMES,
  APP_FONTS,
  THEME_LEGACY,
} from "./lookSystem";
import type { ChartViewItem, DashboardItem, QueryViewItem, ViewMode } from "./store";

const FONT_SCALES = new Set([0.9, 1, 1.1, 1.15]);
const ASPECTS = new Set(CHART_ASPECTS.map((a) => a.id));
const DEVICES = new Set<ChartDeviceId>(["auto", "mobile", "tablet", "desktop"]);
const VIEW_MODES = new Set<ViewMode>(["explorer", "chart", "query", "dive"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function parsePersistedAppSettings(raw: unknown): PersistedAppSettings | null {
  if (!isRecord(raw)) return null;
  const out: PersistedAppSettings = {};
  if (isString(raw.theme)) {
    if (
      (THEMES as readonly string[]).includes(raw.theme) ||
      raw.theme === "system" ||
      raw.theme === "high-contrast" ||
      raw.theme === "colorblind" ||
      raw.theme in THEME_LEGACY
    ) {
      out.theme = raw.theme;
    }
  }
  if (isString(raw.uiChrome)) {
    const u = normalizeUi(raw.uiChrome);
    if ((UI_CHROMES as readonly string[]).includes(u)) out.uiChrome = u;
  }
  if (isString(raw.font)) {
    const f = normalizeFont(raw.font);
    if ((APP_FONTS as readonly string[]).includes(f)) out.font = f;
  }
  if (isString(raw.faces)) {
    const fc = normalizeFaces(raw.faces);
    if (fc === "auto" || fc === "web" || fc === "local") out.faces = fc;
  }
  if (typeof raw.fontScale === "number" && (FONT_SCALES as Set<number>).has(raw.fontScale)) {
    out.fontScale = raw.fontScale as PersistedAppSettings["fontScale"];
  }
  if (typeof raw.reducedMotion === "boolean") out.reducedMotion = raw.reducedMotion;
  if (typeof raw.colorblindCharts === "boolean") out.colorblindCharts = raw.colorblindCharts;
  if (isString(raw.chartAspect) && ASPECTS.has(raw.chartAspect as ChartAspectId)) {
    out.chartAspect = raw.chartAspect;
  }
  if (isString(raw.chartDevice) && DEVICES.has(raw.chartDevice as ChartDeviceId)) {
    out.chartDevice = raw.chartDevice;
  }
  return Object.keys(out).length ? out : null;
}

function parseChartRecommendation(raw: unknown): ChartViewItem["chart"] | null {
  if (!isRecord(raw)) return null;
  if (!isString(raw.id) || !isString(raw.kind) || !isString(raw.title)) return null;
  if (!isString(raw.xField)) return null;
  const yField = raw.yField;
  if (yField != null && typeof yField !== "string") return null;
  return raw as unknown as ChartViewItem["chart"];
}

export function parsePersistedChartViews(raw: unknown): ChartViewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartViewItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isString(item.id) || !isString(item.name)) continue;
    if (!isString(item.filePath) || !isString(item.fileName)) continue;
    const chart = parseChartRecommendation(item.chart);
    if (!chart) continue;
    const vo = isRecord(item.visualOverrides) ? (item.visualOverrides as ChartViewItem["visualOverrides"]) : {};
    out.push({
      id: item.id,
      name: item.name,
      filePath: item.filePath,
      fileName: item.fileName,
      chart,
      visualOverrides: vo,
      querySql: item.querySql == null || isString(item.querySql) ? (item.querySql ?? null) : null,
      snapshotImageDataUrl:
        item.snapshotImageDataUrl == null || isString(item.snapshotImageDataUrl)
          ? (item.snapshotImageDataUrl ?? null)
          : null,
    });
  }
  return out.slice(0, 30);
}

export function parsePersistedQueryViews(raw: unknown): QueryViewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QueryViewItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isString(item.id) || !isString(item.name) || !isString(item.sql)) continue;
    out.push({ id: item.id, name: item.name, sql: item.sql });
  }
  return out.slice(0, 30);
}

export function parsePersistedDashboards(raw: unknown): DashboardItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DashboardItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || !isString(item.id) || !isString(item.name)) continue;
    if (!Array.isArray(item.slots)) continue;
    const slots: DashboardItem["slots"] = [];
    for (const s of item.slots) {
      if (!isRecord(s) || !isString(s.id) || !isString(s.viewId)) continue;
      const vt = s.viewType;
      if (vt !== "table" && vt !== "chart" && vt !== "query" && vt !== "snapshot") continue;
      slots.push({ id: s.id, viewType: vt, viewId: s.viewId });
    }
    out.push({ id: item.id, name: item.name, slots });
  }
  return out.slice(0, 20);
}

export function parseLastSessionViewMode(raw: unknown): ViewMode {
  return isString(raw) && VIEW_MODES.has(raw as ViewMode) ? (raw as ViewMode) : "explorer";
}
