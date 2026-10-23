import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllWebFileInspects,
  getWebFileInspect,
  putWebFileInspect,
} from "../webFileStore";
import { DATA_LIBRARY_KEY } from "../dataLibrary";

beforeEach(async () => {
  localStorage.clear();
  await clearAllWebFileInspects();
});
describe("bookmarked uploads", () => {
  it("evicts unpinned entries while retaining an older recipe input and bookmarked file", async () => {
    const file = {
      path: "web://file/0.csv",
      name: "Lookup",
      extension: "csv",
      row_count: 1,
      size_bytes: 1,
    };
    const asset = { ref: `file:${file.path}`, name: file.name, file };
    localStorage.setItem(
      DATA_LIBRARY_KEY,
      JSON.stringify({
        v: 1,
        data: {
          assets: [],
          combinations: [
            {
              id: "join",
              name: "Join",
              left: asset,
              right: { ref: "feed:usgs", name: "Quakes" },
              leftKey: "id",
              rightKey: "id",
              mode: "left",
              createdAt: 1,
            },
          ],
        },
      }),
    );
    localStorage.setItem(
      "loom-source-preferences",
      JSON.stringify({
        v: 1,
        data: {
          version: 1,
          entries: { "file:web://file/1.csv": { saved: true, savedAt: 1 } },
        },
      }),
    );
    for (let i = 0; i < 27; i++)
      await putWebFileInspect({
        path: `web://file/${i}.csv`,
        name: `${i}.csv`,
        extension: "csv",
        sizeBytes: 1,
        stats: [],
        sample: {
          columns: ["id"],
          types: ["VARCHAR"],
          rows: [["A"]],
          total_rows: 1,
        },
        updatedAt: i + 1,
      });
    expect(await getWebFileInspect("web://file/0.csv")).not.toBeNull();
    expect(await getWebFileInspect("web://file/1.csv")).not.toBeNull();
    expect(await getWebFileInspect("web://file/2.csv")).toBeNull();
    expect(await getWebFileInspect("web://file/26.csv")).not.toBeNull();
  });
});
