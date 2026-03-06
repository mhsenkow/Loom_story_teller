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
import { pickFolder, scanFolder, inspectFile, isTauri } from "@/lib/tauri";
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
  // Defer isTauri() until after mount so server and first client render match (avoids hydration mismatch).
  const [isWebEnv, setIsWebEnv] = useState<boolean | null>(null);
  useEffect(() => {
    setIsWebEnv(!isTauri());
  }, []);

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
          isWeb={isWebEnv === true}
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
}: {
  onBack: () => void;
  mountedFolder: string | null;
  folderName: string | null;
  filesCount: number;
  isScanning: boolean;
  onPickFolder: () => void;
}) {
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
        {/* Local folders */}
        <section>
          <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-2 px-1">
            Local
          </h3>
          <div className="space-y-2">
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
              <p className="text-xs text-loom-muted px-1">No folder mounted</p>
            )}
            <button
              onClick={onPickFolder}
              disabled={isScanning}
              className="loom-btn-ghost w-full text-xs justify-center"
            >
              {isScanning ? "Scanning…" : mountedFolder ? "Change folder" : "Add folder"}
            </button>
          </div>
        </section>

        {/* Online sources */}
        <section>
          <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-2 px-1">
            Online
          </h3>
          <div className="space-y-2">
            <a
              href="https://data.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="loom-card block p-3 hover:border-loom-accent transition-colors group"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-loom-text group-hover:text-loom-accent">Data.gov</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50 group-hover:opacity-100">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </div>
              <p className="text-2xs text-loom-muted">
                U.S. government open data — 394K+ datasets. Download CSV/Parquet and mount locally in Loom.
              </p>
            </a>
            <div className="loom-card p-3 border-dashed border-loom-border opacity-75">
              <p className="text-xs text-loom-muted">More sources coming soon</p>
              <p className="text-2xs text-loom-muted mt-0.5">Custom URLs, APIs, and catalogs.</p>
            </div>
          </div>
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
              Pick CSV files from your device (browser only).
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
              "Change Folder"
            ) : (
              "Mount Folder"
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDataRegion}
          className="loom-btn-ghost w-full text-xs mt-2 flex items-center justify-center gap-1.5"
          title="Data & sources — folders, Data.gov, more"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          Data & sources
        </button>
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
