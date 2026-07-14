import Anthropic from "@anthropic-ai/sdk";
import type { SkillBundle } from "@/lib/skill/schema";

/** An LLM call: (systemPrompt, userMessage) → raw text response. */
export type LLM = (system: string, user: string) => Promise<string>;

/** Thrown when no extraction backend is available (no key, mock not opted in). */
export class NoModelError extends Error {
  constructor() {
    super("NO_MODEL");
    this.name = "NoModelError";
  }
}

const DEFAULT_MODEL = "claude-sonnet-5";
// Sonnet 5 emits a thinking block before its text answer, and thinking counts
// against max_tokens. A full 35-task model needs ~5k text tokens plus thinking,
// so budget generously — too small a limit truncates the JSON to empty and the
// extraction fails. (Haiku, which does not think, comfortably fits this too.)
const MAX_TOKENS = 24000;

/**
 * Choose the extraction backend:
 *  - a real Anthropic call when ANTHROPIC_API_KEY is set (the only path that
 *    produces a real extraction);
 *  - the deterministic offline mock ONLY when explicitly opted in via
 *    PMG_MOCK_EXTRACT=1 (for local UI dev and the concurrency test).
 *
 * The mock is a naive line-splitter — it does NOT understand the process and
 * must never masquerade as a real result. So with no key and no opt-in we throw
 * NoModelError rather than silently returning garbage. `isMock` lets the API
 * flag mock responses so the UI can warn the user.
 */
export function createLLM(skill: SkillBundle): { llm: LLM; isMock: boolean } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return { llm: realLLM(apiKey), isMock: false };
  if (process.env.PMG_MOCK_EXTRACT === "1" && process.env.NODE_ENV !== "production") {
    return { llm: mockLLM(skill), isMock: true };
  }
  throw new NoModelError();
}

function realLLM(apiKey: string): LLM {
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  return async (system, user) => {
    // Stream and collect the final message: the SDK requires streaming for
    // requests whose max_tokens could run past 10 minutes (Sonnet + a large
    // budget), and it avoids idle-connection timeouts. temperature is omitted —
    // the newest models deprecate it; JSON-only + schema validation give us the
    // determinism we need without it.
    const res = await client.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
    const out = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (process.env.PMG_DEBUG_EXTRACT === "1") {
      console.error(
        `[llm] model=${model} stop=${res.stop_reason} ` +
          `blocks=${res.content.map((b) => b.type).join(",")} textLen=${out.length} ` +
          `out=${res.usage.output_tokens}`,
      );
    }
    return out;
  };
}

/**
 * Deterministic, input-derived mock (opt-in dev/test only). It does NOT
 * understand the process — it just splits sentences into steps — so its output
 * is deliberately labelled as a demo and stripped of obvious markdown noise.
 */
export function mockLLM(skill: SkillBundle): LLM {
  return async (_system, user) => {
    const text = (user.match(/<process>\n([\s\S]*?)\n<\/process>/)?.[1] ?? user).trim();
    const pieces = text
      .split(/[\n.;]+/)
      .map((s) => s.trim())
      // drop markdown headings, table rows, separators, and bullets
      .filter((s) => s && !/^[#>|]|^[-*]{1,3}$|^[-|: ]+$/.test(s))
      .map((s) => s.replace(/^[-*\d.]+\s*/, "").replace(/\|/g, " ").trim())
      .filter(Boolean);
    const processName = "DEMO (mock — set ANTHROPIC_API_KEY for a real map)";
    const stepSource = pieces.slice(0, Math.min(6, skill.modeling.caps.maxTasks));
    const tasks =
      stepSource.length > 0
        ? stepSource.map((line, i) => ({
            id: `T${i + 1}`,
            name: line.slice(0, skill.modeling.labels.maxLabelChars),
            lane: "Team",
            system: null,
            document: null,
            next: i < stepSource.length - 1 ? `T${i + 2}` : null,
          }))
        : [
            {
              id: "T1",
              name: "Complete the process",
              lane: "Team",
              system: null,
              document: null,
              next: null,
            },
          ];
    const model = {
      processName,
      orgUnit: null,
      startEvent: "Start",
      lanes: ["Team"],
      tasks,
      decisions: [],
      endEvents: [
        { id: "E1", name: "Done", lane: "Team", from: tasks[tasks.length - 1].id },
      ],
      notes: [
        "This is the OFFLINE MOCK, not a real extraction. Set ANTHROPIC_API_KEY to map your process with Claude.",
      ],
    };
    return JSON.stringify(model);
  };
}
