import ExcelJS from "exceljs";
import type { SkillBundle } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

/**
 * renderXlsx(model, skill) — the process register (PRD §8). Three sheets:
 *   1. Process Map — the step register (styled header, frozen panes, auto-filter)
 *   2. Decisions   — decision branches with names resolved from ids
 *   3. About       — metadata, notes, GrowThriveScale branding + booking link
 *
 * Built from the ProcessModel (not the geometry). Runs client-side; ExcelJS is
 * isomorphic, so the same code round-trips in Node tests. Header colours come
 * from the skill palette (tableHeader) — no literals here.
 */

export type XlsxOptions = { generatedAt?: string; bookingUrl?: string };

const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

/** Resolve any node id to a human-readable label. */
function labelMap(model: ProcessModel): Map<string, string> {
  const m = new Map<string, string>();
  m.set("__start__", model.startEvent || "Start");
  for (const t of model.tasks) m.set(t.id, t.name);
  for (const d of model.decisions) m.set(d.id, d.name);
  for (const e of model.endEvents) m.set(e.id, e.name);
  return m;
}

/** What comes after a task in the flow, as a readable label. */
function nextLabel(model: ProcessModel, taskId: string, names: Map<string, string>): string {
  const task = model.tasks.find((t) => t.id === taskId);
  if (task?.next && names.has(task.next)) return names.get(task.next)!;
  const dec = model.decisions.find((d) => d.from === taskId);
  if (dec) return `◇ ${dec.name}`;
  const end = model.endEvents.find((e) => e.from === taskId);
  if (end) return end.name;
  return "";
}

export function buildWorkbook(
  model: ProcessModel,
  skill: SkillBundle,
  opts: XlsxOptions = {},
): ExcelJS.Workbook {
  const names = labelMap(model);
  const header = skill.style.palette.tableHeader;
  const brand = skill.style.branding;
  const generatedAt = opts.generatedAt ?? skill.manifest.updated;
  const bookingUrl = opts.bookingUrl || `https://${brand.site}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = brand.company;

  const styleHeaderRow = (ws: ExcelJS.Worksheet, lastCol: string) => {
    const row = ws.getRow(1);
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(header.fill) } };
      cell.font = { bold: true, color: { argb: argb(header.text) } };
      cell.alignment = { vertical: "middle" };
    });
    row.height = 20;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = `A1:${lastCol}1`;
  };

  // ---- Sheet 1: Process Map ------------------------------------------------
  const map = wb.addWorksheet("Process Map");
  map.columns = [
    { header: "Step ID", key: "id", width: 10 },
    { header: "Task", key: "task", width: 34 },
    { header: "Role / Lane", key: "lane", width: 20 },
    { header: "System", key: "system", width: 16 },
    { header: "Document", key: "document", width: 20 },
    { header: "Next", key: "next", width: 28 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  for (const t of model.tasks) {
    map.addRow({
      id: t.id,
      task: t.name,
      lane: t.lane,
      system: t.system ?? "",
      document: t.document ?? "",
      next: nextLabel(model, t.id, names),
      notes: "",
    });
  }
  styleHeaderRow(map, "G");

  // ---- Sheet 2: Decisions --------------------------------------------------
  const dec = wb.addWorksheet("Decisions");
  dec.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Decision", key: "name", width: 30 },
    { header: "Lane", key: "lane", width: 18 },
    { header: "From", key: "from", width: 28 },
    { header: "If Yes →", key: "yes", width: 28 },
    { header: "If No →", key: "no", width: 28 },
  ];
  for (const d of model.decisions) {
    dec.addRow({
      id: d.id,
      name: d.name,
      lane: d.lane,
      from: names.get(d.from) ?? d.from,
      yes: names.get(d.yes) ?? d.yes,
      no: names.get(d.no) ?? d.no,
    });
  }
  styleHeaderRow(dec, "F");
  if (model.decisions.length === 0) {
    dec.addRow({ id: "", name: "No decision points in this process." });
  }

  // ---- Sheet 3: About ------------------------------------------------------
  const about = wb.addWorksheet("About");
  about.columns = [
    { key: "k", width: 24 },
    { key: "v", width: 64 },
  ];
  const title = about.addRow([`${model.processName} — Process Register`]);
  title.font = { bold: true, size: 14, color: { argb: argb(header.text) } };
  title.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: argb(header.fill) },
  };
  about.mergeCells("A1:B1");
  about.getRow(1).height = 24;
  about.addRow([]);

  const kv = (k: string, v: string) => {
    const r = about.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    return r;
  };
  kv("Process name", model.processName);
  kv("Org unit", model.orgUnit ?? "—");
  kv("Tasks", String(model.tasks.length));
  kv("Lanes", String(model.lanes.length));
  kv("Decisions", String(model.decisions.length));
  kv("Generated", generatedAt);
  kv("Skill version", `v${skill.manifest.version}`);
  about.addRow([]);

  const notesHeader = about.addRow(["Notes & assumptions"]);
  notesHeader.getCell(1).font = { bold: true };
  if (model.notes.length === 0) {
    about.addRow(["", "None recorded."]);
  } else {
    for (const note of model.notes) about.addRow(["", note]);
  }
  about.addRow([]);

  about.addRow(["", brand.footer]);
  const cta = about.addRow(["", "Book a free consultation"]);
  cta.getCell(2).value = { text: "Book a free consultation", hyperlink: bookingUrl };
  cta.getCell(2).font = {
    color: { argb: argb(skill.style.palette.startend.text) },
    underline: true,
  };

  return wb;
}

/** Build the workbook and return an .xlsx byte buffer for download / tests. */
export async function renderXlsx(
  model: ProcessModel,
  skill: SkillBundle,
  opts: XlsxOptions = {},
): Promise<ArrayBuffer> {
  const wb = buildWorkbook(model, skill, opts);
  return wb.xlsx.writeBuffer();
}
