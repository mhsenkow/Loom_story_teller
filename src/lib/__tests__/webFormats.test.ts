import { describe, expect, it } from "vitest";
import {
  WEB_FILE_ACCEPT,
  isSupportedWebUpload,
  resolveWebFormat,
  canonicalWebExtension,
} from "../webFormats";
import {
  parseJsonText,
  parseNdjsonText,
  ingestWebBytes,
  assertWebIngestByteBudget,
  WEB_INGEST_MAX_BYTES,
  WebIngestAbortedError,
  ingestWebFile,
} from "../webIngest";

describe("webFormats", () => {
  it("accepts desktop-parity tabular extensions", () => {
    expect(isSupportedWebUpload("sales.csv")).toBe(true);
    expect(isSupportedWebUpload("sales.TSV")).toBe(true);
    expect(isSupportedWebUpload("rows.ndjson")).toBe(true);
    expect(isSupportedWebUpload("rows.jsonl")).toBe(true);
    expect(isSupportedWebUpload("data.parquet")).toBe(true);
    expect(isSupportedWebUpload("book.xlsx")).toBe(true);
    expect(isSupportedWebUpload("notes.txt")).toBe(false);
    expect(WEB_FILE_ACCEPT).toContain(".parquet");
    expect(WEB_FILE_ACCEPT).toContain(".xlsx");
  });

  it("canonicalizes tab → tsv", () => {
    expect(canonicalWebExtension("x.tab")).toBe("tsv");
    expect(resolveWebFormat("x.tab")?.id).toBe("tsv");
  });
});

describe("webIngest text", () => {
  it("parses JSON array of objects", () => {
    const { sample } = parseJsonText(
      JSON.stringify([
        { city: "Austin", temp: 88 },
        { city: "Boston", temp: 61 },
      ]),
    );
    expect(sample.columns).toEqual(["city", "temp"]);
    expect(sample.rows).toHaveLength(2);
    expect(sample.rows[0]![1]).toBe(88);
  });

  it("parses columnar JSON", () => {
    const { sample } = parseJsonText(JSON.stringify({ a: [1, 2], b: ["x", "y"] }));
    expect(sample.columns).toEqual(["a", "b"]);
    expect(sample.rows[1]).toEqual([2, "y"]);
  });

  it("parses NDJSON", () => {
    const { sample } = parseNdjsonText('{"n":1}\n{"n":2}\n');
    expect(sample.rows.map((r) => r[0])).toEqual([1, 2]);
  });

  it("reports malformed and non-object NDJSON lines in tolerant mode", () => {
    const text = "{\"n\":1}\n{not json\n{\"n\":2}\n[1,2,3]";
    const { sample, ndjsonDiagnostics } = parseNdjsonText(text);
    expect(sample.rows).toHaveLength(2);
    expect(ndjsonDiagnostics?.lines_accepted).toBe(2);
    expect(ndjsonDiagnostics?.lines_skipped_malformed).toBe(1);
    expect(ndjsonDiagnostics?.lines_skipped_non_object).toBe(1);
    expect(ndjsonDiagnostics?.examples.length).toBeGreaterThan(0);
  });

  it("rejects oversize files before read", () => {
    expect(() => assertWebIngestByteBudget(WEB_INGEST_MAX_BYTES + 1, "huge.csv")).toThrow(
      /browser imports are limited/i,
    );
  });

  it("honours abort signal during ingest", async () => {
    const ac = new AbortController();
    const big = "a,b\n" + "1,2\n".repeat(5000);
    const file = new File([big], "demo.csv", { type: "text/csv" });
    ac.abort();
    await expect(ingestWebFile(file, { signal: ac.signal })).rejects.toBeInstanceOf(
      WebIngestAbortedError,
    );
  });

  it("ingests TSV via ingestWebBytes", async () => {
    const { inspect, extension } = await ingestWebBytes("demo.tsv", {
      text: "name\tvalue\nalpha\t10\nbeta\t20\n",
    });
    expect(extension).toBe("tsv");
    expect(inspect.sample.columns).toEqual(["name", "value"]);
    expect(inspect.sample.rows[0]).toEqual(["alpha", 10]);
  });
});
