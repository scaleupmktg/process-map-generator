import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layoutPages } from "@/lib/engine/layout";
import { assessRoutes, segmentHitsRect } from "@/lib/engine/routeQuality";
import { pathLength, pointAt } from "@/lib/engine/router";
import { edgePathData } from "@/lib/engine/edgePath";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import type { Page } from "@/lib/engine/types";
import { randomModel } from "./util/randomModel";

/**
 * Connector routing invariants (skill 1.4.0). The router's promise is that a
 * connector never crosses a shape; these tests hold it to that on every fixture
 * and on a seeded fuzz set, plus the properties the renderers rely on.
 */
const FIXTURES = ["linear-onboarding", "approval-flow", "cap-stress", "xpr-phased"];
// ROUTER_FUZZ=1000 npx vitest run tests/router.test.ts for a deeper local sweep.
const FUZZ_SEEDS = Array.from({ length: Number(process.env.ROUTER_FUZZ ?? 80) }, (_, i) => i + 1);

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

function fixture(name: string): ProcessModel {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8"),
  ) as ProcessModel;
}

/** Everything a routed page must satisfy; returns human-readable violations. */
function violations(page: Page, fontPt: number): string[] {
  const out: string[] = [];
  const q = assessRoutes(page, { labelFontPt: fontPt });
  for (const o of q.edgeNodeOverlaps) out.push(`${o.edge} passes through ${o.node}`);
  for (const o of q.edgeEdgeOverlaps) out.push(`${o.a} runs on top of ${o.b} for ${o.length}px`);
  for (const o of q.labelOverlaps) out.push(`label of ${o.edge} sits on ${o.node}`);

  const byId = new Map(page.nodes.map((n) => [n.id, n]));
  const laneBorders = page.lanes.slice(1).map((l) => l.y);
  const ports = new Map<string, string>(); // node|x|y → edge
  for (const e of page.edges) {
    if (e.points.length < 2) out.push(`${e.id} has no route`);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1];
      const b = e.points[i];
      if (a.x !== b.x && a.y !== b.y) out.push(`${e.id} segment ${i} is diagonal`);
      if (a.y === b.y) {
        const near = laneBorders.find((y) => Math.abs(y - a.y) < 9);
        if (near !== undefined) out.push(`${e.id} runs along the lane border at y=${near}`);
      }
    }
    // Distinct ports: two connectors never share an attachment point, except at
    // a decision's corners (a rhombus only connects at its four points).
    for (const [nodeId, p] of [
      [e.from, e.points[0]],
      [e.to, e.points[e.points.length - 1]],
    ] as const) {
      if (byId.get(nodeId)?.kind === "decision") continue;
      const key = `${nodeId}|${p.x}|${p.y}`;
      if (ports.has(key)) out.push(`${e.id} and ${ports.get(key)} share a port on ${nodeId}`);
      ports.set(key, e.id);
    }
    // The label is where draw.io will put it: labelT along the line + offset.
    if (e.label) {
      const at = pointAt(e.points, e.labelT * pathLength(e.points));
      const dx = Math.abs(at.x + e.labelOffset.x - e.labelPos.x);
      const dy = Math.abs(at.y + e.labelOffset.y - e.labelPos.y);
      if (dx > 0.01 || dy > 0.01) out.push(`${e.id} labelPos disagrees with labelT/labelOffset`);
    }
  }
  return out;
}

describe("connector routing", () => {
  for (const name of FIXTURES) {
    it(`${name}: no connector crosses a shape, overlaps another, or hides a label`, () => {
      for (const page of layoutPages(fixture(name), skill)) {
        expect(violations(page, skill.modeling.type.smallFontPt), page.name).toEqual([]);
      }
    });
  }

  it(`holds on ${FUZZ_SEEDS.length} seeded random processes`, () => {
    const bad: string[] = [];
    for (const seed of FUZZ_SEEDS) {
      for (const page of layoutPages(randomModel(seed), skill)) {
        for (const v of violations(page, skill.modeling.type.smallFontPt)) bad.push(`seed ${seed} / ${page.name}: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("is deterministic", () => {
    const model = fixture("cap-stress");
    const a = layoutPages(model, skill);
    const b = layoutPages(model, skill);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps a connector between two aligned, facing shapes dead straight", () => {
    const page = layoutPages(fixture("linear-onboarding"), skill)[0];
    const first = page.edges.find((e) => e.from === "__start__")!;
    expect(first.points).toHaveLength(2);
    expect(first.points[0].y).toBe(first.points[1].y);
  });

  it("puts decision branch labels next to the decision", () => {
    const page = layoutPages(fixture("approval-flow"), skill)[0];
    for (const e of page.edges.filter((x) => x.label)) {
      const d = e.labelT * pathLength(e.points);
      expect(d, `${e.id} label distance`).toBeLessThanOrEqual(skill.modeling.routing.clearance + 40);
    }
  });
});

describe("edgePathData (draw.io-style rendering)", () => {
  const opts = { jumpSize: 10, strokeWidth: 1.5 };
  const vertical = [
    { x: 50, y: 0 },
    { x: 50, y: 100 },
  ];
  const horizontal = [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];

  it("hops over an earlier edge it crosses", () => {
    const d = edgePathData(horizontal, [vertical], opts);
    expect(d).toMatch(/C/); // the arc
    expect(d.startsWith("M0,50")).toBe(true);
    expect(d.endsWith("L100,50")).toBe(true);
  });

  it("does not hop when nothing earlier crosses, or jumps are off", () => {
    expect(edgePathData(horizontal, [], opts)).not.toMatch(/C/);
    expect(edgePathData(horizontal, [vertical], { ...opts, jumpSize: 0 })).not.toMatch(/C/);
  });

  it("rounds corners with a quadratic curve through the corner", () => {
    const d = edgePathData(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      [],
      opts,
    );
    expect(d).toBe("M0,0L90,0Q100,0 100,10L100,100");
  });
});

describe("route quality checks", () => {
  it("detects a segment through a rectangle but not one along its edge", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 40, y: 20 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 40, y: 10 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 0, y: 5 }, { x: 40, y: 5 }, r)).toBe(false);
  });
});
