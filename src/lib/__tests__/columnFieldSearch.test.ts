import { describe, it, expect } from "vitest";
import { filterColumnFieldOptions, columnOptionKind } from "../columnFieldSearch";

describe("filterColumnFieldOptions", () => {
  const opts = [
    { value: "sales", label: "sales", type: "DOUBLE" },
    { value: "region", label: "region", type: "VARCHAR" },
    { value: "ts", label: "ts", type: "TIMESTAMP" },
    { value: "id", label: "id · skip", type: "VARCHAR", disabled: true },
  ];

  it("filters by substring on name", () => {
    expect(filterColumnFieldOptions(opts, "sal").map((o) => o.value)).toEqual(["sales"]);
  });

  it("filters by type chip", () => {
    expect(filterColumnFieldOptions(opts, "", "quantitative").map((o) => o.value)).toEqual(["sales"]);
    expect(filterColumnFieldOptions(opts, "", "nominal").map((o) => o.value)).toEqual(["region", "id"]);
    expect(filterColumnFieldOptions(opts, "", "temporal").map((o) => o.value)).toEqual(["ts"]);
  });

  it("keeps empty sentinel when present", () => {
    const withEmpty = [{ value: "", label: "None" }, ...opts];
    expect(filterColumnFieldOptions(withEmpty, "", "quantitative").map((o) => o.value)).toEqual(["", "sales"]);
  });
});

describe("columnOptionKind", () => {
  it("classifies DuckDB-ish types", () => {
    expect(columnOptionKind({ value: "x", label: "x", type: "DOUBLE" })).toBe("quantitative");
    expect(columnOptionKind({ value: "name", label: "name", type: "VARCHAR" })).toBe("nominal");
  });
});
