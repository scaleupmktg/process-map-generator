import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { POST } from "@/app/api/extract/route";
import { __resetRateLimit } from "@/lib/ratelimit";

/** Force the offline mock even if the dev shell has a real key set. */
const savedKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  __resetRateLimit();
});
afterAll(() => {
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

function makeReq(text: string, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ text }),
  });
}

const GOOD = "The team receives an order. They pack the shipment. Then they ship it to the customer.";

describe("POST /api/extract", () => {
  it("returns a repaired model + client skill (without the prompt) on success", async () => {
    const res = await POST(makeReq(GOOD, "10.0.0.1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.model.tasks.length).toBeGreaterThan(0);
    expect(json.model.endEvents.length).toBeGreaterThanOrEqual(1);
    expect(json.skill.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.skill.modeling).toBeDefined();
    expect(json.skill.style).toBeDefined();
    expect(json.skill.extraction).toBeUndefined(); // server prompt not leaked
  });

  it("400 TOO_SHORT for tiny input", async () => {
    const res = await POST(makeReq("hi", "10.0.0.2"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("TOO_SHORT");
  });

  it("400 TOO_LONG for oversized input", async () => {
    const res = await POST(makeReq("x".repeat(6001), "10.0.0.3"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("TOO_LONG");
  });

  it("400 BAD_REQUEST on a non-JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/extract", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.4" },
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("429 after exceeding the hourly limit for one IP", async () => {
    const ip = "10.0.0.9";
    for (let i = 0; i < 5; i++) expect((await POST(makeReq(GOOD, ip))).status).toBe(200);
    const res = await POST(makeReq(GOOD, ip));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
  });

  it("treats distinct IPs independently", async () => {
    for (let i = 0; i < 5; i++) await POST(makeReq(GOOD, "10.1.0.1"));
    const other = await POST(makeReq(GOOD, "10.1.0.2"));
    expect(other.status).toBe(200);
  });
});
