"use client";

import { THEME_PAIRINGS } from "@/lib/themePairing";

import { defaultAppLookSettings } from "@/lib/lookSettingsDefaults";

import { clearPersistedPreferences } from "@/lib/persist";
import { Button } from "@/components/ui/Button";
import { WorkspaceBackupControls } from "@/components/WorkspaceBackupControls";
import { YourSourcesSettings } from "@/components/YourSourcesSettings";
import { CommunitySettings } from "./CommunitySettings";

import { useLoomStore, type AppTheme, type FontScale } from "@/lib/store";

import { THEME_CHART, THEME_UI } from "@/lib/chartPalettes";
import { THEMES, THEME_LABEL, UI_CHROMES, UI_CHROME_LABEL, normalizeTheme, type UiChrome, type AppFont } from "@/lib/lookSystem";
import { FONT_CHOICES, chartFontStack, resolveChartFontFamily } from "@/lib/fontCatalog";
import { FontPicker } from "@/components/FontPicker";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { CHANGELOG, requestHelp, requestWhatsNew } from "@/lib/changelog";

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
      <CommunitySettings />
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
            <button aria-label={THEME_LABEL[t]}
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
        <label htmlFor="loom-follow-theme" className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm font-semibold">Follow theme</span>
          <input id="loom-follow-theme" type="checkbox" aria-label="Follow theme" checked={!!appSettings.themePairing}
            onChange={(event) => setAppSettings((prev) => ({ ...prev, themePairing: event.target.checked }))} />
        </label>
        <p className="text-2xs text-loom-label mt-2">{themePref === "system" ? "System follows your device’s light/dark appearance with neutral type and chrome." : THEME_PAIRINGS[normalizeTheme(themePref)].description}</p>
        <p className="text-2xs text-loom-muted mt-1">Pairs typeface and chrome with each theme. Choosing either manually keeps your custom combination. Chart-specific fonts stay yours.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-loom-text mb-1">Layout</h3>
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
        <FontPicker label="App typeface" value={FONT_CHOICES[appSettings.font].family}
          onChange={(family) => {
            const font = (Object.keys(FONT_CHOICES) as AppFont[]).find((id) => FONT_CHOICES[id].family === family);
            if (font) setAppSettings((prev) => ({ ...prev, font }));
          }} />
        <div className="loom-type-preview" style={{ fontFamily: chartFontStack(FONT_CHOICES[appSettings.font].family) }}>
          <span>Clear stories. Readable details.</span>
          <span className="tabular-nums">Aa Bb 0123456789 · −8.2%</span>
        </div>
        <p className="text-2xs text-loom-muted mt-2">All 16 typefaces are included with Loom. No third-party font service. Charts set to App typeface follow this choice.</p>
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
          <Button variant="danger" size="sm" className="w-full justify-center min-h-11" onClick={() => {
            if (typeof window !== "undefined" && !window.confirm("Clear saved uploads and linked folder access on this device?")) return;
            void clearRetainedLocalData().then(() => setToast("Cleared retained uploads & linked folder access"));
          }}>
            Clear retained browser data
          </Button>
        </div>
      </div>

      <div className="pt-2 border-t border-loom-border">
        <p className="text-2xs text-loom-muted">
          Chart colors follow the theme you pick. Saved looks stay on this device.
        </p>
      </div>
    </div>
  );
}
