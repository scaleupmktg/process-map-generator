"use client";

import { useState } from "react";
import type { PreviewPage } from "@/lib/client/preview";

type ThemeOption = { name: string; label: string; swatch: string };

export default function PreviewPane({
  pages,
  processName,
  themeOptions,
  activeTheme,
  onTheme,
}: {
  pages: PreviewPage[];
  processName: string;
  themeOptions: ThemeOption[];
  activeTheme: string;
  onTheme: (name: string) => void;
}) {
  const [active, setActive] = useState(0);
  const page = pages[Math.min(active, pages.length - 1)];
  const multi = pages.length > 1;

  return (
    <section aria-label="Diagram preview" className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Diagram preview
      </h3>

      {/* Colour scheme picker */}
      {themeOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-xs font-semibold text-slate-600">Colour scheme:</span>
          <div role="group" aria-label="Colour scheme" className="flex flex-wrap gap-1.5">
            {themeOptions.map((t) => (
              <button
                key={t.name}
                type="button"
                aria-pressed={t.name === activeTheme}
                onClick={() => onTheme(t.name)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  t.name === activeTheme
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full border border-black/20"
                  style={{ backgroundColor: t.swatch }}
                />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Page tabs (multi-page maps only) */}
      {multi && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2.5">
          <span className="text-xs font-semibold text-slate-600">Page:</span>
          <div role="tablist" aria-label="Pages" className="flex flex-wrap gap-1.5">
            {pages.map((p, i) => (
              <button
                key={p.name + i}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  i === active
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
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
          ? "Each page is a tab in the downloaded .drawio, in the colour scheme you pick."
          : "The download uses the colour scheme you pick, and matches this preview exactly."}
      </p>
    </section>
  );
}
