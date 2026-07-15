import type { ProcessModel } from "@/lib/model/schema";
import type { ClientSkill } from "@/lib/skill/schema";
import { layoutPages } from "@/lib/engine/layout";
import { renderDrawio } from "@/lib/engine/drawio";
import { outputFilenames } from "@/lib/engine/slug";

/** Client-side file downloads. All generation happens in the browser. */

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadDrawio(
  model: ProcessModel,
  skill: ClientSkill,
  theme?: string,
): void {
  // layoutPages → a single page for most processes, or an overview + per-phase
  // pages (drawio tabs) for a large decomposed one.
  const xml = renderDrawio(layoutPages(model, skill), skill, {
    generatedAt: new Date().toISOString().slice(0, 19),
    theme,
  });
  saveBlob(
    outputFilenames(model.processName).drawio,
    new Blob([xml], { type: "application/xml" }),
  );
}

export async function downloadXlsx(
  model: ProcessModel,
  skill: ClientSkill,
  bookingUrl?: string,
): Promise<void> {
  // ExcelJS is heavy — only pulled into the bundle when a download happens.
  const { renderXlsx } = await import("@/lib/engine/xlsx");
  const buffer = await renderXlsx(model, skill, {
    bookingUrl,
    generatedAt: new Date().toLocaleDateString(),
  });
  saveBlob(
    outputFilenames(model.processName).xlsx,
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}
