// =================================================================
// Loom — Flow / network graph helpers (Sankey siblings)
// =================================================================
// Build weighted edges from Source → Target rows, then lay out as a
// force-directed network or an arc diagram. Pure — used by ChartView
// full canvases and ChartCard micro thumbs.
// =================================================================

export interface FlowEdge {
  source: string;
  target: string;
  weight: number;
}

export interface FlowNode {
  id: string;
  weight: number;
  /** True when the id appears as a source in at least one edge. */
  isSource: boolean;
  /** True when the id appears as a target in at least one edge. */
  isTarget: boolean;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface LaidOutNode extends FlowNode {
  x: number;
  y: number;
  r: number;
}

export interface LaidOutEdge extends FlowEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

const MAX_NODES_DEFAULT = 36;
const MAX_EDGES_DEFAULT = 80;

/** Aggregate Source → Target flows; drop self-loops; keep top nodes/edges by weight. */
export function buildFlowGraph(
  rows: unknown[][],
  sourceIdx: number,
  targetIdx: number,
  weightIdx: number,
  opts?: { maxNodes?: number; maxEdges?: number },
): FlowGraph | null {
  if (sourceIdx < 0 || targetIdx < 0 || sourceIdx === targetIdx) return null;
  const maxNodes = opts?.maxNodes ?? MAX_NODES_DEFAULT;
  const maxEdges = opts?.maxEdges ?? MAX_EDGES_DEFAULT;

  const edgeMap = new Map<string, number>();
  const nodeWeight = new Map<string, number>();
  const asSource = new Set<string>();
  const asTarget = new Set<string>();

  for (const r of rows) {
    const s = String(r[sourceIdx] ?? "");
    const t = String(r[targetIdx] ?? "");
    if (!s || !t || s === t) continue;
    const raw = weightIdx >= 0 ? Number(r[weightIdx]) : 1;
    const w = Number.isFinite(raw) && raw !== 0 ? Math.abs(raw) : 1;
    const key = `${s}\0${t}`;
    edgeMap.set(key, (edgeMap.get(key) ?? 0) + w);
    nodeWeight.set(s, (nodeWeight.get(s) ?? 0) + w);
    nodeWeight.set(t, (nodeWeight.get(t) ?? 0) + w);
    asSource.add(s);
    asTarget.add(t);
  }
  if (!edgeMap.size) return null;

  const topNodes = [...nodeWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes)
    .map(([id]) => id);
  const keep = new Set(topNodes);

  const edges = [...edgeMap.entries()]
    .map(([k, weight]) => {
      const [source, target] = k.split("\0");
      return { source: source!, target: target!, weight };
    })
    .filter((e) => keep.has(e.source) && keep.has(e.target))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxEdges);

  if (!edges.length) return null;

  // Recompute node weights from kept edges so radii match what’s drawn.
  const keptWeight = new Map<string, number>();
  const keptSource = new Set<string>();
  const keptTarget = new Set<string>();
  for (const e of edges) {
    keptWeight.set(e.source, (keptWeight.get(e.source) ?? 0) + e.weight);
    keptWeight.set(e.target, (keptWeight.get(e.target) ?? 0) + e.weight);
    keptSource.add(e.source);
    keptTarget.add(e.target);
  }

  const nodes: FlowNode[] = [...keptWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, weight]) => ({
      id,
      weight,
      isSource: keptSource.has(id),
      isTarget: keptTarget.has(id),
    }));

  return { nodes, edges };
}

/** Stable 0–1 hash from a string (for deterministic seeds). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

function nodeRadii(nodes: FlowNode[], maxR: number, minR: number): Map<string, number> {
  const maxW = Math.max(...nodes.map((n) => n.weight), 1);
  const out = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, minR + Math.sqrt(n.weight / maxW) * (maxR - minR));
  }
  return out;
}

function edgeWidths(edges: FlowEdge[], maxW: number, minW: number): Map<string, number> {
  const peak = Math.max(...edges.map((e) => e.weight), 1);
  const out = new Map<string, number>();
  for (const e of edges) {
    out.set(`${e.source}\0${e.target}`, minW + (e.weight / peak) * (maxW - minW));
  }
  return out;
}

/**
 * Force-directed layout: attraction along edges, repulsion between nodes,
 * mild centering. Deterministic seed from node ids.
 */
