import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPersistedAppSettings,
  getRecentFiles,
  safeSetItem,
  setPersistedAppSettings,
  setPersistedRecentFiles,
  getCustomChartLooks,
  setPersistedCustomChartLooks,
} from "../persist";

describe("safeSetItem", () => {
  const memory = new Map<string, string>();

  afterEach(() => {
    memory.clear();
    vi.unstubAllGlobals();
  });

  it("returns false when setItem throws QuotaExceededError", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
        getItem: () => null,
        removeItem: () => {},
      },
    });
    expect(safeSetItem("loom-test", "x".repeat(100))).toBe(false);
  });

  it("returns true on success", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        getItem: (k: string) => memory.get(k) ?? null,
        removeItem: (k: string) => {
          memory.delete(k);
        },
      },
    });
    expect(safeSetItem("loom-test-ok", "hello")).toBe(true);
  });

  it("round-trips app settings and recent files", () => {
    vi.stubGlobal("window", {
      localStorage: {
        store: {} as Record<string, string>,
        setItem(k: string, v: string) {
          this.store[k] = v;
        },
        getItem(k: string) {
          return this.store[k] ?? null;
        },
        removeItem(k: string) {
          delete this.store[k];
        },
      },
    });
    expect(setPersistedAppSettings({ theme: "dark", fontScale: 1, themePairing: true, font: "source-serif" })).toBe(true);
    expect(getPersistedAppSettings()).toMatchObject({ theme: "dark", fontScale: 1, themePairing: true, font: "source-serif" });
    setPersistedRecentFiles([
      { path: "web://a.csv", name: "a.csv", extension: "csv", row_count: 1, size_bytes: 10 },
    ]);
    expect(getRecentFiles()[0]?.name).toBe("a.csv");
    setPersistedCustomChartLooks([{ id: "look", name: "Calm", overrides: { opacity: 0.5 }, updatedAt: 100 }]);
    expect(getCustomChartLooks()).toEqual([{ id: "look", name: "Calm", overrides: { opacity: 0.5 }, updatedAt: 100 }]);
  });

  it("returns null settings on corrupt JSON", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "{not json",
        setItem: () => {},
        removeItem: () => {},
      },
    });
    expect(getPersistedAppSettings()).toBeNull();
  });
});
