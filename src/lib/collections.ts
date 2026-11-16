// Collections are a temporary intent: datasets and charts kept together
// for a question. If you don't touch one, it leaves after 3, 6, or 9 months.
import { catalogEntryFor, filterCatalog } from "./sourceCatalog";
import { geosForWhere, type FeedWhere } from "./feedBrowser";
import type { SourceTopic } from "./sourceRegistry";

/** `0` means the collection does not expire. */
export const COLLECTION_SPANS = [3, 6, 9, 0] as const;
export type CollectionSpan = (typeof COLLECTION_SPANS)[number];

export function spanLabel(span: CollectionSpan): string {
  return span === 0 ? "∞" : `${span} months`;
}

export type CollectionPiece =
  | { kind: "data"; ref: string; name: string }
  | { kind: "chart"; id: string; name: string };

export interface DataCollection {
  id: string;
  /** Why these belong together. */
  intent: string;
  span: CollectionSpan;
  createdAt: number;
  touchedAt: number;
  pieces: CollectionPiece[];
}

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4375;

export function collectionExpiresAt(c: DataCollection): number {
  if (c.span === 0) return Number.POSITIVE_INFINITY;
  return c.touchedAt + c.span * MONTH_MS;
}

export function collectionAlive(c: DataCollection, now = Date.now()): boolean {
  return c.span === 0 || now < collectionExpiresAt(c);
}

export function touchCollection(c: DataCollection, now = Date.now()): DataCollection {
  return { ...c, touchedAt: now };
}

/** How long it has been quiet, and how long until it leaves. */
export function collectionLife(c: DataCollection, now = Date.now()): string {
  if (c.span === 0) {
    const quiet = (now - c.touchedAt) / MONTH_MS;
    if (quiet >= 1) {
      const q = Math.floor(quiet);
      return `Quiet for ${q} month${q === 1 ? "" : "s"} · keeps going`;
    }
    return "Keeps going";
  }
  const left = collectionExpiresAt(c) - now;
  if (left <= 0) return "Gone";
  const monthsLeft = left / MONTH_MS;
  const quiet = (now - c.touchedAt) / MONTH_MS;
  const leaves =
    monthsLeft < 1
      ? "leaves this month"
      : `leaves in ${Math.max(1, Math.ceil(monthsLeft))} month${Math.ceil(monthsLeft) === 1 ? "" : "s"}`;
  if (quiet >= 1) {
    const q = Math.floor(quiet);
    return `Quiet for ${q} month${q === 1 ? "" : "s"} · ${leaves}`;
  }
  return leaves.charAt(0).toUpperCase() + leaves.slice(1);
}

export function pieceKey(p: CollectionPiece): string {
  return p.kind === "data" ? `data:${p.ref}` : `chart:${p.id}`;
}

export function brokenPieces(
  c: DataCollection,
  known: { dataRefs: Set<string>; chartIds: Set<string> },
): CollectionPiece[] {
  return c.pieces.filter((p) =>
    p.kind === "chart" ? !known.chartIds.has(p.id) : !known.dataRefs.has(p.ref),
  );
}

export type CollectionShow = "all" | "data" | "charts" | "broken" | "empty";
export type CollectionSort = "touched" | "leaving" | "az";

export interface CollectionBrowse {
  query: string;
  show: CollectionShow;
  spans: CollectionSpan[];
  topics: SourceTopic[];
  where: FeedWhere[];
  sort: CollectionSort;
}

export const DEFAULT_COLLECTION_BROWSE: CollectionBrowse = {
  query: "",
  show: "all",
  spans: [],
  topics: [],
  where: [],
  sort: "touched",
};

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function collectionFiltersActive(s: CollectionBrowse): boolean {
  return !!(
    s.query.trim() ||
    s.show !== "all" ||
    s.spans.length ||
    s.topics.length ||
    s.where.length
  );
}

function catalogPieces(c: DataCollection) {
  return c.pieces.flatMap((p) => {
    if (p.kind !== "data") return [];
    const entry = catalogEntryFor(p.ref);
    return entry ? [entry] : [];
  });
}

/** Same facets as Discover: topic, place, text, plus what the collection holds. */
export function browseCollections(
  collections: DataCollection[],
  state: CollectionBrowse,
  known: { dataRefs: Set<string>; chartIds: Set<string> },
): DataCollection[] {
  const terms = fold(state.query)
    .split(/\s+/)
    .filter(Boolean);
  const facets = state.topics.length > 0 || state.where.length > 0;
  const geo = geosForWhere(state.where);
  const kept = collections.filter((c) => {
    if (state.spans.length && !state.spans.includes(c.span)) return false;
    if (state.show === "data" && !c.pieces.some((p) => p.kind === "data")) return false;
    if (state.show === "charts" && !c.pieces.some((p) => p.kind === "chart")) return false;
    if (state.show === "empty" && c.pieces.length > 0) return false;
    if (state.show === "broken" && brokenPieces(c, known).length === 0) return false;
    const entries = catalogPieces(c);
    if (facets && !filterCatalog(entries, { topics: state.topics, geo }).length) return false;
    if (!terms.length) return true;
    const own = fold([c.intent, ...c.pieces.map((p) => p.name)].join(" "));
    const ownHit = terms.every((t) => own.includes(t));
    const catalogHit = filterCatalog(entries, { query: state.query }).length > 0;
    return ownHit || catalogHit;
  });
  return [...kept].sort((a, b) => {
    if (state.sort === "az") return a.intent.localeCompare(b.intent);
    if (state.sort === "leaving") {
      return collectionExpiresAt(a) - collectionExpiresAt(b) || b.touchedAt - a.touchedAt;
    }
    return b.touchedAt - a.touchedAt;
  });
}

export function holdingCollection(
  collections: DataCollection[],
  ref: string,
  now = Date.now(),
): DataCollection | undefined {
  return collections.find(
    (c) =>
      collectionAlive(c, now) &&
      c.pieces.some((p) => p.kind === "data" && p.ref === ref),
  );
}
