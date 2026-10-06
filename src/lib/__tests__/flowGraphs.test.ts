// =================================================================
// Tests — flowGraphs (network / arc diagram layouts)
// =================================================================

import { describe, expect, it } from "vitest";
import {
  buildFlowGraph,
  layoutForceNetwork,
  layoutArcDiagram,
} from "../flowGraphs";

function rows(edges: [string, string, number?][]): unknown[][] {
  return edges.map(([s, t, w]) => [s, t, w ?? 1]);
}

describe("flowGraphs", () => {
  it("builds weighted edges and drops self-loops", () => {
    const g = buildFlowGraph(
      rows([
        ["A", "B", 2],
        ["A", "B", 3],
        ["B", "C", 1],
        ["C", "C", 9],
      ]),
      0,
      1,
      2,
    );
    expect(g).toBeTruthy();
    expect(g!.edges.find((e) => e.source === "A" && e.target === "B")?.weight).toBe(5);
    expect(g!.edges.some((e) => e.source === e.target)).toBe(false);
    expect(g!.nodes.some((n) => n.id === "A" && n.isSource)).toBe(true);
  });

  it("force layout keeps nodes inside the pad", () => {
    const g = buildFlowGraph(
      rows([
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["a", "d"],
        ["d", "b"],
      ]),
      0,
      1,
      -1,
    )!;
    const { nodes, edges } = layoutForceNetwork(g, 400, 300, 24, { iterations: 60 });
    expect(nodes.length).toBeGreaterThan(2);
    expect(edges.length).toBeGreaterThan(2);
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(24);
      expect(n.x).toBeLessThanOrEqual(400 - 24);
      expect(n.y).toBeGreaterThanOrEqual(24);
      expect(n.y).toBeLessThanOrEqual(300 - 24);
      expect(n.r).toBeGreaterThan(0);
    }
  });

  it("arc diagram places nodes on a baseline", () => {
    const g = buildFlowGraph(
      rows([
        ["west", "east", 4],
        ["east", "north", 2],
        ["north", "west", 1],
      ]),
      0,
      1,
      2,
    )!;
    const { nodes, edges } = layoutArcDiagram(g, 320, 180, 16);
    expect(nodes.length).toBe(3);
    expect(edges.length).toBe(3);
    const ys = new Set(nodes.map((n) => Math.round(n.y)));
    expect(ys.size).toBe(1);
    const xs = nodes.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(xs[xs.length - 1]!);
  });
});
