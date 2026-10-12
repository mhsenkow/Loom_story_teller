#!/usr/bin/env node
/**
 * One-off: split discoverHookFor if-chain into discoverHooks.ts (LOOM-184).
 */
import fs from "node:fs";

const path = new URL("../src/lib/discoverStories.ts", import.meta.url);
const text = fs.readFileSync(path, "utf8");
const start = text.indexOf("export function discoverHookFor(");
const retTypeEnd = text.indexOf("): { hook:", start);
let i = text.indexOf("{", retTypeEnd + 2);
let depth = 0;
for (; i < text.length; i++) {
  if (text[i] === "{") depth++;
  else if (text[i] === "}") {
    depth--;
    if (depth === 0) {
      i++;
      break;
    }
  }
}
const bodyOpen = text.indexOf("{", i);
depth = 0;
let bodyClose = -1;
for (let j = bodyOpen; j < text.length; j++) {
  if (text[j] === "{") depth++;
  else if (text[j] === "}") {
    depth--;
    if (depth === 0) {
      bodyClose = j;
      break;
    }
  }
}
const body = text.slice(bodyOpen + 1, bodyClose);
const re = /if \(kind === "([^"]+)"\) \{/g;
const markers = [];
let m;
while ((m = re.exec(body)) !== null) {
  markers.push({ kind: m[1], ifStart: m.index, contentStart: m.index + m[0].length });
}
const defaultStart = body.lastIndexOf("\n  return {");
const blocks = [];
for (let k = 0; k < markers.length; k++) {
  const end = k + 1 < markers.length ? markers[k + 1].ifStart : defaultStart;
  const chunk = body.slice(markers[k].contentStart, end).trim().replace(/\}\s*$/, "");
  blocks.push({ kind: markers[k].kind, chunk });
}
const defaultChunk = body.slice(defaultStart).trim();
blocks.push({ kind: "__default__", chunk: defaultChunk });

const outPath = new URL("../src/lib/discoverHooks.ts", import.meta.url);
const fnLines = blocks.map(({ kind, chunk }) => {
  const name = kind === "__default__" ? "hookDefault" : `hook_${kind.replace(/[^a-z0-9]/gi, "_")}`;
  let inner = chunk;
  if (kind !== "__default__") {
    inner = inner.replace(/\}\s*$/, "").trim();
  }
  return `function ${name}(\n  n: number,\n  sample: QueryResult,\n  chart: ChartRecommendation,\n): DiscoverHookResult {\n${inner.split("\n").map((l) => "  " + l).join("\n")}\n}`;
});

const mapEntries = blocks
  .filter((b) => b.kind !== "__default__")
  .map((b) => `  ${JSON.stringify(b.kind)}: hook_${b.kind.replace(/[^a-z0-9]/gi, "_")},`)
  .join("\n");

const out = `// =================================================================
// Loom — Discover feed hooks (LOOM-184)
// =================================================================
// One function per live source; DISCOVER_HOOKS is exhaustive over DiscoverKind.
// =================================================================

import type { ChartRecommendation } from "./recommendations";
import type { QueryResult } from "./store";
import type { DiscoverKind } from "./discoverStories";
import { applyChartTimeWindow } from "./chartTime";
import { stormLevel } from "./webStreams";

export type DiscoverHookResult = {
  hook: string;
  blurb: string;
  score: number;
  preferKind?: string;
  category: string;
};

function colIndex(sample: QueryResult, name: string): number {
  return sample.columns.indexOf(name);
}

function numAt(sample: QueryResult, row: number, col: string): number {
  const i = colIndex(sample, col);
  if (i < 0) return NaN;
  const v = sample.rows[row]?.[i];
  return typeof v === "number" ? v : Number(v);
}

function strAt(sample: QueryResult, row: number, col: string): string {
  const i = colIndex(sample, col);
  if (i < 0) return "";
  return String(sample.rows[row]?.[i] ?? "");
}

function maxFiniteAt(sample: QueryResult, col: string): { value: number; row: number } | null {
  let best = -Infinity;
  let row = -1;
  for (let r = 0; r < sample.rows.length; r++) {
    const v = numAt(sample, r, col);
    if (Number.isFinite(v) && v > best) {
      best = v;
      row = r;
    }
  }
  return row < 0 ? null : { value: best, row };
}

type DiscoverHookFn = (n: number, sample: QueryResult, chart: ChartRecommendation) => DiscoverHookResult;

${fnLines.join("\n\n")}

export const DISCOVER_HOOKS: { [K in DiscoverKind]: DiscoverHookFn } = {
${mapEntries}
};

export function discoverHookFor(
  kind: DiscoverKind,
  sample: QueryResult,
  chart: ChartRecommendation,
): DiscoverHookResult {
  const n = sample.total_rows || sample.rows.length;
  const fn = DISCOVER_HOOKS[kind] ?? hookDefault;
  return fn(n, sample, chart);
}
`;

fs.writeFileSync(outPath, out);
const fnEnd = bodyClose + 1;
const fixed = text.slice(0, start) + `export { discoverHookFor } from "./discoverHooks";\n` + text.slice(fnEnd);
fs.writeFileSync(path, fixed);
console.log("Wrote discoverHooks.ts,", blocks.length, "blocks");
