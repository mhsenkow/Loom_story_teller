"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useSidebarOverlays } from "@/lib/useMediaQuery";
import { useLoomStore, type FileEntry } from "@/lib/store";
import { pickFolder, scanFolder, inspectFile, isDesktop, fetchCsvTextWeb, streamStart, streamSnapshot, sourceStart, sourceSnapshot, type SourceKind } from "@/lib/tauri";
import { getRecentFiles as getPersistedRecentFiles } from "@/lib/persist";
import { activateDataset } from "@/lib/datasetPipeline";
import { formatWebImportError } from "@/lib/webImportUi";
import { getMockFiles } from "@/lib/mock-data";
import { SOURCE_EXPLORE_ROWS } from "@/lib/sourceRegistry";
import { WEB_FILE_ACCEPT_LABEL, isSupportedWebUpload, resolveWebFormat } from "@/lib/webFormats";
import { ingestWebBytes, ingestWebFile, WebIngestAbortedError, type WebInspect } from "@/lib/webIngest";
import { webFileDisplayName, webFileStablePathFromFile, WEB_FILE_STABLE_PREFIX } from "@/lib/webFileIdentity";
import { bumpWebHydrationUserAction } from "@/lib/webHydration";
import { getWebFileInspect, putWebFileInspect } from "@/lib/webFileStore";
import { canPickDirectory, pickWebDirectoryFiles } from "@/lib/webFolderPick";
import { WEB_VAULT_LABEL, WEB_VAULT_PATH, canLinkDeviceFolder, clearLinkedDirectory, ensureLinkedFolderPermission, getLinkedFolderMeta, isWebVaultPath, linkedFolderPermissionState, linkDeviceDataFolder, loadLinkedDirectoryHandle, resyncLinkedDataFolder, webVaultDisplayName, type LinkedFolderMeta, type LinkedFolderScanProgress } from "@/lib/webDataFolder";
import { reconcileLinkedFolder, formatLinkedFolderReconcileToast, type LinkedFileFingerprint } from "@/lib/linkedFolderReconcile";
import { formatWebBatchImportToast } from "@/lib/webBatchImport";
import { ipcErrorMessage, leaveSourcesShowChart } from "./shared";
import {
  LOOM_LOAD_CSV_EVENT,
  LOOM_OPEN_RECENT_EVENT,
  type LoomLoadCsvDetail,
  type LoomOpenRecentDetail,
} from "@/lib/loomDatasetEvents";

