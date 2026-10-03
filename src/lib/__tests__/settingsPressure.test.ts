/**
 * Pressure tests — themes, palettes, viewport, shuffle, recommendations, store.
 * Pure lib coverage; no React/DOM rendering.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { THEMES, shuffleVisualOverrides, type VisualShuffleLocks } from "../lookSystem";
import {
  COLOR_PALETTES,
  getThemeUiColors,
  resolveChartColors,
} from "../chartPalettes";
import {
  CHART_ASPECTS,
  DEVICE_MAX_WIDTH,
  fitChartFrame,
  resolveDevice,
  type DetectedDevice,
} from "../chartViewport";
import { resolveChartPad, resolveChartMargins } from "../chartLayout";
import {
  recommend,
  recommendStorySequence,
  getBestSuggestion,
  CHART_KIND_OPTIONS,
} from "../recommendations";
import { useLoomStore } from "../store";
import type { ChartVisualOverrides, ColumnInfo, QueryResult } from "../store";
import {
  getPersistedAppSettings,
  setPersistedAppSettings,
  type PersistedAppSettings,
} from "../persist";

const HOST_W = 1200;
const HOST_H = 800;
const DEVICES: DetectedDevice[] = ["mobile", "tablet", "desktop"];

const SYNTH_COLUMNS: ColumnInfo[] = [
  { name: "amount", data_type: "DOUBLE", null_count: 0, distinct_count: 80, min_value: "1", max_value: "999" },
  { name: "score", data_type: "INTEGER", null_count: 0, distinct_count: 50, min_value: "0", max_value: "100" },
  { name: "units", data_type: "BIGINT", null_count: 0, distinct_count: 30, min_value: "10", max_value: "500" },
  { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 5, min_value: null, max_value: null },
  { name: "region", data_type: "VARCHAR", null_count: 0, distinct_count: 4, min_value: null, max_value: null },
  { name: "recorded_at", data_type: "DATE", null_count: 0, distinct_count: 30, min_value: "2024-01-01", max_value: "2024-12-31" },
];

const SYNTH_DATA: QueryResult = {
  columns: SYNTH_COLUMNS.map((c) => c.name),
  types: SYNTH_COLUMNS.map((c) => c.data_type),
  rows: Array.from({ length: 120 }, (_, i) => [
    (i * 7.3) % 999,
    i % 100,
    (i * 13) % 500,
    ["A", "B", "C", "D", "E"][i % 5]!,
    ["North", "South", "East", "West"][i % 4]!,
    `2024-${String((i % 12) + 1).padStart(2, "0")}-15`,
  ]),
  total_rows: 120,
};

const SHUFFLE_BASE: ChartVisualOverrides = {
  colorPalette: "categorical",
  colorScaleKind: "categorical",
  colorPaletteReverse: false,
  opacity: 0.72,
  pointSize: 11,
  chartDetail: "viz",
  markMotif: "dots",
  axisStyle: "rule",
  titleLayout: "pair",
  chartFrame: "focus",
  emphasisStyle: "tint",
  backgroundStyle: "default",
  showGrid: true,
  gridStyle: "dashed",
  gridOpacity: 0.35,
  axisLineColor: "#444444",
  axisLineWidth: 1,
  axisLabelColor: "#666666",
  tickCount: 6,
  tickRotation: 0,
  axisFontSize: 10,
  chartPadding: 28,
  legendPosition: "top-right",
  markShape: "circle",
  markStroke: false,
  markStrokeWidth: 1,
  sizeScale: 1,
  barCornerRadius: 2,
  lineStrokeStyle: "solid",
  lineCurveSmooth: true,
  lineWidth: 2,
  showDataLabels: false,
  blendMode: "source-over",
  glowEnabled: false,
  glowIntensity: 0.4,
  animateEntrance: false,
  ghostEnabled: false,
  ghostWeight: "soft",
  ghostPlace: "se",
  fontFamily: "Inter",
  titleFontWeight: 600,
  titleItalic: false,
};

const ALL_SHUFFLE_LOCKS: VisualShuffleLocks = {
  color: true,
  design: true,
  marks: true,
  axes: true,
  atmosphere: true,
  type: true,
};

function getState() {
  return useLoomStore.getState();
}

function expectPositiveFinite(n: number) {
  expect(Number.isFinite(n)).toBe(true);
  expect(n).toBeGreaterThan(0);
}

beforeEach(() => {
  getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settingsPressure", () => {
  describe("themes × palettes", () => {
    const paletteIds = COLOR_PALETTES.map((p) => p.id);
    const chartKinds = ["scatter", "bar", "heatmap", "pie", "line"] as const;

    for (const theme of THEMES) {
      it(`getThemeUiColors(${theme}) returns valid UI colors`, () => {
        const ui = getThemeUiColors(theme);
        expect(ui.bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ui.text).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ui.muted).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ui.border).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ui.accent).toMatch(/^#[0-9a-f]{6}$/i);
      });

      for (const paletteId of paletteIds) {
        it(`resolveChartColors theme=${theme} palette=${paletteId} never throws`, () => {
          for (const chartKind of chartKinds) {
            const r = resolveChartColors({ paletteId, theme, chartKind });
            expect(r.colors.length).toBeGreaterThanOrEqual(1);
            for (const c of r.colors) {
              expect(c).toMatch(/^#[0-9a-f]{6}$/i);
            }
          }
        });
      }

      it(`resolveChartColors theme=${theme} handles colorblind + reverse`, () => {
        const r = resolveChartColors({
          paletteId: "auto",
          theme,
          colorblind: true,
          reverse: true,
          chartKind: "scatter",
        });
        expect(r.colors.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("viewport fitChartFrame grid", () => {
    for (const aspect of CHART_ASPECTS) {
      for (const device of DEVICES) {
        it(`fit ${aspect.id} on ${device} (${HOST_W}×${HOST_H})`, () => {
          const f = fitChartFrame({
            hostW: HOST_W,
            hostH: HOST_H,
            aspectId: aspect.id,
            device,
          });
          expectPositiveFinite(f.width);
          expectPositiveFinite(f.height);
          expect(f.width).toBeLessThanOrEqual(DEVICE_MAX_WIDTH[device] + 24);
          expect(f.height).toBeLessThanOrEqual(HOST_H);

          if (aspect.ratio != null && f.aspectLocked) {
            const actual = f.width / f.height;
            expect(actual).toBeCloseTo(aspect.ratio, 1);
          }

          if (aspect.id === "free") {
            expect(f.aspectLocked).toBe(false);
          } else {
            expect(f.aspectLocked).toBe(true);
          }
        });
      }
    }
  });

  describe("resolveDevice auto breakpoints", () => {
    it("maps viewport widths to mobile / tablet / desktop", () => {
      expect(resolveDevice("auto", 400)).toBe("mobile");
      expect(resolveDevice("auto", 900)).toBe("tablet");
      expect(resolveDevice("auto", 1400)).toBe("desktop");
    });

    it("honors explicit device presets regardless of width", () => {
      expect(resolveDevice("desktop", 400)).toBe("desktop");
      expect(resolveDevice("mobile", 1400)).toBe("mobile");
    });
  });

  describe("shuffleVisualOverrides", () => {
    it("never throws with empty locks (50 iterations)", () => {
      for (let i = 0; i < 50; i++) {
        expect(() => shuffleVisualOverrides(SHUFFLE_BASE, {})).not.toThrow();
      }
    });

    it("never throws with all locks (50 iterations)", () => {
      for (let i = 0; i < 50; i++) {
        expect(() => shuffleVisualOverrides(SHUFFLE_BASE, ALL_SHUFFLE_LOCKS)).not.toThrow();
      }
    });

    it("preserves all locked fields when every section is locked", () => {
      for (let i = 0; i < 30; i++) {
        const next = shuffleVisualOverrides(SHUFFLE_BASE, ALL_SHUFFLE_LOCKS);
        expect(next.colorPalette).toBe(SHUFFLE_BASE.colorPalette);
        expect(next.colorScaleKind).toBe(SHUFFLE_BASE.colorScaleKind);
        expect(next.opacity).toBe(SHUFFLE_BASE.opacity);
        expect(next.chartDetail).toBe(SHUFFLE_BASE.chartDetail);
        expect(next.markMotif).toBe(SHUFFLE_BASE.markMotif);
        expect(next.axisStyle).toBe(SHUFFLE_BASE.axisStyle);
        expect(next.pointSize).toBe(SHUFFLE_BASE.pointSize);
        expect(next.showGrid).toBe(SHUFFLE_BASE.showGrid);
        expect(next.glowEnabled).toBe(SHUFFLE_BASE.glowEnabled);
        expect(next.fontFamily).toBe(SHUFFLE_BASE.fontFamily);
        expect(next.titleFontWeight).toBe(SHUFFLE_BASE.titleFontWeight);
      }
    });

    it("may change unlocked color when only design is locked", () => {
      const locks: VisualShuffleLocks = {
        design: true,
        marks: true,
        axes: true,
        atmosphere: true,
        type: true,
      };
      const palettes = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const next = shuffleVisualOverrides(SHUFFLE_BASE, locks);
        if (next.colorPalette) palettes.add(next.colorPalette);
      }
      expect(palettes.size).toBeGreaterThan(0);
    });
  });

  describe("recommendations pipeline", () => {
    it("recommend() returns charts for mixed schema", () => {
      const recs = recommend(SYNTH_COLUMNS, SYNTH_DATA, "synthetic.csv");
      expect(recs.length).toBeGreaterThan(0);
      for (const r of recs) {
        expect(r.id).toBeTruthy();
        expect(r.kind).toBeTruthy();
        expect(Number.isFinite(r.score)).toBe(true);
      }
    });

    it("getBestSuggestion picks highest score", () => {
      const recs = recommend(SYNTH_COLUMNS, SYNTH_DATA, "synthetic.csv");
      const best = getBestSuggestion(recs);
      expect(best).not.toBeNull();
      const maxScore = Math.max(...recs.map((r) => r.score));
      expect(best!.score).toBe(maxScore);
    });

    it("recommendStorySequence returns ordered charts", () => {
      const story = recommendStorySequence(SYNTH_COLUMNS, SYNTH_DATA, "synthetic.csv");
      expect(story.title).toMatch(/^Story:/);
      expect(story.charts.length).toBeGreaterThan(0);
      expect(story.charts.length).toBeLessThanOrEqual(5);
    });

    it("getBestSuggestion returns null for empty input", () => {
      expect(getBestSuggestion([])).toBeNull();
    });
  });

  describe("chartLayout under varied kinds", () => {
    for (const { value: kind } of CHART_KIND_OPTIONS) {
      it(`resolveChartPad for ${kind} stays finite`, () => {
        const pad = resolveChartPad({
          kind,
          width: 640,
          height: 480,
          basePad: 36,
          titleLayout: "pair",
        });
        expectPositiveFinite(pad);
        expect(pad).toBeLessThan(640 * 0.5);

        const m = resolveChartMargins({
          kind,
          width: 640,
          height: 480,
          basePad: 36,
          titleLayout: "ticket",
          tickRotation: 45,
        });
        expectPositiveFinite(m.top);
        expectPositiveFinite(m.right);
        expectPositiveFinite(m.bottom);
        expectPositiveFinite(m.left);
      });
    }
  });

  describe("store settings cycles", () => {
    it("cycles chartAspect, chartDevice, and theme without crash", () => {
      const { setAppSettings } = getState();
      for (const aspect of CHART_ASPECTS) {
        setAppSettings((prev) => ({ ...prev, chartAspect: aspect.id }));
        expect(getState().appSettings.chartAspect).toBe(aspect.id);
      }
      for (const device of ["auto", "mobile", "tablet", "desktop"] as const) {
        setAppSettings((prev) => ({ ...prev, chartDevice: device }));
        expect(getState().appSettings.chartDevice).toBe(device);
      }
      for (const theme of THEMES) {
        setAppSettings((prev) => ({ ...prev, theme }));
        expect(getState().appSettings.theme).toBe(theme);
      }
    });

    it("persist roundtrips app settings through localStorage helpers", () => {
      const backing = new Map<string, string>();
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (k: string) => backing.get(k) ?? null,
          setItem: (k: string, v: string) => {
            backing.set(k, v);
          },
          removeItem: (k: string) => {
            backing.delete(k);
          },
        },
      });

      const payload: PersistedAppSettings = {
        theme: "loom",
        chartAspect: "16:9",
        chartDevice: "tablet",
        colorblindCharts: true,
        fontScale: 1.1,
      };
      setPersistedAppSettings(payload);
      const loaded = getPersistedAppSettings();
      expect(loaded).toEqual(payload);
    });

    it("createStoryDashboard + setChartViewSnapshot roundtrip", () => {
      const story = recommendStorySequence(SYNTH_COLUMNS, SYNTH_DATA, "pressure.csv");
      expect(story.charts.length).toBeGreaterThan(0);

      const dbId = getState().createStoryDashboard(
        "/tmp/pressure.csv",
        "pressure.csv",
        story.title,
        story.charts,
        SYNTH_DATA,
      );
      expect(dbId).toBeTruthy();

      const dash = getState().dashboards.find((d) => d.id === dbId);
      expect(dash).toBeDefined();
      expect(dash!.slots.length).toBe(story.charts.length);

      const firstSlot = dash!.slots[0]!;
      const view = getState().chartViews.find((v) => v.id === firstSlot.viewId);
      expect(view).toBeDefined();
      expect(view!.snapshotImageDataUrl).toBeNull();

      const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
      getState().setChartViewSnapshot(view!.id, dataUrl);
      const updated = getState().chartViews.find((v) => v.id === view!.id);
      expect(updated!.snapshotImageDataUrl).toBe(dataUrl);

      getState().setChartViewSnapshot(view!.id, null);
      expect(getState().chartViews.find((v) => v.id === view!.id)!.snapshotImageDataUrl).toBeNull();
    });
  });

  // looksLikeFailedCapture is not exported from captureStoryPreviews — skipped per spec.
});
