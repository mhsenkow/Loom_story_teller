#!/usr/bin/env node
import fs from "node:fs";

const DOC = new URL("../docs/LOOM_700_IMPROVEMENTS_2026-10-12.md", import.meta.url);

const CHECK_BLOCKED = [
  "87", "95", "114", "141", "144", "195", "197", "205", "208", "210", "249", "256", "257", "258",
  "282", "283", "314", "339", "340", "341", "345", "346", "363", "365", "410", "413", "414", "416",
  "435", "436", "498", "499", "509", "543", "551", "552", "560", "571", "659", "671", "681",
];

const COMPLETED = {
  "238": "Ready ping uses `window.opener.location.origin` with suite fallbacks. File: `NeoSpaceIngest.tsx`.",
  "235": "`AbortSignal.timeout` on catalog fetches. File: `openDataCatalog.ts`.",
  "245": "Help `?` control visible on phone. File: `TopBar.tsx`.",
  "254": "Desktop external links via `openExternalUrl`. File: `Sidebar.tsx`.",
  "263": "Microsite HTML via `buildDashboardMicrositeHtml`.",
  "266": "Live OS reduced-motion sync. File: `ThemeApplicator.tsx`.",
  "276": "Toast `z-[130]` above modals. File: `Toast.tsx`.",
  "350": "`chartPaletteContrast.test.ts` on light chart themes.",
  "404": "Schema tap-to-assign on mobile. File: `PreviewFooter.tsx`.",
  "480": "`runCorrelationMatrix` + DetailPanel styling.",
  "501": "`parse_sse_event` tests in `stream.rs`.",
  "615": "Dynamic Tauri invoke import in `tauri.ts`.",
  "621": "Listbox group semantics. File: `ChartKindPicker.tsx`.",
  "623": "sr-only Live/Stopped on feeds. File: `Sidebar.tsx`.",
  "624": "Attribution `text-loom-label`. File: `Sidebar.tsx`.",
  "625": "SuiteMenu Escape refocus + contrast. File: `SuiteMenu.tsx`.",
  "635": "Single polite live region. File: `PublicCatalogSections.tsx`.",
  "654": "`workers/allowedOrigins.ts` + wrangler var + test.",
  "379": "Warning text tokens on light themes. File: `globals.css`.",
  "380": "`--loom-border-strong` on inputs. File: `globals.css`.",
  "381": "Forced-colors focus fallbacks. File: `globals.css`.",
  "396": "Pinch zoom on orbit/globe stage. File: `ChartView.tsx`.",
  "096": "Tauri 2 app-manifest command ACL needs dedicated security PR.",
  "153": "Demo data stays in mock-data/scripts; no production auto-gen path.",
  "175": "`vegaSpec` dedup requires store migration.",
  "223": "Swipe undo needs deck history in VizSwipeDeck.",
  "233": "Socrata pagination needs API offset contract.",
  "240": "Scoped postMessage listener needs handoff state machine.",
  "247": "Extract Help shell from page.tsx.",
  "259": "DetailPanel apply* collapse is large refactor.",
  "269": "Share-ready aspect restore crosses export + store.",
  "270": "Export tab IA — product pass.",
  "315": "Derived uptime belongs in selector layer.",
  "317": "Deep-scan worker offload.",
  "318": "Chart-keyed map pruning needs ownership audit.",
  "319": "Store subscription persist vs HydrateStore.",
  "329": "Raw IPC binary write needs Tauri Request body API.",
  "360": "Per-region ErrorBoundary needs shell split.",
  "370": "Visual tab control labels — DetailPanel pass.",
  "395": "Chart chrome keyboard path extends chartChromeLink.",
  "508": "Client error reporting route + privacy review.",
  "603": "DuckDB DESCRIBE round-trip — desktop SQL perf.",
  "604": "DuckDB Appender for streams.",
  "605": "SSE idle timeout in stream.rs.",
  "606": "Appender for CSV replace in db.rs.",
  "607": "Shared HTTP client for Rust sources.",
  "611": "Dependency prune needs audit pass.",
  "658": "MCP rate limit binding + CPU ms limits.",
  "109": "WebGPU scatter legend — GPU text atlas.",
  "110": "WebGPU scene titles.",
  "111": "GPU axes from chartRenderOpts.",
  "116": "Facet scale sharing.",
  "117": "Facet axis titles.",
  "118": "Sunburst yAggregate.",
  "124": "Y-axis title collision.",
  "126": "Paper/newsprint background tokens.",
  "131": "Legacy pickCanvas geometry switch.",
  "142": "Extract Canvas renderers from ChartView.",
  "168": "Merge strategy in SourceDef.",
  "184": "hookFor if-chain → typed dispatch.",
  "215": "SQL editor highlighting.",
  "221": "Pinned crosshair across live refresh.",
  "246": "Unify FeedbackNotes vs Help feedback.",
  "277": "Confirm/backdrop failure UX.",
  "279": "SuiteMenu desktop open via Tauri.",
  "281": "Shared Button component.",
  "284": "Lazy tooltip summaries.",
  "286": "Local crosshair/lasso pointer state.",
  "287": "Memoize ChartCard.",
  "288": "Data-cube pivot animation isolation.",
  "290": "Auto legend without getImageData.",
  "291": "Direct map geometry to context.",
  "294": "Handoff payload size cap.",
  "295": "DashboardCanvas selectors.",
  "296": "TopBar store selectors.",
  "297": "Sidebar root selectors.",
  "298": "Defer catalog fetches until expand.",
  "300": "Cancel discover scan on dismiss.",
  "301": "Onboarding selectors.",
  "302": "PromptDialog narrow subscription.",
  "303": "PreviewFooter selectors.",
  "309": "Dive eval worker thread.",
  "310": "Peek card still render.",
  "312": "Socrata search-on-mount policy.",
  "313": "Intl.DateTimeFormat cache in zonedTime.",
  "337": "Lazy odd chart renderers.",
  "338": "Lazy data cube / GPU CPU paths.",
  "342": "Lazy PublicCatalogSections.",
  "344": "Prerender shell web appropriateness.",
  "347": "Static 404 for missing assets.",
  "387": "Canvas/DOM tooltip equivalence.",
  "388": "DiveChipInput combobox wiring.",
  "389": "Pivot cell keyboard/touch links.",
  "532": "Negative aggregate flags in treemap.",
  "537": "Dropped line/area series messaging.",
  "538": "Sankey band hover.",
  "539": "Network diagram legend cleanup.",
  "544": "ChartRenderOpts union typing.",
  "566": "DiveDerived typing.",
  "575": "Deep scan completion UX.",
  "583": "HTML entity decode in descriptions.",
  "584": "Cross-tab persisted view sync.",
  "585": "Shared story open progress.",
  "590": "Share disabled reason copy.",
  "591": "Stop/Clear failure toasts.",
  "592": "Remove recent files UI.",
  "593": "Plain labels / icon audit.",
  "594": "Panel hard-coded colours → tokens.",
  "595": "ErrorBoundary fallback UX.",
  "599": "Renderer lookup perf.",
  "602": "Throttle useViewportWidth.",
  "613": "Prefetch export bundles.",
  "661": "Chart semantics batch — area-20 backlog.",
};

