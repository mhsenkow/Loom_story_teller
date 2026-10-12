// =================================================================
// shellHandoff — close mobile chrome after ingest/handoff (LOOM-638)
// =================================================================

import { useLoomStore } from "./store";
import { shellModeFromWidth } from "./shellLayout";

export function leaveSourcesShowChart() {
  const s = useLoomStore.getState();
  s.setDataSourcesExpanded(false);
  s.setDataRegionOpen(false);
  s.setViewMode("chart");
  s.setPanelTab("chart");
  if (typeof window !== "undefined") {
    const mode = shellModeFromWidth(window.innerWidth);
    if (mode === "phone" || mode === "tablet") {
      if (s.sidebarOpen) s.toggleSidebar();
    }
    if (mode === "phone" && s.panelOpen) s.togglePanel();
  }
}
