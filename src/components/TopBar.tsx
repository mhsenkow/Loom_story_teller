// =================================================================
// TopBar — Navigation & Mode Switcher
// =================================================================
// Sticky top bar with view mode tabs, chart aspect / device framing,
// and utility controls.
// =================================================================

"use client";

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
  const {
    viewMode,
    setViewMode,
    panelOpen,
    togglePanel,
    toggleSidebar,
    setPanelTab,
    selectedFile,
    appSettings,
    setAppSettings,
  } = useLoomStore();
  const viewportW = useViewportWidth();
  const aspect = appSettings.chartAspect ?? "free";
  const devicePreset = appSettings.chartDevice ?? "auto";
  const effectiveDevice = resolveDevice(devicePreset, viewportW);

  const openSettings = () => {
    if (!panelOpen) togglePanel();
    setPanelTab("settings");
  };

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

  return (
    <header
      className="flex items-center gap-1 sm:gap-2 flex-shrink-0 border-b border-loom-border bg-loom-surface px-1.5 sm:px-2"
      style={{
        height: "calc(var(--topbar-height) + var(--safe-top))",
        paddingTop: "var(--safe-top)",
        paddingLeft: "max(0.375rem, var(--safe-left))",
        paddingRight: "max(0.375rem, var(--safe-right))",
      }}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        className="loom-btn-ghost min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 flex items-center justify-center text-xs px-2"
        title="Toggle Sidebar"
        aria-label="Toggle data sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
        </svg>
      </button>

      <nav className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5 min-w-0" aria-label="View mode">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            onClick={() => setViewMode(mode.key)}
            aria-pressed={viewMode === mode.key}
            aria-current={viewMode === mode.key ? "page" : undefined}
            className={`
              min-h-9 sm:min-h-0 px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs font-medium rounded transition-all duration-100
              ${viewMode === mode.key
                ? "bg-loom-accent text-white shadow-sm"
                : "text-loom-muted hover:text-loom-text"
              }
            `}
          >
            <span className="sm:hidden">{mode.short}</span>
            <span className="hidden sm:inline">{mode.label}</span>
            <span className="ml-1.5 text-2xs opacity-50 font-mono hidden md:inline">{mode.shortcut}</span>
          </button>
        ))}
      </nav>

      {viewMode === "chart" && (
        <>
          <label className="md:hidden flex items-center gap-1 text-2xs text-loom-muted">
            <span className="sr-only">Aspect</span>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value as ChartAspectId)}
              className="loom-input text-2xs py-1 pl-1.5 pr-6 max-w-[5.5rem]"
              aria-label="Chart aspect ratio"
            >
              {CHART_ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
          <div
            className="hidden md:flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5 max-w-[min(52vw,36rem)] overflow-x-auto scrollbar-none"
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
                className={`
                  shrink-0 px-2 py-1 text-2xs font-medium rounded transition-colors whitespace-nowrap
                  ${aspect === a.id
                    ? "bg-loom-surface text-loom-text shadow-sm border border-loom-border"
                    : "text-loom-muted hover:text-loom-text border border-transparent"}
                `}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5"
            role="group"
            aria-label="Chart width preview"
          >
            <span className="hidden lg:inline text-2xs text-loom-muted px-1.5 select-none">Width</span>
            {DEVICES.map((d) => {
              // When auto: highlight Auto chip; soft-mark the detected device
              const soft =
                devicePreset === "auto" && d.id !== "auto" && effectiveDevice === d.id;
              const pressed = devicePreset === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  title={
                    d.id === "auto"
                      ? `Auto · currently ${effectiveDevice}`
                      : `${d.label} preview width`
                  }
                  onClick={() => setDevice(d.id)}
                  aria-pressed={pressed}
                  className={`
                    min-h-8 min-w-8 flex items-center justify-center rounded px-1.5 transition-colors
                    ${pressed
                      ? "bg-loom-surface text-loom-text shadow-sm border border-loom-border"
                      : soft
                        ? "text-loom-accent border border-loom-accent/35"
                        : "text-loom-muted hover:text-loom-text border border-transparent"}
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
        <div className="hidden sm:flex items-center gap-1.5 mr-1 min-w-0 max-w-[28vw] sm:max-w-[160px]">
          <span className="w-1.5 h-1.5 rounded-full bg-loom-success shrink-0" />
          <span className="text-xs text-loom-muted font-mono truncate">
            {selectedFile.name}
          </span>
        </div>
      )}

      {viewMode === "chart" && (
        <button
          type="button"
          onClick={() => {
            setPanelTab("chart");
            if (!panelOpen) togglePanel();
          }}
          className="md:hidden loom-btn-ghost min-h-10 px-2.5 text-2xs font-medium text-loom-accent border border-loom-accent/40 rounded-md"
          aria-label="Edit chart encoding"
        >
          Edit
        </button>
      )}

      {onOpenShortcuts && (
        <button
          type="button"
          onClick={onOpenShortcuts}
          className="loom-btn-ghost hidden sm:flex min-h-10 min-w-10 items-center justify-center text-xs px-2 font-mono"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
      )}
      <button
        type="button"
        onClick={openSettings}
        className="loom-btn-ghost min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 flex items-center justify-center text-xs px-2"
        title="Settings"
        aria-label="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>

      <button
        type="button"
        onClick={openPanel}
        className="loom-btn-ghost min-h-10 min-w-10 sm:min-h-0 sm:min-w-0 flex items-center justify-center text-xs px-2"
        title={viewMode === "chart" ? "Chart encoding & visual" : "Toggle Detail Panel"}
        aria-label={viewMode === "chart" ? "Open chart panel" : "Toggle detail panel"}
        aria-pressed={panelOpen}
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="10.5" y1="2" x2="10.5" y2="14" />
        </svg>
      </button>
    </header>
  );
}
