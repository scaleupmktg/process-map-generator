import { describe, it, expect, beforeAll } from "vitest";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout } from "@/lib/engine/layout";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import type { PositionedGraph } from "@/lib/engine/types";
import linear from "./fixtures/linear-onboarding.json";
import approval from "./fixtures/approval-flow.json";
import capStress from "./fixtures/cap-stress.json";

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function run(model: unknown): PositionedGraph {
  return layout(model as ProcessModel, skill);
}

describe("layout — invariants across fixtures", () => {
  const cases: Array<[string, unknown]> = [
    ["linear-onboarding", linear],
    ["approval-flow", approval],
    ["cap-stress", capStress],
  ];

  it.each(cases)("%s: every node sits inside its lane", (_name, model) => {
    const g = run(model);
    for (const n of g.nodes) {
      const lane = g.lanes[n.laneIndex];
      expect(lane).toBeDefined();
      expect(n.x).toBeGreaterThanOrEqual(lane.x);
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.x + n.w).toBeLessThanOrEqual(lane.x + lane.w + 0.01);
      expect(n.y + n.h).toBeLessThanOrEqual(lane.y + lane.h + 0.01);
    }
  });

  it.each(cases)("%s: no two nodes overlap", (_name, model) => {
    const g = run(model);
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        expect(
          rectsOverlap(g.nodes[i], g.nodes[j]),
          `${g.nodes[i].id} overlaps ${g.nodes[j].id}`,
        ).toBe(false);
      }
    }
  });

  it.each(cases)("%s: every edge connects two real nodes", (_name, model) => {
    const g = run(model);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
      expect(e.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(cases)("%s: lane height matches its compacted row count", (_name, model) => {
    const g = run(model);
    const geo = skill.modeling.geometry;
    for (const lane of g.lanes) {
      expect(lane.h).toBe(geo.laneHeightBase + lane.rows * geo.rowHeight);
    }
  });

  it.each(cases)("%s: deterministic (same input, same output)", (_name, model) => {
    expect(JSON.stringify(run(model))).toBe(JSON.stringify(run(model)));
  });
});

describe("layout — flow specifics", () => {
  it("adds a start node and preserves the model start label", () => {
    const g = run(linear);
    const start = g.nodes.find((n) => n.id === "__start__");
    expect(start).toBeDefined();
    expect(start!.kind).toBe("startend");
    expect(start!.label).toBe("Start");
    expect(start!.seq).toBe(0);
  });

  it("snakes: first band left-to-right, second band right-to-left", () => {
    const g = run(linear);
    const bySeq = [...g.nodes].sort((a, b) => a.seq - b.seq);
    // 8 nodes, gridColumns 5 → seq0..4 cols 0..4, seq5 col4, seq6 col3, seq7 col2
    expect(bySeq[0].col).toBe(0);
    expect(bySeq[4].col).toBe(4);
    expect(bySeq[5].col).toBe(4);
    expect(bySeq[6].col).toBe(3);
  });

  it("detects the revise→resubmit loop-back in approval-flow", () => {
    const g = run(approval);
    const loop = g.edges.find((e) => e.from === "T2" && e.to === "T1");
    expect(loop).toBeDefined();
    expect(loop!.kind).toBe("loopback");
  });

  it("labels decision branches Yes / No", () => {
    const g = run(approval);
    const yes = g.edges.find((e) => e.from === "D1" && e.label === "Yes");
    const no = g.edges.find((e) => e.from === "D1" && e.label === "No");
    expect(yes?.to).toBe("T3");
    expect(no?.to).toBe("T2");
  });

  it("drops empty lanes and keeps used-lane order", () => {
    const withEmpty = structuredClone(linear) as ProcessModel;
    withEmpty.lanes = ["HR Coordinator", "Ghost Lane", "IT Support"];
    const g = layout(withEmpty, skill);
    expect(g.lanes.map((l) => l.name)).toEqual(["HR Coordinator", "IT Support"]);
  });
});

describe("layout — one-page fit", () => {
  it("keeps the common fixtures within one landscape page", () => {
    for (const model of [linear, approval]) {
      const g = run(model);
      expect(g.contentWidth).toBeLessThanOrEqual(g.page.width);
      expect(g.contentHeight).toBeLessThanOrEqual(g.page.height);
      expect(g.fitWarnings).toEqual([]);
    }
  });

  it("warns (does not throw) when a big process overflows the page", () => {
    const g = run(capStress);
    expect(g.fitWarnings.length).toBeGreaterThan(0);
    // still a fully positioned, renderable graph
    expect(g.nodes.length).toBeGreaterThan(20);
  });
});
