// =================================================================
// Sidebar — File Explorer + Data & Sources Region
// =================================================================

"use client";

import { requestHelp, requestWhatsNew } from "@/lib/changelog";
import { formatNumber } from "@/lib/format";
import { ShareTargetIngest } from "@/components/ShareTargetIngest";
import { DataRegionView } from "@/components/sidebar/DataRegionView";
import { FilesView } from "@/components/sidebar/FilesView";
import { useSidebarController } from "@/components/sidebar/useSidebarController";

const SIDEBAR_WIDTH = 260;
const DATA_REGION_WIDTH = 340;

export { CkanDiscoverToolbar } from "@/components/sidebar/CkanDiscoverToolbar";
export { DataRegionView } from "@/components/sidebar/DataRegionView";
export { DatasetPreviewModal } from "@/components/sidebar/DatasetPreviewModal";
export { DiscoverDatasetCard } from "@/components/sidebar/DiscoverDatasetCard";
export { FilesView } from "@/components/sidebar/FilesView";
export { SourceCard } from "@/components/sidebar/SourceCard";
export { WikiStreamSection } from "@/components/sidebar/WikiStreamSection";

export function Sidebar() {
  const {
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
    urlImport,
    webVaultFileCount,
  } = useSidebarController();

  if (!sidebarOpen) return null;

  const width = dataSourcesExpanded ? undefined : (dataRegionOpen ? DATA_REGION_WIDTH : SIDEBAR_WIDTH);
  // Closing the phone drawer must also leave the full-screen sources mode —
  // otherwise <main> stays collapsed to width 0 behind a closed drawer.
  return (
    <>
      <ShareTargetIngest onFiles={(picked) => void ingestBrowserFiles(picked)} />
      {sidebarOverlays && (
        <button
          type="button"
          className="fixed inset-0 z-[35] loom-overlay loom-shell-drawer-overlay animate-fade-in min-[1100px]:hidden"
          aria-label="Close sidebar"
          onClick={closeDrawer}
        />
      )}
      <aside
        ref={sidebarPanelRef}
        id="loom-sidebar"
        role={sidebarOverlays ? "dialog" : undefined}
        aria-modal={sidebarOverlays ? true : undefined}
        aria-label={sidebarOverlays ? "Data sidebar" : undefined}
        className={`flex flex-col h-full border-r border-loom-border bg-loom-surface overflow-hidden transition-[width] duration-200 ease-out
          ${dataSourcesExpanded ? "flex-1 min-w-0 max-[1099px]:fixed max-[1099px]:inset-0 max-[1099px]:z-40 max-[1099px]:w-full" : "flex-shrink-0"}
          ${!dataSourcesExpanded ? "max-[1099px]:fixed max-[1099px]:inset-y-0 max-[1099px]:left-0 max-[1099px]:z-40 max-[1099px]:w-[min(100vw-2.5rem,20rem)] max-[1099px]:shadow-loom-lg" : ""}
          min-[1100px]:relative min-[1100px]:shadow-none`}
        style={{
          ...(width !== undefined && !(sidebarOverlays && !dataSourcesExpanded) ? { width: `${width}px` } : {}),
          paddingBottom: "var(--safe-bottom)",
          paddingLeft: sidebarOverlays ? "var(--safe-left)" : undefined,
          paddingTop: sidebarOverlays ? "var(--safe-top)" : undefined,
        }}
      >
      {/* The library has its own unified masthead. */}
      {!dataRegionOpen && <div className="flex items-center gap-2.5 px-4 h-[var(--topbar-height)] border-b border-loom-border flex-shrink-0 bg-loom-surface/95">
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
          onClick={() => requestHelp()}
          className="min-[1100px]:hidden text-2xs text-loom-muted hover:text-loom-accent px-2 min-h-9 rounded-md font-mono"
          title="Help and gestures"
        >
          Help
        </button>
        <button
          type="button"
          className="min-[1100px]:hidden loom-btn-ghost min-h-10 min-w-10 flex items-center justify-center text-loom-muted text-lg rounded-md"
          onClick={closeDrawer}
          aria-label="Close sidebar"
        >
          ×
        </button>
      </div>}

      {dataRegionOpen ? (
        <DataRegionView
          onClose={closeDrawer}
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
          onPickWebFolder={folderPickSupported ? handlePickWebFolder : undefined}
          urlImport={urlImport}
          onUrlImportChange={setUrlImport}
          onOpenFromUrl={() => void handleOpenFromUrl()}
          linkedMeta={linkedMeta}
          onLinkDeviceFolder={linkFolderSupported ? () => void handleLinkDeviceFolder() : undefined}
          onResyncLinkedFolder={linkedMeta ? () => void handleResyncLinkedFolder() : undefined}
          onReconnectLinkedFolder={linkedMeta ? () => void handleReconnectLinkedFolder() : undefined}
          onCancelFolderScan={isScanning ? cancelFolderScan : undefined}
          folderScan={folderScan}
          linkedAccessBlocked={linkedAccessBlocked}
          onUnlinkDeviceFolder={linkedMeta ? () => void handleUnlinkDeviceFolder() : undefined}
          webVaultFileCount={webVaultFileCount}
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
          onOpenDataRegion={() => { setDataRegionOpen(true); setDataSourcesExpanded(true); }}
          formatNumber={formatNumber}
          isWeb={isWebEnv}
          onLoadFiles={handleLoadFiles}
          fileInputRef={fileInputRef}
          onUseDemoData={handleUseDemoData}
          onPickWebFolder={folderPickSupported ? handlePickWebFolder : undefined}
          urlImport={urlImport}
          onUrlImportChange={setUrlImport}
          onOpenFromUrl={() => void handleOpenFromUrl()}
          linkedMeta={linkedMeta}
          onLinkDeviceFolder={linkFolderSupported ? () => void handleLinkDeviceFolder() : undefined}
          onResyncLinkedFolder={linkedMeta ? () => void handleResyncLinkedFolder() : undefined}
          onReconnectLinkedFolder={linkedMeta ? () => void handleReconnectLinkedFolder() : undefined}
          onCancelFolderScan={isScanning ? cancelFolderScan : undefined}
          folderScan={folderScan}
          linkedAccessBlocked={linkedAccessBlocked}
          onUnlinkDeviceFolder={linkedMeta ? () => void handleUnlinkDeviceFolder() : undefined}
          webVaultFileCount={webVaultFileCount}
          recentFiles={recentFiles}
          lastSession={lastSession}
          onReopenSession={handleReopenSession}
          onOpenRecentFile={handleOpenRecentFile}
          onRemoveRecentFile={(file) => {
            removeRecentFile(file.path);
            setToast(`Removed ${file.name} from Recent`);
          }}
          onClearRecentFiles={() => {
            clearRecentFiles();
            setToast("Cleared Recent files");
          }}
          openingRecentPath={openingRecentPath}
          fileSearchQuery={fileSearchQuery}
          onFileSearchChange={setFileSearchQuery}
        />
      )}
    </aside>
    </>
  );
}
