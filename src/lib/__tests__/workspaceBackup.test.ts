// =================================================================
// workspaceBackup tests (LOOM-659)
// =================================================================

import { describe, expect, it } from "vitest";
import {
  buildWorkspaceBundle,
  DEFAULT_EXPORT_SCOPE,
  estimateBundleBytes,
  mergeWorkspaceBundle,
  parseWorkspaceBundle,
  serializeWorkspaceBundle,
  WORKSPACE_BUNDLE_VERSION,
  type WorkspaceBundleContent,
} from "../workspaceBackup";
import type { ChartViewItem } from "../store";

const chart = {
  id: "c1",
  kind: "bar",
  title: "Rows",
  description: "",
  spec: {},
  xField: "a",
  yField: "b",
} as unknown as ChartViewItem["chart"];

function sample(): Partial<WorkspaceBundleContent> {
  return {
    tableViews: [
      { id: "t1", name: "Compact", visibleColumns: ["a"], columnOrder: ["a", "b"], columnFilters: { a: "1" }, querySql: "select 1" },
    ],
    chartViews: [
      {
        id: "cv1",
        name: "Bars",
        filePath: "web://upload/x.csv",
        fileName: "x.csv",
        chart,
        visualOverrides: {},
        snapshotImageDataUrl: "data:image/png;base64,AAAA",
      },
    ],
    queryViews: [{ id: "q1", name: "All", sql: "select * from t" }],
    dashboards: [{ id: "d1", name: "Main", slots: [{ id: "s1", viewType: "chart", viewId: "cv1" }] }],
    snippets: [{ name: "top", sql: "select 1" }],
    tablePrefsByPath: { "web://upload/x.csv": { visibleColumns: ["a"], columnOrder: null } },
  };
}

describe("workspace backup", () => {
  it("round-trips selected work into a fresh profile", () => {
    const text = serializeWorkspaceBundle(buildWorkspaceBundle(sample()));
    const res = parseWorkspaceBundle(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.bundle.content;
    expect(c.tableViews[0]).toMatchObject({ id: "t1", visibleColumns: ["a"], querySql: "select 1" });
    expect(c.chartViews[0].id).toBe("cv1");
    expect(c.queryViews[0].sql).toBe("select * from t");
    expect(c.dashboards[0].slots[0].viewId).toBe("cv1");
    expect(c.snippets).toEqual([{ name: "top", sql: "select 1" }]);
    expect(c.tablePrefsByPath["web://upload/x.csv"].visibleColumns).toEqual(["a"]);
    expect(res.bundle.manifest.datasetRefs).toEqual([{ path: "web://upload/x.csv", name: "x.csv" }]);
  });

  it("omits thumbnails and unselected sections by default scope", () => {
    const b = buildWorkspaceBundle(sample(), { ...DEFAULT_EXPORT_SCOPE, dashboards: false });
    expect(b.content.dashboards).toEqual([]);
    expect(b.content.chartViews[0].snapshotImageDataUrl).toBeNull();
    expect(b.manifest.includesThumbnails).toBe(false);
    const withThumbs = buildWorkspaceBundle(sample(), { ...DEFAULT_EXPORT_SCOPE, thumbnails: true });
    expect(estimateBundleBytes(withThumbs)).toBeGreaterThan(estimateBundleBytes(b));
  });

  it("rejects malformed input with actionable messages", () => {
    expect(parseWorkspaceBundle("")).toMatchObject({ ok: false, code: "empty" });
    expect(parseWorkspaceBundle("{nope")).toMatchObject({ ok: false, code: "not-json" });
    expect(parseWorkspaceBundle('{"hello":1}')).toMatchObject({ ok: false, code: "not-loom" });
    const bad = parseWorkspaceBundle(
      JSON.stringify({ manifest: { format: "loom-workspace", version: 1 }, content: { tableViews: [{ nope: true }] } }),
    );
    expect(bad).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses future-version bundles without applying anything", () => {
    const res = parseWorkspaceBundle(
      JSON.stringify({
        manifest: { format: "loom-workspace", version: WORKSPACE_BUNDLE_VERSION + 1 },
        content: { queryViews: [{ id: "q", name: "n", sql: "select 1" }] },
      }),
    );
    expect(res).toMatchObject({ ok: false, code: "future-version" });
    if (!res.ok) expect(res.message).toMatch(/Update Loom/);
  });

  it("drops invalid records and ignores embedded settings/URLs", () => {
    const res = parseWorkspaceBundle(
      JSON.stringify({
        manifest: { format: "loom-workspace", version: 1, createdAt: "garbage" },
        appSettings: { theme: "x" },
        content: {
          appSettings: { theme: "evil" },
          sourceUrl: "https://evil.example",
          queryViews: [{ id: "q1", name: "ok", sql: "select 1" }, { id: 5 }],
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bundle.content.queryViews).toHaveLength(1);
    expect(JSON.stringify(res.bundle)).not.toContain("evil");
  });

  it("merges non-destructively (existing ids win)", () => {
    const incoming = buildWorkspaceBundle(sample()).content;
    const current = buildWorkspaceBundle({
      queryViews: [{ id: "q1", name: "Mine", sql: "select 2" }],
    }).content;
    const r = mergeWorkspaceBundle(current, incoming);
    expect(r.merged.queryViews).toEqual([{ id: "q1", name: "Mine", sql: "select 2" }]);
    expect(r.skipped.queryViews).toBe(1);
    expect(r.added.tableViews).toBe(1);
    expect(r.added.snippets).toBe(1);
  });
});
