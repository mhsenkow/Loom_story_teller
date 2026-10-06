import { describe, expect, it } from "vitest";
import {
  SOURCE_DEFS,
  SOURCE_KINDS,
  sourceKindFromPath,
  sourceStreamPath,
} from "../sourceRegistry";
import { ALL_SOURCE_KINDS } from "../tauri";
import { recommendSourceStory, SOURCE_SQL_SNIPPETS } from "../recommendations";
import type { ColumnInfo } from "../store";

const columnsFor = (kind: string): ColumnInfo[] => {
  const d = SOURCE_DEFS.find((x) => x.kind === kind)!;
  return d.columns.map((name, i) => ({
    name,
    data_type: d.types[i]!,
    null_count: 0,
    distinct_count: 10,
    min_value: null,
    max_value: null,
  }));
};

// Words in snippet SQL that aren't column references
const SQL_WORDS = new Set(
  (
    "select from where group by order limit desc asc as and or not in is null count sum avg min max round stddev " +
    "cast date over partition row_number qualify true false case when then else end distinct date_trunc month " +
    "abs between like with having on join left right inner outer union all interval day hour minute " +
    "extract year quarter week second epoch"
  ).split(" "),
);

function referencedIdentifiers(sql: string): string[] {
  const stripped = sql.replace(/'[^']*'/g, " ").replace(/"([^"]+)"/g, "$1");
  const aliases = new Set([...stripped.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]!.toLowerCase()));
  const out: string[] = [];
  for (const m of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g)) {
    const word = m[1]!;
    const lower = word.toLowerCase();
    if (m[2]) continue; // function call
    if (SQL_WORDS.has(lower) || aliases.has(lower)) continue;
    out.push(word);
  }
  return out;
}

describe("source registry", () => {
  it("has one definition per kind, in kind order", () => {
    expect(SOURCE_DEFS.map((d) => d.kind)).toEqual([...SOURCE_KINDS]);
    expect(ALL_SOURCE_KINDS).toEqual(SOURCE_KINDS);
  });

  it("keeps columns and types aligned and table names unique", () => {
    const tables = new Set<string>();
    for (const d of SOURCE_DEFS) {
      expect(d.columns.length, d.kind).toBe(d.types.length);
      expect(new Set(d.columns).size, `${d.kind} duplicate column`).toBe(d.columns.length);
      expect(tables.has(d.table), `${d.table} reused`).toBe(false);
      tables.add(d.table);
      // ORDER BY only names real columns
      for (const part of d.orderBy.split(",")) {
        expect(d.columns, `${d.kind} orderBy`).toContain(part.trim().split(/\s+/)[0]);
      }
    }
  });

  it("round-trips stream paths", () => {
    for (const k of SOURCE_KINDS) expect(sourceKindFromPath(sourceStreamPath(k))).toBe(k);
    expect(sourceKindFromPath("stream://wiki")).toBeNull();
    expect(sourceKindFromPath("mock://sales.csv")).toBeNull();
  });
});

describe.each(SOURCE_DEFS.map((d) => [d.kind, d] as const))("source %s", (kind, def) => {
  it("opens with charts that only use its real columns", () => {
    const story = recommendSourceStory(kind, columnsFor(kind), null);
    expect(story.charts.length, "no default charts").toBeGreaterThan(0);
    for (const c of story.charts) {
      const fields = [
        c.xField,
        c.yField,
        c.colorField,
        c.sizeField,
        c.zField,
        c.timeField,
        c.trailId,
        c.rowField,
        c.y2Field,
      ].filter((f): f is string => typeof f === "string" && f.length > 0);
      for (const f of fields) expect(def.columns, `${c.title} → ${f}`).toContain(f);
    }
  });

  it("ships SQL snippets that query its own table and columns", () => {
    const snippets = SOURCE_SQL_SNIPPETS[kind];
    expect(snippets?.length, "no SQL snippets").toBeGreaterThan(0);
    for (const sn of snippets!) {
      expect(sn.sql, sn.name).toMatch(new RegExp(`\\bFROM ${def.table}\\b`));
      for (const id of referencedIdentifiers(sn.sql)) {
        if (id === def.table) continue;
        expect(def.columns, `${sn.name} → ${id}`).toContain(id);
      }
    }
  });
});
