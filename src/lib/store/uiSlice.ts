import { assetForFile, emptyDataLibrary } from "../dataLibrary";
// =================================================================
// uiSlice — settings, toast, recent files, prompt, export, stream
// =================================================================

import { resolveThemePairing } from "../themePairing";
import type { ExportBurnInOptions, SocialExportTarget, SocialPresetId } from "../socialExport";
import { DEFAULT_BURN_IN } from "../socialExport";
import type { VizPreferenceModel } from "../vizPreferences";
import { emptyVizPreferenceModel, extractVizFeatures, recordVizSwipe, setCachedVizPreferences } from "../vizPreferences";
import {
  emptySourcePreferences,
  recordSourceOpen,
  setCachedSourcePreferences,
  setSourceReaction,
  toggleSourceSaved,
  type SourcePreferences,
  type SourceReaction,
} from "../sourcePreferences";
import { refForPath, type SourceRef } from "../sourceRef";
import { resolveDeepScanSource } from "../deepScan";
import { runDeepScan } from "../deepScanClient";
import { setPersistedVizPreferences } from "../persist";
import { clearAllWebFileInspects } from "../webFileStore";
import { clearLinkedDirectory } from "../webDataFolder";
import { clearPersistedPreferences, clearPersistedSessionKeys } from "../persist";
import type { LoomState, AppSettings, FileEntry, PromptDialogConfig, ViewMode } from "./types";
import type { ChartRecommendation } from "../recommendations";
import { datasetScopedResetSlice, chartActivationPatch } from "./coreSlice";

let deepScanGeneration = 0;

