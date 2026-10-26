import { describe, expect, it } from "vitest";
import {
  assetForFile,
  browseLibrary,
  combineData,
  COMBINATION_MAX_CELLS,
  DEFAULT_LIBRARY_BROWSE,
  emptyDataLibrary,
  libraryAssets,
  parseDataLibrary,
  pinnedLibraryPaths,
  type DataCombination,
} from "../dataLibrary";
import { feedRef } from "../sourceRef";
import type { QueryResult } from "../store";
import {
  buildWorkspaceBundle,
  parseWorkspaceBundle,
  mergeWorkspaceBundle,
} from "../workspaceBackup";

const data = (
  columns: string[],
  rows: QueryResult["rows"],
  total = rows.length,
): QueryResult => ({
  columns,
  rows,
  types: columns.map(() => "VARCHAR"),
  total_rows: total,
});
const a = assetForFile({
  path: "web://file/a.csv",
  name: "A",
  extension: "csv",
  row_count: 3,
  size_bytes: 10,
});
const b = assetForFile({
  path: "web://file/b.csv",
  name: "B",
  extension: "csv",
  row_count: 2,
  size_bytes: 10,
});
const recipe: DataCombination = {
  id: "test",
  name: "Combined",
  left: a,
  right: b,
  leftKey: "id",
  rightKey: "id",
  mode: "left",
  createdAt: 1,
};

describe("data library combinations", () => {
  it("keeps every primary row, prefixes field names, and reports unmatched/missing keys", () => {
    const left = data(
      ["id", "value"],
      [
        [" A ", 3],
        ["B", 8],
        [null, 2],
        ["C", 4],
      ],
    );
    const right = data(
      ["id", "value"],
      [
        ["A", 30],
        ["B", 80],
        [null, 99],
      ],
    );
    const result = combineData(left, right, "id", "id", "left");
    expect(result.sample.rows).toEqual([
      [" A ", 3, "A", 30],
      ["B", 8, "B", 80],
      [null, 2, null, null],
      ["C", 4, null, null],
    ]);
    expect(result.sample.columns).toEqual([
      "left_id",
      "left_value",
      "right_id",
      "right_value",
    ]);
    expect(result).toMatchObject({
      matched: 2,
      unmatched: 2,
      missingKeys: 1,
      unmatchedExamples: ["C"],
      partial: false,
    });
  });
  it("never multiplies primary rows for a duplicate lookup key", () => {
    expect(() =>
      combineData(
        data(["id"], [["A"]]),
        data(["id"], [["A"], [" A "]]),
        "id",
        "id",
        "left",
      ),
    ).toThrow(/repeats/);
  });
  it("does not fuzzy-match casing or leading zeros; numeric zero is a valid key", () => {
    const r = combineData(
      data(["id"], [[0], ["01"], ["a"], [""], [null]]),
      data(["id"], [["0"], [1], ["A"], [""]]),
      "id",
      "id",
      "inner",
    );
    expect(r.sample.rows).toEqual([[0, "0"]]);
    expect(r.missingKeys).toBe(2);
  });
  it("rejects schema drift and exposes partial source coverage", () => {
    expect(() =>
      combineData(
        data(["id"], [[1]]),
        data(["new_id"], [[1]]),
        "id",
        "id",
        "left",
      ),
    ).toThrow(/no longer/);
    expect(
      combineData(
        data(["id"], [[1]], 100),
        data(["id"], [[1]]),
        "id",
        "id",
        "left",
      ).partial,
    ).toBe(true);
  });
  it("bounds preview allocation", () => {
    expect(() =>
      combineData(
        data(
          ["id"],
          Array.from({ length: 500001 }, () => [1]),
        ),
        data(["id"], [[1]]),
        "id",
        "id",
        "left",
      ),
    ).toThrow(/too large/);
  });
  it("budgets inner joins by output rows, while still counting every unmatched input", () => {
    const columns = ["id", ...Array.from({ length: 99 }, (_, i) => `value_${i}`)];
    const count = Math.floor(COMBINATION_MAX_CELLS / (columns.length + 1));
    const left = data(columns, Array.from({ length: count + 1 }, (_, i) => [i]));
    const result = combineData(left, data(["id"], [[0]]), "id", "id", "inner");
    expect(result.sample.rows).toHaveLength(1);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(count);
    expect(combineData(left, data(["id"], [[-1]]), "id", "id", "inner").sample.rows).toEqual([]);
    expect(() => combineData(left, data(["id"], left.rows), "id", "id", "inner")).toThrow(/too large/);
    expect(combineData(data(columns, left.rows.slice(0, count)), data(["id"], left.rows), "id", "id", "inner").sample.rows).toHaveLength(count);
  });
  it("keeps values aligned with declared columns for short and overlong source rows", () => {
    const left = data(["id", "value"], [["A"], ["B", false, "extra"], ["C"]]);
    const right = data(["id", "value"], [["A", 0, "extra"], ["B"]]);
    const result = combineData(left, right, "id", "id", "left");
    expect(result.sample.rows).toEqual([
      ["A", null, "A", 0],
      ["B", false, "B", null],
      ["C", null, null, null],
    ]);
    expect(left.rows).toEqual([["A"], ["B", false, "extra"], ["C"]]);
    expect(right.rows).toEqual([["A", 0, "extra"], ["B"]]);
  });
});

