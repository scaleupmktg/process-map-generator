import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { makeProcessModelSchema, type ProcessModel } from "@/lib/model/schema";
import { repairModel } from "@/lib/model/repair";
import { layout } from "@/lib/engine/layout";
import { renderDrawio } from "@/lib/engine/drawio";
import { validateDrawio } from "@/lib/engine/validateDrawio";
import type { SkillBundle } from "@/lib/skill/schema";

const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8")) as ProcessModel;

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

function allRefsResolve(model: ProcessModel): boolean {
  const ids = new Set<string>([
    ...model.tasks.map((t) => t.id),
    ...model.decisions.map((d) => d.id),
    ...model.endEvents.map((e) => e.id),
  ]);
  const ok = (r: string | null) => r === null || ids.has(r);
  return (
    model.tasks.every((t) => ok(t.next)) &&
    model.decisions.every((d) => ids.has(d.from) && ids.has(d.yes) && ids.has(d.no)) &&
    model.endEvents.every((e) => ids.has(e.from))
  );
}

describe("repairModel — the malformed fixture becomes renderable", () => {
  it("fixes bad lanes, dangling refs and the missing end event", () => {
    const repaired = repairModel(load("malformed"));

    // bad lane "Reviewer" was reassigned to a real lane
    expect(skill.modeling.caps).toBeDefined();
    for (const t of repaired.tasks) expect(repaired.lanes).toContain(t.lane);
    for (const d of repaired.decisions) expect(repaired.lanes).toContain(d.lane);

    // an end event now exists and everything resolves
    expect(repaired.endEvents.length).toBeGreaterThanOrEqual(1);
    expect(allRefsResolve(repaired)).toBe(true);

    // it renders to a structurally valid diagram
    const xml = renderDrawio(layout(repaired, skill), skill);
    expect(() => validateDrawio(xml)).not.toThrow();

    // and the repairs were disclosed in notes
    expect(repaired.notes.length).toBeGreaterThan(load("malformed").notes.length);
  });

  it("passes the caps-aware schema after repair", () => {
    const repaired = repairModel(load("malformed"));
    expect(makeProcessModelSchema(skill.modeling).safeParse(repaired).success).toBe(true);
  });
});

describe("repairModel — targeted cases", () => {
  it("synthesises an end event when there are none", () => {
    const model = load("linear-onboarding");
    model.endEvents = [];
    const repaired = repairModel(model);
    expect(repaired.endEvents.length).toBe(1);
    expect(repaired.endEvents[0].from).toBe("T6"); // fed by the last task
    expect(repaired.notes.some((n) => /end event/i.test(n))).toBe(true);
  });

  it("repoints a dangling next to the end and notes it", () => {
    const model = load("linear-onboarding");
    model.tasks[2].next = "GHOST";
    const repaired = repairModel(model);
    expect(allRefsResolve(repaired)).toBe(true);
    expect(repaired.notes.some((n) => /broken connection/i.test(n))).toBe(true);
  });

  it("leaves a healthy model's references intact", () => {
    const repaired = repairModel(load("approval-flow"));
    expect(allRefsResolve(repaired)).toBe(true);
    // no spurious repairs beyond the original note
    expect(repaired.notes.length).toBe(load("approval-flow").notes.length);
  });
});

describe("repairModel — phase normalisation", () => {
  const base = () => {
    const m = load("linear-onboarding");
    return m;
  };

  it("drops unknown/duplicate task ids and assigns untagged tasks", () => {
    const m = base();
    m.phases = [
      { id: "P1", name: "Setup", taskIds: ["T1", "T2", "GHOST"] },
      { id: "P2", name: "Provision", taskIds: ["T3", "T1"] }, // T1 dup, T5/T6 untagged
    ];
    const r = repairModel(m, { maxPhases: 8 });
    const claimed = r.phases.flatMap((p) => p.taskIds);
    expect(claimed).not.toContain("GHOST");
    expect(claimed.filter((id) => id === "T1")).toHaveLength(1); // dedup
    // every task landed in exactly one phase
    expect([...claimed].sort()).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
  });

  it("collapses a single phase to unphased (nothing to decompose)", () => {
    const m = base();
    m.phases = [{ id: "P1", name: "All", taskIds: ["T1", "T2", "T3"] }];
    expect(repairModel(m).phases).toEqual([]);
  });

  it("trims to maxPhases by merging overflow into the last kept phase", () => {
    const m = base();
    m.phases = [
      { id: "P1", name: "A", taskIds: ["T1"] },
      { id: "P2", name: "B", taskIds: ["T2"] },
      { id: "P3", name: "C", taskIds: ["T3"] },
      { id: "P4", name: "D", taskIds: ["T4", "T5", "T6"] },
    ];
    const r = repairModel(m, { maxPhases: 2 });
    expect(r.phases).toHaveLength(2);
    expect(r.phases[1].taskIds).toEqual(expect.arrayContaining(["T2", "T3", "T4"]));
  });

  it("ignores phases entirely when absent (single-page path)", () => {
    expect(repairModel(base()).phases).toEqual([]);
  });
});
