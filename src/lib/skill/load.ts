import { readFile } from "node:fs/promises";
import path from "node:path";
import { SkillBundleSchema, type SkillBundle } from "./schema";
import { track } from "@/lib/analytics";

/**
 * loadSkill() — the only module that knows where the skill bundle comes from
 * (PRD §7 "Loading").
 *
 *  1. Default: read the committed copy in /skill. Always works, zero config.
 *  2. Override: if SKILL_BUNDLE_URL is set, fetch a single JSON bundle from
 *     there and cache it in memory for SKILL_CACHE_TTL seconds.
 *  3. Validate every bundle (local or remote) against SkillBundleSchema.
 *  4. Fail safe, never fail open: any remote error / timeout / bad JSON /
 *     schema failure logs, emits `skill_load_failed`, and falls back to the
 *     committed copy. A bad skill edit can never take the tool down.
 *
 * The returned bundle is threaded explicitly through extract/layout/render as a
 * parameter — there is no module-level singleton for request state. The only
 * module-level state here is the read-only TTL cache, which is required.
 */

const DEFAULT_TTL_S = 300;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const NEGATIVE_CACHE_MAX_S = 30;

type CacheEntry = { bundle: SkillBundle; expiresAt: number };

let activeCache: CacheEntry | null = null;
let bundledCache: SkillBundle | null = null;

export type LoadSkillOptions = {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
  /** Override the on-disk /skill directory (tests). */
  skillDir?: string;
  /** Override SKILL_BUNDLE_URL. `null` forces the bundled copy. */
  bundleUrl?: string | null;
  cacheTtlS?: number;
  timeoutMs?: number;
};

/** Read + validate the committed /skill copy. Always available. */
export async function loadBundledSkill(skillDir?: string): Promise<SkillBundle> {
  const dir = skillDir ?? path.join(process.cwd(), "skill");
  const [manifestRaw, modelingRaw, styleRaw, extraction] = await Promise.all([
    readFile(path.join(dir, "manifest.json"), "utf8"),
    readFile(path.join(dir, "modeling.json"), "utf8"),
    readFile(path.join(dir, "style.json"), "utf8"),
    readFile(path.join(dir, "extraction.md"), "utf8"),
  ]);
  return SkillBundleSchema.parse({
    manifest: JSON.parse(manifestRaw),
    modeling: JSON.parse(modelingRaw),
    style: JSON.parse(styleRaw),
    extraction,
  });
}

async function getBundled(opts: LoadSkillOptions): Promise<SkillBundle> {
  if (opts.skillDir) return loadBundledSkill(opts.skillDir);
  if (!bundledCache) bundledCache = await loadBundledSkill();
  return bundledCache;
}

export async function loadSkill(opts: LoadSkillOptions = {}): Promise<SkillBundle> {
  const bundleUrl =
    opts.bundleUrl !== undefined ? opts.bundleUrl : process.env.SKILL_BUNDLE_URL || null;

  if (!bundleUrl) return getBundled(opts);

  const now = opts.now ?? Date.now;
  if (activeCache && activeCache.expiresAt > now()) return activeCache.bundle;

  const ttlS =
    opts.cacheTtlS ?? (Number(process.env.SKILL_CACHE_TTL) || DEFAULT_TTL_S);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(bundleUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`remote bundle HTTP ${res.status}`);
    const json = await res.json();
    const bundle = SkillBundleSchema.parse(json);
    activeCache = { bundle, expiresAt: now() + ttlS * 1000 };
    return bundle;
  } catch (err) {
    track("skill_load_failed", {
      source: bundleUrl,
      reason: err instanceof Error ? err.message : String(err),
    });
    // Fail safe. Serve the last good bundle if we have one, else the committed
    // copy. Negative-cache briefly so a down remote isn't refetched per request.
    const fallback = activeCache?.bundle ?? (await getBundled(opts));
    activeCache = {
      bundle: fallback,
      expiresAt: now() + Math.min(ttlS, NEGATIVE_CACHE_MAX_S) * 1000,
    };
    return fallback;
  }
}

/** Test-only: clear the in-memory caches between cases. */
export function __resetSkillCache(): void {
  activeCache = null;
  bundledCache = null;
}
