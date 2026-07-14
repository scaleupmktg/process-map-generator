import { z } from "zod";
import type { Modeling } from "@/lib/skill/schema";

/**
 * ProcessModel — the single source of truth (PRD §5). Both exporters and the
 * preview render from this one object.
 *
 * Design of the validation boundary (important):
 *  - The HARD schema validates SHAPE, field types, and ARRAY-COUNT CAPS. The
 *    caps come from modeling.json, so changing `maxTasks` there changes both
 *    the prompt (interpolation) and the validation with no code edit (PRD §5,
 *    §16). A count overflow fails validation → retry-once → 422.
 *  - REFERENTIAL integrity (a `lane` not in `lanes[]`, a dangling `next`/`from`/
 *    `yes`/`no`, zero end events, disconnected graph) is deliberately NOT
 *    rejected here — it is fixed silently by auto-repair (PRD §6 step 7). If the
 *    schema rejected those, repair could never run and a fixable model would
 *    404 the user. `endEvents` min is therefore 0 (repair synthesises one).
 */

export const TaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  lane: z.string().min(1),
  system: z.string().trim().min(1).nullable().catch(null),
  document: z.string().trim().min(1).nullable().catch(null),
  next: z.string().min(1).nullable().catch(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const DecisionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  lane: z.string().min(1),
  from: z.string().min(1),
  yes: z.string().min(1),
  no: z.string().min(1),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const EndEventSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  lane: z.string().min(1),
  from: z.string().min(1),
});
export type EndEvent = z.infer<typeof EndEventSchema>;

/**
 * Optional phase grouping (for multi-page sub-process decomposition). Ordered;
 * each phase owns the ids of the tasks in it. Decisions/end events inherit the
 * phase of the task they flow from. Enrichment only — a model with no phases (or
 * one phase) renders as a single page, exactly as before.
 */
export const PhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  taskIds: z.array(z.string().min(1)).default([]),
});
export type Phase = z.infer<typeof PhaseSchema>;

/** Static schema (permissive caps) used purely to derive the TS type. */
export const ProcessModelSchema = z.object({
  processName: z.string().trim().min(1),
  orgUnit: z.string().trim().min(1).nullable().catch(null),
  startEvent: z.string().min(1).catch("Start"),
  lanes: z.array(z.string().trim().min(1)),
  tasks: z.array(TaskSchema),
  decisions: z.array(DecisionSchema),
  endEvents: z.array(EndEventSchema),
  phases: z.array(PhaseSchema).catch([]),
  notes: z.array(z.string()).catch([]),
});
export type ProcessModel = z.infer<typeof ProcessModelSchema>;

/**
 * Build the caps-aware validation schema from modeling.json. This is what
 * `/api/extract` validates the LLM output against.
 */
export function makeProcessModelSchema(modeling: Modeling) {
  const { caps } = modeling;
  return z
    .object({
      processName: z.string().trim().min(1),
      orgUnit: z.string().trim().min(1).nullable().catch(null),
      startEvent: z.string().min(1).catch("Start"),
      lanes: z.array(z.string().trim().min(1)).min(1).max(caps.maxLanes),
      tasks: z.array(TaskSchema).min(1).max(caps.maxTasks),
      decisions: z.array(DecisionSchema).max(caps.maxDecisions),
      // Lenient min: repair synthesises an end event if there are none.
      endEvents: z.array(EndEventSchema).max(caps.maxEndEvents),
      // Phases are best-effort enrichment — never fail extraction over them;
      // repair normalises and trims to maxPhases.
      phases: z.array(PhaseSchema).catch([]),
      notes: z.array(z.string()).catch([]),
    })
    .superRefine((model, ctx) => {
      // Node ids must be unique — every reference (next/from/yes/no) resolves by
      // id, so duplicates make references ambiguous and can't be safely repaired.
      const seen = new Set<string>();
      const dup = new Set<string>();
      for (const n of [...model.tasks, ...model.decisions, ...model.endEvents]) {
        if (seen.has(n.id)) dup.add(n.id);
        seen.add(n.id);
      }
      if (dup.size > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate node ids: ${[...dup].join(
            ", ",
          )}. Every task, decision, and end-event id must be unique.`,
        });
      }
    });
}

/** Compact, LLM-friendly description of validation failures for the retry prompt. */
export function describeModelIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `- ${path}: ${i.message}`;
    })
    .join("\n");
}
