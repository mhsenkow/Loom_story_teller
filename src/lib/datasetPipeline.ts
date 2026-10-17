// =================================================================
// datasetPipeline — one "dataset loaded → recommend → select" path
// =================================================================
// Every entry point that opens a dataset (Sidebar uploads / recents / live
// feeds, Onboarding discover, WebSessionResume, NeoSpace ingest) calls
// `activateDataset` so the per-dataset reset (`openDataset`), shortlist
// choice and first-chart selection happen identically everywhere.
// `applyQueryResult` is the sibling for QueryView "Chart this": a query result
// is not a new dataset, so it re-points sample/stats/charts WITHOUT the
// per-dataset reset (filters and selection for the open file are kept).
// =================================================================

import { useLoomStore } from "./store";
import type { ColumnInfo, FileEntry, LoomState, QueryResult } from "./store";
import {
  recommend,
  recommendSourceStory,
  recommendStreamStory,
  type ChartRecommendation,
} from "./recommendations";
import { sourceKindFromPath } from "./sourceRegistry";
import { refForPath } from "./sourceRef";
import type { SourceKind } from "./tauri";

/** Which recommender builds the chart shortlist for the dataset. */
export type DatasetShortlist =
  | { type: "file" }
  | { type: "stream" }
  | { type: "source"; kind: SourceKind }
  | { type: "none" };

/** Pick the shortlist recommender implied by a file path (`stream://wiki`, `stream://<kind>`, else file). */
export function shortlistForPath(path: string): DatasetShortlist {
  if (path === "stream://wiki") return { type: "stream" };
  const kind = sourceKindFromPath(path);
  return kind ? { type: "source", kind } : { type: "file" };
}

export function shortlistFor(
  shortlist: DatasetShortlist,
  file: Pick<FileEntry, "name">,
  stats: ColumnInfo[],
  sample: QueryResult,
): ChartRecommendation[] {
  switch (shortlist.type) {
    case "stream":
      return recommendStreamStory(stats, sample).charts;
    case "source":
      return recommendSourceStory(shortlist.kind, stats, sample).charts;
    case "none":
      return [];
    default:
      return recommend(stats, sample, file.name);
  }
}

export interface ActivateDatasetInput {
  file: FileEntry;
  stats: ColumnInfo[];
  sample: QueryResult;
  /** Recommender used when `charts` is not supplied. Defaults to the file recommender. */
  shortlist?: DatasetShortlist;
  /** Pre-built, ordered shortlist (story / forced chart). Overrides `shortlist`. */
  charts?: ChartRecommendation[];
  /** Chart to select. `undefined` → first chart; `null` → none. */
  active?: ChartRecommendation | null;
  inspectingFilePath?: string | null;
  /** Applied in the same store update (view mode, panel tab, sidebar flags…). */
  extra?: Partial<LoomState>;
}

export interface ActivatedDataset {
  charts: ChartRecommendation[];
  active: ChartRecommendation | null;
}

/** Prefer a real total from the sample over a deferred mount probe of 0. */
export function fileWithSampleRowCount(file: FileEntry, sample: QueryResult): FileEntry {
  const fromSample = Math.max(sample.total_rows ?? 0, sample.rows.length);
  if (fromSample <= 0 || fromSample <= file.row_count) return file;
  return { ...file, row_count: fromSample };
}

/** Reset dataset-scoped state, recommend, and select the first (or given) chart in one store update. */
export function activateDataset(input: ActivateDatasetInput): ActivatedDataset {
  const charts =
    input.charts ?? shortlistFor(input.shortlist ?? { type: "file" }, input.file, input.stats, input.sample);
  const active = input.active === undefined ? (charts[0] ?? null) : input.active;
  const file = fileWithSampleRowCount(input.file, input.sample);
  const st = useLoomStore.getState();
  st.openDataset({
    file,
    stats: input.stats,
    sample: input.sample,
    chartRecs: charts,
    activeChart: active,
    inspectingFilePath: input.inspectingFilePath,
    extra: input.extra,
  });
  // Implicit "like" for source preferences (de-duped per ref within minutes).
  st.noteSourceOpened(refForPath(file.path, file));
  // Keep the sidebar file list honest when mount deferred row_count to 0.
  if (file.row_count !== input.file.row_count) {
    const files = st.files;
    if (files.some((f) => f.path === file.path && f.row_count !== file.row_count)) {
      st.setFiles(files.map((f) => (f.path === file.path ? { ...f, row_count: file.row_count } : f)));
    }
  }
  return { charts, active };
}

/** Column stats for a query result (no profiling pass — types only). */
export function statsForQueryResult(result: QueryResult): ColumnInfo[] {
  return result.columns.map((name, i) => ({
    name,
    data_type: result.types[i] ?? "VARCHAR",
    null_count: 0,
    distinct_count: 0,
    min_value: null as string | null,
    max_value: null as string | null,
  }));
}

/** Chart a query result: swap sample/stats and re-recommend, keeping the open file's filters. */
export function applyQueryResult(result: QueryResult, fileName: string): ActivatedDataset {
  const st = useLoomStore.getState();
  const stats = statsForQueryResult(result);
  st.setSampleRows(result);
  st.setColumnStats(stats);
  let charts: ChartRecommendation[] = [];
  try {
    charts = recommend(stats, result, fileName);
  } catch {
    charts = [];
  }
  const active = charts[0] ?? null;
  st.setChartRecs(charts);
  st.setActiveChart(active);
  return { charts, active };
}
