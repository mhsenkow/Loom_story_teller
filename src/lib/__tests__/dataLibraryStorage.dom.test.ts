import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllWebFileInspects,
  deleteWebFileInspect,
  getWebFileInspect,
  putWebFileInspect,
  resetWebFileRaceStateForTests,
} from "../webFileStore";
import { DATA_LIBRARY_KEY } from "../dataLibrary";

beforeEach(async () => {
  localStorage.clear();
  await clearAllWebFileInspects();
  resetWebFileRaceStateForTests();
});
describe("bookmarked uploads", () => {
  it.each(["full", "ref-only", "legacy-ref", "broken-preferences", "broken-library"])("retains protected uploads during eviction (%s)", async (scenario) => {
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
              left: scenario === "legacy-ref"
                ? { ref: "file:web://0.csv", name: asset.name }
                : scenario === "ref-only" ? { ref: asset.ref, name: asset.name } : asset,
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
    if (scenario === "broken-preferences")
      localStorage.setItem("loom-source-preferences", "{broken");
    if (scenario === "broken-library")
      localStorage.setItem(DATA_LIBRARY_KEY, "{broken");
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
    if (scenario !== "broken-library")
      expect(await getWebFileInspect("web://file/0.csv")).not.toBeNull();
    if (scenario !== "broken-preferences")
      expect(await getWebFileInspect("web://file/1.csv")).not.toBeNull();
    expect(await getWebFileInspect("web://file/2.csv")).toBeNull();
    expect(await getWebFileInspect("web://file/26.csv")).not.toBeNull();
  });
  it("blocks a late save under the stable alias after deleting a legacy path", async () => {
    const entry = {
      path: "web://file/late.csv",
      name: "late.csv",
      extension: "csv",
      sizeBytes: 1,
      stats: [],
      sample: { columns: ["id"], types: ["INTEGER"], rows: [[1]], total_rows: 1 },
      updatedAt: 1,
      revision: 1,
    };
    await putWebFileInspect(entry);
    await deleteWebFileInspect("web://late.csv");
    await putWebFileInspect(entry);
    expect(await getWebFileInspect(entry.path)).toBeNull();
    await putWebFileInspect({ ...entry, revision: undefined, updatedAt: Date.now() + 1 });
    expect(await getWebFileInspect(entry.path)).not.toBeNull();
  });
  it("blocks a late save of the legacy path after deleting the stable key", async () => {
    const stable = {
      path: "web://file/late.csv",
      name: "late.csv",
      extension: "csv",
      sizeBytes: 1,
      stats: [],
      sample: { columns: ["id"], types: ["INTEGER"], rows: [[1]], total_rows: 1 },
      updatedAt: 1,
      revision: 1,
    };
    await putWebFileInspect(stable);
    await deleteWebFileInspect(stable.path);
    await putWebFileInspect({ ...stable, path: "web://late.csv", revision: 1 });
    expect(await getWebFileInspect(stable.path)).toBeNull();
    expect(await getWebFileInspect("web://late.csv")).toBeNull();
  });
});
