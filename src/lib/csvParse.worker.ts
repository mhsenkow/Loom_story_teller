// =================================================================
// CSV parse worker — keeps large imports off the main thread (LOOM-080)
// =================================================================

import { parseCsvToInspectResult, type TabularInspectDiagnostics } from "./mock-data";
import type { ColumnInfo, QueryResult } from "./queryTypes";

export type CsvWorkerRequest = {
  id: number;
  name: string;
  text: string;
  maxRows?: number;
};

export type CsvWorkerResponse =
  | {
      id: number;
      ok: true;
      result: {
        stats: ColumnInfo[];
        sample: QueryResult;
        diagnostics: TabularInspectDiagnostics;
      };
    }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<CsvWorkerRequest>) => {
  const { id, name, text, maxRows } = ev.data;
  try {
    const result = parseCsvToInspectResult(name, text, maxRows);
    const msg: CsvWorkerResponse = { id, ok: true, result };
    self.postMessage(msg);
  } catch (e) {
    const msg: CsvWorkerResponse = {
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(msg);
  }
};
