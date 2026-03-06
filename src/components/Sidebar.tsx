// =================================================================
// Sidebar — File Explorer + Data & Sources Region
// =================================================================
// Two modes:
//   1. Files — Change Folder, mounted folder, file list.
//   2. Data & sources — Slide-in region: local folders, online sources
//      (e.g. Data.gov), future multi-folder and connectors.
// =================================================================

"use client";

import { useRef, useState, useEffect } from "react";
import { useLoomStore, type FileEntry } from "@/lib/store";
import { pickFolder, scanFolder, inspectFile, isTauri, saveCsvToFolder, fetchDataGovRecentCsv, type DataGovDataset } from "@/lib/tauri";
import { recommend } from "@/lib/recommendations";
import { formatBytes, formatNumber, extensionIcon } from "@/lib/format";
import { parseCsvToInspectResult, mockFiles } from "@/lib/mock-data";

const SIDEBAR_WIDTH = 260;
const DATA_REGION_WIDTH = 340;

export function Sidebar() {
  const {
    mountedFolder, files, isScanning, selectedFile, sidebarOpen, dataRegionOpen,
    setMountedFolder, setFiles, setIsScanning, setSelectedFile,
    setColumnStats, setSampleRows, setVegaSpec, setChartRecs, setActiveChart,
    setDataRegionOpen, webFileCache, setWebFileCache,
  } = useLoomStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Only show web vs Tauri UI after mount so server and first client render match (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isWebEnv = mounted && !isTauri();

  async function handlePickFolder() {
    const folder = await pickFolder();
    if (!folder) return;
    setMountedFolder(folder);
    setIsScanning(true);
    try {
      const result = await scanFolder(folder);
      setFiles(result);
    } catch (e) {
      console.error("Scan failed:", e);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleRescanFolder() {
    if (!mountedFolder || mountedFolder.startsWith("mock://") || mountedFolder.startsWith("web://")) return;
    setIsScanning(true);
    try {
      const result = await scanFolder(mountedFolder);
      setFiles(result);
    } catch (e) {
      console.error("Rescan failed:", e);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleSelectFile(file: FileEntry) {
    setSelectedFile(file);
    try {
      const cached = webFileCache[file.path];
      const result = cached ?? await inspectFile(file.path, 500);
      setColumnStats(result.stats);
      setSampleRows(result.sample);

      const recs = recommend(result.stats, result.sample, file.name);
      setChartRecs(recs);
      if (recs.length > 0) {
        setActiveChart(recs[0]);
      } else {
        setActiveChart(null);
        setVegaSpec(null);
      }
    } catch (e) {
      console.error("File inspection failed:", e);
    }
  }

  function handleUseDemoData() {
    setMountedFolder("mock://demo-folder");
    setFiles(mockFiles);
    if (mockFiles.length > 0) handleSelectFile(mockFiles[0]);
  }

  async function handleLoadFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected?.length) return;
    const cache: Record<string, { stats: import("@/lib/store").ColumnInfo[]; sample: import("@/lib/store").QueryResult }> = {};
    const entries: FileEntry[] = [];
    setMountedFolder("web://");
    setIsScanning(true);
    try {
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        if (!file.name.toLowerCase().endsWith(".csv")) continue;
        const text = await file.text();
        const path = `web://${file.name}`;
        const inspect = parseCsvToInspectResult(file.name, text);
        cache[path] = inspect;
        const rowCount = inspect.sample.total_rows ?? inspect.sample.rows.length;
        entries.push({
          path,
          name: file.name,
          extension: "csv",
          row_count: rowCount,
          size_bytes: file.size,
        });
      }
      setWebFileCache(cache);
      setFiles(entries);
      if (entries.length > 0) {
        setSelectedFile(entries[0]);
        const first = cache[entries[0].path];
        if (first) {
          setColumnStats(first.stats);
          setSampleRows(first.sample);
          const recs = recommend(first.stats, first.sample, entries[0].name);
          setChartRecs(recs);
          setActiveChart(recs.length > 0 ? recs[0] : null);
        }
      }
    } catch (err) {
      console.error("Load files failed:", err);
    } finally {
      setIsScanning(false);
      e.target.value = "";
    }
  }

  if (!sidebarOpen) return null;

  const width = dataRegionOpen ? DATA_REGION_WIDTH : SIDEBAR_WIDTH;
  const folderName = mountedFolder?.split("/").pop() ?? null;

  return (
    <aside
      className="flex flex-col h-full border-r border-loom-border bg-loom-surface flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
      style={{ width: `${width}px` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-[var(--topbar-height)] border-b border-loom-border flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-loom-accent animate-pulse-subtle" />
        <span className="text-sm font-semibold text-loom-text tracking-tight">Loom</span>
      </div>

      {dataRegionOpen ? (
        <DataRegionView
          onBack={() => setDataRegionOpen(false)}
          mountedFolder={mountedFolder}
          folderName={folderName}
          filesCount={files.length}
          isScanning={isScanning}
          onPickFolder={handlePickFolder}
          onRescanFolder={handleRescanFolder}
        />
      ) : (
        <FilesView
          mountedFolder={mountedFolder}
          folderName={folderName}
          files={files}
          isScanning={isScanning}
          selectedFile={selectedFile}
          onPickFolder={handlePickFolder}
          onSelectFile={handleSelectFile}
          onOpenDataRegion={() => setDataRegionOpen(true)}
          formatNumber={formatNumber}
          isWeb={isWebEnv}
          onLoadFiles={handleLoadFiles}
          fileInputRef={fileInputRef}
          onUseDemoData={handleUseDemoData}
        />
      )}
    </aside>
  );
}

// --- Data & Sources (slide-in region) ---

function DataRegionView({
  onBack,
  mountedFolder,
  folderName,
  filesCount,
  isScanning,
  onPickFolder,
  onRescanFolder,
}: {
  onBack: () => void;
  mountedFolder: string | null;
  folderName: string | null;
  filesCount: number;
  isScanning: boolean;
  onPickFolder: () => void;
  onRescanFolder: () => void;
}) {
  const [dataGovDatasets, setDataGovDatasets] = useState<DataGovDataset[]>([]);
  const [dataGovLoading, setDataGovLoading] = useState(false);
  const [dataGovError, setDataGovError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const isTauriEnv = isTauri();

  useEffect(() => {
    let cancelled = false;
    setDataGovLoading(true);
    setDataGovError(null);
    if (!isTauriEnv) {
      setDataGovError("Data.gov discovery is available in the desktop app (Tauri mode).");
      setDataGovDatasets([]);
      setDataGovLoading(false);
      return () => { cancelled = true; };
    }
    fetchDataGovRecentCsv(40)
      .then((datasets) => {
        if (cancelled) return;
        setDataGovDatasets(datasets);
      })
      .catch((e) => {
        if (cancelled) return;
        setDataGovError(e instanceof Error ? e.message : "Failed to load Data.gov datasets");
        setDataGovDatasets([]);
      })
      .finally(() => {
        if (!cancelled) setDataGovLoading(false);
      });
    return () => { cancelled = true; };
  }, [isTauriEnv]);

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

  const canSaveToFolder = isTauriEnv && mountedFolder && !mountedFolder.startsWith("mock://") && !mountedFolder.startsWith("web://");

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden animate-fade-in">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-loom-border flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="loom-btn-ghost p-1.5 rounded-md"
          title="Back to files"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs font-semibold text-loom-text uppercase tracking-wider">Data & sources</span>
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-6">
        {/* Local: choose folder first */}
        <section>
          <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-2 px-1">
            Local folder
          </h3>
          <div className="space-y-2">
            <button
              onClick={onPickFolder}
              disabled={isScanning}
              className="loom-btn-primary w-full text-xs"
            >
              {isScanning ? "Scanning…" : mountedFolder ? "Change folder" : "Choose folder"}
            </button>
            {mountedFolder ? (
              <div className="loom-card flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-loom-text truncate">{folderName ?? "Folder"}</p>
                  <p className="text-2xs text-loom-muted font-mono truncate" title={mountedFolder}>
                    {mountedFolder}
                  </p>
                </div>
                <span className="loom-badge flex-shrink-0">{filesCount} files</span>
              </div>
            ) : (
              <p className="text-2xs text-loom-muted px-1">
                Pick a folder to save discovered data and load local CSVs.
              </p>
            )}
          </div>
        </section>

        {/* Data.gov: discover recent CSVs */}
        <section>
          <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-2 px-1">
            Discover — Data.gov
          </h3>
          <p className="text-2xs text-loom-muted px-1 mb-2">
            Recent CSV datasets. Download or save to your folder.
          </p>
          {dataGovLoading && (
            <p className="text-2xs text-loom-muted px-1 py-2">Loading…</p>
          )}
          {dataGovError && (
            <p className="text-2xs text-amber-500/90 px-1 py-1">{dataGovError}</p>
          )}
          {!dataGovLoading && !dataGovError && dataGovDatasets.length === 0 && (
            <p className="text-2xs text-loom-muted px-1 py-2">No CSV datasets found.</p>
          )}
          <div className="space-y-3">
            {dataGovDatasets.map((ds) => (
              <div key={ds.id} className="loom-card p-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-loom-text line-clamp-2">{ds.title}</p>
                    {ds.organization && (
                      <p className="text-2xs text-loom-muted mt-0.5">{ds.organization}</p>
                    )}
                  </div>
                  <a
                    href={`https://catalog.data.gov/dataset/${ds.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xs text-loom-accent hover:underline shrink-0"
                  >
                    View
                  </a>
                </div>
                <div className="space-y-1">
                  {ds.resources.slice(0, 3).map((res) => {
                    const label = res.name !== "CSV" ? res.name : `${ds.title.slice(0, 30)}.csv`;
                    const filename = (res.name !== "CSV" ? res.name : ds.title).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) + ".csv";
                    return (
                      <div key={res.id} className="flex items-center gap-2 flex-wrap text-2xs">
                        <span className="text-loom-muted truncate max-w-[180px]" title={res.url}>
                          {label}
                        </span>
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-loom-accent hover:underline shrink-0"
                        >
                          Download
                        </a>
                        {canSaveToFolder && (
                          <button
                            type="button"
                            disabled={savingId === res.id}
                            onClick={() => handleSaveToFolder(res.url, filename, res.id)}
                            className="text-loom-accent hover:underline shrink-0 disabled:opacity-50"
                          >
                            {savingId === res.id ? "Saving…" : "Save to folder"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {ds.resources.length > 3 && (
                    <p className="text-2xs text-loom-muted">+{ds.resources.length - 3} more</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <a
            href="https://data.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-2xs text-loom-muted hover:text-loom-accent"
          >
            Browse all on Data.gov
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </section>
      </div>
    </div>
  );
}

// --- Files view (default) ---

function FilesView({
  mountedFolder,
  folderName,
  files,
  isScanning,
  selectedFile,
  onPickFolder,
  onSelectFile,
  onOpenDataRegion,
  formatNumber,
  isWeb,
  onLoadFiles,
  fileInputRef,
  onUseDemoData,
}: {
  mountedFolder: string | null;
  folderName: string | null;
  files: FileEntry[];
  isScanning: boolean;
  selectedFile: FileEntry | null;
  onPickFolder: () => void;
  onSelectFile: (f: FileEntry) => void;
  onOpenDataRegion: () => void;
  formatNumber: (n: number) => string;
  isWeb?: boolean;
  onLoadFiles?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  onUseDemoData?: () => void;
}) {
  return (
    <>
      <div className="px-3 py-3 border-b border-loom-border flex-shrink-0">
        <button
          type="button"
          onClick={onOpenDataRegion}
          className="loom-btn-ghost w-full text-xs flex items-center justify-center gap-1.5"
          title="Data & sources — discover and add data"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          Data & sources
        </button>
        <div className="mt-2 pt-2 border-t border-loom-border/50">
          {isWeb ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                multiple
                className="hidden"
                onChange={onLoadFiles}
              />
              <button
                type="button"
                onClick={() => fileInputRef?.current?.click()}
                disabled={isScanning}
                className="loom-btn-primary w-full text-xs"
              >
                {isScanning ? "Loading…" : "Load files"}
              </button>
              <p className="text-2xs text-loom-muted mt-1.5 px-0.5">
                Pick CSV files from your device.
              </p>
              {onUseDemoData && (
                <button
                  type="button"
                  onClick={onUseDemoData}
                  className="loom-btn-ghost w-full text-xs mt-2"
                >
                  Use demo data
                </button>
              )}
            </>
          ) : (
            <button
              onClick={onPickFolder}
              className="loom-btn-primary w-full text-xs"
              disabled={isScanning}
            >
              {isScanning ? (
                <span className="animate-pulse-subtle">Scanning...</span>
              ) : mountedFolder ? (
                "Change folder"
              ) : (
                "Choose folder"
              )}
            </button>
          )}
        </div>
        {folderName && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-loom-accent text-xs">&#x25CF;</span>
            <span className="text-xs text-loom-muted font-mono truncate" title={mountedFolder ?? ""}>
              {folderName}
            </span>
            <span className="loom-badge ml-auto">{files.length}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {files.length === 0 && !isScanning && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-loom-muted">No data files found</p>
            <p className="text-xs text-loom-muted mt-1">
              Mount a folder or open <button type="button" onClick={onOpenDataRegion} className="text-loom-accent hover:underline">Data & sources</button>
            </p>
          </div>
        )}
        {files.map((file) => (
          <FileItem
            key={file.path}
            file={file}
            isSelected={selectedFile?.path === file.path}
            onSelect={() => onSelectFile(file)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between px-3 h-[var(--statusbar-height)] border-t border-loom-border text-2xs text-loom-muted font-mono flex-shrink-0">
        <span>
          {files.length > 0
            ? `${formatNumber(files.reduce((a, f) => a + f.row_count, 0))} total rows`
            : "idle"}
        </span>
        <span>DuckDB</span>
      </div>
    </>
  );
}

function FileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: FileEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2 text-left
        transition-all duration-100
        ${isSelected
          ? "bg-loom-accent/10 border-r-2 border-loom-accent"
          : "hover:bg-loom-elevated border-r-2 border-transparent"
        }
      `}
    >
      <span
        className={`
          flex-shrink-0 w-7 h-5 flex items-center justify-center
          text-2xs font-mono font-semibold rounded
          ${file.extension === "parquet"
            ? "bg-loom-accent/20 text-loom-accent"
            : "bg-loom-success/20 text-loom-success"
          }
        `}
      >
        {extensionIcon(file.extension)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-loom-text truncate">{file.name}</p>
        <p className="text-2xs text-loom-muted font-mono">
          {formatNumber(file.row_count)} rows &middot; {formatBytes(file.size_bytes)}
        </p>
      </div>
    </button>
  );
}
