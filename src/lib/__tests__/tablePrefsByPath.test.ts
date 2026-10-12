// =================================================================
// Path-scoped table prefs (LOOM-205)
// =================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  },
});

describe("table prefs by path", () => {
  beforeEach(() => {
    store.clear();
  });

  it("keeps independent column setups per path", async () => {
    const { setTablePrefsForPath, getTablePrefsForPath } = await import("../persist");
    setTablePrefsForPath("/a.csv", { visibleColumns: ["id"], columnOrder: ["id"] });
    setTablePrefsForPath("/b.csv", { visibleColumns: ["name"], columnOrder: ["name", "id"] });
    expect(getTablePrefsForPath("/a.csv")).toEqual({
      visibleColumns: ["id"],
      columnOrder: ["id"],
    });
    expect(getTablePrefsForPath("/b.csv")).toEqual({
      visibleColumns: ["name"],
      columnOrder: ["name", "id"],
    });
  });

  it("migrates legacy flat prefs as fallback", async () => {
    store.set(
      "loom-table-prefs",
      JSON.stringify({ visibleColumns: ["x"], columnOrder: ["x", "y"] }),
    );
    const { getTablePrefsForPath } = await import("../persist");
    expect(getTablePrefsForPath("/any.csv")).toEqual({
      visibleColumns: ["x"],
      columnOrder: ["x", "y"],
    });
  });
});
