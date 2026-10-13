// =================================================================
// commandPalette — search + phrase → Loom actions
// =================================================================
// Pure ranking for the glass omnibox. Runners live in CommandPalette.tsx
// (store / IPC). Phrase patterns let people type sentences; chips and
// keywords cover the short jumps.
// =================================================================

import { CHART_KIND_CATALOG, searchChartKinds } from "./chartKindSearch";
import { SOURCE_DEFS, type SourceKind } from "./sourceRegistry";
import {
  looksLikeAnalysisTalk,
  resolveAnalysisVernacular,
  type VernacularChartExtras,
} from "./analysisVernacular";
import type { VisualPresetId } from "./lookSystem";

export type CommandPaletteActionId =
  | "view:explorer"
  | "view:chart"
  | "view:query"
  | "view:dive"
  | "chrome:share"
  | "chrome:whats-new"
  | "chrome:settings"
  | "chrome:shortcuts"
  | "chrome:sidebar"
  | "chrome:panel"
  | "preview:schema"
  | "preview:preview"
  | "query:nl"
  | "action:encoding"
  | "action:clear-filters"
  | "action:deep-scan"
  | "action:reset-view"
  | "action:explain-column"
  | "action:lock-color"
  | "panel:stats"
  | "panel:export"
  | "panel:chart"
  | `look:${string}`
  | `chart:${string}`
  | `source:${SourceKind}`
  | `file:${string}`
  | `catalog:${string}`;

export type CommandPaletteItem = {
  id: CommandPaletteActionId;
  label: string;
  hint: string;
  /** Chip row when query is empty / short. */
  chip?: string;
  keywords: string[];
  /** Higher = preferred when scores tie. */
  weight?: number;
};

export type CommandPaletteCatalogHit = {
  url: string;
  filename: string;
  title: string;
  portal: string;
  organization?: string;
  sourceHome?: string;
  sourceCredit?: string;
};

export type CommandPaletteMatch = CommandPaletteItem & {
  score: number;
  /** When id is query:nl, the free-text ask. */
  nlAsk?: string;
  /** Open-data catalog CSV explore payload. */
  catalog?: CommandPaletteCatalogHit;
  /** Chart extras from vernacular intents (log Y, stacked, …). */
  chartExtras?: VernacularChartExtras;
  /** Column names mentioned in the query. */
  fields?: string[];
  /** Look preset id when id is look:…. */
  lookId?: VisualPresetId;
};

const STATIC_ITEMS: CommandPaletteItem[] = [
  {
    id: "view:explorer",
    label: "Open Explorer",
    hint: "Table · filters · column ink",
    chip: "explorer",
    keywords: ["explorer", "table", "grid", "data", "rows", "go to explorer", "show explorer", "open explorer"],
    weight: 8,
  },
  {
    id: "view:chart",
    label: "Open Chart",
    hint: "Story canvas",
    chip: "chart",
    keywords: ["chart", "plot", "viz", "visualization", "go to chart", "show chart", "open chart"],
    weight: 8,
  },
  {
    id: "view:query",
    label: "Open Query",
    hint: "SQL · ask in words",
    chip: "query",
    keywords: ["query", "sql", "go to query", "show query", "open query"],
    weight: 7,
  },
  {
    id: "view:dive",
    label: "Open Dive",
    hint: "Linked exploration",
    chip: "dive",
    keywords: ["dive", "go to dive", "show dive", "open dive"],
    weight: 6,
  },
  {
    id: "chrome:share",
    label: "Share story",
    hint: "Image · link · social",
    chip: "share",
    keywords: ["share", "export", "publish", "linkedin", "twitter", "share this", "share chart", "get link"],
    weight: 9,
  },
  {
    id: "chrome:whats-new",
    label: "What’s new",
    hint: "Recent Loom changes",
    keywords: ["whats new", "what's new", "changelog", "release notes"],
    weight: 3,
  },
  {
    id: "chrome:settings",
    label: "Open Settings",
    hint: "Theme · chrome · type",
    chip: "settings",
    keywords: ["settings", "preferences", "theme", "open settings"],
    weight: 5,
  },
  {
    id: "chrome:shortcuts",
    label: "Keyboard shortcuts",
    hint: "1–4 · [ ] · ?",
    keywords: ["shortcuts", "hotkeys", "help", "keyboard"],
    weight: 3,
  },
  {
    id: "chrome:sidebar",
    label: "Toggle data sidebar",
    hint: "Sources · files",
    keywords: ["sidebar", "sources", "toggle sidebar", "data panel"],
    weight: 4,
  },
  {
    id: "chrome:panel",
    label: "Toggle detail panel",
    hint: "Encoding · looks · export",
    keywords: ["panel", "detail", "encoding", "toggle panel"],
    weight: 4,
  },
  {
    id: "preview:schema",
    label: "Show Schema",
    hint: "Footer field chips → Encoding",
    chip: "schema",
    keywords: ["schema", "columns", "fields", "show schema", "open schema"],
    weight: 6,
  },
  {
    id: "preview:preview",
    label: "Show Preview",
    hint: "Footer sample rows",
    chip: "preview",
    keywords: ["preview", "sample", "show preview", "open preview"],
    weight: 5,
  },
];

