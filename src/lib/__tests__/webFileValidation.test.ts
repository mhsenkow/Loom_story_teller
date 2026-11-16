import { describe, it, expect } from "vitest";
import { parseWebFilePersist } from "../webFileValidation";

describe("parseWebFilePersist (LOOM-199)", () => {
  const valid = {
    path: "web://a.csv",
    name: "a.csv",
    extension: "csv",
    sizeBytes: 10,
    updatedAt: 1,
    stats: [
      {
        name: "x",
        data_type: "INTEGER",
        null_count: 0,
        distinct_count: 1,
        min_value: "1",
        max_value: "1",
      },
    ],
    sample: { columns: ["x"], types: ["INTEGER"], rows: [[1]], total_rows: 1 },
  };

  it("accepts a well-formed payload", () => {
    expect(parseWebFilePersist(valid)).toEqual(valid);
  });
  it("preserves all supported cell values and partial sample counts", () => {
    const sample = {
      columns: ["x"],
      types: ["VARCHAR"],
      rows: [[null], [false], [true], [0], [-2.5], [""], ["text"]],
      total_rows: 100,
    };
    expect(parseWebFilePersist({ ...valid, sample })?.sample).toEqual(sample);
    expect(parseWebFilePersist({ ...valid, sample: { ...sample, rows: [], total_rows: 0 } })).not.toBeNull();
  });
  it("accepts legacy and current versions but refuses unknown payload versions", () => {
    for (const payloadVersion of [1, 2])
      expect(parseWebFilePersist({ ...valid, payloadVersion })).toEqual(valid);
    for (const payloadVersion of [0, 3, "2", null])
      expect(parseWebFilePersist({ ...valid, payloadVersion })).toBeNull();
  });
  it.each([
    { columns: [42] },
    { types: [null] },
    { total_rows: Number.NaN },
    { total_rows: -1 },
    { total_rows: 0 },
    { rows: [[{ value: 1 }]] },
    { rows: [[undefined]] },
    { rows: [[Number.POSITIVE_INFINITY]] },
  ])("rejects corrupt query metadata or cells: %j", (sample) => {
    expect(parseWebFilePersist({ ...valid, sample: { ...valid.sample, ...sample } })).toBeNull();
  });

  it("returns null for corrupt row widths", () => {
    expect(
      parseWebFilePersist({
        ...valid,
        sample: { columns: ["x"], types: ["INTEGER"], rows: [[1, 2]], total_rows: 1 },
      }),
    ).toBeNull();
  });

  it("returns null for missing path", () => {
    expect(parseWebFilePersist({ ...valid, path: "" })).toBeNull();
  });
});
