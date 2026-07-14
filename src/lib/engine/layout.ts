import type { ClientSkill, NodeKind } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import { truncateLabel } from "./text";
import type {
  LayoutNode,
  LayoutEdge,
  LayoutLane,
  Point,
  PositionedGraph,
  EdgeKind,
} from "./types";

/**
 * layout(model, skill) — the pure geometry engine (PRD §8). Turns a validated
 * ProcessModel into a fully positioned graph that BOTH renderers (SVG preview +
 * .drawio) consume, so they cannot diverge. Every number comes from
 * skill.modeling — nothing is hardcoded.
 *
 * Algorithm:
 *  1. Derive the flow: a start node feeds the entry task; edges come from
 *     task.next, decision.from/yes/no, and endEvent.from.
 *  2. DFS from the start (main path first) assigns a flow sequence.
 *  3. Snake the sequence into a grid: band = ⌊seq/gridColumns⌋, columns run
 *     left→right on even bands and right→left on odd bands.
 *  4. Stack the lanes that are actually used; within each lane, the bands it
 *     occupies are compacted to consecutive rows (keeps the page short).
 *  5. Route orthogonal edges; classify back-edges as loop-backs.
 *  6. Measure against one printable page and emit fit warnings (never fatal).
 */

type NodeInfo = {
  id: string;
  kind: NodeKind;
  label: string;
  lane: string;
  system: string | null;
  document: string | null;
};

const RIGHT_MARGIN = 40;
const CHANNEL_GAP = 22; // vertical clearance for loop-back / wrap routing

