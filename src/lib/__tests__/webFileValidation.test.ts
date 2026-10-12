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
