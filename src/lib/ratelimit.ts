import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * IP rate limiting (PRD §6.1, §10). Uses Upstash Redis when configured — the
 * only stateful component, holding nothing but IP counters. Without Upstash env
 * vars it falls back to an in-memory per-instance limiter (dev only; not durable
 * across serverless invocations) and logs a one-time warning.
 */

export type RateResult = { success: boolean; remaining: number; limit: number; resetMs: number };

const LIMIT = Number(process.env.RATE_LIMIT_MAX) || 5;
const WINDOW_S = Number(process.env.RATE_LIMIT_WINDOW_S) || 3600;

let upstash: Ratelimit | null = null;
let warnedInMemory = false;
const memory = new Map<string, { count: number; resetAt: number }>();

function getUpstash(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!upstash) {
    upstash = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(LIMIT, `${WINDOW_S} s`),
      prefix: "pmg-extract",
      analytics: false,
    });
  }
  return upstash;
}

export async function checkRateLimit(ip: string, now = Date.now): Promise<RateResult> {
  const rl = getUpstash();
  if (rl) {
    const res = await rl.limit(ip);
    return {
      success: res.success,
      remaining: res.remaining,
      limit: res.limit,
      resetMs: res.reset,
    };
  }

  if (!warnedInMemory && process.env.NODE_ENV !== "test") {
    warnedInMemory = true;
    console.warn(
      "[ratelimit] Upstash not configured — using in-memory limiter (dev only).",
    );
  }
  const t = now();
  const entry = memory.get(ip);
  if (!entry || t > entry.resetAt) {
    const resetAt = t + WINDOW_S * 1000;
    memory.set(ip, { count: 1, resetAt });
    return { success: true, remaining: LIMIT - 1, limit: LIMIT, resetMs: resetAt };
  }
  entry.count++;
  const success = entry.count <= LIMIT;
  return {
    success,
    remaining: Math.max(0, LIMIT - entry.count),
    limit: LIMIT,
    resetMs: entry.resetAt,
  };
}

/** First hop of X-Forwarded-For, else a fallback key. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test-only: clear the in-memory counters. */
export function __resetRateLimit(): void {
  memory.clear();
}
