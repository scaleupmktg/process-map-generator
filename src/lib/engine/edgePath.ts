import type { Point } from "./types";

/**
 * SVG path data for a connector, drawn the way draw.io draws the same edge so
 * the preview matches the .drawio file:
 *
 *  - rounded corners (`rounded=1`): each corner is cut back by
 *    min(arc, half the adjacent segment) and joined with a quadratic curve
 *    through the corner (mxShape.addPoints);
 *  - line jumps (`jumpStyle=arc`): where this edge crosses an edge drawn BEFORE it,
 *    a small arc hops over the other line — horizontal hops bulge up, vertical
 *    hops bulge right; a crossing too close to a corner or another hop is drawn
 *    flat (mxGraphView.updateLineJumps + mxConnector.paintLine in draw.io).
 */
export type EdgePathOptions = {
  jumpSize: number; // draw.io `jumpSize` (0 = no jumps)
  strokeWidth: number; // draw.io `strokeWidth`
  arcSize?: number; // draw.io `arcSize` for edges (default 20 → corner radius 10)
};

type Routed = { x: number; y: number; jump: boolean };

const THRESH = 0.5;

const f = (n: number) => String(Math.round(n * 100) / 100);

/** Proper crossing point of two segments (not within THRESH of any endpoint). */
function crossing(p0: Point, p1: Point, p2: Point, p3: Point): Point | null {
  const d = (p3.y - p2.y) * (p1.x - p0.x) - (p3.x - p2.x) * (p1.y - p0.y);
  if (d === 0) return null;
  const ua = ((p3.x - p2.x) * (p0.y - p2.y) - (p3.y - p2.y) * (p0.x - p2.x)) / d;
  const ub = ((p1.x - p0.x) * (p0.y - p2.y) - (p1.y - p0.y) * (p0.x - p2.x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  const pt = { x: p0.x + ua * (p1.x - p0.x), y: p0.y + ua * (p1.y - p0.y) };
  const near = (q: Point) => Math.abs(pt.x - q.x) <= THRESH && Math.abs(pt.y - q.y) <= THRESH;
  return near(p0) || near(p1) || near(p2) || near(p3) ? null : pt;
}

/** The edge's points plus a jump point at every crossing with an earlier edge. */
function routedPoints(points: Point[], earlier: Point[][]): Routed[] {
  const out: Routed[] = [];
  for (let j = 0; j < points.length - 1; j++) {
    const p0 = points[j];
    const p1 = points[j + 1];
    out.push({ ...p0, jump: false });
    const hits: (Point & { d: number })[] = [];
    for (const other of earlier) {
      for (let k = 0; k < other.length - 1; k++) {
        const pt = crossing(p0, p1, other[k], other[k + 1]);
        if (!pt) continue;
        const d = (pt.x - p0.x) ** 2 + (pt.y - p0.y) ** 2;
        if (hits.some((h) => h.x === pt.x && h.y === pt.y)) continue;
        hits.push({ ...pt, d });
      }
    }
    hits.sort((a, b) => a.d - b.d);
    for (const h of hits) out.push({ x: h.x, y: h.y, jump: true });
  }
  if (points.length) out.push({ ...points[points.length - 1], jump: false });
  return out;
}

/** Straight runs with rounded corners (mxShape.addPoints, rounded, not closed). */
function addPoints(out: string[], pts: Point[], arc: number, initialMove: boolean): void {
  if (!pts.length) return;
  const pe = pts[pts.length - 1];
  let pt = pts[0];
  out.push(`${initialMove ? "M" : "L"}${f(pt.x)},${f(pt.y)}`);
  let i = 1;
  while (i < pts.length - 1) {
    let tmp = pts[i];
    let dx = pt.x - tmp.x;
    let dy = pt.y - tmp.y;
    if (dx !== 0 || dy !== 0) {
      let dist = Math.sqrt(dx * dx + dy * dy);
      const x1 = tmp.x + (dx * Math.min(arc, dist / 2)) / dist;
      const y1 = tmp.y + (dy * Math.min(arc, dist / 2)) / dist;
      out.push(`L${f(x1)},${f(y1)}`);
      let next = pts[i + 1];
      while (i < pts.length - 2 && Math.round(next.x - tmp.x) === 0 && Math.round(next.y - tmp.y) === 0) {
        next = pts[i + 2];
        i++;
      }
      dx = next.x - tmp.x;
      dy = next.y - tmp.y;
      dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const x2 = tmp.x + (dx * Math.min(arc, dist / 2)) / dist;
      const y2 = tmp.y + (dy * Math.min(arc, dist / 2)) / dist;
      out.push(`Q${f(tmp.x)},${f(tmp.y)} ${f(x2)},${f(y2)}`);
      tmp = { x: x2, y: y2 };
    } else {
      out.push(`L${f(tmp.x)},${f(tmp.y)}`);
    }
    pt = tmp;
    i++;
  }
  out.push(`L${f(pe.x)},${f(pe.y)}`);
}

/**
 * Path data for `points`, hopping over every edge in `earlier` (the edges that
 * come before this one in document order — draw.io only jumps over those).
 */
export function edgePathData(points: Point[], earlier: Point[][], opts: EdgePathOptions): string {
  const arc = (opts.arcSize ?? 20) / 2;
  const out: string[] = [];
  if (points.length < 2) return "";
  if (opts.jumpSize <= 0) {
    addPoints(out, points, arc, true);
    return out.join("");
  }

  const size = (opts.jumpSize - 2) / 2 + opts.strokeWidth;
  const routed = routedPoints(points, earlier);
  let moveTo = true;
  let last: Point | null = null;
  let len = 0;
  let n: Point | null = null;
  let run: Point[] = [];

  for (let i = 0; i < routed.length; i++) {
    const rpt = routed[i];
    const pt = { x: rpt.x, y: rpt.y };
    let done = false;
    if (last && rpt.jump) {
      const next = routed[i + 1];
      const distNext = (next.x - pt.x) ** 2 + (next.y - pt.y) ** 2;
      if (!n) {
        const v = { x: pt.x - last.x, y: pt.y - last.y };
        len = Math.sqrt(v.x * v.x + v.y * v.y);
        n = len > 0 ? { x: (v.x * size) / len, y: (v.y * size) / len } : null;
      }
      if (n && distNext > size * size && len > 0) {
        const distLast = (last.x - pt.x) ** 2 + (last.y - pt.y) ** 2;
        if (distLast > size * size) {
          const p0 = { x: pt.x - n.x, y: pt.y - n.y };
          const p1 = { x: pt.x + n.x, y: pt.y + n.y };
          run.push(p0);
          addPoints(out, run, arc, moveTo);
          const s = (Math.round(n.x) < 0 || (Math.round(n.x) === 0 && Math.round(n.y) <= 0) ? 1 : -1) * 1.3;
          moveTo = false;
          out.push(
            `C${f(p0.x - n.y * s)},${f(p0.y + n.x * s)} ${f(p1.x - n.y * s)},${f(p1.y + n.x * s)} ` +
              `${f(p1.x)},${f(p1.y)}`,
          );
          run = [p1];
          done = true;
        }
      }
    } else {
      n = null;
    }
    if (!done) {
      run.push(pt);
      last = pt;
    }
  }
  addPoints(out, run, arc, moveTo);
  return out.join("");
}
