import {
  makeProcessModelSchema,
  describeModelIssues,
  type ProcessModel,
} from "@/lib/model/schema";
import type { SkillBundle } from "@/lib/skill/schema";
import { buildSystemPrompt, buildUserMessage, buildRetryMessage, extractJson } from "./prompt";
import type { LLM } from "./llm";

export type ExtractionCode = "TOO_SHORT" | "TOO_LONG" | "EXTRACTION_FAILED";

export class ExtractionError extends Error {
  code: ExtractionCode;
  detail?: string;
  constructor(code: ExtractionCode, detail?: string) {
    super(code);
    this.name = "ExtractionError";
    this.code = code;
    this.detail = detail;
  }
}

/** Enforce the input caps from modeling.json (PRD §6 step 2). */
export function validateInputLength(text: string, skill: SkillBundle): void {
  const { minInputChars, maxInputChars } = skill.modeling.caps;
  const len = text.trim().length;
  if (len < minInputChars) throw new ExtractionError("TOO_SHORT");
  if (text.length > maxInputChars) throw new ExtractionError("TOO_LONG");
}

/**
 * Call the LLM, validate against the caps-aware schema, and retry exactly once
 * with the validation errors appended (PRD §6 steps 3–6). Returns the validated
 * (pre-repair) model. Throws ExtractionError("EXTRACTION_FAILED") after a second
 * failure. Auto-repair is applied by the caller, after this returns.
 */
export async function extractProcessModel(
  text: string,
  skill: SkillBundle,
  llm: LLM,
): Promise<{ model: ProcessModel; usedRetry: boolean }> {
  const schema = makeProcessModelSchema(skill.modeling);
  const system = buildSystemPrompt(skill);

  const first = await llm(system, buildUserMessage(text));
  const firstParsed = schema.safeParse(extractJson(first));
  if (firstParsed.success) {
    return { model: firstParsed.data as ProcessModel, usedRetry: false };
  }

  const errors = describeModelIssues(firstParsed.error);
  const second = await llm(system, buildRetryMessage(text, errors));
  const secondParsed = schema.safeParse(extractJson(second));
  if (secondParsed.success) {
    return { model: secondParsed.data as ProcessModel, usedRetry: true };
  }

  throw new ExtractionError("EXTRACTION_FAILED", describeModelIssues(secondParsed.error));
}
