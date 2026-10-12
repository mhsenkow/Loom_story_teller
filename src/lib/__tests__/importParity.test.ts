import { describe, it, expect } from "vitest";
import { inspectFromTabular, parseCsvRecords, parseCsvToInspectResult } from "../mock-data";

// LOOM-680 — cross-format fixture (browser CSV path)
describe("import parity fixture", () => {
  const csv = "id,name,active,amount,day\n00123,Alpha,true,1.5,2026-10-12\n";

  it("CSV preserves leading-zero id", () => {
    const { sample } = parseCsvToInspectResult("t.csv", csv);
    expect(sample.rows[0]![0]).toBe("00123");
  });

  it("TSV matches CSV logical values", () => {
    const tsv = csv.replace(/,/g, "\t");
    const records = parseCsvRecords(tsv, "\t");
    const cols = records[0]!.map((c) => c.trim());
    const tsvSample = inspectFromTabular(cols, records.slice(1)).sample;
    const csvInspect = parseCsvToInspectResult("t.csv", csv);
    expect(tsvSample.rows[0]).toEqual(csvInspect.sample.rows[0]);
  });
});
