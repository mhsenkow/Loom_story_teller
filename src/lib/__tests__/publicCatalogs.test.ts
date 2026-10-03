/**
 * Socrata Discovery + TidyTuesday catalog parsing (real-shaped fixtures, trimmed).
 */
import { describe, it, expect } from "vitest";
import {
  filterTidyTuesdayWeeks,
  parseSocrataSearch,
  parseTidyTuesdayIndex,
  parseTidyTuesdayYearReadme,
  searchSocrata,
  socrataCsvUrl,
  socrataFileName,
  socrataPortalLabel,
  socrataRowLimit,
  socrataSearchUrl,
  SOCRATA_MAX_ROWS,
  tidyTuesdayFileUrl,
  tidyTuesdayTitle,
} from "../publicCatalogs";
import { parseCsvRecords, parseCsvToInspectResult, sniffCsvDelimiter } from "../mock-data";

const SOCRATA_BODY = {
  results: [
    {
      resource: {
        name: "311 Service Requests from 2020 to Present",
        id: "erm2-nwe9",
        description: "<p>All 311 Service Requests from 2020 to present.</p>\r\n\r\n**Updated daily**",
        attribution: "311",
        type: "dataset",
        updatedAt: "2026-10-02T01:38:54.000Z",
        data_updated_at: "2026-10-02T01:38:54.000Z",
        page_views: { page_views_last_month: 23104 },
        columns_field_name: ["unique_key", "created_date", "agency", "latitude", "longitude", ":@computed_region_efsh_h5xi"],
        lens_view_type: "tabular",
        blob_mime_type: null,
      },
      classification: { domain_category: "Social Services" },
      metadata: { domain: "data.cityofnewyork.us" },
      permalink: "https://data.cityofnewyork.us/d/erm2-nwe9",
    },
    {
      // A map view — no SODA CSV behind it.
      resource: { name: "Tree map", id: "abcd-1234", type: "map", columns_field_name: [] },
      metadata: { domain: "data.cityofchicago.org" },
    },
    {
      // Attached file (PDF) — skip.
      resource: { name: "Annual report", id: "zzzz-9999", type: "dataset", lens_view_type: "blobby", blob_mime_type: "application/pdf" },
      metadata: { domain: "data.seattle.gov" },
    },
    {
      resource: { name: "Bad id", id: "../../etc", type: "dataset" },
      metadata: { domain: "data.sfgov.org" },
    },
    {
      resource: {
        name: "Public Trees",
        id: "tfs4-3wwa",
        type: "dataset",
        updatedAt: "2026-09-30T10:00:00.000Z",
        columns_field_name: ["tree_asset_cd", "common_name", "dbh_cm"],
        lens_view_type: "tabular",
      },
      metadata: { domain: "data.calgary.ca" },
    },
  ],
  resultSetSize: 5,
};

