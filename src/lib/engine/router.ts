import type { Modeling } from "@/lib/skill/schema";
import type { EdgeKind, LayoutNode, Point } from "./types";
import { segmentHitsRect } from "./routeQuality";

/**
 * Obstacle-aware orthogonal connector router.
 *
 * Orthogonal visibility-grid routing (after Wybrow, Marriott & Stuckey,
 * "Orthogonal Connector Routing", Graph Drawing 2009):
 *
 *  1. Every shape is an obstacle, inflated by `clearance`. Routing lines are the
 *     obstacle boundaries, the ports, and evenly spaced tracks through the free
 *     gutters between obstacles.
 *  2. Each connector is found by A* over (grid vertex × travel axis), minimising
 *        length + bendPenalty·bends + crossingPenalty·crossings
 *        + overlapPenalty·(px run on top of another connector)
 *        + nearPenalty·(px run closer than trackSpacing beside another connector)
 *        + hugPenalty·(px run along a shape's clearance line).
 *     Obstacle interiors are walls, so a connector cannot pass through a shape —
 *     that is a guarantee of the search, not a heuristic clean-up.
 *  3. Pass 1 lets A* pick each connector's exit/entry side (a decision's corners
 *     are single-use for its outgoing branches). Pass 2 spreads connectors that
 *     share a side into distinct ports — ordered so they do not cross at the
 *     shape, with a straight-through connector kept straight — and re-routes
 *     everything. Pass 3 rips up and re-routes each connector once against all
 *     the others, so early connectors can also dodge later ones.
 *  4. Labels sit near the start of the connector — on the line, or beside it —
 *     at the first spot that lands on no shape, no other label and no other
 *     connector.
 *
 * Pure and deterministic: the same input always yields the same routes.
 */

export type RoutingConfig = Modeling["routing"];
export type EdgeSpec = { id: string; from: string; to: string; label: string; kind: EdgeKind };
/** labelPos = the point at labelT along the polyline, plus labelOffset. */
export type RoutedEdge = { points: Point[]; labelPos: Point; labelT: number; labelOffset: Point };
export type Bounds = { x0: number; y0: number; x1: number; y1: number };

type Side = 0 | 1 | 2 | 3; // left, right, top, bottom
const SIDES: readonly Side[] = [0, 1, 2, 3];
const NX = [-1, 1, 0, 0];
const NY = [0, 0, -1, 1];
const AXIS = [0, 0, 1, 1]; // travel axis of a side's stub: 0 = horizontal, 1 = vertical
const EPS = 0.01;
const SOFT_WALL = 1000; // per-px cost of cutting through a shape (fallback search only)
const MAX_EXPAND = 600_000;

type Rect = { x0: number; y0: number; x1: number; y1: number };

// ---------------------------------------------------------------- helpers --

function uniqSorted(vals: number[]): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

/** First index i with arr[i] >= v (within EPS). */
function firstGE(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v - EPS) lo = m + 1;
    else hi = m;
  }
  return lo;
}
/** Last index i with arr[i] <= v (within EPS). */
function lastLE(arr: number[], v: number): number {
  return firstGE(arr, v + 2 * EPS) - 1;
}
function indexOf(arr: number[], v: number): number {
  const i = firstGE(arr, v);
  return i < arr.length && Math.abs(arr[i] - v) <= EPS ? i : -1;
}

/**
 * Add evenly spaced tracks (whole px) to every free gutter between routing lines.
 * Tracks are laid at half the preferred spacing: the near-penalty keeps
 * connectors a full trackSpacing apart while there is room, and the extra
 * tracks let a congested gutter take one more connector close alongside
 * instead of stacking it on top of another.
 */
function withTracks(base: number[], spans: [number, number][], cfg: RoutingConfig): number[] {
  const out = [...base];
  for (let k = 1; k < base.length; k++) {
    const a = base[k - 1];
    const b = base[k];
    const gap = b - a;
    if (gap < 4) continue;
    // A strip that lies inside some obstacle's span is not a gutter.
    if (spans.some(([r0, r1]) => r0 <= a + EPS && r1 >= b - EPS)) continue;
    const n = Math.max(1, Math.min(cfg.maxTracks, Math.floor(gap / (cfg.trackSpacing / 2)) - 1));
    for (let t = 1; t <= n; t++) out.push(Math.round(a + (gap * t) / (n + 1)));
  }
  return uniqSorted(out);
}