export function useSidebarController() {
  const {
    mountedFolder, files, isScanning, selectedFile, inspectingFilePath, sidebarOpen, dataRegionOpen, dataSourcesExpanded,
    setMountedFolder, setFiles, setIsScanning, setInspectingFilePath,
    openDataset,
    setDataRegionOpen, setDataSourcesExpanded, webFileCache, setWebFileCache,
    addRecentFile, setLastSession, viewMode, recentFiles, lastSession, setViewMode,
    setToast, toggleSidebar, beginWebImport, isActiveWebImport, removeRecentFile, clearRecentFiles,
  } = useLoomStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webImportAbortRef = useRef<AbortController | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [openingRecentPath, setOpeningRecentPath] = useState<string | null>(null);
  const [urlImport, setUrlImport] = useState("");
  const [folderPickSupported, setFolderPickSupported] = useState(false);
  const [linkFolderSupported, setLinkFolderSupported] = useState(false);
  const [linkedMeta, setLinkedMeta] = useState<LinkedFolderMeta | null>(null);
  const [folderScan, setFolderScan] = useState<LinkedFolderScanProgress | null>(null);
  const [linkedAccessBlocked, setLinkedAccessBlocked] = useState(false);
  const folderScanAbortRef = useRef<AbortController | null>(null);
  // Only show web vs Tauri UI after mount so server and first client render match (avoids hydration mismatch).
  const [mounted, setMounted] = useState(false);
  const sidebarOverlays = useSidebarOverlays();
  const sidebarPanelRef = useRef<HTMLElement>(null);

  useFocusTrap(sidebarPanelRef, sidebarOpen && sidebarOverlays);

  useEffect(() => {
    if (!sidebarOpen || !sidebarOverlays) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const s = useLoomStore.getState();
        if (s.dataSourcesExpanded) s.setDataSourcesExpanded(false);
        if (s.sidebarOpen) s.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sidebarOpen, sidebarOverlays]);

  const filteredFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return files;
    const q = fileSearchQuery.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(q));
  }, [files, fileSearchQuery]);
  useEffect(() => {
    setMounted(true);
    setFolderPickSupported(canPickDirectory());
    setLinkFolderSupported(canLinkDeviceFolder());
    setLinkedMeta(getLinkedFolderMeta());
  }, []);
  const isWebEnv = !mounted || !isDesktop();

  function ingestDiagnosticsNote(inspect: WebInspect): string | null {
    const parts: string[] = [];
    const nd = inspect.ndjsonDiagnostics;
    if (nd) {
      const skipped = nd.lines_skipped_malformed + nd.lines_skipped_non_object;
      if (skipped > 0) parts.push(`NDJSON skipped ${skipped} line(s)`);
      if (nd.incomplete_final_line) parts.push("incomplete last line");
    }
    const inc = inspect.tabularDiagnostics?.incompatible_count ?? 0;
    if (inc > 0) parts.push(`${inc} mixed-type cell(s)`);
    return parts.length ? parts.join("; ") : null;
  }

  function startBrowserImport(): { importId: number; signal: AbortSignal } {
    bumpWebHydrationUserAction();
    webImportAbortRef.current?.abort();
    const ac = new AbortController();
    webImportAbortRef.current = ac;
    const importId = beginWebImport();
    return { importId, signal: ac.signal };
  }

  async function commitWebInspect(
    entry: FileEntry,
    inspect: { stats: import("@/lib/store").ColumnInfo[]; sample: import("@/lib/store").QueryResult },
    opts?: { replaceCache?: boolean; importId?: number },
  ) {
    if (opts?.importId != null && !isActiveWebImport(opts.importId)) return;
    const prev = useLoomStore.getState();
    const cache = opts?.replaceCache
      ? { [entry.path]: inspect }
      : { ...prev.webFileCache, [entry.path]: inspect };
    setWebFileCache(cache);
    setMountedFolder(WEB_VAULT_PATH);
    const nextFiles = opts?.replaceCache
      ? [entry]
      : [...prev.files.filter((f) => f.path.startsWith("web://") && f.path !== entry.path), entry];
    setFiles(nextFiles);
    activateDataset({ file: entry, stats: inspect.stats, sample: inspect.sample, inspectingFilePath: null });
    addRecentFile(entry);
    setLastSession({ folderPath: WEB_VAULT_PATH, filePath: entry.path, viewMode: "chart" });
    setViewMode("chart");
    leaveSourcesShowChart();
    void putWebFileInspect({
      path: entry.path,
      name: entry.name,
      extension: entry.extension,
      sizeBytes: entry.size_bytes,
      stats: inspect.stats,
      sample: inspect.sample,
      updatedAt: Date.now(),
    });
  }

  async function ingestBrowserFiles(fileList: File[], opts?: { replaceCache?: boolean }) {
    const supported = fileList.filter((f) => isSupportedWebUpload(f.name));
    if (!supported.length) {
      setToast(`No supported files — try ${WEB_FILE_ACCEPT_LABEL}`);
      return;
    }
    const { importId, signal } = startBrowserImport();
    setIsScanning(true);
    try {
      const cache: Record<string, { stats: import("@/lib/store").ColumnInfo[]; sample: import("@/lib/store").QueryResult }> = {};
      const entries: FileEntry[] = [];
      const errors: string[] = [];
      const diagNotes: string[] = [];
      for (const file of supported) {
        if (!isActiveWebImport(importId)) break;
        try {
          const { inspect, extension } = await ingestWebFile(file, {
            signal,
            importId,
            isImportCurrent: isActiveWebImport,
          });
          if (!isActiveWebImport(importId)) break;
          const path = webFileStablePathFromFile(file);
          const displayName = webFileDisplayName(path);
          cache[path] = inspect;
          entries.push({
            path,
            name: displayName,
            extension,
            row_count: inspect.sample.total_rows ?? inspect.sample.rows.length,
            size_bytes: file.size,
            linkedLastModified: file.lastModified,
            originPath: file.name.includes("/") ? file.name : undefined,
          });
          const note = ingestDiagnosticsNote(inspect);
          if (note) diagNotes.push(`${displayName}: ${note}`);
          void putWebFileInspect({
            path,
            name: displayName,
            extension,
            sizeBytes: file.size,
            stats: inspect.stats,
            sample: inspect.sample,
            updatedAt: Date.now(),
          });
        } catch (err) {
          if (err instanceof WebIngestAbortedError) break;
          errors.push(`${file.name}: ${formatWebImportError(err)}`);
        }
      }
      if (!isActiveWebImport(importId)) return;
      if (!entries.length) {
        setToast(errors[0] ?? "Couldn’t load those files");
        return;
      }
      const prev = useLoomStore.getState();
      const mergedCache = opts?.replaceCache ? cache : { ...prev.webFileCache, ...cache };
      setWebFileCache(mergedCache);
      setMountedFolder(WEB_VAULT_PATH);
      const nextFiles = opts?.replaceCache
        ? entries
        : [
            ...prev.files.filter((f) => f.path.startsWith("web://") && !cache[f.path]),
            ...entries,
          ];
      setFiles(nextFiles);
      const firstEntry = entries[0]!;
      const first = cache[firstEntry.path]!;
      activateDataset({ file: firstEntry, stats: first.stats, sample: first.sample, inspectingFilePath: null });
      addRecentFile(firstEntry);
      setLastSession({ folderPath: WEB_VAULT_PATH, filePath: firstEntry.path, viewMode: "chart" });
      setViewMode("chart");
      leaveSourcesShowChart();
      const batchSummary = {
        loaded: entries.map((e) => ({ status: "loaded" as const, fileName: e.name, path: e.path })),
        failed: errors.map((msg) => {
          const fileName = msg.split(":")[0]?.trim() ?? "file";
          const error = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).trim() : msg;
          return { status: "failed" as const, fileName, error };
        }),
        skipped: [],
      };
      let toastMsg = formatWebBatchImportToast(batchSummary, WEB_VAULT_LABEL);
      if (diagNotes.length) toastMsg += ` — ${diagNotes[0]}`;
      setToast(toastMsg);
    } finally {
      setIsScanning(false);
      if (webImportAbortRef.current?.signal.aborted) webImportAbortRef.current = null;
    }
  }

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
    if (file.path.startsWith("web://")) {
      bumpWebHydrationUserAction();
      beginWebImport();
      webImportAbortRef.current?.abort();
    }
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
          activateDataset({
            file: { ...file, row_count: snap.sample.total_rows },
            stats: snap.stats,
            sample: snap.sample,
            shortlist: { type: "stream" },
          });
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
        activateDataset({
          file: { ...file, row_count: snap.sample.total_rows },
          stats: snap.stats,
          sample: snap.sample,
          shortlist: { type: "source", kind },
        });
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
          setMountedFolder(file.path.startsWith("mock://") ? "mock://demo-folder" : WEB_VAULT_PATH);
          setFiles([
            ...state.files.filter((f) => f.path !== file.path),
            { ...file, sourceUrl: sourceUrl ?? file.sourceUrl },
          ]);
        }
        activateDataset({
          file: { ...file, sourceUrl: sourceUrl ?? file.sourceUrl },
          stats: cached.stats,
          sample: cached.sample,
        });
        setViewMode("chart");
        leaveSourcesShowChart();
        setToast(`Opened ${file.name}`);
        return;
      }
      // Durable IndexedDB restore for local uploads after refresh
      if (file.path.startsWith("web://")) {
        const disk = await getWebFileInspect(file.path);
        if (disk) {
          const inspect = { stats: disk.stats, sample: disk.sample };
          setWebFileCache({ ...state.webFileCache, [file.path]: inspect });
          await commitWebInspect(
            {
              ...file,
              extension: disk.extension || file.extension,
              row_count: disk.sample.total_rows ?? disk.sample.rows.length,
              size_bytes: disk.sizeBytes || file.size_bytes,
              sourceUrl: sourceUrl ?? file.sourceUrl,
            },
            inspect,
          );
          setToast(`Reopened ${file.name}`);
          return;
        }
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
    if (file.path.startsWith("web://")) {
      bumpWebHydrationUserAction();
      beginWebImport();
      webImportAbortRef.current?.abort();
    }
    openDataset({
      file,
      stats: [],
      sample: null,
      chartRecs: [],
      activeChart: null,
      inspectingFilePath: file.path,
    });
    addRecentFile(file);
    if (sidebarOverlays && sidebarOpen) toggleSidebar();
    setLastSession({
      folderPath: mountedFolder,
      filePath: file.path,
      viewMode,
    });
    try {
      const cached = webFileCache[file.path];
      const result = cached ?? await inspectFile(file.path, 500);
      if (useLoomStore.getState().selectedFile?.path !== file.path) return;
      activateDataset({ file, stats: result.stats, sample: result.sample, inspectingFilePath: null });
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
    const demos = getMockFiles();
    setMountedFolder("mock://demo-folder");
    setFiles(demos);
    if (demos.length > 0) handleSelectFile(demos[0]);
  }

  async function handleLoadFiles(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected?.length) return;
    try {
      await ingestBrowserFiles(Array.from(selected));
    } catch (err) {
      console.error("Load files failed:", err);
      const msg = formatWebImportError(err);
      if (msg) setToast(msg);
    } finally {
      e.target.value = "";
    }
  }

  async function handlePickWebFolder() {
    try {
      const files = await pickWebDirectoryFiles();
      if (files == null) return;
      if (!files.length) {
        setToast(`No ${WEB_FILE_ACCEPT_LABEL} files in that folder`);
        return;
      }
      await ingestBrowserFiles(files);
    } catch (err) {
      console.error("Folder pick failed:", err);
      const msg = formatWebImportError(err);
      if (msg) setToast(msg);
    }
  }

  /** Link a real on-device folder as My Loom data (Chrome / Android) and keep re-syncing it. */
  async function handleReconnectLinkedFolder() {
    const handle = await loadLinkedDirectoryHandle();
    if (!handle) {
      setToast("No linked folder — use Link a folder first");
      return;
    }
    const ok = await ensureLinkedFolderPermission(handle, "read");
    if (!ok) {
      setLinkedAccessBlocked(true);
      setToast("Folder access denied — try again or import files manually");
      return;
    }
    setLinkedAccessBlocked(false);
    await handleResyncLinkedFolder();
  }

  async function handleLinkDeviceFolder() {
    try {
      folderScanAbortRef.current?.abort();
      folderScanAbortRef.current = new AbortController();
      setIsScanning(true);
      setFolderScan(null);
      const result = await linkDeviceDataFolder({
        signal: folderScanAbortRef.current.signal,
        onProgress: setFolderScan,
      });
      if (result == null) return;
      setLinkedMeta(result.meta);
      if (!result.files.length) {
        setMountedFolder(WEB_VAULT_PATH);
        setToast(`Linked “${result.meta.displayName}” — add ${WEB_FILE_ACCEPT_LABEL} files there, then Sync`);
        return;
      }
      await ingestBrowserFiles(result.files);
      setLinkedMeta(result.meta);
      setToast(`Linked “${result.meta.displayName}” · ${result.files.length} file${result.files.length === 1 ? "" : "s"} in ${WEB_VAULT_LABEL}`);
    } catch (err) {
      console.error("Link folder failed:", err);
      const msg = formatWebImportError(err);
      if (msg) setToast(msg);
    } finally {
      setIsScanning(false);
      setFolderScan(null);
      folderScanAbortRef.current = null;
    }
  }

  async function handleResyncLinkedFolder() {
    try {
      folderScanAbortRef.current?.abort();
      folderScanAbortRef.current = new AbortController();
      setIsScanning(true);
      setFolderScan(null);
      const handle = await loadLinkedDirectoryHandle();
      if (handle) {
        const perm = await linkedFolderPermissionState(handle, "read");
        if (perm.status === "denied") {
          setLinkedAccessBlocked(true);
          setToast("Folder access revoked — tap Reconnect folder");
          return;
        }
        setLinkedAccessBlocked(false);
      }
      const result = await resyncLinkedDataFolder({
        signal: folderScanAbortRef.current.signal,
        onProgress: setFolderScan,
      });
      if (!result) {
        setToast("No linked folder yet — tap Link a folder");
        return;
      }
      setLinkedMeta(result.meta);
      const prior: LinkedFileFingerprint[] = useLoomStore
        .getState()
        .files.filter((f) => f.path.startsWith(WEB_FILE_STABLE_PREFIX))
        .map((f) => ({
          stablePath: f.path,
          displayName: f.name,
          size: f.size_bytes,
          lastModified: f.linkedLastModified ?? 0,
        }));
      const summary = reconcileLinkedFolder(result.files, prior);
      const toIngest = result.files.filter((file) => {
        const path = webFileStablePathFromFile(file);
        return summary.added.some((a) => a.stablePath === path) || summary.modified.some((m) => m.stablePath === path);
      });
      if (!toIngest.length && !summary.removedFromFolder.length && summary.unchanged.length) {
        setToast(formatLinkedFolderReconcileToast(summary, result.meta.displayName));
        return;
      }
      if (toIngest.length) await ingestBrowserFiles(toIngest);
      setToast(formatLinkedFolderReconcileToast(summary, result.meta.displayName));
    } catch (err) {
      console.error("Resync failed:", err);
      const msg = formatWebImportError(err);
      if (msg) setToast(msg);
    } finally {
      setIsScanning(false);
      setFolderScan(null);
      folderScanAbortRef.current = null;
    }
  }

  function cancelFolderScan() {
    folderScanAbortRef.current?.abort();
    setIsScanning(false);
    setFolderScan(null);
    setToast("Folder scan cancelled");
  }

  async function handleUnlinkDeviceFolder() {
    await clearLinkedDirectory();
    setLinkedMeta(null);
    setToast("Unlinked device folder — files already in Loom stay in this browser");
  }

  async function handleOpenFromUrl() {
    const raw = urlImport.trim();
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      setToast("Paste a full http(s) URL");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      setToast("Only http(s) URLs are supported");
      return;
    }
    const pathPart = url.pathname.split("/").pop() || "dataset.csv";
    const nameGuess = pathPart.includes(".") ? pathPart : `${pathPart}.csv`;
    const fmt = resolveWebFormat(nameGuess);
    if (fmt && (fmt.id === "parquet" || fmt.id === "xlsx")) {
      setToast("Parquet / Excel from URL — download the file, then Open from this device");
      return;
    }
    await handleLoadRemoteCsv(url.toString(), nameGuess);
    setUrlImport("");
  }

  /**
   * Web-only: pull a remote CSV through the Worker proxy into the in-browser file cache.
   * `rowLimit` is the row cap baked into the URL (Socrata `$limit`) so the toast can say
   * "first N rows" honestly when the portal has more.
   */
  async function handleLoadRemoteCsv(
    url: string,
    filename: string,
    opts?: { rowLimit?: number; sourceCredit?: string; sourceHome?: string },
  ): Promise<boolean> {
    const safeName = (filename || "dataset.csv").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const name = safeName.toLowerCase().endsWith(".csv") ? safeName : `${safeName}.csv`;
    setIsScanning(true);
    try {
      const { text, truncated } = await fetchCsvTextWeb(url);
      const path = webFileStablePathFromFile(new File([], name));
      const { inspect, extension } = await ingestWebBytes(name, { text });
      const rowCount = inspect.sample.total_rows ?? inspect.sample.rows.length;
      const { guessHomepageFromDataUrl } = await import("@/lib/dataProvenance");
      const entry: FileEntry = {
        path,
        name,
        extension,
        row_count: rowCount,
        size_bytes: text.length,
        sourceUrl: url,
        sourceHome: opts?.sourceHome ?? guessHomepageFromDataUrl(url) ?? undefined,
        sourceCredit: opts?.sourceCredit,
      };
      await commitWebInspect(entry, inspect);
      const kept = inspect.sample.rows.length;
      const hitRowLimit = opts?.rowLimit != null && rowCount >= opts.rowLimit;
      setToast(
        truncated || kept < rowCount
          ? `Exploring ${name} — first ${kept.toLocaleString()} rows${kept < rowCount ? ` of ${rowCount.toLocaleString()}` : " (file was large)"}`
          : hitRowLimit
            ? `Exploring ${name} — first ${kept.toLocaleString()} rows (the portal has more)`
            : `Exploring ${name} — ${rowCount.toLocaleString()} rows`,
      );
      return true;
    } catch (e) {
      setToast(ipcErrorMessage(e) || "Failed to load CSV in browser");
      return false;
    } finally {
      setIsScanning(false);
    }
  }

  const folderName = isWebEnv
    ? webVaultDisplayName(mountedFolder ?? WEB_VAULT_PATH, linkedMeta) ?? WEB_VAULT_LABEL
    : mountedFolder?.split("/").pop() ?? null;
  const webVaultFileCount = files.filter((f) => f.path.startsWith("web://")).length;

  const openRecentRef = useRef(handleOpenRecentFile);
  openRecentRef.current = handleOpenRecentFile;
  const loadCsvRef = useRef(handleLoadRemoteCsv);
  loadCsvRef.current = handleLoadRemoteCsv;

  useEffect(() => {
    const onRecent = (e: Event) => {
      const detail = e instanceof CustomEvent ? (e.detail as LoomOpenRecentDetail | undefined) : undefined;
      if (!detail?.file) return;
      void openRecentRef.current(detail.file);
    };
    const onCsv = (e: Event) => {
      const detail = e instanceof CustomEvent ? (e.detail as LoomLoadCsvDetail | undefined) : undefined;
      if (!detail?.url) return;
      void loadCsvRef.current(detail.url, detail.filename, {
        rowLimit: detail.rowLimit,
        sourceCredit: detail.sourceCredit,
        sourceHome: detail.sourceHome,
      });
    };
    window.addEventListener(LOOM_OPEN_RECENT_EVENT, onRecent);
    window.addEventListener(LOOM_LOAD_CSV_EVENT, onCsv);
    return () => {
      window.removeEventListener(LOOM_OPEN_RECENT_EVENT, onRecent);
      window.removeEventListener(LOOM_LOAD_CSV_EVENT, onCsv);
    };
  }, []);

  const closeDrawer = () => {
    if (dataSourcesExpanded) setDataSourcesExpanded(false);
    toggleSidebar();
  };

  return {
    addRecentFile,
    beginWebImport,
    cancelFolderScan,
    clearRecentFiles,
    closeDrawer,
    dataRegionOpen,
    dataSourcesExpanded,
    fileInputRef,
    fileSearchQuery,
    files,
    filteredFiles,
    folderName,
    folderPickSupported,
    folderScan,
    handleLoadFiles,
    handleLoadRemoteCsv,
    handleLinkDeviceFolder,
    handleOpenFromUrl,
    handleOpenRecentFile,
    handlePickFolder,
    handlePickWebFolder,
    handleReconnectLinkedFolder,
    handleReopenSession,
    handleRescanFolder,
    handleResyncLinkedFolder,
    handleSelectFile,
    handleUnlinkDeviceFolder,
    handleUseDemoData,
    ingestBrowserFiles,
    inspectingFilePath,
    isScanning,
    isWebEnv,
    lastSession,
    linkFolderSupported,
    linkedAccessBlocked,
    linkedMeta,
    mountedFolder,
    openingRecentPath,
    recentFiles,
    removeRecentFile,
    selectedFile,
    setDataRegionOpen,
    setDataSourcesExpanded,
    setFileSearchQuery,
    setToast,
    setUrlImport,
    sidebarOpen,
    sidebarOverlays,
    sidebarPanelRef,
    toggleSidebar,
    urlImport,
    webVaultFileCount,
  };
}
