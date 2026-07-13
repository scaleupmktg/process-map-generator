import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Enforces the PRD's structural rule (§7, §16): the engine holds no opinionated
 * literals — every hex colour and font name comes from the skill bundle. If a
 * reviewer greps /src/lib and finds a hex or the typeface name, that's a bug.
 *
 * Scope note: currently src/lib (engine/model/skill). Phase 6 broadens this to
 * src/app + src/components once the scaffold homepage is replaced.
 */
const ROOT = path.join(process.cwd(), "src", "lib");
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FONT = /\bVerdana\b/; // the v1 typeface must live only in the skill bundle

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("no opinionated literals in the engine", () => {
  const files = walk(ROOT);

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((f) => [path.relative(process.cwd(), f), f]))(
    "%s contains no hardcoded hex colour",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      const line = src.split("\n").find((l) => HEX.test(l));
      expect(line, `hex literal: ${line?.trim()}`).toBeUndefined();
    },
  );

  it.each(files.map((f) => [path.relative(process.cwd(), f), f]))(
    "%s does not hardcode the typeface name",
    (_rel, file) => {
      const src = readFileSync(file, "utf8");
      expect(FONT.test(src), "typeface name is hardcoded").toBe(false);
    },
  );
});
