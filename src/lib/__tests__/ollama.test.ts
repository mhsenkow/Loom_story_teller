import { describe, expect, it } from "vitest";
import { parseSuggestion } from "../ollama";
import type { ColumnInfo } from "../store";

const columns: ColumnInfo[] = [
  { name: "category", data_type: "VARCHAR", null_count: 0, distinct_count: 3, min_value: null, max_value: null },
  { name: "value", data_type: "DOUBLE", null_count: 0, distinct_count: 10, min_value: "1", max_value: "9" },
];

describe("parseSuggestion", () => {
  it("accepts camelCase chart kinds from model output", () => {
    const parsed = parseSuggestion(
      JSON.stringify({
        chartKind: "forceBubble",
        xField: "category",
        yField: "value",
        colorField: null,
        reason: "test",
      }),
      columns,
    );
    expect(parsed?.chartKind).toBe("forceBubble");
    expect(parsed?.xField).toBe("category");
  });
});
