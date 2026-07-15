import type { ClientSkill, NodeKind, PaletteColors } from "@/lib/skill/schema";
import type { LayoutNode, PositionedGraph } from "./types";
import { esc, num, paletteFor } from "./style";
import { wrapText, truncateLabel } from "./text";

/**
 * renderSvg(graph, skill) — the on-screen preview. Draws the SAME absolute
 * geometry the .drawio file uses, so "the diagram matches the preview" holds by
 * construction (PRD §8). The SVG is inert (no scripts), so LLM-derived labels
 * can't execute; the extraction summary panel is its text alternative.
 */
export function renderSvg(
  graph: PositionedGraph,
  skill: ClientSkill,
  theme?: string,
): string {
  const { style, modeling } = skill;
  const t = modeling.type;
  const g = modeling.geometry;
  const pal = paletteFor(style, theme);
  const parts: string[] = [];

  const W = num(graph.viewBox.width);
  const H = num(graph.viewBox.height);
  const ariaLabel =
    `${graph.processName} swimlane process map — ${graph.nodes.filter((n) => n.kind === "task").length} ` +
    `tasks across ${graph.lanes.length} lanes`;

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
      `width="${W}" height="${H}" role="img" aria-label="${esc(ariaLabel)}" ` +
      `font-family="${esc(t.fontFamily)}">`,
  );
  parts.push(
    `<defs><marker id="pmg-arrow" markerWidth="10" markerHeight="10" refX="7.5" refY="3" ` +
      `orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,3 L0,6 z" fill="${pal.edge.stroke}"/></marker></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${pal.canvas.fill}"/>`);

  // ---- banner --------------------------------------------------------------
  if (graph.banner) {
    const b = graph.banner;
    parts.push(
      `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(
        b.h,
      )}" rx="4" fill="${pal.title.fill}" stroke="${pal.title.stroke}"/>`,
    );
    const label = b.subtitle ? `${b.title}  —  ${b.subtitle}` : b.title;
    parts.push(
      `<text x="${num(b.x + b.w / 2)}" y="${num(b.y + b.h / 2)}" text-anchor="middle" ` +
        `dominant-baseline="central" font-size="${num(t.titleFontPt)}" font-weight="700" ` +
        `fill="${pal.title.text}">${esc(label)}</text>`,
    );
  }

  // ---- lanes ---------------------------------------------------------------
  for (const lane of graph.lanes) {
    parts.push(
      `<rect x="${num(lane.x)}" y="${num(lane.y)}" width="${num(lane.w)}" height="${num(
        lane.h,
      )}" fill="${pal.laneBody.fill}" stroke="${pal.laneHeader.stroke}"/>`,
    );
    parts.push(
      `<rect x="${num(lane.x)}" y="${num(lane.y)}" width="${num(g.laneHeaderBand)}" height="${num(
        lane.h,
      )}" fill="${pal.laneHeader.fill}" stroke="${pal.laneHeader.stroke}"/>`,
    );
    const bandCx = lane.x + g.laneHeaderBand / 2;
    const laneCy = lane.y + lane.h / 2;
    const maxChars = Math.max(6, Math.floor(lane.h / (t.minFontPt * 0.62)));
    parts.push(
      `<text transform="rotate(-90 ${num(bandCx)} ${num(laneCy)})" x="${num(bandCx)}" y="${num(
        laneCy,
      )}" text-anchor="middle" dominant-baseline="central" font-size="${num(t.minFontPt)}" ` +
        `font-weight="700" fill="${pal.laneHeader.text}">${esc(
          truncateLabel(lane.name, maxChars),
        )}</text>`,
    );
  }

  // ---- edges (under nodes) -------------------------------------------------
  for (const e of graph.edges) {
    const pts = e.points.map((p) => `${num(p.x)},${num(p.y)}`).join(" ");
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${pal.edge.stroke}" stroke-width="1.5" ` +
        `marker-end="url(#pmg-arrow)"/>`,
    );
    if (e.label) {
      const lw = e.label.length * t.smallFontPt * 0.62 + 8;
      parts.push(
        `<rect x="${num(e.labelPos.x - lw / 2)}" y="${num(e.labelPos.y - t.smallFontPt * 0.75)}" ` +
          `width="${num(lw)}" height="${num(t.smallFontPt * 1.5)}" rx="3" fill="${pal.canvas.fill}" ` +
          `opacity="0.9"/>`,
        `<text x="${num(e.labelPos.x)}" y="${num(e.labelPos.y)}" text-anchor="middle" ` +
          `dominant-baseline="central" font-size="${num(t.smallFontPt)}" fill="${pal.edge.text}">${esc(
            e.label,
          )}</text>`,
      );
    }
  }

  // ---- nodes (on top) ------------------------------------------------------
  for (const n of graph.nodes) parts.push(renderNode(n, skill, pal));

  // ---- legend --------------------------------------------------------------
  if (graph.legend) {
    const lg = graph.legend;
    parts.push(
      `<text x="${num(lg.x)}" y="${num(lg.y + lg.swatch / 2)}" dominant-baseline="central" ` +
        `font-size="${num(t.smallFontPt)}" font-weight="700" fill="${pal.legend.text}">${esc(
          lg.title,
        )}</text>`,
    );
    let lx = lg.x + 60;
    for (const item of lg.items) {
      const c = pal[item.kind];
      parts.push(
        `<rect x="${num(lx)}" y="${num(lg.y)}" width="${num(lg.swatch)}" height="${num(
          lg.swatch,
        )}" rx="3" fill="${c.fill}" stroke="${c.stroke}"/>`,
        `<text x="${num(lx + lg.swatch + 4)}" y="${num(lg.y + lg.swatch / 2)}" ` +
          `dominant-baseline="central" font-size="${num(t.smallFontPt)}" fill="${pal.legend.text}">${esc(
            item.label,
          )}</text>`,
      );
      lx += lg.swatch + 4 + 150 + lg.gap;
    }
  }

  // ---- footer --------------------------------------------------------------
  parts.push(
    `<text x="${num(graph.footer.x + graph.footer.w)}" y="${num(
      graph.footer.y + graph.footer.h / 2,
    )}" text-anchor="end" dominant-baseline="central" font-size="${num(t.smallFontPt)}" ` +
      `fill="${pal.footer.text}">${esc(graph.footer.text)} · v${esc(skill.manifest.version)}</text>`,
  );

  parts.push("</svg>");
  return parts.join("");
}

