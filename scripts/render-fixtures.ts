/**
 * npx tsx scripts/render-fixtures.ts [outDir] — render every fixture page (plus a
 * few fuzz models: FUZZ_SEEDS="1,2,3") to SVG with an index.html contact sheet,
 * for eyeballing connector routing. Output defaults to ./.render (gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadBundledSkill } from "@/lib/skill/load";
import { layoutPages } from "@/lib/engine/layout";
import { renderSvg } from "@/lib/engine/svg";
import { assessRoutes } from "@/lib/engine/routeQuality";
import type { ProcessModel } from "@/lib/model/schema";
import { randomModel } from "../tests/util/randomModel";

const FIXTURES = ["linear-onboarding", "approval-flow", "cap-stress", "xpr-phased"];

async function main() {
  const out = path.resolve(process.argv[2] ?? ".render");
  mkdirSync(out, { recursive: true });
  const skill = await loadBundledSkill();
  const models: [string, ProcessModel][] = FIXTURES.map((name) => [
    name,
    JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8")),
  ]);
  for (const s of (process.env.FUZZ_SEEDS ?? "").split(",").filter(Boolean)) {
    models.push([`fuzz-${s}`, randomModel(Number(s))]);
  }

  const cards: string[] = [];
  for (const [name, model] of models) {
    layoutPages(model, skill).forEach((page, i) => {
      const file = `${name}-${i}.svg`;
      writeFileSync(path.join(out, file), renderSvg(page, skill));
      const q = assessRoutes(page, { labelFontPt: skill.modeling.type.smallFontPt });
      const stats =
        `${page.edges.length} edges · ${q.edgeNodeOverlaps.length} through shapes · ` +
        `${q.edgeEdgeOverlaps.length} overlaps · ${q.crossings} crossings · ${q.bends} bends`;
      cards.push(`<h2>${name} / ${page.name}</h2><p>${stats}</p><img src="${file}">`);
    });
  }
  writeFileSync(
    path.join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Fixture renders</title>` +
      `<style>body{font:14px system-ui;margin:16px}img{max-width:100%;border:1px solid #ccc}</style>` +
      cards.join(""),
  );
  console.log(`wrote ${cards.length} pages → ${path.join(out, "index.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