function inflate(n: LayoutNode, c: number): Rect {
  return { x0: n.x - c, y0: n.y - c, x1: n.x + n.w + c, y1: n.y + n.h + c };
}

function portPoint(n: LayoutNode, side: Side, t: number): Point {
  switch (side) {
    case 0:
      return { x: n.x, y: n.y + t * n.h };
    case 1:
      return { x: n.x + n.w, y: n.y + t * n.h };
    case 2:
      return { x: n.x + t * n.w, y: n.y };
    default:
      return { x: n.x + t * n.w, y: n.y + n.h };
  }
}

/** Drop repeated points and merge collinear runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) <= EPS && Math.abs(q.y - p.y) <= EPS) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - p.x) <= EPS) ||
        (Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - p.y) <= EPS);
      if (!collinear) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

export function pathLength(points: Point[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++)
    L += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  return L;
}

export function pointAt(points: Point[], d: number): Point {
  let rest = d;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (rest <= len) {
      const r = len === 0 ? 0 : rest / len;
      return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
    }
    rest -= len;
  }
  return points[points.length - 1];
}

// ------------------------------------------------------------------- grid --

class Grid {
  readonly nx: number;
  readonly ny: number;
  readonly vBlocked: Uint8Array; // vertex strictly inside an obstacle
  readonly hStep: Uint8Array; // step (i,j)->(i+1,j) runs through an obstacle, at i*ny+j
  readonly vStep: Uint8Array; // step (i,j)->(i,j+1) runs through an obstacle
  readonly hHug: Uint8Array; // step runs along an obstacle's clearance line
  readonly vHug: Uint8Array;

  constructor(
    readonly xs: number[],
    readonly ys: number[],
    obstacles: Rect[],
  ) {
    const nx = (this.nx = xs.length);
    const ny = (this.ny = ys.length);
    const n = nx * ny;
    this.vBlocked = new Uint8Array(n);
    this.hStep = new Uint8Array(n);
    this.vStep = new Uint8Array(n);
    this.hHug = new Uint8Array(n);
    this.vHug = new Uint8Array(n);
    for (const o of obstacles) {
      const ixIn0 = firstGE(xs, o.x0 + 2 * EPS); // strictly inside
      const ixIn1 = lastLE(xs, o.x1 - 2 * EPS);
      const iyIn0 = firstGE(ys, o.y0 + 2 * EPS);
      const iyIn1 = lastLE(ys, o.y1 - 2 * EPS);
      const ixOn0 = firstGE(xs, o.x0); // inside or on the boundary
      const ixOn1 = lastLE(xs, o.x1);
      const iyOn0 = firstGE(ys, o.y0);
      const iyOn1 = lastLE(ys, o.y1);
      for (let i = ixIn0; i <= ixIn1; i++)
        for (let j = iyIn0; j <= iyIn1; j++) this.vBlocked[i * ny + j] = 1;
      for (let i = ixOn0; i < ixOn1; i++)
        for (let j = iyIn0; j <= iyIn1; j++) this.hStep[i * ny + j] = 1;
      for (let i = ixIn0; i <= ixIn1; i++)
        for (let j = iyOn0; j < iyOn1; j++) this.vStep[i * ny + j] = 1;
      // Clearance lines: the top/bottom and left/right boundaries of the obstacle.
      for (const jy of [indexOf(ys, o.y0), indexOf(ys, o.y1)])
        if (jy >= 0) for (let i = ixOn0; i < ixOn1; i++) this.hHug[i * ny + jy] = 1;
      for (const ix of [indexOf(xs, o.x0), indexOf(xs, o.x1)])
        if (ix >= 0) for (let j = iyOn0; j < iyOn1; j++) this.vHug[ix * ny + j] = 1;
    }
  }

  vertex(p: Point): number {
    const i = indexOf(this.xs, p.x);
    const j = indexOf(this.ys, p.y);
    return i < 0 || j < 0 ? -1 : i * this.ny + j;
  }
  point(v: number): Point {
    const i = Math.floor(v / this.ny);
    return { x: this.xs[i], y: this.ys[v - i * this.ny] };
  }
}

type Occupancy = {
  h: Int16Array; // routed connectors using each horizontal step
  v: Int16Array;
  hStraight: Int16Array; // routed connectors passing straight through horizontally
  vStraight: Int16Array;
};

function newOccupancy(n: number): Occupancy {
  return {
    h: new Int16Array(n),
    v: new Int16Array(n),
    hStraight: new Int16Array(n),
    vStraight: new Int16Array(n),
  };
}

// ------------------------------------------------------------------ A* ----

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  peekKey(): number {
    return this.keys[0];
  }
  clear(): void {
    this.ids.length = 0;
    this.keys.length = 0;
  }
  push(id: number, key: number): void {
    const { ids, keys } = this;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const { ids, keys } = this;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Search state reused across the connectors of one grid (generation-stamped). */
