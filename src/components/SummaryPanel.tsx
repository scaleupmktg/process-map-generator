"use client";
import type { ProcessModel } from "@/lib/model/schema";

function useLabels(model: ProcessModel): (id: string) => string {
  const map = new Map<string, string>();
  map.set("__start__", model.startEvent || "Start");
  for (const t of model.tasks) map.set(t.id, t.name);
  for (const d of model.decisions) map.set(d.id, d.name);
  for (const e of model.endEvents) map.set(e.id, e.name);
  return (id: string) => map.get(id) ?? id;
}

export default function SummaryPanel({
  model,
  onEdit,
}: {
  model: ProcessModel;
  onEdit: () => void;
}) {
  const label = useLabels(model);

  return (
    <section aria-label="Extraction summary" className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          Here&apos;s what we extracted
        </p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">{model.processName}</h2>
        {model.orgUnit && <p className="text-sm text-slate-500">{model.orgUnit}</p>}
      </header>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Lanes
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {model.lanes.map((l) => (
            <span
              key={l}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {l}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tasks
        </h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Task</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">System</th>
                <th className="px-3 py-2 font-semibold">Doc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {model.tasks.map((t, i) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
                  <td className="px-3 py-2 text-slate-600">{t.lane}</td>
                  <td className="px-3 py-2 text-slate-500">{t.system ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{t.document ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {model.decisions.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Decisions
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {model.decisions.map((d) => (
              <li key={d.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-medium text-slate-800">{d.name}</span>
                <span className="text-slate-500">
                  {" "}
                  — yes → {label(d.yes)} · no → {label(d.no)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-slate-500">Start:</span>{" "}
          <span className="font-medium text-slate-800">{model.startEvent}</span>
        </span>
        <span>
          <span className="text-slate-500">Ends:</span>{" "}
          <span className="font-medium text-slate-800">
            {model.endEvents.map((e) => e.name).join(" · ")}
          </span>
        </span>
      </div>

      {model.notes.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            What we assumed ({model.notes.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
            {model.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-sm text-slate-500">
        Not quite right?{" "}
        <button
          type="button"
          onClick={onEdit}
          className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
        >
          Refine your description and re-run
        </button>
        .
      </p>
    </section>
  );
}
