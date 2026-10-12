// =================================================================
// Loom — Web upload format registry
// =================================================================
// Single source of truth for which tabular files the browser can open.
// Desktop DuckDB still owns folder scan; this list drives pickers,
// ingest routing, and status-bar icons on the web path.
// =================================================================

export type WebFormatId =
  | "csv"
  | "tsv"
  | "json"
  | "ndjson"
  | "jsonl"
  | "parquet"
  | "xlsx";

export type WebFormatDef = {
  id: WebFormatId;
  /** File extensions without the leading dot (lowercase). */
  extensions: string[];
  /** MIME types accepted by `<input accept>` / showOpenFilePicker. */
  mimeTypes: string[];
  label: string;
  /** Text = needs ArrayBuffer (parquet / xlsx); true = UTF-8 text. */
  text: boolean;
};

export const WEB_FORMATS: readonly WebFormatDef[] = [
  {
    id: "csv",
    extensions: ["csv"],
    mimeTypes: ["text/csv", "text/plain", "application/csv"],
    label: "CSV",
    text: true,
  },
  {
    id: "tsv",
    extensions: ["tsv", "tab"],
    mimeTypes: ["text/tab-separated-values", "text/plain"],
    label: "TSV",
    text: true,
  },
  {
    id: "json",
    extensions: ["json"],
    mimeTypes: ["application/json", "text/json"],
    label: "JSON",
    text: true,
  },
  {
    id: "ndjson",
    extensions: ["ndjson"],
    mimeTypes: ["application/x-ndjson", "application/jsonlines", "text/plain"],
    label: "NDJSON",
    text: true,
  },
  {
    id: "jsonl",
    extensions: ["jsonl"],
    mimeTypes: ["application/jsonl", "application/x-ndjson", "text/plain"],
    label: "JSONL",
    text: true,
  },
  {
    id: "parquet",
    extensions: ["parquet"],
    mimeTypes: ["application/vnd.apache.parquet", "application/octet-stream"],
    label: "Parquet",
    text: false,
  },
  {
    id: "xlsx",
    extensions: ["xlsx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    label: "Excel",
    text: false,
  },
] as const;

const EXT_TO_FORMAT = new Map<string, WebFormatDef>();
for (const f of WEB_FORMATS) {
  for (const ext of f.extensions) EXT_TO_FORMAT.set(ext, f);
}

/** Dot-prefixed accept string for `<input type="file">`. */
export const WEB_FILE_ACCEPT = WEB_FORMATS.flatMap((f) =>
  f.extensions.map((e) => `.${e}`),
).join(",");

/** Human label for buttons / empty states. */
export const WEB_FILE_ACCEPT_LABEL = "CSV, TSV, JSON, Parquet, Excel";

export function extensionOfFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  if (i < 0) return "";
  return base.slice(i + 1).toLowerCase();
}

export function resolveWebFormat(fileName: string): WebFormatDef | null {
  return EXT_TO_FORMAT.get(extensionOfFileName(fileName)) ?? null;
}

export function isSupportedWebUpload(fileName: string): boolean {
  return resolveWebFormat(fileName) != null;
}

/** Canonical storage extension (e.g. `.tab` → `tsv`). */
export function canonicalWebExtension(fileName: string): string {
  const fmt = resolveWebFormat(fileName);
  return fmt?.id ?? (extensionOfFileName(fileName) || "csv");
}