class Workspace {
  readonly g: Float64Array;
  readonly parent: Int32Array;
  readonly tag: Int32Array;
  readonly stamp: Uint32Array; // == gen → g/parent/tag valid for this search
  readonly closed: Uint32Array; // == gen → closed in this search
  readonly heap = new MinHeap();
  gen = 0;
  constructor(states: number) {
    this.g = new Float64Array(states);
    this.parent = new Int32Array(states);
    this.tag = new Int32Array(states);
    this.stamp = new Uint32Array(states);
    this.closed = new Uint32Array(states);
  }
}

type Terminal = { v: number; axis: number; cost: number; tag: number };

function astar(
  grid: Grid,
  ws: Workspace,
  starts: Terminal[],
  goals: Terminal[],
  occ: Occupancy,
  cfg: RoutingConfig,
  soft: boolean,
): { path: number[]; start: number; goal: number } | null {
  const { nx, ny, xs, ys, vBlocked, hStep, vStep, hHug, vHug } = grid;
  const { g, parent, tag, stamp, closed, heap } = ws;
  const gen = ++ws.gen;
  heap.clear();

  const goalAt = new Map<number, Terminal[]>();
  for (const t of goals) {
    const list = goalAt.get(t.v) ?? [];
    list.push(t);
    goalAt.set(t.v, list);
  }
  const goalPts = goals.map((t) => grid.point(t.v));
  const h = (v: number) => {
    const i = Math.floor(v / ny);
    const x = xs[i];
    const y = ys[v - i * ny];
    let m = Infinity;
    for (const q of goalPts) m = Math.min(m, Math.abs(x - q.x) + Math.abs(y - q.y));
    return m;
  };

  for (const s of starts) {
    const id = s.v * 2 + s.axis;
    if (stamp[id] !== gen || s.cost < g[id]) {
      stamp[id] = gen;
      g[id] = s.cost;
      parent[id] = -1;
      tag[id] = s.tag;
      heap.push(id, s.cost + h(s.v));
    }
  }

  const { bendPenalty, crossingPenalty, overlapPenalty, nearPenalty, hugPenalty, trackSpacing } = cfg;
  // Stepping onto a line another connector already runs along costs more than
  // crossing it; otherwise a route "crosses" by merging on and off the other line.
  const joinPenalty = 2 * crossingPenalty;
  const stepUsed = (a: number, b: number) =>
    b === a + ny ? occ.h[a] : b === a - ny ? occ.h[b] : b === a + 1 ? occ.v[a] : occ.v[b];
  // Connectors on the neighbouring parallel line when it is closer than trackSpacing.
  const nearH = (s: number, j: number) =>
    (j > 0 && ys[j] - ys[j - 1] < trackSpacing ? occ.h[s - 1] : 0) +
    (j + 1 < ny && ys[j + 1] - ys[j] < trackSpacing ? occ.h[s + 1] : 0);
  const nearV = (s: number, i: number) =>
    (i > 0 && xs[i] - xs[i - 1] < trackSpacing ? occ.v[s - ny] : 0) +
    (i + 1 < nx && xs[i + 1] - xs[i] < trackSpacing ? occ.v[s + ny] : 0);
  let best = Infinity;
  let bestId = -1;
  let bestGoal = -1;
  let expanded = 0;

  while (heap.size) {
    if (heap.peekKey() >= best) break;
    const id = heap.pop();
    if (closed[id] === gen) continue;
    closed[id] = gen;
    if (++expanded > MAX_EXPAND) break;
    const v = id >> 1;
    const axis = id & 1;
    const gv = g[id];

    const here = goalAt.get(v);
    if (here) {
      for (const t of here) {
        const total = gv + (axis === t.axis ? 0 : bendPenalty) + t.cost;
        if (total < best) {
          best = total;
          bestId = id;
          bestGoal = t.tag;
        }
      }
    }

    const i = Math.floor(v / ny);
    const j = v - i * ny;
    const prev = parent[id] >= 0 ? parent[id] >> 1 : -1;
    const onShared = prev >= 0 && stepUsed(prev, v) > 0;
    const relax = (u: number, a: number, len: number, blocked: number, used: number, near: number, hug: number) => {
      const wall = blocked || vBlocked[u];
      if (wall && !soft) return;
      let c = len;
      if (a !== axis) c += bendPenalty;
      else if ((a === 0 ? occ.vStraight[v] : occ.hStraight[v]) > 0) c += crossingPenalty;
      if (used > 0) c += overlapPenalty * len * used + (onShared ? 0 : joinPenalty);
      if (near > 0) c += nearPenalty * len * near;
      if (hug) c += hugPenalty * len;
      if (wall) c += SOFT_WALL * Math.max(len, 1);
      const nid = u * 2 + a;
      const ng = gv + c;
      if (stamp[nid] !== gen || ng < g[nid]) {
        stamp[nid] = gen;
        g[nid] = ng;
        parent[nid] = id;
        tag[nid] = tag[id];
        heap.push(nid, ng + h(u));
      }
    };
    if (i + 1 < nx) relax(v + ny, 0, xs[i + 1] - xs[i], hStep[v], occ.h[v], nearH(v, j), hHug[v]);
    if (i > 0) {
      const s = v - ny;
      relax(s, 0, xs[i] - xs[i - 1], hStep[s], occ.h[s], nearH(s, j), hHug[s]);
    }
    if (j + 1 < ny) relax(v + 1, 1, ys[j + 1] - ys[j], vStep[v], occ.v[v], nearV(v, i), vHug[v]);
    if (j > 0) {
      const s = v - 1;
      relax(s, 1, ys[j] - ys[j - 1], vStep[s], occ.v[s], nearV(s, i), vHug[s]);
    }
  }

  if (bestId < 0) return null;
  const path: number[] = [];
  for (let cur = bestId; cur >= 0; cur = parent[cur]) path.push(cur >> 1);
  path.reverse();
  return { path, start: tag[bestId], goal: bestGoal };
}

