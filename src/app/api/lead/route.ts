import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBHOOK_TIMEOUT_MS = 4000;

/**
 * POST /api/lead (PRD §9). Validate the email, then forward a MINIMAL payload to
 * the configured webhook — fire-and-forget. Never block the download on the
 * webhook: if it's missing or fails, log and return 200 anyway. The user's
 * process text and extracted model are NEVER sent — only that they used the tool.
 */
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
  const payload = {
    email,
    company: typeof body.company === "string" && body.company ? body.company : undefined,
    processName: typeof body.processName === "string" ? body.processName : "",
    taskCount: Number(body.taskCount) || 0,
    laneCount: Number(body.laneCount) || 0,
    source: "process-map-generator",
  };

  track("lead_captured", { hasCompany: Boolean(payload.company) });

  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      // Never fail the user's download because the CRM is down.
      console.error("[/api/lead] webhook failed:", e instanceof Error ? e.message : e);
    }
  } else {
    console.info(`[/api/lead] captured ${email} (no LEAD_WEBHOOK_URL configured)`);
  }

  return NextResponse.json({ ok: true });
}
