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
import { emptySourcePreferences, recordSourceOpen, setSourceReaction, toggleSourceSaved } from "../sourcePreferences";

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
  it("round-trips personal looks alone and preserves existing looks on name collisions", () => {
    const look = { id: "look1", name: "Calm", overrides: { opacity: 0.4 }, updatedAt: 1 };
    const bundle = buildWorkspaceBundle({ customChartLooks: [look] });
    const res = parseWorkspaceBundle(serializeWorkspaceBundle(bundle));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bundle.content.customChartLooks).toEqual([look]);
    expect(res.bundle.manifest.counts.customChartLooks).toBe(1);
    const current = buildWorkspaceBundle({ customChartLooks: [{ ...look, id: "local", name: "calm", overrides: { opacity: 0.9 } }] }).content;
    const merged = mergeWorkspaceBundle(current, res.bundle.content);
    expect(merged.merged.customChartLooks).toEqual(current.customChartLooks);
    expect(merged.skipped.customChartLooks).toBe(1);
    expect(buildWorkspaceBundle({ customChartLooks: [look] }, { ...DEFAULT_EXPORT_SCOPE, customChartLooks: false }).content.customChartLooks).toEqual([]);
  });
  it("round-trips source loves / saves / hides alone, keeps local reactions, and leaves opens on the device", () => {
    let prefs = setSourceReaction(emptySourcePreferences(), "feed:usgs", "love", 1);
    prefs = setSourceReaction(prefs, "feed:crypto", "hide", 2);
    prefs = toggleSourceSaved(prefs, "pack:owid-co2-per-capita", 3);
    prefs = recordSourceOpen(prefs, "file:/Users/me/private.csv", 4);
    const bundle = buildWorkspaceBundle({ sourcePrefs: prefs });
    expect(bundle.manifest.counts.sourcePrefs).toBe(3);
    expect(serializeWorkspaceBundle(bundle)).not.toContain("private.csv");
    const res = parseWorkspaceBundle(serializeWorkspaceBundle(bundle));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bundle.content.sourcePrefs?.entries).toEqual({
      "feed:usgs": { reaction: "love", reactedAt: 1 },
      "feed:crypto": { reaction: "hide", reactedAt: 2 },
      "pack:owid-co2-per-capita": { saved: true, savedAt: 3 },
    });
    const current = buildWorkspaceBundle({ sourcePrefs: setSourceReaction(emptySourcePreferences(), "feed:crypto", "love", 9) }).content;
    const r = mergeWorkspaceBundle(current, res.bundle.content);
    expect(r.merged.sourcePrefs?.entries["feed:crypto"]?.reaction).toBe("love");
    expect(r.merged.sourcePrefs?.entries["feed:usgs"]?.reaction).toBe("love");
    expect([r.added.sourcePrefs, r.skipped.sourcePrefs]).toEqual([2, 1]);
    expect(buildWorkspaceBundle({ sourcePrefs: prefs }, { ...DEFAULT_EXPORT_SCOPE, sourcePrefs: false }).manifest.counts.sourcePrefs).toBe(0);
  });

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
