// =================================================================
// Sidebar — File Explorer + Data & Sources Region
// =================================================================
// Two modes:
//   1. Files — Change Folder, mounted folder, file list.
//   2. Data & sources — Portals (Data.gov, UK), save CSV, Wikipedia live
//      stream (SSE), and poll sources (USGS, Open-Meteo, NWS, World Bank).
// =================================================================

"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useLoomStore, type FileEntry } from "@/lib/store";
import { pickFolder, scanFolder, inspectFile, isTauri, saveCsvToFolder, fetchDataGovRecentCsv, fetchUkDataRecentCsv, fetchCsvTextWeb, OPEN_DATA_PORTALS, type DataGovDataset, type DataGovSortKey, streamStart, streamStop, streamStatus, streamSnapshot, streamClear, sourceStart, sourceStop, sourceStatus, sourceSnapshot, sourceClear, type SourceKind } from "@/lib/tauri";
import { getRecentFiles as getPersistedRecentFiles } from "@/lib/persist";
import { recommend, recommendStreamStory, recommendSourceStory } from "@/lib/recommendations";
import { formatBytes, formatNumber, extensionIcon } from "@/lib/format";
import { parseCsvToInspectResult, mockFiles } from "@/lib/mock-data";
import { firstCsvResource } from "@/lib/openDataCatalog";
import { SocrataCatalogSection, TidyTuesdaySection } from "@/components/PublicCatalogSections";
import { useIsMobile } from "@/lib/useMediaQuery";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { requestWhatsNew } from "@/lib/changelog";
import { SOURCE_DEFS, SOURCE_GROUP_LABELS, sourceStreamPath, type SourceDef, type SourceGroup, SOURCE_EXPLORE_ROWS } from "@/lib/sourceRegistry";
const SIDEBAR_WIDTH = 260;
const DATA_REGION_WIDTH = 340;

/** Tauri invoke rejects with string errors from Rust — normalize for UI. */
function ipcErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** Save-to-folder writes .csv bytes — only safe for real CSV URLs. */
function dataGovResourceSaveable(res: { format: string; url: string }): boolean {
  return res.format === "CSV" || /\.csv(\?|$)/i.test(res.url);
}

/** Leave Data & sources full-screen and show the chart canvas (esp. mobile). */
function leaveSourcesShowChart() {
  const s = useLoomStore.getState();
  s.setDataSourcesExpanded(false);
  s.setDataRegionOpen(false);
  s.setViewMode("chart");
  s.setPanelTab("chart");
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
    if (s.sidebarOpen) s.toggleSidebar();
    if (s.panelOpen) s.togglePanel();
  }
}

