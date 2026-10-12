// IndexedDB + localStorage harness for DOM storage tests (LOOM-601).
import "fake-indexeddb/auto";
import { vi } from "vitest";

const memoryStorage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memoryStorage.set(k, v);
  },
  removeItem: (k: string) => {
    memoryStorage.delete(k);
  },
  clear: () => memoryStorage.clear(),
  length: 0,
  key: () => null,
});

export function resetDomStorageHarness(): void {
  memoryStorage.clear();
}
