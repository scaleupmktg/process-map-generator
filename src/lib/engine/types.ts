import type { NodeKind } from "@/lib/skill/schema";

export type Point = { x: number; y: number };

export type LayoutNode = {
  id: string;
  kind: NodeKind;
  label: string;
  laneIndex: number; // index into PositionedGraph.lanes
  col: number;
  row: number; // compacted row within the lane
  seq: number; // flow order (for edge classification / debugging)
  w: number;
  h: number;
  laneX: number; // relative to lane container (for drawio child geometry)
  laneY: number;
  x: number; // absolute (for SVG + edge waypoints)
  y: number;
  cx: number; // absolute centre
  cy: number;
  /** Reference data, surfaced in the register but not drawn on the node. */
  system: string | null;
  document: string | null;
};

export type EdgeKind = "forward" | "loopback";

export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: EdgeKind;
  points: Point[]; // absolute orthogonal polyline, shared by SVG + drawio
  labelPos: Point; // label centre (absolute) = point at labelT along the polyline + labelOffset
  /** Label position as a fraction (0–1) of the polyline's length, plus an absolute
   *  offset — drawio places edge labels this way, so file and preview match. */
  labelT: number;
  labelOffset: Point;
};

export type LayoutLane = {
  name: string;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rows: number;
};

export type BannerBox = {
  title: string;
  subtitle: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LegendItem = { kind: NodeKind; label: string };

export type Legend = {
  title: string;
  items: LegendItem[];
  x: number;
  y: number;
  swatch: number;
  gap: number;
};

export type FooterBox = { text: string; x: number; y: number; w: number; h: number };

export type PositionedGraph = {
  processName: string;
  orgUnit: string | null;
  notes: string[];
  skillVersion: string;
  page: { orientation: "landscape" | "portrait"; width: number; height: number };
  banner: BannerBox | null;
  lanes: LayoutLane[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  legend: Legend | null;
  footer: FooterBox;
  contentWidth: number;
  contentHeight: number;
  viewBox: { width: number; height: number };
  fitWarnings: string[];
};

/** A positioned graph plus its identity within a (possibly multi-page) map. */
export type Page = PositionedGraph & {
  name: string;
  kind: "single" | "overview" | "phase";
  pageId: string;
};
