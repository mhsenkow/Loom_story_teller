// =================================================================
// chartFacets unit tests
// =================================================================

import { describe, it, expect } from "vitest";
import {
  partitionRowsByFacet,
  layoutFacetCells,
  clampTopN,
  FACET_MAX_PANELS,
} from "../chartFacets";
import { firmsViirsCsv, nwisIvWide, starlinkGp } from "../../../workers/sourceTransforms";

describe("chartFacets", () => {
  it("partitions and caps facet panels by size", () => {
    const rows = [
      ["a", 1],
      ["a", 2],
      ["b", 3],
      ["c", 4],
      ["c", 5],
      ["c", 6],
    ];
    const panels = partitionRowsByFacet(rows, 0, 2);
    expect(panels).toHaveLength(2);
    expect(panels[0]!.key).toBe("c");
    expect(panels[0]!.rows).toHaveLength(3);
    expect(panels[1]!.key).toBe("a");
  });

  it("lays out a grid of cells", () => {
    const panels = partitionRowsByFacet(
      Array.from({ length: 6 }, (_, i) => [String(i % 3), i]),
      0,
    );
    const cells = layoutFacetCells(panels, 0, 0, 300, 200);
    expect(cells.length).toBe(panels.length);
    expect(cells[0]!.w).toBeGreaterThan(20);
    expect(FACET_MAX_PANELS).toBe(8);
  });

  it("clamps Top N", () => {
    expect(clampTopN(null)).toBe(20);
    expect(clampTopN(2)).toBe(3);
    expect(clampTopN(999)).toBe(50);
  });
});

describe("new source transforms", () => {
  it("parses FIRMS VIIRS CSV", () => {
    const csv = [
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight",
      "34.1,-118.2,320.5,1,1,2026-10-05,1230,N20,high,2.0NRT,290.1,45.2,D",
    ].join("\n");
    const out = firmsViirsCsv(csv);
    expect(out.columns[0]).toBe("id");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![5]).toBe(45.2);
    expect(out.rows[0]![8]).toBe("2026-10-05T12:30:00Z");
  });

  it("pivots NWIS IV into wide rows", () => {
    const body = {
      value: {
        timeSeries: [
          {
            sourceInfo: {
              siteCode: [{ value: "01646500" }],
              siteName: "Potomac",
              geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } },
            },
            variable: { variableCode: [{ value: "00060" }] },
            values: [{ value: [{ dateTime: "2026-10-05T12:00:00.000-04:00", value: "12000" }] }],
          },
          {
            sourceInfo: {
              siteCode: [{ value: "01646500" }],
              siteName: "Potomac",
              geoLocation: { geogLocation: { latitude: 38.9, longitude: -77.1 } },
            },
            variable: { variableCode: [{ value: "00065" }] },
            values: [{ value: [{ dateTime: "2026-10-05T12:00:00.000-04:00", value: "5.2" }] }],
          },
        ],
      },
    };
    const out = nwisIvWide(body);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![0]).toBe("01646500");
    expect(out.rows[0]![5]).toBe(12000);
    expect(out.rows[0]![6]).toBe(5.2);
  });

  it("parses Starlink GP JSON", () => {
    const out = starlinkGp([
      {
        OBJECT_NAME: "STARLINK-1000",
        OBJECT_ID: "2020-001A",
        EPOCH: "2026-10-05T00:00:00.000",
        MEAN_MOTION: 15.1,
        ECCENTRICITY: 0.0001,
        INCLINATION: 53.0,
        RA_OF_ASC_NODE: 10,
        ARG_OF_PERICENTER: 20,
        MEAN_ANOMALY: 30,
        NORAD_CAT_ID: 45000,
        BSTAR: 0.0001,
      },
      {
        OBJECT_NAME: "STARLINK-1000 DEB",
        NORAD_CAT_ID: 45001,
        MEAN_MOTION: 15.0,
        INCLINATION: 53.0,
        ECCENTRICITY: 0.001,
      },
    ]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]![0]).toBe(45000);
  });
});
