"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ChangeEvent, type ComponentType, type RefObject } from "react";
import type { CatalogSectionProps } from "@/components/PublicCatalogSections";
import { WEB_FILE_ACCEPT, WEB_FILE_ACCEPT_LABEL } from "@/lib/webFormats";
import { WEB_VAULT_LABEL, WEB_VAULT_PATH, type LinkedFolderMeta, type LinkedFolderScanProgress } from "@/lib/webDataFolder";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { fetchDataGovRecentCsv, fetchUkDataRecentCsv, isDesktop, saveCsvToFolder, type DataGovDataset, type DataGovSortKey } from "@/lib/tauri";
import { CkanDiscoverToolbar } from "./CkanDiscoverToolbar";
import { DatasetPreviewModal } from "./DatasetPreviewModal";
import { DiscoverDatasetCard } from "./DiscoverDatasetCard";
import { FeedBrowser } from "./FeedBrowser";
import { packRef } from "@/lib/sourceRef";
import { LoveButton, SaveButton, SourcePrefMenu } from "@/components/SourcePrefControls";
import { DATA_GOV_ROW_OPTIONS, SectionHeading, filterDatasetsLocal, ipcErrorMessage } from "./shared";
import { uniqueDatasets } from "@/lib/openDataCatalog";

const CatalogSectionLoading = () => (
  <section className="rounded-lg border border-loom-border/70 bg-loom-surface/40 p-3 text-xs text-loom-muted">
    Loading catalog…
  </section>
);
const TidyTuesdaySection = dynamic<CatalogSectionProps>(
  () => import("@/components/PublicCatalogSections").then((m) => m.TidyTuesdaySection as ComponentType<CatalogSectionProps>),
  { ssr: false, loading: CatalogSectionLoading },
);
const SocrataCatalogSection = dynamic<CatalogSectionProps>(
  () => import("@/components/PublicCatalogSections").then((m) => m.SocrataCatalogSection as ComponentType<CatalogSectionProps>),
  { ssr: false, loading: CatalogSectionLoading },
);