export function uiInitialState() {
  return {
    webFileCache: {} as Record<string, { stats: LoomState["columnStats"][0][]; sample: LoomState["sampleRows"] & object }>,
    webImportOperationId: 0,
    appSettings: {
      theme: "dark", uiChrome: "noyes", font: "inter", faces: "local",
      fontScale: 1, reducedMotion: false, colorblindCharts: false,
      chartAspect: "free", chartDevice: "auto",
    } as AppSettings,
    recentFiles: [] as FileEntry[],
    lastSession: null as { folderPath: string | null; filePath: string | null; viewMode: ViewMode } | null,
    toastMessage: null as string | null,
    toastShowUndo: false,
    promptDialog: null as PromptDialogConfig | null,
    socialExportTarget: null as SocialExportTarget | null,
    socialExportReady: false,
    exportBurnIn: { ...DEFAULT_BURN_IN } as ExportBurnInOptions,
    exportSupersample: 1 as 1 | 2,
    socialPresetId: "ig-square" as SocialPresetId,
    shareSheetOpen: false,
    chartFocus: false,
    whatsNewOpen: false,
    discoverReturnPath: null as string | null,
    // Live stream
    streamRunning: false,
    streamTotalEvents: 0,
    streamEventsPerSec: 0,
    streamBufferRows: 0,
    streamWikisSeen: 0,
    streamStartedAt: null as number | null,
    sourceStatuses: {} as LoomState["sourceStatuses"],
    feedHealth: {} as LoomState["feedHealth"],
    sourcePrefs: emptySourcePreferences(),
    // Viz swipe
    vizPreferences: emptyVizPreferenceModel(),
    vizSwipeOpen: false,
    vizSwipeDeck: [] as ChartRecommendation[],
    vizSwipeIndex: 0,
    vizScanStatus: "idle" as const,
    vizScanMessage: null as string | null,
    vizSwipeKept: 0,
    vizSwipeSkipped: 0,
    vizSchemaSignature: null as string | null,
    // Dive / chart links
    diveQuery: null as LoomState["diveQuery"],
    diveLink: null as LoomState["diveLink"],
    chartLink: null as LoomState["chartLink"],
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;
type Getter = () => LoomState;

export function createUiSlice(set: Setter, get: Getter, initialState: Record<string, unknown>) {
  return {
    setWebFileCache: (cache: LoomState["webFileCache"]) => set({ webFileCache: cache }),
    beginWebImport: () => {
      const id = get().webImportOperationId + 1;
      set({ webImportOperationId: id });
      return id;
    },
    isActiveWebImport: (id: number) => get().webImportOperationId === id,
    setAppSettings: (settings: AppSettings | ((prev: AppSettings) => AppSettings)) =>
      set((s) => ({ appSettings: resolveThemePairing(s.appSettings, typeof settings === "function" ? settings(s.appSettings) : settings) })),
    setRecentFiles: (files: FileEntry[]) => set({ recentFiles: files }),
    addRecentFile: (file: FileEntry) =>
      set((s) => {
        const prev = s.recentFiles.find((f) => f.path === file.path);
        const merged = { ...file, sourceUrl: file.sourceUrl ?? prev?.sourceUrl, sourceHome: file.sourceHome ?? prev?.sourceHome, sourceCredit: file.sourceCredit ?? prev?.sourceCredit, capturedAt: file.capturedAt ?? prev?.capturedAt, originPath: file.originPath ?? prev?.originPath };
        const list = s.recentFiles.filter((f) => f.path !== file.path);
        list.unshift(merged);
        return { recentFiles: list.slice(0, 20) };
      }),
    removeRecentFile: (path: string) => set((s) => ({ recentFiles: s.recentFiles.filter((f) => f.path !== path), lastSession: s.lastSession?.filePath === path ? null : s.lastSession })),
    clearRecentFiles: () => set({ recentFiles: [], lastSession: null }),
    setLastSession: (sess: LoomState["lastSession"]) => set({ lastSession: sess }),
    setToast: (msg: string | null, options?: { undo?: boolean }) =>
      set({ toastMessage: msg, toastShowUndo: options?.undo ?? false, ...(msg == null ? { toastShowUndo: false } : {}) }),
    setPromptDialog: (config: PromptDialogConfig | null) => set({ promptDialog: config }),
    setSocialExportTarget: (v: SocialExportTarget | null) => set({ socialExportTarget: v }),
    setSocialExportReady: (v: boolean) => set({ socialExportReady: v }),
    setExportBurnIn: (v: ExportBurnInOptions | ((prev: ExportBurnInOptions) => ExportBurnInOptions)) =>
      set((s) => ({ exportBurnIn: typeof v === "function" ? v(s.exportBurnIn) : v })),
    setExportSupersample: (v: 1 | 2) => set({ exportSupersample: v }),
    setSocialPresetId: (id: SocialPresetId) => set({ socialPresetId: id }),
    setShareSheetOpen: (v: boolean) => set({ shareSheetOpen: v }),
    setChartFocus: (v: boolean) => set({ chartFocus: v }),
    setDiscoverReturnPath: (path: string | null) => set({ discoverReturnPath: path }),
    setWhatsNewOpen: (v: boolean) => set({ whatsNewOpen: v }),
    setStreamStatus: (status: { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; wikis_seen: number; started_at: number | null }) =>
      set({ streamRunning: status.running, streamTotalEvents: status.total_events, streamEventsPerSec: status.events_per_sec, streamBufferRows: status.buffer_rows, streamWikisSeen: status.wikis_seen, streamStartedAt: status.started_at }),
    setFeedHealth: (health: LoomState["feedHealth"]) => set({ feedHealth: health }),
    setSourceStatus: (kind: string, status: { running: boolean; total_events: number; events_per_sec: number; buffer_rows: number; started_at: number | null; last_error?: string | null; last_success_at?: number | null; snapshot_stale?: boolean; snapshot_captured_at?: number | null }) =>
      set((s) => {
        const prev = s.sourceStatuses[kind];
        if (prev && prev.running === status.running && prev.total_events === status.total_events && prev.events_per_sec === status.events_per_sec && prev.buffer_rows === status.buffer_rows && prev.started_at === status.started_at && (prev.last_error ?? null) === (status.last_error ?? null)) return s;
        return { sourceStatuses: { ...s.sourceStatuses, [kind]: { ...status } } };
      }),
    setVizPreferences: (model: VizPreferenceModel) => { setCachedVizPreferences(model); set({ vizPreferences: model }); },
    setSourcePrefs: (prefs: SourcePreferences) => { setCachedSourcePreferences(prefs); set({ sourcePrefs: prefs }); },
    reactToSource: (ref: SourceRef, reaction: SourceReaction | null) => get().setSourcePrefs(setSourceReaction(get().sourcePrefs, ref, reaction)),
    toggleSavedSource: (ref: SourceRef) => {
      const state = get();
      if (!state.sourcePrefs.entries[ref]?.saved) {
        const file = [state.selectedFile, ...state.files, ...state.recentFiles].find(f => f && refForPath(f.path, f) === ref);
        if (file) state.rememberLibraryAsset(assetForFile(file));
      }
      state.setSourcePrefs(toggleSourceSaved(state.sourcePrefs, ref));
    },
    noteSourceOpened: (ref: SourceRef) => {
      const next = recordSourceOpen(get().sourcePrefs, ref);
      if (next !== get().sourcePrefs) get().setSourcePrefs(next);
    },
    startDeepScan: () => {
      const s = get();
      if (!s.columnStats.length || (!s.sampleRows && !s.queryResult)) { get().setToast("Load a dataset before scanning"); return; }
      const token = ++deepScanGeneration;
      const pathAtStart = s.selectedFile?.path ?? "";
      set({ vizSwipeOpen: true, vizScanStatus: "scanning", vizScanMessage: "Profiling columns…", vizSwipeDeck: [], vizSwipeIndex: 0, vizSwipeKept: 0, vizSwipeSkipped: 0, vizSchemaSignature: null });
      const run = async () => {
        const live = get();
        if (token !== deepScanGeneration || !live.vizSwipeOpen || (live.selectedFile?.path ?? "") !== pathAtStart) return;
        const path = live.selectedFile?.path ?? "";
        const source = resolveDeepScanSource(path, live.selectedFile?.name ?? "data");
        let result: Awaited<ReturnType<typeof runDeepScan>>;
        try {
          result = await runDeepScan(
            { columns: s.columnStats, data: s.sampleRows ?? s.queryResult!, prefs: live.vizPreferences, source, deckLimit: 16 },
            (message) => { const current = get(); if (token !== deepScanGeneration || !current.vizSwipeOpen || (current.selectedFile?.path ?? "") !== pathAtStart) return; set({ vizScanMessage: message }); },
          );
        } catch (err) {
          const afterError = get();
          if (token === deepScanGeneration && afterError.vizSwipeOpen && (afterError.selectedFile?.path ?? "") === pathAtStart) {
            set({ vizScanStatus: "idle", vizScanMessage: null, toastMessage: err instanceof Error ? err.message : "Deep scan failed" });
          }
          return;
        }
        const after = get();
        if (token !== deepScanGeneration || !after.vizSwipeOpen || (after.selectedFile?.path ?? "") !== pathAtStart) return;
        set({ vizSwipeDeck: result.deck, vizSwipeIndex: 0, vizScanStatus: result.deck.length ? "ready" : "done", vizScanMessage: null, vizSchemaSignature: result.profile.schemaSignature, chartRecs: result.deck.length ? result.deck : after.chartRecs });
      };
      if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => { setTimeout(() => void run(), 40); });
      else setTimeout(() => void run(), 0);
    },
    swipeViz: (direction: "left" | "right") => {
      const s = get();
      const rec = s.vizSwipeDeck[s.vizSwipeIndex];
      if (!rec || s.vizScanStatus !== "ready") return;
      const features = extractVizFeatures(rec, s.columnStats, s.vizSchemaSignature ?? undefined);
      const action = direction === "right" ? "like" : "dislike";
      const nextPrefs = recordVizSwipe(s.vizPreferences, action, features);
      setCachedVizPreferences(nextPrefs);
      try { setPersistedVizPreferences(nextPrefs); } catch { /* quota */ }
      const patch: Partial<LoomState> = {
        vizPreferences: nextPrefs,
        vizSwipeKept: s.vizSwipeKept + (direction === "right" ? 1 : 0),
        vizSwipeSkipped: s.vizSwipeSkipped + (direction === "left" ? 1 : 0),
      };
      if (direction === "right") {
        Object.assign(patch, chartActivationPatch(rec));
        patch.chartRecs = [rec, ...s.chartRecs.filter((r) => r.id !== rec.id)];
      }
      const nextIndex = s.vizSwipeIndex + 1;
      patch.vizSwipeIndex = nextIndex;
      if (nextIndex >= s.vizSwipeDeck.length) patch.vizScanStatus = "done";
      set(patch);
    },
    closeVizSwipe: () => { deepScanGeneration++; set({ vizSwipeOpen: false, vizScanStatus: "idle", vizScanMessage: null, vizSwipeDeck: [], vizSwipeIndex: 0 }); },
    resetWorkspace: () =>
      set({
        ...datasetScopedResetSlice(initialState),
        mountedFolder: null, files: [], selectedFile: null, columnStats: [], sampleRows: null,
        webFileCache: {}, chartRecs: [], activeChart: null, vegaSpec: null,
        inspectingFilePath: null, isScanning: false, lastSession: null, recentFiles: [],
      } as Partial<LoomState>),
    resetPreferencesInStore: () => {
      setCachedSourcePreferences(emptySourcePreferences());
      set({
        appSettings: { ...(initialState.appSettings as AppSettings) },
        queryHistory: [], querySnippets: [],
        tablePrefs: { ...(initialState.tablePrefs as { visibleColumns: null; columnOrder: null }) },
        tableViews: [], chartViews: [], queryViews: [], dashboards: [], customChartLooks: [],
        activeDashboardId: null, vizPreferences: emptyVizPreferenceModel(),
        sourcePrefs: emptySourcePreferences(),
        dataLibrary: emptyDataLibrary(),
      });
    },
    clearRetainedLocalData: async () => {
      set((s) => ({ webImportOperationId: s.webImportOperationId + 1 }));
      await clearAllWebFileInspects();
      await clearLinkedDirectory();
      clearPersistedPreferences();
      clearPersistedSessionKeys();
      get().resetWorkspace();
    },
    reset: () => set(initialState as Partial<LoomState>),
  };
}
