// Data library metadata and bounded, exact-key combinations. Rows stay in the existing data stores.
import type { FileEntry, QueryResult } from "./store/types";
import { feedKindFromRef, isSourceRef, refForPath } from "./sourceRef";
import {
  catalogEntryFor,
  filterCatalog,
  sourceCatalog,
  type CatalogFreshness,
} from "./sourceCatalog";
import { geosForWhere, type FeedWhere } from "./feedBrowser";
import type { SourceTopic } from "./sourceRegistry";
import {
  collectionAlive,
  COLLECTION_SPANS,
  type CollectionPiece,
  type CollectionSpan,
  type DataCollection,
} from "./collections";

export const DATA_LIBRARY_KEY = "loom-data-library";
export type LibrarySection =
  "mine" | "saved" | "combinations" | "discover" | "import";
export interface LibraryAsset {
  ref: string;
  name: string;
  description?: string;
  file?: FileEntry;
  url?: string;
  credit?: string;
}
export interface DataCombination {
  id: string;
  name: string;
  left: LibraryAsset;
  right: LibraryAsset;
  leftKey: string;
  rightKey: string;
  mode: "left" | "inner";
  createdAt: number;
}
export interface DataLibrary {
  assets: LibraryAsset[];
  combinations: DataCombination[];
  collections: DataCollection[];
  /** Old per-source bookmarks have been folded into one collection. */
  foldedBookmarks: boolean;
}
export const emptyDataLibrary = (): DataLibrary => ({
  assets: [],
  combinations: [],
  collections: [],
  foldedBookmarks: false,
});
export const assetForFile = (file: FileEntry): LibraryAsset => ({
  ref: refForPath(file.path, file),
  name: file.name,
  file,
  url: file.sourceUrl,
  credit: file.sourceCredit,
});
export function libraryAssets(
  files: FileEntry[],
  saved: LibraryAsset[],
): LibraryAsset[] {
  const all = new Map<string, LibraryAsset>();
  for (const e of sourceCatalog())
    all.set(e.ref, {
      ref: e.ref,
      name: e.label,
      description: e.description,
      url: e.url,
      credit: e.attribution,
    });
  for (const e of saved) all.set(e.ref, { ...all.get(e.ref), ...e });
  for (const f of files) {
    const e = assetForFile(f);
    const savedSource = f.sourceUrl
      ? saved.find((a) => a.url === f.sourceUrl)
      : undefined;
    if (savedSource) {
      e.ref = savedSource.ref;
      e.name = savedSource.name;
    }
    all.set(e.ref, { ...all.get(e.ref), ...e });
  }
  return [...all.values()];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function parseAsset(v: unknown): LibraryAsset | null {
  if (
    !record(v) ||
    !isSourceRef(v.ref) ||
    typeof v.name !== "string" ||
    !v.name.trim()
  )
    return null;
  const a: LibraryAsset = { ref: v.ref, name: v.name.slice(0, 250) };
  for (const key of ["description", "credit"] as const)
    if (typeof v[key] === "string") a[key] = v[key].slice(0, 2000);
  if (typeof v.url === "string" && /^https?:\/\//i.test(v.url)) a.url = v.url;
  if (
    record(v.file) &&
    typeof v.file.path === "string" &&
    typeof v.file.name === "string" &&
    typeof v.file.extension === "string"
  ) {
    a.file = {
      path: v.file.path,
      name: v.file.name,
      extension: v.file.extension,
      row_count: Number(v.file.row_count) || 0,
      size_bytes: Number(v.file.size_bytes) || 0,
      sourceUrl: a.url,
      sourceCredit: a.credit,
    };
  }
  return a;
}
export function parseDataLibrary(value: unknown): DataLibrary {
  const result = emptyDataLibrary();
  if (record(value) && "v" in value) {
    if (value.v !== 1) return result;
    value = value.data;
  }
  if (!record(value)) return result;
  if (Array.isArray(value.assets))
    result.assets = [
      ...new Map(
        value.assets
          .slice(0, 500)
          .map(parseAsset)
          .filter((a): a is LibraryAsset => !!a)
          .map((a) => [a.ref, a]),
      ).values(),
    ];
  if (Array.isArray(value.combinations))
    for (const v of value.combinations.slice(0, 100)) {
      if (!record(v)) continue;
      const left = parseAsset(v.left),
        right = parseAsset(v.right);
      if (
        !left ||
        !right ||
        typeof v.id !== "string" ||
        !/^[\w-]{1,100}$/.test(v.id) ||
        typeof v.name !== "string" ||
        !v.name.trim() ||
        typeof v.leftKey !== "string" ||
        !v.leftKey ||
        typeof v.rightKey !== "string" ||
        !v.rightKey ||
        !["left", "inner"].includes(String(v.mode))
      )
        continue;
      if (
        left.file?.path.startsWith("combination://") ||
        right.file?.path.startsWith("combination://")
      )
        continue;
      if (result.combinations.some((c) => c.id === v.id)) continue;
      result.combinations.push({
        id: v.id,
        name: v.name.slice(0, 120),
        left,
        right,
        leftKey: v.leftKey,
        rightKey: v.rightKey,
        mode: v.mode as "left" | "inner",
        createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
      });
    }
  if (Array.isArray(value.collections)) {
    const now = Date.now();
    for (const v of value.collections.slice(0, 40)) {
      const c = parseCollection(v);
      if (!c || result.collections.some((x) => x.id === c.id)) continue;
      if (!collectionAlive(c, now)) continue;
      result.collections.push(c);
    }
  }
  result.foldedBookmarks = value.foldedBookmarks === true;
  return result;
}

function parseCollection(v: unknown): DataCollection | null {
  if (
    !record(v) ||
    typeof v.id !== "string" ||
    !/^[\w-]{1,100}$/.test(v.id) ||
    typeof v.intent !== "string" ||
    !v.intent.trim() ||
    !COLLECTION_SPANS.includes(v.span as CollectionSpan) ||
    typeof v.touchedAt !== "number"
  )
    return null;
  const pieces: CollectionPiece[] = [];
  if (Array.isArray(v.pieces)) {
    for (const p of v.pieces.slice(0, 24)) {
      if (!record(p) || typeof p.name !== "string" || !p.name.trim()) continue;
      const name = p.name.slice(0, 160);
      if (p.kind === "data" && isSourceRef(p.ref)) pieces.push({ kind: "data", ref: p.ref, name });
      else if (p.kind === "chart" && typeof p.id === "string" && p.id.trim())
        pieces.push({ kind: "chart", id: p.id.slice(0, 80), name });
    }
  }
  return {
    id: v.id,
    intent: v.intent.slice(0, 120),
    span: v.span as CollectionSpan,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : v.touchedAt,
    touchedAt: v.touchedAt,
    pieces,
  };
}

export const COMBINATION_MAX_CELLS = 1_000_000;
export interface CombinationResult {
  sample: QueryResult;
  matched: number;
  unmatched: number;
  missingKeys: number;
  unmatchedExamples: string[];
  partial: boolean;
}
function matchKey(v: unknown): string | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  // Preserve case and leading zeros. Only equal textual representations match.
  return String(v).trim();
}
export function combineData(
  left: QueryResult,
  right: QueryResult,
  leftKey: string,
  rightKey: string,
  mode: "left" | "inner",
): CombinationResult {
  const li = left.columns.indexOf(leftKey),
    ri = right.columns.indexOf(rightKey);
  if (li < 0 || ri < 0)
    throw new Error(
      "A matching field is no longer available. Choose the fields again.",
    );
  if (!left.rows.length || !right.rows.length)
    throw new Error(
      "Both sources need loaded rows before they can be combined.",
    );
  const columns = [
    ...left.columns.map((c) => `left_${c}`),
    ...right.columns.map((c) => `right_${c}`),
  ];
  if (left.rows.length * columns.length > COMBINATION_MAX_CELLS)
    throw new Error(
      "This combination is too large for an on-device preview. Use smaller sources.",
    );
  const index = new Map<string, QueryResult["rows"][number]>();
  for (const row of right.rows) {
    const key = matchKey(row[ri]);
    if (key === null) continue;
    if (index.has(key))
      throw new Error(
        `“${rightKey}” repeats in the second source (for example “${key.slice(0, 60)}”). Choose a unique lookup field to avoid multiplying rows.`,
      );
    index.set(key, row);
  }
  const rows: QueryResult["rows"] = [];
  let matched = 0,
    unmatched = 0,
    missingKeys = 0;
  const examples = new Set<string>();
  for (const row of left.rows) {
    const key = matchKey(row[li]);
    const other = key === null ? undefined : index.get(key);
    if (other) {
      matched++;
      rows.push([...row, ...other]);
    } else {
      unmatched++;
      if (key === null) missingKeys++;
      else if (examples.size < 5) examples.add(key.slice(0, 80));
      if (mode === "left")
        rows.push([...row, ...right.columns.map(() => null)]);
    }
  }
  return {
    sample: {
      columns,
      types: [...left.types, ...right.types],
      rows,
      total_rows: rows.length,
    },
    matched,
    unmatched,
    missingKeys,
    unmatchedExamples: [...examples],
    partial:
      left.total_rows > left.rows.length ||
      right.total_rows > right.rows.length,
  };
}

/** Local uploads referenced by a living collection or a recipe must survive routine LRU eviction. */
export function pinnedLibraryPaths(
  library: Pick<DataLibrary, "assets" | "combinations"> & {
    collections?: DataCollection[];
  },
  prefs: { entries: Record<string, { saved?: boolean }> },
): Set<string> {
  const paths = new Set<string>();
  const pinRef = (ref: string) => {
    if (ref.startsWith("file:web://")) paths.add(ref.slice(5));
    const asset = library.assets.find((a) => a.ref === ref);
    if (asset?.file?.path.startsWith("web://")) paths.add(asset.file.path);
  };
  for (const [ref, pref] of Object.entries(prefs.entries))
    if (pref.saved) pinRef(ref);
  for (const c of library.collections ?? []) {
    if (!collectionAlive(c)) continue;
    for (const piece of c.pieces) if (piece.kind === "data") pinRef(piece.ref);
  }
  for (const asset of library.assets)
    if (prefs.entries[asset.ref]?.saved && asset.file?.path.startsWith("web://"))
      paths.add(asset.file.path);
  for (const recipe of library.combinations)
    for (const asset of [recipe.left, recipe.right])
      if (asset.file?.path.startsWith("web://")) paths.add(asset.file.path);
  return paths;
}

export type LibraryKind = "file" | "feed" | "remote" | "demo";
export type LibrarySort = "recent" | "az";

export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = {
  file: "Files",
  feed: "Connected feeds",
  remote: "Remote datasets",
  demo: "Sample data",
};

export function libraryAssetKind(a: LibraryAsset): LibraryKind {
  if (feedKindFromRef(a.ref)) return "feed";
  if (a.url) return "remote";
  if (a.file?.path.startsWith("mock://")) return "demo";
  return "file";
}

export interface LibraryBrowse {
  query: string;
  kinds: LibraryKind[];
  topics: SourceTopic[];
  where: FeedWhere[];
  freshness: CatalogFreshness[];
  sort: LibrarySort;
}

export const DEFAULT_LIBRARY_BROWSE: LibraryBrowse = {
  query: "",
  kinds: [],
  topics: [],
  where: [],
  freshness: [],
  sort: "recent",
};

const foldLibrary = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function libraryFiltersActive(s: LibraryBrowse): boolean {
  return !!(
    s.query.trim() ||
    s.kinds.length ||
    s.topics.length ||
    s.where.length ||
    s.freshness.length
  );
}

/** Same facets as Discover, over the datasets already on this device. */
export function browseLibrary(
  assets: LibraryAsset[],
  state: LibraryBrowse,
  openedAt: (ref: string) => number = () => 0,
): LibraryAsset[] {
  const terms = foldLibrary(state.query)
    .split(/\s+/)
    .filter(Boolean);
  const facets = state.topics.length > 0 || state.where.length > 0 || state.freshness.length > 0;
  const geo = geosForWhere(state.where);
  const kept = assets.filter((a) => {
    if (state.kinds.length && !state.kinds.includes(libraryAssetKind(a))) return false;
    const entry = catalogEntryFor(a.ref);
    if (
      facets &&
      (!entry ||
        !filterCatalog([entry], {
          topics: state.topics,
          geo,
          freshness: state.freshness,
        }).length)
    )
      return false;
    if (!terms.length) return true;
    const own = foldLibrary([a.name, a.description ?? "", a.credit ?? ""].join(" "));
    if (terms.every((t) => own.includes(t))) return true;
    return !!entry && filterCatalog([entry], { query: state.query }).length > 0;
  });
  return [...kept].sort((a, b) =>
    state.sort === "az" ? a.name.localeCompare(b.name) : openedAt(b.ref) - openedAt(a.ref),
  );
}
