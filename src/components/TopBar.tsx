// =================================================================
// TopBar — Navigation & Mode Switcher
// =================================================================
// Sticky top bar with view mode tabs and utility controls.
// =================================================================

"use client";

import { useLoomStore, type ViewMode } from "@/lib/store";

const VIEW_MODES: { key: ViewMode; label: string; shortcut: string }[] = [
  { key: "explorer", label: "Explorer", shortcut: "1" },
  { key: "chart", label: "Chart", shortcut: "2" },
  { key: "query", label: "Query", shortcut: "3" },
];

export function TopBar() {
  const { viewMode, setViewMode, sidebarOpen, panelOpen, toggleSidebar, togglePanel, selectedFile } =
    useLoomStore();

  return (
    <header className="flex items-center h-[var(--topbar-height)] border-b border-loom-border bg-loom-surface px-2 gap-2 flex-shrink-0">
      {/* Sidebar Toggle */}
      <button
        onClick={toggleSidebar}
        className="loom-btn-ghost text-xs px-2"
        title="Toggle Sidebar"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
        </svg>
      </button>

      {/* View Tabs */}
      <nav className="flex items-center gap-0.5 bg-loom-elevated rounded-md p-0.5">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.key}
            onClick={() => setViewMode(mode.key)}
            className={`
              px-3 py-1 text-xs font-medium rounded transition-all duration-100
              ${viewMode === mode.key
                ? "bg-loom-accent text-white shadow-sm"
                : "text-loom-muted hover:text-loom-text"
              }
            `}
          >
            {mode.label}
            <span className="ml-1.5 text-2xs opacity-50 font-mono">{mode.shortcut}</span>
          </button>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Active File Indicator */}
      {selectedFile && (
        <div className="flex items-center gap-1.5 mr-2">
          <span className="w-1.5 h-1.5 rounded-full bg-loom-success" />
          <span className="text-xs text-loom-muted font-mono truncate max-w-[200px]">
            {selectedFile.name}
          </span>
        </div>
      )}

      {/* Panel Toggle */}
      <button
        onClick={togglePanel}
        className="loom-btn-ghost text-xs px-2"
        title="Toggle Detail Panel"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="2" width="14" height="12" rx="2" />
          <line x1="10.5" y1="2" x2="10.5" y2="14" />
        </svg>
      </button>
    </header>
  );
}
