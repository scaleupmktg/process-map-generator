"use client";

import { useState } from "react";
import type { PreviewPage } from "@/lib/client/preview";

export default function PreviewPane({
  pages,
  processName,
}: {
  pages: PreviewPage[];
  processName: string;
}) {
  const [active, setActive] = useState(0);
  const page = pages[Math.min(active, pages.length - 1)];
  const multi = pages.length > 1;

  return (
    <section aria-label="Diagram preview" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Diagram preview
      </h3>

      {multi && (
        <div role="tablist" aria-label="Pages" className="flex flex-wrap gap-1.5">
          {pages.map((p, i) => (
            <button
              key={p.name + i}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                i === active
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="pmg-preview max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- inert data-URI SVG; next/image can't optimise it */}
        <img
          src={page.dataUri}
          className="mx-auto h-auto max-w-full"
          alt={
            multi
              ? `Page "${page.name}" of the ${processName} process map. The extraction summary is the full text alternative.`
              : `Swimlane process map for ${processName}. The extraction summary is the full text alternative.`
          }
        />
      </div>
      <p className="text-xs text-slate-400">
        {multi
          ? "Each page is a tab in the downloaded .drawio, and matches this preview exactly."
          : "The downloaded diagram matches this preview exactly."}
      </p>
    </section>
  );
}
