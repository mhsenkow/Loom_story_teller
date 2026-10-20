// =================================================================
// chartSlice — Recs, active chart, overrides, annotations, ref lines,
//              bar/scatter modes, smart results, deep scan, viz swipe
// =================================================================

import type { StateCreator } from "zustand";
import type { ChartRecommendation } from "../recommendations";
import type { ChartVisualOverrides } from "../chartVisualTypes";
import { extractVizFeatures, recordVizSwipe, setCachedVizPreferences } from "../vizPreferences";
import { setPersistedVizPreferences } from "../persist";
import { resolveDeepScanSource } from "../deepScan";
import { runDeepScan } from "../deepScanClient";
import { newLoomId } from "../loomId";
import type { LoomState } from "./types";
import { chartActivationPatch, prunedChartMaps } from "./coreSlice";
import { chartEditSnapshot, restoreChartEdit, chartHistoryCheckpoint, CHART_EDIT_HISTORY_LIMIT } from "../chartEditHistory";
import { MAX_CUSTOM_CHART_LOOKS } from "../customChartLooks";
import { sanitizeChartVisualOverrides } from "../chartVisualSanitize";

export type ChartSlice = Pick<
  LoomState,
  | "setVegaSpec"
  | "setChartRecs"
  | "setActiveChart"
  | "editActiveChart"
  | "setChartVisualOverrides"
  | "setAISuggestionReason"
  | "setChartTitleOverride"
  | "setSmartResults"
  | "pushChartEditUndo"
  | "undoChartEdit"
  | "redoChartEdit"
  | "editChartVisualOverrides"
  | "saveCustomChartLook"
  | "applyCustomChartLook"
  | "removeCustomChartLook"
  | "addChartAnnotation"
  | "removeChartAnnotation"
  | "updateChartAnnotation"
  | "addCustomRefLine"
  | "removeCustomRefLine"
  | "setBarStackMode"
  | "setConnectScatterTrail"
  | "setShowMarginals"
  | "startDeepScan"
  | "swipeViz"
  | "closeVizSwipe"
>;

export function chartInitialState() {
  return {
    vegaSpec: null as object | null,
    chartRecs: [] as ChartRecommendation[],
    activeChart: null as ChartRecommendation | null,
    chartVisualOverrides: {} as ChartVisualOverrides,
    aiSuggestionReason: null as string | null,
    chartTitleOverrides: {} as Record<string, string>,
    smartResults: null as LoomState["smartResults"],
    chartEditUndoStack: [] as LoomState["chartEditUndoStack"],
    chartEditRedoStack: [] as LoomState["chartEditRedoStack"],
    chartEditGroup: null as LoomState["chartEditGroup"],
    customChartLooks: [] as LoomState["customChartLooks"],
    chartAnnotations: {} as LoomState["chartAnnotations"],
    customRefLines: {} as LoomState["customRefLines"],
    barStackMode: "grouped" as LoomState["barStackMode"],
    connectScatterTrail: false,
    showMarginals: false,
    pngExportHandler: null as LoomState["pngExportHandler"],
    svgExportHandler: null as LoomState["svgExportHandler"],
    svgExportLabel: null as string | null,
    chartViews: [] as LoomState["chartViews"],
  };
}

let deepScanGeneration = 0;

/** Compose-friendly chart actions (LOOM-552). */
export function createChartSlice(
  set: Parameters<StateCreator<LoomState, [], [], ChartSlice>>[0],
  get: Parameters<StateCreator<LoomState, [], [], ChartSlice>>[1],
) {
  return createChartSliceFactory(
    () => deepScanGeneration,
    () => ++deepScanGeneration,
  )(set, get, undefined as never);
}

