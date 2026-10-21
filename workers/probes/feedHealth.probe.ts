// =================================================================
// Nightly live-feed probe (`npm run probe:feeds`, .github/workflows/feed-health.yml)
// =================================================================
// Catches the ways feeds broke silently before anyone noticed:
//   1. Subrequests — runs every Worker fetcher in Node against the real
//      upstreams and counts outbound calls. Production Workers stop at 50;
//      a route near that cap truncates (Pokémon returned 48 of 151).
//   2. Parser drift — fetches what users get from /api/source/<kind> and
//      parses it with the app's own parser. A 200 that parses to 0 rows is a
//      code bug, not an outage.
//   3. Coverage — runs discover over every healthy feed; the union of chart
//      kinds must stay near the full catalog.
//   4. Long outages — /api/health "resting" for 48 h+ means the upstream
//      changed or died (the Met retired its search API) and needs a code fix.
// Short outages are reported in the job summary but don't fail the run.
// =================================================================

import { it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { SOURCE_DEFS } from "../../src/lib/sourceRegistry";
import { parseSourceRows } from "../../src/lib/sourceParsers";
import { enumerateDiscoverCharts } from "../../src/lib/discoverCandidates";
import { buildDiscoverStories } from "../../src/lib/discoverStories";
import { recommendSourceStory } from "../../src/lib/recs/sourceStory";
import { CHART_KIND_OPTIONS } from "../../src/lib/recs/types";
import type { ColumnInfo, QueryResult } from "../../src/lib/queryTypes";

const ORIGIN = process.env.LOOM_ORIGIN ?? "https://loom.ibm.io";
/** Leave headroom under Cloudflare's 50-subrequest cap. */
const MAX_SUBREQUESTS = 45;
/** Chart kinds that must stay reachable across all healthy feeds. */
const MIN_KIND_COVERAGE = 55;
const LONG_DOWN_MS = 48 * 3_600_000;
/** Need Worker-only APIs (WebSocket upgrades) — audited in production only. */
const WORKER_ONLY = new Set(["bluesky", "bgp"]);

const als = new AsyncLocalStorage<{ n: number }>();
const realFetch = globalThis.fetch;
globalThis.fetch = ((...a: Parameters<typeof fetch>) => {
  const s = als.getStore();
  if (s) s.n++;
  return realFetch(...a);
}) as typeof fetch;
(globalThis as unknown as { caches: unknown }).caches = {
  default: { match: async () => undefined, put: async () => {}, delete: async () => true },
};

function statsFor(columns: string[], types: string[], rows: unknown[][]): ColumnInfo[] {
  return columns.map((name, i) => {
    const vals = rows.map((r) => r[i]).filter((v) => v != null && v !== "");
    const nums = vals.map(Number).filter(Number.isFinite);
    const numeric = /INT|DOUBLE|FLOAT|DECIMAL|REAL/i.test(types[i] ?? "");
    return {
      name,
      data_type: types[i] ?? "VARCHAR",
      null_count: rows.length - vals.length,
      distinct_count: new Set(vals.map(String)).size,
      min_value: numeric && nums.length ? String(Math.min(...nums)) : null,
      max_value: numeric && nums.length ? String(Math.max(...nums)) : null,
    };
  });
}

it("live feeds stay healthy", async () => {
  const { SOURCE_FETCHERS } = await import("../catalog-proxy");
  const failures: string[] = [];
  const lines: string[] = [];

  // 1. Subrequest audit
  const counts: [string, number, string][] = [];
  await Promise.all(
    Object.keys(SOURCE_FETCHERS).map((kind) =>
      als.run({ n: 0 }, async () => {
        const s = als.getStore()!;
        let note = "ok";
        try {
          await SOURCE_FETCHERS[kind]!({ waitUntil: () => {} } as never);
        } catch (e) {
          note = WORKER_ONLY.has(kind) ? "worker-only" : `upstream error: ${(e as Error).message.slice(0, 80)}`;
        }
        counts.push([kind, s.n, note]);
        if (s.n > MAX_SUBREQUESTS) failures.push(`${kind} made ${s.n} subrequests (cap ${MAX_SUBREQUESTS})`);
      }),
    ),
  );

  // 2–3. What users get: production payload → app parser → discover
  const health = (await realFetch(`${ORIGIN}/api/health`).then((r) => r.json()).catch(() => ({ sources: {} }))) as {
    sources: Record<string, { state: string; lastOk?: number; error?: string }>;
  };
  const union = new Set<string>();
  const down: string[] = [];
  await Promise.all(
    SOURCE_DEFS.map(async (d) => {
      const path = d.kind === "iss" ? "iss_trail" : d.kind;
      let body: unknown;
      try {
        const res = await realFetch(`${ORIGIN}/api/source/${path}`, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) {
          down.push(`${d.kind} (HTTP ${res.status})`);
          return;
        }
        body = await res.json();
      } catch (e) {
        down.push(`${d.kind} (${(e as Error).message.slice(0, 60)})`);
        return;
      }
      const rows = parseSourceRows(d.kind, body).slice(0, 500);
      if (!rows.length) {
        failures.push(`${d.kind}: /api/source returned 200 but the app parser found 0 rows (parser drift?)`);
        return;
      }
      const types = d.types as unknown as string[];
      const stats = statsFor(d.columns, types, rows);
      const sample = { columns: d.columns, types, rows, total_rows: rows.length } as unknown as QueryResult;
      const curated = recommendSourceStory(d.kind, stats, sample).charts;
      const stories = buildDiscoverStories(d.kind, stats, sample, enumerateDiscoverCharts(stats, curated, d.kind, sample), 160);
      for (const s of stories) union.add(s.chartKind);
    }),
  );
  if (union.size < MIN_KIND_COVERAGE)
    failures.push(`discover reaches ${union.size}/${CHART_KIND_OPTIONS.length} chart kinds (minimum ${MIN_KIND_COVERAGE})`);

  // 4. Long outages need a code fix, not patience
  const now = Date.now();
  for (const [kind, h] of Object.entries(health.sources ?? {})) {
    if (h.state === "resting" && (!h.lastOk || now - h.lastOk > LONG_DOWN_MS))
      failures.push(`${kind} resting ${h.lastOk ? `${Math.round((now - h.lastOk) / 3_600_000)} h` : "with no success on record"}: ${h.error ?? "unknown error"}`);
  }

  const missing = CHART_KIND_OPTIONS.map((c) => c.value).filter((k) => !union.has(k));
  lines.push(
    "## Live feed health",
    "",
    failures.length ? `**${failures.length} problem(s):**\n${failures.map((f) => `- ${f}`).join("\n")}` : "No blocking problems.",
    "",
    `Discover coverage: **${union.size}/${CHART_KIND_OPTIONS.length}** chart kinds${missing.length ? ` (missing: ${missing.join(", ")})` : ""}.`,
    "",
    down.length ? `Unreachable right now (not blocking): ${down.sort().join(", ")}` : "All feeds answered.",
    "",
    "| Feed | Subrequests | Upstream (from Node) | Health |",
    "|---|---|---|---|",
    ...counts
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n, note]) => `| ${k} | ${n} | ${note} | ${health.sources?.[k]?.state ?? "–"} |`),
  );
  const report = lines.join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  console.log(report);
  expect(failures, failures.join("\n")).toEqual([]);
}, 600_000);
