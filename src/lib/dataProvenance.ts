// =================================================================
// Data provenance — pathway back to the origin of whatever is open
// =================================================================
// Stats (and share/export) need a durable credit trail: live feed home,
// catalog CSV URL, curated pack credit, or a frozen share snapshot.
// Pure: resolve from FileEntry (+ optional sample counts); no React.
// =================================================================

import {
  SOURCE_BY_KIND,
  sourceKindFromPath,
  type SourceKind,
} from "./sourceRegistry";
import type { FileEntry } from "./store";

export interface ProvenanceLink {
  label: string;
  href: string;
  /** Primary CTA (homepage / catalog page) vs raw data file. */
  kind: "home" | "data" | "page";
}

export interface DataProvenance {
  /** Short title shown in the panel. */
  title: string;
  /** One-line credit (attribution). */
  credit: string | null;
  /** How this dataset arrived (live / catalog / pack / shared / local). */
  kind: "live" | "wiki" | "catalog" | "shared" | "local" | "demo";
  /** Original logical path (`stream://usgs`, `web://…`, `file:…`). */
  path: string;
  /** When a share snapshot was frozen (ISO). */
  capturedAt: string | null;
  /** Rows currently loaded vs declared total, when known. */
  rowsLabel: string | null;
  links: ProvenanceLink[];
}

const WIKI_HOME = "https://www.wikimedia.org/";
const WIKI_CREDIT = "Wikimedia recent changes · CC BY-SA";

