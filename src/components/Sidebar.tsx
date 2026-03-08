// =================================================================
// Sidebar — File Explorer + Data & Sources Region
// =================================================================
// Two modes:
//   1. Files — Change Folder, mounted folder, file list.
//   2. Data & sources — Slide-in region: local folders, online sources
//      (e.g. Data.gov), future multi-folder and connectors.
// =================================================================

"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useLoomStore, type FileEntry } from "@/lib/store";
import { pickFolder, scanFolder, inspectFile, isTauri, saveCsvToFolder, fetchDataGovRecentCsv, fetchUkDataRecentCsv, OPEN_DATA_PORTALS, type DataGovDataset } from "@/lib/tauri";
import { recommend } from "@/lib/recommendations";
import { formatBytes, formatNumber, extensionIcon } from "@/lib/format";
import { parseCsvToInspectResult, mockFiles } from "@/lib/mock-data";

const SIDEBAR_WIDTH = 260;
const DATA_REGION_WIDTH = 340;

export function Sidebar() {
  const {
    mountedFolder, files, isScanning, selectedFile, inspectingFilePath, sidebarOpen, dataRegionOpen, dataSourcesExpanded,
    setMountedFolder, setFiles, setIsScanning, setSelectedFile, setInspectingFilePath,
    setColumnStats, setSampleRows, setVegaSpec, setChartRecs, setActiveChart,
    setDataRegionOpen, setDataSourcesExpanded, webFileCache, setWebFileCache,
    addRecentFile, setLastSession, viewMode, recentFiles, lastSession, setViewMode,
    setToast,
  } = useLoomStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  // Only show web vs Tauri UI after mount so server and first client render match (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);

  const filteredFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return files;
    const q = fileSearchQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, fileSearchQuery]);
  useEffect(() => {
    setMounted(true);
  }, []);
  const isWebEnv = mounted && !isTauri();

  async function handlePickFolder() {
    const folder = await pickFolder();
    if (!folder) return;
    setMountedFolder(folder);
    setLastSession({ folderPath: folder, filePath: null, viewMode });
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

  async function handleReopenSession() {
    if (!lastSession?.folderPath) return;
    const folder = lastSession.folderPath;
    if (folder.startsWith("mock://") || folder.startsWith("web://")) return;
    setMountedFolder(folder);
    setIsScanning(true);
    try {
      const result = await scanFolder(folder);
      setFiles(result);
      if (lastSession.filePath && result.length > 0) {
        const file = result.find((f) => f.path === lastSession!.filePath);
        if (file) {
          setViewMode(lastSession.viewMode);
          await handleSelectFile(file);
        }
      }
    } catch (e) {
      console.error("Reopen session failed:", e);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleOpenRecentFile(file: FileEntry) {
    if (file.path.startsWith("web://") || file.path.startsWith("mock://")) {
      if (mountedFolder && files.some((f) => f.path === file.path)) {
        await handleSelectFile(file);
      }
      return;
    }
    const parent = file.path.includes("/") ? file.path.replace(/\/[^/]+$/, "") : "";
    if (mountedFolder === parent && files.some((f) => f.path === file.path)) {
      await handleSelectFile(file);
      return;
    }
    if (!parent) return;
    setMountedFolder(parent);
    setIsScanning(true);
    try {
      const result = await scanFolder(parent);
      setFiles(result);
      const found = result.find((f) => f.path === file.path);
      if (found) await handleSelectFile(found);
    } catch (e) {
      console.error("Open recent failed:", e);
    } finally {
      setIsScanning(false);
    }
  }

  async function handleSelectFile(file: FileEntry) {
    setSelectedFile(file);
    setInspectingFilePath(file.path);
    setColumnStats([]);
    setSampleRows(null);
    addRecentFile(file);
    setLastSession({
      folderPath: mountedFolder,
      filePath: file.path,
      viewMode,
    });
    try {
      const cached = webFileCache[file.path];
      const result = cached ?? await inspectFile(file.path, 500);
      if (useLoomStore.getState().selectedFile?.path !== file.path) return;
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
      if (useLoomStore.getState().selectedFile?.path === file.path) {
        setToast("Failed to load file. Try another or check the file.");
      }
    } finally {
      if (useLoomStore.getState().inspectingFilePath === file.path) {
        setInspectingFilePath(null);
      }
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
        const firstEntry = entries[0];
        setSelectedFile(firstEntry);
        addRecentFile(firstEntry);
        setLastSession({ folderPath: "web://", filePath: firstEntry.path, viewMode });
        const first = cache[firstEntry.path];
        if (first) {
          setColumnStats(first.stats);
          setSampleRows(first.sample);
          const recs = recommend(first.stats, first.sample, firstEntry.name);
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

  const width = dataSourcesExpanded ? undefined : (dataRegionOpen ? DATA_REGION_WIDTH : SIDEBAR_WIDTH);
  const folderName = mountedFolder?.split("/").pop() ?? null;

  return (
    <aside
      className={`flex flex-col h-full border-r border-loom-border bg-loom-surface overflow-hidden transition-[width] duration-200 ease-out ${dataSourcesExpanded ? "flex-1 min-w-0" : "flex-shrink-0"}`}
      style={width !== undefined ? { width: `${width}px` } : undefined}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-[var(--topbar-height)] border-b border-loom-border flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-loom-accent animate-pulse-subtle" />
        <span className="text-sm font-semibold text-loom-text tracking-tight">Loom</span>
      </div>

      {dataRegionOpen ? (
        <DataRegionView
          onBack={() => { setDataRegionOpen(false); setDataSourcesExpanded(false); }}
          expanded={dataSourcesExpanded}
          onExpand={() => setDataSourcesExpanded(true)}
          onCollapse={() => setDataSourcesExpanded(false)}
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
          files={filteredFiles}
          allFiles={files}
          isScanning={isScanning}
          selectedFile={selectedFile}
          inspectingFilePath={inspectingFilePath}
          onPickFolder={handlePickFolder}
          onSelectFile={handleSelectFile}
          onOpenDataRegion={() => setDataRegionOpen(true)}
          formatNumber={formatNumber}
          isWeb={isWebEnv}
          onLoadFiles={handleLoadFiles}
          fileInputRef={fileInputRef}
          onUseDemoData={handleUseDemoData}
          recentFiles={recentFiles}
          lastSession={lastSession}
          onReopenSession={handleReopenSession}
          onOpenRecentFile={handleOpenRecentFile}
          fileSearchQuery={fileSearchQuery}
          onFileSearchChange={setFileSearchQuery}
        />
      )}
    </aside>
  );
}

// --- Dataset preview modal (before opening full site) ---

function DatasetPreviewModal({
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
  const notesPreview = dataset.notes
    ? dataset.notes.slice(0, 400) + (dataset.notes.length > 400 ? "…" : "")
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
    >
      <div
        className="loom-card max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col bg-loom-surface border border-loom-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-loom-border flex-shrink-0">
          <h2 id="preview-title" className="text-sm font-semibold text-loom-text truncate">
            Preview
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
            <p className="text-sm font-medium text-loom-text">{dataset.title}</p>
            {dataset.organization && (
              <p className="text-2xs text-loom-muted mt-0.5">{dataset.organization}</p>
            )}
          </div>
          {notesPreview && (
            <p className="text-xs text-loom-muted leading-relaxed line-clamp-4">{notesPreview}</p>
          )}
          <div>
            <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-1">
              {dataset.resources.length} CSV resource{dataset.resources.length !== 1 ? "s" : ""}
            </p>
            <ul className="text-2xs text-loom-muted space-y-0.5">
              {dataset.resources.slice(0, 5).map((r) => (
                <li key={r.id} className="truncate" title={r.url}>
                  {r.name !== "CSV" ? r.name : "CSV file"}
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
              window.open(viewUrl, "_blank", "noopener,noreferrer");
            }}
            className="loom-btn-primary text-xs flex-1"
          >
            Open on {portal.label}
          </button>
          <button type="button" onClick={onClose} className="loom-btn-ghost text-xs">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Data & Sources (slide-in region) ---

const DATA_GOV_ROWS = 80;

function DataRegionView({
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
}) {
  const [dataGovDatasets, setDataGovDatasets] = useState<DataGovDataset[]>([]);
  const [dataGovLoading, setDataGovLoading] = useState(false);
  const [dataGovError, setDataGovError] = useState<string | null>(null);
  const [ukDatasets, setUkDatasets] = useState<DataGovDataset[]>([]);
  const [ukLoading, setUkLoading] = useState(false);
  const [ukError, setUkError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [previewDataset, setPreviewDataset] = useState<DataGovDataset | null>(null);
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
    fetchDataGovRecentCsv(DATA_GOV_ROWS)
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

  useEffect(() => {
    let cancelled = false;
    if (!isTauriEnv) {
      setUkError("UK data is available in the desktop app (Tauri mode).");
      setUkDatasets([]);
      setUkLoading(false);
      return () => { cancelled = true; };
    }
    setUkLoading(true);
    setUkError(null);
    fetchUkDataRecentCsv(DATA_GOV_ROWS)
      .then((datasets) => {
        if (!cancelled) setUkDatasets(datasets);
      })
      .catch((e) => {
        if (!cancelled) {
          setUkError(e instanceof Error ? e.message : "Failed to load UK datasets");
          setUkDatasets([]);
        }
      })
      .finally(() => {
        if (!cancelled) setUkLoading(false);
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
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-loom-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="loom-btn-ghost p-1.5 rounded-md shrink-0"
            title="Back to files"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-semibold text-loom-text uppercase tracking-wider truncate">Data & sources</span>
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

      <div className={`flex-1 overflow-y-auto py-3 px-3 ${expanded ? "min-h-0" : ""} ${expanded ? "space-y-4" : "space-y-6"}`}>
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

        {/* Data.gov: discover recent CSVs — list or grid when expanded */}
        <section className={expanded ? "flex-1 min-h-0 flex flex-col" : ""}>
          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">
              Discover — Data.gov
            </h3>
            {!dataGovLoading && dataGovDatasets.length > 0 && (
              <span className="text-2xs text-loom-muted">{dataGovDatasets.length} datasets</span>
            )}
          </div>
          {!expanded && (
            <p className="text-2xs text-loom-muted px-1 mb-2">
              Recent CSV datasets. Download or save to your folder.
            </p>
          )}
          {dataGovLoading && (
            <p className="text-2xs text-loom-muted px-1 py-2">Loading…</p>
          )}
          {dataGovError && (
            <p className="text-2xs text-amber-500/90 px-1 py-1">{dataGovError}</p>
          )}
          {!dataGovLoading && !dataGovError && dataGovDatasets.length === 0 && (
            <p className="text-2xs text-loom-muted px-1 py-2">No CSV datasets found.</p>
          )}
          <div className={expanded ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 flex-1 content-start overflow-y-auto min-h-0" : "space-y-3"}>
            {dataGovDatasets.map((ds) => (
              <div key={ds.id} className={`loom-card p-2.5 space-y-1.5 ${expanded ? "flex flex-col min-w-0" : ""}`}>
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium text-loom-text ${expanded ? "line-clamp-2" : "line-clamp-2"}`}>{ds.title}</p>
                    {ds.organization && (
                      <p className="text-2xs text-loom-muted mt-0.5 truncate">{ds.organization}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewDataset(ds)}
                    className="text-2xs text-loom-accent hover:underline shrink-0 text-left"
                  >
                    View
                  </button>
                </div>
                <div className="space-y-1">
                  {ds.resources.slice(0, expanded ? 2 : 3).map((res) => {
                    const label = res.name !== "CSV" ? res.name : `${ds.title.slice(0, 30)}.csv`;
                    const filename = (res.name !== "CSV" ? res.name : ds.title).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) + ".csv";
                    return (
                      <div key={res.id} className="flex items-center gap-2 flex-wrap text-2xs">
                        <span className={`text-loom-muted truncate ${expanded ? "max-w-full" : "max-w-[180px]"}`} title={res.url}>
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
                          <span className="shrink-0 flex flex-col items-start">
                            <button
                              type="button"
                              disabled={savingId === res.id}
                              onClick={() => handleSaveToFolder(res.url, filename, res.id)}
                              className="text-loom-accent hover:underline disabled:opacity-50"
                            >
                              {savingId === res.id ? "Saving…" : "Save to folder"}
                            </button>
                            {savingId === res.id && (
                              <span className="text-2xs text-loom-muted mt-0.5">Large files may take a moment</span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {ds.resources.length > (expanded ? 2 : 3) && (
                    <p className="text-2xs text-loom-muted">+{ds.resources.length - (expanded ? 2 : 3)} more</p>
                  )}
                </div>
              </div>
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
        <section>
          <div className="flex items-center justify-between gap-2 mb-2 px-1">
            <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">
              Discover — data.gov.uk
            </h3>
            {!ukLoading && ukDatasets.length > 0 && (
              <span className="text-2xs text-loom-muted">{ukDatasets.length} datasets</span>
            )}
          </div>
          {!expanded && (
            <p className="text-2xs text-loom-muted px-1 mb-2">
              UK government open data. Recent CSVs.
            </p>
          )}
          {ukLoading && <p className="text-2xs text-loom-muted px-1 py-2">Loading…</p>}
          {ukError && <p className="text-2xs text-amber-500/90 px-1 py-1">{ukError}</p>}
          {!ukLoading && !ukError && ukDatasets.length === 0 && (
            <p className="text-2xs text-loom-muted px-1 py-2">No CSV datasets found.</p>
          )}
          <div className={expanded ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 content-start" : "space-y-3"}>
            {ukDatasets.map((ds) => (
              <div key={ds.id} className={`loom-card p-2.5 space-y-1.5 ${expanded ? "flex flex-col min-w-0" : ""}`}>
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-loom-text line-clamp-2">{ds.title}</p>
                    {ds.organization && (
                      <p className="text-2xs text-loom-muted mt-0.5 truncate">{ds.organization}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewDataset(ds)}
                    className="text-2xs text-loom-accent hover:underline shrink-0 text-left"
                  >
                    View
                  </button>
                </div>
                <div className="space-y-1">
                  {ds.resources.slice(0, expanded ? 2 : 3).map((res) => {
                    const label = res.name !== "CSV" ? res.name : `${ds.title.slice(0, 30)}.csv`;
                    const filename = (res.name !== "CSV" ? res.name : ds.title).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) + ".csv";
                    return (
                      <div key={res.id} className="flex items-center gap-2 flex-wrap text-2xs">
                        <span className={`text-loom-muted truncate ${expanded ? "max-w-full" : "max-w-[180px]"}`} title={res.url}>
                          {label}
                        </span>
                        <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-loom-accent hover:underline shrink-0">
                          Download
                        </a>
                        {canSaveToFolder && (
                          <span className="shrink-0 flex flex-col items-start">
                            <button
                              type="button"
                              disabled={savingId === res.id}
                              onClick={() => handleSaveToFolder(res.url, filename, res.id)}
                              className="text-loom-accent hover:underline disabled:opacity-50"
                            >
                              {savingId === res.id ? "Saving…" : "Save to folder"}
                            </button>
                            {savingId === res.id && (
                              <span className="text-2xs text-loom-muted mt-0.5">Large files may take a moment</span>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {ds.resources.length > (expanded ? 2 : 3) && (
                    <p className="text-2xs text-loom-muted">+{ds.resources.length - (expanded ? 2 : 3)} more</p>
                  )}
                </div>
              </div>
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

        {/* More data sources — links to other open data portals */}
        <section>
          <h3 className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-2 px-1">
            More sources
          </h3>
          <p className="text-2xs text-loom-muted px-1 mb-2">
            Open data portals with CSV downloads. Open in browser, then download and add to your folder.
          </p>
          <ul className="space-y-1.5">
            <li>
              <a href="https://data.europa.eu" target="_blank" rel="noopener noreferrer" className="text-2xs text-loom-accent hover:underline">
                data.europa.eu
              </a>
              <span className="text-2xs text-loom-muted"> — EU open data (1M+ datasets)</span>
            </li>
            <li>
              <a href="https://data.gov.uk" target="_blank" rel="noopener noreferrer" className="text-2xs text-loom-accent hover:underline">
                data.gov.uk
              </a>
              <span className="text-2xs text-loom-muted"> — UK government data</span>
            </li>
            <li>
              <a href="https://ourworldindata.org" target="_blank" rel="noopener noreferrer" className="text-2xs text-loom-accent hover:underline">
                Our World in Data
              </a>
              <span className="text-2xs text-loom-muted"> — Global development, health, environment</span>
            </li>
            <li>
              <a href="https://data.nasa.gov" target="_blank" rel="noopener noreferrer" className="text-2xs text-loom-accent hover:underline">
                data.nasa.gov
              </a>
              <span className="text-2xs text-loom-muted"> — NASA open data</span>
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

// --- Files view (default) ---

function FilesView({
  mountedFolder,
  folderName,
  files,
  allFiles,
  isScanning,
  selectedFile,
  inspectingFilePath,
  onPickFolder,
  onSelectFile,
  onOpenDataRegion,
  formatNumber,
  isWeb,
  onLoadFiles,
  fileInputRef,
  onUseDemoData,
  recentFiles,
  lastSession,
  onReopenSession,
  onOpenRecentFile,
  fileSearchQuery,
  onFileSearchChange,
}: {
  mountedFolder: string | null;
  folderName: string | null;
  files: FileEntry[];
  allFiles?: FileEntry[];
  isScanning: boolean;
  selectedFile: FileEntry | null;
  inspectingFilePath?: string | null;
  onPickFolder: () => void;
  onSelectFile: (f: FileEntry) => void;
  onOpenDataRegion: () => void;
  formatNumber: (n: number) => string;
  isWeb?: boolean;
  onLoadFiles?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  onUseDemoData?: () => void;
  recentFiles?: FileEntry[];
  lastSession?: { folderPath: string | null; filePath: string | null; viewMode: string } | null;
  onReopenSession?: () => void;
  onOpenRecentFile?: (f: FileEntry) => void;
  fileSearchQuery?: string;
  onFileSearchChange?: (q: string) => void;
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
        {(allFiles?.length ?? files.length) > 0 && onFileSearchChange && (
          <input
            type="search"
            value={fileSearchQuery ?? ""}
            onChange={(e) => onFileSearchChange(e.target.value)}
            placeholder="Search files..."
            className="loom-input w-full mt-2 text-2xs py-1.5 px-2"
            aria-label="Search files in folder"
          />
        )}
        {folderName && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-loom-accent text-xs">&#x25CF;</span>
            <span className="text-xs text-loom-muted font-mono truncate" title={mountedFolder ?? ""}>
              {folderName}
            </span>
            <span className="loom-badge ml-auto">
              {fileSearchQuery && (allFiles?.length ?? files.length) !== files.length
                ? `${files.length} of ${allFiles?.length ?? files.length}`
                : files.length}
            </span>
          </div>
        )}
        {lastSession?.folderPath && !lastSession.folderPath.startsWith("web://") && !lastSession.folderPath.startsWith("mock://") && onReopenSession && (
          <button
            type="button"
            onClick={onReopenSession}
            disabled={isScanning}
            className="mt-2 w-full text-2xs text-loom-muted hover:text-loom-accent border border-loom-border hover:border-loom-accent/50 rounded px-2 py-1 transition-colors"
          >
            Reopen last session
          </button>
        )}
      </div>

      {recentFiles && recentFiles.length > 0 && onOpenRecentFile && (
        <div className="px-3 py-2 border-b border-loom-border flex-shrink-0">
          <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider mb-1">Recent</p>
          <ul className="space-y-0.5 max-h-28 overflow-y-auto">
            {recentFiles.slice(0, 8).map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => onOpenRecentFile(f)}
                  className="w-full text-left text-xs text-loom-muted hover:text-loom-text truncate px-1.5 py-0.5 rounded hover:bg-loom-elevated"
                  title={f.path}
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            isInspecting={inspectingFilePath === file.path}
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
  isInspecting,
  onSelect,
}: {
  file: FileEntry;
  isSelected: boolean;
  isInspecting?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={isInspecting}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2 text-left
        transition-all duration-100
        ${isSelected
          ? "bg-loom-accent/10 border-r-2 border-loom-accent"
          : "hover:bg-loom-elevated border-r-2 border-transparent"
        }
        ${isInspecting ? "opacity-90" : ""}
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
        {isInspecting ? (
          <span className="inline-block w-3 h-3 border-2 border-loom-muted border-t-loom-accent rounded-full animate-spin" aria-hidden />
        ) : (
          extensionIcon(file.extension)
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-loom-text truncate">{file.name}</p>
        <p className="text-2xs text-loom-muted font-mono">
          {isInspecting ? "Loading…" : `${formatNumber(file.row_count)} rows · ${formatBytes(file.size_bytes)}`}
        </p>
      </div>
    </button>
  );
}
