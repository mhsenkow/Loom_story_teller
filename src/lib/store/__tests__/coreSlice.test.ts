// =================================================================
// coreSlice tests
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../../store";
import type { FileEntry, ColumnInfo, QueryResult } from "../../store";

function getState() { return useLoomStore.getState(); }

beforeEach(() => { getState().reset(); });

describe("coreSlice", () => {
  it("setMountedFolder updates folder path", () => {
    getState().setMountedFolder("/data");
    expect(getState().mountedFolder).toBe("/data");
    getState().setMountedFolder(null);
    expect(getState().mountedFolder).toBeNull();
  });

  it("setFiles replaces files list", () => {
    const files: FileEntry[] = [
      { path: "/a.csv", name: "a.csv", extension: "csv", row_count: 10, size_bytes: 100 },
    ];
    getState().setFiles(files);
    expect(getState().files).toHaveLength(1);
  });

  it("setViewMode cycles through modes", () => {
    getState().setViewMode("chart");
    expect(getState().viewMode).toBe("chart");
    getState().setViewMode("query");
    expect(getState().viewMode).toBe("query");
    getState().setViewMode("dive");
    expect(getState().viewMode).toBe("dive");
  });

  it("toggleSidebar flips sidebarOpen", () => {
    const initial = getState().sidebarOpen;
    getState().toggleSidebar();
    expect(getState().sidebarOpen).toBe(!initial);
    getState().toggleSidebar();
    expect(getState().sidebarOpen).toBe(initial);
  });

  it("openDataset resets dataset-scoped state", () => {
    const file: FileEntry = { path: "/a.csv", name: "a.csv", extension: "csv", row_count: 10, size_bytes: 100 };
    getState().openDataset({ file, sample: { columns: ["x"], types: ["DOUBLE"], rows: [[1]], total_rows: 1 } });
    getState().setTableColumnFilters({ x: "1" });
    getState().setLassoPoints([{ x: 0, y: 0 }]);

    const file2: FileEntry = { path: "/b.csv", name: "b.csv", extension: "csv", row_count: 5, size_bytes: 50 };
    getState().openDataset({ file: file2, sample: { columns: ["y"], types: ["DOUBLE"], rows: [[2]], total_rows: 1 } });

    expect(getState().selectedFile?.path).toBe("/b.csv");
    expect(getState().tableColumnFilters).toEqual({});
    expect(getState().lassoPoints).toEqual([]);
  });

  it("setPanelTab updates panel tab", () => {
    getState().setPanelTab("smart");
    expect(getState().panelTab).toBe("smart");
  });
});
