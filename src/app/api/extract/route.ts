import { NextResponse } from "next/server";
import { loadSkill } from "@/lib/skill/load";
import { toClientSkill, type SkillBundle } from "@/lib/skill/schema";
import { createLLM } from "@/lib/extract/llm";
import {
  extractProcessModel,
  validateInputLength,
  ExtractionError,
  type ExtractionCode,
} from "@/lib/extract/extract";
import { repairModel } from "@/lib/model/repair";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";
import { track } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorCode = ExtractionCode | "RATE_LIMITED" | "BAD_REQUEST" | "SERVER_ERROR";

/** User-facing copy (PRD §11). Any limit is interpolated from the skill. */
function userMessage(code: ErrorCode, skill: SkillBundle | null): string {
  const max = (skill?.modeling.caps.maxInputChars ?? 6000).toLocaleString();
  switch (code) {
    case "TOO_SHORT":
      return "Add a bit more detail — we need at least a few steps to map.";
    case "TOO_LONG":
      return `That's longer than this tool handles. Trim to the core end-to-end process (about ${max} characters).`;
    case "RATE_LIMITED":
      return "You've hit the limit for this hour. Come back later — or talk to us about mapping the whole thing properly.";
    case "EXTRACTION_FAILED":
      return "We couldn't find a clear sequence of steps. Try describing it as: who does what, in what order, and where the decisions are.";
    case "BAD_REQUEST":
      return "Send a process description as { text }.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

function fail(code: ErrorCode, status: number, skill: SkillBundle | null) {
  return NextResponse.json(
    { ok: false, code, error: userMessage(code, skill) },
    { status },
  );
}

export async function POST(req: Request) {
  let skill: SkillBundle | null = null;
  try {
    // 1. Rate limit by IP.
    const ip = clientIp(req.headers);
    const rate = await checkRateLimit(ip);
    if (!rate.success) {
      track("extraction_failed", { code: "RATE_LIMITED" });
      return fail("RATE_LIMITED", 429, null);
    }

    // 2. Parse body.
    let text: string;
    try {
      const body = await req.json();
      text = typeof body?.text === "string" ? body.text : "";
    } catch {
      return fail("BAD_REQUEST", 400, null);
    }

    // 3. Skill bundle (fail-safe: always returns at least the bundled copy).
    skill = await loadSkill();

    // 4. Length caps.
    try {
      validateInputLength(text, skill);
    } catch (e) {
      if (e instanceof ExtractionError) {
        track("extraction_failed", { code: e.code, skillVersion: skill.manifest.version });
        return fail(e.code, 400, skill);
      }
      throw e;
    }

    // 5. Extract (retry-once inside) then auto-repair.
    const llm = createLLM(skill);
    const { model, usedRetry } = await extractProcessModel(text, skill, llm);
    const repaired = repairModel(model);

    track("extraction_succeeded", {
      taskCount: repaired.tasks.length,
      laneCount: repaired.lanes.length,
      decisionCount: repaired.decisions.length,
      usedRetry,
      skillVersion: skill.manifest.version,
    });

    return NextResponse.json({ ok: true, model: repaired, skill: toClientSkill(skill) });
  } catch (e) {
    if (e instanceof ExtractionError) {
      track("extraction_failed", {
        code: e.code,
        skillVersion: skill?.manifest.version,
      });
      return fail(e.code, 422, skill);
    }
    console.error("[/api/extract] unexpected error:", e);
    track("extraction_failed", { code: "SERVER_ERROR" });
    return fail("SERVER_ERROR", 500, skill);
  }
}
