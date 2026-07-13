/**
 * Structural validation of generated .drawio XML (ported from the skill's
 * validate_structure). Beyond well-formedness it checks, per diagram:
 *  - cell ids are unique
 *  - every non-root cell has a parent that resolves
 *  - every vertex carries geometry
 *  - every edge's source and target resolve
 *
 * A broken graph produces a broken diagram, which destroys the lead magnet, so
 * this runs on every generated file before it is offered for download.
 */

function attrOf(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

export function validateDrawio(xml: string): void {
  if (!xml.startsWith("<mxfile")) {
    throw new Error("drawio: root is not <mxfile>");
  }
  const diagrams = [...xml.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)];
  if (diagrams.length === 0) throw new Error("drawio: no <diagram> found");

  for (const d of diagrams) {
    const body = d[1];
    if (!/<mxGraphModel\b/.test(body)) throw new Error("drawio: missing <mxGraphModel>");

    const cells = [...body.matchAll(/<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)];
    if (cells.length === 0) throw new Error("drawio: no <mxCell> in diagram");

    const idSet = new Set<string>();
    const records = cells.map((c) => {
      const attrs = c[1];
      const inner = c[2].startsWith(">") ? c[3] ?? "" : "";
      const id = attrOf(attrs, "id");
      if (!id) throw new Error("drawio: cell missing id");
      if (idSet.has(id)) throw new Error(`drawio: duplicate cell id "${id}"`);
      idSet.add(id);
      return {
        id,
        parent: attrOf(attrs, "parent"),
        isVertex: attrOf(attrs, "vertex") === "1",
        isEdge: attrOf(attrs, "edge") === "1",
        source: attrOf(attrs, "source"),
        target: attrOf(attrs, "target"),
        hasGeometry: /<mxGeometry\b/.test(inner),
      };
    });

    for (const r of records) {
      if (r.id === "0") continue; // the implicit root has no parent
      if (!r.parent) throw new Error(`drawio: cell "${r.id}" has no parent`);
      if (!idSet.has(r.parent)) {
        throw new Error(`drawio: cell "${r.id}" parent "${r.parent}" unresolved`);
      }
      if (r.isVertex && !r.hasGeometry) {
        throw new Error(`drawio: vertex "${r.id}" missing geometry`);
      }
      if (r.isEdge) {
        if (r.source && !idSet.has(r.source)) {
          throw new Error(`drawio: edge "${r.id}" source "${r.source}" unresolved`);
        }
        if (r.target && !idSet.has(r.target)) {
          throw new Error(`drawio: edge "${r.id}" target "${r.target}" unresolved`);
        }
      }
    }
  }
}
