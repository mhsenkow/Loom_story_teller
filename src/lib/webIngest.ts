// =================================================================
// Loom — Browser file ingest (CSV / TSV / JSON / NDJSON / Parquet / XLSX)
// =================================================================
// Turns a user File (or remote bytes) into the same inspect payload the
// web cache + charts already consume. Text formats reuse the CSV path;
// Parquet / Excel load via hyparquet and SheetJS.
// =================================================================

import {
  inspectFromTabular,
  parseCsvRecords,
  type TabularInspectDiagnostics,
} from "./mock-data";
import { parseCsvToInspectResultAsync } from "./parseCsvAsync";
import type { ColumnInfo, QueryResult } from "./store";
import {
  canonicalWebExtension,
  resolveWebFormat,
  type WebFormatId,
} from "./webFormats";

export type WebInspect = {
  stats: ColumnInfo[];
  sample: QueryResult;
  tabularDiagnostics?: TabularInspectDiagnostics;
  ndjsonDiagnostics?: NdjsonParseDiagnostics;
  xlsxMeta?: { sheet: string; date1904: boolean; sheets: string[] };
};

/** Reject full-file allocation before read (phone / tablet safety). */
export const WEB_INGEST_MAX_BYTES = 48 * 1024 * 1024;

export type NdjsonParseDiagnostics = {
  lines_total: number;
  lines_accepted: number;
  lines_skipped_malformed: number;
  lines_skipped_non_object: number;
  incomplete_final_line: boolean;
  examples: { line: number; reason: string; snippet: string }[];
};

export type WebIngestOptions = {
  signal?: AbortSignal;
  /** When set, committers must verify this still matches the active import token. */
  importId?: number;
  ndjsonMode?: "tolerant" | "strict";
  xlsxSheetName?: string;
};

export class WebIngestAbortedError extends Error {
  constructor(message = "Import cancelled") {
    super(message);
    this.name = "WebIngestAbortedError";
  }
}

function throwIfAborted(signal?: AbortSignal, importId?: number, isImportCurrent?: (id: number) => boolean) {
  if (signal?.aborted) throw new WebIngestAbortedError();
  if (importId != null && isImportCurrent && !isImportCurrent(importId)) {
    throw new WebIngestAbortedError();
  }
}

export function assertWebIngestByteBudget(sizeBytes: number, fileName: string): void {
  if (sizeBytes <= WEB_INGEST_MAX_BYTES) return;
  const mb = (WEB_INGEST_MAX_BYTES / (1024 * 1024)).toFixed(0);
  const got = (sizeBytes / (1024 * 1024)).toFixed(1);
  throw new Error(
    `“${fileName}” is ${got} MB — browser imports are limited to ${mb} MB. Use the desktop app for very large files.`,
  );
}

function cellScalar(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function objectsToTabular(
  objs: Record<string, unknown>[],
): { columns: string[]; rows: (string | number | boolean | null)[][] } {
  const colSet = new Set<string>();
  for (const o of objs) {
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const k of Object.keys(o)) colSet.add(k);
    }
  }
  const columns = [...colSet];
  const rows = objs.map((o) => columns.map((c) => cellScalar(o?.[c])));
  return { columns, rows };
}

function wrapInspect(result: ReturnType<typeof inspectFromTabular>): WebInspect {
  const { diagnostics, ...rest } = result;
  return { ...rest, tabularDiagnostics: diagnostics };
}

function parseJsonTextInner(text: string): WebInspect {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }

  // NDJSON / JSONL: one object per line
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return parseNdjsonText(trimmed);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some “.json” dumps are actually newline-delimited
    return parseNdjsonText(trimmed);
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
    }
    if (Array.isArray(parsed[0])) {
      const header = (parsed[0] as unknown[]).map((c) => (c == null ? "" : String(c)));
      const body = parsed.slice(1) as unknown[][];
      return wrapInspect(
        inspectFromTabular(
          header,
          body.map((r) => header.map((_, i) => cellScalar(r[i]))),
        ),
      );
    }
    if (parsed.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      const { columns, rows } = objectsToTabular(parsed as Record<string, unknown>[]);
      return wrapInspect(inspectFromTabular(columns, rows));
    }
    return wrapInspect(
      inspectFromTabular(
        ["value"],
        parsed.map((v) => [cellScalar(v)]),
      ),
    );
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Columnar: { a: [...], b: [...] }
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every((k) => Array.isArray(obj[k]))) {
      const columns = keys;
      const len = Math.max(...columns.map((k) => (obj[k] as unknown[]).length), 0);
      const rows: (string | number | boolean | null)[][] = [];
      for (let i = 0; i < len; i++) {
        rows.push(columns.map((k) => cellScalar((obj[k] as unknown[])[i])));
      }
      return wrapInspect(inspectFromTabular(columns, rows));
    }
    // Nested { data: [...] } / { records: [...] } / { rows: [...] }
    for (const nest of ["data", "records", "rows", "results", "items"]) {
      const inner = obj[nest];
      if (Array.isArray(inner) && inner.length > 0) {
        return parseJsonTextInner(JSON.stringify(inner));
      }
    }
    const { columns, rows } = objectsToTabular([obj]);
    return wrapInspect(inspectFromTabular(columns, rows));
  }

  throw new Error("JSON did not contain a table (array of objects or columnar map).");
}

