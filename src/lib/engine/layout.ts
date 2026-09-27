import type { ClientSkill, NodeKind } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import { truncateLabel } from "./text";
import { routeEdges, type EdgeSpec } from "./router";
import type {
  LayoutNode,
  LayoutEdge,
  LayoutLane,
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
  /** false = place nodes only (fit probe); connectors are left unrouted. */
  route?: boolean;
};

const RIGHT_MARGIN = 40;
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
  const specs: EdgeSpec[] = [];
  const seen = new Set<string>();
  for (const [from, list] of succ) {
    for (const { to, label } of list) {
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!nodeById.has(from) || !nodeById.has(to)) continue;
      const kind: EdgeKind =
        (seqOf.get(to) ?? 0) < (seqOf.get(from) ?? 0) ? "loopback" : "forward";
      specs.push({ id: `e${specs.length + 1}`, from, to, label, kind });
    }
  }
  // Connectors are routed around every shape, inside the lane bodies (clear of
  // the lane header band) — see router.ts.
  const routed =
    input.route === false
      ? null
      : routeEdges(
          layoutNodes,
          specs,
          {
            x0: g.leftMargin + g.laneHeaderBand + 2,
            y0: top + 2,
            x1: g.leftMargin + laneW - 2,
            y1: lanesBottom - 2,
          },
          skill.modeling.routing,
          skill.modeling.type.smallFontPt,
          lanes.slice(1).map((l) => l.y),
        );
  const edges: LayoutEdge[] = specs.map((spec, i) => ({
    ...spec,
    points: routed ? routed[i].points : [],
    labelPos: routed ? routed[i].labelPos : { x: 0, y: 0 },
    labelT: routed ? routed[i].labelT : 0.5,
    labelOffset: routed ? routed[i].labelOffset : { x: 0, y: 0 },
  }));

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
}

/** Position a whole model on a single page (unchanged behaviour). */
export function layout(model: ProcessModel, skill: ClientSkill): PositionedGraph {
  return layoutSingle(model, skill, true);
}

function layoutSingle(model: ProcessModel, skill: ClientSkill, route: boolean): PositionedGraph {
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
    route,
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
  // Fit depends on node placement only, so probe without routing connectors.
  const probe = layoutSingle(model, skill, false);
  const phases = model.phases ?? [];
  const decompose = skill.modeling.layout.decomposePages;
  if (!decompose || phases.length < 2 || probe.fitWarnings.length === 0) {
    const single = layout(model, skill);
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
