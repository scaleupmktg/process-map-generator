"use client";
import { useEffect, useRef, useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (data: { email: string; company: string; consent: boolean }) => void;
  onClose: () => void;
};

export default function EmailGateModal({ open, submitting, error, onSubmit, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => emailRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const emailValid = EMAIL_RE.test(email);
  const canSubmit = emailValid && consent && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="gate-title" className="text-lg font-bold text-slate-900">
          Where should we send your files?
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Unlock both downloads — the .drawio diagram and the .xlsx register.
        </p>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (canSubmit) onSubmit({ email, company, consent });
          }}
        >
          <div>
            <label htmlFor="gate-email" className="mb-1 block text-sm font-medium text-slate-700">
              Work email
            </label>
            <input
              ref={emailRef}
              id="gate-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !emailValid}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              placeholder="you@company.com"
            />
            {touched && !emailValid && (
              <p className="mt-1 text-xs text-red-600">Enter a valid email address.</p>
            )}
          </div>

          <div>
            <label htmlFor="gate-company" className="mb-1 block text-sm font-medium text-slate-700">
              Company <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="gate-company"
              type="text"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              placeholder="Acme Co."
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              Email me my files and occasional systems tips from GrowThriveScale. Unsubscribe
              anytime.
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 inline-flex h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? "Sending…" : "Send me my files"}
          </button>

          <p className="text-center text-xs text-slate-400">
            We record that you used the tool — never your process text.
          </p>
        </form>
      </div>
    </div>
  );
}
