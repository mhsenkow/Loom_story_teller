"use client";

// Always-visible history controls shared by Encoding and Visual.
import { useLoomStore } from "@/lib/store";

export function ChartEditToolbar() {
  const undoCount = useLoomStore((s) => s.chartEditUndoStack.length);
  const redoCount = useLoomStore((s) => s.chartEditRedoStack.length);
  const undo = useLoomStore((s) => s.undoChartEdit);
  const redo = useLoomStore((s) => s.redoChartEdit);
  return (
    <div
      role="toolbar"
      aria-label="Chart edit history"
      className="flex items-center justify-between gap-2 px-2 py-1 border-b border-loom-border bg-loom-surface"
    >
      <span className="text-2xs text-loom-muted">
        {undoCount
          ? `${undoCount} edit${undoCount === 1 ? "" : "s"}`
          : "Experiment freely"}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={undo}
          disabled={!undoCount}
          title="Undo chart edit (⌘/Ctrl Z)"
          className="loom-btn-ghost min-h-9 px-2 text-2xs disabled:opacity-40"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!redoCount}
          title="Redo chart edit (⌘/Ctrl Shift Z)"
          className="loom-btn-ghost min-h-9 px-2 text-2xs disabled:opacity-40"
        >
          ↷ Redo
        </button>
      </div>
    </div>
  );
}