const NDJSON_EXAMPLE_CAP = 5;

export function parseNdjsonText(
  text: string,
  mode: "tolerant" | "strict" = "tolerant",
): WebInspect {
  const lines = text.split(/\r?\n/);
  const objs: Record<string, unknown>[] = [];
  const examples: NdjsonParseDiagnostics["examples"] = [];
  let lines_skipped_malformed = 0;
  let lines_skipped_non_object = 0;
  let lines_accepted = 0;
  let incomplete_final_line = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (!t) continue;
    const lineNo = i + 1;
    try {
      const v = JSON.parse(t) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        lines_skipped_non_object += 1;
        if (examples.length < NDJSON_EXAMPLE_CAP) {
          examples.push({
            line: lineNo,
            reason: "not a JSON object",
            snippet: t.slice(0, 80),
          });
        }
        if (mode === "strict") {
          throw new Error(`NDJSON line ${lineNo}: expected a JSON object`);
        }
        continue;
      }
      objs.push(v as Record<string, unknown>);
      lines_accepted += 1;
    } catch (e) {
      lines_skipped_malformed += 1;
      if (examples.length < NDJSON_EXAMPLE_CAP) {
        examples.push({
          line: lineNo,
          reason: e instanceof Error ? e.message : "invalid JSON",
          snippet: t.slice(0, 80),
        });
      }
      if (mode === "strict") {
        throw new Error(`NDJSON line ${lineNo}: ${e instanceof Error ? e.message : "invalid JSON"}`);
      }
    }
  }

  const lastNonEmpty = [...lines].reverse().find((l) => l.trim());
  if (lastNonEmpty != null) {
    try {
      JSON.parse(lastNonEmpty.trim());
    } catch {
      const lastLineNo = lines.findIndex((l) => l === lastNonEmpty) + 1;
      const failedLast = examples.some((e) => e.line === lastLineNo);
      if (failedLast && !lastNonEmpty.trim().endsWith("}")) {
        incomplete_final_line = true;
      }
    }
  }

  const ndjsonDiagnostics: NdjsonParseDiagnostics = {
    lines_total: lines.filter((l) => l.trim()).length,
    lines_accepted,
    lines_skipped_malformed,
    lines_skipped_non_object,
    incomplete_final_line,
    examples,
  };

  if (!objs.length) {
    return {
      stats: [],
      sample: { columns: [], types: [], rows: [], total_rows: 0 },
      ndjsonDiagnostics,
    };
  }
  const { columns, rows } = objectsToTabular(objs);
  const wrapped = wrapInspect(inspectFromTabular(columns, rows));
  return { ...wrapped, ndjsonDiagnostics };
}

function parseJsonText(text: string): WebInspect {
  return parseJsonTextInner(text);
}

async function parseParquetBuffer(buf: ArrayBuffer, signal?: AbortSignal): Promise<WebInspect> {
  throwIfAborted(signal);
  const { parquetReadObjects } = await import("hyparquet");
  throwIfAborted(signal);
  const file = {
    byteLength: buf.byteLength,
    slice: (start: number, end?: number) => buf.slice(start, end),
  };
  const objects = await parquetReadObjects({ file });
  throwIfAborted(signal);
  if (!objects.length) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }
  const { columns, rows } = objectsToTabular(objects as Record<string, unknown>[]);
  return wrapInspect(inspectFromTabular(columns, rows));
}

export async function listXlsxSheetNames(buf: ArrayBuffer): Promise<string[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", bookSheets: true });
  return wb.SheetNames ?? [];
}

async function parseXlsxBuffer(
  buf: ArrayBuffer,
  signal?: AbortSignal,
  sheetName?: string,
): Promise<WebInspect> {
  throwIfAborted(signal);
  const XLSX = await import("xlsx");
  throwIfAborted(signal);
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const use1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const picked = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const sheetNameResolved = picked;
  if (!sheetNameResolved) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }
  const sheet = wb.Sheets[sheetNameResolved]!;
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as (string | number | boolean | null)[][];
  throwIfAborted(signal);
  if (!matrix.length) {
    return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
  }
  const headerRow = matrix[0] ?? [];
  const width = Math.max(headerRow.length, ...matrix.map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => {
    const h = headerRow[i];
    return h == null ? "" : String(h);
  });
  const body = matrix.slice(1).map((r) => header.map((_, i) => cellScalar(r[i])));
  const inspect = wrapInspect(inspectFromTabular(header, body));
  return {
    ...inspect,
    xlsxMeta: { sheet: sheetNameResolved, date1904: use1904, sheets: wb.SheetNames },
  };
}

