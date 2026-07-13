"use client";

export default function DownloadButtons({
  onDrawio,
  onXlsx,
  busy,
}: {
  onDrawio: () => void;
  onXlsx: () => void;
  busy: "drawio" | "xlsx" | null;
}) {
  const base =
    "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-70";
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onDrawio}
        disabled={busy !== null}
        className={`${base} bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        <span aria-hidden>⬇</span>
        {busy === "drawio" ? "Preparing…" : "Download .drawio diagram"}
      </button>
      <button
        type="button"
        onClick={onXlsx}
        disabled={busy !== null}
        className={`${base} border border-emerald-600 bg-white text-emerald-700 hover:bg-emerald-50`}
      >
        <span aria-hidden>⬇</span>
        {busy === "xlsx" ? "Preparing…" : "Download .xlsx register"}
      </button>
    </div>
  );
}
