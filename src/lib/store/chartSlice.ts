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

export type ChartSlice = Pick<
  LoomState,
  | "setVegaSpec"
  | "setChartRecs"
  | "setActiveChart"
  | "setChartVisualOverrides"
  | "setAISuggestionReason"
  | "setChartTitleOverride"
  | "setSmartResults"
  | "pushChartEditUndo"
  | "undoChartEdit"
  | "addChartAnnotation"
  | "removeChartAnnotation"
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
        chartVisualOverrides:
          typeof overrides === "function" ? overrides(s.chartVisualOverrides) : overrides,
      })),
    setAISuggestionReason: (reason) => set({ aiSuggestionReason: reason }),
    setChartTitleOverride: (chartId, title) =>
      set((s) => ({
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
        chartEditUndoStack: [
          {
            activeChart: s.activeChart ? (JSON.parse(JSON.stringify(s.activeChart)) as ChartRecommendation) : null,
            chartVisualOverrides: JSON.parse(JSON.stringify(s.chartVisualOverrides)) as ChartVisualOverrides,
          },
          ...s.chartEditUndoStack,
        ].slice(0, 20),
      })),
    undoChartEdit: () =>
      set((s) => {
        if (s.chartEditUndoStack.length === 0) return s;
        const [snap, ...rest] = s.chartEditUndoStack;
        return {
          activeChart: snap.activeChart,
          chartVisualOverrides: snap.chartVisualOverrides,
          chartEditUndoStack: rest,
          toastMessage: "Chart change undone",
          toastShowUndo: false,
        };
      }),
    addChartAnnotation: (chartId, text, x = 0.5, y = 0.5) =>
      set((s) => {
        const list = s.chartAnnotations[chartId] ?? [];
        return {
          chartAnnotations: {
            ...s.chartAnnotations,
            [chartId]: [...list, { id: newLoomId("ann-"), text, x, y }],
          },
        };
      }),
    removeChartAnnotation: (chartId, id) =>
      set((s) => {
        const remaining = (s.chartAnnotations[chartId] ?? []).filter((a) => a.id !== id);
        const chartAnnotations = { ...s.chartAnnotations };
        if (remaining.length) chartAnnotations[chartId] = remaining;
        else delete chartAnnotations[chartId];
        return { chartAnnotations };
      }),
    addCustomRefLine: (chartId, axis, value, label) =>
      set((s) => ({
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
        return { customRefLines };
      }),
    setBarStackMode: (mode) => set({ barStackMode: mode }),
    setConnectScatterTrail: (v) => set({ connectScatterTrail: v }),
    setShowMarginals: (v) => set({ showMarginals: v }),
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
