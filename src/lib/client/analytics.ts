/**
 * Client-side analytics — fire-and-forget POST to /api/analytics (built in
 * Phase 8). Never throws into a user flow; failures are swallowed.
 */
export function trackClient(event: string, props: Record<string, unknown> = {}): void {
  try {
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, ...props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