/** Add (delta = 1) or remove (delta = -1) a routed path's footprint. */
function occupy(grid: Grid, occ: Occupancy, path: number[], startAxis: number, goalAxis: number, delta: 1 | -1) {
  const ny = grid.ny;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    if (b === a + ny) occ.h[a] += delta;
    else if (b === a - ny) occ.h[b] += delta;
    else if (b === a + 1) occ.v[a] += delta;
    else if (b === a - 1) occ.v[b] += delta;
  }
  for (let k = 1; k < path.length - 1; k++) {
    const horizIn = Math.abs(path[k] - path[k - 1]) === ny;
    const horizOut = Math.abs(path[k + 1] - path[k]) === ny;
    if (horizIn && horizOut) occ.hStraight[path[k]] += delta;
    else if (!horizIn && !horizOut) occ.vStraight[path[k]] += delta;
  }
  // The stubs run straight into their ports, so passing across a stub end is a crossing.
  const mark = (v: number, axis: number) => {
    if (axis === 0) occ.hStraight[v] += delta;
    else occ.vStraight[v] += delta;
  };
  mark(path[0], startAxis);
  mark(path[path.length - 1], goalAxis);
}

// --------------------------------------------------------------- routing --

type Port = { side: Side; t: number };
/** path = grid vertices of the route (absent for a pass-1 fallback route). */
type Route = { src: Port; tgt: Port; points: Point[]; path?: number[] };
type Candidate = { port: Port; cost: number };

