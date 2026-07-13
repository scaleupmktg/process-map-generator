import type { ProcessModel } from "@/lib/model/schema";
import type { ClientSkill } from "@/lib/skill/schema";
import { layout } from "@/lib/engine/layout";
import { renderSvg } from "@/lib/engine/svg";
import type { PositionedGraph } from "@/lib/engine/types";

/**
 * Build the on-screen SVG preview from the model + the skill bundle that
 * produced it. The SVG is delivered as an inert data URI (no script execution
 * from LLM-derived labels), and it shares geometry with the .drawio export.
 */
export function buildPreview(
  model: ProcessModel,
  skill: ClientSkill,
): { graph: PositionedGraph; svg: string; dataUri: string } {
  const graph = layout(model, skill);
  const svg = renderSvg(graph, skill);
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return { graph, svg, dataUri };
}
