"use client";

import type { DataGovDataset, DataGovSortKey } from "@/lib/tauri";

/** Tauri invoke rejects with string errors from Rust — normalize for UI. */
export function ipcErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** User-facing error text: network failures read as "offline", others fall back to the IPC message. */
export function friendlyError(e: unknown): string {
  // fetch() rejects with TypeError ("Failed to fetch" / "Load failed" / "NetworkError …") when offline or the
  // host never answers. Other TypeErrors are bugs or bad data, not connectivity, so keep their message.
  if (e instanceof TypeError && /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(e.message)) {
    return "you're offline or the server didn't answer";
  }
  return ipcErrorMessage(e);
}

/** Save-to-folder writes .csv bytes — only safe for real CSV URLs. */
export function dataGovResourceSaveable(res: { format: string; url: string }): boolean {
  return res.format === "CSV" || /\.csv(\?|$)/i.test(res.url);
}

/** Leave Data & sources full-screen and show the chart canvas (esp. mobile). */
export { leaveSourcesShowChart } from "@/lib/shellHandoff";

/** One-click public CSV packs — defined in `@/lib/curatedPacks`. */
export { CURATED_OPEN_PACKS } from "@/lib/curatedPacks";

export const DATA_GOV_ROW_OPTIONS = [40, 80, 120, 200] as const;

export const DATA_GOV_SORT_OPTIONS: { value: DataGovSortKey; label: string }[] = [
  { value: "newest", label: "Newest listed" },
  { value: "updated", label: "Recently updated" },
  { value: "relevance", label: "Relevance" },
  { value: "title_az", label: "Title A–Z" },
  { value: "title_za", label: "Title Z–A" },
];

export function filterDatasetsLocal(datasets: DataGovDataset[], text: string): DataGovDataset[] {
  const q = text.trim().toLowerCase();
  if (!q) return datasets;
  return datasets.filter((d) => {
    const hay = `${d.title} ${d.organization ?? ""} ${d.name}`.toLowerCase();
    return hay.includes(q);
  });
}

export function exploreFilename(ds: DataGovDataset, res: { name: string }): string {
  const base = res.name !== "CSV" ? res.name : ds.title;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return cleaned.toLowerCase().endsWith(".csv") ? cleaned : `${cleaned}.csv`;
}

export function SectionHeading({
  title,
  lede,
  meta,
}: {
  title: string;
  lede?: string;
  meta?: string;
}) {
  return (
    <div className="px-1 mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-loom-text tracking-tight">{title}</h3>
        {meta && <span className="text-2xs text-loom-muted tabular-nums shrink-0">{meta}</span>}
      </div>
      {lede && <p className="text-2xs text-loom-muted mt-0.5 leading-snug max-w-[36ch]">{lede}</p>}
    </div>
  );
}