function shapeFor(n: LayoutNode, kind: NodeKind, fill: string, stroke: string): string {
  const { x, y, w, h, cx, cy } = n;
  if (kind === "decision") {
    const pts = `${num(cx)},${num(y)} ${num(x + w)},${num(cy)} ${num(cx)},${num(y + h)} ${num(x)},${num(cy)}`;
    return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  if (kind === "startend") {
    return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(
      h / 2,
    )}" ry="${num(h / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }
  if (kind === "subprocess") {
    // Predefined-process look: a rectangle with two vertical bars.
    const bar = Math.min(10, w * 0.08);
    return (
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="4" ` +
      `fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
      `<line x1="${num(x + bar)}" y1="${num(y)}" x2="${num(x + bar)}" y2="${num(y + h)}" stroke="${stroke}"/>` +
      `<line x1="${num(x + w - bar)}" y1="${num(y)}" x2="${num(x + w - bar)}" y2="${num(y + h)}" stroke="${stroke}"/>`
    );
  }
  // task / document / offpage → rounded rect
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(
    h,
  )}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

function renderNode(n: LayoutNode, skill: ClientSkill, pal: PaletteColors): string {
  const { modeling } = skill;
  const t = modeling.type;
  const c = pal[n.kind];
  const out: string[] = [shapeFor(n, n.kind, c.fill, c.stroke)];

  const innerW = (n.kind === "decision" ? n.w * 0.62 : n.w - 16);
  const lines = wrapText(n.label, innerW, t.minFontPt, 4);
  const lineH = t.minFontPt * 1.2;
  const startY = n.cy - (lines.length * lineH) / 2 + t.minFontPt * 0.9;
  lines.forEach((line, i) => {
    out.push(
      `<text x="${num(n.cx)}" y="${num(startY + i * lineH)}" text-anchor="middle" ` +
        `font-size="${num(t.minFontPt)}" fill="${c.text}">${esc(line)}</text>`,
    );
  });
  return out.join("");
}
