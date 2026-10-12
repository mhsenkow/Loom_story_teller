// =================================================================
// uiSlice tests — settings, toast, recent files, stream status
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../../store";
import type { FileEntry } from "../types";

function getState() { return useLoomStore.getState(); }

beforeEach(() => { getState().reset(); });

describe("uiSlice", () => {
  it("setAppSettings with function updater", () => {
    getState().setAppSettings((prev) => ({ ...prev, theme: "light" }));
    expect(getState().appSettings.theme).toBe("light");
  });

  it("addRecentFile merges metadata", () => {
    const file: FileEntry = { path: "/x.csv", name: "x.csv", extension: "csv", row_count: 1, size_bytes: 1 };
    getState().addRecentFile(file);
    getState().addRecentFile({ ...file, row_count: 99 });
    expect(getState().recentFiles.filter((f) => f.path === "/x.csv")).toHaveLength(1);
    expect(getState().recentFiles[0]!.row_count).toBe(99);
  });

  it("removeRecentFile clears lastSession if matching", () => {
    getState().addRecentFile({ path: "/a.csv", name: "a.csv", extension: "csv", row_count: 1, size_bytes: 1 });
    getState().setLastSession({ folderPath: null, filePath: "/a.csv", viewMode: "explorer" });
    getState().removeRecentFile("/a.csv");
    expect(getState().lastSession).toBeNull();
  });

  it("setToast with undo flag", () => {
    getState().setToast("Deleted", { undo: true });
    expect(getState().toastMessage).toBe("Deleted");
    expect(getState().toastShowUndo).toBe(true);
    getState().setToast(null);
    expect(getState().toastMessage).toBeNull();
    expect(getState().toastShowUndo).toBe(false);
  });

  it("setStreamStatus updates all stream fields", () => {
    getState().setStreamStatus({ running: true, total_events: 100, events_per_sec: 5, buffer_rows: 50, wikis_seen: 3, started_at: 1000 });
    expect(getState().streamRunning).toBe(true);
    expect(getState().streamTotalEvents).toBe(100);
    expect(getState().streamWikisSeen).toBe(3);
  });

  it("setSourceStatus avoids update when unchanged", () => {
    const status = { running: true, total_events: 10, events_per_sec: 1, buffer_rows: 5, started_at: 1000 };
    getState().setSourceStatus("usgs", status);
    const snap1 = getState().sourceStatuses;
    getState().setSourceStatus("usgs", status);
    expect(getState().sourceStatuses).toBe(snap1);
  });

  it("beginWebImport increments id", () => {
    const id1 = getState().beginWebImport();
    const id2 = getState().beginWebImport();
    expect(id2).toBeGreaterThan(id1);
    expect(getState().isActiveWebImport(id2)).toBe(true);
    expect(getState().isActiveWebImport(id1)).toBe(false);
  });

  it("setSocialExportTarget sets and clears", () => {
    getState().setSocialExportTarget({ width: 1080, height: 1080, pixelRatio: 2, presetId: "ig-square" });
    expect(getState().socialExportTarget).not.toBeNull();
    getState().setSocialExportTarget(null);
    expect(getState().socialExportTarget).toBeNull();
  });
});
