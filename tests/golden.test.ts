import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout } from "@/lib/engine/layout";
import { renderDrawio } from "@/lib/engine/drawio";
import { renderSvg } from "@/lib/engine/svg";
import { validateDrawio } from "@/lib/engine/validateDrawio";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

/**
 * Golden-file safety net (PRD §7). Changing the skill bundle INTENTIONALLY
 * changes these snapshots; an engine change must leave them byte-identical.
 * Regenerate with:  UPDATE_GOLDENS=1 npx vitest run tests/golden.test.ts
 */
const FIXTURES = ["linear-onboarding", "approval-flow", "cap-stress"];
const GOLDEN_DIR = path.join(process.cwd(), "tests", "golden");
const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const UPDATE = process.env.UPDATE_GOLDENS === "1";

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

function build(name: string): { drawio: string; svg: string } {
  const model = JSON.parse(
    readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8"),
  ) as ProcessModel;
  const graph = layout(model, skill);
  return { drawio: renderDrawio(graph, skill), svg: renderSvg(graph, skill) };
}

describe("golden files", () => {
  for (const name of FIXTURES) {
    it(`${name} renders valid, deterministic .drawio + .svg`, () => {
      const { drawio, svg } = build(name);
      expect(() => validateDrawio(drawio)).not.toThrow();

      const dPath = path.join(GOLDEN_DIR, `${name}.drawio`);
      const sPath = path.join(GOLDEN_DIR, `${name}.svg`);
      if (UPDATE || !existsSync(dPath)) writeFileSync(dPath, drawio);
      if (UPDATE || !existsSync(sPath)) writeFileSync(sPath, svg);

      expect(drawio).toBe(readFileSync(dPath, "utf8"));
      expect(svg).toBe(readFileSync(sPath, "utf8"));
    });
  }
});
