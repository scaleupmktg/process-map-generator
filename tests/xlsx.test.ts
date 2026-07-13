import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadBundledSkill } from "@/lib/skill/load";
import { buildWorkbook, renderXlsx } from "@/lib/engine/xlsx";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

const FIX_DIR = path.join(process.cwd(), "tests", "fixtures");
const load = (name: string) =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${name}.json`), "utf8")) as ProcessModel;

let skill: SkillBundle;
beforeAll(async () => {
  skill = await loadBundledSkill();
});

describe("renderXlsx — Process Map sheet", () => {
  it("has the register columns, a styled frozen header, and auto-filter", () => {
    const wb = buildWorkbook(load("approval-flow"), skill);
    const ws = wb.getWorksheet("Process Map")!;
    expect(ws).toBeDefined();

    const headers = ws.getRow(1).values as unknown[];
    expect(headers).toContain("Step ID");
    expect(headers).toContain("Role / Lane");
    expect(headers).toContain("Next");

    const h = ws.getRow(1).getCell(1);
    expect(h.font?.bold).toBe(true);
    expect((h.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(
      `FF${skill.style.palette.tableHeader.fill.slice(1).toUpperCase()}`,
    );
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBe("A1:G1");
  });

  it("has one data row per task with the correct next-step label", () => {
    const model = load("approval-flow");
    const ws = buildWorkbook(model, skill).getWorksheet("Process Map")!;
    expect(ws.rowCount).toBe(model.tasks.length + 1); // + header
    // T1 submits then flows into decision D1 "Manager approves?"
    const t1 = ws.getRow(2);
    expect(t1.getCell(1).value).toBe("T1");
    expect(String(t1.getCell(6).value)).toContain("Manager approves?");
    // T4 → T5 (task to task) resolves to the next task's name
    const t4 = ws.getRow(5); // rows 2..6 = T1..T5; row 5 = T4
    expect(t4.getCell(1).value).toBe("T4");
    expect(String(t4.getCell(6).value)).toBe("Notify requestor");
  });
});

describe("renderXlsx — Decisions sheet", () => {
  it("resolves from/yes/no ids to names", () => {
    const ws = buildWorkbook(load("approval-flow"), skill).getWorksheet("Decisions")!;
    const d1 = ws.getRow(2);
    expect(d1.getCell(1).value).toBe("D1");
    expect(d1.getCell(4).value).toBe("Submit purchase request"); // from T1
    expect(d1.getCell(5).value).toBe("Check budget"); // yes → T3
    expect(d1.getCell(6).value).toBe("Revise request"); // no → T2
  });

  it("degrades gracefully when there are no decisions", () => {
    const ws = buildWorkbook(load("linear-onboarding"), skill).getWorksheet("Decisions")!;
    expect(ws.getRow(2).getCell(2).value).toMatch(/No decision/);
  });
});

describe("renderXlsx — About sheet", () => {
  it("carries metadata, notes, branding, version and a booking link", () => {
    const model = load("cap-stress");
    const ws = buildWorkbook(model, skill, {
      bookingUrl: "https://growthrivescale.com/book",
    }).getWorksheet("About")!;
    const flat = (ws.getSheetValues() as unknown[][])
      .flat()
      .map((v) => (typeof v === "object" && v ? JSON.stringify(v) : String(v)))
      .join("\n");
    expect(flat).toContain(model.processName);
    expect(flat).toContain(`v${skill.manifest.version}`);
    expect(flat).toContain(skill.style.branding.footer);
    expect(flat).toContain(model.notes[0]);
    expect(flat).toContain("growthrivescale.com/book");
  });
});

describe("renderXlsx — round-trips to a valid workbook", () => {
  it("writes a buffer that reloads with three sheets", async () => {
    const buffer = await renderXlsx(load("approval-flow"), skill);
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Process Map",
      "Decisions",
      "About",
    ]);
  });
});
