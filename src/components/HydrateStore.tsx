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
  getTablePrefsForPath,
  setTablePrefsForPath,
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
  getVizPreferencesRaw,
  setPersistedVizPreferences,
  getCustomChartLooks,
  setPersistedCustomChartLooks,
  getSourcePreferencesRaw,
  setPersistedSourcePreferences,
  KEY_SOURCE_PREFERENCES,
} from "@/lib/persist";
import { DATA_LIBRARY_KEY, parseDataLibrary } from "@/lib/dataLibrary";
import { parseSourcePreferences } from "@/lib/sourcePreferences";
import type { ViewMode } from "@/lib/store";
import { parseLastSessionViewMode } from "@/lib/persistValidation";
import {
  readIbmToolsShared,
  normalizeTheme,
  normalizeUi,
  normalizeFont,
  normalizeFaces,
} from "@/lib/lookSystem";
import {
  parseVizPreferenceModel,
  setCachedVizPreferences,
  emptyVizPreferenceModel,
} from "@/lib/vizPreferences";
import { stagedHydrateWebFileCache } from "@/lib/webHydration";
import { hydrateChartViewThumbnails, putChartViewThumbnail } from "@/lib/chartViewThumbnails";
import { isDesktop } from "@/lib/tauri";
import { WEB_VAULT_PATH, isWebVaultPath } from "@/lib/webDataFolder";

