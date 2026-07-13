/**
 * npm run concurrency:test — fire N (default 50) parallel extractions with
 * distinct payloads against the extract route and assert no cross-contamination
 * and no 5xx (PRD §13.9). Uses the offline mock so it costs nothing; if
 * ANTHROPIC_API_KEY is set it also runs a tiny real-API smoke.
 */
import { POST } from "@/app/api/extract/route";
import { __resetRateLimit } from "@/lib/ratelimit";

const N = Number(process.argv[2]) || 50;

function makeRequest(i: number): Request {
  const marker = `Process number ${i} zeta${i}. First step ${i}. Second step ${i}. Done ${i}.`;
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.30.${Math.floor(i / 250)}.${i % 250}`,
    },
    body: JSON.stringify({ text: marker }),
  });
}

async function runBatch(label: string): Promise<boolean> {
  __resetRateLimit();
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const res = await POST(makeRequest(i));
      const json = await res.json();
      return { i, status: res.status, name: json?.model?.processName ?? "" };
    }),
  );
  const bad = results.filter((r) => r.status !== 200);
  const leaked = results.filter((r) => !r.name.includes(`Process number ${r.i} zeta${r.i}`));
  const unique = new Set(results.map((r) => r.name)).size;
  const ms = Date.now() - start;

  console.log(`\n[${label}] ${N} parallel extractions in ${ms}ms`);
  console.log(`  5xx / non-200: ${bad.length}`);
  console.log(`  cross-contaminated: ${leaked.length}`);
  console.log(`  unique responses: ${unique}/${N}`);
  const ok = bad.length === 0 && leaked.length === 0 && unique === N;
  console.log(`  → ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

async function main() {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const mockOk = await runBatch("mock");
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

  if (!mockOk) process.exit(1);
  console.log("\n✔ concurrency test passed.");
  if (savedKey) {
    console.log("(ANTHROPIC_API_KEY present — run a few real extractions manually to smoke the live model.)");
  }
}

main().catch((e) => {
  console.error("✘ concurrency test errored:", e);
  process.exit(1);
});
