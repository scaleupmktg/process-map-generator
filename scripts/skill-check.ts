/**
 * npm run skill:check — the safe skill-iteration loop (PRD §7).
 * Validates the bundle against the schema, re-renders every fixture, writes
 * preview SVGs to a temp dir for eyeballing, and reports which golden snapshots
 * would change. After an intentional skill edit, review the previews then run:
 *   UPDATE_GOLDENS=1 npx vitest run tests/golden.test.ts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadBundledSkill } from "@/lib/skill/load";
import { layout } from "@/lib/engine/layout";
import { renderDrawio } from "@/lib/engine/drawio";
import { renderSvg } from "@/lib/engine/svg";
import { validateDrawio } from "@/lib/engine/validateDrawio";
import type { ProcessModel } from "@/lib/model/schema";

const FIXTURES = ["linear-onboarding", "approval-flow", "cap-stress"];

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

async function main() {
  const skill = await loadBundledSkill();
  console.log(`✔ bundle valid — ${skill.manifest.name} v${skill.manifest.version} (schema v${skill.manifest.schemaVersion})`);

  const outDir = path.join(os.tmpdir(), "pmg-skill-check");
  mkdirSync(outDir, { recursive: true });
  const goldenDir = path.join(process.cwd(), "tests", "golden");
  const fixDir = path.join(process.cwd(), "tests", "fixtures");
  let diffs = 0;

  for (const name of FIXTURES) {
    const model = JSON.parse(
      readFileSync(path.join(fixDir, `${name}.json`), "utf8"),
    ) as ProcessModel;
    const graph = layout(model, skill);
    const drawio = renderDrawio(graph, skill);
    validateDrawio(drawio);
    const svg = renderSvg(graph, skill);
    writeFileSync(path.join(outDir, `${name}.svg`), svg);
    writeFileSync(path.join(outDir, `${name}.drawio`), drawio);

    const fit = graph.fitWarnings.length ? `  ⚠ ${graph.fitWarnings.length} fit warning(s)` : "";
    console.log(`\n• ${name}${fit}`);
    for (const [ext, content] of [
      ["svg", svg],
      ["drawio", drawio],
    ] as const) {
      const goldenPath = path.join(goldenDir, `${name}.${ext}`);
      const golden = existsSync(goldenPath) ? readFileSync(goldenPath, "utf8") : null;
      if (golden === content) {
        console.log(`    = ${name}.${ext} (unchanged)`);
      } else {
        diffs++;
        const at = golden ? firstDiff(golden, content) : 0;
        console.log(`    ± ${name}.${ext} (differs${golden ? ` at char ${at}` : " — new"})`);
      }
    }
  }

  console.log(`\nPreviews written to: ${outDir}`);
  if (diffs > 0) {
    console.log(`\n${diffs} snapshot(s) differ. If intentional, review the SVGs then run:`);
    console.log(`  UPDATE_GOLDENS=1 npx vitest run tests/golden.test.ts`);
  } else {
    console.log(`\n✔ no differences from committed goldens.`);
  }
}

main().catch((e: unknown) => {
  console.error("✘ skill:check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
