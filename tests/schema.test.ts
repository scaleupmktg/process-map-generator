import { describe, it, expect, beforeAll } from "vitest";
import { loadBundledSkill } from "@/lib/skill/load";
import { makeProcessModelSchema } from "@/lib/model/schema";
import type { Modeling } from "@/lib/skill/schema";
import linear from "./fixtures/linear-onboarding.json";
import approval from "./fixtures/approval-flow.json";
import capStress from "./fixtures/cap-stress.json";
import malformed from "./fixtures/malformed.json";

let modeling: Modeling;

beforeAll(async () => {
  modeling = (await loadBundledSkill()).modeling;
});

describe("makeProcessModelSchema — shape + caps accept/reject", () => {
  it("accepts all three well-formed fixtures", () => {
    const schema = makeProcessModelSchema(modeling);
    expect(schema.safeParse(linear).success).toBe(true);
    expect(schema.safeParse(approval).success).toBe(true);
    expect(schema.safeParse(capStress).success).toBe(true);
  });

  it("accepts the malformed fixture at the SHAPE level (repair fixes references)", () => {
    // Bad lane, dangling refs and zero end events are referential problems that
    // auto-repair handles — they must NOT be rejected by the hard schema, or
    // repair could never run.
    const schema = makeProcessModelSchema(modeling);
    expect(schema.safeParse(malformed).success).toBe(true);
  });

  it("rejects a model with zero tasks", () => {
    const schema = makeProcessModelSchema(modeling);
    expect(schema.safeParse({ ...linear, tasks: [] }).success).toBe(false);
  });

  it("rejects duplicate node ids", () => {
    const schema = makeProcessModelSchema(modeling);
    const dup = structuredClone(linear);
    dup.tasks[1].id = "T1";
    expect(schema.safeParse(dup).success).toBe(false);
  });

  it("rejects more tasks than maxTasks", () => {
    const schema = makeProcessModelSchema(modeling);
    const over = structuredClone(capStress);
    // cap-stress is already at 18 tasks; pad past maxTasks (20).
    while (over.tasks.length <= modeling.caps.maxTasks) {
      const n = over.tasks.length + 1;
      over.tasks.push({
        id: `TX${n}`,
        name: `Extra step ${n}`,
        lane: "Sales",
        system: null,
        document: null,
        next: null,
      });
    }
    expect(schema.safeParse(over).success).toBe(false);
  });
});

describe("caps are read from modeling.json, not hardcoded", () => {
  it("lowering maxTasks rejects a model the default schema accepts", () => {
    const defaultSchema = makeProcessModelSchema(modeling);
    expect(defaultSchema.safeParse(linear).success).toBe(true); // 6 tasks OK at 20

    const tightened = structuredClone(modeling);
    tightened.caps.maxTasks = 3;
    const tightSchema = makeProcessModelSchema(tightened);
    expect(tightSchema.safeParse(linear).success).toBe(false); // 6 > 3
  });

  it("lowering maxLanes rejects a model the default schema accepts", () => {
    const defaultSchema = makeProcessModelSchema(modeling);
    expect(defaultSchema.safeParse(capStress).success).toBe(true); // 5 lanes OK

    const tightened = structuredClone(modeling);
    tightened.caps.maxLanes = 3;
    const tightSchema = makeProcessModelSchema(tightened);
    expect(tightSchema.safeParse(capStress).success).toBe(false); // 5 > 3
  });
});