export function Sidebar() {
  const {
    mountedFolder, files, isScanning, selectedFile, inspectingFilePath, sidebarOpen, dataRegionOpen, dataSourcesExpanded,
    setMountedFolder, setFiles, setIsScanning, setSelectedFile, setInspectingFilePath,
    setColumnStats, setSampleRows, setVegaSpec, setChartRecs, setActiveChart,
    setDataRegionOpen, setDataSourcesExpanded, webFileCache, setWebFileCache,
    addRecentFile, setLastSession, viewMode, recentFiles, lastSession, setViewMode,
    setToast, toggleSidebar,
  } = useLoomStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [openingRecentPath, setOpeningRecentPath] = useState<string | null>(null);
  // Only show web vs Tauri UI after mount so server and first client render match (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

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
    setOpeningRecentPath(file.path);
    setToast(`Opening ${file.name}…`);
    try {
    // Live stream / poll source — reconnect and snapshot into Chart.
    if (file.path.startsWith("stream://")) {
      const kind = file.path.replace(/^stream:\/\//, "") as SourceKind | "wiki";
      try {
        if (kind === "wiki") {
          await streamStart();
          const snap = await streamSnapshot(500);
          if (!snap.sample.rows.length) {
            setToast("Wikipedia stream is warm — tap Explore in Live Streams when events appear");
            setDataRegionOpen(true);
            setDataSourcesExpanded(true);
            return;
          }
          setSelectedFile({ ...file, row_count: snap.sample.total_rows });
          setColumnStats(snap.stats);
          setSampleRows(snap.sample);
          const story = recommendStreamStory(snap.stats, snap.sample);
          setChartRecs(story.charts);
          setActiveChart(story.charts[0] ?? null);
          leaveSourcesShowChart();
          setToast(`Reopened ${file.name}`);
          return;
        }
        await sourceStart(kind);
        const snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
        if (!snap.sample.rows.length) {
          setToast(`${file.name} is connecting — tap Explore when rows appear`);
          setDataRegionOpen(true);
          setDataSourcesExpanded(true);
          return;
        }
        setSelectedFile({ ...file, row_count: snap.sample.total_rows });
        setColumnStats(snap.stats);
        setSampleRows(snap.sample);
        const story = recommendSourceStory(kind, snap.stats, snap.sample);
        setChartRecs(story.charts);
        setActiveChart(story.charts[0] ?? null);
        leaveSourcesShowChart();
        setToast(`Reopened ${file.name}`);
      } catch (e) {
        setToast(`Couldn’t reopen: ${ipcErrorMessage(e)}`);
      }
      return;
    }

    // Web / mock: prefer in-memory inspect cache, else re-fetch remote URL.
    if (file.path.startsWith("web://") || file.path.startsWith("mock://")) {
      const state = useLoomStore.getState();
      const cached = state.webFileCache[file.path];
      // Store may have dropped sourceUrl on older entries — recover from disk.
      let sourceUrl = file.sourceUrl;
      if (!sourceUrl) {
        sourceUrl = getPersistedRecentFiles().find((f) => f.path === file.path)?.sourceUrl;
      }
      if (cached) {
        const inList = state.files.some((f) => f.path === file.path);
        if (!inList) {
          setMountedFolder(file.path.startsWith("mock://") ? "mock://demo-folder" : "web://");
          setFiles([
            ...state.files.filter((f) => f.path !== file.path),
            { ...file, sourceUrl: sourceUrl ?? file.sourceUrl },
          ]);
        }
        setSelectedFile({ ...file, sourceUrl: sourceUrl ?? file.sourceUrl });
        setColumnStats(cached.stats);
        setSampleRows(cached.sample);
        const recs = recommend(cached.stats, cached.sample, file.name);
        setChartRecs(recs);
        setActiveChart(recs.length > 0 ? recs[0] : null);
        setViewMode("chart");
        leaveSourcesShowChart();
        setToast(`Opened ${file.name}`);
        return;
      }
      if (sourceUrl) {
        await handleLoadRemoteCsv(sourceUrl, file.name);
        return;
      }
      if (file.path.startsWith("mock://")) {
        handleUseDemoData();
        leaveSourcesShowChart();
        return;
      }
      // Dead recent (local upload or pre-sourceUrl catalog) — prune so it stops teasing.
      const pruned = state.recentFiles.filter((f) => f.path !== file.path);
      useLoomStore.getState().setRecentFiles(pruned);
      setToast("That recent file can’t be reopened here — Explore it again from Data & sources.");
      return;
    }

    const parent = file.path.includes("/") ? file.path.replace(/\/[^/]+$/, "") : "";
    if (mountedFolder === parent && files.some((f) => f.path === file.path)) {
      await handleSelectFile(file);
      return;
    }
    if (!parent) {
      setToast("Can’t reopen that path — mount the folder again.");
      return;
    }
    setMountedFolder(parent);
    setIsScanning(true);
    try {
      const result = await scanFolder(parent);
      setFiles(result);
      const found = result.find((f) => f.path === file.path);
      if (found) await handleSelectFile(found);
      else setToast("File not found in that folder.");
    } catch (e) {
      console.error("Open recent failed:", e);
      setToast("Couldn’t reopen that file. Mount the folder again.");
    } finally {
      setIsScanning(false);
    }
    } finally {
      setOpeningRecentPath(null);
    }
  }

  async function handleSelectFile(file: FileEntry) {
    setSelectedFile(file);
    setInspectingFilePath(file.path);
    setColumnStats([]);
    setSampleRows(null);
    addRecentFile(file);
    if (isMobile && sidebarOpen) toggleSidebar();
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
        setLastSession({ folderPath: "web://", filePath: firstEntry.path, viewMode: "chart" });
        const first = cache[firstEntry.path];
        if (first) {
          setColumnStats(first.stats);
          setSampleRows(first.sample);
          const recs = recommend(first.stats, first.sample, firstEntry.name);
          setChartRecs(recs);
          setActiveChart(recs.length > 0 ? recs[0] : null);
        }
        setViewMode("chart");
        setDataRegionOpen(false);
        setDataSourcesExpanded(false);
        setToast(`Exploring ${firstEntry.name}`);
      }
    } catch (err) {
      console.error("Load files failed:", err);
    } finally {
      setIsScanning(false);
      e.target.value = "";
    }
  }

  /**
   * Web-only: pull a remote CSV through the Worker proxy into the in-browser file cache.
   * `rowLimit` is the row cap baked into the URL (Socrata `$limit`) so the toast can say
   * "first N rows" honestly when the portal has more.
   */
  async function handleLoadRemoteCsv(url: string, filename: string, opts?: { rowLimit?: number }) {
    const safeName = (filename || "dataset.csv").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const name = safeName.toLowerCase().endsWith(".csv") ? safeName : `${safeName}.csv`;
    setIsScanning(true);
    try {
      const { text, truncated } = await fetchCsvTextWeb(url);
      const path = `web://${name}`;
      const inspect = parseCsvToInspectResult(name, text);
      const rowCount = inspect.sample.total_rows ?? inspect.sample.rows.length;
      const entry: FileEntry = {
        path,
        name,
        extension: "csv",
        row_count: rowCount,
        size_bytes: text.length,
        sourceUrl: url,
      };
      const prev = useLoomStore.getState();
      const cache = { ...prev.webFileCache, [path]: inspect };
      setWebFileCache(cache);
      setMountedFolder("web://");
      const nextFiles = [
        ...prev.files.filter((f) => f.path.startsWith("web://") && f.path !== path),
        entry,
      ];
      setFiles(nextFiles);
      setSelectedFile(entry);
      addRecentFile(entry);
      setLastSession({ folderPath: "web://", filePath: path, viewMode: "chart" });
      setColumnStats(inspect.stats);
      setSampleRows(inspect.sample);
      const recs = recommend(inspect.stats, inspect.sample, name);
      setChartRecs(recs);
      setActiveChart(recs.length > 0 ? recs[0] : null);
      setViewMode("chart");
      leaveSourcesShowChart();
      const kept = inspect.sample.rows.length;
      const hitRowLimit = opts?.rowLimit != null && rowCount >= opts.rowLimit;
      setToast(
        truncated || kept < rowCount
          ? `Exploring ${name} — first ${kept.toLocaleString()} rows${kept < rowCount ? ` of ${rowCount.toLocaleString()}` : " (file was large)"}`
          : hitRowLimit
            ? `Exploring ${name} — first ${kept.toLocaleString()} rows (the portal has more)`
            : `Exploring ${name} — ${rowCount.toLocaleString()} rows`,
      );
    } catch (e) {
      setToast(ipcErrorMessage(e) || "Failed to load CSV in browser");
    } finally {
      setIsScanning(false);
    }
  }

  if (!sidebarOpen) return null;

  const width = dataSourcesExpanded ? undefined : (dataRegionOpen ? DATA_REGION_WIDTH : SIDEBAR_WIDTH);
  // Closing the phone drawer must also leave the full-screen sources mode —
  // otherwise <main> stays collapsed to width 0 behind a closed drawer.
  const closeDrawer = () => {
    if (dataSourcesExpanded) setDataSourcesExpanded(false);
    toggleSidebar();
  };
  const folderName = mountedFolder?.split("/").pop() ?? null;

  return (
    <>
      {isMobile && (
        <button
          type="button"
          className="fixed inset-0 z-[35] loom-overlay animate-fade-in md:hidden"
          aria-label="Close sidebar"
          onClick={closeDrawer}
        />
      )}
      <aside
        className={`flex flex-col h-full border-r border-loom-border bg-loom-surface overflow-hidden transition-[width] duration-200 ease-out
          ${dataSourcesExpanded ? "flex-1 min-w-0 max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-full" : "flex-shrink-0"}
          ${!dataSourcesExpanded ? "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[min(100vw-2.5rem,20rem)] max-md:shadow-loom-lg" : ""}
          md:relative md:shadow-none`}
        style={{
          ...(width !== undefined && !(isMobile && !dataSourcesExpanded) ? { width: `${width}px` } : {}),
          paddingBottom: "var(--safe-bottom)",
          paddingLeft: isMobile ? "var(--safe-left)" : undefined,
          paddingTop: isMobile ? "var(--safe-top)" : undefined,
        }}
      >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 h-[var(--topbar-height)] border-b border-loom-border flex-shrink-0 bg-loom-surface/95">
        <div className="w-2 h-2 rounded-full bg-loom-accent shadow-[0_0_0_3px] shadow-loom-accent/20 animate-pulse-subtle" />
        <span className="text-sm font-semibold text-loom-text tracking-tight flex-1">Loom</span>
        <button
          type="button"
          onClick={requestWhatsNew}
          className="text-2xs text-loom-muted hover:text-loom-accent px-2 min-h-9 rounded-md"
          title="Recent features and fixes"
        >
          What’s new
        </button>
        <button
          type="button"
          className="md:hidden loom-btn-ghost min-h-10 min-w-10 flex items-center justify-center text-loom-muted text-lg rounded-md"
          onClick={closeDrawer}
          aria-label="Close sidebar"
        >
          ×
        </button>
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
          isWeb={isWebEnv}
          onLoadRemoteCsv={handleLoadRemoteCsv}
          onLoadFiles={handleLoadFiles}
          onUseDemoData={handleUseDemoData}
          fileInputRef={fileInputRef}
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
          openingRecentPath={openingRecentPath}
          fileSearchQuery={fileSearchQuery}
          onFileSearchChange={setFileSearchQuery}
        />
      )}
    </aside>
    </>
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

