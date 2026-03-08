// =================================================================
// HydrateStore — Load persisted state and persist on change
// =================================================================
// On mount: read localStorage and hydrate appSettings, recentFiles,
// lastSession, queryHistory, tablePrefs. Subscribe to store and
// write back when these slices change.
// =================================================================

"use client";

import { useEffect, useRef } from "react";
import { useLoomStore } from "@/lib/store";
import {
  getPersistedAppSettings,
  setPersistedAppSettings,
  getRecentFiles,
  setLastSession as persistLastSession,
  getLastSession,
  getQueryHistory,
  getQuerySnippets,
  getTablePrefs,
  getTableViews,
  getChartViews,
  getQueryViews,
  getDashboards,
  setPersistedRecentFiles,
  setPersistedQueryHistory,
  setPersistedQuerySnippets,
  setPersistedTableViews,
  setPersistedChartViews,
  setPersistedQueryViews,
  setPersistedDashboards,
  setTablePrefs as persistTablePrefs,
} from "@/lib/persist";
import type { ChartViewItem, QueryViewItem, DashboardItem } from "@/lib/store";

export function HydrateStore() {
  const hydrated = useRef(false);
  const skipFirstPersist = useRef({
    recentFiles: true,
    queryHistory: true,
    querySnippets: true,
    tablePrefs: true,
    tableViews: true,
    chartViews: true,
    queryViews: true,
    dashboards: true,
  });
  const hasPersistedChartViews = useRef(false);
  const hasPersistedTableViews = useRef(false);
  const hasPersistedQueryViews = useRef(false);
  const hasPersistedDashboards = useRef(false);
  const {
    setAppSettings,
    setRecentFiles,
    setLastSession,
    setQueryHistory,
    setQuerySnippets,
    setTablePrefs,
    setTableViews,
    setChartViews,
    setQueryViews,
    setDashboards,
    appSettings,
    recentFiles,
    lastSession,
    queryHistory,
    querySnippets,
    tablePrefs,
    tableViews,
    chartViews,
    queryViews,
    dashboards,
  } = useLoomStore();

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const saved = getPersistedAppSettings();
    if (saved) {
      setAppSettings((prev) => ({
        ...prev,
        ...(saved.theme && { theme: saved.theme as "dark" | "light" | "high-contrast" | "colorblind" }),
        ...(typeof saved.fontScale === "number" && { fontScale: saved.fontScale as 0.9 | 1 | 1.1 | 1.15 }),
        ...(typeof saved.reducedMotion === "boolean" && { reducedMotion: saved.reducedMotion }),
      }));
    }

    const recent = getRecentFiles();
    if (recent.length) setRecentFiles(recent as import("@/lib/store").FileEntry[]);

    const session = getLastSession();
    if (session)
      setLastSession({
        folderPath: session.folderPath,
        filePath: session.filePath,
        viewMode: (session.viewMode as "explorer" | "chart" | "query") || "explorer",
      });

    const qh = getQueryHistory();
    if (qh.length) setQueryHistory(qh);

    const snippets = getQuerySnippets();
    if (snippets.length) setQuerySnippets(snippets);

    const prefs = getTablePrefs();
    if (prefs) setTablePrefs(prefs);

    const views = getTableViews();
    if (views.length) setTableViews(views);

    const cv = getChartViews();
    if (cv.length)
      setChartViews(
        cv.map((c) => ({
          id: c.id,
          name: c.name,
          filePath: c.filePath,
          fileName: c.fileName,
          chart: c.chart as unknown as ChartViewItem["chart"],
          visualOverrides: (c.visualOverrides || {}) as ChartViewItem["visualOverrides"],
          snapshotImageDataUrl: c.snapshotImageDataUrl ?? null,
        }))
      );

    const qv = getQueryViews();
    if (qv.length) setQueryViews(qv as QueryViewItem[]);

    const db = getDashboards();
    if (db.length) setDashboards(db as DashboardItem[]);
  }, []);

  useEffect(() => {
    setPersistedAppSettings(appSettings);
  }, [appSettings]);

  useEffect(() => {
    if (lastSession)
      persistLastSession({
        folderPath: lastSession.folderPath,
        filePath: lastSession.filePath,
        viewMode: lastSession.viewMode,
      });
  }, [lastSession]);

  useEffect(() => {
    if (skipFirstPersist.current.recentFiles) {
      skipFirstPersist.current.recentFiles = false;
      return;
    }
    setPersistedRecentFiles(recentFiles);
  }, [recentFiles]);

  useEffect(() => {
    if (skipFirstPersist.current.queryHistory) {
      skipFirstPersist.current.queryHistory = false;
      return;
    }
    setPersistedQueryHistory(queryHistory);
  }, [queryHistory]);

  useEffect(() => {
    if (skipFirstPersist.current.querySnippets) {
      skipFirstPersist.current.querySnippets = false;
      return;
    }
    setPersistedQuerySnippets(querySnippets);
  }, [querySnippets]);

  useEffect(() => {
    if (skipFirstPersist.current.tablePrefs) {
      skipFirstPersist.current.tablePrefs = false;
      return;
    }
    persistTablePrefs(tablePrefs);
  }, [tablePrefs]);

  useEffect(() => {
    if (tableViews.length === 0 && !hasPersistedTableViews.current) return;
    hasPersistedTableViews.current = true;
    if (skipFirstPersist.current.tableViews && tableViews.length === 0) {
      skipFirstPersist.current.tableViews = false;
      return;
    }
    skipFirstPersist.current.tableViews = false;
    try {
      setPersistedTableViews(tableViews);
    } catch (_) {
      // localStorage full or disabled
    }
  }, [tableViews]);

  useEffect(() => {
    if (chartViews.length === 0 && !hasPersistedChartViews.current) return;
    hasPersistedChartViews.current = true;
    if (skipFirstPersist.current.chartViews && chartViews.length === 0) {
      skipFirstPersist.current.chartViews = false;
      return;
    }
    skipFirstPersist.current.chartViews = false;
    try {
      setPersistedChartViews(
        chartViews.map((c) => ({
          id: c.id,
          name: c.name,
          filePath: c.filePath,
          fileName: c.fileName,
          chart: c.chart as unknown as Record<string, unknown>,
          visualOverrides: c.visualOverrides as unknown as Record<string, unknown>,
          snapshotImageDataUrl: c.snapshotImageDataUrl ?? null,
        }))
      );
    } catch (_) {
      // localStorage full or disabled
    }
  }, [chartViews]);

  useEffect(() => {
    if (queryViews.length === 0 && !hasPersistedQueryViews.current) return;
    hasPersistedQueryViews.current = true;
    if (skipFirstPersist.current.queryViews && queryViews.length === 0) {
      skipFirstPersist.current.queryViews = false;
      return;
    }
    skipFirstPersist.current.queryViews = false;
    try {
      setPersistedQueryViews(queryViews);
    } catch (_) {
      // localStorage full or disabled
    }
  }, [queryViews]);

  useEffect(() => {
    if (dashboards.length === 0 && !hasPersistedDashboards.current) return;
    hasPersistedDashboards.current = true;
    if (skipFirstPersist.current.dashboards && dashboards.length === 0) {
      skipFirstPersist.current.dashboards = false;
      return;
    }
    skipFirstPersist.current.dashboards = false;
    try {
      setPersistedDashboards(dashboards);
    } catch (_) {
      // localStorage full or disabled
    }
  }, [dashboards]);

  return null;
}