describe("library persistence", () => {
  it("validates metadata, refuses executable URLs and nested combinations, and drops arbitrary payload rows", () => {
    const result = parseDataLibrary({
      assets: [{ ...a, url: "javascript:alert(1)", rows: [[1]] }],
      combinations: [
        recipe,
        {
          ...recipe,
          id: "bad",
          left: { ...a, file: { ...a.file, path: "combination://test" } },
        },
      ],
    });
    expect(result.assets[0]).not.toHaveProperty("url");
    expect(result.assets[0]).not.toHaveProperty("rows");
    expect(result.combinations).toEqual([recipe]);
    expect(parseDataLibrary({ v: 1, data: result })).toEqual(result);
    expect(parseDataLibrary({ v: 9, data: result })).toEqual(
      emptyDataLibrary(),
    );
  });
  it("protects bookmarked and recipe upload paths from eviction", () => {
    const lib = { assets: [a], combinations: [recipe] };
    expect([...pinnedLibraryPaths(lib, { entries: {} })]).toEqual([
      a.file!.path,
      b.file!.path,
    ]);
    expect([
      ...pinnedLibraryPaths(
        { assets: [a], combinations: [] },
        { entries: { [a.ref]: { saved: true } } },
      ),
    ]).toEqual([a.file!.path]);
    expect(
      pinnedLibraryPaths({ assets: [a], combinations: [] }, { entries: {} })
        .size,
    ).toBe(0);
  });
  it("keeps a catalog bookmark identity when its CSV becomes a file", () => {
    const url = "https://example.org/data.csv";
    const list = libraryAssets(
      [{ ...a.file!, sourceUrl: url }],
      [{ ref: "ckan:data.gov/abc", name: "Catalog name", url }],
    );
    expect(list.filter((x) => x.url === url)).toHaveLength(1);
    expect(list.find((x) => x.url === url)).toMatchObject({
      ref: "ckan:data.gov/abc",
      name: "Catalog name",
      file: { path: a.file!.path },
    });
  });
  it("protects recipe uploads resolved through file refs or saved asset metadata", () => {
    const refOnly = {
      ...recipe,
      left: { ref: a.ref, name: a.name },
      right: { ref: "ckan:data.gov/example", name: "Remote copy" },
    };
    expect([...pinnedLibraryPaths({
      assets: [{ ...b, ref: refOnly.right.ref }],
      combinations: [refOnly],
    }, { entries: {} })]).toEqual([a.file!.path, b.file!.path]);
  });
  it("round trips a recipe-only backup and keeps local recipes on import collisions", () => {
    const bundle = buildWorkspaceBundle({
      dataLibrary: { assets: [a], combinations: [recipe], collections: [], foldedBookmarks: false },
      tableViews: [],
      chartViews: [],
      queryViews: [],
      dashboards: [],
      snippets: [],
      tablePrefsByPath: {},
    });
    const parsed = parseWorkspaceBundle(JSON.stringify(bundle));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.bundle.content.dataLibrary?.combinations).toEqual([recipe]);
    expect(bundle.manifest.datasetRefs).toContainEqual({
      path: b.file!.path,
      name: "B",
    });
    const incoming = {
      ...bundle.content,
      dataLibrary: { assets: [], combinations: [{ ...recipe, name: "Other" }], collections: [], foldedBookmarks: false },
    };
    expect(
      mergeWorkspaceBundle(bundle.content, incoming).merged.dataLibrary
        ?.combinations[0]?.name,
    ).toBe("Combined");
  });
});

describe("my data filters", () => {
  it("searches names and catalog fields, and keeps topic filters to matching datasets", () => {
    const local = assetForFile({
      path: "web://file/notes.csv",
      name: "notes.csv",
      extension: "csv",
      row_count: 1,
      size_bytes: 4,
    });
    const met = {
      ref: feedRef("met"),
      name: "Met Museum collection",
      description: "departments and cultures",
    };
    const base = { ...DEFAULT_LIBRARY_BROWSE };
    expect(browseLibrary([local, met], { ...base, query: "notes" }).map((x) => x.name)).toEqual([
      "notes.csv",
    ]);
    expect(browseLibrary([local, met], { ...base, query: "department" }).map((x) => x.ref)).toEqual([
      met.ref,
    ]);
    expect(browseLibrary([local, met], { ...base, topics: ["culture"] }).map((x) => x.ref)).toEqual([
      met.ref,
    ]);
    expect(browseLibrary([local, met], { ...base, where: ["city"] })).toEqual([]);
  });
});
