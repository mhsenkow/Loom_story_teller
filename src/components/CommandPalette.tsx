// =================================================================
// CommandPalette — glass omnibox (search + phrase actions)
// =================================================================
// Opens from the suite dock search icon or ⌘/Ctrl+K. Type a keyword
// or a short sentence; ranked actions jump views, share, chart kinds,
// live sources, Query NL, local uploads, and open-data catalog CSVs.
// =================================================================

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { useLoomStore, type FileEntry } from "@/lib/store";
import {
  COMMAND_PALETTE_CHIPS,
  COMMAND_PALETTE_ITEMS,
  requestPreviewFooter,
  searchCommandPalette,
  shouldSearchOpenDataCatalog,
  type CommandPaletteCatalogHit,
  type CommandPaletteMatch,
} from "@/lib/commandPalette";
import {
  createChartRec,
  fitEncodingToKind,
  getRandomEncoding,
  type ChartKind,
} from "@/lib/recommendations";
import { activateDataset } from "@/lib/datasetPipeline";
import { exploreFilename, leaveSourcesShowChart } from "@/components/sidebar/shared";
import {
  SOURCE_BY_KIND,
  SOURCE_EXPLORE_ROWS,
  sourceStreamPath,
  type SourceKind,
} from "@/lib/sourceRegistry";
import { fetchDataGovRecentCsv, fetchUkDataRecentCsv, sourceSnapshot, sourceStart } from "@/lib/tauri";
import { firstCsvResource } from "@/lib/openDataCatalog";
import { loadWebFileIndex } from "@/lib/webFileStore";
import { requestLoadRemoteCsv, requestOpenRecentFile } from "@/lib/loomDatasetEvents";
import { requestWhatsNew } from "@/lib/changelog";
import { VISUAL_PRESETS, type VisualPresetId } from "@/lib/lookSystem";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [vaultFiles, setVaultFiles] = useState<{ path: string; name: string }[]>([]);
  const [catalogHits, setCatalogHits] = useState<CommandPaletteCatalogHit[]>([]);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const recentFiles = useLoomStore((s) => s.recentFiles);
  const files = useLoomStore((s) => s.files);
  const columnStats = useLoomStore((s) => s.columnStats);
  const activeChart = useLoomStore((s) => s.activeChart);
  const selectedFile = useLoomStore((s) => s.selectedFile);

  const matches = useMemo(() => {
    const recentPaths = recentFiles.map((f) => f.path);
    const recentLabels = Object.fromEntries(recentFiles.map((f) => [f.path, f.name]));
    const mounted = files
      .filter((f) => !recentPaths.includes(f.path))
      .map((f) => ({ path: f.path, name: f.name }));
    return searchCommandPalette(query, {
      recentPaths,
      recentLabels,
      vaultFiles: [...vaultFiles, ...mounted],
      catalogHits,
      columns: columnStats.map((c) => c.name),
    });
  }, [query, recentFiles, files, vaultFiles, catalogHits, columnStats]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setBusy(false);
    setCatalogHits([]);
    void loadWebFileIndex()
      .then((rows) => setVaultFiles(rows.map((r) => ({ path: r.path, name: r.name }))))
      .catch(() => setVaultFiles([]));
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (active >= matches.length) setActive(Math.max(0, matches.length - 1));
  }, [active, matches.length]);

  // Debounced open-data catalog search when the query looks like a dataset name.
  useEffect(() => {
    if (!open || !shouldSearchOpenDataCatalog(query)) {
      setCatalogHits([]);
      setCatalogSearching(false);
      return;
    }
    const q = query.trim();
    let cancelled = false;
    setCatalogSearching(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const [us, uk] = await Promise.all([
            fetchDataGovRecentCsv({ query: q, rows: 8, sort: "relevance", csvOnly: true }).catch(() => []),
            fetchUkDataRecentCsv({ query: q, rows: 6, sort: "relevance", csvOnly: true }).catch(() => []),
          ]);
          if (cancelled) return;
          const hits: CommandPaletteCatalogHit[] = [];
          for (const ds of [...us, ...uk]) {
            const csv = firstCsvResource(ds);
            if (!csv) continue;
            hits.push({
              url: csv.url,
              filename: exploreFilename(ds, csv),
              title: ds.title || ds.name,
              portal: ds.portal_id,
              organization: ds.organization,
              sourceHome: ds.portal_id === "data.gov.uk"
                ? `https://www.data.gov.uk/dataset/${ds.name}`
                : `https://catalog.data.gov/dataset/${ds.name}`,
              sourceCredit: ds.organization || ds.portal_id,
            });
            if (hits.length >= 8) break;
          }
          setCatalogHits(hits);
        } catch {
          if (!cancelled) setCatalogHits([]);
        } finally {
          if (!cancelled) setCatalogSearching(false);
        }
      })();
    }, 380);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, query]);

  function resolveFileEntry(path: string): FileEntry | null {
    return (
      recentFiles.find((f) => f.path === path) ??
      files.find((f) => f.path === path) ??
      (vaultFiles.some((v) => v.path === path)
        ? {
            path,
            name: vaultFiles.find((v) => v.path === path)!.name,
            extension: path.split(".").pop() ?? "csv",
            row_count: 0,
            size_bytes: 0,
          }
        : null)
    );
  }

  async function run(match: CommandPaletteMatch | undefined) {
    if (!match || busy) return;
    const store = useLoomStore.getState();
    setBusy(true);
    try {
      const id = match.id;

      if (id.startsWith("view:")) {
        const mode = id.slice(5) as "explorer" | "chart" | "query" | "dive" | "monitor";
        store.setViewMode(mode);
        store.setToast(`${mode[0]!.toUpperCase()}${mode.slice(1)}`);
        onClose();
        return;
      }

      if (id === "chrome:share") {
        store.setShareSheetOpen(true);
        onClose();
        return;
      }
      if (id === "chrome:whats-new") {
        requestWhatsNew();
        onClose();
        return;
      }
      if (id === "chrome:settings") {
        store.setPanelTab("settings");
        store.setPanelOpen(true);
        onClose();
        return;
      }
      if (id === "chrome:shortcuts") {
        window.dispatchEvent(new CustomEvent("loom-help", { detail: { tab: "shortcuts" } }));
        onClose();
        return;
      }
      if (id === "chrome:sidebar") {
        store.toggleSidebar();
        onClose();
        return;
      }
      if (id === "chrome:panel") {
        store.togglePanel();
        onClose();
        return;
      }
      if (id === "preview:schema" || id === "preview:preview") {
        requestPreviewFooter({ tab: id === "preview:schema" ? "schema" : "preview", expand: true });
        onClose();
        return;
      }
      if (id === "query:nl") {
        const ask = match.nlAsk?.trim() || query.trim();
        store.setNlQueryInput(ask);
        store.setViewMode("query");
        store.setToast("Query — finish or edit the ask");
        onClose();
        return;
      }

      if (id === "action:encoding" || id === "panel:chart") {
        store.setViewMode("chart");
        store.setPanelTab("chart");
        store.setPanelOpen(true);
        store.setToast("Encoding");
        onClose();
        return;
      }
      if (id === "panel:stats") {
        store.setPanelTab("stats");
        store.setPanelOpen(true);
        onClose();
        return;
      }
      if (id === "panel:export") {
        store.setPanelTab("export");
        store.setPanelOpen(true);
        onClose();
        return;
      }
      if (id === "action:clear-filters") {
        store.setTableColumnFilters({});
        store.setTableFilterRowIndices(null);
        store.setTableSort(null, null);
        store.setToast("Filters cleared");
        onClose();
        return;
      }
      if (id === "action:reset-view") {
        store.resetViewCohort();
        store.setToast("View reset");
        onClose();
        return;
      }
      if (id === "action:explain-column") {
        const col =
          match.fields?.[0] ??
          columnStats.find((c) => query.toLowerCase().includes(c.name.toLowerCase()))?.name;
        if (!col) {
          store.setToast("Name a column — e.g. explain discharge_cfs");
          return;
        }
        store.setStatsFocusColumn(col);
        store.setPanelTab("stats");
        store.setPanelOpen(true);
        store.setToast(`Explain · ${col}`);
        onClose();
        return;
      }
      if (id === "action:lock-color") {
        const col =
          match.fields?.[0] ??
          columnStats.find((c) => query.toLowerCase().includes(c.name.toLowerCase()))?.name;
        if (!col) {
          store.setToast("Name a field — e.g. color by site_name");
          return;
        }
        store.setLockedColorField(col);
        if (activeChart && columnStats.length) {
          const tableName = selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data";
          const fit = fitEncodingToKind(activeChart.kind, columnStats, activeChart, {
            lockedColorField: col,
          });
          const rec = createChartRec(
            activeChart.kind,
            columnStats,
            fit.xField,
            fit.yField,
            fit.colorField,
            tableName,
          );
          if (rec) {
            store.setActiveChart(rec);
            store.setViewMode("chart");
          }
        }
        store.setToast(`Color locked · ${col}`);
        onClose();
        return;
      }
      if (id === "action:deep-scan") {
        store.setViewMode("chart");
        void store.startDeepScan();
        store.setToast("Scanning for chart ideas…");
        onClose();
        return;
      }

      if (id.startsWith("look:")) {
        const lookId = (match.lookId ?? id.slice(5)) as VisualPresetId;
        const preset = VISUAL_PRESETS[lookId];
        if (!preset) {
          store.setToast("Unknown look");
          onClose();
          return;
        }
        store.setChartVisualOverrides({ ...preset.overrides });
        store.setViewMode("chart");
        store.setToast(`Look → ${preset.name}`);
        onClose();
        return;
      }

      if (id.startsWith("chart:")) {
        const kind = id.slice(6) as ChartKind;
        if (!columnStats.length) {
          store.setViewMode("chart");
          store.setToast("Open a dataset first, then pick a chart type");
          onClose();
          return;
        }
        const tableName = selectedFile?.name?.replace(/\.[^.]+$/, "") ?? "data";
        const base = activeChart;
        const named = (match.fields ?? []).filter((f) => columnStats.some((c) => c.name === f));
        const lockedColorField = store.lockedColorField;
        const fit = base
          ? fitEncodingToKind(kind, columnStats, base, { lockedColorField })
          : {
              xField: named[0] ?? columnStats[0]?.name ?? "",
              yField: named[1] ?? columnStats[1]?.name ?? columnStats[0]?.name ?? "",
              colorField: named[2] ?? lockedColorField,
            };
        if (named[0]) fit.xField = named[0];
        if (named[1]) fit.yField = named[1];
        if (named[2]) fit.colorField = named[2];
        else if (lockedColorField) fit.colorField = lockedColorField;
        const rawExtras = match.chartExtras ?? {};
        const extras = {
          ...rawExtras,
          barStackMode: rawExtras.barStackMode ?? undefined,
        };
        let rec = createChartRec(kind, columnStats, fit.xField, fit.yField, fit.colorField, tableName, extras);
        if (!rec) {
          for (let i = 0; i < 16; i++) {
            const enc = getRandomEncoding(columnStats, kind);
            if (!enc) break;
            rec = createChartRec(kind, columnStats, enc.xField, enc.yField, enc.colorField, tableName, extras);
            if (rec) break;
          }
        }
        if (rec) {
          store.setActiveChart(rec);
          store.setViewMode("chart");
          store.setPanelTab("chart");
          store.setPanelOpen(true);
          store.setToast(`Chart → ${rec.title}`);
        } else {
          store.setToast(`Can’t build a ${kind} chart from these columns`);
        }
        onClose();
        return;
      }

      if (id.startsWith("source:")) {
        const kind = id.slice(7) as SourceKind;
        const def = SOURCE_BY_KIND[kind];
        if (!def) return;
        store.setToast(`Opening ${def.label}…`);
        await sourceStart(kind);
        const snap = await sourceSnapshot(kind, SOURCE_EXPLORE_ROWS);
        if (!snap.sample.rows.length) {
          store.setToast(`${def.label} is connecting — try again in a moment`);
          onClose();
          return;
        }
        const file = {
          path: sourceStreamPath(kind),
          name: def.fileName,
          extension: "stream",
          row_count: snap.sample.total_rows,
          size_bytes: 0,
          sourceHome: def.homepage,
          sourceCredit: def.attribution,
        };
        activateDataset({
          file,
          stats: snap.stats,
          sample: snap.sample,
          shortlist: { type: "source", kind },
        });
        store.addRecentFile(file);
        store.setLastSession({ folderPath: "web://", filePath: sourceStreamPath(kind), viewMode: "chart" });
        leaveSourcesShowChart();
        store.setToast(`Loaded ${snap.sample.rows.length} ${def.label} rows`);
        onClose();
        return;
      }

      if (id.startsWith("catalog:") && match.catalog) {
        store.setToast(`Exploring ${match.catalog.title}…`);
        requestLoadRemoteCsv({
          url: match.catalog.url,
          filename: match.catalog.filename,
          sourceCredit: match.catalog.sourceCredit,
          sourceHome: match.catalog.sourceHome,
        });
        onClose();
        return;
      }

      if (id.startsWith("file:")) {
        const path = id.slice(5);
        if (path.startsWith("stream://")) {
          const kind = path.replace(/^stream:\/\//, "") as SourceKind;
          if (SOURCE_BY_KIND[kind]) {
            await run({
              id: `source:${kind}`,
              label: match.label,
              hint: match.hint,
              keywords: [],
              score: match.score,
            });
            return;
          }
        }
        const file = resolveFileEntry(path);
        if (!file) {
          store.setToast("That file isn’t available anymore");
          onClose();
          return;
        }
        store.setToast(`Opening ${file.name}…`);
        requestOpenRecentFile(file);
        onClose();
        return;
      }
    } catch (e) {
      useLoomStore.getState().setToast(e instanceof Error ? e.message : "Command failed");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run(matches[active]);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      ariaLabel="Search and commands"
      initialFocusRef={inputRef}
      zIndex={120}
      sheetOnMobile={false}
      panelClassName="!max-w-xl !bg-transparent !border-0 !shadow-none !overflow-visible"
      className="!items-start sm:!items-start pt-[min(18vh,7rem)] sm:pt-[min(22vh,9rem)]"
    >
      <div
        className="loom-command-glass w-full rounded-2xl border border-white/15 shadow-loom-lg overflow-hidden"
        style={{
          background: "color-mix(in srgb, var(--glass-1) 88%, transparent)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
        }}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-white/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="text-loom-muted shrink-0">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Try: distribution, over time, site vs cfs, tufte, flood…"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-loom-text placeholder:text-loom-muted/80 font-mono"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <button
            type="button"
            title={listening ? "Stop listening" : "Speak a command"}
            aria-pressed={listening}
            className={`shrink-0 size-8 grid place-items-center rounded-full border transition-colors ${
              listening
                ? "border-loom-accent bg-loom-accent/20 text-loom-accent animate-pulse"
                : "border-white/15 text-loom-muted hover:text-loom-text hover:border-loom-accent/40"
            }`}
            onClick={() => {
              type SpeechRec = {
                continuous: boolean;
                interimResults: boolean;
                lang: string;
                onresult: ((ev: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
                onerror: (() => void) | null;
                onend: (() => void) | null;
                start: () => void;
                stop: () => void;
              };
              const W = window as unknown as {
                SpeechRecognition?: new () => SpeechRec;
                webkitSpeechRecognition?: new () => SpeechRec;
              };
              const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
              if (!Ctor) {
                useLoomStore.getState().setToast("Voice isn’t available in this browser");
                return;
              }
              if (listening && recognitionRef.current) {
                recognitionRef.current.stop();
                setListening(false);
                return;
              }
              const rec = new Ctor();
              rec.continuous = false;
              rec.interimResults = false;
              rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
              rec.onresult = (ev) => {
                const text = ev.results?.[0]?.[0]?.transcript?.trim();
                if (text) setQuery(text);
              };
              rec.onerror = () => setListening(false);
              rec.onend = () => setListening(false);
              recognitionRef.current = rec;
              try {
                rec.start();
                setListening(true);
              } catch {
                setListening(false);
                useLoomStore.getState().setToast("Couldn’t start the mic");
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <kbd className="shrink-0 text-[10px] font-mono tracking-wide px-1.5 py-0.5 rounded-md border border-white/15 text-loom-muted bg-black/20">
            ESC
          </kbd>
        </div>

        {query.trim() && catalogSearching && (
          <p className="px-3.5 pt-2 text-2xs font-mono text-loom-muted">Searching open data…</p>
        )}

        {!query.trim() && (
          <div className="px-3.5 pt-2.5 pb-1">
            <p className="text-2xs text-loom-muted mb-2">
              Jump · talk like analysis (“distribution”, “over time”, “share of total”) · or a dataset name
            </p>
            <div className="flex flex-wrap gap-1.5 pb-2">
              {COMMAND_PALETTE_CHIPS.map(({ chip, id }) => (
                <button
                  key={chip}
                  type="button"
                  className="px-2.5 py-1 rounded-full text-2xs font-mono border border-white/10 bg-black/25 text-loom-text hover:border-loom-accent/50 hover:bg-loom-accent/10 transition-colors"
                  onClick={() => {
                    const item = COMMAND_PALETTE_ITEMS.find((i) => i.id === id);
                    if (item) void run({ ...item, score: 1 });
                    else setQuery(chip);
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul id={listId} role="listbox" className="max-h-[min(48vh,22rem)] overflow-auto py-1">
          {matches.length === 0 ? (
            <li className="px-3.5 py-3 text-2xs text-loom-muted font-mono">No matches — try share, schema, or a source name</li>
          ) : (
            matches.map((m, i) => (
              <li key={m.id + (m.nlAsk ?? "")} role="option" aria-selected={i === active} id={`${listId}-${i}`}>
                <button
                  type="button"
                  className={`w-full text-left px-3.5 py-2.5 flex items-baseline justify-between gap-3 transition-colors ${
                    i === active ? "bg-loom-accent/15 text-loom-text" : "text-loom-text hover:bg-white/5"
                  }`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void run(m)}
                  disabled={busy}
                >
                  <span className="min-w-0">
                    <span className="block text-sm truncate">{m.label}</span>
                    <span className="block text-2xs text-loom-muted font-mono truncate">{m.hint}</span>
                  </span>
                  {i === active && (
                    <span className="text-[10px] font-mono text-loom-muted shrink-0">↵</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </Dialog>
  );
}