export function layout(model: ProcessModel, skill: ClientSkill): PositionedGraph {
  const g = skill.modeling.geometry;
  const layoutCfg = skill.modeling.layout;
  const labels = skill.modeling.labels;
  const preferredOrientation = layoutCfg.pageOrientation;
  const gridColumns = Math.max(1, layoutCfg.gridColumns);

  const laneNames = model.lanes;
  const laneIndexByName = new Map(laneNames.map((n, i) => [n, i]));
  const resolveLane = (name: string): number =>
    laneIndexByName.has(name) ? laneIndexByName.get(name)! : 0;

  // ---- collect nodes (v1 emits startend + task + decision) -----------------
  const nodes = new Map<string, NodeInfo>();
  const START_ID = "__start__";

  const targeted = new Set<string>();
  for (const t of model.tasks) if (t.next) targeted.add(t.next);
  for (const d of model.decisions) {
    targeted.add(d.yes);
    targeted.add(d.no);
  }
  const entry =
    model.tasks.find((t) => !targeted.has(t.id)) ?? model.tasks[0];
  const entryLane = entry ? entry.lane : laneNames[0];

  nodes.set(START_ID, {
    id: START_ID,
    kind: "startend",
    label: truncateLabel(model.startEvent || "Start", labels.maxLabelChars),
    lane: entryLane,
    system: null,
    document: null,
  });
  for (const t of model.tasks) {
    nodes.set(t.id, {
      id: t.id,
      kind: "task",
      label: truncateLabel(t.name, labels.maxLabelChars),
      lane: t.lane,
      system: t.system,
      document: t.document,
    });
  }
  for (const d of model.decisions) {
    nodes.set(d.id, {
      id: d.id,
      kind: "decision",
      label: truncateLabel(d.name, labels.maxDecisionChars),
      lane: d.lane,
      system: null,
      document: null,
    });
  }
  for (const e of model.endEvents) {
    nodes.set(e.id, {
      id: e.id,
      kind: "startend",
      label: truncateLabel(e.name, labels.maxLabelChars),
      lane: e.lane,
      system: null,
      document: null,
    });
  }

  // ---- adjacency (ordered successors) --------------------------------------
  const succ = new Map<string, { to: string; label: string }[]>();
  const push = (from: string, to: string, label = "") => {
    if (!nodes.has(to)) return; // drop dangling refs defensively (repair fixes upstream)
    const list = succ.get(from) ?? [];
    list.push({ to, label });
    succ.set(from, list);
  };
  if (entry) push(START_ID, entry.id);
  for (const t of model.tasks) {
    if (t.next) push(t.id, t.next);
    for (const d of model.decisions) if (d.from === t.id) push(t.id, d.id);
    for (const e of model.endEvents) if (e.from === t.id) push(t.id, e.id);
  }
  for (const d of model.decisions) {
    push(d.id, d.yes, "Yes");
    push(d.id, d.no, "No");
    for (const e of model.endEvents) if (e.from === d.id) push(d.id, e.id);
  }

  // ---- DFS flow sequence (main path first) ---------------------------------
  const seqOf = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (seqOf.has(id)) return;
    seqOf.set(id, order.length);
    order.push(id);
    for (const { to } of succ.get(id) ?? []) visit(to);
  };
  visit(START_ID);
  // Any node unreached by traversal (shouldn't happen post-repair) is appended.
  for (const id of nodes.keys()) if (!seqOf.has(id)) visit(id);

  // ---- snake grid placement ------------------------------------------------
  const cellOf = new Map<string, { band: number; col: number }>();
  for (const id of order) {
    const i = seqOf.get(id)!;
    const band = Math.floor(i / gridColumns);
    const inBand = i % gridColumns;
    const col = band % 2 === 0 ? inBand : gridColumns - 1 - inBand;
    cellOf.set(id, { band, col });
  }

  // ---- used lanes + per-lane band compaction -------------------------------
  const laneBands = new Map<number, Set<number>>();
  for (const info of nodes.values()) {
    const li = resolveLane(info.lane);
    const band = cellOf.get(info.id)!.band;
    if (!laneBands.has(li)) laneBands.set(li, new Set());
    laneBands.get(li)!.add(band);
  }
  const usedLaneIndices = laneNames
    .map((_, i) => i)
    .filter((i) => laneBands.has(i));
  const laneRowMap = new Map<number, Map<number, number>>(); // laneIdx -> (band -> row)
  for (const li of usedLaneIndices) {
    const bands = [...laneBands.get(li)!].sort((a, b) => a - b);
    const m = new Map<number, number>();
    bands.forEach((b, r) => m.set(b, r));
    laneRowMap.set(li, m);
  }

  // Max column across all nodes drives lane width.
  let maxCol = 0;
  for (const c of cellOf.values()) maxCol = Math.max(maxCol, c.col);
  const laneW = g.colOffset + maxCol * g.colWidth + g.taskWidth + RIGHT_MARGIN;

  // ---- vertical stack: banner, lanes ---------------------------------------
  let top = 0;
  let banner: PositionedGraph["banner"] = null;
  if (layoutCfg.showTitle) {
    banner = {
      title: model.processName,
      subtitle: model.orgUnit,
      x: g.leftMargin,
      y: 0,
      w: laneW,
      h: g.bannerHeight,
    };
    top = g.bannerHeight + g.bannerGap;
  }

  const newLaneIndex = new Map<number, number>(); // model lane idx -> render idx
  usedLaneIndices.forEach((li, i) => newLaneIndex.set(li, i));

  const lanes: LayoutLane[] = [];
  let cursorY = top;
  for (const li of usedLaneIndices) {
    const rows = laneRowMap.get(li)!.size;
    const h = g.laneHeightBase + rows * g.rowHeight;
    lanes.push({
      name: laneNames[li],
      index: newLaneIndex.get(li)!,
      x: g.leftMargin,
      y: cursorY,
      w: laneW,
      h,
      rows,
    });
    cursorY += h;
  }
  const lanesBottom = cursorY;

  // ---- node geometry -------------------------------------------------------
  const sizeOf = (kind: NodeKind): { w: number; h: number } => {
    switch (kind) {
      case "decision":
        return { w: g.decisionWidth, h: g.decisionHeight };
      case "startend":
        return { w: g.startEndWidth, h: g.startEndHeight };
      case "document":
        return { w: g.documentWidth, h: g.documentHeight };
      case "offpage":
        return { w: g.offpageWidth, h: g.offpageHeight };
      default:
        return { w: g.taskWidth, h: g.taskHeight };
    }
  };

  const layoutNodes: LayoutNode[] = [];
  const nodeById = new Map<string, LayoutNode>();
  for (const info of nodes.values()) {
    const modelLane = resolveLane(info.lane);
    const renderLane = newLaneIndex.get(modelLane)!;
    const lane = lanes[renderLane];
    const { band, col } = cellOf.get(info.id)!;
    const row = laneRowMap.get(modelLane)!.get(band)!;
    const { w, h } = sizeOf(info.kind);
    // Centre each node within the reference column cell (taskWidth x taskHeight).
    const laneX = g.colOffset + col * g.colWidth + (g.taskWidth - w) / 2;
    const laneY = g.rowTopPad + row * g.rowHeight + (g.taskHeight - h) / 2;
    const x = lane.x + laneX;
    const y = lane.y + laneY;
    const node: LayoutNode = {
      id: info.id,
      kind: info.kind,
      label: info.label,
      laneIndex: renderLane,
      col,
      row,
      seq: seqOf.get(info.id)!,
      w,
      h,
      laneX,
      laneY,
      x,
      y,
      cx: x + w / 2,
      cy: y + h / 2,
      system: info.system,
      document: info.document,
    };
    layoutNodes.push(node);
    nodeById.set(info.id, node);
  }
  layoutNodes.sort((a, b) => a.seq - b.seq);

  // ---- edges ---------------------------------------------------------------
  const edges: LayoutEdge[] = [];
  let edgeSeq = 0;
  const seen = new Set<string>();
  for (const [from, list] of succ) {
    for (const { to, label } of list) {
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = nodeById.get(from);
      const t = nodeById.get(to);
      if (!s || !t) continue;
      const kind: EdgeKind =
        (seqOf.get(to) ?? 0) < (seqOf.get(from) ?? 0) ? "loopback" : "forward";
      const points = routeEdge(s, t, kind);
      edges.push({
        id: `e${++edgeSeq}`,
        from,
        to,
        label,
        kind,
        points,
        labelPos: polylineMidpoint(points),
      });
    }
  }

  // ---- legend --------------------------------------------------------------
  const kindsPresent: NodeKind[] = [];
  for (const n of layoutNodes)
    if (!kindsPresent.includes(n.kind)) kindsPresent.push(n.kind);
  const legendOrder: NodeKind[] = ["task", "decision", "startend", "document", "offpage"];
  const legendKinds = legendOrder.filter((k) => kindsPresent.includes(k));

  const belowRowY = lanesBottom + 14;
  const belowRowH = 22;
  let legend: PositionedGraph["legend"] = null;
  if (layoutCfg.showLegend && legendKinds.length > 0) {
    legend = {
      title: skill.style.legendTitle,
      items: legendKinds.map((k) => ({ kind: k, label: skill.style.roleLabels[k] })),
      x: g.leftMargin,
      y: belowRowY,
      swatch: 20,
      gap: 8,
    };
  }
  // Footer shares the legend's baseline (right-aligned) so the common case fits
  // one page; it drops to its own row when there is no legend.
  const footer = {
    text: skill.style.branding.footer,
    x: g.leftMargin,
    y: belowRowY,
    w: laneW,
    h: belowRowH,
  };

  // ---- choose orientation, then fit check ---------------------------------
  // Placement is orientation-independent (gridColumns is fixed), so we measure
  // the content, then pick the page that best contains it: keep the preferred
  // orientation when it fits, else flip to the other if THAT fits (helps tall,
  // narrow diagrams), else keep the preferred and warn.
  const contentWidth = g.leftMargin + laneW;
  const contentHeight = belowRowY + belowRowH;
  const fitsIn = (o: "landscape" | "portrait") =>
    contentWidth <= g.pages[o].width && contentHeight <= g.pages[o].height;
  const alt = preferredOrientation === "landscape" ? "portrait" : "landscape";
  const orientation = fitsIn(preferredOrientation)
    ? preferredOrientation
    : fitsIn(alt)
      ? alt
      : preferredOrientation;
  const page = g.pages[orientation];
  const fitWarnings: string[] = [];
  if (contentWidth > page.width) {
    fitWarnings.push(
      `Width ${Math.round(contentWidth)}px exceeds one ${orientation} page ` +
        `(${page.width}px). The core flow was mapped; the full process needs ` +
        `sub-process decomposition.`,
    );
  }
  if (contentHeight > page.height) {
    fitWarnings.push(
      `Height ${Math.round(contentHeight)}px exceeds one ${orientation} page ` +
        `(${page.height}px). The core flow was mapped; the full process needs ` +
        `sub-process decomposition.`,
    );
  }

  return {
    processName: model.processName,
    orgUnit: model.orgUnit,
    notes: model.notes,
    skillVersion: skill.manifest.version,
    page: { orientation, width: page.width, height: page.height },
    banner,
    lanes,
    nodes: layoutNodes,
    edges,
    legend,
    footer,
    contentWidth,
    contentHeight,
    viewBox: {
      width: Math.max(contentWidth, page.width),
      height: Math.max(contentHeight, 0) + 8,
    },
    fitWarnings,
  };

  // ---- orthogonal router ---------------------------------------------------
  function routeEdge(s: LayoutNode, t: LayoutNode, kind: EdgeKind): Point[] {
    const sTop: Point = { x: s.cx, y: s.y };
    const sBot: Point = { x: s.cx, y: s.y + s.h };
    const sLeft: Point = { x: s.x, y: s.cy };
    const sRight: Point = { x: s.x + s.w, y: s.cy };
    const tTop: Point = { x: t.cx, y: t.y };
    const tBot: Point = { x: t.cx, y: t.y + t.h };
    const tLeft: Point = { x: t.x, y: t.cy };
    const tRight: Point = { x: t.x + t.w, y: t.cy };

    if (kind === "loopback") {
      // Route around the outside of the lanes, over the top or under the bottom.
      const overTop = t.laneIndex <= s.laneIndex;
      if (overTop) {
        const y = Math.min(s.y, t.y) - CHANNEL_GAP;
        return [sTop, { x: sTop.x, y }, { x: tTop.x, y }, tTop];
      }
      const y = Math.max(s.y + s.h, t.y + t.h) + CHANNEL_GAP;
      return [sBot, { x: sBot.x, y }, { x: tBot.x, y }, tBot];
    }

    // forward
    if (Math.abs(t.cy - s.cy) < 1) {
      // same row — connect horizontally from the facing side (handles reversed
      // snake bands where forward flow runs right-to-left)
      return t.cx > s.cx ? [sRight, tLeft] : [sLeft, tRight];
    }
    if (t.cx > s.cx + 1) {
      // to the right, different row — elbow
      const midX = (sRight.x + tLeft.x) / 2;
      return [sRight, { x: midX, y: s.cy }, { x: midX, y: t.cy }, tLeft];
    }
    if (Math.abs(t.cx - s.cx) <= 1) {
      // straight vertical (same column, different lane/row)
      return t.cy > s.cy ? [sBot, tTop] : [sTop, tBot];
    }
    // forward but to the left and a different row (snake wrap) — drop then across
    if (t.cy >= s.cy) {
      const midY = (sBot.y + tTop.y) / 2;
      return [sBot, { x: s.cx, y: midY }, { x: t.cx, y: midY }, tTop];
    }
    const midY = (sTop.y + tBot.y) / 2;
    return [sTop, { x: s.cx, y: midY }, { x: t.cx, y: midY }, tBot];
  }
}

function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segLens.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (half <= segLens[i]) {
      const ratio = segLens[i] === 0 ? 0 : half / segLens[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
        y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
      };
    }
    half -= segLens[i];
  }
  return points[points.length - 1];
}
