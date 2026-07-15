import type { ProcessModel } from "@/lib/model/schema";
import type { ClientSkill } from "@/lib/skill/schema";
import { layoutPages } from "@/lib/engine/layout";
import { renderSvg } from "@/lib/engine/svg";
import type { Page } from "@/lib/engine/types";

export type PreviewPage = {
  name: string;
  kind: Page["kind"];
  svg: string;
  dataUri: string;
  fitWarnings: string[];
};

/**
 * Build the on-screen preview from the model + the skill bundle that produced
 * it. Returns one entry per page — a single page for most processes, or an
 * overview + per-phase pages for a large decomposed one. Each SVG is delivered
 * as an inert data URI (no script execution from LLM-derived labels) and shares
 * geometry with the .drawio export.
 */
export function buildPreview(
  model: ProcessModel,
  skill: ClientSkill,
  theme?: string,
): PreviewPage[] {
  return layoutPages(model, skill).map((page) => {
    const svg = renderSvg(page, skill, theme);
    return {
      name: page.name,
      kind: page.kind,
      svg,
      dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      fitWarnings: page.fitWarnings,
    };
  });
}
