import type { ProcessModel } from "./schema";

/**
 * Auto-repair (PRD §6 step 7) — NON-NEGOTIABLE. A broken graph produces a
 * broken diagram, which destroys the lead magnet. Runs after schema validation
 * (so shape + caps already hold) and guarantees a connected, renderable model:
 *
 *   - a lane not in lanes[] → reassign to the nearest preceding task's lane
 *     (or the first lane)
 *   - no end event → synthesise "End", fed by the last task
 *   - a dangling next / from / yes / no → repoint to the first end event
 *   - ensure at least one end event is reachable from the start
 *
 * Every repair appends a plain-language line to notes[] so nothing is silent to
 * anyone reading the register.
 */
export function repairModel(
  input: ProcessModel,
  opts: { maxPhases?: number } = {},
): ProcessModel {
  const model: ProcessModel = structuredClone(input);
  model.phases ??= []; // tolerate models parsed without the optional field
  const notes: string[] = [...model.notes];
  const laneSet = new Set(model.lanes);
  const firstLane = model.lanes[0];

  // ---- 1. reassign invalid lanes ------------------------------------------
  let reassigned = 0;
  let lastValidTaskLane = firstLane;
  for (const t of model.tasks) {
    if (laneSet.has(t.lane)) {
      lastValidTaskLane = t.lane;
    } else {
      t.lane = lastValidTaskLane;
      reassigned++;
    }
  }
  for (const node of [...model.decisions, ...model.endEvents]) {
    if (!laneSet.has(node.lane)) {
      node.lane = lastValidTaskLane;
      reassigned++;
    }
  }
  if (reassigned > 0) {
    notes.push(
      `Reassigned ${reassigned} step${reassigned > 1 ? "s" : ""} to a known lane ` +
        `(the stated owner was not in the lane list).`,
    );
  }

  // ---- 2. guarantee at least one end event --------------------------------
  if (model.endEvents.length === 0) {
    const lastTask = model.tasks[model.tasks.length - 1];
    model.endEvents.push({
      id: nextId("E", model),
      name: "End",
      lane: lastTask ? lastTask.lane : firstLane,
      from: lastTask ? lastTask.id : "",
    });
    notes.push("Added an end event (the description defined none).");
  }
  const firstEnd = model.endEvents[0];

  // ---- 3. repoint dangling references -------------------------------------
  const ids = new Set<string>([
    ...model.tasks.map((t) => t.id),
    ...model.decisions.map((d) => d.id),
    ...model.endEvents.map((e) => e.id),
  ]);
  let dangling = 0;
  const resolve = (ref: string): string => {
    if (ids.has(ref)) return ref;
    dangling++;
    return firstEnd.id;
  };
  for (const t of model.tasks) {
    if (t.next !== null && !ids.has(t.next)) t.next = resolve(t.next);
  }
  for (const d of model.decisions) {
    if (!ids.has(d.from)) d.from = resolve(d.from);
    if (!ids.has(d.yes)) d.yes = resolve(d.yes);
    if (!ids.has(d.no)) d.no = resolve(d.no);
  }
  for (const e of model.endEvents) {
    if (e.from !== "" && !ids.has(e.from)) e.from = resolve(e.from);
  }
  if (dangling > 0) {
    notes.push(
      `Re-routed ${dangling} broken connection${dangling > 1 ? "s" : ""} to the end of the process.`,
    );
  }

  // ---- 4. ensure the graph reaches an end from the start ------------------
  if (!reachesEnd(model)) {
    const anchor =
      lastReachableNode(model) ??
      model.tasks[model.tasks.length - 1]?.id ??
      "";
    if (anchor) {
      firstEnd.from = anchor;
      notes.push("Connected the flow to an end event so the map is complete.");
    }
  }

  // ---- 5. normalise optional phases (multi-page decomposition) -------------
  // Best-effort: keep only real task ids (first phase to claim a task wins),
  // give every task a phase, drop empties, trim to maxPhases, and collapse a
  // lone phase to "unphased" (nothing to decompose).
  if (model.phases.length > 0) {
    const taskIds = new Set(model.tasks.map((t) => t.id));
    const claimed = new Set<string>();
    for (const ph of model.phases) {
      ph.taskIds = ph.taskIds.filter((id) => taskIds.has(id) && !claimed.has(id));
      ph.taskIds.forEach((id) => claimed.add(id));
    }
    const phaseOf = new Map<string, string>();
    for (const ph of model.phases) for (const id of ph.taskIds) phaseOf.set(id, ph.id);
    if (phaseOf.size > 0) {
      let last = model.phases.find((p) => p.taskIds.length > 0)!.id;
      for (const t of model.tasks) {
        if (phaseOf.has(t.id)) {
          last = phaseOf.get(t.id)!;
        } else {
          model.phases.find((p) => p.id === last)!.taskIds.push(t.id);
          phaseOf.set(t.id, last);
        }
      }
    }
    model.phases = model.phases.filter((p) => p.taskIds.length > 0);
    const maxPhases = opts.maxPhases ?? model.phases.length;
    if (model.phases.length > maxPhases) {
      const kept = model.phases.slice(0, maxPhases);
      for (const ph of model.phases.slice(maxPhases)) {
        kept[kept.length - 1].taskIds.push(...ph.taskIds);
      }
      model.phases = kept;
    }
    if (model.phases.length < 2) model.phases = [];
  }

  model.notes = notes;
  return model;
}

function nextId(prefix: "T" | "D" | "E", model: ProcessModel): string {
  const pool =
    prefix === "T" ? model.tasks : prefix === "D" ? model.decisions : model.endEvents;
  let n = pool.length + 1;
  const existing = new Set(pool.map((x) => x.id));
  while (existing.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Forward adjacency, mirroring the layout engine's flow. */
function adjacency(model: ProcessModel): Map<string, string[]> {
  const ids = new Set<string>([
    ...model.tasks.map((t) => t.id),
    ...model.decisions.map((d) => d.id),
    ...model.endEvents.map((e) => e.id),
  ]);
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!ids.has(b)) return;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  };
  for (const t of model.tasks) {
    if (t.next) link(t.id, t.next);
    for (const d of model.decisions) if (d.from === t.id) link(t.id, d.id);
    for (const e of model.endEvents) if (e.from === t.id) link(t.id, e.id);
  }
  for (const d of model.decisions) {
    link(d.id, d.yes);
    link(d.id, d.no);
    for (const e of model.endEvents) if (e.from === d.id) link(d.id, e.id);
  }
  return adj;
}

function entryTaskId(model: ProcessModel): string | null {
  const targeted = new Set<string>();
  for (const t of model.tasks) if (t.next) targeted.add(t.next);
  for (const d of model.decisions) {
    targeted.add(d.yes);
    targeted.add(d.no);
  }
  const entry = model.tasks.find((t) => !targeted.has(t.id)) ?? model.tasks[0];
  return entry ? entry.id : null;
}

function reachesEnd(model: ProcessModel): boolean {
  const start = entryTaskId(model);
  if (!start) return false;
  const endIds = new Set(model.endEvents.map((e) => e.id));
  const adj = adjacency(model);
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (endIds.has(id)) return true;
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) {
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/** The last task/decision reachable from the entry (to anchor an end event). */
function lastReachableNode(model: ProcessModel): string | null {
  const start = entryTaskId(model);
  if (!start) return null;
  const adj = adjacency(model);
  const seen = new Set<string>([start]);
  const stack = [start];
  let last: string | null = start;
  while (stack.length) {
    const id = stack.pop()!;
    last = id;
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) {
      seen.add(next);
      stack.push(next);
    }
  }
  return last;
}
