import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lead (PRD §9). Validate the email, then deliver a MINIMAL record to
 * every configured sink — Airtable and/or a generic webhook. Fire-and-forget:
 * never block the download on delivery. If a sink is missing or fails, log and
 * return 200 anyway. The user's process TEXT and the extracted model are NEVER
 * sent — only that they used the tool (email, company, process name, counts).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 4000;

type LeadPayload = {
  email: string;
  company?: string;
  processName: string;
  taskCount: number;
  laneCount: number;
  source: string;
};

async function timedFetch(
  url: string,
  init: Omit<RequestInit, "signal">,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Create one Airtable record. Never throws. Field names must match the table. */
async function toAirtable(lead: LeadPayload): Promise<boolean> {
  const key = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE_NAME;
  if (!key || !base || !table) return false;

  const res = await timedFetch(
    `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        typecast: true,
        fields: {
          Email: lead.email,
          Company: lead.company ?? "",
          "Process Name": lead.processName,
          "Task Count": lead.taskCount,
          "Lane Count": lead.laneCount,
          Source: lead.source,
        },
      }),
    },
  );

  if (res?.ok) return true;
  if (res) {
    const detail = await res.text().catch(() => "");
    console.error(`[/api/lead] Airtable ${res.status}: ${detail}`.slice(0, 400));
  } else {
    console.error("[/api/lead] Airtable request failed or timed out");
  }
  return false;
}

/** Forward to a generic webhook (Resend / CRM / Make). Never throws. */
async function toWebhook(lead: LeadPayload): Promise<boolean> {
  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (!webhook) return false;
  const res = await timedFetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lead),
  });
  if (!res?.ok) console.error("[/api/lead] webhook delivery failed");
  return Boolean(res?.ok);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  }

  // Explicit allow-list — no process text, no model, ever.
  const lead: LeadPayload = {
    email,
    company: typeof body.company === "string" && body.company ? body.company : undefined,
    processName: typeof body.processName === "string" ? body.processName : "",
    taskCount: Number(body.taskCount) || 0,
    laneCount: Number(body.laneCount) || 0,
    source: "process-map-generator",
  };

  track("lead_captured", { hasCompany: Boolean(lead.company) });

  // Deliver to every configured sink; NEVER fail the user's download on delivery.
  const [airtable, webhook] = await Promise.all([toAirtable(lead), toWebhook(lead)]);
  if (!airtable && !webhook) {
    console.info(
      `[/api/lead] captured ${email} (no AIRTABLE_* or LEAD_WEBHOOK_URL configured)`,
    );
  }

  return NextResponse.json({ ok: true });
}
