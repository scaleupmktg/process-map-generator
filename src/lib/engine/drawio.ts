import type { ClientSkill } from "@/lib/skill/schema";
import type { LayoutNode, PositionedGraph, Page } from "./types";
import { esc, num, clamp01, drawioNodeStyle } from "./style";

/**
 * renderDrawio(graph, skill) — serialise the positioned graph to an
 * uncompressed <mxfile> that opens directly in app.diagrams.net (PRD §8).
 *
 * Structure rules (ported from the process-mapping-drawio skill):
 *  - each lane is a swimlane with container=1;collapsible=0
 *  - node cells are children of their lane, positioned in lane-relative coords
 *    that clear the 32px header band
 *  - edges live on the root and carry explicit exit/entry anchors + the SAME
 *    absolute waypoints the SVG preview draws, so the two cannot diverge
 *  - the skill version is stamped into the footer text and an <mxfile> attribute
 */
export function renderDrawio(
  input: PositionedGraph | PositionedGraph[],
  skill: ClientSkill,
  opts: { generatedAt?: string } = {},
): string {
  const pages = Array.isArray(input) ? input : [input];
  const generatedAt = opts.generatedAt ?? skill.manifest.updated;
  const diagrams = pages.map((p) => renderDiagram(p, skill)).join("");
  return (
    `<mxfile host="app.diagrams.net" modified="${esc(generatedAt)}" ` +
    `agent="GrowThriveScale Process Map Generator" type="device" ` +
    `data-skill-version="${esc(skill.manifest.version)}">${diagrams}</mxfile>`
  );
}