describe("Socrata Discovery", () => {
  it("builds a keyless search URL", () => {
    const u = new URL(socrataSearchUrl({ query: " street trees ", domain: "data.cityofnewyork.us", limit: 500 }));
    expect(u.origin + u.pathname).toBe("https://api.us.socrata.com/api/catalog/v1");
    expect(u.searchParams.get("q")).toBe("street trees");
    expect(u.searchParams.get("only")).toBe("dataset");
    expect(u.searchParams.get("domains")).toBe("data.cityofnewyork.us");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("order")).toBeNull();
  });

  it("orders by popularity when there is nothing to rank by relevance", () => {
    const u = new URL(socrataSearchUrl({}));
    expect(u.searchParams.get("q")).toBeNull();
    expect(u.searchParams.get("order")).toBe("page_views_last_month");
    expect(new URL(socrataSearchUrl({ query: "x", sort: "updated" })).searchParams.get("order")).toBe("updatedAt");
  });

  it("ignores a hostile domain filter", () => {
    const u = new URL(socrataSearchUrl({ query: "x", domain: "evil.com/../" }));
    expect(u.searchParams.get("domains")).toBeNull();
  });

  it("keeps tabular datasets and drops maps, files, and bad ids", () => {
    const out = parseSocrataSearch(SOCRATA_BODY);
    expect(out.map((d) => d.id)).toEqual(["erm2-nwe9", "tfs4-3wwa"]);
    const nyc = out[0]!;
    expect(nyc.domain).toBe("data.cityofnewyork.us");
    expect(nyc.columnCount).toBe(5); // computed-region system column excluded
    expect(nyc.description).toBe("All 311 Service Requests from 2020 to present. Updated daily");
    expect(nyc.updatedAt).toBe("2026-10-02T01:38:54.000Z");
    expect(nyc.category).toBe("Social Services");
    expect(nyc.pageViewsLastMonth).toBe(23104);
    expect(out[1]!.permalink).toBe("https://data.calgary.ca/d/tfs4-3wwa");
  });

  it("rejects a payload without results", () => {
    expect(() => parseSocrataSearch({ error: "nope" })).toThrow(/missing results/);
  });

  it("sizes the export to the cell target", () => {
    expect(socrataRowLimit(3)).toBe(SOCRATA_MAX_ROWS);
    expect(socrataRowLimit(44)).toBe(22727);
    expect(socrataRowLimit(5000)).toBe(1000);
    expect(socrataRowLimit(0)).toBe(SOCRATA_MAX_ROWS);
  });

  it("builds SODA CSV URLs and file names", () => {
    expect(socrataCsvUrl({ domain: "data.cityofnewyork.us", id: "erm2-nwe9" }, 22727)).toBe(
      "https://data.cityofnewyork.us/resource/erm2-nwe9.csv?$limit=22727",
    );
    expect(() => socrataCsvUrl({ domain: "localhost", id: "erm2-nwe9" }, 10)).toThrow();
    expect(socrataFileName({ name: "311 Service Requests (2020–Present)", id: "erm2-nwe9" })).toBe(
      "311_Service_Requests_2020_Present-erm2-nwe9.csv",
    );
    expect(socrataPortalLabel("data.cityofnewyork.us")).toBe("New York City");
    expect(socrataPortalLabel("www.example.gov")).toBe("example.gov");
  });

  it("searches through an injected fetch", async () => {
    let seen = "";
    const fakeFetch = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify(SOCRATA_BODY), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await searchSocrata({ query: "311" }, fakeFetch);
    expect(seen).toContain("q=311");
    expect(out).toHaveLength(2);
  });
});

const TT_INDEX = [
  "Week,Date,year,data_files,data_type,delim",
  '39,2026-09-29,2026,health.csv,csv,","',
  '36,2022-09-06,2022,colors.csv.gz,vgz,","',
  "19,2022-05-10,2022,nyt_titles.tsv,tsv,NA",
  "19,2022-05-10,2022,nyt_full.tsv,csv,NA",
  "1,2020-12-29,2021,NA,NA,NA",
  "48,2020-11-24,2020,hike_data.rds,rds,NA",
  "9,2019-02-26,2019,regularite-mensuelle-tgv-aqst.csv,csv,;",
  "4,2018-04-23,2018,week4_australian_salary.csv,csv,\",\"",
  "3,2018-04-16,2018,global_mortality.xlsx,xlsx,NA",
].join("\n");