export function routeEdges(
  nodes: LayoutNode[],
  edges: EdgeSpec[],
  bounds: Bounds,
  cfg: RoutingConfig,
  labelFontPt: number,
  /** y of the borders between swimlanes — connectors may cross them, never run along them. */
  laneLines: number[] = [],
): RoutedEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const c = cfg.clearance;
  const obstacles = nodes.map((n) => inflate(n, c));

  // Main flow first, then branches in reading order, loop-backs last.
  const order = edges
    .map((_, i) => i)
    .filter((i) => byId.has(edges[i].from) && byId.has(edges[i].to) && edges[i].from !== edges[i].to)
    .sort((a, b) => {
      const ea = edges[a];
      const eb = edges[b];
      if (ea.kind !== eb.kind) return ea.kind === "forward" ? -1 : 1;
      const sa = byId.get(ea.from)!.seq;
      const sb = byId.get(eb.from)!.seq;
      return sa !== sb ? sa - sb : a - b;
    });

  const buildGrid = (extraX: number[], extraY: number[]) => {
    const inX = (x: number) => x >= bounds.x0 - EPS && x <= bounds.x1 + EPS;
    const inY = (y: number) => y >= bounds.y0 - EPS && y <= bounds.y1 + EPS;
    const baseX = uniqSorted([bounds.x0, bounds.x1, ...obstacles.flatMap((o) => [o.x0, o.x1]), ...extraX]).filter(inX);
    const baseY = uniqSorted([bounds.y0, bounds.y1, ...obstacles.flatMap((o) => [o.y0, o.y1]), ...extraY]).filter(inY);
    const xs = withTracks(baseX, obstacles.map((o) => [o.x0, o.x1] as [number, number]), cfg);
    // Lane borders split the gutters they cross, and no track lies on or right
    // beside one — a connector running along a lane border reads as the border.
    const lanes = laneLines.filter(inY);
    const isBase = (y: number) => indexOf(baseY, y) >= 0;
    const ys = withTracks(uniqSorted([...baseY, ...lanes]), obstacles.map((o) => [o.y0, o.y1] as [number, number]), cfg).filter(
      (y) => isBase(y) || !lanes.some((l) => Math.abs(l - y) < 9),
    );
    return new Grid(xs, ys, obstacles);
  };

  const stub = (n: LayoutNode, port: Port) => {
    const p = portPoint(n, port.side, port.t);
    return { p, q: { x: p.x + NX[port.side] * c, y: p.y + NY[port.side] * c } };
  };

  /** Cost of attaching to `side` of n when the far end of the connector is `other`. */
  const sideCost = (n: LayoutNode, side: Side, other: LayoutNode) => {
    const dx = other.cx - n.cx;
    const dy = other.cy - n.cy;
    const dots = SIDES.map((s) => NX[s] * dx + NY[s] * dy);
    const dot = dots[side];
    if (dot >= Math.max(...dots) - EPS) return 0;
    if (dot > EPS) return cfg.sidePenalty / 2;
    if (dot > -EPS) return cfg.sidePenalty;
    return cfg.backSidePenalty;
  };

  // One grid + search workspace + occupancy per pass.
  let grid = buildGrid(nodes.map((n) => n.cx), nodes.map((n) => n.cy));
  let ws = new Workspace(grid.nx * grid.ny * 2);
  let occ = newOccupancy(grid.nx * grid.ny);

  /** Route edge ei from one of `srcs` to one of `tgts`, and record its footprint. */
  const routeOne = (ei: number, srcs: Candidate[], tgts: Candidate[]): Route | null => {
    const s = byId.get(edges[ei].from)!;
    const t = byId.get(edges[ei].to)!;
    const terminals = (n: LayoutNode, cands: Candidate[]): Terminal[] =>
      cands.flatMap((cand, k) => {
        const v = grid.vertex(stub(n, cand.port).q);
        return v < 0 ? [] : [{ v, axis: AXIS[cand.port.side], cost: cand.cost, tag: k }];
      });
    const allS = terminals(s, srcs);
    const allT = terminals(t, tgts);
    if (!allS.length || !allT.length) return null;
    const hardS = allS.filter((x) => !grid.vBlocked[x.v]);
    const hardT = allT.filter((x) => !grid.vBlocked[x.v]);
    const found =
      (hardS.length && hardT.length ? astar(grid, ws, hardS, hardT, occ, cfg, false) : null) ??
      astar(grid, ws, allS, allT, occ, cfg, true);
    if (!found) return null;
    const src = srcs[found.start].port;
    const tgt = tgts[found.goal].port;
    occupy(grid, occ, found.path, AXIS[src.side], AXIS[tgt.side], 1);
    const points = simplify([stub(s, src).p, ...found.path.map((v) => grid.point(v)), stub(t, tgt).p]);
    return { src, tgt, points, path: found.path };
  };
  const release = (r: Route) => {
    if (r.path) occupy(grid, occ, r.path, AXIS[r.src.side], AXIS[r.tgt.side], -1);
  };

  // ------------------------------------------------ pass 1: choose sides --
  const usedSides = new Map<string, Set<Side>>();
  const pass1: (Route | null)[] = edges.map(() => null);
  for (const ei of order) {
    const s = byId.get(edges[ei].from)!;
    const t = byId.get(edges[ei].to)!;
    const usedS = usedSides.get(s.id) ?? new Set<Side>();
    const usedT = usedSides.get(t.id) ?? new Set<Side>();
    let srcs: Candidate[] = SIDES.filter((side) => !(s.kind === "decision" && usedS.has(side))) // one branch per corner
      .map((side) => ({
        port: { side, t: 0.5 },
        cost: sideCost(s, side, t) + (usedS.has(side) ? cfg.sidePenalty / 2 : 0),
      }));
    if (!srcs.length) srcs = SIDES.map((side) => ({ port: { side, t: 0.5 }, cost: sideCost(s, side, t) }));
    const tgts: Candidate[] = SIDES.map((side) => ({
      port: { side, t: 0.5 },
      cost:
        sideCost(t, side, s) +
        (usedT.has(side) ? (t.kind === "decision" ? 10 * cfg.backSidePenalty : cfg.sidePenalty / 2) : 0),
    }));
    const r = routeOne(ei, srcs, tgts);
    pass1[ei] = r;
    if (r) {
      usedSides.set(s.id, usedS.add(r.src.side));
      usedSides.set(t.id, usedT.add(r.tgt.side));
    }
  }

  // --------------------------------- pass 2: spread shared sides, re-route --
  type End = { ei: number; out: boolean; key: number };
  const groups = new Map<string, End[]>();
  const addEnd = (nodeId: string, side: Side, end: End) => {
    const k = `${nodeId}|${side}`;
    groups.set(k, [...(groups.get(k) ?? []), end]);
  };
  for (const ei of order) {
    const r = pass1[ei];
    if (!r) continue;
    // Facing sides of two aligned shapes: the connector can run dead straight, so
    // it keeps both centres (key 0) even if pass 1 had to jog around a shared port.
    const s = byId.get(edges[ei].from)!;
    const t = byId.get(edges[ei].to)!;
    const facing =
      (r.src.side ^ 1) === r.tgt.side &&
      (r.src.side < 2
        ? Math.abs(s.cy - t.cy) < 1 && (r.src.side === 1) === t.cx > s.cx
        : Math.abs(s.cx - t.cx) < 1 && (r.src.side === 3) === t.cy > s.cy);
    addEnd(s.id, r.src.side, { ei, out: true, key: facing ? 0 : departureKey(r.src.side, r.points) });
    addEnd(t.id, r.tgt.side, {
      ei,
      out: false,
      key: facing ? 0 : departureKey(r.tgt.side, [...r.points].reverse()),
    });
  }
  const finalPorts = new Map<string, Port>(); // `${ei}|out` / `${ei}|in`
  for (const [k, ends] of groups) {
    const [nodeId, sideStr] = k.split("|");
    const side = Number(sideStr) as Side;
    ends.sort((a, b) => a.key - b.key || a.ei - b.ei);
    // A connector that ran straight in pass 1 (key 0) keeps the side's centre.
    const straight = ends.findIndex((end) => end.key === 0);
    const ts = spread(byId.get(nodeId)!, side, ends.length, cfg, straight);
    ends.forEach((end, i) => finalPorts.set(`${end.ei}|${end.out ? "out" : "in"}`, { side, t: ts[i] }));
  }

  const extraX: number[] = nodes.map((n) => n.cx);
  const extraY: number[] = nodes.map((n) => n.cy);
  for (const ei of order) {
    for (const [nodeId, dir] of [
      [edges[ei].from, "out"],
      [edges[ei].to, "in"],
    ] as const) {
      const port = finalPorts.get(`${ei}|${dir}`);
      if (!port) continue;
      const { q } = stub(byId.get(nodeId)!, port);
      extraX.push(q.x);
      extraY.push(q.y);
    }
  }
  grid = buildGrid(extraX, extraY);
  ws = new Workspace(grid.nx * grid.ny * 2);
  occ = newOccupancy(grid.nx * grid.ny);
  const routes: (Route | null)[] = edges.map(() => null);
  for (const ei of order) {
    const src = finalPorts.get(`${ei}|out`);
    const tgt = finalPorts.get(`${ei}|in`);
    const r = src && tgt ? routeOne(ei, [{ port: src, cost: 0 }], [{ port: tgt, cost: 0 }]) : null;
    // A pass-1 fallback keeps its points but not its path (that indexed the old grid).
    routes[ei] = r ?? (pass1[ei] ? { ...pass1[ei]!, path: undefined } : null);
  }

  // ------------------------------- pass 3: rip up and re-route each once --
  // Early connectors were routed before later ones existed; now that every
  // connector is in place, give each a second look with all the others present.
  for (const ei of order) {
    const r = routes[ei];
    if (!r?.path) continue;
    release(r);
    routes[ei] = routeOne(ei, [{ port: r.src, cost: 0 }], [{ port: r.tgt, cost: 0 }]) ?? r;
    if (routes[ei] === r) occupy(grid, occ, r.path, AXIS[r.src.side], AXIS[r.tgt.side], 1);
  }

  // ------------------------------------------------------------ labels --
  const results: RoutedEdge[] = edges.map((e, ei) => {
    const r = routes[ei];
    const s = byId.get(e.from);
    const t = byId.get(e.to);
    const points = r ? r.points : s && t ? [{ x: s.cx, y: s.cy }, { x: t.cx, y: t.cy }] : [];
    return {
      points,
      labelPos: pointAt(points, pathLength(points) / 2),
      labelT: 0.5,
      labelOffset: { x: 0, y: 0 },
    };
  });

  const placed: Box[] = [];
  for (const ei of order) {
    const e = edges[ei];
    if (!e.label) continue;
    const res = results[ei];
    const total = pathLength(res.points);
    if (total <= 0) continue;
    const w = e.label.length * labelFontPt * 0.62 + 8;
    const h = labelFontPt * 1.5;
    const segs = (pts: Point[]) => pts.slice(1).map((p, m) => ({ a: pts[m], b: p }));
    const others = results.flatMap((o, k) => (k === ei ? [] : segs(o.points)));
    const own = segs(res.points);
    // 0 = a clean spot; otherwise how bad: on a shape ≫ on a label ≫ on a line.
    const badness = (pos: Point, beside: boolean) => {
      const box = { x: pos.x - w / 2, y: pos.y - h / 2, w, h };
      let bad = 0;
      if (nodes.some((n) => boxesOverlap(box, { x: n.x - 2, y: n.y - 2, w: n.w + 4, h: n.h + 4 }))) bad += 100;
      if (placed.some((p) => boxesOverlap(box, p))) bad += 10;
      if (others.some((sg) => segmentHitsRect(sg.a, sg.b, box))) bad += 1;
      // A label beside its line must not sit on another stretch of that line.
      if (beside && own.some((sg) => segmentHitsRect(sg.a, sg.b, box))) bad += 1;
      return bad;
    };
    // Near the source first — on the line, then beside it — then further along;
    // the first clean spot wins, else the least-bad one seen.
    let chosen = { d: total / 2, off: { x: 0, y: 0 } as Point, bad: Infinity };
    const near = [c + 14, c + 26, c + 40];
    const far = [0.35, 0.5, 0.65, 0.2, 0.8].map((f) => total * f);
    const phases = [
      [near, false],
      [near, true],
      [far, false],
      [far, true],
    ] as const;
    search: for (const [ds, beside] of phases) {
      for (const d of ds) {
        if (d <= 4 || d >= total - 4) continue;
        const at = pointAt(res.points, d);
        const offsets: Point[] = !beside
          ? [{ x: 0, y: 0 }]
          : segmentAt(res.points, d)
            ? [{ x: 0, y: -(h / 2 + 3) }, { x: 0, y: h / 2 + 3 }]
            : [{ x: w / 2 + 3, y: 0 }, { x: -(w / 2 + 3), y: 0 }];
        for (const off of offsets) {
          const bad = badness({ x: at.x + off.x, y: at.y + off.y }, beside);
          if (bad < chosen.bad) chosen = { d, off, bad };
          if (bad === 0) break search;
        }
      }
    }
    const { d, off } = chosen;
    const at = pointAt(res.points, d);
    res.labelPos = { x: at.x + off.x, y: at.y + off.y };
    res.labelT = d / total;
    res.labelOffset = off;
    placed.push({ x: res.labelPos.x - w / 2, y: res.labelPos.y - h / 2, w, h });
  }

  return results;
}

