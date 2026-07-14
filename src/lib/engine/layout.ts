import type { ClientSkill, NodeKind } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import { truncateLabel } from "./text";
import type {
  LayoutNode,
  LayoutEdge,
  LayoutLane,
  Point,
  PositionedGraph,
  Page,
  EdgeKind,
} from "./types";

/**
 * The geometry engine (PRD §8). `layout()` positions a whole model on one page;
 * `layoutPages()` splits a phased, overflowing model into an overview page plus
 * one page per phase. Both share `layoutGraph()`, the pure swimlane placer, so
 * every page is laid out by exactly the same snake/compaction/routing logic and
 * the SVG preview and .drawio export can never diverge. Every number comes from
 * skill.modeling — nothing is hardcoded.
 */

type NodeInfo = {
  id: string;
  kind: NodeKind;
  label: string;
  lane: string;
  system: string | null;
  document: string | null;
};

type Succ = Map<string, { to: string; label: string }[]>;

type LayoutGraphInput = {
  nodes: Map<string, NodeInfo>;
  succ: Succ;
  roots: string[]; // DFS seeds, in placement order
  laneNames: string[];
  bannerTitle: string;
  bannerSubtitle: string | null;
  processName: string;
  orgUnit: string | null;
  notes: string[];
  skill: ClientSkill;
};

const RIGHT_MARGIN = 40;
const CHANNEL_GAP = 22; // vertical clearance for loop-back / wrap routing
const START_ID = "__start__";

function addSucc(succ: Succ, from: string, to: string, label = ""): void {
  const list = succ.get(from) ?? [];
  list.push({ to, label });
  succ.set(from, list);
}

/** Build the node set + adjacency for a whole model (start + tasks + decisions + ends). */
function buildModelGraph(
  model: ProcessModel,
  skill: ClientSkill,
): { nodes: Map<string, NodeInfo>; succ: Succ; entryId: string } {
  const labels = skill.modeling.labels;
  const nodes = new Map<string, NodeInfo>();

  const targeted = new Set<string>();
  for (const t of model.tasks) if (t.next) targeted.add(t.next);
  for (const d of model.decisions) {
    targeted.add(d.yes);
    targeted.add(d.no);
  }
  const entry = model.tasks.find((t) => !targeted.has(t.id)) ?? model.tasks[0];
  const entryLane = entry ? entry.lane : model.lanes[0];

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

  const succ: Succ = new Map();
  const push = (from: string, to: string, label = "") => {
    if (!nodes.has(to)) return; // drop dangling refs defensively (repair fixes upstream)
    addSucc(succ, from, to, label);
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

  return { nodes, succ, entryId: START_ID };
}

/** Position an arbitrary node set + adjacency as one swimlane page. */
function layoutGraph(input: LayoutGraphInput): PositionedGraph {
  const { nodes, succ, roots, laneNames, skill } = input;
  const g = skill.modeling.geometry;
  const layoutCfg = skill.modeling.layout;
  const preferredOrientation = layoutCfg.pageOrientation;
  const gridColumns = Math.max(1, layoutCfg.gridColumns);

  const laneIndexByName = new Map(laneNames.map((n, i) => [n, i]));
  const resolveLane = (name: string): number =>
    laneIndexByName.has(name) ? laneIndexByName.get(name)! : 0;

  // ---- DFS flow sequence (from each root in order, then any stragglers) -----
  const seqOf = new Map<string, number>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (!nodes.has(id) || seqOf.has(id)) return;
    seqOf.set(id, order.length);
    order.push(id);
    for (const { to } of succ.get(id) ?? []) visit(to);
  };
  for (const r of roots) visit(r);
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
  const usedLaneIndices = laneNames.map((_, i) => i).filter((i) => laneBands.has(i));
  const laneRowMap = new Map<number, Map<number, number>>();
  for (const li of usedLaneIndices) {
    const bands = [...laneBands.get(li)!].sort((a, b) => a - b);
    const m = new Map<number, number>();
    bands.forEach((b, r) => m.set(b, r));
    laneRowMap.set(li, m);
  }

  let maxCol = 0;
  for (const c of cellOf.values()) maxCol = Math.max(maxCol, c.col);
  const laneW = g.colOffset + maxCol * g.colWidth + g.taskWidth + RIGHT_MARGIN;

  // ---- vertical stack: banner, lanes ---------------------------------------
  let top = 0;
  let banner: PositionedGraph["banner"] = null;
  if (layoutCfg.showTitle) {
    banner = {
      title: input.bannerTitle,
      subtitle: input.bannerSubtitle,
      x: g.leftMargin,
      y: 0,
      w: laneW,
      h: g.bannerHeight,
    };
    top = g.bannerHeight + g.bannerGap;
  }

  const newLaneIndex = new Map<number, number>();
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
      default: // task, subprocess
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
  for (const n of layoutNodes) if (!kindsPresent.includes(n.kind)) kindsPresent.push(n.kind);
  const legendOrder: NodeKind[] = [
    "task",
    "decision",
    "startend",
    "document",
    "offpage",
    "subprocess",
  ];
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
  const footer = {
    text: skill.style.branding.footer,
    x: g.leftMargin,
    y: belowRowY,
    w: laneW,
    h: belowRowH,
  };

  // ---- choose orientation, then fit check ---------------------------------
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
    processName: input.processName,
    orgUnit: input.orgUnit,
    notes: input.notes,
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
      const overTop = t.laneIndex <= s.laneIndex;
      if (overTop) {
        const y = Math.min(s.y, t.y) - CHANNEL_GAP;
        return [sTop, { x: sTop.x, y }, { x: tTop.x, y }, tTop];
      }
      const y = Math.max(s.y + s.h, t.y + t.h) + CHANNEL_GAP;
      return [sBot, { x: sBot.x, y }, { x: tBot.x, y }, tBot];
    }

    if (Math.abs(t.cy - s.cy) < 1) {
      return t.cx > s.cx ? [sRight, tLeft] : [sLeft, tRight];
    }
    if (t.cx > s.cx + 1) {
      const midX = (sRight.x + tLeft.x) / 2;
      return [sRight, { x: midX, y: s.cy }, { x: midX, y: t.cy }, tLeft];
    }
    if (Math.abs(t.cx - s.cx) <= 1) {
      return t.cy > s.cy ? [sBot, tTop] : [sTop, tBot];
    }
    if (t.cy >= s.cy) {
      const midY = (sBot.y + tTop.y) / 2;
      return [sBot, { x: s.cx, y: midY }, { x: t.cx, y: midY }, tTop];
    }
    const midY = (sTop.y + tBot.y) / 2;
    return [sTop, { x: s.cx, y: midY }, { x: t.cx, y: midY }, tBot];
  }
}

