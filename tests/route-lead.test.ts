import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/lead/route";

const savedWebhook = process.env.LEAD_WEBHOOK_URL;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (savedWebhook === undefined) delete process.env.LEAD_WEBHOOK_URL;
  else process.env.LEAD_WEBHOOK_URL = savedWebhook;
  vi.unstubAllGlobals();
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/lead", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const LEAD = {
  email: "manager@acme.com",
  company: "Acme",
  processName: "Purchase Requisition Approval",
  taskCount: 5,
  laneCount: 3,
  source: "process-map-generator",
};

describe("POST /api/lead", () => {
  it("rejects an invalid email with 400", async () => {
    const res = await POST(makeReq({ ...LEAD, email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("forwards a minimal payload to the webhook and returns 200", async () => {
    process.env.LEAD_WEBHOOK_URL = "https://hook.example.com/lead";
    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hook.example.com/lead");
    const sent = JSON.parse((opts as RequestInit).body as string);
    expect(sent.email).toBe(LEAD.email);
    expect(sent.processName).toBe(LEAD.processName);
    expect(sent.taskCount).toBe(5);
  });

  it("never forwards process text or the model", async () => {
    process.env.LEAD_WEBHOOK_URL = "https://hook.example.com/lead";
    await POST(
      makeReq({
        ...LEAD,
        text: "SECRET process description that must not leak",
        model: { tasks: [{ name: "secret task" }] },
      }),
    );
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(body).not.toContain("SECRET");
    expect(body).not.toContain("secret task");
    expect(body).not.toContain("model");
  });

  it("returns 200 even when the webhook is down (download must not be blocked)", async () => {
    process.env.LEAD_WEBHOOK_URL = "https://hook.example.com/lead";
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);
  });

  it("returns 200 with no webhook configured", async () => {
    delete process.env.LEAD_WEBHOOK_URL;
    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