// --- Wikipedia Live Stream Section ---

function WikiStreamSection() {
  const {
    streamRunning, streamTotalEvents, streamEventsPerSec, streamBufferRows,
    streamWikisSeen, streamUptimeSecs,
    setStreamStatus, setStreamActive, setSelectedFile, setColumnStats,
    setSampleRows, setChartRecs, setActiveChart, setVegaSpec, setToast,
  } = useLoomStore();
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await streamStatus();
        setStreamStatus(s);
      } catch { /* ignore */ }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await streamStart();
      startPolling();
      setToast("Connected to Wikipedia live stream");
    } catch (e) {
      setToast(`Stream failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    stopPolling();
    try {
      await streamStop();
      setStreamStatus({ running: false, total_events: 0, events_per_sec: 0, buffer_rows: streamBufferRows, wikis_seen: streamWikisSeen, started_at: null, uptime_secs: 0 });
      setToast("Stream stopped");
    } catch { /* ignore */ }
  };

  const handleLoadSnapshot = async () => {
    try {
      const snap = await streamSnapshot(500);
      if (!snap.sample.rows.length) {
        setToast("No Wikipedia events yet — wait a second and try Explore again");
        return;
      }
      const streamFile = { path: "stream://wiki", name: "Wikipedia Live", extension: "stream", row_count: snap.sample.total_rows, size_bytes: 0 };
      setSelectedFile(streamFile);
      setColumnStats(snap.stats);
      setSampleRows(snap.sample);
      setStreamActive(true);

      const story = recommendStreamStory(snap.stats, snap.sample);
      const recs = story.charts;
      setChartRecs(recs);
      if (recs.length > 0) {
        setActiveChart(recs[0]);
      } else {
        setActiveChart(null);
        setVegaSpec(null);
      }
      leaveSourcesShowChart();
      setToast(`Loaded ${snap.sample.rows.length} stream events`);
    } catch (e) {
      setToast(`Failed to load snapshot: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleClear = async () => {
    try {
      await streamClear();
      setStreamStatus({ running: streamRunning, total_events: streamTotalEvents, events_per_sec: streamEventsPerSec, buffer_rows: 0, wikis_seen: 0, started_at: streamRunning ? (useLoomStore.getState().streamStartedAt) : null, uptime_secs: streamUptimeSecs });
      setToast("Stream buffer cleared");
    } catch { /* ignore */ }
  };

  const formatUptime = (secs: number) => {
    if (secs < 60) return `${Math.round(secs)}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  };

  return (
    <div className="border border-loom-border rounded-md p-3 space-y-2.5 bg-loom-surface/40">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${streamRunning ? "bg-loom-success animate-pulse" : "bg-loom-muted"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-loom-text leading-tight">Wikipedia</p>
            <p className="text-2xs text-loom-muted">Recent changes · real-time</p>
          </div>
          {!streamRunning ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50 shrink-0"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-error/50 bg-loom-error/10 text-loom-error hover:bg-loom-error/20 font-medium shrink-0"
            >
              Stop
            </button>
          )}
        </div>

        {streamRunning && (
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-loom-border/60">
            <div>
              <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">{streamEventsPerSec.toFixed(1)}</p>
              <p className="text-2xs text-loom-muted">events/s</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">{streamBufferRows.toLocaleString()}</p>
              <p className="text-2xs text-loom-muted">buffered</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-loom-text font-mono tabular-nums">{streamWikisSeen}</p>
              <p className="text-2xs text-loom-muted">wikis</p>
            </div>
          </div>
        )}

        {streamRunning && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-loom-muted">{formatUptime(streamUptimeSecs)} · {streamTotalEvents.toLocaleString()} total</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={handleClear} className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated">
                Clear
              </button>
              <button type="button" onClick={handleLoadSnapshot} disabled={streamBufferRows === 0}
                className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50">
                Explore
              </button>
            </div>
          </div>
        )}

        {!streamRunning && streamBufferRows > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-2xs text-loom-muted">{streamBufferRows.toLocaleString()} rows ready</span>
            <button type="button" onClick={handleLoadSnapshot}
              className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium">
              Explore
            </button>
          </div>
        )}
      </div>
  );
}

// --- Data & Sources (slide-in region) ---

// --- Generic Source Card — every poll source in sourceRegistry.ts ---

/** One-click public CSV packs (web Explore / desktop save). */
const CURATED_OPEN_PACKS: {
  id: string;
  title: string;
  blurb: string;
  url: string;
  source: string;
}[] = [
  {
    id: "owid-co2-per-capita",
    title: "CO₂ emissions per person",
    blurb: "Every country since 1750 — the classic climate-inequality chart.",
    url: "https://ourworldindata.org/grapher/co-emissions-per-capita.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Global Carbon Project",
  },
  {
    id: "owid-life-expectancy",
    title: "Life expectancy",
    blurb: "Two centuries of longer lives, country by country.",
    url: "https://ourworldindata.org/grapher/life-expectancy.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / UN WPP",
  },
  {
    id: "owid-gdp-per-capita",
    title: "GDP per person",
    blurb: "Income by country since 1990, with world regions for color.",
    url: "https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / World Bank",
  },
  {
    id: "owid-renewables",
    title: "Renewable electricity share",
    blurb: "How fast each country's grid is going green.",
    url: "https://ourworldindata.org/grapher/share-electricity-renewables.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / Ember",
  },
  {
    id: "owid-population",
    title: "Population since 10,000 BCE",
    blurb: "Country and world population over the long run.",
    url: "https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=true",
    source: "Our World in Data / HYDE / UN",
  },
  {
    id: "keeling-curve",
    title: "Keeling curve (Mauna Loa CO₂)",
    blurb: "Monthly atmospheric CO₂ since 1958 — the sawtooth that keeps climbing.",
    url: "https://raw.githubusercontent.com/datasets/co2-ppm/main/data/co2-mm-mlo.csv",
    source: "NOAA GML via datahub",
  },
  {
    id: "nasa-exoplanets",
    title: "Every confirmed exoplanet",
    blurb: "~6,000 planets — size, mass, orbit, distance, and how they were found.",
    url: "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,disc_year,discoverymethod,pl_rade,pl_bmasse,pl_orbper,sy_dist+from+pscomppars&format=csv",
    source: "NASA Exoplanet Archive",
  },
  {
    id: "power-plants",
    title: "Global power plants",
    blurb: "35,000 plants on a map — capacity and fuel for every country.",
    url: "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
    source: "World Resources Institute",
  },
  {
    id: "gapminder",
    title: "Gapminder: wealth & health",
    blurb: "142 countries, 1952–2007 — life expectancy, GDP per person, population, continent. The classic bubble chart.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/gapminderDataFiveYear.csv",
    source: "Gapminder via plotly/datasets",
  },
  {
    id: "quakes-m7",
    title: "Every M7+ earthquake since 1900",
    blurb: "1,600 great earthquakes — magnitude, depth, and location on a century-long timeline.",
    url: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=1900-01-01&minmagnitude=7&orderby=time-asc",
    source: "USGS ComCat",
  },
  {
    id: "nobel-laureates",
    title: "Nobel Prize laureates",
    blurb: "Every laureate since 1901 — category, year, birthplace, gender, and prize share.",
    url: "https://api.nobelprize.org/2.1/laureates?limit=1500&format=csv",
    source: "Nobel Prize API",
  },
  {
    id: "candy-ranking",
    title: "The ultimate candy ranking",
    blurb: "85 candies — chocolate? fruity? sugar, price, and how often each won head-to-head.",
    url: "https://raw.githubusercontent.com/fivethirtyeight/data/master/candy-power-ranking/candy-data.csv",
    source: "FiveThirtyEight",
  },
  {
    id: "us-cities",
    title: "US cities by population",
    blurb: "Largest US cities with coordinates — instant bubble map.",
    url: "https://raw.githubusercontent.com/plotly/datasets/master/2014_us_cities.csv",
    source: "US Census via plotly/datasets",
  },
];

function SectionHeading({
  title,
  lede,
  meta,
}: {
  title: string;
  lede?: string;
  meta?: string;
}) {
  return (
    <div className="px-1 mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-loom-text tracking-tight">{title}</h3>
        {meta && <span className="text-2xs text-loom-muted tabular-nums shrink-0">{meta}</span>}
      </div>
      {lede && <p className="text-2xs text-loom-muted mt-0.5 leading-snug max-w-[36ch]">{lede}</p>}
    </div>
  );
}
function SourceCard({ def }: { def: SourceDef }) {
  const {
    sourceStatuses, setSourceStatus,
    setSelectedFile, setColumnStats, setSampleRows,
    setChartRecs, setActiveChart, setVegaSpec,
    setToast, setStreamActive, addRecentFile, setLastSession,
  } = useLoomStore();
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const status = sourceStatuses[def.kind];
  const running = status?.running ?? false;
  const bufferRows = status?.buffer_rows ?? 0;

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await sourceStatus(def.kind);
        setSourceStatus(def.kind, s);
      } catch { /* ignore */ }
    }, 3000);
  };

  const handleExplore = async (opts?: { quiet?: boolean }) => {
    try {
      const snap = await sourceSnapshot(def.kind, SOURCE_EXPLORE_ROWS);
      if (!snap.sample.rows.length) {
        if (!opts?.quiet) setToast(`${def.label} has no rows yet — wait a moment`);
        return false;
      }
      const file = {
        path: sourceStreamPath(def.kind),
        name: def.fileName,
        extension: "stream",
        row_count: snap.sample.total_rows,
        size_bytes: 0,
      };
      setSelectedFile(file);
      addRecentFile(file);
      setLastSession({ folderPath: "web://", filePath: sourceStreamPath(def.kind), viewMode: "chart" });
      setColumnStats(snap.stats);
      setSampleRows(snap.sample);
      setStreamActive(true);
      const story = recommendSourceStory(def.kind, snap.stats, snap.sample);
      const recs = story.charts;
      setChartRecs(recs);
      setActiveChart(recs.length > 0 ? recs[0] : null);
      if (recs.length === 0) setVegaSpec(null);
      leaveSourcesShowChart();
      setToast(`Loaded ${snap.sample.rows.length} ${def.label} rows`);
      return true;
    } catch (e) {
      if (!opts?.quiet) setToast(`Failed: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await sourceStart(def.kind);
      const s = await sourceStatus(def.kind);
      setSourceStatus(def.kind, s);
      startPolling();
      // Snapshot feeds (HN, crypto, …) fill on first poll — jump straight to chart.
      if (s.buffer_rows > 0) {
        const opened = await handleExplore({ quiet: true });
        if (opened) return;
      }
      setToast(
        s.last_error
          ? `${def.label} is unavailable right now — Loom will keep retrying`
          : `Connected to ${def.label} — tap Explore when rows appear`,
      );
    } catch (e) {
      setToast(`${def.label} failed: ${e instanceof Error ? e.message : e}`);
    } finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try {
      await sourceStop(def.kind);
      setSourceStatus(def.kind, { running: false, total_events: 0, events_per_sec: 0, buffer_rows: bufferRows, started_at: null, uptime_secs: 0 });
      setToast(`${def.label} stopped`);
    } catch { /* ignore */ }
  };

  const handleClear = async () => {
    try {
      await sourceClear(def.kind);
      setSourceStatus(def.kind, { ...(status ?? { running: false, total_events: 0, events_per_sec: 0, buffer_rows: 0, started_at: null, uptime_secs: 0 }), buffer_rows: 0 });
      setToast(`${def.label} cleared`);
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-loom-border rounded-md p-3 space-y-2 bg-loom-surface/40">
      <div className="flex items-start gap-2">
        <span className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${running ? "bg-loom-accent animate-pulse" : "bg-loom-muted"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-loom-text leading-tight">{def.label}</p>
          <p className="text-2xs text-loom-muted mt-0.5 leading-snug">{def.description}</p>
        </div>
        {!running ? (
          <button type="button" onClick={handleConnect} disabled={connecting}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50 shrink-0">
            {connecting ? "Loading…" : "Connect"}
          </button>
        ) : (
          <button type="button" onClick={handleDisconnect}
            className="text-2xs py-1 px-2.5 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-error/50 bg-loom-error/10 text-loom-error hover:bg-loom-error/20 font-medium shrink-0">
            Stop
          </button>
        )}
      </div>
      {running && (
        <div className="flex items-center justify-between pl-4">
          <span className="text-2xs text-loom-muted tabular-nums">{(status?.total_events ?? 0).toLocaleString()} rows</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={handleClear} className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-border text-loom-muted hover:text-loom-text hover:bg-loom-elevated">Clear</button>
            <button type="button" onClick={() => void handleExplore()} disabled={bufferRows === 0}
              className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium disabled:opacity-50">
              Explore
            </button>
          </div>
        </div>
      )}
      {running && status?.last_error && (
        <p className="text-2xs text-loom-warning pl-4 leading-snug" role="status">
          {bufferRows > 0 ? "Showing the last good data — " : "Source unavailable right now — "}
          retrying automatically.
          <span className="block text-loom-muted/80 truncate" title={status.last_error}>{status.last_error}</span>
        </p>
      )}
      {!running && bufferRows > 0 && (
        <div className="flex items-center justify-between pl-4">
          <span className="text-2xs text-loom-muted tabular-nums">{bufferRows.toLocaleString()} rows ready</span>
          <button type="button" onClick={() => void handleExplore()}
            className="text-2xs py-0.5 px-2 max-md:min-h-9 max-md:px-3 max-md:text-xs rounded border border-loom-accent/50 bg-loom-accent/10 text-loom-accent hover:bg-loom-accent/20 font-medium">
            Explore
          </button>
        </div>
      )}
      {def.attribution && (
        <a
          href={def.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-2xs text-loom-muted/70 hover:text-loom-accent pl-4 w-fit"
        >
          {def.attribution}
        </a>
      )}
    </div>
  );
}

const DATA_GOV_ROW_OPTIONS = [40, 80, 120, 200] as const;

const DATA_GOV_SORT_OPTIONS: { value: DataGovSortKey; label: string }[] = [
  { value: "newest", label: "Newest listed" },
  { value: "updated", label: "Recently updated" },
  { value: "relevance", label: "Relevance" },
  { value: "title_az", label: "Title A–Z" },
  { value: "title_za", label: "Title Z–A" },
];

function filterDatasetsLocal(datasets: DataGovDataset[], text: string): DataGovDataset[] {
  const q = text.trim().toLowerCase();
  if (!q) return datasets;
  return datasets.filter((d) => {
    const hay = `${d.title} ${d.organization ?? ""} ${d.name}`.toLowerCase();
    return hay.includes(q);
  });
}

function exploreFilename(ds: DataGovDataset, res: { name: string }): string {
  const base = res.name !== "CSV" ? res.name : ds.title;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return cleaned.toLowerCase().endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

/** Discovery card — web puts Explore first so grab→chart feels like desktop open. */
function DiscoverDatasetCard({
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
      <div className="min-w-0 flex-1">
        {ds.organization && (
          <p className="text-2xs text-loom-muted truncate mb-0.5" title={ds.organization}>{ds.organization}</p>
        )}
        <p className="text-sm font-medium text-loom-text leading-snug line-clamp-2">{ds.title}</p>
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

function CkanDiscoverToolbar({
  queryDraft,
  onQueryDraftChange,
  onSearch,
  sort,
  onSortChange,
  rowLimit,
  onRowLimitChange,
  localFilter,
  onLocalFilterChange,
  loading,
}: {
  queryDraft: string;
  onQueryDraftChange: (s: string) => void;
  onSearch: () => void;
  sort: DataGovSortKey;
  onSortChange: (s: DataGovSortKey) => void;
  rowLimit: (typeof DATA_GOV_ROW_OPTIONS)[number];
  onRowLimitChange: (n: (typeof DATA_GOV_ROW_OPTIONS)[number]) => void;
  localFilter: string;
  onLocalFilterChange: (s: string) => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-2 px-1 mb-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
        className="space-y-0.5"
      >
        <label className="text-2xs text-loom-muted">Search catalog</label>
        <div className="flex gap-1.5 mt-0.5">
          <input
            type="search"
            value={queryDraft}
            onChange={(e) => onQueryDraftChange(e.target.value)}
            placeholder="Keywords, agency, topic…"
            className="loom-input flex-1 min-w-0 text-xs py-1.5"
            disabled={loading}
            enterKeyHint="search"
          />
          <button type="submit" className="loom-btn-primary text-2xs px-2.5 py-1.5 shrink-0" disabled={loading}>
            Search
          </button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="min-w-0 flex-1 sm:flex-initial">
          <label className="text-2xs text-loom-muted block mb-0.5">Sort</label>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as DataGovSortKey)}
            className="loom-input w-full sm:w-[11rem] text-xs py-1.5"
            disabled={loading}
          >
            {DATA_GOV_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-2xs text-loom-muted block mb-0.5">Max results</label>
          <select
            value={rowLimit}
            onChange={(e) => onRowLimitChange(Number(e.target.value) as (typeof DATA_GOV_ROW_OPTIONS)[number])}
            className="loom-input text-xs py-1.5 w-full sm:w-[5.5rem]"
            disabled={loading}
          >
            {DATA_GOV_ROW_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="text-2xs text-loom-muted">Filter this page</label>
        <input
          type="search"
          value={localFilter}
          onChange={(e) => onLocalFilterChange(e.target.value)}
          placeholder="Match title or publisher (instant)"
          className="loom-input w-full text-xs py-1.5 mt-0.5"
        />
      </div>
    </div>
  );
}

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
  isWeb,
  onLoadRemoteCsv,
  onLoadFiles,
  onUseDemoData,
  fileInputRef,
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
  onLoadRemoteCsv: (url: string, filename: string, opts?: { rowLimit?: number }) => Promise<void>;
  onLoadFiles?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUseDemoData?: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
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
  const [previewDataset, setPreviewDataset] = useState<DataGovDataset | null>(null);
  const isTauriEnv = isTauri();

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
        setDataGovDatasets(datasets);
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
        if (!cancelled) setUkDatasets(datasets);
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

  async function handleLoadCsv(url: string, filename: string, resourceId: string, opts?: { rowLimit?: number }) {
    setLoadingId(resourceId);
    try {
      await onLoadRemoteCsv(url, filename, opts);
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
        {/* Web leads with one-tap fun data (discover, live feeds, curated packs);
            desktop leads with the local folder. Order is set per section below. */}
        <section style={{ order: isWeb ? 0 : -1 }}>
          <button
            type="button"
            onClick={() => requestDiscoverScan()}
            className="loom-btn-primary w-full min-h-11 text-sm font-semibold rounded-lg"
          >
            ✦ What’s interesting right now
          </button>
          <p className="text-2xs text-loom-muted mt-1.5 text-center">Scans every live feed and opens the best one as a chart.</p>
        </section>

        {/* Get data in — web: upload / explore; desktop: folder */}
        <section style={{ order: isWeb ? 3 : 0 }}>
          <SectionHeading
            title={isWeb ? "Open files" : "Local folder"}
            lede={isWeb ? "Drop CSVs here, or Explore a catalog dataset below." : "Mount a folder of CSV / Parquet files."}
          />
          <div className="space-y-2">
            {isWeb ? (
              <>
                <input
                  ref={fileInputRef}
                  id="loom-web-csv-files-data-region"
                  type="file"
                  accept=".csv"
                  multiple
                  className="sr-only"
                  onChange={onLoadFiles}
                />
                <label
                  htmlFor="loom-web-csv-files-data-region"
                  className={`loom-btn-primary w-full text-xs flex items-center justify-center cursor-pointer ${isScanning ? "pointer-events-none opacity-60" : ""}`}
                >
                  {isScanning ? "Loading…" : "Open CSVs from this device"}
                </label>
                {onUseDemoData && (
                  <button type="button" onClick={onUseDemoData} className="loom-btn-ghost w-full text-xs">
                    Try demo data
                  </button>
                )}
                {filesCount > 0 && (
                  <div className="flex items-center justify-between gap-2 px-1 pt-1">
                    <p className="text-2xs text-loom-muted">Loaded in this browser</p>
                    <span className="loom-badge flex-shrink-0">{filesCount}</span>
                  </div>
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

        {/* Live feeds */}
        <section className="space-y-2.5" style={{ order: isWeb ? 1 : 6 }}>
          <SectionHeading
            title="Live feeds"
            lede="Connect a feed, let it fill, then Explore into Chart."
          />
          <WikiStreamSection />
          {(Object.keys(SOURCE_GROUP_LABELS) as SourceGroup[]).map((group) => (
            <div key={group} className="space-y-2.5">
              <h4 className="text-2xs font-medium uppercase tracking-wide text-loom-muted pt-1">
                {SOURCE_GROUP_LABELS[group]}
              </h4>
              {SOURCE_DEFS.filter((d) => d.group === group).map((def) => (
                <SourceCard key={def.kind} def={def} />
              ))}
            </div>
          ))}
        </section>

        {/* Curated CSV packs — one-click Explore */}
        <section className="space-y-2.5" style={{ order: isWeb ? 2 : 7 }}>
          <SectionHeading
            title="Curated open packs"
            lede="Famous public CSVs — Explore loads them straight into Chart."
          />
          <ul className="space-y-2">
            {CURATED_OPEN_PACKS.map((pack) => (
              <li
                key={pack.id}
                className="border border-loom-border rounded-lg p-2.5 bg-loom-surface/50 space-y-1.5"
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
                      onClick={() => void handleLoadCsv(pack.url, `${pack.id}.csv`, pack.id)}
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
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* TidyTuesday + Socrata city/state search — same order slot as the
            curated packs, so they follow them in DOM order. */}
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
  openingRecentPath,
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
  openingRecentPath?: string | null;
  fileSearchQuery?: string;
  onFileSearchChange?: (q: string) => void;
}) {
  return (
    <>
      <div className="px-3 py-3 border-b border-loom-border flex-shrink-0">
        {isWeb && (
          <button
            type="button"
            onClick={() => requestDiscoverScan()}
            className="loom-btn-primary w-full text-xs mb-2"
            title="Scan live feeds for something chartable"
          >
            ✦ What’s interesting right now
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDataRegion}
          className="loom-btn-ghost w-full text-xs flex items-center justify-center gap-1.5 border border-loom-border"
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
                id="loom-web-csv-files"
                type="file"
                accept=".csv"
                multiple
                className="sr-only"
                onChange={onLoadFiles}
              />
              <label
                htmlFor="loom-web-csv-files"
                className={`loom-btn-ghost w-full text-xs flex items-center justify-center cursor-pointer ${isScanning ? "pointer-events-none opacity-60" : ""}`}
              >
                {isScanning ? "Loading…" : "Load your own CSVs"}
              </label>
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
          <ul className="space-y-0.5 max-h-36 overflow-y-auto">
            {recentFiles.slice(0, 8).map((f) => {
              const canReopen =
                Boolean(f.sourceUrl) ||
                f.path.startsWith("stream://") ||
                f.path.startsWith("mock://") ||
                (!f.path.startsWith("web://") && f.path.includes("/"));
              const busy = openingRecentPath === f.path || (isScanning && selectedFile?.path === f.path);
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    disabled={Boolean(openingRecentPath) || isScanning}
                    onClick={() => void onOpenRecentFile(f)}
                    className={`w-full text-left text-xs truncate px-2 py-2 min-h-9 rounded border border-transparent
                      ${canReopen ? "text-loom-text hover:bg-loom-elevated hover:border-loom-border" : "text-loom-muted hover:bg-loom-elevated"}
                      disabled:opacity-60`}
                    title={
                      canReopen
                        ? f.sourceUrl || f.path
                        : "May need to Explore again from Data & sources (no saved URL)"
                    }
                  >
                    {busy ? "Opening… " : ""}
                    {f.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {files.length === 0 && !isScanning && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-loom-muted">{isWeb ? "Nothing open yet" : "No data files found"}</p>
            <p className="text-xs text-loom-muted mt-1">
              {isWeb ? "Try a live feed or curated pack in " : "Mount a folder or open "}
              <button type="button" onClick={onOpenDataRegion} className="text-loom-accent hover:underline">Data & sources</button>
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

      <div className="max-md:hidden flex items-center justify-between px-3 h-[var(--statusbar-height)] border-t border-loom-border text-2xs text-loom-muted font-mono flex-shrink-0">
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
      type="button"
      onClick={onSelect}
      disabled={isInspecting}
      aria-current={isSelected ? "true" : undefined}
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
        <p className="text-xs font-medium text-loom-text truncate" title={file.name}>{file.name}</p>
        <p className="text-2xs text-loom-muted font-mono">
          {isInspecting ? "Loading…" : `${formatNumber(file.row_count)} rows · ${formatBytes(file.size_bytes)}`}
        </p>
      </div>
    </button>
  );
}
