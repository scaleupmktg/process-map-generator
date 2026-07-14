"use client";

export default function PreviewPane({
  dataUri,
  processName,
}: {
  dataUri: string;
  processName: string;
}) {
  return (
    <section aria-label="Diagram preview" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Diagram preview
      </h3>
      <div className="pmg-preview max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element -- inert data-URI SVG; next/image can't optimise it */}
        <img
          src={dataUri}
          className="mx-auto h-auto max-w-full"
          alt={`Swimlane process map for ${processName}. The extraction summary is the full text alternative.`}
        />
      </div>
      <p className="text-xs text-slate-400">
        The downloaded diagram matches this preview exactly.
      </p>
    </section>
  );
}