/** Serialise one positioned page to an <diagram> element. */
function renderDiagram(graph: PositionedGraph, skill: ClientSkill): string {
  const { style, modeling } = skill;
  const t = modeling.type;
  const g = modeling.geometry;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  const vertex = (
    id: string,
    value: string,
    styleStr: string,
    parent: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) =>
    `<mxCell id="${esc(id)}" value="${esc(value)}" style="${styleStr}" vertex="1" parent="${esc(
      parent,
    )}"><mxGeometry x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(
      h,
    )}" as="geometry"/></mxCell>`;

  // ---- title banner --------------------------------------------------------
  if (graph.banner) {
    const c = style.palette.title;
    const bStyle =
      `${style.titleStyle}fillColor=${c.fill};fontColor=${c.text};strokeColor=${c.stroke};` +
      `fontFamily=${t.fontFamily};fontSize=${t.titleFontPt};`;
    const value = graph.banner.subtitle
      ? `${graph.banner.title} — ${graph.banner.subtitle}`
      : graph.banner.title;
    cells.push(
      vertex(
        "banner",
        value,
        bStyle,
        "1",
        graph.banner.x,
        graph.banner.y,
        graph.banner.w,
        graph.banner.h,
      ),
    );
  }

  // ---- lanes (+ neutral body overlay) --------------------------------------
  const laneHdr = style.palette.laneHeader;
  const laneBody = style.palette.laneBody;
  const laneStyle =
    `${style.laneStyle}fillColor=${laneHdr.fill};fontColor=${laneHdr.text};` +
    `strokeColor=${laneHdr.stroke};fontFamily=${t.fontFamily};fontSize=${t.minFontPt};`;
  const bodyStyle = `${style.laneBodyStyle}fillColor=${laneBody.fill};`;
  graph.lanes.forEach((lane) => {
    const laneId = `lane-${lane.index}`;
    cells.push(
      vertex(laneId, lane.name, laneStyle, "1", lane.x, lane.y, lane.w, lane.h),
    );
    // Body overlay clears the left header band (startSize=32) so the header
    // colour reads while the body stays neutral.
    cells.push(
      vertex(
        `laneb-${lane.index}`,
        "",
        bodyStyle,
        laneId,
        g.laneHeaderBand,
        0,
        lane.w - g.laneHeaderBand,
        lane.h,
      ),
    );
  });

  // ---- nodes (children of their lane) --------------------------------------
  for (const n of graph.nodes) {
    cells.push(
      vertex(
        `n-${n.id}`,
        n.label,
        drawioNodeStyle(n.kind, skill),
        `lane-${n.laneIndex}`,
        n.laneX,
        n.laneY,
        n.w,
        n.h,
      ),
    );
  }

  // ---- edges ---------------------------------------------------------------
  const edge = style.palette.edge;
  for (const e of graph.edges) {
    const s = nodeById.get(e.from);
    const target = nodeById.get(e.to);
    if (!s || !target) continue;
    const first = e.points[0];
    const last = e.points[e.points.length - 1];
    const anchors = edgeAnchors(s, target, first, last);
    const interior = e.points.slice(1, -1);
    const eStyle =
      `${style.edgeStyle}${anchors}` +
      `fontFamily=${t.fontFamily};fontSize=${t.smallFontPt};` +
      `fontColor=${edge.text};strokeColor=${edge.stroke};`;
    const points = interior.length
      ? `<Array as="points">${interior
          .map((p) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}"/>`)
          .join("")}</Array>`
      : "";
    cells.push(
      `<mxCell id="edge-${esc(e.id)}" value="${esc(
        e.label,
      )}" style="${eStyle}" edge="1" parent="1" source="n-${esc(
        e.from,
      )}" target="n-${esc(
        e.to,
      )}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`,
    );
  }

  // ---- legend --------------------------------------------------------------
  if (graph.legend) {
    const lg = graph.legend;
    cells.push(
      vertex(
        "legend-title",
        lg.title,
        `text;html=1;align=left;verticalAlign=middle;fontFamily=${t.fontFamily};fontSize=${t.smallFontPt};fontStyle=1;`,
        "1",
        lg.x,
        lg.y,
        54,
        lg.swatch,
      ),
    );
    let lx = lg.x + 60;
    lg.items.forEach((item, i) => {
      const c = style.palette[item.kind];
      cells.push(
        vertex(
          `legend-swatch-${i}`,
          "",
          `rounded=1;html=1;fillColor=${c.fill};strokeColor=${c.stroke};`,
          "1",
          lx,
          lg.y,
          lg.swatch,
          lg.swatch,
        ),
      );
      cells.push(
        vertex(
          `legend-label-${i}`,
          item.label,
          `text;html=1;align=left;verticalAlign=middle;fontFamily=${t.fontFamily};fontSize=${t.smallFontPt};`,
          "1",
          lx + lg.swatch + 4,
          lg.y - 1,
          150,
          lg.swatch + 2,
        ),
      );
      lx += lg.swatch + 4 + 150 + lg.gap;
    });
  }

  // ---- footer (branding + version) -----------------------------------------
  const footerColor = style.palette.footer;
  cells.push(
    vertex(
      "footer",
      `${graph.footer.text} · v${skill.manifest.version}`,
      `${style.footerStyle}fontFamily=${t.fontFamily};fontSize=${t.smallFontPt};fontColor=${footerColor.text};`,
      "1",
      graph.footer.x,
      graph.footer.y,
      graph.footer.w,
      graph.footer.h,
    ),
  );

  const model =
    `<mxGraphModel dx="1400" dy="800" grid="1" gridSize="${num(g.gridSnap)}" ` +
    `guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ` +
    `pageWidth="${num(graph.page.width)}" pageHeight="${num(
      graph.page.height,
    )}" math="0" shadow="0"><root>${cells.join("")}</root></mxGraphModel>`;

  const name = (graph as Partial<Page>).name ?? graph.processName;
  return `<diagram name="${esc(name)}">${model}</diagram>`;
}

/** Fixed exit/entry connection points derived from the router's endpoints. */
function edgeAnchors(
  s: LayoutNode,
  t: LayoutNode,
  first: { x: number; y: number },
  last: { x: number; y: number },
): string {
  const exitX = clamp01((first.x - s.x) / s.w);
  const exitY = clamp01((first.y - s.y) / s.h);
  const entryX = clamp01((last.x - t.x) / t.w);
  const entryY = clamp01((last.y - t.y) / t.h);
  return (
    `exitX=${num(exitX)};exitY=${num(exitY)};exitDx=0;exitDy=0;` +
    `entryX=${num(entryX)};entryY=${num(entryY)};entryDx=0;entryDy=0;`
  );
}
