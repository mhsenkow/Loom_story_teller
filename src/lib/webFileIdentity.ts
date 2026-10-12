// =================================================================
// Loom — Stable browser file paths (cache keys vs display names)
// =================================================================
// Linked folders can contain the same basename in different subfolders;
// uploads use an opaque web://file/… key separate from the sidebar label.
// =================================================================

export const WEB_FILE_STABLE_PREFIX = "web://file/";

/** Opaque persisted path from a relative path or upload basename. */
export function webFileStablePath(relativePathOrName: string): string {
  const normalized = relativePathOrName.replace(/\\/g, "/").replace(/^\/+/, "");
  const encoded = normalized
    .split("/")
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${WEB_FILE_STABLE_PREFIX}${encoded}`;
}

/** Human label for sidebar / Recent (may include subfolders). */
export function webFileDisplayName(stableOrLegacyPath: string): string {
  if (stableOrLegacyPath.startsWith(WEB_FILE_STABLE_PREFIX)) {
    const rest = stableOrLegacyPath.slice(WEB_FILE_STABLE_PREFIX.length);
    try {
      return rest.split("/").map((seg) => decodeURIComponent(seg)).join("/");
    } catch {
      return rest;
    }
  }
  if (stableOrLegacyPath.startsWith("web://")) {
    return stableOrLegacyPath.slice("web://".length);
  }
  return stableOrLegacyPath;
}

/** Legacy upload key (pre–LOOM-250); used for IndexedDB / Recent lookup fallbacks. */
export function legacyWebUploadPath(basename: string): string {
  return `web://${basename}`;
}

/** Stable key for a browser File (name may be a linked relative path). */
export function webFileStablePathFromFile(file: File): string {
  return webFileStablePath(file.name);
}

/** Resolve storage path: prefer stable key, fall back to legacy web://name. */
export function webFileStoragePathCandidates(pathOrName: string): string[] {
  if (pathOrName.startsWith(WEB_FILE_STABLE_PREFIX)) return [pathOrName];
  if (pathOrName.startsWith("web://")) {
    const name = pathOrName.slice("web://".length);
    return [webFileStablePath(name), pathOrName];
  }
  const stable = webFileStablePath(pathOrName);
  return [stable, legacyWebUploadPath(pathOrName.split(/[/\\]/).pop() ?? pathOrName)];
}