const SOURCE_EXTRA_KEYWORDS: Partial<Record<SourceKind, string[]>> = {
  nwis: ["rivers", "river", "gauges", "gage", "streamflow"],
  usgs: ["quakes", "earthquakes", "seismic"],
  opensky: ["planes", "flights", "aircraft"],
  citibike: ["bike", "bikes", "nyc"],
};

const SOURCE_ITEMS: CommandPaletteItem[] = SOURCE_DEFS.map((d) => ({
  id: `source:${d.kind}` as CommandPaletteActionId,
  label: `Open ${d.label}`,
  hint: d.description.split("—")[0]?.trim() || d.group,
  chip: d.kind === "nwis" ? "rivers" : d.kind.length <= 10 ? d.kind : undefined,
  keywords: [
    d.kind,
    d.label,
    d.fileName,
    d.group,
    ...d.label.toLowerCase().split(/\s+/),
    `open ${d.label}`,
    `load ${d.label}`,
    `show ${d.label}`,
    ...(SOURCE_EXTRA_KEYWORDS[d.kind] ?? []),
  ],
  weight: 5,
}));

const CHART_ITEMS: CommandPaletteItem[] = CHART_KIND_CATALOG.map((e) => ({
  id: `chart:${e.value}` as CommandPaletteActionId,
  label: `Chart as ${e.label}`,
  hint: `${e.group} mark`,
  chip: e.value === "bar" || e.value === "line" || e.value === "scatter" || e.value === "heatmap" ? e.value : undefined,
  keywords: [
    e.value,
    e.label,
    e.group,
    `make a ${e.label}`,
    `switch to ${e.label}`,
    `use ${e.label}`,
    `${e.label} chart`,
  ],
  weight: 4,
}));

export const COMMAND_PALETTE_ITEMS: CommandPaletteItem[] = [
  ...STATIC_ITEMS,
  ...SOURCE_ITEMS,
  ...CHART_ITEMS,
];

