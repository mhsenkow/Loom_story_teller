import { describe, expect, it } from "vitest";
import {
  browseCollections,
  brokenPieces,
  collectionAlive,
  collectionLife,
  touchCollection,
  type DataCollection,
} from "../collections";
import { feedRef } from "../sourceRef";

const MONTH = 1000 * 60 * 60 * 24 * 30.4375;
const start = Date.UTC(2026, 0, 1);

function col(over: Partial<DataCollection> = {}): DataCollection {
  return {
    id: "c1",
    intent: "Debt story",
    span: 3,
    createdAt: start,
    touchedAt: start,
    pieces: [
      { kind: "data", ref: "feed:debt", name: "US debt" },
      { kind: "chart", id: "chart-1", name: "Debt line" },
    ],
    ...over,
  };
}

describe("collections", () => {
  it("stays while you are inside the span and leaves after it", () => {
    const c = col();
    expect(collectionAlive(c, start + 2 * MONTH)).toBe(true);
    expect(collectionAlive(c, start + 3 * MONTH)).toBe(false);
    expect(collectionLife(c, start + 2 * MONTH)).toMatch(/leaves in 1 month/);
  });

  it("a touch restarts the clock at the chosen span", () => {
    const touched = touchCollection(col({ span: 9 }), start + 8 * MONTH);
    expect(collectionAlive(touched, start + 8 * MONTH + 6 * MONTH)).toBe(true);
    expect(collectionAlive(touched, start + 8 * MONTH + 9 * MONTH)).toBe(false);
  });

  it("an infinite span never leaves", () => {
    const c = col({ span: 0 });
    expect(collectionAlive(c, start + 40 * MONTH)).toBe(true);
    expect(collectionLife(c, start)).toBe("Keeps going");
  });

  it("filters like Discover: text, topic, place, and span", () => {
    const met = col({
      id: "met",
      intent: "Gallery walk",
      pieces: [{ kind: "data", ref: feedRef("met"), name: "Met Museum collection" }],
    });
    const other = col({ id: "other", intent: "Debt story", span: 0 });
    const known = { dataRefs: new Set([feedRef("met"), "feed:debt"]), chartIds: new Set(["chart-1"]) };
    const base = { query: "", show: "all" as const, spans: [], topics: [], where: [], sort: "touched" as const };
    expect(browseCollections([met, other], { ...base, query: "department" }, known).map((c) => c.id)).toEqual(["met"]);
    expect(browseCollections([met, other], { ...base, topics: ["culture"] }, known).map((c) => c.id)).toEqual(["met"]);
    expect(browseCollections([met, other], { ...base, where: ["us"] }, known).map((c) => c.id)).toEqual(["other"]);
    expect(browseCollections([met, other], { ...base, where: ["city"] }, known)).toEqual([]);
    expect(browseCollections([met, other], { ...base, spans: [0] }, known).map((c) => c.id)).toEqual(["other"]);
    expect(browseCollections([met, other], { ...base, show: "charts" }, known).map((c) => c.id)).toEqual(["other"]);
  });

  it("names a piece broken when its dataset or chart is gone", () => {
    const gone = brokenPieces(col(), {
      dataRefs: new Set(["feed:debt"]),
      chartIds: new Set(),
    });
    expect(gone.map((p) => p.kind)).toEqual(["chart"]);
  });
});
