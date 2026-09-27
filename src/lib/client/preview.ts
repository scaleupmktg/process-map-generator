import type { ClientSkill } from "@/lib/skill/schema";
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
 * Build the on-screen preview from the laid-out pages (layoutPages) + the skill
 * bundle that produced them. One entry per page — a single page for most
 * processes, or an overview + per-phase pages for a large decomposed one. Each
 * SVG is delivered as an inert data URI (no script execution from LLM-derived
 * labels) and shares geometry with the .drawio export. Layout (including
 * connector routing) is theme-independent, so callers compute it once and only
 * re-render here when the colour scheme changes.
 */
export function buildPreview(
  layout: Page[],
  skill: ClientSkill,
  theme?: string,
): PreviewPage[] {
  return layout.map((page) => {
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
