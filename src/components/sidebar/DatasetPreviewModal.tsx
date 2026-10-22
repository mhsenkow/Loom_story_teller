"use client";

import { useId } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { isTauri, openExternalUrl, OPEN_DATA_PORTALS, type DataGovDataset } from "@/lib/tauri";

export function DatasetPreviewModal({
  dataset,
  onClose,
  onOpenFullSite,
}: {
  dataset: DataGovDataset;
  onClose: () => void;
  onOpenFullSite: () => void;
}) {
  const portalId = dataset.portal_id || "data.gov";
  const portal = OPEN_DATA_PORTALS[portalId] ?? OPEN_DATA_PORTALS["data.gov"];
  const viewUrl = `${portal.url}/${dataset.name}`;
  const titleId = useId();
  const descId = useId();
  const notesPreview = dataset.notes
    ? dataset.notes.slice(0, 400) + (dataset.notes.length > 400 ? "…" : "")
    : null;

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy={titleId}
      describedBy={notesPreview ? descId : undefined}
      zIndex={120}
      panelClassName="max-w-lg max-h-[min(85dvh,42rem)] overflow-hidden flex flex-col"
    >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-loom-border flex-shrink-0">
          <h2 id={titleId} className="text-sm font-semibold text-loom-text truncate">
            {dataset.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="loom-btn-ghost p-1.5 rounded-md shrink-0"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            {dataset.organization && (
              <p className="text-2xs text-loom-muted mt-0.5">{dataset.organization}</p>
            )}
          </div>
          {notesPreview && (
            <p id={descId} className="text-xs text-loom-muted leading-relaxed line-clamp-4">{notesPreview}</p>
          )}
          <div>
            <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-1">
              {dataset.resources.length} file{dataset.resources.length !== 1 ? "s" : ""} / link{dataset.resources.length !== 1 ? "s" : ""}
            </p>
            <ul className="text-2xs text-loom-muted space-y-0.5">
              {dataset.resources.slice(0, 5).map((r) => (
                <li key={r.id} className="truncate" title={r.url}>
                  {r.format}: {r.name}
                </li>
              ))}
              {dataset.resources.length > 5 && (
                <li>+{dataset.resources.length - 5} more</li>
              )}
            </ul>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-loom-border flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              onOpenFullSite();
              // Any Tauri shell (iOS has no new-window support) hands off to the system browser.
              if (isTauri()) void openExternalUrl(viewUrl);
              else window.open(viewUrl, "_blank", "noopener,noreferrer");
            }}
            className="loom-btn-primary text-xs flex-1"
          >
            Open on {portal.label}
          </button>
          <button type="button" onClick={onClose} className="loom-btn-ghost text-xs">
            Close
          </button>
        </div>
    </Dialog>
  );
}