/** Position a whole model on a single page (unchanged behaviour). */
export function layout(model: ProcessModel, skill: ClientSkill): PositionedGraph {
  const { nodes, succ, entryId } = buildModelGraph(model, skill);
  return layoutGraph({
    nodes,
    succ,
    roots: [entryId],
    laneNames: model.lanes,
    bannerTitle: model.processName,
    bannerSubtitle: model.orgUnit,
    processName: model.processName,
    orgUnit: model.orgUnit,
    notes: model.notes,
    skill,
  });
}

/**
 * Position a model as one or more pages. A model with fewer than two phases, or
 * one that already fits a single page, is returned as a single page (identical
 * to `layout()`). Otherwise it becomes an Overview page (phases in sequence) plus
 * one page per phase; edges that cross a page boundary become paired off-page
 * connectors ("To <phase>" on the source page, "From <phase>" on the target).
 */
export function layoutPages(model: ProcessModel, skill: ClientSkill): Page[] {
  const single = layout(model, skill);
  const phases = model.phases ?? [];
  const decompose = skill.modeling.layout.decomposePages;
  if (!decompose || phases.length < 2 || single.fitWarnings.length === 0) {
    return [{ ...single, name: model.processName, kind: "single", pageId: "main" }];
  }

  const labels = skill.modeling.labels;
  const pageCfg = skill.style.pages;
  const { nodes, succ, entryId } = buildModelGraph(model, skill);

  // Global flow order — used to place a page's roots in the right sequence.
  const globalSeq = new Map<string, number>();
  {
    let n = 0;
    const visit = (id: string) => {
      if (!nodes.has(id) || globalSeq.has(id)) return;
      globalSeq.set(id, n++);
      for (const { to } of succ.get(id) ?? []) visit(to);
    };
    visit(entryId);
    for (const id of nodes.keys()) if (!globalSeq.has(id)) visit(id);
  }

  // Which page (phase) each node belongs to.
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const taskPhase = new Map<string, string>();
  for (const p of phases) for (const id of p.taskIds) taskPhase.set(id, p.id);
  const phaseCache = new Map<string, string>();
  const phaseOf = (id: string, seen: Set<string> = new Set()): string => {
    const cached = phaseCache.get(id);
    if (cached) return cached;
    if (seen.has(id)) return phases[0].id;
    seen.add(id);
    let res: string;
    if (taskPhase.has(id)) res = taskPhase.get(id)!;
    else if (id === START_ID) res = phases[0].id;
    else {
      const d = model.decisions.find((x) => x.id === id);
      const e = model.endEvents.find((x) => x.id === id);
      res = d ? phaseOf(d.from, seen) : e ? phaseOf(e.from, seen) : phases[0].id;
    }
    phaseCache.set(id, res);
    return res;
  };
  const phaseName = (nodeId: string) => phases[phaseIndex.get(phaseOf(nodeId))!].name;

  const pages: Page[] = [];

  // ---- overview page -------------------------------------------------------
  {
    const ovLane = pageCfg.overviewLane;
    const onodes = new Map<string, NodeInfo>();
    const osucc: Succ = new Map();
    const mk = (id: string, kind: NodeKind, label: string) =>
      onodes.set(id, {
        id,
        kind,
        label: truncateLabel(label, labels.maxLabelChars),
        lane: ovLane,
        system: null,
        document: null,
      });
    mk("__ov_start__", "startend", model.startEvent || "Start");
    let prev = "__ov_start__";
    for (const p of phases) {
      const id = `__ovp_${p.id}`;
      mk(id, "subprocess", p.name);
      addSucc(osucc, prev, id);
      prev = id;
    }
    mk("__ov_end__", "startend", "End");
    addSucc(osucc, prev, "__ov_end__");
    const overview = layoutGraph({
      nodes: onodes,
      succ: osucc,
      roots: ["__ov_start__"],
      laneNames: [ovLane],
      bannerTitle: model.processName,
      bannerSubtitle: pageCfg.overviewName,
      processName: model.processName,
      orgUnit: model.orgUnit,
      notes: model.notes,
      skill,
    });
    pages.push({ ...overview, name: pageCfg.overviewName, kind: "overview", pageId: "overview" });
  }

  // ---- one page per phase --------------------------------------------------
  for (const phase of phases) {
    const pid = phase.id;
    const onPage = (id: string) => phaseOf(id) === pid;
    const pnodes = new Map<string, NodeInfo>();
    for (const [id, info] of nodes) if (onPage(id)) pnodes.set(id, info);

    const psucc: Succ = new Map();
    let ci = 0;
    for (const [u, list] of succ) {
      for (const { to: v, label } of list) {
        const uOn = onPage(u);
        const vOn = onPage(v);
        if (uOn && vOn) {
          addSucc(psucc, u, v, label);
        } else if (uOn) {
          const oc = `__oc_${pid}_${ci++}`;
          pnodes.set(oc, {
            id: oc,
            kind: "offpage",
            label: truncateLabel(`${pageCfg.toPrefix} ${phaseName(v)}`, labels.maxLabelChars),
            lane: nodes.get(u)!.lane,
            system: null,
            document: null,
          });
          addSucc(psucc, u, oc, label);
        } else if (vOn) {
          const ic = `__ic_${pid}_${ci++}`;
          pnodes.set(ic, {
            id: ic,
            kind: "offpage",
            label: truncateLabel(`${pageCfg.fromPrefix} ${phaseName(u)}`, labels.maxLabelChars),
            lane: nodes.get(v)!.lane,
            system: null,
            document: null,
          });
          addSucc(psucc, ic, v, label);
        }
      }
    }

    // Roots = page-local sources, ordered by global flow position.
    const indeg = new Map<string, number>();
    for (const id of pnodes.keys()) indeg.set(id, 0);
    for (const [, list] of psucc) for (const { to } of list) indeg.set(to, (indeg.get(to) ?? 0) + 1);
    const rootKey = (id: string): number => {
      if (globalSeq.has(id)) return globalSeq.get(id)!;
      const first = psucc.get(id)?.[0]?.to;
      return first && globalSeq.has(first) ? globalSeq.get(first)! - 0.5 : -1;
    };
    let roots = [...pnodes.keys()]
      .filter((id) => (indeg.get(id) ?? 0) === 0)
      .sort((a, b) => rootKey(a) - rootKey(b));
    if (roots.length === 0) roots = [...pnodes.keys()].slice(0, 1);

    const page = layoutGraph({
      nodes: pnodes,
      succ: psucc,
      roots,
      laneNames: model.lanes,
      bannerTitle: phase.name,
      bannerSubtitle: model.processName,
      processName: model.processName,
      orgUnit: model.orgUnit,
      notes: [],
      skill,
    });
    pages.push({ ...page, name: phase.name, kind: "phase", pageId: pid });
  }

  return pages;
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
