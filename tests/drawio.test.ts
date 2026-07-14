import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout, layoutPages } from "@/lib/engine/layout";
import { repairModel } from "@/lib/model/repair";
import { renderDrawio } from "@/lib/engine/drawio";
import { renderSvg } from "@/lib/engine/svg";
import { validateDrawio } from "@/lib/engine/validateDrawio";
import { slugify, outputFilenames } from "@/lib/engine/slug";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8")) as ProcessModel;

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

describe("renderDrawio — structure", () => {
  const names = ["linear-onboarding", "approval-flow", "cap-stress"];

  it.each(names)("%s produces structurally valid drawio", (name) => {
    const xml = renderDrawio(layout(load(name), skill), skill);
    expect(() => validateDrawio(xml)).not.toThrow();
    expect(xml.startsWith("<mxfile")).toBe(true);
  });

  it("lanes are swimlanes with container=1;collapsible=0", () => {
    const xml = renderDrawio(layout(load("approval-flow"), skill), skill);
    const laneCells = xml.match(/swimlane;[^"]*container=1;collapsible=0/g) ?? [];
    expect(laneCells.length).toBe(3); // three used lanes
  });

  it("stamps the skill version in the footer and an mxfile attribute", () => {
    const xml = renderDrawio(layout(load("linear-onboarding"), skill), skill);
    expect(xml).toContain(`data-skill-version="${skill.manifest.version}"`);
    expect(xml).toContain(`v${skill.manifest.version}`);
    expect(xml).toContain(skill.style.branding.footer);
  });

  it("multi-page: emits one <diagram> tab per page and validates", () => {
    const model = repairModel(load("xpr-phased"), { maxPhases: 8 });
    const pages = layoutPages(model, skill);
    expect(pages.length).toBeGreaterThan(1);
    const xml = renderDrawio(pages, skill);
    expect(() => validateDrawio(xml)).not.toThrow();
    expect((xml.match(/<diagram /g) ?? []).length).toBe(pages.length);
    expect(xml).toContain('name="Overview"');
    expect(xml).toContain('name="Invoicing"');
  });

  it("single-page output is unchanged whether passed a graph or a one-page array", () => {
    const g = layout(load("approval-flow"), skill);
    const pages = layoutPages(load("approval-flow"), skill);
    expect(renderDrawio(pages, skill, { generatedAt: "x" })).toBe(
      renderDrawio(g, skill, { generatedAt: "x" }),
    );
  });

  it("is deterministic given a fixed generatedAt", () => {
    const g = layout(load("approval-flow"), skill);
    const a = renderDrawio(g, skill, { generatedAt: "2026-01-01" });
    const b = renderDrawio(g, skill, { generatedAt: "2026-01-01" });
    expect(a).toBe(b);
  });

  it("colours come from the skill palette (change palette → change output)", () => {
    const g = layout(load("linear-onboarding"), skill);
    const before = renderDrawio(g, skill);
    expect(before).toContain(skill.style.palette.task.fill);

    const edited = structuredClone(skill);
    edited.style.palette.task.fill = "#123456";
    const after = renderDrawio(layout(load("linear-onboarding"), edited), edited);
    expect(after).toContain("#123456");
    expect(after).not.toContain(skill.style.palette.task.fill);
  });
});

describe("validateDrawio — catches breakage", () => {
  it("throws on a duplicate cell id", () => {
    const bad =
      '<mxfile><diagram name="d"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="x" vertex="1" parent="1"><mxGeometry/></mxCell>' +
      '<mxCell id="x" vertex="1" parent="1"><mxGeometry/></mxCell>' +
      "</root></mxGraphModel></diagram></mxfile>";
    expect(() => validateDrawio(bad)).toThrow(/duplicate/);
  });

  it("throws on an edge whose target does not resolve", () => {
    const bad =
      '<mxfile><diagram name="d"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="a" vertex="1" parent="1"><mxGeometry/></mxCell>' +
      '<mxCell id="e" edge="1" parent="1" source="a" target="ghost"><mxGeometry/></mxCell>' +
      "</root></mxGraphModel></diagram></mxfile>";
    expect(() => validateDrawio(bad)).toThrow(/target .*unresolved/);
  });

  it("throws on a vertex missing geometry", () => {
    const bad =
      '<mxfile><diagram name="d"><mxGraphModel><root>' +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="a" vertex="1" parent="1"/>' +
      "</root></mxGraphModel></diagram></mxfile>";
    expect(() => validateDrawio(bad)).toThrow(/missing geometry/);
  });
});

describe("renderSvg — structure", () => {
  it("emits an accessible single-root svg with a viewBox", () => {
    const svg = renderSvg(layout(load("approval-flow"), skill), skill);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("aria-label=");
    expect(svg).toContain("viewBox=");
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });

  it("contains a diamond for each decision", () => {
    const g = layout(load("approval-flow"), skill);
    const svg = renderSvg(g, skill);
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2);
  });
});

describe("slugify / filenames", () => {
  it("slugifies process names for downloads", () => {
    expect(slugify("Perform Annual Review!")).toBe("perform-annual-review");
    expect(slugify("   ")).toBe("process");
    expect(outputFilenames("Purchase Requisition Approval")).toEqual({
      drawio: "purchase-requisition-approval-process-map.drawio",
      xlsx: "purchase-requisition-approval-process-register.xlsx",
    });
  });
});
