import { describe, expect, it, vi } from "vitest";
import { bumpWebHydrationUserAction, stagedHydrateWebFileCache } from "../webHydration";
import { useLoomStore } from "../store";

vi.mock("../webFileStore", () => ({
  loadWebFileIndex: vi.fn(async () => [
    {
      path: "web://file/a.csv",
      name: "a.csv",
      extension: "csv",
      row_count: 1,
      size_bytes: 10,
      updatedAt: 1,
    },
    {
      path: "web://file/b.csv",
      name: "b.csv",
      extension: "csv",
      row_count: 1,
      size_bytes: 10,
      updatedAt: 2,
    },
  ]),
  loadWebFileInspectPayload: vi.fn(async (path: string) => ({
    stats: [],
    sample: {
      columns: ["x"],
      types: ["VARCHAR"],
      rows: [[path]],
      total_rows: 1,
    },
  })),
}));

describe("webHydration", () => {
  it("applies file index before samples", async () => {
    const order: string[] = [];
    await stagedHydrateWebFileCache({
      onIndex() {
        order.push("index");
      },
      onSample() {
        order.push("sample");
      },
    });
    expect(order[0]).toBe("index");
    expect(order.filter((x) => x === "sample").length).toBe(2);
  });

  it("stops sample hydration after a user action", async () => {
    const samples: string[] = [];
    const p = stagedHydrateWebFileCache({
      onIndex() {
        bumpWebHydrationUserAction();
      },
      onSample(path) {
        samples.push(path);
      },
    });
    await p;
    expect(samples).toHaveLength(0);
  });

  it("beginWebImport keeps only the latest operation active", () => {
    const first = useLoomStore.getState().beginWebImport();
    const second = useLoomStore.getState().beginWebImport();
    expect(useLoomStore.getState().isActiveWebImport(first)).toBe(false);
    expect(useLoomStore.getState().isActiveWebImport(second)).toBe(true);
  });
});
