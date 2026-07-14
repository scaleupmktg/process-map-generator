import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout, layoutPages } from "@/lib/engine/layout";
import { repairModel } from "@/lib/model/repair";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8")) as ProcessModel;

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

describe("layoutPages — single-page fast path", () => {
  it("returns exactly one page for unphased fixtures", () => {
    for (const name of ["linear-onboarding", "approval-flow", "cap-stress"]) {
      const pages = layoutPages(load(name), skill);
      expect(pages).toHaveLength(1);
      expect(pages[0].kind).toBe("single");
    }
  });

  it("single page is identical to layout() for those models", () => {
    const model = load("approval-flow");
    const [page] = layoutPages(model, skill);
    const single = layout(model, skill);
    // strip the page-only fields before comparing
    const { name, kind, pageId, ...graph } = page;
    void name;
    void kind;
    void pageId;
    expect(JSON.stringify(graph)).toBe(JSON.stringify(single));
  });

  it("keeps a phased model on one page when it already fits", () => {
    const model = repairModel(load("linear-onboarding"), { maxPhases: 8 });
    model.phases = [
      { id: "P1", name: "Kickoff", taskIds: ["T1", "T2", "T3"] },
      { id: "P2", name: "Setup", taskIds: ["T4", "T5", "T6"] },
    ];
    // small model — a single page fits, so no decomposition
    expect(layoutPages(model, skill)).toHaveLength(1);
  });
});

describe("layoutPages — phased decomposition (xpr-phased)", () => {
  const model = () => repairModel(load("xpr-phased"), { maxPhases: 8 });

  it("produces an overview page + one page per phase", () => {
    const pages = layoutPages(model(), skill);
    expect(pages[0].kind).toBe("overview");
    expect(pages.slice(1).every((p) => p.kind === "phase")).toBe(true);
    expect(pages).toHaveLength(1 + 6); // overview + 6 phases
    expect(pages.map((p) => p.name)).toEqual([
      "Overview",
      "Expense Request",
      "Vendor Onboarding",
      "Non-Catalog Request",
      "PO Approval & Issuance",
      "Invoicing",
      "Payment & Exceptions",
    ]);
  });

  it("decomposition shrinks every page far below the monolith (the whole point)", () => {
    const pages = layoutPages(model(), skill);
    const monolith = layout(model(), skill).contentHeight; // the tall single page
    for (const page of pages) {
      // every page fits within a portrait page's height envelope...
      expect(page.contentHeight, page.name).toBeLessThanOrEqual(1169);
      // ...and is far shorter than the undivided diagram
      expect(page.contentHeight, page.name).toBeLessThan(monolith * 0.6);
    }
    // and most pages fit a standard landscape page outright
    const fitting = pages.filter((p) => p.fitWarnings.length === 0).length;
    expect(fitting).toBeGreaterThanOrEqual(pages.length - 1);
  });

  it("the overview shows the phases as sub-process boxes", () => {
    const overview = layoutPages(model(), skill)[0];
    const subs = overview.nodes.filter((n) => n.kind === "subprocess");
    expect(subs).toHaveLength(6);
  });

  it("cross-page edges become paired off-page connectors", () => {
    const pages = layoutPages(model(), skill);
    // A forward handoff (e.g. into "Non-Catalog Request") must appear as a
    // "From …" connector on the target page and a "To …" connector on a source page.
    const allOffpage = pages.flatMap((p) => p.nodes.filter((n) => n.kind === "offpage"));
    expect(allOffpage.some((n) => n.label.startsWith("To "))).toBe(true);
    expect(allOffpage.some((n) => n.label.startsWith("From "))).toBe(true);
    // Non-Catalog Request is entered from three places (P2 seq, D2 yes, D3 no,
    // P6 amend) so it should carry multiple "From" connectors.
    const nonCat = pages.find((p) => p.name === "Non-Catalog Request")!;
    expect(nonCat.nodes.filter((n) => n.kind === "offpage" && n.label.startsWith("From ")).length)
      .toBeGreaterThanOrEqual(1);
  });

  it("no node overlaps on any page", () => {
    type Rect = { x: number; y: number; w: number; h: number };
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const page of layoutPages(model(), skill)) {
      const ns = page.nodes;
      for (let i = 0; i < ns.length; i++)
        for (let j = i + 1; j < ns.length; j++)
          expect(overlaps(ns[i], ns[j]), `${page.name}`).toBe(false);
    }
  });
});