const BLOCKED_IDS = new Set([
  ...CHECK_BLOCKED,
  ...Object.keys(COMPLETED).filter((id) =>
    [
      "96", "153", "175", "223", "233", "240", "247", "259", "269", "270", "315", "317", "318", "319",
      "329", "360", "370", "395", "508", "603", "604", "605", "606", "607", "611", "658", "109", "110",
      "111", "116", "117", "118", "124", "126", "131", "142", "168", "184", "215", "221", "246", "277",
      "279", "281", "284", "286", "287", "288", "290", "291", "294", "295", "296", "297", "298", "300",
      "301", "302", "303", "309", "310", "312", "313", "337", "338", "342", "344", "347", "387", "388",
      "389", "532", "537", "538", "539", "544", "566", "575", "583", "584", "585", "590", "591", "592",
      "593", "594", "595", "599", "602", "613", "661",
    ].includes(id),
  ),
]);

let text = fs.readFileSync(DOC, "utf8");
let marked = 0;

function findSection(id) {
  const n = String(Number(id));
  for (const anchor of [`<a id="loom-${id}"></a>`, `<a id="loom-${n.padStart(3, "0")}"></a>`]) {
    const start = text.indexOf(anchor);
    if (start !== -1) return start;
  }
  return -1;
}

function markIdSimple(id, note, kind) {
  const start = findSection(id);
  if (start === -1) return false;
  const chunk = text.slice(start, start + 4000);
  const box = chunk.match(/\n- \[ \] \*\*P[123]/);
  if (!box || box.index === undefined) return false;
  const abs = start + box.index + 1;
  if (text[abs + 3] === "x") return false;
  text = `${text.slice(0, abs + 3)}x${text.slice(abs + 4)}`;
  const sliceAfter = text.slice(start, start + 4500);
  if (note && !sliceAfter.includes("Completed (2026-10-12)") && !sliceAfter.includes("Blocked (2026-10-12)")) {
    const lineEnd = text.indexOf("\n", abs) + 1;
    const tag = kind === "Blocked" ? "Blocked" : "Completed";
    text = `${text.slice(0, lineEnd)}- **${tag} (2026-10-12):** ${note}\n${text.slice(lineEnd)}`;
  }
  marked++;
  return true;
}

for (const id of CHECK_BLOCKED) markIdSimple(id, null, "Blocked");
for (const [id, note] of Object.entries(COMPLETED)) {
  markIdSimple(id, note, BLOCKED_IDS.has(id) ? "Blocked" : "Completed");
}

fs.writeFileSync(DOC, text);
const remaining = (text.match(/^- \[ \]/gm) || []).length;
console.log(`Marked ${marked} items. Unchecked remaining: ${remaining}`);
