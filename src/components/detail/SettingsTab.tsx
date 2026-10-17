"use client";

import { THEME_PAIRINGS } from "@/lib/themePairing";
import { useState, useCallback, useMemo, useEffect, useRef, useId, type ReactNode, type DragEvent } from "react";
import { formatVegaSpecJson } from "@/lib/vegaSpecDisplay";
import { defaultAppLookSettings, emptyChartVisualOverrides } from "@/lib/lookSettingsDefaults";
import { clampSmartFloat, clampSmartInt, SMART_TOP_N, SMART_Z } from "@/lib/smartInputClamp";
import { useIsMobile, useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { clearPersistedPreferences } from "@/lib/persist";
import { Button } from "@/components/ui/Button";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import { YourSourcesSettings } from "@/components/YourSourcesSettings";
import { useShallow } from "zustand/react/shallow";
import { useLoomStore, type PanelTab, type ChartVisualOverrides, type AppTheme, type FontScale } from "@/lib/store";
import { formatNumber } from "@/lib/format";
import { ChartKindPicker } from "@/components/ChartKindPicker";
import {
  THEME_CHART,
  THEME_UI,
  AXIS_LABEL_COLOR_SWATCHES,
  AXIS_LINE_COLOR_SWATCHES,
  COLOR_PALETTES,
  palettesGrouped,
  resolveChartColors,
  type PaletteKind,
} from "@/lib/chartPalettes";
import {
  THEMES,
  THEME_LABEL,
  UI_CHROMES,
  UI_CHROME_LABEL,
  VISUAL_PRESETS,
  VISUAL_PRESET_BLURB,
  shuffleVisualOverrides,
  VISUAL_SHUFFLE_SECTIONS,
  type VisualPresetId,
  type VisualShuffleLocks,
  type VisualShuffleSection,
  normalizeTheme,
  type LookTheme,
  type UiChrome,
  type AppFont,
  type FacesSource,
} from "@/lib/lookSystem";
import { FONT_CHOICES, FONT_GROUPS, chartFontStack, resolveChartFontFamily } from "@/lib/fontCatalog";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { CHANGELOG, requestHelp, requestWhatsNew } from "@/lib/changelog";
import {
  createChartRec,
  fitEncodingToKind,
  Y_AGGREGATE_OPTIONS,
  getRecommendationReason,
  getRandomEncoding,
  applyEncodingLocks,
  chartKindDataSupport,
  tryBuildRandomChartRec,
  randomEncodingToExtra,
  recommendStorySequence,
  recommendStreamStory,
  type ChartKind,
  type YAggregateOption,
  type EncodingShuffleLocks,
} from "@/lib/recommendations";
import {
  computeDataQualityHints,
  formatChartAggregationSummary,
  chartCapabilities,
  encodingChannelLabels,
  CHART_LAYOUT_DIRECTIONS,
  CHART_Y_SCALE_OPTIONS,
  type ChartLayoutDirection,
  type ChartYScaleOption,
} from "@/lib/chartSupport";
import {
  chromeDomId,
  chromeSectionFor,
  type ChartChromeTarget,
} from "@/lib/chartChromeLink";
import { CHART_TOOLTIP_MODES, type ChartTooltipMode } from "@/lib/chartTooltipMode";
import {
  resolveDataProvenance,
  provenanceKindLabel,
  type DataProvenance,
} from "@/lib/dataProvenance";
import { TOP_N_OPTIONS, clampTopN, DEFAULT_TOP_N } from "@/lib/chartFacets";
import {
  CHART_TIME_RANGES,
  applyChartTimeWindow,
  chartTimeRangeOptions,
  pickDefaultTimeField,
  temporalColumnNames,
  timeColumnSpanMs,
  type ChartTimeRange,
} from "@/lib/chartTime";
import {
  runAnomaly,
  runForecast,
  runTrend,
  runReferenceLines,
  runClustering,
  runCorrelationMatrix,
  type AnomalyMethod,
} from "@/lib/smartAnalytics";
import { corrCellInk, corrFillT, sampleCorrDiverging, DEFAULT_CORR_DIVERGING } from "@/lib/corrMatrixStyle";
import { queryResultToCsv, downloadCsv } from "@/lib/csvExport";
import { buildDashboardMicrositeHtml } from "@/lib/dashboardMicrosite";
import { exportDashboardMicrosite, streamSnapshot, isDesktop, isTauri, openExternalUrl } from "@/lib/tauri";
import { isNumericColumnType } from "@/lib/dataCubeSchema";
import { captureStoryDashboardPreviews } from "@/lib/captureStoryPreviews";
import {
  SOCIAL_PRESETS,
  getSocialPreset,
  buildSocialCaption,
  shareOrDownloadFile,
  copyTextToClipboard,
  slugifyFilename,
  publishStoryToWorker,
  recordCanvasVideo,
} from "@/lib/socialExport";
import { downloadBlob } from "@/lib/zipStore";

export default function SettingsTab() {
  const appSettings = useLoomStore((s) => s.appSettings);
  const setAppSettings = useLoomStore((s) => s.setAppSettings);
  const setToast = useLoomStore((s) => s.setToast);
  const resetDatasetScoped = useLoomStore((s) => s.resetDatasetScoped);
  const resetWorkspace = useLoomStore((s) => s.resetWorkspace);
  const resetPreferencesInStore = useLoomStore((s) => s.resetPreferencesInStore);
  const clearRetainedLocalData = useLoomStore((s) => s.clearRetainedLocalData);
  const fontScales: { value: FontScale; label: string }[] = [
    { value: 0.9, label: "90%" },
    { value: 1, label: "100%" },
    { value: 1.1, label: "110%" },
    { value: 1.15, label: "115%" },
  ];
  const themePref = appSettings.theme;
  const currentTheme =
    themePref === "system"
      ? "system"
      : ((themePref === "high-contrast" ? "contrast" : themePref === "colorblind" ? "dark" : themePref) as LookTheme);

  return (
    <div className="p-4 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Discover</h3>
        <p className="text-2xs text-loom-muted mb-2">
          Intro scan of live feeds for chart-ready stories (shown once until you skip it).
        </p>
        <button
          type="button"
          className="loom-btn-primary text-xs py-1.5 px-3"
          onClick={() => {
            requestDiscoverScan();
            setToast("Scanning feeds for something interesting…");
          }}
        >
          What’s interesting right now
        </button>
      </div>
      <YourSourcesSettings />
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">What’s new</h3>
        <p className="text-2xs text-loom-muted mb-2">Recent features and fixes{CHANGELOG[0] ? ` · latest ${CHANGELOG[0].date}` : ""}.</p>
        <button type="button" className="loom-btn-ghost text-xs py-1.5 px-3 border border-loom-border" onClick={requestWhatsNew}>
          See what’s new
        </button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Help</h3>
        <p className="text-2xs text-loom-muted mb-2">Shortcuts, phone gestures, and feedback.</p>
        <button type="button" className="loom-btn-ghost text-xs py-1.5 px-3 border border-loom-border" onClick={() => requestHelp()}>
          Open help
        </button>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Theme</h3>
        <p className="text-2xs text-loom-label mb-2">Color, material, and chart palette</p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            aria-pressed={themePref === "system"}
            onClick={() => setAppSettings((prev) => ({ ...prev, theme: "system" as AppTheme }))}
            className={`px-2 py-1.5 text-2xs rounded-md border text-left transition-colors ${
              themePref === "system"
                ? "border-loom-accent bg-loom-accent/15 text-loom-text font-medium"
                : "border-loom-border text-loom-label hover:text-loom-text"
            }`}
          >
            System
          </button>
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={themePref === t}
              onClick={() => setAppSettings((prev) => ({ ...prev, theme: t as AppTheme }))}
              className={`px-2 py-1.5 text-2xs rounded-md border text-left transition-colors ${
                themePref === t
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text font-medium"
                  : "border-loom-border text-loom-label hover:text-loom-text"
              }`}
            >
              <span className="loom-theme-option">
                <span>{THEME_LABEL[t]}</span>
                <span aria-hidden className="loom-theme-specimen" style={{ background: THEME_UI[t].bg, color: THEME_UI[t].text, fontFamily: chartFontStack(resolveChartFontFamily(undefined, THEME_PAIRINGS[t].font, "local")) }}>
                  <span>Aa</span>
                  <span className="loom-theme-palette">{THEME_CHART[t].slice(0, 3).map((color) => <i key={color} style={{ background: color }} />)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 text-2xs text-loom-muted hover:text-loom-text underline"
          onClick={() => setAppSettings((prev) => defaultAppLookSettings(prev))}
        >
          Reset look settings
        </button>
      </div>

      <div className="loom-pairing-card">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-semibold">Follow theme</span>
          <input type="checkbox" checked={!!appSettings.themePairing}
            onChange={(event) => setAppSettings((prev) => ({ ...prev, themePairing: event.target.checked }))} />
        </label>
        <p className="text-2xs text-loom-label mt-2">{themePref === "system" ? "System follows your device’s light/dark appearance with neutral type and chrome." : THEME_PAIRINGS[normalizeTheme(themePref)].description}</p>
        <p className="text-2xs text-loom-muted mt-1">Pairs typeface and chrome with each theme. Choosing either manually keeps your custom combination. Chart-specific fonts stay yours.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Chrome</h3>
        <p className="text-2xs text-loom-label mb-2">Spacing, corners, and borders. Typeface below takes priority.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {UI_CHROMES.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={appSettings.uiChrome === u}
              onClick={() => setAppSettings((prev) => ({ ...prev, uiChrome: u as UiChrome }))}
              className={`px-2 py-1.5 text-2xs rounded-md border text-left transition-colors ${
                appSettings.uiChrome === u
                  ? "border-loom-accent bg-loom-accent/15 text-loom-text font-medium"
                  : "border-loom-border text-loom-label hover:text-loom-text"
              }`}
            >
              {UI_CHROME_LABEL[u]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1"><label htmlFor="app-typeface">Typeface</label></h3>
        <select id="app-typeface" aria-label="App typeface"
          value={appSettings.font}
          onChange={(e) => setAppSettings((prev) => ({ ...prev, font: e.target.value as AppFont }))}
          className="loom-input w-full text-xs py-1.5"
        >
          {FONT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.fonts.map((id) => <option key={id} value={id}>{FONT_CHOICES[id].family}{appSettings.faces !== "web" ? " · device fallback" : ""}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="flex gap-1.5 mt-2">
          {(["local", "web"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, faces: f as FacesSource }))}
              aria-pressed={(appSettings.faces === "web" ? "web" : "local") === f}
              className={`px-2 py-1 text-2xs rounded border ${
                (appSettings.faces === "web" ? "web" : "local") === f ? "border-loom-accent text-loom-text" : "border-loom-border text-loom-muted"
              }`}
            >
              {f === "web" ? "Download fonts" : "Device fonts"}
            </button>
          ))}
        </div>
        <p className="text-2xs text-loom-muted mt-2">{FONT_CHOICES[appSettings.font].description}</p>
        <div className="loom-type-preview" style={{ fontFamily: chartFontStack(resolveChartFontFamily(undefined, appSettings.font, appSettings.faces)) }}>
          <span>Clear stories. Readable details.</span>
          <span className="tabular-nums">Aa Bb 0123456789 · −8.2%</span>
        </div>
        <p className="text-2xs text-loom-muted mt-1">{appSettings.faces === "web" ? "Downloads the selected face from Google Fonts. Device fonts appear while it loads or when offline." : "No font downloads. Uses system sans, Georgia, or system mono to match your selection."} Charts set to App typeface follow this choice.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">UI scale</h3>
        <div className="flex flex-wrap gap-2">
          {fontScales.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setAppSettings((prev) => ({ ...prev, fontScale: s.value }))}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                appSettings.fontScale === s.value
                  ? "border-loom-accent bg-loom-accent/20 text-loom-text"
                  : "border-loom-border text-loom-muted hover:text-loom-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Accessibility</h3>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input
            type="checkbox"
            checked={appSettings.reducedMotion}
            onChange={(e) => setAppSettings((prev) => ({ ...prev, reducedMotion: e.target.checked }))}
            className="rounded border-loom-border accent-loom-accent"
          />
          <span className="text-xs text-loom-text">Reduce motion</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!appSettings.colorblindCharts}
            onChange={(e) => setAppSettings((prev) => ({ ...prev, colorblindCharts: e.target.checked }))}
            className="rounded border-loom-border accent-loom-accent"
          />
          <span className="text-xs text-loom-text">Colorblind chart palette</span>
        </label>
        <p className="text-2xs text-loom-muted mt-1 ml-6">Auto uses Okabe–Ito for categories and Cividis for magnitudes. Explicit chart palettes stay selected.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Local data</h3>
        <p className="text-2xs text-loom-muted mb-2">
          Reset scopes are separate: chart state, workspace files, preferences, and retained browser uploads.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => { resetDatasetScoped(); setToast("Cleared chart & table state for this dataset"); }}>
            Reset chart / table state
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => { resetWorkspace(); setToast("Cleared workspace files from memory"); }}>
            Reset workspace (memory)
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => { resetPreferencesInStore(); clearPersistedPreferences(); setToast("Reset preferences & saved views"); }}>
            Reset preferences
          </Button>
          <WorkspaceBackupControls />
          <Button variant="danger" size="sm" className="w-full justify-center" onClick={() => {
            void clearRetainedLocalData().then(() => setToast("Cleared retained uploads & linked folder access"));
          }}>
            Clear retained browser data
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-loom-border">
        <p className="text-2xs text-loom-muted">
          Chart → Visual uses Theme palette colors from the active theme. Looks sync to{" "}
          <span className="font-mono">ibm.tools.shared</span> when available.
        </p>
      </div>
    </div>
  );
}
