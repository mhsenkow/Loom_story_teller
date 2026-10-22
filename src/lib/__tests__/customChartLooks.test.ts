import { describe, expect, it } from "vitest";
import {
  parseCustomChartLooks,
  MAX_CUSTOM_CHART_LOOKS,
} from "../customChartLooks";

describe("custom look validation", () => {
  it("filters corrupt records, deduplicates names and IDs, and strips data fields", () => {
    const valid = {
      id: "one",
      name: "  Calm  ",
      updatedAt: 12,
      overrides: {
        opacity: 0.5,
        customColors: "#123456,#abcdef",
        sourceFootnote: "full",
        xField: "secret",
        rows: [[1]],
      },
    };
    const looks = parseCustomChartLooks([
      null,
      {},
      { ...valid, name: "" },
      valid,
      { ...valid, id: "two", name: "calm" },
      { ...valid, name: "Other" },
    ]);
    expect(looks).toEqual([
      {
        id: "one",
        name: "Calm",
        updatedAt: 12,
        overrides: { opacity: 0.5, customColors: "#123456,#abcdef", sourceFootnote: "full" },
      },
    ]);
    expect(parseCustomChartLooks({ looks: [] })).toEqual([]);
  });
  it("bounds the library and sanitizes out-of-range styling", () => {
    const looks = parseCustomChartLooks(
      Array.from({ length: 30 }, (_, i) => ({
        id: `id${i}`,
        name: `Look ${i}`,
        overrides: { pointSize: 1000, colorScaleKind: "invalid" },
        updatedAt: NaN,
      })),
    );
    expect(looks).toHaveLength(MAX_CUSTOM_CHART_LOOKS);
    expect(looks[0]).toMatchObject({
      overrides: { pointSize: 24 },
      updatedAt: 0,
    });
    expect(looks[0].overrides.colorScaleKind).toBeUndefined();
  });
  it("rejects values of the wrong primitive type when reading backups or storage", () => {
    const [look] = parseCustomChartLooks([
      {
        id: "bad",
        name: "Mixed",
        overrides: {
          opacity: "0.5",
          showGrid: 1,
          fontFamily: true,
          pointSize: false,
          ghostEnabled: "true",
          tooltipMode: "glass",
          sourceFootnoteAlign: "right",
        },
      },
    ]);
    expect(look.overrides).toEqual({
      tooltipMode: "glass",
      sourceFootnoteAlign: "right",
    });
  });
});
