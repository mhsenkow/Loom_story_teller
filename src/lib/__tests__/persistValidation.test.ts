import { describe, it, expect } from "vitest";
import {
  parsePersistedAppSettings,
  parsePersistedChartViews,
  parsePersistedDashboards,
} from "../persistValidation";

describe("persistValidation", () => {
  it("drops invalid fontScale and theme", () => {
    const parsed = parsePersistedAppSettings({ theme: "not-a-theme", fontScale: 3 });
    expect(parsed?.theme).toBeUndefined();
    expect(parsed?.fontScale).toBeUndefined();
  });

  it("keeps valid settings", () => {
    const parsed = parsePersistedAppSettings({ theme: "dark", fontScale: 1.1 });
    expect(parsed).toMatchObject({ theme: "dark", fontScale: 1.1 });
  });

  it("never throws on malformed chart views", () => {
    expect(parsePersistedChartViews(null)).toEqual([]);
    expect(parsePersistedChartViews([{ id: "x", name: "n", chart: { bad: true } }])).toEqual([]);
    const ok = parsePersistedChartViews([
      {
        id: "1",
        name: "C",
        filePath: "web://a.csv",
        fileName: "a.csv",
        chart: { id: "c1", kind: "bar", title: "T", subtitle: "", score: 1, spec: {}, xField: "x", yField: "y", colorField: null },
        visualOverrides: {},
      },
    ]);
    expect(ok).toHaveLength(1);
  });

  it("filters bad dashboard slots", () => {
    const d = parsePersistedDashboards([
      { id: "d1", name: "Dash", slots: [{ id: "s1", viewType: "nope", viewId: "v1" }, { id: "s2", viewType: "chart", viewId: "v2" }] },
    ]);
    expect(d[0]?.slots).toHaveLength(1);
  });
});
