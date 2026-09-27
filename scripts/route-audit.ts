/**
 * npm run route:audit — measure connector quality across the fixtures and a
 * seeded fuzz set: edges through shapes, edges on top of edges, crossings,
 * near-parallel runs, bends, and labels sitting on shapes or lines. The router's
 * regression yardstick. FUZZ=<n> sets the number of random models (default 300).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layoutPages } from "@/lib/engine/layout";
import { assessRoutes } from "@/lib/engine/routeQuality";
import type { ProcessModel } from "@/lib/model/schema";
import { randomModel } from "../tests/util/randomModel";

const FIXTURES = ["linear-onboarding", "approval-flow", "cap-stress", "xpr-phased"];
const FUZZ = Number(process.env.FUZZ ?? 300);

async function main() {
  const skill = await loadBundledSkill();
  // ROUTING='{"crossingPenalty":120}' overrides router tunables for a what-if run.
  if (process.env.ROUTING) Object.assign(skill.modeling.routing, JSON.parse(process.env.ROUTING));
  const fontPt = skill.modeling.type.smallFontPt;

  console.log(
    "fixture/page".padEnd(42),
    "edges  thruNode  onEdge  cross  nearPx  bends  lblOnNode  lblOnLine",
  );
  for (const name of FIXTURES) {
    const model = JSON.parse(
      readFileSync(path.join(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8"),
    ) as ProcessModel;
    for (const page of layoutPages(model, skill)) {
      const q = assessRoutes(page, { labelFontPt: fontPt });
      console.log(
        `${name}/${page.name}`.slice(0, 41).padEnd(42),
        String(page.edges.length).padStart(5),
        String(q.edgeNodeOverlaps.length).padStart(9),
        String(q.edgeEdgeOverlaps.length).padStart(7),
        String(q.crossings).padStart(6),
        String(q.nearParallelPx).padStart(7),
        String(q.bends).padStart(6),
        String(q.labelOverlaps.length).padStart(10),
        String(q.labelsOnLines).padStart(10),
      );
    }
  }

  const tot = { pages: 0, edges: 0, thru: 0, onEdge: 0, cross: 0, near: 0, bends: 0, label: 0, lblLine: 0, badPages: 0 };
  const t0 = performance.now();
  for (let seed = 1; seed <= FUZZ; seed++) {
    for (const page of layoutPages(randomModel(seed), skill)) {
      const q = assessRoutes(page, { labelFontPt: fontPt });
      tot.pages++;
      tot.edges += page.edges.length;
      tot.thru += q.edgeNodeOverlaps.length;
      tot.onEdge += q.edgeEdgeOverlaps.length;
      tot.cross += q.crossings;
      tot.near += q.nearParallelPx;
      tot.bends += q.bends;
      tot.label += q.labelOverlaps.length;
      tot.lblLine += q.labelsOnLines;
      if (q.edgeNodeOverlaps.length) tot.badPages++;
    }
  }
  const ms = performance.now() - t0;
  console.log(`\nfuzz: ${FUZZ} random models → ${tot.pages} pages, ${tot.edges} edges (${Math.round(ms / FUZZ)} ms/model)`);
  console.log(`  edge-through-node: ${tot.thru}  (pages affected: ${tot.badPages}/${tot.pages})`);
  console.log(`  edge-on-edge overlaps: ${tot.onEdge}   near-parallel px: ${tot.near}`);
  console.log(`  crossings: ${tot.cross}   bends: ${tot.bends}`);
  console.log(`  labels on nodes: ${tot.label}   labels on other lines: ${tot.lblLine}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
