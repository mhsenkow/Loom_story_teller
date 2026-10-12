"use client";

import type { ChangeEvent, RefObject } from "react";
import { extensionIcon, formatBytes, formatNumber } from "@/lib/format";
import type { FileEntry } from "@/lib/store";
import { requestDiscoverScan } from "@/lib/discoverStories";
import { WEB_FILE_ACCEPT, WEB_FILE_ACCEPT_LABEL } from "@/lib/webFormats";
import { WEB_VAULT_LABEL, isWebVaultPath, type LinkedFolderMeta, type LinkedFolderScanProgress } from "@/lib/webDataFolder";

export function FilesView({
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
  recentFiles,
  lastSession,
  onReopenSession,
  onOpenRecentFile,
  onRemoveRecentFile,
  onClearRecentFiles,
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
  onLoadFiles?: (e: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  onUseDemoData?: () => void;
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
  recentFiles?: FileEntry[];
  lastSession?: { folderPath: string | null; filePath: string | null; viewMode: string } | null;
  onReopenSession?: () => void;
  onOpenRecentFile?: (f: FileEntry) => void;
  onRemoveRecentFile?: (f: FileEntry) => void;
  onClearRecentFiles?: () => void;
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
            Find something fun to chart
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
              <div className="rounded-md border border-loom-border/80 bg-loom-surface/40 px-2 py-1.5 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-loom-accent text-xs shrink-0" aria-hidden>
                    &#x25CF;
                  </span>
                  <span className="text-xs font-medium text-loom-text truncate">
                    {folderName ?? WEB_VAULT_LABEL}
                  </span>
                  <span className="loom-badge ml-auto shrink-0 tabular-nums">
                    {webVaultFileCount ?? 0}
                  </span>
                </div>
                {linkedMeta ? (
                  <p className="text-[10px] text-loom-muted mt-0.5 truncate pl-3.5" title={linkedMeta.displayName}>
                    ↔ {linkedMeta.displayName}
                  </p>
                ) : (
                  <p className="text-[10px] text-loom-muted mt-0.5 pl-3.5">On this device</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                id="loom-web-csv-files"
                type="file"
                accept={WEB_FILE_ACCEPT}
                multiple
                className="sr-only"
                onChange={onLoadFiles}
              />
              <label
                htmlFor="loom-web-csv-files"
                className={`loom-btn-ghost w-full text-xs min-h-9 flex items-center justify-center cursor-pointer ${isScanning ? "pointer-events-none opacity-60" : ""}`}
                title={WEB_FILE_ACCEPT_LABEL}
              >
                {isScanning ? "Loading…" : "Add to my folder"}
              </label>
              {onLinkDeviceFolder && !linkedMeta && (
                <button
                  type="button"
                  onClick={onLinkDeviceFolder}
                  disabled={isScanning}
                  className="loom-btn-ghost w-full text-xs mt-1.5 min-h-9"
                >
                  Link a folder
                </button>
              )}
              {onResyncLinkedFolder && (
                <button
                  type="button"
                  onClick={onResyncLinkedFolder}
                  disabled={isScanning}
                  className="loom-btn-ghost w-full text-xs mt-1.5 min-h-9"
                >
                  Sync folder
                </button>
              )}
              {onPickWebFolder && !onLinkDeviceFolder && (
                <button
                  type="button"
                  onClick={onPickWebFolder}
                  disabled={isScanning}
                  className="loom-btn-ghost w-full text-xs mt-1.5"
                >
                  Choose folder
                </button>
              )}
              {onUrlImportChange && onOpenFromUrl && (
                <div className="flex gap-1 mt-2">
                  <input
                    type="url"
                    value={urlImport ?? ""}
                    onChange={(e) => onUrlImportChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpenFromUrl();
                    }}
                    placeholder="URL…"
                    className="loom-input flex-1 min-w-0 text-2xs py-1 px-1.5"
                    aria-label="Add from URL"
                  />
                  <button
                    type="button"
                    onClick={onOpenFromUrl}
                    disabled={isScanning || !(urlImport ?? "").trim()}
                    className="loom-btn-ghost text-2xs px-1.5 shrink-0"
                  >
                    Add
                  </button>
                </div>
              )}
              {onUseDemoData && (
                <button
                  type="button"
                  onClick={onUseDemoData}
                  className="loom-btn-ghost w-full text-xs mt-2"
                >
                  Use demo data
                </button>
              )}
              {onUnlinkDeviceFolder && (
                <button
                  type="button"
                  onClick={onUnlinkDeviceFolder}
                  className="w-full text-[10px] text-loom-muted hover:text-loom-accent mt-1.5 py-1"
                >
                  Unlink device folder
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
        {!isWeb && folderName && (
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
        {lastSession?.folderPath && !isWebVaultPath(lastSession.folderPath) && !lastSession.folderPath.startsWith("mock://") && onReopenSession && (
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-2xs font-semibold text-loom-muted uppercase tracking-wider">Recent</p>
            {onClearRecentFiles && (
              <button
                type="button"
                onClick={onClearRecentFiles}
                disabled={Boolean(openingRecentPath) || isScanning}
                className="text-2xs text-loom-muted hover:text-loom-accent disabled:opacity-50"
              >
                Clear recent
              </button>
            )}
          </div>
          <ul className="space-y-0.5 max-h-36 overflow-y-auto">
            {recentFiles.slice(0, 8).map((f) => {
              const canReopen =
                Boolean(f.sourceUrl) ||
                f.path.startsWith("stream://") ||
                f.path.startsWith("mock://") ||
                f.path.startsWith("web://") ||
                f.path.includes("/");
              const busy = openingRecentPath === f.path || (isScanning && selectedFile?.path === f.path);
              return (
                <li key={f.path} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={Boolean(openingRecentPath) || isScanning}
                    onClick={() => void onOpenRecentFile(f)}
                    className={`min-w-0 flex-1 text-left text-xs truncate px-2 py-2 min-h-9 rounded border border-transparent
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
                  {onRemoveRecentFile && (
                    <button
                      type="button"
                      onClick={() => onRemoveRecentFile(f)}
                      disabled={Boolean(openingRecentPath) || isScanning}
                      className="shrink-0 min-h-9 px-2 rounded border border-transparent text-2xs text-loom-muted hover:text-loom-text hover:border-loom-border hover:bg-loom-elevated disabled:opacity-50"
                      aria-label={`Remove ${f.name} from Recent`}
                      title={`Remove ${f.name} from Recent`}
                    >
                      Remove
                    </button>
                  )}
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
