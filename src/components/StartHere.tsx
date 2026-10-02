// =================================================================
// StartHere — shared "nothing loaded yet" state for every view
// =================================================================
// Leads with the live-feed discover scan (one tap → a chart), then
// the open-data catalog. Desktop users also get the folder hint.
// =================================================================

"use client";

import { useEffect, useState } from "react";
import { useLoomStore } from "@/lib/store";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { isTauri } from "@/lib/tauri";

export function openDataSources(): void {
  const s = useLoomStore.getState();
  if (!s.sidebarOpen) s.toggleSidebar();
  s.setDataRegionOpen(true);
  s.setDataSourcesExpanded(true);
}

export function StartHere({
  title = "Find something fun to chart",
  detail,
  icon,
}: {
  title?: string;
  /** View-specific line under the pitch (e.g. what Query / Dive do once data is open). */
  detail?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const setToast = useLoomStore((s) => s.setToast);
  // Desktop-only copy is decided after mount so SSR and first paint match.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-6 py-8 animate-fade-in overflow-y-auto">
      <div className="w-14 h-14 rounded-2xl bg-loom-accent/10 border border-loom-accent/30 flex items-center justify-center text-loom-accent">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 3v18h18M7 16l4-8 4 4 4-8" />
          </svg>
        )}
      </div>
      <div className="text-center max-w-sm space-y-2">
        <p className="text-base font-semibold text-loom-text tracking-tight">{title}</p>
        <p className="text-sm text-loom-muted leading-relaxed">
          Live earthquakes, flights, Wikipedia edits, crypto, weather — pick one and it opens as a chart you can share.
        </p>
        {detail && <p className="text-xs text-loom-muted/80 leading-relaxed">{detail}</p>}
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={() => {
            requestDiscoverScan();
            setToast("Scanning live feeds…");
          }}
          className="loom-btn-primary min-h-11 text-sm font-semibold rounded-lg"
        >
          ✦ What’s interesting right now
        </button>
        <button type="button" onClick={openDataSources} className="loom-btn-ghost min-h-11 text-sm rounded-lg border border-loom-border">
          Browse open data &amp; demos
        </button>
      </div>
      {desktop && (
        <p className="text-2xs text-loom-muted text-center max-w-xs">
          Or mount a folder of .csv / .parquet files from the sidebar.
        </p>
      )}
    </div>
  );
}