type Box = { x: number; y: number; w: number; h: number };

/** Is the polyline horizontal at distance d along it? */
function segmentAt(points: Point[], d: number): boolean {
  let rest = d;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (rest <= len) return Math.abs(a.y - b.y) < EPS;
    rest -= len;
  }
  return true;
}

function boxesOverlap(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Sort key that orders connectors sharing a side so they leave without crossing.
 * Walk the route away from the port to its first turn: connectors turning
 * towards the low end (up / left) come first — earliest turn outermost — then
 * straight ones, then those turning to the high end (latest turn outermost).
 */
function departureKey(side: Side, pts: Point[]): number {
  const along = side < 2 ? "y" : "x"; // coordinate that varies along the side
  const across = side < 2 ? "x" : "y";
  const base = pts[0];
  for (let k = 1; k < pts.length; k++) {
    const d = pts[k][along] - base[along];
    if (Math.abs(d) > 0.5) {
      const turnAt = Math.abs(pts[k - 1][across] - base[across]);
      return d < 0 ? -1e6 + turnAt : 1e6 - turnAt;
    }
  }
  return 0;
}

/**
 * Port positions (0–1 along the side) for k connectors sharing one side, in the
 * given order. `centred` (or -1) is the connector that should stay on the side's
 * centre — a straight run stays straight — with the rest spaced around it.
 */
function spread(n: LayoutNode, side: Side, k: number, cfg: RoutingConfig, centred: number): number[] {
  if (k === 1 || n.kind === "decision") return Array(k).fill(0.5); // a rhombus connects at its corners
  const len = side < 2 ? n.h : n.w;
  let lo = Math.min(12, len / 4);
  let hi = len - lo;
  if (n.kind === "startend") {
    // Stadium: stay near the apex of a round end, or on the straight top/bottom.
    if (side < 2) {
      lo = n.h / 2 - 10;
      hi = n.h / 2 + 10;
    } else {
      lo = n.h / 2;
      hi = n.w - n.h / 2;
    }
  }
  const step = Math.min(cfg.portSpacing, Math.max(0, hi - lo) / (k - 1));
  const mid = len / 2;
  let pos = Array.from({ length: k }, (_, i) => (lo + hi) / 2 + (i - (k - 1) / 2) * step);
  if (centred >= 0) {
    const shift = mid - pos[centred];
    pos = pos.map((p) => p + shift);
  }
  // Keep the whole group on the side.
  if (pos[0] < lo) pos = pos.map((p) => p + (lo - pos[0]));
  if (pos[k - 1] > hi) pos = pos.map((p) => p - (pos[k - 1] - hi));
  return pos.map((p) => Math.round(p) / len);
}
