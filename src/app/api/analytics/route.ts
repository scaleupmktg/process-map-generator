import { NextResponse } from "next/server";
import { track, type AnalyticsEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN: ReadonlySet<string> = new Set<AnalyticsEvent>([
  "tool_started",
  "extraction_succeeded",
  "extraction_failed",
  "gate_shown",
  "lead_captured",
  "download_drawio",
  "download_xlsx",
  "cta_clicked",
  "skill_load_failed",
]);

/**
 * POST /api/analytics — relay client funnel events to the server-side sink
 * (PRD §15). Fire-and-forget from the client; always 200.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const event = typeof body?.event === "string" ? body.event : "";
    if (KNOWN.has(event)) {
      const props: Record<string, unknown> = { ...body };
      delete props.event;
      track(event as AnalyticsEvent, props);
    }
  } catch {
    // ignore malformed beacons
  }
  return NextResponse.json({ ok: true });
}
