import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout } from "@/lib/engine/layout";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";
import type { LayoutNode } from "@/lib/engine/types";

/**
 * Programmatic render checks — the non-visual verification the skill falls back
 * to when a pixel render isn't available: same-row neighbour gaps, edges that
 * actually touch their endpoints' perimeters, and orthogonal routing.
 */
const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8")) as ProcessModel;
const NAMES = ["linear-onboarding", "approval-flow", "cap-stress"];

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

const EPS = 0.6;
const onPerimeter = (p: { x: number; y: number }, n: LayoutNode) => {
  const onV =
    (Math.abs(p.x - n.x) <= EPS || Math.abs(p.x - (n.x + n.w)) <= EPS) &&
    p.y >= n.y - EPS &&
    p.y <= n.y + n.h + EPS;
  const onH =
    (Math.abs(p.y - n.y) <= EPS || Math.abs(p.y - (n.y + n.h)) <= EPS) &&
    p.x >= n.x - EPS &&
    p.x <= n.x + n.w + EPS;
  return onV || onH;
};

describe("render checks", () => {
  it.each(NAMES)("%s: same-lane, same-row neighbours keep a ≥20px gap", (name) => {
    const g = layout(load(name), skill);
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        const a = g.nodes[i];
        const b = g.nodes[j];
        if (a.laneIndex !== b.laneIndex || a.row !== b.row) continue;
        const gap =
          a.x < b.x ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
        expect(gap, `${a.id}/${b.id}`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it.each(NAMES)("%s: edge endpoints sit on the node perimeters", (name) => {
    const g = layout(load(name), skill);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) {
      const s = byId.get(e.from)!;
      const t = byId.get(e.to)!;
      expect(onPerimeter(e.points[0], s), `${e.id} start`).toBe(true);
      expect(onPerimeter(e.points[e.points.length - 1], t), `${e.id} end`).toBe(true);
    }
  });

  it.each(NAMES)("%s: every edge segment is orthogonal", (name) => {
    const g = layout(load(name), skill);
    for (const e of g.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const dx = Math.abs(e.points[i].x - e.points[i - 1].x);
        const dy = Math.abs(e.points[i].y - e.points[i - 1].y);
        expect(dx < EPS || dy < EPS, `${e.id} seg ${i}`).toBe(true);
      }
    }
  });
});
