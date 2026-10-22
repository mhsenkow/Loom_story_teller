// =================================================================
// TopBar — Navigation & Mode Switcher
// =================================================================
// Sticky top bar with view mode tabs, chart aspect / device framing,
// and utility controls.
// =================================================================

"use client";

import { ThemeCycleButton } from "./ThemeCycleButton";
import { useLoomStore, type ViewMode } from "@/lib/store";
import {
  CHART_ASPECTS,
  type ChartAspectId,
  type ChartDeviceId,
  resolveDevice,
} from "@/lib/chartViewport";
import { useViewportWidth } from "@/lib/useMediaQuery";

const VIEW_MODES: { key: ViewMode; label: string; short: string; shortcut: string }[] = [
  { key: "explorer", label: "Explorer", short: "Data", shortcut: "1" },
  { key: "chart", label: "Chart", short: "Chart", shortcut: "2" },
  { key: "query", label: "Query", short: "SQL", shortcut: "3" },
  { key: "dive", label: "Dive", short: "Dive", shortcut: "4" },
  { key: "monitor", label: "Monitor", short: "Watch", shortcut: "5" },
];

const DEVICES: { id: ChartDeviceId; label: string; icon: "phone" | "tablet" | "desktop" | "auto" }[] = [
  { id: "auto", label: "Auto", icon: "auto" },
  { id: "mobile", label: "Phone", icon: "phone" },
  { id: "tablet", label: "Tablet", icon: "tablet" },
  { id: "desktop", label: "Desktop", icon: "desktop" },
];

