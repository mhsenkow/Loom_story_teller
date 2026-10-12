// =================================================================
// Loom — Linked folder sync reconciliation (LOOM-255)
// =================================================================
// Compares a fresh directory scan to cached vault entries by stable
// relative path + file metadata. Removed files stay in IndexedDB until
// the user clears them explicitly.
// =================================================================

import { webFileDisplayName, webFileStablePathFromFile } from "./webFileIdentity";

export type LinkedFileFingerprint = {
  stablePath: string;
  displayName: string;
  size: number;
  lastModified: number;
};

export type LinkedFolderReconcileSummary = {
  added: LinkedFileFingerprint[];
  modified: LinkedFileFingerprint[];
  unchanged: LinkedFileFingerprint[];
  /** Present in Loom cache but missing from the linked folder scan. */
  removedFromFolder: LinkedFileFingerprint[];
};

export function fingerprintLinkedFile(file: File): LinkedFileFingerprint {
  return {
    stablePath: webFileStablePathFromFile(file),
    displayName: webFileDisplayName(webFileStablePathFromFile(file)),
    size: file.size,
    lastModified: file.lastModified,
  };
}

export function formatLinkedFolderReconcileToast(summary: LinkedFolderReconcileSummary, folderLabel: string): string {
  const parts: string[] = [];
  if (summary.added.length) parts.push(`${summary.added.length} new`);
  if (summary.modified.length) parts.push(`${summary.modified.length} updated`);
  if (summary.unchanged.length) parts.push(`${summary.unchanged.length} unchanged`);
  if (summary.removedFromFolder.length) {
    parts.push(
      `${summary.removedFromFolder.length} removed from folder (kept in Loom)`,
    );
  }
  if (!parts.length) return `Synced “${folderLabel}” — no file changes`;
  return `Synced “${folderLabel}” · ${parts.join(", ")}`;
}

/** Match scanned files to prior vault rows; never implies cache deletion. */
export function reconcileLinkedFolder(
  scannedFiles: File[],
  prior: LinkedFileFingerprint[],
): LinkedFolderReconcileSummary {
  const scanMap = new Map<string, LinkedFileFingerprint>();
  for (const file of scannedFiles) {
    const fp = fingerprintLinkedFile(file);
    scanMap.set(fp.stablePath, fp);
  }
  const priorMap = new Map(prior.map((p) => [p.stablePath, p]));

  const added: LinkedFileFingerprint[] = [];
  const modified: LinkedFileFingerprint[] = [];
  const unchanged: LinkedFileFingerprint[] = [];
  const removedFromFolder: LinkedFileFingerprint[] = [];

  for (const fp of scanMap.values()) {
    const old = priorMap.get(fp.stablePath);
    if (!old) {
      added.push(fp);
      continue;
    }
    if (old.size !== fp.size || old.lastModified !== fp.lastModified) modified.push(fp);
    else unchanged.push(fp);
  }

  for (const fp of priorMap.values()) {
    if (!scanMap.has(fp.stablePath)) removedFromFolder.push(fp);
  }

  return { added, modified, unchanged, removedFromFolder };
}