export function layoutForceNetwork(
  graph: FlowGraph,
  w: number,
  h: number,
  pad: number,
  opts?: { iterations?: number; mini?: boolean },
): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  const { nodes, edges } = graph;
  const mini = !!opts?.mini;
  const iterations = opts?.iterations ?? (mini ? 40 : 120);
  const plotW = Math.max(1, w - 2 * pad);
  const plotH = Math.max(1, h - 2 * pad);
  const cx = pad + plotW / 2;
  const cy = pad + plotH / 2;
  const maxR = mini ? Math.min(plotW, plotH) * 0.08 : Math.min(plotW, plotH) * 0.07;
  const minR = mini ? 2 : 5;
  const radii = nodeRadii(nodes, maxR, minR);
  const widths = edgeWidths(edges, mini ? 2.5 : 6, mini ? 0.4 : 0.8);

  // Seed on a circle so early frames aren’t a pile in the center.
  type Body = { id: string; x: number; y: number; vx: number; vy: number; r: number; weight: number; isSource: boolean; isTarget: boolean };
  const bodies: Body[] = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 + hash01(n.id) * 0.4;
    const d = Math.min(plotW, plotH) * (0.28 + hash01(n.id + "r") * 0.12);
    return {
      id: n.id,
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d,
      vx: 0,
      vy: 0,
      r: radii.get(n.id) ?? minR,
      weight: n.weight,
      isSource: n.isSource,
      isTarget: n.isTarget,
    };
  });
  const byId = new Map(bodies.map((b) => [b.id, b]));

  const ideal = Math.min(plotW, plotH) / Math.max(4, Math.sqrt(nodes.length));
  for (let iter = 0; iter < iterations; iter++) {
    const cool = 1 - iter / iterations;
    // Repulsion
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = a.r + b.r + 4;
        if (dist < minDist) dist = minDist;
        const force = ((ideal * ideal) / dist) * cool * 0.35;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // Attraction along edges
    for (const e of edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - ideal * 1.1) * 0.08 * cool;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Center pull + integrate
    for (const b of bodies) {
      b.vx += (cx - b.x) * 0.015;
      b.vy += (cy - b.y) * 0.015;
      b.vx *= 0.72;
      b.vy *= 0.72;
      b.x += b.vx;
      b.y += b.vy;
      b.x = Math.min(w - pad - b.r, Math.max(pad + b.r, b.x));
      b.y = Math.min(h - pad - b.r, Math.max(pad + b.r, b.y));
    }
  }

  const laidNodes: LaidOutNode[] = bodies.map((b) => ({
    id: b.id,
    weight: b.weight,
    isSource: b.isSource,
    isTarget: b.isTarget,
    x: b.x,
    y: b.y,
    r: b.r,
  }));
  const pos = new Map(laidNodes.map((n) => [n.id, n]));
  const laidEdges: LaidOutEdge[] = edges
    .map((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return null;
      return {
        ...e,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        width: widths.get(`${e.source}\0${e.target}`) ?? 1,
      };
    })
    .filter((e): e is LaidOutEdge => !!e);

  return { nodes: laidNodes, edges: laidEdges };
}

/**
 * Arc diagram: nodes on a horizontal baseline, edges as semicircle arcs above.
 * Order by total weight; good when force layout feels noisy.
 */
export function layoutArcDiagram(
  graph: FlowGraph,
  w: number,
  h: number,
  pad: number,
  opts?: { mini?: boolean },
): { nodes: LaidOutNode[]; edges: LaidOutEdge[] } {
  const { nodes, edges } = graph;
  const mini = !!opts?.mini;
  const plotW = Math.max(1, w - 2 * pad);
  const baseline = h - pad - (mini ? 4 : 14);
  const maxR = mini ? 3.5 : 8;
  const minR = mini ? 1.5 : 3.5;
  const radii = nodeRadii(nodes, maxR, minR);
  const widths = edgeWidths(edges, mini ? 2 : 5, mini ? 0.35 : 0.7);

  const n = Math.max(1, nodes.length);
  const laidNodes: LaidOutNode[] = nodes.map((node, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return {
      ...node,
      x: pad + t * plotW,
      y: baseline,
      r: radii.get(node.id) ?? minR,
    };
  });
  const pos = new Map(laidNodes.map((node) => [node.id, node]));
  const laidEdges: LaidOutEdge[] = edges
    .map((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return null;
      return {
        ...e,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        width: widths.get(`${e.source}\0${e.target}`) ?? 1,
      };
    })
    .filter((e): e is LaidOutEdge => !!e);

  return { nodes: laidNodes, edges: laidEdges };
}

/** Draw a semicircle arc from (x1,y1) to (x2,y2) above the baseline. */
export function strokeArcLink(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const mx = (x1 + x2) / 2;
  const span = Math.abs(x2 - x1);
  const rise = Math.max(8, span * 0.45);
  const my = Math.min(y1, y2) - rise;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();
}
