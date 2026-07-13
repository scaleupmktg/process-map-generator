"use client";
import { useEffect, useState } from "react";

const STAGES = [
  "Reading your process…",
  "Identifying roles and lanes…",
  "Mapping steps and decisions…",
  "Building your diagram…",
];

/** A real staged progress state (not an indeterminate spinner) — PRD §10. */
export default function ProgressStages() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, STAGES.length - 1)), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="mx-auto flex max-w-xl flex-col items-center gap-6 py-16 text-center"
      aria-live="polite"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      <div>
        <p className="text-lg font-medium text-slate-900">{STAGES[i]}</p>
        <p className="mt-1 text-sm text-slate-500">This usually takes 5–15 seconds.</p>
      </div>
      <ol className="flex flex-wrap items-center justify-center gap-2">
        {STAGES.map((s, n) => (
          <li
            key={s}
            className={`h-1.5 w-10 rounded-full transition-colors ${
              n <= i ? "bg-emerald-500" : "bg-slate-200"
            }`}
          />
        ))}
      </ol>
    </div>
  );
}
