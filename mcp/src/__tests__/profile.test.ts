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
      expect(r.result.rowCount).toBeLessThanOrEqual(500);
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
});
