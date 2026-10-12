// =================================================================
// Async CSV inspect — Web Worker in browser, sync fallback in Node/tests
// =================================================================

import { parseCsvToInspectResult } from "./mock-data";
import type { ColumnInfo, QueryResult } from "./queryTypes";
import type { TabularInspectDiagnostics } from "./mock-data";
import type { CsvWorkerRequest, CsvWorkerResponse } from "./csvParse.worker";

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./csvParse.worker.ts", import.meta.url));
  }
  return worker;
}

export type ParseCsvProgress = { phase: "parsing" | "done" };

export async function parseCsvToInspectResultAsync(
  name: string,
  text: string,
  maxRows?: number,
  onProgress?: (p: ParseCsvProgress) => void,
): Promise<{ stats: ColumnInfo[]; sample: QueryResult; diagnostics: TabularInspectDiagnostics }> {
  const w = getWorker();
  if (!w) {
    onProgress?.({ phase: "parsing" });
    const result = parseCsvToInspectResult(name, text, maxRows);
    onProgress?.({ phase: "done" });
    return result;
  }
  onProgress?.({ phase: "parsing" });
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<CsvWorkerResponse>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (ev.data.ok) {
        onProgress?.({ phase: "done" });
        resolve(ev.data.result);
      } else {
        reject(new Error(ev.data.error));
      }
    };
    w.addEventListener("message", onMessage);
    const req: CsvWorkerRequest = { id, name, text, maxRows };
    w.postMessage(req);
  });
}
