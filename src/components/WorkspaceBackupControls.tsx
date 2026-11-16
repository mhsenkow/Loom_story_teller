"use client";

// =================================================================
// WorkspaceBackupControls — export / import saved work (LOOM-659)
// =================================================================
// Shows size + privacy scope before export; import is validated and
// merged non-destructively (see lib/workspaceBackup.ts).
// =================================================================

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLoomStore } from "@/lib/store";
import { getTablePrefsByPath, setTablePrefsForPath } from "@/lib/persist";
import { saveOrShareBlob } from "@/lib/nativeExport";
import {
  buildWorkspaceBundle,
  DEFAULT_EXPORT_SCOPE,
  estimateBundleBytes,
  formatBytes,
  mergeWorkspaceBundle,
  parseWorkspaceBundle,
  serializeWorkspaceBundle,
  WORKSPACE_PRIVACY_NOTE,
  type WorkspaceBundleContent,
} from "@/lib/workspaceBackup";

function userPrefsByPath() {
  const out: WorkspaceBundleContent["tablePrefsByPath"] = {};
  for (const [path, prefs] of Object.entries(getTablePrefsByPath())) {
    if (!path.startsWith("__")) out[path] = prefs;
  }
  return out;
}

export function WorkspaceBackupControls() {
  const tableViews = useLoomStore((s) => s.tableViews);
  const chartViews = useLoomStore((s) => s.chartViews);
  const queryViews = useLoomStore((s) => s.queryViews);
  const dashboards = useLoomStore((s) => s.dashboards);
  const querySnippets = useLoomStore((s) => s.querySnippets);
  const customChartLooks = useLoomStore((s) => s.customChartLooks);
  const dataLibrary = useLoomStore(s => s.dataLibrary);
  const sourcePrefs = useLoomStore((s) => s.sourcePrefs);
  const setToast = useLoomStore((s) => s.setToast);
  const [thumbnails, setThumbnails] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = useMemo(
    () => ({
      customChartLooks,
      tableViews,
      chartViews,
      queryViews,
      dashboards,
      snippets: querySnippets,
      tablePrefsByPath: userPrefsByPath(),
      sourcePrefs,
      dataLibrary,
    }),
    // Prefs live in localStorage; recompute alongside view lists.
    [tableViews, chartViews, queryViews, dashboards, querySnippets, customChartLooks, sourcePrefs, dataLibrary],
  );

  const preview = useMemo(() => {
    const bundle = buildWorkspaceBundle(current, { ...DEFAULT_EXPORT_SCOPE, thumbnails });
    const c = bundle.manifest.counts;
    return {
      bundle,
      bytes: estimateBundleBytes(bundle),
      empty: Object.values(c).every((n) => n === 0),
      summary: `${c.tableViews} table, ${c.chartViews} chart, ${c.queryViews} query views · ${c.dashboards} dashboards · ${c.snippets} snippets · ${c.customChartLooks} looks · ${c.sourcePrefs ?? 0} source picks · ${c.dataLibrary ?? 0} library items`,
    };
  }, [current, thumbnails]);

  const doExport = async () => {
    const blob = new Blob([serializeWorkspaceBundle(preview.bundle)], { type: "application/json" });
    const stamp = new Date().toISOString().slice(0, 10);
    const outcome = await saveOrShareBlob(blob, `loom-workspace-${stamp}.json`, { title: "Loom workspace backup" });
    if (outcome !== "cancelled") setToast("Workspace backup exported");
  };

  const doImport = async (file: File) => {
    setMessage(null);
    const text = await file.text();
    const res = parseWorkspaceBundle(text);
    if (!res.ok) {
      setMessage(res.message);
      return;
    }
    const st = useLoomStore.getState();
    const { merged, added } = mergeWorkspaceBundle(
      {
        customChartLooks: st.customChartLooks,
        tableViews: st.tableViews,
        chartViews: st.chartViews,
        queryViews: st.queryViews,
        dashboards: st.dashboards,
        snippets: st.querySnippets,
        tablePrefsByPath: userPrefsByPath(),
        sourcePrefs: st.sourcePrefs,
        dataLibrary: st.dataLibrary,
      },
      res.bundle.content,
    );
    st.setTableViews(merged.tableViews);
    st.setChartViews(merged.chartViews);
    st.setQueryViews(merged.queryViews);
    st.setDashboards(merged.dashboards);
    st.setQuerySnippets(merged.snippets);
    useLoomStore.setState({ customChartLooks: merged.customChartLooks ?? [] });
    if (merged.dataLibrary) useLoomStore.setState({ dataLibrary: merged.dataLibrary });
    if (merged.sourcePrefs) st.setSourcePrefs(merged.sourcePrefs);
    for (const [path, prefs] of Object.entries(merged.tablePrefsByPath)) setTablePrefsForPath(path, prefs);
    const refs = res.bundle.manifest.datasetRefs;
    const total = Object.values(added).reduce((a, b) => a + b, 0);
    setMessage(
      `Imported ${total} item${total === 1 ? "" : "s"}.` +
        (refs.length ? ` Re-add ${refs.length} dataset file${refs.length === 1 ? "" : "s"} (${refs.slice(0, 3).map((r) => r.name).join(", ")}${refs.length > 3 ? "…" : ""}) to use data-backed views.` : ""),
    );
  };

  return (
    <div className="flex flex-col gap-2" data-testid="workspace-backup">
      <p className="text-2xs text-loom-muted">
        Backup: {preview.summary} · {formatBytes(preview.bytes)}. {WORKSPACE_PRIVACY_NOTE}
      </p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          aria-label="Include chart thumbnails"
          checked={thumbnails}
          onChange={(e) => setThumbnails(e.target.checked)}
          className="rounded border-loom-border accent-loom-accent"
        />
        <span className="text-2xs text-loom-text">Include chart thumbnails (larger, may show data)</span>
      </label>
      <Button variant="ghost" size="sm" className="w-full justify-center" disabled={preview.empty} aria-label="Export workspace backup" onClick={() => void doExport()}>
        Export workspace backup
      </Button>
      <Button variant="ghost" size="sm" className="w-full justify-center" aria-label="Import workspace backup" onClick={() => fileRef.current?.click()}>
        Import workspace backup…
      </Button>
      <input
        ref={fileRef}
        type="file"
        aria-label="Workspace backup file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void doImport(f);
        }}
      />
      {message && (
        <p role="status" className="text-2xs text-loom-text">
          {message}
        </p>
      )}
    </div>
  );
}
