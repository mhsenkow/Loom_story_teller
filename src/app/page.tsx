// =================================================================
// Loom — Main Page
// =================================================================
// Composes the three-panel layout:
//   [Sidebar] [MainCanvas] [DetailPanel]
// The main canvas switches between Explorer, Chart, and Query views
// based on the current viewMode in the Zustand store.
// =================================================================

"use client";

import { useLoomStore } from "@/lib/store";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { DetailPanel } from "@/components/DetailPanel";
import { PreviewFooter } from "@/components/PreviewFooter";
import { ExplorerView } from "@/components/ExplorerView";
import { ChartView } from "@/components/ChartView";
import { QueryView } from "@/components/QueryView";
import { useEffect } from "react";

export default function Home() {
  const { viewMode, setViewMode, dataSourcesExpanded } = useLoomStore();

  // Keyboard shortcuts for view switching
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      if (document.activeElement?.tagName === "INPUT") return;

      switch (e.key) {
        case "1":
          setViewMode("explorer");
          break;
        case "2":
          setViewMode("chart");
          break;
        case "3":
          setViewMode("query");
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setViewMode]);

  return (
    <div className="flex flex-col h-screen w-screen bg-loom-bg">
      {/* Top Bar spans full width */}
      <TopBar />

      {/* Main Body: Sidebar + Canvas + Panel. When dataSourcesExpanded, sidebar takes over. */}
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0">
          <Sidebar />

          {/* Canvas Area — hidden when Data & sources is expanded */}
          <main className={`bg-loom-bg overflow-hidden transition-[flex] duration-200 ${dataSourcesExpanded ? "w-0 min-w-0 flex-shrink-0" : "flex-1 min-w-0"}`}>
            {!dataSourcesExpanded && viewMode === "explorer" && <ExplorerView />}
            {!dataSourcesExpanded && viewMode === "chart" && <ChartView />}
            {!dataSourcesExpanded && viewMode === "query" && <QueryView />}
          </main>

          <DetailPanel />
        </div>

        {/* Preview as footer */}
        <PreviewFooter />
      </div>
    </div>
  );
}
