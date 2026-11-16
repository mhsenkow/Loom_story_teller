"use client";

// =================================================================
// PublicPortalsSection — Discover → More public portals
// =================================================================
// Live feeds connect through SourceCard. Curated CSVs use the same
// Explore / Save path as the packs in the feed browser.
// =================================================================

import { SourceCard } from "@/components/sidebar/SourceCard";
import { SectionHeading } from "@/components/sidebar/shared";
import { CURATED_OPEN_PACKS, type CuratedPack } from "@/lib/curatedPacks";
import { PUBLIC_PORTALS } from "@/lib/publicPortals";
import { SOURCE_BY_KIND } from "@/lib/sourceRegistry";
import { packRef } from "@/lib/sourceRef";

const PACK_BY_ID = new Map(CURATED_OPEN_PACKS.map((p) => [p.id, p]));

export interface PublicPortalsSectionProps {
  expanded: boolean;
  canLoadInBrowser: boolean;
  canSaveToFolder: boolean;
  isScanning: boolean;
  loadingId: string | null;
  savingId: string | null;
  onExplore: (
    url: string,
    filename: string,
    id: string,
    opts?: { sourceCredit?: string; sourceHome?: string },
  ) => void;
  onSave: (url: string, filename: string, id: string) => void;
}

export function PublicPortalsSection({
  expanded,
  canLoadInBrowser,
  canSaveToFolder,
  loadingId,
  savingId,
  onExplore,
  onSave,
}: PublicPortalsSectionProps) {
  return (
    <div className="space-y-6" data-testid="public-portals">
      <SectionHeading
        title="More portals"
        lede="Connect a catalog here. Live feeds update in Loom; Explore opens a full public CSV."
      />
      {PUBLIC_PORTALS.map((portal) => {
        const packs = portal.packIds
          .map((id) => PACK_BY_ID.get(id))
          .filter((p): p is CuratedPack => !!p);
        return (
          <section key={portal.id} aria-label={portal.title} data-portal={portal.id}>
            <SectionHeading title={portal.title} lede={portal.blurb} />
            {portal.feedKinds.length > 0 && (
              <div className={expanded ? "library-source-grid" : "space-y-2.5"}>
                {portal.feedKinds.map((kind) => (
                  <SourceCard key={kind} def={SOURCE_BY_KIND[kind]} />
                ))}
              </div>
            )}
            {packs.length > 0 && (
              <div className={`${expanded ? "library-catalog-grid" : "space-y-2"} ${portal.feedKinds.length ? "mt-2" : ""}`}>
                {packs.map((pack) => (
                  <div
                    key={pack.id}
                    className="border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-1.5 min-w-0"
                    data-source-ref={packRef(pack.id)}
                  >
                    <p className="text-sm font-medium text-loom-text leading-snug">{pack.title}</p>
                    <p className="text-2xs text-loom-muted leading-snug">{pack.blurb}</p>
                    <p className="text-2xs text-loom-muted/80">{pack.source}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {canLoadInBrowser && (
                        <button
                          type="button"
                          disabled={loadingId === pack.id}
                          onClick={() =>
                            onExplore(pack.url, `${pack.id}.csv`, pack.id, {
                              sourceCredit: pack.source,
                              sourceHome: portal.homepage,
                            })
                          }
                          className="library-pack-action text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10 disabled:opacity-50"
                        >
                          {loadingId === pack.id ? "Loading…" : "Explore CSV"}
                        </button>
                      )}
                      {canSaveToFolder && (
                        <button
                          type="button"
                          disabled={savingId === pack.id}
                          onClick={() => onSave(pack.url, `${pack.id}.csv`, pack.id)}
                          className="library-pack-action text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text disabled:opacity-50"
                        >
                          {savingId === pack.id ? "Saving…" : "Save to folder"}
                        </button>
                      )}
                      <a
                        href={pack.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-2xs text-loom-muted hover:text-loom-accent"
                      >
                        Download CSV
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <a
              href={portal.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent"
            >
              Browse {portal.title}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </section>
        );
      })}
    </div>
  );
}
