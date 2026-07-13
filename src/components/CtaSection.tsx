"use client";

export default function CtaSection({
  bookingUrl,
  onClick,
}: {
  bookingUrl: string;
  onClick?: () => void;
}) {
  return (
    <section className="rounded-2xl bg-slate-900 p-6 text-center sm:p-8">
      <h2 className="text-xl font-bold text-white sm:text-2xl">
        This mapped what you told us.
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-slate-300">
        We map what your systems actually did — the real process, from the evidence, not the
        version in the handbook.
      </p>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-emerald-500 px-6 text-base font-semibold text-white transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        Book a free consultation
      </a>
    </section>
  );
}