/** Guess a human homepage from a raw CSV / API URL when we only have the file. */
export function guessHomepageFromDataUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("ourworldindata.org")) {
      // grapher CSV → grapher page
      const m = u.pathname.match(/\/grapher\/([^/.]+)/);
      if (m) return `https://ourworldindata.org/grapher/${m[1]}`;
      return "https://ourworldindata.org/";
    }
    if (u.hostname.includes("earthquake.usgs.gov")) return "https://earthquake.usgs.gov/";
    if (u.hostname.includes("exoplanetarchive.ipac.caltech.edu")) {
      return "https://exoplanetarchive.ipac.caltech.edu/";
    }
    if (u.hostname.includes("github.com") || u.hostname.includes("githubusercontent.com")) {
      // raw.githubusercontent.com/org/repo/... → github.com/org/repo
      const parts = u.pathname.split("/").filter(Boolean);
      if (u.hostname.includes("githubusercontent.com") && parts.length >= 2) {
        return `https://github.com/${parts[0]}/${parts[1]}`;
      }
      if (parts.length >= 2) return `https://github.com/${parts[0]}/${parts[1]}`;
    }
    if (u.hostname.includes("data.gov")) return u.origin + u.pathname.replace(/\/resource\/.*$/, "");
    // Strip query; prefer directory for raw files
    if (u.pathname.endsWith(".csv") || u.pathname.endsWith(".json")) {
      return `${u.origin}/`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function liveFromKind(kind: SourceKind, file: FileEntry): DataProvenance {
  const def = SOURCE_BY_KIND[kind];
  return {
    title: def.fileName,
    credit: def.attribution,
    kind: "live",
    path: file.originPath || file.path,
    capturedAt: file.capturedAt ?? null,
    rowsLabel: null,
    links: [
      { label: "Source website", href: def.homepage, kind: "home" },
      ...(file.sourceUrl
        ? [{ label: "Data URL", href: file.sourceUrl, kind: "data" as const }]
        : []),
    ],
  };
}

/**
 * Resolve provenance for the open file. Prefers explicit FileEntry lineage
 * fields, then stream registry, then sourceUrl heuristics.
 */
export function resolveDataProvenance(
  file: FileEntry | null | undefined,
  opts?: { loadedRows?: number | null; totalRows?: number | null },
): DataProvenance | null {
  if (!file) return null;

  const origin = file.originPath || file.path;
  const kindFromPath = sourceKindFromPath(origin);
  const shared = file.path.startsWith("web://shared/");
  const wiki = origin === "stream://wiki" || file.path === "stream://wiki";
  const mock = origin.startsWith("mock://") || file.path.startsWith("mock://");
  const web = origin.startsWith("web://") || file.path.startsWith("web://");
  const stream = origin.startsWith("stream://");

  let base: DataProvenance;

  // Frozen share snapshots win over live-feed origin labeling.
  if (shared) {
    const dataUrl = file.sourceUrl ?? null;
    const home =
      file.sourceHome ||
      (kindFromPath ? SOURCE_BY_KIND[kindFromPath].homepage : null) ||
      (wiki ? WIKI_HOME : null) ||
      (dataUrl ? guessHomepageFromDataUrl(dataUrl) : null);
    const credit =
      file.sourceCredit ||
      (kindFromPath ? SOURCE_BY_KIND[kindFromPath].attribution : null) ||
      (wiki ? WIKI_CREDIT : null) ||
      "Shared snapshot";
    base = {
      title: file.name.replace(/\s*\(shared\)\s*$/i, "") || "Dataset",
      credit,
      kind: "shared",
      path: origin,
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: [
        ...(home ? [{ label: "Source website", href: home, kind: "home" as const }] : []),
        ...(dataUrl ? [{ label: "Raw data", href: dataUrl, kind: "data" as const }] : []),
      ],
    };
  } else if (kindFromPath) {
    base = liveFromKind(kindFromPath, file);
  } else if (wiki) {
    base = {
      title: file.name || "Wikipedia Live",
      credit: WIKI_CREDIT,
      kind: "wiki",
      path: "stream://wiki",
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: [{ label: "Wikimedia", href: WIKI_HOME, kind: "home" }],
    };
  } else if (mock) {
    base = {
      title: file.name,
      credit: "Loom demo pack",
      kind: "demo",
      path: origin,
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: [],
    };
  } else if (web) {
    const dataUrl = file.sourceUrl ?? null;
    const home = file.sourceHome || (dataUrl ? guessHomepageFromDataUrl(dataUrl) : null);
    base = {
      title: file.name.replace(/\s*\(shared\)\s*$/i, "") || "Dataset",
      credit: file.sourceCredit ?? null,
      kind: "catalog",
      path: origin,
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: [
        ...(home ? [{ label: "Source website", href: home, kind: "home" as const }] : []),
        ...(dataUrl ? [{ label: "Raw data", href: dataUrl, kind: "data" as const }] : []),
      ],
    };
  } else if (stream) {
    base = {
      title: file.name,
      credit: file.sourceCredit ?? null,
      kind: "live",
      path: origin,
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: file.sourceHome
        ? [{ label: "Source website", href: file.sourceHome, kind: "home" }]
        : [],
    };
  } else {
    // Local file — still surface path + any attached remote URL
    const dataUrl = file.sourceUrl ?? null;
    const home = file.sourceHome || (dataUrl ? guessHomepageFromDataUrl(dataUrl) : null);
    base = {
      title: file.name,
      credit: file.sourceCredit ?? "Local file",
      kind: "local",
      path: origin,
      capturedAt: file.capturedAt ?? null,
      rowsLabel: null,
      links: [
        ...(home ? [{ label: "Source website", href: home, kind: "home" as const }] : []),
        ...(dataUrl ? [{ label: "Data URL", href: dataUrl, kind: "data" as const }] : []),
      ],
    };
  }

  // Explicit overrides from FileEntry win
  if (file.sourceCredit) base.credit = file.sourceCredit;
  if (file.sourceHome && !base.links.some((l) => l.href === file.sourceHome)) {
    base.links = [{ label: "Source website", href: file.sourceHome, kind: "home" }, ...base.links];
  }
  if (file.capturedAt) base.capturedAt = file.capturedAt;

  const loaded = opts?.loadedRows;
  const total = opts?.totalRows ?? file.row_count;
  if (typeof loaded === "number" && loaded > 0) {
    if (typeof total === "number" && total > loaded) {
      base.rowsLabel = `${loaded.toLocaleString()} of ${total.toLocaleString()} rows`;
    } else {
      base.rowsLabel = `${loaded.toLocaleString()} rows`;
    }
  } else if (typeof total === "number" && total > 0) {
    base.rowsLabel = `${total.toLocaleString()} rows`;
  }

  // Dedupe links by href
  const seen = new Set<string>();
  base.links = base.links.filter((l) => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });

  return base;
}

export function provenanceKindLabel(kind: DataProvenance["kind"]): string {
  switch (kind) {
    case "live":
      return "Live feed";
    case "wiki":
      return "Live stream";
    case "catalog":
      return "Open data";
    case "shared":
      return "Shared snapshot";
    case "demo":
      return "Demo";
    case "local":
      return "Local file";
  }
}

export type SourceFootnoteMode = "off" | "name" | "credit" | "full";

/** One-line chart / export footnote from resolved provenance. */
export function formatSourceFootnote(
  p: DataProvenance,
  mode: Exclude<SourceFootnoteMode, "off">,
): string {
  const host = (() => {
    const home = p.links.find((l) => l.kind === "home")?.href ?? p.links[0]?.href;
    if (!home) return null;
    try {
      return new URL(home).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  if (mode === "name") return p.title;
  if (mode === "credit") {
    return [p.title, p.credit].filter(Boolean).join(" · ");
  }
  const when = p.capturedAt
    ? `as of ${new Date(p.capturedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`
    : null;
  return [p.title, p.credit, host, when, p.rowsLabel].filter(Boolean).join(" · ");
}