describe("TidyTuesday index", () => {
  it("groups csv/tsv files by week, newest first", () => {
    const weeks = parseTidyTuesdayIndex(TT_INDEX);
    expect(weeks.map((w) => w.date)).toEqual(["2026-09-29", "2022-05-10", "2019-02-26", "2018-04-23"]);
    const nyt = weeks[1]!;
    expect(nyt.week).toBe(19);
    expect(nyt.files.map((f) => [f.name, f.format])).toEqual([
      ["nyt_titles.tsv", "tsv"],
      ["nyt_full.tsv", "tsv"],
    ]);
    expect(nyt.files[0]!.url).toBe(
      "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2022/2022-05-10/nyt_titles.tsv",
    );
    expect(nyt.files[0]!.loomName).toBe("tt_2022-05-10_nyt_titles.csv");
  });

  it("uses the folder year column, not the date's year", () => {
    expect(tidyTuesdayFileUrl(2020, "2019-12-31", "x.csv")).toContain("/data/2020/2019-12-31/x.csv");
  });

  it("filters by date, file name, and title", () => {
    const weeks = parseTidyTuesdayIndex(TT_INDEX);
    expect(filterTidyTuesdayWeeks(weeks, "tgv").map((w) => w.date)).toEqual(["2019-02-26"]);
    expect(filterTidyTuesdayWeeks(weeks, "2018").map((w) => w.date)).toEqual(["2018-04-23"]);
    expect(filterTidyTuesdayWeeks(weeks, "best sellers", { "2022-05-10": "NYT Best Sellers" }).map((w) => w.date)).toEqual([
      "2022-05-10",
    ]);
    expect(filterTidyTuesdayWeeks(weeks, "")).toHaveLength(4);
  });
});

describe("TidyTuesday year readme", () => {
  it("reads week titles from the table, keyed by folder date and week", () => {
    const md2018 = [
      "# 2018 Data",
      "| Week|Date       |Data                     |Source |Article |",
      "|----:|:----------|:------------------------|:------|:-------|",
      "|    1|2018-04-03 |[US Tuition Costs](2018-04-02)  |[x](https://x) |NA |",
      "|    4|2018-04-24 |[Australian Salaries by Gender](2018-04-23) |NA |NA |",
    ].join("\n");
    const t = parseTidyTuesdayYearReadme(md2018, 2018);
    expect(t["2018-04-02"]).toBe("US Tuition Costs");
    expect(t["2018-04-23"]).toBe("Australian Salaries by Gender");
    expect(t["2018#4"]).toBe("Australian Salaries by Gender");
    expect(tidyTuesdayTitle({ date: "2018-04-23", year: 2018, week: 4 }, t)).toBe("Australian Salaries by Gender");

    const md2026 = [
      "|    1|2026-01-06 |Bring your own data from 2025!      |NA |NA |",
      "|   39|2026-09-29 |[Health Spending](2026-09-29/readme.md)|[src](https://x) |NA |",
    ].join("\n");
    const t2 = parseTidyTuesdayYearReadme(md2026, 2026);
    expect(t2["2026-09-29"]).toBe("Health Spending");
    expect(t2["2026-01-06"]).toBe("Bring your own data from 2025!");
  });
});

describe("delimiter sniffing for TSV / semicolon files", () => {
  it("detects tabs, semicolons, and commas from the header", () => {
    expect(sniffCsvDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(sniffCsvDelimiter("Année;Mois;Retards, en minutes\n2018;1;5")).toBe(";");
    expect(sniffCsvDelimiter('"a;b",c\n1,2')).toBe(",");
    expect(sniffCsvDelimiter("﻿name,value\nx,1")).toBe(",");
  });

  it("parses a TSV into columns", () => {
    const tsv = 'title\tauthor\ttotal_weeks\n"Hello, World"\tSmith\t12\nOther\tJones\t3\n';
    expect(parseCsvRecords(tsv, "\t")[1]).toEqual(["Hello, World", "Smith", "12"]);
    const r = parseCsvToInspectResult("nyt.csv", tsv);
    expect(r.sample.columns).toEqual(["title", "author", "total_weeks"]);
    expect(r.sample.rows[0]).toEqual(["Hello, World", "Smith", 12]);
  });

  it("parses a semicolon file with decimal commas", () => {
    const r = parseCsvToInspectResult("tgv.csv", "annee;retard_moyen\n2018;5,5\n2019;6,25\n");
    expect(r.sample.columns).toEqual(["annee", "retard_moyen"]);
    expect(r.sample.rows).toEqual([[2018, 5.5], [2019, 6.25]]);
  });
});
