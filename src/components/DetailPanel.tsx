// =================================================================
// DetailPanel — lazy tab shell
// =================================================================
// Right panel tab navigation; tab contents live in src/components/detail.
// =================================================================

"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useIsMobile, useMobileLiveEdit, MOBILE_LIVE_EDIT_SHEET } from "@/lib/useMediaQuery";
import { useLoomStore, type PanelTab } from "@/lib/store";

const StatsTab = lazy(() => import("@/components/detail/StatsTab"));
const ChartPanelTab = lazy(() => import("@/components/detail/ChartPanelTab"));
const ExportTab = lazy(() => import("@/components/detail/ExportTab"));
const DashboardsTab = lazy(() => import("@/components/detail/DashboardsTab"));
const SettingsTab = lazy(() => import("@/components/detail/SettingsTab"));

/** `short` is what the tab strip shows (the strip scrolls on narrow panels). */
const TABS: { key: PanelTab; label: string; short?: string; icon?: boolean }[] = [
  { key: "stats", label: "Stats" },
  { key: "chart", label: "Chart" },
  { key: "export", label: "Export" },
  { key: "dashboards", label: "Dashboards", short: "Boards" },
  { key: "settings", label: "Settings", icon: true },
];

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function EmptyDatasetState() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-10 gap-3 text-center">
      <p className="text-sm text-loom-muted leading-relaxed">Open a dataset to see stats and chart encoding.</p>
      <button
        type="button"
        className="loom-btn-primary text-xs py-1.5 px-3"
        onClick={() => {
          const st = useLoomStore.getState();
          if (!st.sidebarOpen) st.toggleSidebar();
          st.setDataRegionOpen(true);
        }}
      >
        Open Data &amp; sources
      </button>
    </div>
  );
}

function DetailTabContent({ panelTab, hasDataset }: { panelTab: PanelTab; hasDataset: boolean }) {
  if (panelTab === "settings") return <SettingsTab />;
  if (panelTab === "dashboards") return <DashboardsTab />;
  if (!hasDataset) return <EmptyDatasetState />;
  if (panelTab === "stats") return <StatsTab />;
  if (panelTab === "export") return <ExportTab />;
  return <ChartPanelTab />;
}

export function DetailPanel() {
  const panelOpen = useLoomStore((s) => s.panelOpen);
  const panelTab = useLoomStore((s) => s.panelTab);
  const setPanelTab = useLoomStore((s) => s.setPanelTab);
  const selectedFile = useLoomStore((s) => s.selectedFile);
  const togglePanel = useLoomStore((s) => s.togglePanel);
  const liveEdit = useMobileLiveEdit();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLElement>(null);

  useFocusTrap(panelRef, panelOpen && isMobile);

  useEffect(() => {
    if (!panelOpen || !isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.target instanceof Element && e.target.closest("[data-loom-field-picker]")) return;
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelOpen, isMobile, togglePanel]);

  if (!panelOpen) return null;

  return (
    <>
      <button
        type="button"
        className={`md:hidden fixed inset-0 z-[35] ${liveEdit ? "bg-transparent" : "loom-overlay animate-fade-in"}`}
        aria-label="Close detail panel"
        onClick={togglePanel}
      />
      <aside
        ref={panelRef}
        id="loom-detail-panel"
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? true : undefined}
        aria-label={isMobile ? "Detail panel" : undefined}
        className={`
          flex flex-col bg-loom-surface flex-shrink-0 animate-sheet md:animate-panel
          md:relative md:h-full md:w-[var(--panel-width)] md:border-l md:border-loom-border md:z-auto
          fixed inset-x-0 bottom-0 z-40 w-full
          border-t border-loom-border rounded-t-2xl shadow-loom-lg
          md:max-h-none md:rounded-none md:shadow-none md:inset-auto
          ${liveEdit ? "" : "h-[min(88dvh,44rem)]"}
        `}
        style={{ paddingBottom: "var(--safe-bottom)", ...(liveEdit ? { height: MOBILE_LIVE_EDIT_SHEET } : {}) }}
      >
        <div className={`md:hidden relative flex items-center justify-between px-4 shrink-0 ${liveEdit ? "pt-2.5 pb-0" : "pt-3.5 pb-1.5"}`}>
          <div className="pointer-events-none absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-loom-border/80" />
          <span className="text-sm font-semibold text-loom-text tracking-tight">
            {TABS.find((t) => t.key === panelTab)?.label ?? "Details"}
          </span>
          <button type="button" onClick={togglePanel} className="loom-btn-ghost min-h-9 min-w-9 flex items-center justify-center text-loom-muted text-lg leading-none rounded-md" aria-label="Close">
            ×
          </button>
        </div>

        <div role="tablist" aria-label="Panel sections" className="loom-tabs overflow-x-auto shrink-0 px-1.5 sm:px-2 min-h-[var(--topbar-height)] border-b border-loom-border">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`panel-tab-${tab.key}`}
              aria-controls="panel-content"
              aria-selected={panelTab === tab.key}
              tabIndex={panelTab === tab.key ? 0 : -1}
              aria-label={tab.label}
              onClick={() => setPanelTab(tab.key)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((t) => t.key === panelTab);
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = TABS[(i + 1) % TABS.length];
                  setPanelTab(next.key);
                  queueMicrotask(() => document.getElementById(`panel-tab-${next.key}`)?.focus());
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const prev = TABS[(i - 1 + TABS.length) % TABS.length];
                  setPanelTab(prev.key);
                  queueMicrotask(() => document.getElementById(`panel-tab-${prev.key}`)?.focus());
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setPanelTab(TABS[0].key);
                  queueMicrotask(() => document.getElementById(`panel-tab-${TABS[0].key}`)?.focus());
                } else if (e.key === "End") {
                  e.preventDefault();
                  const last = TABS[TABS.length - 1];
                  setPanelTab(last.key);
                  queueMicrotask(() => document.getElementById(`panel-tab-${last.key}`)?.focus());
                }
              }}
              title={tab.short || tab.icon ? tab.label : undefined}
              className={`loom-tab px-2.5 ${tab.icon ? "ml-auto flex items-center" : ""}`}
            >
              {tab.icon ? <GearIcon /> : (tab.short ?? tab.label)}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="panel-content" aria-labelledby={`panel-tab-${panelTab}`} className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-4 text-sm text-loom-muted">Loading panel…</div>}>
            <DetailTabContent panelTab={panelTab} hasDataset={Boolean(selectedFile)} />
          </Suspense>
        </div>
      </aside>
    </>
  );
}