export function HydrateStore() {
  const hydrated = useRef(false);
  const storageToastShown = useRef(false);
  const notifyStorageFailure = () => {
    if (storageToastShown.current) return;
    storageToastShown.current = true;
    useLoomStore.getState().setToast("Couldn't save — browser storage is full");
  };

  useEffect(() => {
    useLoomStore.setState({ customChartLooks: getCustomChartLooks() });
    return useLoomStore.subscribe((s, prev) => {
      if (s.customChartLooks !== prev.customChartLooks && !setPersistedCustomChartLooks(s.customChartLooks)) {
        notifyStorageFailure();
      }
    });
    // Persistence is owned by this one mount, independent of chart panel visibility.
  }, []);

  useEffect(() => {
    // Source ♥ / Less / Hide / Save + opens (envelope parse also migrates v0 maps).
    const read = (raw: string | null) => {
      try {
        return parseSourcePreferences(raw ? JSON.parse(raw) : null);
      } catch {
        return parseSourcePreferences(null); // corrupt → empty
      }
    };
    // Loading from storage must not write straight back.
    let adopting = false;
    const adopt = () => {
      adopting = true;
      useLoomStore.getState().setSourcePrefs(read(getSourcePreferencesRaw()));
      adopting = false;
    };
    adopt();
    const unsubscribe = useLoomStore.subscribe((s, prev) => {
      if (s.sourcePrefs !== prev.sourcePrefs && !adopting && !setPersistedSourcePreferences(s.sourcePrefs)) {
        notifyStorageFailure();
      }
    });
    // Another tab changed them: adopt its copy so a stale tab never writes over newer picks.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_SOURCE_PREFERENCES || e.key === null) adopt();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let adopting = false;
    const adopt = () => {
      adopting = true;
      try { useLoomStore.setState({ dataLibrary: parseDataLibrary(JSON.parse(localStorage.getItem(DATA_LIBRARY_KEY) ?? 'null')) }); }
      catch { /* Preserve the current library if storage cannot be read. */ }
      adopting = false;
    };
    adopt();
    const unsubscribe = useLoomStore.subscribe((s, prev) => {
      if (adopting || s.dataLibrary === prev.dataLibrary) return;
      try { localStorage.setItem(DATA_LIBRARY_KEY, JSON.stringify({ v: 1, data: s.dataLibrary })); }
      catch { notifyStorageFailure(); }
    });
    const onStorage = (e: StorageEvent) => { if (e.key === DATA_LIBRARY_KEY || e.key === null) adopt(); };
    window.addEventListener('storage', onStorage);
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, []);

  const skipFirstPersist = useRef({
    appSettings: true,
    recentFiles: true,
    queryHistory: true,
    querySnippets: true,
    tablePrefs: true,
    tableViews: true,
    chartViews: true,
    queryViews: true,
    dashboards: true,
    vizPreferences: true,
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
    setVizPreferences,
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
    vizPreferences,
    selectedFile,
  } = useLoomStore();
  const selectedPath = selectedFile?.path ?? null;
  const skipTablePrefsPathLoad = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const saved = getPersistedAppSettings();
    if (saved) {
      setAppSettings((prev) => ({
        ...prev,
        ...(saved.theme && {
          theme: (saved.theme === "high-contrast"
            ? "contrast"
            : saved.theme === "colorblind"
              ? "dark"
              : saved.theme) as typeof prev.theme,
          ...(saved.theme === "colorblind" ? { colorblindCharts: true } : {}),
        }),
        ...(saved.uiChrome && { uiChrome: saved.uiChrome as typeof prev.uiChrome }),
        ...(saved.font && { font: saved.font as typeof prev.font }),
        ...(saved.faces && { faces: saved.faces as typeof prev.faces }),
        ...(typeof saved.fontScale === "number" && { fontScale: saved.fontScale as typeof prev.fontScale }),
        ...(typeof saved.reducedMotion === "boolean"
          ? { reducedMotion: saved.reducedMotion }
          : typeof window !== "undefined" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? { reducedMotion: true }
            : {}),
        ...(typeof saved.themePairing === "boolean" && { themePairing: saved.themePairing }),
        ...(typeof saved.colorblindCharts === "boolean" && { colorblindCharts: saved.colorblindCharts }),
        ...(saved.chartAspect && { chartAspect: saved.chartAspect as typeof prev.chartAspect }),
        ...(saved.chartDevice && { chartDevice: saved.chartDevice as typeof prev.chartDevice }),
      }));
    } else {
      const shared = readIbmToolsShared();
      const preferReduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (shared || preferReduce) {
        setAppSettings((prev) => ({
          ...prev,
          ...(shared?.theme && { theme: normalizeTheme(shared.theme) as typeof prev.theme }),
          ...(shared?.ui && { uiChrome: normalizeUi(shared.ui) as typeof prev.uiChrome }),
          ...(shared?.font && { font: normalizeFont(shared.font) as typeof prev.font }),
          ...(shared?.faces && { faces: normalizeFaces(shared.faces) as typeof prev.faces }),
          ...(preferReduce ? { reducedMotion: true } : {}),
        }));
      }
    }

    const recent = getRecentFiles();
    if (recent.length) setRecentFiles(recent as import("@/lib/store").FileEntry[]);

    // Browser uploads: index first, sample rows in background (LOOM-304).
    if (typeof window !== "undefined" && !isDesktop()) {
      void stagedHydrateWebFileCache({
        onIndex(entries) {
          if (!entries.length) return;
          const s = useLoomStore.getState();
          const have = new Set(s.files.map((f) => f.path));
          const extra = entries.filter((e) => !have.has(e.path));
          if (extra.length && (!s.mountedFolder || isWebVaultPath(s.mountedFolder))) {
            s.setMountedFolder(WEB_VAULT_PATH);
            s.setFiles([
              ...s.files.filter((f) => f.path.startsWith("web://")),
              ...extra.filter((e) => !s.files.some((f) => f.path === e.path)),
            ]);
          }
        },
        onSample(path, payload) {
          const s = useLoomStore.getState();
          s.setWebFileCache({ ...s.webFileCache, [path]: payload });
        },
      });
    }

    const session = getLastSession();
    if (session)
      setLastSession({
        folderPath: session.folderPath,
        filePath: session.filePath,
        viewMode: parseLastSessionViewMode(session.viewMode) as ViewMode,
      });

    const qh = getQueryHistory();
    if (qh.length) setQueryHistory(qh);

    const snippets = getQuerySnippets();
    if (snippets.length) setQuerySnippets(snippets);

    const views = getTableViews();
    if (views.length) setTableViews(views);

    const cv = getChartViews();
    if (cv.length) {
      setChartViews(cv);
      void hydrateChartViewThumbnails(cv.map((v) => v.id)).then((thumbs) => {
        if (!Object.keys(thumbs).length) return;
        useLoomStore.setState((s) => ({
          chartViews: s.chartViews.map((v) =>
            thumbs[v.id] ? { ...v, snapshotImageDataUrl: thumbs[v.id]! } : v,
          ),
        }));
      });
    }

    const qv = getQueryViews();
    if (qv.length) setQueryViews(qv);

    const db = getDashboards();
    if (db.length) {
      const layouts = new Set([
        "auto",
        "1x1",
        "2x1",
        "2x2",
        "3x2",
        "1+2",
        "stream",
      ]);
      const refresh = new Set(["manual", "1m", "5m", "15m", "1h"]);
      setDashboards(
        db.map((d) => ({
          id: d.id,
          name: d.name,
          slots: d.slots as import("@/lib/store").DashboardSlot[],
          layoutTemplate:
            d.layoutTemplate && layouts.has(d.layoutTemplate)
              ? (d.layoutTemplate as import("@/lib/store").DashboardLayoutTemplate)
              : undefined,
          refreshInterval:
            d.refreshInterval && refresh.has(d.refreshInterval)
              ? (d.refreshInterval as import("@/lib/store").DashboardRefreshInterval)
              : undefined,
          lastRefreshedAt: d.lastRefreshedAt ?? undefined,
        })),
      );
    }

    const vizRaw = getVizPreferencesRaw();
    if (vizRaw) {
      try {
        const model = parseVizPreferenceModel(JSON.parse(vizRaw));
        setCachedVizPreferences(model);
        setVizPreferences(model);
      } catch {
        const empty = emptyVizPreferenceModel();
        setCachedVizPreferences(empty);
        setVizPreferences(empty);
      }
    } else {
      const empty = emptyVizPreferenceModel();
      setCachedVizPreferences(empty);
    }
  }, []);

  useEffect(() => {
    if (skipFirstPersist.current.appSettings) {
      skipFirstPersist.current.appSettings = false;
      return;
    }
    if (!setPersistedAppSettings(appSettings)) notifyStorageFailure();
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
    setPersistedRecentFiles(
      recentFiles.map((f) => ({
        path: f.path,
        name: f.name,
        extension: f.extension,
        row_count: f.row_count,
        size_bytes: f.size_bytes,
        ...(f.sourceUrl ? { sourceUrl: f.sourceUrl } : {}),
        ...(f.sourceHome ? { sourceHome: f.sourceHome } : {}),
        ...(f.sourceCredit ? { sourceCredit: f.sourceCredit } : {}),
        ...(f.capturedAt ? { capturedAt: f.capturedAt } : {}),
        ...(f.originPath ? { originPath: f.originPath } : {}),
      })),
    );
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

  // LOOM-205: load column prefs for the active dataset path.
  useEffect(() => {
    if (!selectedPath) return;
    skipTablePrefsPathLoad.current = true;
    const prefs = getTablePrefsForPath(selectedPath) ?? {
      visibleColumns: null,
      columnOrder: null,
    };
    setTablePrefs(prefs);
  }, [selectedPath, setTablePrefs]);

  useEffect(() => {
    if (skipFirstPersist.current.tablePrefs) {
      skipFirstPersist.current.tablePrefs = false;
      return;
    }
    if (skipTablePrefsPathLoad.current) {
      skipTablePrefsPathLoad.current = false;
      return;
    }
    if (!selectedPath) return;
    setTablePrefsForPath(selectedPath, tablePrefs);
  }, [tablePrefs, selectedPath]);

  useEffect(() => {
    if (tableViews.length === 0 && !hasPersistedTableViews.current) return;
    hasPersistedTableViews.current = true;
    if (skipFirstPersist.current.tableViews && tableViews.length === 0) {
      skipFirstPersist.current.tableViews = false;
      return;
    }
    skipFirstPersist.current.tableViews = false;
    if (!setPersistedTableViews(tableViews)) notifyStorageFailure();
  }, [tableViews]);

  useEffect(() => {
    if (chartViews.length === 0 && !hasPersistedChartViews.current) return;
    hasPersistedChartViews.current = true;
    if (skipFirstPersist.current.chartViews && chartViews.length === 0) {
      skipFirstPersist.current.chartViews = false;
      return;
    }
    skipFirstPersist.current.chartViews = false;
    for (const c of chartViews) {
      if (c.snapshotImageDataUrl?.startsWith("data:")) {
        void putChartViewThumbnail(c.id, c.snapshotImageDataUrl).catch(() => {});
      }
    }
    if (
      !setPersistedChartViews(
        chartViews.map((c) => ({
          id: c.id,
          name: c.name,
          filePath: c.filePath,
          fileName: c.fileName,
          chart: c.chart as unknown as Record<string, unknown>,
          visualOverrides: c.visualOverrides as unknown as Record<string, unknown>,
          querySql: c.querySql ?? null,
          snapshotImageDataUrl: null,
        })),
      )
    ) {
      notifyStorageFailure();
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
    if (!setPersistedQueryViews(queryViews)) notifyStorageFailure();
  }, [queryViews]);

  useEffect(() => {
    if (dashboards.length === 0 && !hasPersistedDashboards.current) return;
    hasPersistedDashboards.current = true;
    if (skipFirstPersist.current.dashboards && dashboards.length === 0) {
      skipFirstPersist.current.dashboards = false;
      return;
    }
    skipFirstPersist.current.dashboards = false;
    if (!setPersistedDashboards(dashboards)) notifyStorageFailure();
  }, [dashboards]);

  useEffect(() => {
    if (skipFirstPersist.current.vizPreferences) {
      skipFirstPersist.current.vizPreferences = false;
      return;
    }
    if (setPersistedVizPreferences(vizPreferences)) {
      setCachedVizPreferences(vizPreferences);
    } else {
      notifyStorageFailure();
    }
  }, [vizPreferences]);

  return null;
}
