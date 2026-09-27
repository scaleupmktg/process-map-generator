import type { LayoutEdge, LayoutNode, Point, PositionedGraph } from "./types";

/**
 * Route-quality checks — the "validate" half of generate-then-validate. Pure
 * geometry over a positioned graph, so the same checks run in tests, in the
 * audit script, and inside the router when it compares candidate routes.
 *
 *  - edgeNodeOverlaps: an edge segment passes through the interior of a node
 *    (any node, including its own endpoints — a route must only touch those at
 *    its port)
 *  - edgeEdgeOverlaps: two different edges run along the same line for more
 *    than `minOverlap` px (collinear overlap reads as one line)
 *  - crossings: two different edges cross at a point interior to both segments
 *  - nearParallelPx: px of two different edges running side by side closer than
 *    `nearGap` px (they read as a smudged double line)
 *  - labelOverlaps: an edge label's box lands on a node
 *  - labelsOnLines: labels whose box is crossed by another edge's line
 */

export type RouteQuality = {
  edgeNodeOverlaps: { edge: string; node: string }[];
  edgeEdgeOverlaps: { a: string; b: string; length: number }[];
  crossings: number;
  nearParallelPx: number;
  bends: number;
  labelOverlaps: { edge: string; node: string }[];
  labelsOnLines: number;
};

type Rect = { x: number; y: number; w: number; h: number };
type Seg = { edge: string; a: Point; b: Point };

const EPS = 0.5;

export function segments(edge: LayoutEdge): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1];
    const b = edge.points[i];
    if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) continue;
    out.push({ edge: edge.id, a, b });
  }
  return out;
}

const isH = (s: Seg) => Math.abs(s.a.y - s.b.y) < EPS;
const isV = (s: Seg) => Math.abs(s.a.x - s.b.x) < EPS;

/** Does an axis-aligned segment pass through the open interior of a rect? */
export function segmentHitsRect(a: Point, b: Point, r: Rect, pad = 0): boolean {
  const x0 = r.x - pad + EPS;
  const x1 = r.x + r.w + pad - EPS;
  const y0 = r.y - pad + EPS;
  const y1 = r.y + r.h + pad - EPS;
  if (Math.abs(a.y - b.y) < EPS) {
    const y = a.y;
    if (y <= y0 || y >= y1) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi > x0 && lo < x1;
  }
  if (Math.abs(a.x - b.x) < EPS) {
    const x = a.x;
    if (x <= x0 || x >= x1) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi > y0 && lo < y1;
  }
  // Non-orthogonal segment: conservative bounding-box test.
  const lox = Math.min(a.x, b.x);
  const hix = Math.max(a.x, b.x);
  const loy = Math.min(a.y, b.y);
  const hiy = Math.max(a.y, b.y);
  return hix > x0 && lox < x1 && hiy > y0 && loy < y1;
}

function collinearOverlap(p: Seg, q: Seg): number {
  if (isH(p) && isH(q) && Math.abs(p.a.y - q.a.y) < EPS) {
    const lo = Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
    const hi = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x));
    return Math.max(0, hi - lo);
  }
  if (isV(p) && isV(q) && Math.abs(p.a.x - q.a.x) < EPS) {
    const lo = Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
    const hi = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y));
    return Math.max(0, hi - lo);
  }
  return 0;
}

/** Length over which two parallel segments run within (EPS, gap] px of each other. */
function nearParallel(p: Seg, q: Seg, gap: number): number {
  const run = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(0, Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)));
  if (isH(p) && isH(q)) {
    const d = Math.abs(p.a.y - q.a.y);
    return d > EPS && d <= gap ? run(p.a.x, p.b.x, q.a.x, q.b.x) : 0;
  }
  if (isV(p) && isV(q)) {
    const d = Math.abs(p.a.x - q.a.x);
    return d > EPS && d <= gap ? run(p.a.y, p.b.y, q.a.y, q.b.y) : 0;
  }
  return 0;
}

function crosses(p: Seg, q: Seg): boolean {
  const h = isH(p) ? p : isH(q) ? q : null;
  const v = isV(p) ? p : isV(q) ? q : null;
  if (!h || !v || h === v) return false;
  const x = v.a.x;
  const y = h.a.y;
  const hx0 = Math.min(h.a.x, h.b.x);
  const hx1 = Math.max(h.a.x, h.b.x);
  const vy0 = Math.min(v.a.y, v.b.y);
  const vy1 = Math.max(v.a.y, v.b.y);
  return x > hx0 + EPS && x < hx1 - EPS && y > vy0 + EPS && y < vy1 - EPS;
}

export function labelRect(edge: LayoutEdge, fontPt: number): Rect | null {
  if (!edge.label) return null;
  const w = edge.label.length * fontPt * 0.62 + 8;
  const h = fontPt * 1.5;
  return { x: edge.labelPos.x - w / 2, y: edge.labelPos.y - h / 2, w, h };
}

const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;

export function assessRoutes(
  graph: PositionedGraph,
  opts: { labelFontPt?: number; minOverlap?: number; nearGap?: number } = {},
): RouteQuality {
  const fontPt = opts.labelFontPt ?? 11;
  const minOverlap = opts.minOverlap ?? 2;
  const nearGap = opts.nearGap ?? 6;
  const nodes: LayoutNode[] = graph.nodes;

  const segsByEdge = graph.edges.map((e) => ({ edge: e, segs: segments(e) }));

  const edgeNodeOverlaps: RouteQuality["edgeNodeOverlaps"] = [];
  for (const { edge, segs } of segsByEdge) {
    for (const n of nodes) {
      if (segs.some((s) => segmentHitsRect(s.a, s.b, n))) {
        edgeNodeOverlaps.push({ edge: edge.id, node: n.id });
      }
    }
  }

  const edgeEdgeOverlaps: RouteQuality["edgeEdgeOverlaps"] = [];
  let crossings = 0;
  let nearParallelPx = 0;
  for (let i = 0; i < segsByEdge.length; i++) {
    for (let j = i + 1; j < segsByEdge.length; j++) {
      let overlap = 0;
      for (const p of segsByEdge[i].segs) {
        for (const q of segsByEdge[j].segs) {
          overlap += collinearOverlap(p, q);
          nearParallelPx += nearParallel(p, q, nearGap);
          if (crosses(p, q)) crossings++;
        }
      }
      if (overlap > minOverlap) {
        edgeEdgeOverlaps.push({
          a: segsByEdge[i].edge.id,
          b: segsByEdge[j].edge.id,
          length: Math.round(overlap),
        });
      }
    }
  }

  const labelOverlaps: RouteQuality["labelOverlaps"] = [];
  let labelsOnLines = 0;
  for (const e of graph.edges) {
    const r = labelRect(e, fontPt);
    if (!r) continue;
    for (const n of nodes) if (rectsOverlap(r, n)) labelOverlaps.push({ edge: e.id, node: n.id });
    const hit = segsByEdge.some(
      ({ edge, segs }) => edge.id !== e.id && segs.some((s) => segmentHitsRect(s.a, s.b, r)),
    );
    if (hit) labelsOnLines++;
  }

  const bends = graph.edges.reduce((sum, e) => sum + Math.max(0, e.points.length - 2), 0);
  return {
    edgeNodeOverlaps,
    edgeEdgeOverlaps,
    crossings,
    nearParallelPx: Math.round(nearParallelPx),
    bends,
    labelOverlaps,
    labelsOnLines,
  };
}
