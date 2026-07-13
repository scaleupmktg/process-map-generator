import { loadSkill } from "@/lib/skill/load";
import ProcessMapApp from "@/components/ProcessMapApp";

export default async function Page() {
  // Server-side: gives the input UI the live caps before any extraction.
  const skill = await loadSkill();
  const site = skill.style.branding.site;
  const company = skill.style.branding.company;
  const bookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL || `https://${site}`;

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a href={`https://${site}`} className="font-bold tracking-tight text-slate-900">
            Grow<span className="text-emerald-600">Thrive</span>Scale
          </a>
          <span className="text-sm text-slate-500">Free Process Map Generator</span>
        </div>
      </header>

      <main className="flex-1">
        <ProcessMapApp
          minInputChars={skill.modeling.caps.minInputChars}
          maxInputChars={skill.modeling.caps.maxInputChars}
          bookingUrl={bookingUrl}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row">
          <p>Your process text is never stored on our servers.</p>
          <p>
            Built by{" "}
            <a
              href={`https://${site}`}
              className="font-medium text-slate-700 hover:text-emerald-700"
            >
              {company}
            </a>{" "}
            · {site}
          </p>
        </div>
      </footer>
    </>
  );
}
