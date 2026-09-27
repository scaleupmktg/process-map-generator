import type { ProcessModel } from "@/lib/model/schema";
import { repairModel } from "@/lib/model/repair";

/**
 * Deterministic random process models for fuzzing the layout + router.
 * Produces valid, connected models with loop-backs, forward skips, multiple
 * end events and (optionally) phases — the shapes that stress edge routing.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomModel(
  seed: number,
  opts: { maxLanes?: number; maxTasks?: number; phased?: boolean } = {},
): ProcessModel {
  const rand = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const nLanes = int(1, opts.maxLanes ?? 8);
  const lanes = Array.from({ length: nLanes }, (_, i) => `Role ${String.fromCharCode(65 + i)}`);
  const nTasks = int(3, opts.maxTasks ?? 24);

  let lane = int(0, nLanes - 1);
  const tasks: ProcessModel["tasks"] = Array.from({ length: nTasks }, (_, i) => {
    if (rand() > 0.55) lane = int(0, nLanes - 1); // some locality, some hand-offs
    return {
      id: `T${i + 1}`,
      name: `Step ${i + 1} of the process`,
      lane: lanes[lane],
      system: null,
      document: null,
      next: i < nTasks - 1 ? `T${i + 2}` : null,
    };
  });

  const endEvents: ProcessModel["endEvents"] = [
    { id: "E1", name: "Done", lane: tasks[nTasks - 1].lane, from: `T${nTasks}` },
  ];

  const decisions: ProcessModel["decisions"] = [];
  const nDec = int(0, Math.min(10, Math.floor(nTasks / 2)));
  const used = new Set<number>();
  for (let k = 0; k < nDec; k++) {
    const i = int(0, nTasks - 2); // feeding task index (never the last)
    if (used.has(i)) continue;
    used.add(i);
    const feeder = tasks[i];
    feeder.next = null;
    const id = `D${decisions.length + 1}`;
    const r = rand();
    let no: string;
    if (r < 0.4) {
      no = `T${int(1, i + 1)}`; // loop back (rework)
    } else if (r < 0.7 && i + 3 <= nTasks) {
      no = `T${int(i + 3, nTasks)}`; // skip forward
    } else if (endEvents.length < 5) {
      const eid = `E${endEvents.length + 1}`;
      endEvents.push({ id: eid, name: `Stopped ${eid}`, lane: lanes[int(0, nLanes - 1)], from: id });
      no = eid;
    } else {
      no = `T${int(1, i + 1)}`;
    }
    decisions.push({
      id,
      name: `Check ${k + 1}?`,
      lane: rand() < 0.7 ? feeder.lane : lanes[int(0, nLanes - 1)],
      from: feeder.id,
      yes: `T${i + 2}`,
      no,
    });
  }

  const phases: ProcessModel["phases"] = [];
  if (opts.phased ?? rand() < 0.3) {
    const k = int(2, Math.min(6, Math.max(2, Math.floor(nTasks / 3))));
    const size = Math.ceil(nTasks / k);
    for (let p = 0; p < k; p++) {
      const ids = tasks.slice(p * size, (p + 1) * size).map((t) => t.id);
      if (ids.length) phases.push({ id: `P${p + 1}`, name: `Phase ${p + 1}`, taskIds: ids });
    }
  }

  return repairModel(
    {
      processName: `Random process ${seed}`,
      orgUnit: null,
      startEvent: "Start",
      lanes,
      tasks,
      decisions,
      endEvents,
      phases,
      notes: [],
    },
    { maxPhases: 8 },
  );
}