function DeviceIcon({ kind }: { kind: (typeof DEVICES)[number]["icon"] }) {
  if (kind === "phone") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <line x1="11" y1="18" x2="13" y2="18" />
      </svg>
    );
  }
  if (kind === "tablet") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <line x1="11" y1="17" x2="13" y2="17" />
      </svg>
    );
  }
  if (kind === "desktop") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function TopBar({ onOpenShortcuts }: { onOpenShortcuts?: () => void }) {
  const firingCount = useLoomStore((s) => s.monitorAlerts.filter((x) => !x.closedAt && !x.acknowledgedAt).length);
  const {
    viewMode,
    setViewMode,
    sidebarOpen,
    panelOpen,
    togglePanel,
    toggleSidebar,
    setPanelTab,
    selectedFile,
    appSettings,
    setAppSettings,
    columnStats,
    sampleRows,
    queryResult,
    activeChart,
    setShareSheetOpen,
    setToast,
    discoverReturnPath,
  } = useLoomStore();
  const viewportW = useViewportWidth();
  const aspect = appSettings.chartAspect ?? "free";
  const devicePreset = appSettings.chartDevice ?? "auto";
  const effectiveDevice = resolveDevice(devicePreset, viewportW);
  const hasData = columnStats.length > 0 && Boolean(sampleRows ?? queryResult);

  const openPanel = () => {
    if (!panelOpen && viewMode === "chart") setPanelTab("chart");
    togglePanel();
  };

  const setAspect = (id: ChartAspectId) => {
    setAppSettings((prev) => ({ ...prev, chartAspect: id }));
  };

  const setDevice = (id: ChartDeviceId) => {
    setAppSettings((prev) => ({ ...prev, chartDevice: id }));
  };

  const shareDisabledReason = !activeChart
    ? "Pick or create a chart before sharing"
    : !hasData
      ? "Open data before sharing a chart"
      : null;

  const handleShare = () => {
    if (shareDisabledReason) {
      setToast(shareDisabledReason);
      return;
    }
    // Start PNG capture immediately so the sheet often opens with the image ready.
    void import("@/lib/sharePreviewCache").then((m) => m.warmSharePreview("current"));
    setShareSheetOpen(true);
  };

  return (
    <header
      className="flex items-center gap-1 sm:gap-2 flex-shrink-0 min-w-0 overflow-hidden border-b border-loom-border bg-loom-surface/95 backdrop-blur-md px-1.5 sm:px-3"
      style={{
        height: "calc(var(--topbar-height) + var(--safe-top))",
        paddingTop: "var(--safe-top)",
        paddingLeft: "max(0.5rem, var(--safe-left))",
        paddingRight: "max(0.5rem, var(--safe-right))",
      }}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        className="loom-btn-ghost min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 flex items-center justify-center text-xs px-2 rounded-md"
        title="Toggle Sidebar"
        aria-label="Toggle data sidebar"
        aria-expanded={sidebarOpen}
        aria-controls="loom-sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
        </svg>
      </button>

      {discoverReturnPath && discoverReturnPath === selectedFile?.path && (
        <button type="button" onClick={() => { void import("@/lib/discoverStories").then(({ requestDiscoverScan }) => requestDiscoverScan()); }}
          className="loom-btn-ghost flex-shrink-0 min-h-9 px-2 rounded-md text-loom-accent"
          aria-label="Back to stories" title="Back to stories — keep your filters and place">
          <span aria-hidden>←</span><span className="hidden 2xl:inline ml-1 text-xs">Stories</span>
        </button>
      )}
      <nav className="loom-seg shrink-0" aria-label="View mode">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            onClick={() => setViewMode(mode.key)}
            aria-current={viewMode === mode.key ? "page" : undefined}
            className="loom-seg-item min-h-9 sm:min-h-0 px-1.5 sm:px-3"
          >
            <span className="sm:hidden">{mode.short}</span>
            <span className="hidden sm:inline">{mode.label}</span>
            <span className="ml-1 text-2xs opacity-50 font-mono hidden md:inline">{mode.shortcut}</span>
            {mode.key === "monitor" && firingCount > 0 && (
              <span className="ml-1 inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-loom-error text-2xs font-semibold text-[color:var(--on-error)]" aria-label={`${firingCount} open alerts`}>
                {firingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Aspect / device framing — desktop & tablet authoring only (phones always fill) */}
      {viewMode === "chart" && (
        <>
          {/* Tablet widths: one native picker instead of a clipped strip of 7 buttons */}
          <label className="hidden md:flex xl:hidden items-center shrink-0">
            <span className="sr-only">Chart aspect ratio</span>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value as ChartAspectId)}
              className="loom-input w-auto text-xs py-1 min-h-9 pr-7"
              title={CHART_ASPECTS.find((a) => a.id === aspect)?.blurb ?? "Chart aspect ratio"}
            >
              {CHART_ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className="hidden xl:flex loom-seg min-w-0 max-w-[min(52vw,36rem)] overflow-x-auto scrollbar-none"
            role="group"
            aria-label="Chart aspect ratio"
          >
            {CHART_ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.blurb}
                onClick={() => setAspect(a.id)}
                aria-pressed={aspect === a.id}
                data-active={aspect === a.id ? "true" : undefined}
                className={`
                  loom-seg-item loom-seg-item-quiet shrink-0 px-2 py-1 text-2xs whitespace-nowrap border
                  ${aspect === a.id ? "border-loom-border" : "border-transparent"}
                `}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div
            className="hidden md:flex loom-seg shrink-0"
            role="group"
            aria-label="Chart width preview"
          >
            <span className="hidden lg:inline text-2xs text-loom-muted px-1.5 select-none">Width</span>
            {DEVICES.map((d) => {
              const soft =
                devicePreset === "auto" && d.id !== "auto" && effectiveDevice === d.id;
              const pressed = devicePreset === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  title={
                    d.id === "auto"
                      ? "Auto · fill the available chart area"
                      : `${d.label} preview width`
                  }
                  onClick={() => setDevice(d.id)}
                  aria-pressed={pressed}
                  className={`
                    loom-seg-item loom-seg-item-quiet min-h-8 min-w-8 px-1.5 border
                    ${pressed
                      ? "border-loom-border"
                      : soft
                        ? "text-loom-accent border-loom-accent/35"
                        : "border-transparent"}
                  `}
                >
                  <DeviceIcon kind={d.icon} />
                  <span className="sr-only">{d.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="flex-1 min-w-0" />

      {selectedFile && (
        <div
          className="hidden sm:flex items-center gap-1.5 mr-1 min-w-0 max-w-[180px] lg:max-w-[240px] px-2 py-1 rounded-md bg-loom-elevated/60 border border-loom-border/60"
          title={selectedFile.name}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-loom-success shrink-0" aria-hidden />
          <span className="text-xs text-loom-muted font-mono truncate">
            {selectedFile.name}
          </span>
        </div>
      )}

      {viewMode === "chart" && (
        <button
          type="button"
          onClick={handleShare}
          aria-disabled={!!shareDisabledReason}
          className={`min-h-10 px-3 sm:px-3.5 text-xs font-semibold rounded-md bg-loom-accent text-[color:var(--btn-primary-fg)] shadow-sm flex items-center gap-1.5 shrink-0 ${
            shareDisabledReason ? "opacity-60" : ""
          }`}
          aria-label="Share chart"
          title={shareDisabledReason ?? "Share this chart as an image or link"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          <span>Share</span>
        </button>
      )}

      {onOpenShortcuts && (
        <button
          type="button"
          onClick={onOpenShortcuts}
          className={`loom-btn-ghost ${discoverReturnPath === selectedFile?.path ? "hidden md:flex" : "hidden sm:flex"} min-h-10 min-w-10 items-center justify-center text-xs px-2 font-mono rounded-md`}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      )}
      {/* Phones: theme lives in Settings; the wrapper hides it (the button's own display:grid beats `hidden`). */}
      <div className="hidden sm:flex shrink-0" data-testid="topbar-theme">
        <ThemeCycleButton />
      </div>

      {viewMode !== "monitor" && <button
        type="button"
        onClick={openPanel}
        className={`loom-btn-ghost min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 items-center justify-center text-xs px-2 rounded-md ${viewMode === "chart" ? "hidden md:flex" : "flex"}`}
        title={viewMode === "chart" ? "Chart encoding & visual" : "Toggle Detail Panel"}
        aria-label={viewMode === "chart" ? "Open chart panel" : "Toggle detail panel"}
        aria-expanded={panelOpen}
        aria-controls="loom-detail-panel"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="10.5" y1="2" x2="10.5" y2="14" />
        </svg>
      </button>}
    </header>
  );
}
