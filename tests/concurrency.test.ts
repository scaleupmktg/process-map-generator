import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { POST } from "@/app/api/extract/route";
import { __resetRateLimit } from "@/lib/ratelimit";

/**
 * Statelessness / concurrency guarantee (PRD §3, §10, §16). N simultaneous
 * requests with distinct payloads must produce N independent responses with no
 * cross-contamination and no 5xx. The server holds no shared mutable request
 * state, so this must hold by construction.
 */
const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY; // force the deterministic offline mock
  __resetRateLimit();
});
afterAll(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

it("50 parallel extractions: no cross-contamination, no 5xx", async () => {
  const N = 50;
  const requests = Array.from({ length: N }, (_, i) => {
    const marker = `Process number ${i} zeta${i}. First step ${i}. Second step ${i}. Done ${i}.`;
    return {
      i,
      req: new Request("http://localhost/api/extract", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.20.${Math.floor(i / 250)}.${i % 250}`,
        },
        body: JSON.stringify({ text: marker }),
      }),
    };
  });

  const results = await Promise.all(
    requests.map(async ({ i, req }) => {
      const res = await POST(req);
      return { i, status: res.status, json: await res.json() };
    }),
  );

  for (const r of results) {
    expect(r.status, `request ${r.i} status`).toBe(200);
    expect(r.json.ok).toBe(true);
    // The mock derives processName from the input; each must echo its own marker.
    expect(r.json.model.processName).toContain(`Process number ${r.i} zeta${r.i}`);
  }

  // Every response is unique — nothing leaked between concurrent invocations.
  const names = new Set(results.map((r) => r.json.model.processName));
  expect(names.size).toBe(N);
});