export const COMMAND_PALETTE_CHIPS: { chip: string; id: CommandPaletteActionId }[] = (() => {
  const seen = new Set<string>();
  const out: { chip: string; id: CommandPaletteActionId }[] = [];
  for (const item of COMMAND_PALETTE_ITEMS) {
    if (!item.chip || seen.has(item.chip)) continue;
    seen.add(item.chip);
    out.push({ chip: item.chip, id: item.id });
  }
  // Prefer a short, memorable default row
  const prefer = ["explorer", "chart", "query", "share", "schema", "bar", "line", "usgs", "nwis", "settings"];
  out.sort((a, b) => {
    const ia = prefer.indexOf(a.chip);
    const ib = prefer.indexOf(b.chip);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return out.slice(0, 12);
})();

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s:/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip polite / intent wrappers so "please open chart" ≈ "open chart". */
function stripFiller(q: string): string {
  return q
    .replace(/^(please|pls|hey|ok|can you|could you|would you|i want to|i'd like to|id like to)\s+/i, "")
    .replace(/^(go to|goto|switch to|jump to|open|show|load|use|make|create|set|start)\s+(a|an|the|my)\s+/i, "$1 ")
    .replace(/^(go to|goto|switch to|jump to|open|show|load)\s+/i, "")
    .trim();
}

function scoreKeywords(item: CommandPaletteItem, q: string): number {
  if (!q) return item.weight ?? 1;
  const hay = normalize([item.label, item.hint, ...item.keywords].join(" "));
  const tokens = q.split(" ").filter(Boolean);
  let score = 0;
  for (const tok of tokens) {
    if (!hay.includes(tok)) return 0;
    if (item.keywords.some((k) => normalize(k) === tok || normalize(k).startsWith(tok))) score += 4;
    else if (normalize(item.label).includes(tok)) score += 3;
    else score += 1;
  }
  if (item.keywords.some((k) => normalize(k) === q)) score += 12;
  return score + (item.weight ?? 0) * 0.01;
}

/** Phrase shortcuts that don't need an exact keyword hit. */
function phraseMatches(raw: string, columns?: string[]): CommandPaletteMatch[] {
  const q = normalize(raw);
  const out: CommandPaletteMatch[] = [];

  // Analyst / layman / bot vernacular first — wins over generic "show me…"
  for (const v of resolveAnalysisVernacular(raw, { columns })) {
    if (v.kind) {
      out.push({
        id: `chart:${v.kind}`,
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
        chartExtras: v.extras,
        fields: v.fields,
      });
    } else if (v.look) {
      out.push({
        id: `look:${v.look}`,
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
        lookId: v.look,
      });
    } else if (v.action === "encoding") {
      out.push({
        id: "action:encoding",
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
      });
    } else if (v.action === "clear-filters") {
      out.push({
        id: "action:clear-filters",
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
      });
    } else if (v.action === "deep-scan") {
      out.push({
        id: "action:deep-scan",
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
      });
    } else if (v.action === "reset-view") {
      out.push({
        id: "action:reset-view",
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
      });
    } else if (v.action === "explain-column") {
      out.push({
        id: "action:explain-column",
        label: v.fields?.[0] ? `Explain ${v.fields[0]}` : v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
        fields: v.fields,
      });
    } else if (v.action === "lock-color") {
      out.push({
        id: "action:lock-color",
        label: v.fields?.[0] ? `Color by ${v.fields[0]}` : v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
        fields: v.fields,
      });
    } else if (v.action === "panel:stats" || v.action === "panel:export" || v.action === "panel:chart") {
      out.push({
        id: v.action,
        label: v.label,
        hint: v.hint,
        keywords: [],
        score: v.score,
      });
    }
  }

  // “open chart” / “please go to query” — view jumps beat kind synonym noise
  const viewQ = normalize(stripFiller(raw));
  const view = viewQ.match(/^(?:go to |goto |switch to |jump to |open |show )?(explorer|chart|query|dive)$/);
  if (view) {
    const id = `view:${view[1]}` as CommandPaletteActionId;
    const item = STATIC_ITEMS.find((i) => i.id === id);
    if (item) out.push({ ...item, score: 55 });
  }

  if (/\b(share|publish)\b/.test(q) && !/\bcsv\b/.test(q) && !/\bexport (png|svg|image)\b/.test(q)) {
    const item = STATIC_ITEMS.find((i) => i.id === "chrome:share");
    if (item) out.push({ ...item, score: 38 });
  }

  if (/\bschema\b/.test(q)) {
    const item = STATIC_ITEMS.find((i) => i.id === "preview:schema");
    if (item) out.push({ ...item, score: 36 });
  }

  if (/\b(settings|theme|preferences)\b/.test(q)) {
    const item = STATIC_ITEMS.find((i) => i.id === "chrome:settings");
    if (item) out.push({ ...item, score: 34 });
  }

  // Query NL — only when clearly an ask, not chart vernacular
  const ask =
    raw.match(/^(?:ask|query|sql)\s*[:\-]?\s*(.+)$/i) ||
    (!looksLikeAnalysisTalk(raw) && raw.match(/^(how many|what is|what's|what are|which)\b(.+)$/i));
  if (ask) {
    const nlAsk = (ask[1] ?? ask[0]).trim();
    if (nlAsk.length >= 2) {
      out.push({
        id: "query:nl",
        label: `Ask in Query: ${nlAsk}`,
        hint: "Opens Query with your sentence",
        keywords: [],
        score: 42,
        nlAsk,
      });
    }
  }

  // Direct kind names / synonyms (“scatterplot”, “heatmap”, …)
  const kindHit = searchChartKinds(stripFiller(q)).slice(0, 5);
  for (const k of kindHit) {
    const item = CHART_ITEMS.find((i) => i.id === `chart:${k.value}`);
    if (item) out.push({ ...item, score: 30 + (normalize(k.label) === normalize(stripFiller(q)) ? 8 : 0) });
  }

  return out;
}

export function searchCommandPalette(
  query: string,
  opts?: {
    recentPaths?: string[];
    recentLabels?: Record<string, string>;
    /** IndexedDB / vault uploads (path + name). */
    vaultFiles?: { path: string; name: string }[];
    /** Async open-data catalog hits (already fetched for this query). */
    catalogHits?: CommandPaletteCatalogHit[];
    /** Active dataset columns — enables “site vs discharge” style hits. */
    columns?: string[];
  },
): CommandPaletteMatch[] {
  const raw = query.trim();
  const q = normalize(stripFiller(raw));
  const byId = new Map<string, CommandPaletteMatch>();

  const consider = (m: CommandPaletteMatch) => {
    const prev = byId.get(m.id);
    // Prefer higher score; keep richer vernacular metadata when tied
    if (!prev || m.score > prev.score) byId.set(m.id, m);
    else if (prev && m.score === prev.score && (m.chartExtras || m.fields) && !prev.chartExtras) {
      byId.set(m.id, m);
    }
  };

  if (!q) {
    return STATIC_ITEMS.filter((i) => i.chip)
      .slice(0, 8)
      .map((i) => ({ ...i, score: i.weight ?? 1 }));
  }

  for (const m of phraseMatches(raw, opts?.columns)) consider(m);

  for (const item of COMMAND_PALETTE_ITEMS) {
    const score = scoreKeywords(item, q);
    if (score > 0) consider({ ...item, score });
  }

  // Recent files (path-keyed)
  const paths = opts?.recentPaths ?? [];
  const labels = opts?.recentLabels ?? {};
  for (const path of paths) {
    const name = labels[path] ?? path.split("/").pop() ?? path;
    const hay = normalize(`${name} ${path}`);
    const tokens = q.split(" ");
    if (!tokens.every((t) => hay.includes(t))) continue;
    consider({
      id: `file:${path}`,
      label: `Open ${name}`,
      hint: path.startsWith("stream://") ? "Live source" : "Recent file",
      keywords: [name, path],
      score: 28 + (normalize(name).startsWith(q) ? 6 : 0),
    });
  }

  // Local vault / IndexedDB uploads not already covered by recentPaths
  const recentSet = new Set(paths);
  for (const v of opts?.vaultFiles ?? []) {
    if (recentSet.has(v.path)) continue;
    const hay = normalize(`${v.name} ${v.path}`);
    const tokens = q.split(" ");
    if (!tokens.every((t) => hay.includes(t))) continue;
    consider({
      id: `file:${v.path}`,
      label: `Open ${v.name}`,
      hint: "Saved upload",
      keywords: [v.name, v.path],
      score: 26 + (normalize(v.name).startsWith(q) ? 5 : 0),
    });
  }

  for (const hit of opts?.catalogHits ?? []) {
    const id = `catalog:${hit.portal}:${hit.url}` as CommandPaletteActionId;
    consider({
      id,
      label: `Explore ${hit.title}`,
      hint: hit.organization
        ? `${hit.portal} · ${hit.organization}`
        : `${hit.portal} open data`,
      keywords: [hit.title, hit.filename],
      score: 22,
      catalog: hit,
    });
  }

  return [...byId.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 14);
}

/** True when the query looks like a dataset name worth hitting open-data catalogs. */
export function shouldSearchOpenDataCatalog(query: string): boolean {
  const q = normalize(stripFiller(query.trim()));
  if (q.length < 3) return false;
  // Skip pure command / chart-kind / analysis talk
  if (/^(share|schema|settings|shortcuts|preview|explorer|chart|query|dive|sidebar|panel)\b/.test(q)) {
    return false;
  }
  if (/^(ask|sql)\b/.test(q)) return false;
  if (/^(make|switch to|use)\s+a?\s*\w+\s*chart?$/.test(q)) return false;
  if (looksLikeAnalysisTalk(query)) return false;
  return true;
}

/** CustomEvent name — PreviewFooter listens to expand + tab. */
export const LOOM_PREVIEW_FOOTER_EVENT = "loom:preview-footer";

export type LoomPreviewFooterDetail = {
  tab: "preview" | "schema";
  expand?: boolean;
};

export function requestPreviewFooter(detail: LoomPreviewFooterDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOOM_PREVIEW_FOOTER_EVENT, { detail }));
}
