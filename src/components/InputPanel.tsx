"use client";
import { useRef, useState } from "react";
import Banner from "./Banner";

const EXAMPLE = `Example: A customer submits a support request through our portal. The support agent reviews it and checks whether the product is under warranty. If it is, they create a repair order in Zendesk and notify the customer. If it isn't, they send a paid quote and wait for approval. Once approved, the workshop schedules the repair, completes it, and updates the order. Finally the agent confirms completion with the customer and closes the ticket.`;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onGenerate: () => void;
  onFile: (file: File) => void;
  loading: boolean;
  minInputChars: number;
  maxInputChars: number;
  error: string | null;
  uploadNote: string | null;
};

export default function InputPanel({
  value,
  onChange,
  onGenerate,
  onFile,
  loading,
  minInputChars,
  maxInputChars,
  error,
  uploadNote,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const len = value.length;
  const over = len > maxInputChars;
  const tooShort = value.trim().length < minInputChars;
  const canGenerate = !loading && !over && !tooShort;

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="error">{error}</Banner>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`rounded-xl border-2 border-dashed p-1 transition-colors ${
          dragging ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
        }`}
      >
        <label htmlFor="process-text" className="sr-only">
          Process description
        </label>
        <textarea
          id="process-text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={EXAMPLE}
          rows={10}
          spellCheck
          className="block w-full resize-y rounded-lg bg-transparent p-4 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <span aria-hidden>📄</span> Upload a file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.docx,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
              e.target.value = "";
            }}
          />
          <span className="text-slate-400">or drag &amp; drop · .txt .md .docx .pdf</span>
        </div>
        <span className={over ? "font-medium text-red-600" : "text-slate-400"}>
          {len.toLocaleString()} / {maxInputChars.toLocaleString()}
        </span>
      </div>

      <p className="group relative flex w-fit items-center gap-1.5 text-xs text-slate-500">
        <span
          aria-hidden
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
        >
          i
        </span>
        Messy or complex process?
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-72 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        >
          If your process is complex or a bit disorganised, paste it into ChatGPT or Claude
          first and ask it to reorganise into clear numbered steps — who does what, in what
          order, and where the decisions are. You&apos;ll get a much cleaner map.
        </span>
      </p>

      {uploadNote && <Banner tone="info">{uploadNote}</Banner>}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-emerald-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Generate my process map
        </button>
        <p className="text-center text-xs text-slate-500">
          Your process text is never stored on our servers. No account needed.
        </p>
      </div>
    </div>
  );
}
