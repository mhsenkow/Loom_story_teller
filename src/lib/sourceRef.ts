// =================================================================
// Loom — SourceRef: one stable id for anything a person can browse
// =================================================================
// Feeds, curated packs, catalog datasets, and user files each had their own
// identifier (SourceKind, pack.id, Socrata domain/id, FileEntry.path).
// Preferences, Collections, and Metrics key on a single string instead:
//
//   feed:<kind>              poll feed or the Wikipedia stream (`feed:wiki`)
//   pack:<id>                curated open pack
//   socrata:<domain>/<id>    Socrata dataset (4x4 id)
//   ckan:<portal>/<id>       Data.gov / data.gov.uk dataset
//   tt:<date>/<file>         TidyTuesday file
//   file:<path>              anything else (desktop path, web://, mock://)
//
// Pure — no store or DOM imports.
// =================================================================

import { CURATED_OPEN_PACKS } from "./curatedPacks";
import { isSourceKind, sourceStreamPath, type SourceKind } from "./sourceRegistry";

export type SourceRef = string;

export type SourceRefScheme = "feed" | "pack" | "socrata" | "ckan" | "tt" | "file";

export type FeedKind = SourceKind | "wiki";

export interface ParsedSourceRef {
  scheme: SourceRefScheme;
  /** Everything after `<scheme>:` (kind, pack id, `domain/id`, path, …). */
  id: string;
}

const SCHEMES: readonly SourceRefScheme[] = ["feed", "pack", "socrata", "ckan", "tt", "file"];

export function parseSourceRef(ref: string | null | undefined): ParsedSourceRef | null {
  if (!ref) return null;
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  const scheme = ref.slice(0, i) as SourceRefScheme;
  const id = ref.slice(i + 1);
  if (!SCHEMES.includes(scheme) || !id) return null;
  if (scheme === "feed" && id !== "wiki" && !isSourceKind(id)) return null;
  return { scheme, id };
}

export function isSourceRef(v: unknown): v is SourceRef {
  return typeof v === "string" && parseSourceRef(v) != null;
}

export const feedRef = (kind: FeedKind): SourceRef => `feed:${kind}`;
export const packRef = (id: string): SourceRef => `pack:${id}`;
export const socrataRef = (domain: string, id: string): SourceRef => `socrata:${domain.toLowerCase()}/${id}`;
export const ckanRef = (portal: string, id: string): SourceRef => `ckan:${portal}/${id}`;
export const tidyTuesdayRef = (date: string, file: string): SourceRef => `tt:${date}/${file}`;
export const fileRef = (path: string): SourceRef => `file:${path}`;

/** Feed kind for `feed:` refs, else null. */
export function feedKindFromRef(ref: SourceRef | null | undefined): FeedKind | null {
  const p = parseSourceRef(ref);
  return p?.scheme === "feed" ? (p.id as FeedKind) : null;
}

const PACK_BY_URL = new Map(CURATED_OPEN_PACKS.map((p) => [p.url, p.id]));

const SOCRATA_RESOURCE = /^https:\/\/([a-z0-9.-]+)\/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.(?:csv|json)(?:[?#]|$)/i;
const TIDYTUESDAY_FILE =
  /^https:\/\/raw\.githubusercontent\.com\/rfordatascience\/tidytuesday\/[^/]+\/data\/\d{4}\/(\d{4}-\d{2}-\d{2})\/([^/?#]+)/;

/** Catalog ref for a remote CSV URL Loom knows how to recognize, else null. */
export function refForSourceUrl(url: string | null | undefined): SourceRef | null {
  if (!url) return null;
  const pack = PACK_BY_URL.get(url);
  if (pack) return packRef(pack);
  const soda = SOCRATA_RESOURCE.exec(url);
  if (soda) return socrataRef(soda[1]!, soda[2]!.toLowerCase());
  const tt = TIDYTUESDAY_FILE.exec(url);
  if (tt) return tidyTuesdayRef(tt[1]!, decodeURIComponent(tt[2]!));
  return null;
}

/**
 * Stable ref for an open dataset: `stream://` paths are feeds, files loaded
 * from a recognized catalog URL keep that catalog's ref, the rest are files.
 */
export function refForPath(path: string, entry?: { sourceUrl?: string } | null): SourceRef {
  if (path === "stream://wiki") return feedRef("wiki");
  const m = /^stream:\/\/([a-z0-9_]+)$/.exec(path);
  if (m && isSourceKind(m[1]!)) return feedRef(m[1]);
  return refForSourceUrl(entry?.sourceUrl) ?? fileRef(path);
}

/** Dataset path a ref opens directly (feeds and files); catalog refs need a fetch → null. */
export function pathForRef(ref: SourceRef): string | null {
  const p = parseSourceRef(ref);
  if (!p) return null;
  if (p.scheme === "feed") return p.id === "wiki" ? "stream://wiki" : sourceStreamPath(p.id as SourceKind);
  if (p.scheme === "file") return p.id;
  return null;
}
