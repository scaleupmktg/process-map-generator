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
  delete process.env.AIRTABLE_API_KEY;
  delete process.env.AIRTABLE_BASE_ID;
  delete process.env.AIRTABLE_TABLE_NAME;
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

  it("returns 200 with no sink configured", async () => {
    delete process.env.LEAD_WEBHOOK_URL;
    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates an Airtable record (correct URL, auth header, fields) when configured", async () => {
    delete process.env.LEAD_WEBHOOK_URL;
    process.env.AIRTABLE_API_KEY = "patTEST";
    process.env.AIRTABLE_BASE_ID = "appTEST";
    process.env.AIRTABLE_TABLE_NAME = "Leads";

    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);

    const call = fetchMock.mock.calls.find(([u]) =>
      String(u).includes("api.airtable.com"),
    );
    expect(call).toBeDefined();
    const [url, opts] = call!;
    expect(url).toBe("https://api.airtable.com/v0/appTEST/Leads");
    expect((opts as RequestInit).headers).toMatchObject({
      authorization: "Bearer patTEST",
    });
    const sent = JSON.parse((opts as RequestInit).body as string);
    expect(sent.fields.Email).toBe(LEAD.email);
    expect(sent.fields["Process Name"]).toBe(LEAD.processName);
    expect(sent.fields["Task Count"]).toBe(5);
    // still never leaks process text
    expect((opts as RequestInit).body).not.toContain("SECRET");
  });

  it("returns 200 even if Airtable rejects the record", async () => {
    process.env.AIRTABLE_API_KEY = "patTEST";
    process.env.AIRTABLE_BASE_ID = "appTEST";
    process.env.AIRTABLE_TABLE_NAME = "Leads";
    delete process.env.LEAD_WEBHOOK_URL;
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 422 }));
    const res = await POST(makeReq(LEAD));
    expect(res.status).toBe(200);
  });
});