export function DataRegionView({
  onBack,
  expanded,
  onExpand,
  onCollapse,
  mountedFolder,
  folderName,
  filesCount,
  isScanning,
  onPickFolder,
  onRescanFolder,
  isWeb,
  onLoadRemoteCsv,
  onLoadFiles,
  onUseDemoData,
  fileInputRef,
  onPickWebFolder,
  urlImport,
  onUrlImportChange,
  onOpenFromUrl,
  linkedMeta,
  onLinkDeviceFolder,
  onResyncLinkedFolder,
  onReconnectLinkedFolder,
  onCancelFolderScan,
  folderScan,
  linkedAccessBlocked,
  onUnlinkDeviceFolder,
  webVaultFileCount,
}: {
  onBack: () => void;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  mountedFolder: string | null;
  folderName: string | null;
  filesCount: number;
  isScanning: boolean;
  onPickFolder: () => void;
  onRescanFolder: () => void;
  isWeb: boolean;
  onLoadRemoteCsv: (
    url: string,
    filename: string,
    opts?: { rowLimit?: number; sourceCredit?: string; sourceHome?: string },
  ) => Promise<boolean>;
  onLoadFiles?: (e: ChangeEvent<HTMLInputElement>) => void;
  onUseDemoData?: () => void;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  onPickWebFolder?: () => void;
  urlImport?: string;
  onUrlImportChange?: (v: string) => void;
  onOpenFromUrl?: () => void;
  linkedMeta?: LinkedFolderMeta | null;
  onLinkDeviceFolder?: () => void;
  onResyncLinkedFolder?: () => void;
  onReconnectLinkedFolder?: () => void;
  onCancelFolderScan?: () => void;
  folderScan?: LinkedFolderScanProgress | null;
  linkedAccessBlocked?: boolean;
  onUnlinkDeviceFolder?: () => void;
  webVaultFileCount?: number;
}) {
  const [dataGovDatasets, setDataGovDatasets] = useState<DataGovDataset[]>([]);
  const [dataGovLoading, setDataGovLoading] = useState(false);
  const [dataGovError, setDataGovError] = useState<string | null>(null);
  const [dataGovRequest, setDataGovRequest] = useState<{ q: string; sort: DataGovSortKey; rows: (typeof DATA_GOV_ROW_OPTIONS)[number] }>({
    q: isWeb ? "csv" : "",
    sort: isWeb ? "relevance" : "newest",
    rows: 80,
  });
  const [dataGovQueryDraft, setDataGovQueryDraft] = useState(isWeb ? "csv" : "");
  const [dataGovLocalFilter, setDataGovLocalFilter] = useState("");

  const [ukDatasets, setUkDatasets] = useState<DataGovDataset[]>([]);
  const [ukLoading, setUkLoading] = useState(false);
  const [ukError, setUkError] = useState<string | null>(null);
  const [ukRequest, setUkRequest] = useState<{ q: string; sort: DataGovSortKey; rows: (typeof DATA_GOV_ROW_OPTIONS)[number] }>({
    q: "",
    sort: "newest",
    rows: 80,
  });
  const [ukQueryDraft, setUkQueryDraft] = useState("");
  const [ukLocalFilter, setUkLocalFilter] = useState("");

  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [previewDataset, setPreviewDataset] = useState<DataGovDataset | null>(null);
  const isTauriEnv = isDesktop();

  const dataGovFiltered = useMemo(
    () => filterDatasetsLocal(dataGovDatasets, dataGovLocalFilter),
    [dataGovDatasets, dataGovLocalFilter],
  );
  const ukFiltered = useMemo(() => filterDatasetsLocal(ukDatasets, ukLocalFilter), [ukDatasets, ukLocalFilter]);

  useEffect(() => {
    let cancelled = false;
    setDataGovLoading(true);
    setDataGovError(null);
    fetchDataGovRecentCsv({
      rows: dataGovRequest.rows,
      query: dataGovRequest.q || undefined,
      sort: dataGovRequest.sort,
    })
      .then((datasets) => {
        if (cancelled) return;
        setDataGovDatasets(uniqueDatasets(datasets));
      })
      .catch((e) => {
        if (cancelled) return;
        setDataGovError(ipcErrorMessage(e) || "Failed to load Data.gov datasets");
        setDataGovDatasets([]);
      })
      .finally(() => {
        if (!cancelled) setDataGovLoading(false);
      });
    return () => { cancelled = true; };
  }, [dataGovRequest]);

  useEffect(() => {
    let cancelled = false;
    setUkLoading(true);
    setUkError(null);
    fetchUkDataRecentCsv({
      rows: ukRequest.rows,
      query: ukRequest.q || undefined,
      sort: ukRequest.sort,
    })
      .then((datasets) => {
        if (!cancelled) setUkDatasets(uniqueDatasets(datasets));
      })
      .catch((e) => {
        if (!cancelled) {
          setUkError(ipcErrorMessage(e) || "Failed to load UK datasets");
          setUkDatasets([]);
        }
      })
      .finally(() => {
        if (!cancelled) setUkLoading(false);
      });
    return () => { cancelled = true; };
  }, [ukRequest]);

  async function handleSaveToFolder(url: string, filename: string, resourceId: string) {
    if (!mountedFolder || mountedFolder.startsWith("mock://") || mountedFolder.startsWith("web://")) return;
    setSavingId(resourceId);
    try {
      await saveCsvToFolder(mountedFolder, url, filename);
      await onRescanFolder();
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSavingId(null);
    }
  }

  async function handleLoadCsv(
    url: string,
    filename: string,
    resourceId: string,
    opts?: { rowLimit?: number; sourceCredit?: string; sourceHome?: string },
  ) {
    setLoadingId(resourceId);
    setExploreError(null);
    try {
      const ok = await onLoadRemoteCsv(url, filename, opts);
      if (!ok) {
        setExploreError("Couldn’t load that CSV — check your network and try again, or pick another dataset.");
      }
    } finally {
      setLoadingId(null);
    }
  }

  const canSaveToFolder = isTauriEnv && mountedFolder && !mountedFolder.startsWith("mock://") && !mountedFolder.startsWith("web://");
  const canLoadInBrowser = isWeb;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-loom-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="loom-btn-ghost p-1.5 rounded-md shrink-0"
            title="Back to files"
            aria-label="Back to files"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-loom-text tracking-tight truncate">Data & sources</span>
        </div>
        <button
          type="button"
          onClick={expanded ? onCollapse : onExpand}
          className="loom-btn-ghost text-2xs py-1.5 px-2 rounded border border-loom-border hover:border-loom-accent hover:bg-loom-accent/10 transition-colors inline-flex items-center gap-1 shrink-0"
          title={expanded ? "Collapse to sidebar" : "Expand to full grid"}
        >
          {expanded ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
              Collapse
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
              Expand
            </>
          )}
        </button>
      </div>

      <div className={`flex-1 overflow-y-auto py-4 px-3 ${expanded ? "min-h-0" : ""} flex flex-col gap-7`}>
        {exploreError ? (
          <div
            role="alert"
            className="rounded-md border border-loom-danger/40 bg-loom-danger/10 px-3 py-2 text-2xs text-loom-text"
            style={{ order: -2 }}
          >
            <p className="font-medium">Explore failed</p>
            <p className="text-loom-muted mt-0.5 break-words">{exploreError}</p>
          </div>
        ) : null}
        {/* Web leads with one-tap fun data (discover, live feeds, curated packs);
            desktop leads with the local folder. Order is set per section below. */}
        <section style={{ order: isWeb ? 0 : -1 }}>
          <button
            type="button"
            onClick={() => requestDiscoverScan()}
            className="loom-btn-primary w-full min-h-11 text-sm font-semibold rounded-lg"
          >
            Find something fun to chart
          </button>
          <p className="text-2xs text-loom-muted mt-1.5 text-center">Scans every live feed and shows chartable stories — pick one to open.</p>
        </section>

        {/* Get data in — web: upload / explore; desktop: folder */}
        <section style={{ order: isWeb ? 3 : 0 }}>
          <SectionHeading
            title={isWeb ? WEB_VAULT_LABEL : "Local folder"}
            lede={
              isWeb
                ? "Your personal data folder on this phone — add files, or link a real folder and sync. Nothing leaves the device."
                : "Mount a folder of CSV / Parquet / JSON / Excel files."
            }
          />
          <div className="space-y-2">
            {isWeb ? (
              <>
                <div className="border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-loom-text tracking-tight">
                        {folderName ?? WEB_VAULT_LABEL}
                      </p>
                      <p className="text-2xs text-loom-muted mt-0.5 leading-snug">
                        {linkedMeta
                          ? `Linked to “${linkedMeta.displayName}” on this device`
                          : "Lives in this browser · reopen after refresh"}
                      </p>
                    </div>
                    <span className="loom-badge flex-shrink-0 tabular-nums">
                      {webVaultFileCount ?? filesCount}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    id="loom-web-csv-files-data-region"
                    type="file"
                    accept={WEB_FILE_ACCEPT}
                    multiple
                    className="sr-only"
                    onChange={onLoadFiles}
                  />
                  <label
                    htmlFor="loom-web-csv-files-data-region"
                    className={`loom-btn-primary w-full text-xs min-h-10 flex items-center justify-center cursor-pointer ${isScanning ? "pointer-events-none opacity-60" : ""}`}
                  >
                    {isScanning ? "Loading…" : "Add files to my folder"}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {onLinkDeviceFolder && !linkedMeta && (
                      <button
                        type="button"
                        onClick={onLinkDeviceFolder}
                        disabled={isScanning}
                        className="loom-btn-ghost flex-1 min-w-[8rem] text-xs min-h-9"
                        title="Pick a folder on this device and keep it in sync"
                      >
                        Link a folder
                      </button>
                    )}
                    {linkedAccessBlocked && onReconnectLinkedFolder && (
                      <button
                        type="button"
                        onClick={onReconnectLinkedFolder}
                        className="loom-btn-primary w-full text-xs min-h-9"
                      >
                        Reconnect linked folder
                      </button>
                    )}
                    {folderScan && isScanning && (
                      <p className="text-2xs text-loom-muted" role="status">
                        Scanning… {folderScan.filesFound} file{folderScan.filesFound === 1 ? "" : "s"}
                        {folderScan.capped ? " (limit reached)" : ""}
                        {onCancelFolderScan && (
                          <button type="button" className="ml-2 text-loom-accent underline" onClick={onCancelFolderScan}>
                            Cancel
                          </button>
                        )}
                      </p>
                    )}
                    {onResyncLinkedFolder && (
                      <button
                        type="button"
                        onClick={onResyncLinkedFolder}
                        disabled={isScanning}
                        className="loom-btn-ghost flex-1 min-w-[6rem] text-xs min-h-9"
                      >
                        Sync folder
                      </button>
                    )}
                    {onPickWebFolder && !onLinkDeviceFolder && (
                      <button
                        type="button"
                        onClick={onPickWebFolder}
                        disabled={isScanning}
                        className="loom-btn-ghost flex-1 text-xs min-h-9"
                      >
                        Choose folder
                      </button>
                    )}
                    {onUnlinkDeviceFolder && (
                      <button
                        type="button"
                        onClick={onUnlinkDeviceFolder}
                        disabled={isScanning}
                        className="text-2xs text-loom-muted hover:text-loom-accent px-1 min-h-9"
                      >
                        Unlink
                      </button>
                    )}
                  </div>
                </div>
                {onUrlImportChange && onOpenFromUrl && (
                  <div className="flex gap-1.5">
                    <input
                      type="url"
                      value={urlImport ?? ""}
                      onChange={(e) => onUrlImportChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onOpenFromUrl();
                      }}
                      placeholder="https://…/data.csv"
                      className="loom-input flex-1 min-w-0 text-2xs py-1.5 px-2"
                      aria-label="Add data from URL to my folder"
                    />
                    <button
                      type="button"
                      onClick={onOpenFromUrl}
                      disabled={isScanning || !(urlImport ?? "").trim()}
                      className="loom-btn-ghost text-xs px-2 shrink-0"
                    >
                      Add
                    </button>
                  </div>
                )}
                {onUseDemoData && (
                  <button type="button" onClick={onUseDemoData} className="loom-btn-ghost w-full text-xs">
                    Try demo data
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={onPickFolder}
                  disabled={isScanning}
                  className="loom-btn-primary w-full text-xs"
                >
                  {isScanning ? "Scanning…" : mountedFolder ? "Change folder" : "Choose folder"}
                </button>
                {mountedFolder ? (
                  <div className="border border-loom-border rounded-md p-2.5 flex items-center justify-between gap-2 bg-loom-surface/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-loom-text truncate" title={folderName ?? undefined}>{folderName ?? "Folder"}</p>
                      <p className="text-2xs text-loom-muted font-mono truncate" title={mountedFolder}>
                        {mountedFolder}
                      </p>
                    </div>
                    <span className="loom-badge flex-shrink-0">{filesCount}</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* Data.gov: discover recent CSVs — list or grid when expanded */}
        <section className={expanded ? "flex-1 min-h-0 flex flex-col" : ""} style={{ order: 4 }}>
          <SectionHeading
            title="Data.gov"
            lede={isWeb ? "US open data — Explore loads CSV and opens Chart." : "Search and save CSVs into your folder."}
            meta={
              !dataGovLoading && dataGovDatasets.length > 0
                ? dataGovLocalFilter.trim()
                  ? `${dataGovFiltered.length}/${dataGovDatasets.length}`
                  : `${dataGovDatasets.length}`
                : undefined
            }
          />
          <CkanDiscoverToolbar
            queryDraft={dataGovQueryDraft}
            onQueryDraftChange={setDataGovQueryDraft}
            onSearch={() => setDataGovRequest((r) => ({ ...r, q: dataGovQueryDraft.trim() }))}
            sort={dataGovRequest.sort}
            onSortChange={(sort) => setDataGovRequest((r) => ({ ...r, sort }))}
            rowLimit={dataGovRequest.rows}
            onRowLimitChange={(rows) => setDataGovRequest((r) => ({ ...r, rows }))}
            localFilter={dataGovLocalFilter}
            onLocalFilterChange={setDataGovLocalFilter}
            loading={dataGovLoading}
          />
          {dataGovLoading && (
            <p className="text-2xs text-loom-muted px-1 py-2">Loading…</p>
          )}
          {dataGovError && (
            <p className="text-2xs text-loom-warning px-1 py-1" role="alert">{dataGovError}</p>
          )}
          {!dataGovLoading && !dataGovError && dataGovDatasets.length === 0 && (
            <p className="text-2xs text-loom-muted px-1 py-2">No datasets matched. Try different search terms.</p>
          )}
          <div className={expanded ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 flex-1 content-start overflow-y-auto min-h-0" : "space-y-3"}>
            {dataGovFiltered.map((ds) => (
              <DiscoverDatasetCard
                key={ds.id}
                dataset={ds}
                expanded={expanded}
                isWeb={canLoadInBrowser}
                canSaveToFolder={!!canSaveToFolder}
                isScanning={isScanning}
                loadingId={loadingId}
                savingId={savingId}
                onPreview={() => setPreviewDataset(ds)}
                onExplore={(url, filename, id) => handleLoadCsv(url, filename, id)}
                onSave={handleSaveToFolder}
              />
            ))}
          </div>
          <a
            href="https://data.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent shrink-0"
          >
            Browse all on Data.gov
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </section>

        {/* data.gov.uk — same card UI + preview modal */}
        <section style={{ order: 5 }}>
          <SectionHeading
            title="data.gov.uk"
            lede={isWeb ? "UK open data — same Explore flow as Data.gov." : "Same search and save controls as Data.gov."}
            meta={
              !ukLoading && ukDatasets.length > 0
                ? ukLocalFilter.trim()
                  ? `${ukFiltered.length}/${ukDatasets.length}`
                  : `${ukDatasets.length}`
                : undefined
            }
          />
          <CkanDiscoverToolbar
            queryDraft={ukQueryDraft}
            onQueryDraftChange={setUkQueryDraft}
            onSearch={() => setUkRequest((r) => ({ ...r, q: ukQueryDraft.trim() }))}
            sort={ukRequest.sort}
            onSortChange={(sort) => setUkRequest((r) => ({ ...r, sort }))}
            rowLimit={ukRequest.rows}
            onRowLimitChange={(rows) => setUkRequest((r) => ({ ...r, rows }))}
            localFilter={ukLocalFilter}
            onLocalFilterChange={setUkLocalFilter}
            loading={ukLoading}
          />
          {ukLoading && <p className="text-2xs text-loom-muted px-1 py-2">Loading…</p>}
          {ukError && <p className="text-2xs text-loom-warning px-1 py-1" role="alert">{ukError}</p>}
          {!ukLoading && !ukError && ukDatasets.length === 0 && (
            <p className="text-2xs text-loom-muted px-1 py-2">No CSV datasets found. Try different search terms.</p>
          )}
          <div className={expanded ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 content-start" : "space-y-3"}>
            {ukFiltered.map((ds) => (
              <DiscoverDatasetCard
                key={ds.id}
                dataset={ds}
                expanded={expanded}
                isWeb={canLoadInBrowser}
                canSaveToFolder={!!canSaveToFolder}
                isScanning={isScanning}
                loadingId={loadingId}
                savingId={savingId}
                onPreview={() => setPreviewDataset(ds)}
                onExplore={(url, filename, id) => handleLoadCsv(url, filename, id)}
                onSave={handleSaveToFolder}
              />
            ))}
          </div>
          <a
            href="https://data.gov.uk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent shrink-0"
          >
            Browse all on data.gov.uk
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </section>

        {/* Live feeds + curated packs — one searchable, filterable browser (lib/feedBrowser.ts) */}
        <section className="space-y-2.5" style={{ order: isWeb ? 1 : 6 }}>
          <SectionHeading
            title="Live feeds & open packs"
            lede="Connect a feed. Pick it apart. Digest for leads; Directory for the full catalog."
          />
          <FeedBrowser
            expanded={expanded}
            renderPack={(pack) => (
              <div
                className="relative border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-1.5"
                data-source-ref={packRef(pack.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-loom-text leading-snug">{pack.title}</p>
                    <p className="text-2xs text-loom-muted mt-0.5 leading-snug">{pack.blurb}</p>
                    <p className="text-2xs text-loom-muted/80 mt-1">{pack.source}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {canLoadInBrowser && (
                    <button
                      type="button"
                      disabled={loadingId === pack.id || isScanning}
                      onClick={() =>
                        void handleLoadCsv(pack.url, `${pack.id}.csv`, pack.id, {
                          sourceCredit: pack.source,
                        })
                      }
                      className="text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/10 disabled:opacity-50"
                    >
                      {loadingId === pack.id ? "Loading…" : "Explore CSV"}
                    </button>
                  )}
                  {canSaveToFolder && (
                    <button
                      type="button"
                      disabled={savingId === pack.id}
                      onClick={() => void handleSaveToFolder(pack.url, `${pack.id}.csv`, pack.id)}
                      className="text-2xs px-2 py-1 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text disabled:opacity-50"
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
                    Open source
                  </a>
                  <div className="flex items-center gap-1 ml-auto">
                    <LoveButton sourceRef={packRef(pack.id)} label={pack.title} />
                    <SaveButton sourceRef={packRef(pack.id)} label={pack.title} />
                    <SourcePrefMenu sourceRef={packRef(pack.id)} label={pack.title} actions={["less", "hide"]} />
                  </div>
                </div>
              </div>
            )}
          />
        </section>

        {/* Catalog searches fetch on mount, so load them only in the expanded grid. */}
        {expanded ? (
          <>
            <TidyTuesdaySection
              Heading={SectionHeading}
              order={isWeb ? 2 : 7}
              expanded={expanded}
              canLoadInBrowser={canLoadInBrowser}
              canSaveToFolder={!!canSaveToFolder}
              isScanning={isScanning}
              loadingId={loadingId}
              savingId={savingId}
              onExplore={(url, filename, id) => void handleLoadCsv(url, filename, id)}
              onSave={(url, filename, id) => void handleSaveToFolder(url, filename, id)}
            />
            <SocrataCatalogSection
              Heading={SectionHeading}
              order={isWeb ? 2 : 7}
              expanded={expanded}
              canLoadInBrowser={canLoadInBrowser}
              canSaveToFolder={!!canSaveToFolder}
              isScanning={isScanning}
              loadingId={loadingId}
              savingId={savingId}
              onExplore={(url, filename, id, opts) => void handleLoadCsv(url, filename, id, opts)}
              onSave={(url, filename, id) => void handleSaveToFolder(url, filename, id)}
            />
          </>
        ) : null}

        {/* More portals */}
        <section style={{ order: 8 }}>
          <SectionHeading title="More portals" lede="Browse catalogs in a tab, then bring CSVs back here." />
          <ul className="space-y-2.5 px-1">
            <li>
              <a href="https://data.europa.eu/en/data" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                data.europa.eu
              </a>
              <p className="text-2xs text-loom-muted">EU open data portal</p>
            </li>
            <li>
              <a href="https://ourworldindata.org/data" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                Our World in Data
              </a>
              <p className="text-2xs text-loom-muted">Global development &amp; health</p>
            </li>
            <li>
              <a href="https://data.nasa.gov" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                data.nasa.gov
              </a>
              <p className="text-2xs text-loom-muted">NASA open science</p>
            </li>
            <li>
              <a href="https://www.fema.gov/about/openfema/data-sets" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                OpenFEMA datasets
              </a>
              <p className="text-2xs text-loom-muted">US disaster &amp; emergency data</p>
            </li>
            <li>
              <a href="https://openaq.org" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                OpenAQ
              </a>
              <p className="text-2xs text-loom-muted">Global air quality measurements</p>
            </li>
            <li>
              <a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer" className="text-sm text-loom-text hover:text-loom-accent">
                OpenSky Network
              </a>
              <p className="text-2xs text-loom-muted">Live ADS-B aircraft positions</p>
            </li>
          </ul>
        </section>
      </div>
      {previewDataset && (
        <DatasetPreviewModal
          dataset={previewDataset}
          onClose={() => setPreviewDataset(null)}
          onOpenFullSite={() => setPreviewDataset(null)}
        />
      )}
    </div>
  );
}