async function parseDelimitedText(text: string, formatId: WebFormatId): Promise<WebInspect> {
  if (formatId === "tsv") {
    const records = parseCsvRecords(text, "\t");
    if (!records.length) {
      return { stats: [], sample: { columns: [], types: [], rows: [], total_rows: 0 } };
    }
    const columns = records[0]!.map((c) => c.trim());
    return wrapInspect(inspectFromTabular(columns, records.slice(1)));
  }
  const { stats, sample, diagnostics } = await parseCsvToInspectResultAsync("data.csv", text);
  return { stats, sample, tabularDiagnostics: diagnostics };
}

/** Ingest a browser File into stats + sample rows. */
export async function ingestWebFile(
  file: File,
  options?: WebIngestOptions & { isImportCurrent?: (id: number) => boolean },
): Promise<{
  inspect: WebInspect;
  extension: string;
  formatId: WebFormatId;
}> {
  const fmt = resolveWebFormat(file.name);
  if (!fmt) {
    throw new Error(
      `Unsupported file type “${file.name}”. Try CSV, TSV, JSON, NDJSON, Parquet, or Excel (.xlsx).`,
    );
  }

  assertWebIngestByteBudget(file.size, file.name);
  const { signal, importId, isImportCurrent, ndjsonMode } = options ?? {};
  throwIfAborted(signal, importId, isImportCurrent);

  if (fmt.id === "parquet") {
    const buf = await file.arrayBuffer();
    throwIfAborted(signal, importId, isImportCurrent);
    return { inspect: await parseParquetBuffer(buf, signal), extension: "parquet", formatId: "parquet" };
  }
  if (fmt.id === "xlsx") {
    const buf = await file.arrayBuffer();
    throwIfAborted(signal, importId, isImportCurrent);
    return {
      inspect: await parseXlsxBuffer(buf, signal, options?.xlsxSheetName),
      extension: "xlsx",
      formatId: "xlsx",
    };
  }
  if (fmt.id === "json") {
    const text = await file.text();
    throwIfAborted(signal, importId, isImportCurrent);
    return { inspect: parseJsonText(text), extension: "json", formatId: "json" };
  }
  if (fmt.id === "ndjson" || fmt.id === "jsonl") {
    const text = await file.text();
    throwIfAborted(signal, importId, isImportCurrent);
    return {
      inspect: parseNdjsonText(text, ndjsonMode ?? "tolerant"),
      extension: fmt.id,
      formatId: fmt.id,
    };
  }
  const text = await file.text();
  throwIfAborted(signal, importId, isImportCurrent);
  return {
    inspect: await parseDelimitedText(text, fmt.id),
    extension: canonicalWebExtension(file.name),
    formatId: fmt.id,
  };
}

/** Ingest remote / pasted text when the URL extension is known. */
export async function ingestWebBytes(
  name: string,
  payload: { text?: string; buffer?: ArrayBuffer },
  options?: WebIngestOptions,
): Promise<{ inspect: WebInspect; extension: string; formatId: WebFormatId }> {
  const fmt = resolveWebFormat(name);
  const byteLen = payload.buffer?.byteLength ?? (payload.text != null ? payload.text.length : 0);
  if (byteLen > 0) assertWebIngestByteBudget(byteLen, name);

  if (!fmt) {
    if (payload.text != null) {
      const { stats, sample, diagnostics } = await parseCsvToInspectResultAsync(name, payload.text);
      return {
        inspect: { stats, sample, tabularDiagnostics: diagnostics },
        extension: "csv",
        formatId: "csv",
      };
    }
    throw new Error(`Unsupported remote file “${name}”.`);
  }
  if (fmt.id === "parquet") {
    if (!payload.buffer) throw new Error("Parquet needs binary bytes.");
    return {
      inspect: await parseParquetBuffer(payload.buffer, options?.signal),
      extension: "parquet",
      formatId: "parquet",
    };
  }
  if (fmt.id === "xlsx") {
    if (!payload.buffer) throw new Error("Excel needs binary bytes.");
    return {
      inspect: await parseXlsxBuffer(payload.buffer, options?.signal),
      extension: "xlsx",
      formatId: "xlsx",
    };
  }
  const text = payload.text ?? new TextDecoder().decode(payload.buffer);
  if (fmt.id === "json") {
    return { inspect: parseJsonText(text), extension: "json", formatId: "json" };
  }
  if (fmt.id === "ndjson" || fmt.id === "jsonl") {
    return {
      inspect: parseNdjsonText(text, options?.ndjsonMode ?? "tolerant"),
      extension: fmt.id,
      formatId: fmt.id,
    };
  }
  return {
    inspect: await parseDelimitedText(text, fmt.id),
    extension: canonicalWebExtension(name),
    formatId: fmt.id,
  };
}

export { parseJsonText };
