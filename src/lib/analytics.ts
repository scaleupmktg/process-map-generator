/**
 * Analytics sink (PRD §15). Minimal in Phase 1 — used by the skill loader to
 * emit `skill_load_failed`. Expanded in Phase 8 so every event carries
 * `skillVersion`. Instrumentation must never throw into a user flow.
 */

export type AnalyticsEvent =
  | "tool_started"
  | "extraction_succeeded"
  | "extraction_failed"
  | "gate_shown"
  | "lead_captured"
  | "download_drawio"
  | "download_xlsx"
  | "cta_clicked"
  | "skill_load_failed";

export function track(
  event: AnalyticsEvent,
  props: Record<string, unknown> = {},
): void {
  try {
    const payload = { event, ...props };
    const url = process.env.ANALYTICS_WEBHOOK_URL;
    if (url) {
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } else if (process.env.NODE_ENV !== "test") {
      console.info("[analytics]", JSON.stringify(payload));
    }
  } catch {
    // never throw from analytics
  }
}
