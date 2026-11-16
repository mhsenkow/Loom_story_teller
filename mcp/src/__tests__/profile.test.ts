import { describe, expect, it } from "vitest";
import { parseCsv, profilePayload, profilePayloadSafe } from "../profile";

describe("mcp profile", () => {
  it("parses quoted commas in CSV", () => {
    const { headers, rows } = parseCsv('a,"b,c",d\n1,"2,3",4');
    expect(headers).toEqual(["a", "b,c", "d"]);
    expect(rows[0]).toEqual(["1", "2,3", "4"]);
  });

  it("returns truncated JSON arrays without pre-parse slice errors", () => {
    const arr = Array.from({ length: 600 }, (_, i) => ({ id: i, v: i }));
    const r = profilePayloadSafe({ json: JSON.stringify(arr) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.truncated).toBe(true);
      expect(r.result.sampledRows).toBeLessThanOrEqual(500);
      expect(r.result.rowCount).toBe(600);
    }
  });

  it("keeps label columns as VARCHAR", () => {
    const r = profilePayload({ csv: "label\nAlpha 1\nBeta 2" });
    expect(r.columns[0]?.data_type).toBe("VARCHAR");
  });

  it("surfaces malformed JSON as tool-safe errors", () => {
    const r = profilePayloadSafe({ json: "{not json" });
    expect(r.ok).toBe(false);
  });

  it("reports the full CSV row count separately from the 500-row sample", () => {
    const csv = "x,y\n" + Array.from({ length: 2000 }, (_, i) => `${i},${i * 2}`).join("\n");
    const r = profilePayload({ csv });
    expect(r.rowCount).toBe(2000);
    expect(r.sampledRows).toBe(500);
    expect(r.sampleRows).toHaveLength(500);
  });

  it("renames duplicate CSV headers so columns stay distinct", () => {
    const { headers } = parseCsv("a,a,b,a\n1,2,3,4");
    expect(headers).toEqual(["a", "a_2", "b", "a_3"]);
    const r = profilePayload({ csv: "a,a\n1,2" });
    expect(r.columnNames).toEqual(["a", "a_2"]);
  });

  it("keeps nested JSON values as JSON text instead of [object Object]", () => {
    const r = profilePayload({ json: JSON.stringify([{ id: 1, meta: { k: 1 }, tags: [1, 2] }]) });
    const meta = r.columnNames.indexOf("meta");
    const tags = r.columnNames.indexOf("tags");
    expect(r.sampleRows[0]![meta]).toBe('{"k":1}');
    expect(r.sampleRows[0]![tags]).toBe("[1,2]");
  });
});
