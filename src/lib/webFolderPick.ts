// =================================================================
// Loom — Browser folder / multi-file pick (File System Access API)
// =================================================================
// Chromium: showDirectoryPicker → recursive File objects.
// Elsewhere: callers fall back to <input type="file" multiple>.
// =================================================================

import { isSupportedWebUpload } from "./webFormats";

export function canPickDirectory(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function canPickFilesNative(): boolean {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

async function collectFromDir(
  dir: FileSystemDirectoryHandle,
  out: File[],
  prefix = "",
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") {
      if (!isSupportedWebUpload(name)) continue;
      const file = await handle.getFile();
      out.push(
        new File([file], name, {
          type: file.type,
          lastModified: file.lastModified,
        }),
      );
    } else if (handle.kind === "directory" && !prefix) {
      // One level of subfolders — keeps phone memory sane
      await collectFromDir(handle, out, name);
    }
  }
}

/** Returns supported files from a user-chosen folder, or null if cancelled / unsupported. */
export async function pickWebDirectoryFiles(): Promise<File[] | null> {
  const pick = typeof window !== "undefined" ? window.showDirectoryPicker : undefined;
  if (!pick) return null;
  try {
    const dir = await pick({ mode: "read" });
    const files: File[] = [];
    await collectFromDir(dir, files);
    return files;
  } catch (e) {
    // AbortError = user cancelled
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}