export function createChartSliceFactory(
  getGeneration: () => number,
  bumpGeneration: () => number,
): StateCreator<LoomState, [], [], ChartSlice> {
  return (set, get) => ({
    setVegaSpec: (spec) =>
      set((s) => ({
        chartEditRedoStack: [],
        chartEditGroup: null,
        vegaSpec: spec,
        activeChart: s.activeChart
          ? { ...s.activeChart, spec: (spec ?? {}) as object }
          : s.activeChart,
      })),
    setChartRecs: (recs) =>
      set((s) => ({
        chartRecs: recs,
        ...prunedChartMaps(s, { chartRecs: recs }),
      })),
    setActiveChart: (chart, opts) =>
      set((s) => ({
        chartEditRedoStack: [],
        chartEditGroup: null,
        activeChart: chart,
        vegaSpec: chart?.spec ?? null,
        aiSuggestionReason: opts?.fromAI ? (opts.aiReason ?? null) : null,
        ...prunedChartMaps(s, { activeChart: chart }),
        ...(chart?.kind === "bar"
          ? { barStackMode: chart.barStackMode ?? "grouped" }
          : {}),
      })),
    setChartVisualOverrides: (overrides) =>
      set((s) => ({
        chartEditRedoStack: [],
        chartEditGroup: null,
        chartVisualOverrides:
          typeof overrides === "function" ? overrides(s.chartVisualOverrides) : overrides,
      })),
    editActiveChart: (chart) =>
      set((s) => {
        const previous = s.activeChart;
        const edited = { ...chart, channelInvert: chart.channelInvert ?? previous?.channelInvert };
        const carry = <T,>(entries: Record<string, T>): Record<string, T> =>
          previous && previous.id !== edited.id && entries[previous.id] !== undefined
            ? { ...entries, [edited.id]: entries[previous.id] }
            : entries;
        const maps = {
          chartTitleOverrides: carry(s.chartTitleOverrides),
          chartAnnotations: carry(s.chartAnnotations),
          customRefLines: carry(s.customRefLines),
        };
        return {
          ...chartHistoryCheckpoint(s),
          activeChart: edited,
          vegaSpec: edited.spec,
          aiSuggestionReason: null,
          ...prunedChartMaps({ ...s, ...maps }, { activeChart: edited }),
          ...(edited.kind === "bar" ? { barStackMode: edited.barStackMode ?? "grouped" } : {}),
        };
      }),
    setAISuggestionReason: (reason) => set({ aiSuggestionReason: reason }),
    setChartTitleOverride: (chartId, title) =>
      set((s) => ({
        ...chartHistoryCheckpoint(s),
        chartTitleOverrides:
          title == null
            ? (() => {
              const next = { ...s.chartTitleOverrides };
              delete next[chartId];
              return next;
            })()
            : { ...s.chartTitleOverrides, [chartId]: title },
      })),
    setSmartResults: (results) =>
      set((s) => ({
        smartResults:
          typeof results === "function" ? results(s.smartResults) : results,
      })),
    pushChartEditUndo: () =>
      set((s) => ({
        chartEditUndoStack: [chartEditSnapshot(s), ...s.chartEditUndoStack].slice(0, CHART_EDIT_HISTORY_LIMIT),
        chartEditRedoStack: [],
        chartEditGroup: null,
      })),
    editChartVisualOverrides: (patch, groupKey) =>
      set((s) => {
        if (Object.entries(patch).every(([key, value]) => s.chartVisualOverrides[key as keyof ChartVisualOverrides] === value)) return s;
        const at = Date.now();
        const grouped = !!groupKey && s.chartEditGroup?.key === groupKey && at - s.chartEditGroup.at < 600;
        const next: ChartVisualOverrides = { ...s.chartVisualOverrides };
        for (const [key, value] of Object.entries(patch) as [keyof ChartVisualOverrides, ChartVisualOverrides[keyof ChartVisualOverrides]][]) {
          if (value === undefined) delete next[key];
          else (next as Record<string, unknown>)[key] = value;
        }
        return {
          chartVisualOverrides: next,
          chartEditUndoStack: grouped ? s.chartEditUndoStack : [chartEditSnapshot(s), ...s.chartEditUndoStack].slice(0, CHART_EDIT_HISTORY_LIMIT),
          chartEditRedoStack: [],
          chartEditGroup: groupKey ? { key: groupKey, at } : null,
        };
      }),
    undoChartEdit: () =>
      set((s) => {
        if (s.chartEditUndoStack.length === 0) return s;
        const [snap, ...rest] = s.chartEditUndoStack;
        return {
          ...restoreChartEdit(snap),
          chartEditUndoStack: rest,
          chartEditRedoStack: [chartEditSnapshot(s), ...s.chartEditRedoStack].slice(0, CHART_EDIT_HISTORY_LIMIT),
          toastMessage: "Chart change undone",
          toastShowUndo: false,
        };
      }),
    redoChartEdit: () =>
      set((s) => {
        const [snap, ...rest] = s.chartEditRedoStack;
        if (!snap) return s;
        return {
          ...restoreChartEdit(snap),
          chartEditRedoStack: rest,
          chartEditUndoStack: [chartEditSnapshot(s), ...s.chartEditUndoStack].slice(0, CHART_EDIT_HISTORY_LIMIT),
          toastMessage: "Chart change redone",
          toastShowUndo: false,
        };
      }),
    saveCustomChartLook: (name) => {
      const clean = name.trim().slice(0, 64);
      if (!clean) return null;
      const s = get();
      const existing = s.customChartLooks.find((look) => look.name.toLowerCase() === clean.toLowerCase());
      if (!existing && s.customChartLooks.length >= MAX_CUSTOM_CHART_LOOKS) {
        s.setToast("Your look library is full — remove a look to save another");
        return null;
      }
      const id = existing?.id ?? newLoomId("look-");
      set({ customChartLooks: [{ id, name: clean, overrides: sanitizeChartVisualOverrides(s.chartVisualOverrides) ?? {}, updatedAt: Date.now() }, ...s.customChartLooks.filter((look) => look.id !== id)] });
      get().setToast(`${existing ? "Updated" : "Saved"} ${clean} look · on this device`);
      return id;
    },
    applyCustomChartLook: (id) => {
      const s = get();
      const look = s.customChartLooks.find((item) => item.id === id);
      if (!look) return;
      s.pushChartEditUndo();
      s.setChartVisualOverrides({ ...look.overrides });
      s.setToast(`Applied ${look.name} look`, { undo: true });
    },
    removeCustomChartLook: (id) => set((s) => ({ customChartLooks: s.customChartLooks.filter((look) => look.id !== id) })),
    addChartAnnotation: (chartId, text, x = 0.5, y = 0.5) =>
      set((s) => {
        const list = s.chartAnnotations[chartId] ?? [];
        return {
          ...chartHistoryCheckpoint(s),
          chartAnnotations: {
            ...s.chartAnnotations,
            [chartId]: [...list, { id: newLoomId("ann-"), text, x, y }],
          },
        };
      }),
    updateChartAnnotation: (chartId, id, patch) =>
      set((s) => {
        const list = s.chartAnnotations[chartId];
        if (!list?.some((a) => a.id === id)) return s;
        const safe = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
        if (safe.x != null) safe.x = Math.max(0, Math.min(1, safe.x));
        if (safe.y != null) safe.y = Math.max(0, Math.min(1, safe.y));
        if (safe.width != null) safe.width = Math.max(.1, Math.min(.9, safe.width));
        if (safe.fontSize != null) safe.fontSize = Math.max(10, Math.min(32, safe.fontSize));
        const before = list.find((a) => a.id === id)!;
        if (Object.entries(safe).every(([k, v]) => before[k as keyof typeof before] === v)) return s;
        return { ...chartHistoryCheckpoint(s), chartAnnotations: { ...s.chartAnnotations, [chartId]: list.map((a) => a.id === id ? { ...a, ...safe } : a) } };
      }),
    removeChartAnnotation: (chartId, id) =>
      set((s) => {
        const remaining = (s.chartAnnotations[chartId] ?? []).filter((a) => a.id !== id);
        const chartAnnotations = { ...s.chartAnnotations };
        if (remaining.length) chartAnnotations[chartId] = remaining;
        else delete chartAnnotations[chartId];
        return { ...chartHistoryCheckpoint(s), chartAnnotations };
      }),
    addCustomRefLine: (chartId, axis, value, label) =>
      set((s) => ({
        ...chartHistoryCheckpoint(s),
        customRefLines: {
          ...s.customRefLines,
          [chartId]: [...(s.customRefLines[chartId] ?? []), { id: newLoomId("rl-"), axis, value, label }],
        },
      })),
    removeCustomRefLine: (chartId, id) =>
      set((s) => {
        const remaining = (s.customRefLines[chartId] ?? []).filter((l) => l.id !== id);
        const customRefLines = { ...s.customRefLines };
        if (remaining.length) customRefLines[chartId] = remaining;
        else delete customRefLines[chartId];
        return { ...chartHistoryCheckpoint(s), customRefLines };
      }),
    setBarStackMode: (mode) => set({ barStackMode: mode, chartEditRedoStack: [], chartEditGroup: null }),
    setConnectScatterTrail: (v) => set((s) => s.connectScatterTrail === v ? s : ({ ...chartHistoryCheckpoint(s), connectScatterTrail: v })),
    setShowMarginals: (v) => set((s) => s.showMarginals === v ? s : ({ ...chartHistoryCheckpoint(s), showMarginals: v })),
    startDeepScan: () => {
      const s = get();
      const columns = s.columnStats;
      const data = s.sampleRows ?? s.queryResult;
      if (!columns.length || !data) {
        get().setToast("Load a dataset before scanning");
        return;
      }

      const token = bumpGeneration();
      const pathAtStart = s.selectedFile?.path ?? "";

      set({
        vizSwipeOpen: true,
        vizScanStatus: "scanning",
        vizScanMessage: "Profiling columns…",
        vizSwipeDeck: [],
        vizSwipeIndex: 0,
        vizSwipeKept: 0,
        vizSwipeSkipped: 0,
        vizSchemaSignature: null,
      });

      const run = async () => {
        const live = get();
        if (token !== getGeneration() || !live.vizSwipeOpen || (live.selectedFile?.path ?? "") !== pathAtStart) {
          return;
        }
        const path = live.selectedFile?.path ?? "";
        const source = resolveDeepScanSource(path, live.selectedFile?.name ?? "data");

        let result: Awaited<ReturnType<typeof runDeepScan>>;
        try {
          result = await runDeepScan(
            { columns, data, prefs: live.vizPreferences, source, deckLimit: 16 },
            (message) => {
              const current = get();
              if (token !== getGeneration() || !current.vizSwipeOpen || (current.selectedFile?.path ?? "") !== pathAtStart) {
                return;
              }
              set({ vizScanMessage: message });
            },
          );
        } catch (err) {
          const afterError = get();
          if (token === getGeneration() && afterError.vizSwipeOpen && (afterError.selectedFile?.path ?? "") === pathAtStart) {
            set({
              vizScanStatus: "idle",
              vizScanMessage: null,
              toastMessage: err instanceof Error ? err.message : "Deep scan failed",
            });
          }
          return;
        }
        const after = get();
        if (token !== getGeneration() || !after.vizSwipeOpen || (after.selectedFile?.path ?? "") !== pathAtStart) {
          return;
        }
        set({
          vizSwipeDeck: result.deck,
          vizSwipeIndex: 0,
          vizScanStatus: result.deck.length ? "ready" : "done",
          vizScanMessage: null,
          vizSchemaSignature: result.profile.schemaSignature,
          chartRecs: result.deck.length ? result.deck : after.chartRecs,
        });
      };

      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
          setTimeout(() => void run(), 40);
        });
      } else {
        setTimeout(() => void run(), 0);
      }
    },
    swipeViz: (direction) => {
      const s = get();
      const rec = s.vizSwipeDeck[s.vizSwipeIndex];
      if (!rec || s.vizScanStatus !== "ready") return;

      const features = extractVizFeatures(rec, s.columnStats, s.vizSchemaSignature ?? undefined);
      const action = direction === "right" ? "like" : "dislike";
      const nextPrefs = recordVizSwipe(s.vizPreferences, action, features);
      setCachedVizPreferences(nextPrefs);
      try {
        setPersistedVizPreferences(nextPrefs);
      } catch {
        // quota
      }

      const patch: Partial<LoomState> = {
        vizPreferences: nextPrefs,
        vizSwipeKept: s.vizSwipeKept + (direction === "right" ? 1 : 0),
        vizSwipeSkipped: s.vizSwipeSkipped + (direction === "left" ? 1 : 0),
      };

      if (direction === "right") {
        Object.assign(patch, chartActivationPatch(rec));
        const rest = s.chartRecs.filter((r) => r.id !== rec.id);
        patch.chartRecs = [rec, ...rest];
      }

      const nextIndex = s.vizSwipeIndex + 1;
      if (nextIndex >= s.vizSwipeDeck.length) {
        patch.vizSwipeIndex = nextIndex;
        patch.vizScanStatus = "done";
      } else {
        patch.vizSwipeIndex = nextIndex;
      }

      set(patch);
    },
    closeVizSwipe: () => {
      bumpGeneration();
      set({
        vizSwipeOpen: false,
        vizScanStatus: "idle",
        vizScanMessage: null,
        vizSwipeDeck: [],
        vizSwipeIndex: 0,
      });
    },
  });
}
