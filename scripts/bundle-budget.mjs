#!/usr/bin/env node
/**
 * LOOM-343 — First-load JS budget from static export (.next/build-manifest).
 * Fails when main route first load exceeds baseline + slack.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const manifestPath = join(ROOT, ".next/build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("Run `npm run build` before bundle-budget.mjs");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const page = manifest.pages["/"] ?? [];
const files = new Set([...(manifest.polyfillFiles ?? []), ...(manifest.devFiles ?? []), ...page]);

let total = 0;
for (const rel of files) {
  const abs = join(ROOT, ".next", rel.startsWith("/") ? rel.slice(1) : rel);
  if (!existsSync(abs)) continue;
  total += readFileSync(abs).length;
}

const baselineKb = 580;
const slackKb = 25;
const kb = Math.round(total / 1024);
console.log(`First-load JS (raw): ${kb} kB across ${files.size} files`);
if (kb > baselineKb + slackKb) {
  console.error(`Budget exceeded: ${kb} kB > ${baselineKb + slackKb} kB (baseline ${baselineKb} + slack ${slackKb})`);
  process.exit(1);
}
