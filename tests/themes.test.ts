import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout } from "@/lib/engine/layout";
import { renderSvg } from "@/lib/engine/svg";
import { renderDrawio } from "@/lib/engine/drawio";
import { validateDrawio } from "@/lib/engine/validateDrawio";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

const load = (name: string) =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8"),
  ) as ProcessModel;

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

describe("colour scheme themes", () => {
  it("ships three labelled themes with muted as default", () => {
    expect(Object.keys(skill.style.themes)).toEqual(
      expect.arrayContaining(["muted", "corporate", "bold"]),
    );
    expect(skill.style.defaultTheme).toBe("muted");
    for (const t of Object.values(skill.style.themes)) expect(t.label.length).toBeGreaterThan(0);
  });

  it("each theme colours the task nodes with its own fill (SVG)", () => {
    const g = layout(load("approval-flow"), skill);
    const muted = renderSvg(g, skill, "muted");
    const corporate = renderSvg(g, skill, "corporate");
    const bold = renderSvg(g, skill, "bold");

    expect(muted).toContain(skill.style.themes.muted.palette.task.fill); // #d5e8d4
    expect(corporate).toContain(skill.style.themes.corporate.palette.task.fill); // #ffffff
    expect(bold).toContain(skill.style.themes.bold.palette.task.fill); // #4a86c5

    // bold's saturated task fill must not appear in the muted render
    expect(muted).not.toContain(skill.style.themes.bold.palette.task.fill);
    // the three renders are genuinely different
    expect(new Set([muted, corporate, bold]).size).toBe(3);
  });

  it("default (no theme) equals the muted theme", () => {
    const g = layout(load("linear-onboarding"), skill);
    expect(renderSvg(g, skill)).toBe(renderSvg(g, skill, "muted"));
    expect(renderDrawio(g, skill)).toBe(renderDrawio(g, skill, { theme: "muted" }));
  });

  it("themed .drawio is still structurally valid and carries the theme colour", () => {
    const g = layout(load("approval-flow"), skill);
    const xml = renderDrawio(g, skill, { theme: "bold" });
    expect(() => validateDrawio(xml)).not.toThrow();
    expect(xml).toContain(skill.style.themes.bold.palette.task.fill);
  });

  it("an unknown theme falls back to the default palette", () => {
    const g = layout(load("linear-onboarding"), skill);
    expect(renderSvg(g, skill, "nope")).toBe(renderSvg(g, skill, "muted"));
  });
});
