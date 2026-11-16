// Resolve recipe inputs through Loom's existing ingestion/IPC paths; never persist result rows as a recipe.
import { leaveSourcesShowChart } from "./shellHandoff";
import { useLoomStore } from "./store";
import { feedKindFromRef, pathForRef } from "./sourceRef";
import {
  fetchCsvTextWeb,
  inspectFile,
  isDesktop,
  sourceStart,
  sourceSnapshot,
  sourceStatus,
  streamStart,
  streamSnapshot,
  type InspectResult,
} from "./tauri";
import { SOURCE_EXPLORE_ROWS } from "./sourceRegistry";
import {
  combineData,
  type LibraryAsset,
  type DataCombination,
} from "./dataLibrary";
import { activateDataset, statsForQueryResult } from "./datasetPipeline";
import { getWebFileInspect } from "./webFileStore";

export async function loadLibraryAsset(
  asset: LibraryAsset,
): Promise<InspectResult> {
  const kind = feedKindFromRef(asset.ref);
  if (kind) {
    if (kind === "wiki") {
      await streamStart();
      return streamSnapshot(SOURCE_EXPLORE_ROWS);
    }
    await sourceStart(kind);
    const status = await sourceStatus(kind);
    if (status.snapshot_stale || status.last_error)
      throw new Error(
        `${asset.name} could not refresh. Try again when the feed is available.`,
      );
    return sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
  }
  // A remote input stays connected to its URL, even after a local preview has been loaded.
  if (asset.url) {
    const { text, truncated } = await fetchCsvTextWeb(asset.url);
    const { parseCsvToInspectResult } = await import("./mock-data");
    const result = parseCsvToInspectResult(asset.name, text);
    const requestedLimit = Number(
      new URL(asset.url).searchParams.get("$limit"),
    );
    if (
      truncated ||
      (requestedLimit > 0 && result.sample.rows.length >= requestedLimit)
    )
      result.sample.total_rows = Math.max(
        result.sample.total_rows,
        result.sample.rows.length + 1,
      );
    return result;
  }
  const path = asset.file?.path ?? pathForRef(asset.ref);
  if (!path)
    throw new Error(
      "Open this dataset from Discover first, then add it to the combination.",
    );
  const state = useLoomStore.getState();
  if (path.startsWith("web://")) {
    const cached = state.webFileCache[path] ?? (await getWebFileInspect(path));
    if (cached) return { stats: cached.stats, sample: cached.sample };
    throw new Error(
      `“${asset.name}” is no longer on this device. Add the file again to reconnect it.`,
    );
  }
  if (path.startsWith("mock://") || isDesktop())
    return inspectFile(path, 30_000);
  throw new Error(
    "This file belongs to the desktop app. Add it on this device to use it here.",
  );
}
export async function evaluateCombination(recipe: DataCombination) {
  const [left, right] = await Promise.all([
    loadLibraryAsset(recipe.left),
    loadLibraryAsset(recipe.right),
  ]);
  return combineData(
    left.sample,
    right.sample,
    recipe.leftKey,
    recipe.rightKey,
    recipe.mode,
  );
}
export async function openCombination(
  recipe: DataCombination,
  isCurrent: () => boolean = () => true,
) {
  const result = await evaluateCombination(recipe);
  if (!isCurrent()) return result;
  const file = {
    path: `combination://${recipe.id}`,
    name: recipe.name,
    extension: "combination",
    row_count: result.sample.rows.length,
    size_bytes: 0,
    capturedAt: new Date().toISOString(),
    sourceCredit: `${recipe.left.name} + ${recipe.right.name} · refreshed on open`,
  };
  activateDataset({
    file,
    stats: statsForQueryResult(result.sample),
    sample: result.sample,
    extra: {
      viewMode: "explorer",
      dataSourcesExpanded: false,
      dataRegionOpen: false,
    },
  });
  const state = useLoomStore.getState();
  state.addRecentFile(file);
  leaveSourcesShowChart();
  state.setViewMode("explorer");
  state.setToast(
    `${result.matched.toLocaleString()} matched · ${result.unmatched.toLocaleString()} unmatched${result.partial ? " · partial source data" : ""}. Reopen the combination to refresh.`,
  );
  return result;
}
