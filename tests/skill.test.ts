import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSkill,
  loadBundledSkill,
  __resetSkillCache,
} from "@/lib/skill/load";
import { SkillBundleSchema, type SkillBundle } from "@/lib/skill/schema";

/** A fetch stub that returns `payload` and counts invocations. */
function stubFetch(opts: {
  ok?: boolean;
  status?: number;
  json?: () => unknown;
  throwOnJson?: boolean;
}) {
  const state = { calls: 0 };
  const impl = (async () => {
    state.calls++;
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => {
        if (opts.throwOnJson) throw new Error("invalid json");
        return opts.json ? opts.json() : {};
      },
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, state };
}

describe("loadBundledSkill", () => {
  it("reads and validates the committed /skill copy", async () => {
    const skill = await loadBundledSkill();
    expect(() => SkillBundleSchema.parse(skill)).not.toThrow();
    expect(skill.manifest.version).toBe("1.2.0");
    expect(skill.modeling.caps.maxTasks).toBe(35);
    expect(skill.style.palette.task.fill).toMatch(/^#/);
    expect(skill.extraction.length).toBeGreaterThan(200);
  });
});

describe("loadSkill remote override + fail-safe fallback", () => {
  let bundled: SkillBundle;
  let remote: SkillBundle;

  beforeEach(async () => {
    __resetSkillCache();
    bundled = await loadBundledSkill();
    remote = structuredClone(bundled);
    remote.manifest.version = "9.9.9"; // distinguishes remote from bundled
  });

  it("returns the bundled copy when no SKILL_BUNDLE_URL is configured", async () => {
    const { impl, state } = stubFetch({ json: () => remote });
    const skill = await loadSkill({ bundleUrl: null, fetchImpl: impl });
    expect(skill.manifest.version).toBe(bundled.manifest.version);
    expect(state.calls).toBe(0);
  });

  it("fetches and validates a good remote bundle", async () => {
    const { impl, state } = stubFetch({ json: () => remote });
    const skill = await loadSkill({
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
    });
    expect(skill.manifest.version).toBe("9.9.9");
    expect(state.calls).toBe(1);
  });

  it("caches the remote bundle for the TTL (one fetch across calls)", async () => {
    const { impl, state } = stubFetch({ json: () => remote });
    let t = 1_000_000;
    const now = () => t;
    const opts = {
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
      cacheTtlS: 300,
      now,
    };
    await loadSkill(opts);
    t += 100_000; // +100s, within TTL
    const second = await loadSkill(opts);
    expect(second.manifest.version).toBe("9.9.9");
    expect(state.calls).toBe(1);
  });

  it("falls back to the bundled copy on an HTTP error", async () => {
    const { impl } = stubFetch({ ok: false, status: 500 });
    const skill = await loadSkill({
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
    });
    expect(skill.manifest.version).toBe(bundled.manifest.version);
  });

  it("falls back to the bundled copy on unparseable JSON", async () => {
    const { impl } = stubFetch({ throwOnJson: true });
    const skill = await loadSkill({
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
    });
    expect(skill.manifest.version).toBe(bundled.manifest.version);
  });

  it("falls back to the bundled copy on a schema-invalid remote bundle", async () => {
    const broken = structuredClone(remote) as Record<string, unknown>;
    delete (broken.manifest as Record<string, unknown>).version;
    const { impl } = stubFetch({ json: () => broken });
    const skill = await loadSkill({
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
    });
    expect(skill.manifest.version).toBe(bundled.manifest.version);
  });

  it("negative-caches a failing remote so it is not refetched every call", async () => {
    const { impl, state } = stubFetch({ ok: false, status: 503 });
    let t = 2_000_000;
    const now = () => t;
    const opts = {
      bundleUrl: "https://example.com/bundle.json",
      fetchImpl: impl,
      cacheTtlS: 300,
      now,
    };
    const a = await loadSkill(opts);
    t += 5_000; // +5s, within the 30s negative-cache window
    const b = await loadSkill(opts);
    expect(a.manifest.version).toBe(bundled.manifest.version);
    expect(b.manifest.version).toBe(bundled.manifest.version);
    expect(state.calls).toBe(1);
  });
});
