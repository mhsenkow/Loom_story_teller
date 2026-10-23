"use client";

import { SaveButton } from "@/components/SourcePrefControls";
import { ckanRef } from "@/lib/sourceRef";
import type { DataGovDataset } from "@/lib/tauri";
import { firstCsvResource } from "@/lib/openDataCatalog";
import { dataGovResourceSaveable, exploreFilename } from "./shared";

/** Discovery card — web puts Explore first so grab→chart feels like desktop open. */
export function DiscoverDatasetCard({
  dataset: ds,
  expanded,
  isWeb,
  canSaveToFolder,
  isScanning,
  loadingId,
  savingId,
  onPreview,
  onExplore,
  onSave,
}: {
  dataset: DataGovDataset;
  expanded: boolean;
  isWeb: boolean;
  canSaveToFolder: boolean;
  isScanning: boolean;
  loadingId: string | null;
  savingId: string | null;
  onPreview: () => void;
  onExplore: (url: string, filename: string, resourceId: string) => void;
  onSave: (url: string, filename: string, resourceId: string) => void;
}) {
  const csv = firstCsvResource(ds);
  const exploreBusy = csv != null && (loadingId === csv.id || isScanning);

  return (
    <div className={`border border-loom-border rounded-md p-3 space-y-2.5 bg-loom-surface/40 ${expanded ? "flex flex-col min-w-0" : ""}`}>
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1">
        {ds.organization && (
          <p className="text-2xs text-loom-muted truncate mb-0.5" title={ds.organization}>{ds.organization}</p>
        )}
        <p className="text-sm font-medium text-loom-text leading-snug line-clamp-2">{ds.title}</p>
      </div>

      <SaveButton sourceRef={ckanRef(ds.portal_id, ds.id)} label={ds.title} asset={{ ref: ckanRef(ds.portal_id, ds.id), name: ds.title, url: csv?.url, credit: ds.organization }} />
      </div>

      {isWeb && csv ? (
        <div className="flex items-center gap-2 flex-wrap mt-auto pt-0.5">
          <button
            type="button"
            disabled={exploreBusy}
            onClick={() => onExplore(csv.url, exploreFilename(ds, csv), csv.id)}
            className="loom-btn-primary text-2xs py-1.5 px-3 disabled:opacity-50"
          >
            {exploreBusy ? "Loading…" : "Explore"}
          </button>
          <button type="button" onClick={onPreview} className="text-2xs text-loom-muted hover:text-loom-text">
            Details
          </button>
          <a
            href={csv.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-2xs text-loom-muted hover:text-loom-text"
          >
            Source
          </a>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <button type="button" onClick={onPreview} className="text-2xs text-loom-accent hover:underline">
              View
            </button>
          </div>
          <div className="space-y-1">
            {ds.resources.slice(0, expanded ? 2 : 3).map((res) => {
              const saveable = dataGovResourceSaveable(res);
              const label = `${res.format}: ${res.name}`;
              const filename = exploreFilename(ds, res);
              return (
                <div key={res.id} className="flex items-center gap-2 flex-wrap text-2xs">
                  <span className={`text-loom-muted truncate ${expanded ? "max-w-full" : "max-w-[180px]"}`} title={res.url}>
                    {label}
                  </span>
                  <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-loom-accent hover:underline shrink-0">
                    Open
                  </a>
                  {canSaveToFolder && saveable && (
                    <button
                      type="button"
                      disabled={savingId === res.id}
                      onClick={() => onSave(res.url, filename, res.id)}
                      className="text-loom-accent hover:underline disabled:opacity-50 shrink-0"
                    >
                      {savingId === res.id ? "Saving…" : "Save to folder"}
                    </button>
                  )}
                </div>
              );
            })}
            {ds.resources.length > (expanded ? 2 : 3) && (
              <p className="text-2xs text-loom-muted">+{ds.resources.length - (expanded ? 2 : 3)} more</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
