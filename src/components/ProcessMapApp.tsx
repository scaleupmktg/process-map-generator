"use client";
import { useEffect, useMemo, useState } from "react";
import type { ProcessModel } from "@/lib/model/schema";
import type { ClientSkill } from "@/lib/skill/schema";
import { buildPreview } from "@/lib/client/preview";
import { downloadDrawio, downloadXlsx } from "@/lib/client/download";
import { trackClient } from "@/lib/client/analytics";
import { parseFile, FileParseError } from "@/lib/client/parseFile";
import InputPanel from "./InputPanel";
import ProgressStages from "./ProgressStages";
import SummaryPanel from "./SummaryPanel";
import PreviewPane from "./PreviewPane";
import DownloadButtons from "./DownloadButtons";
import EmailGateModal from "./EmailGateModal";
import CtaSection from "./CtaSection";
import Banner from "./Banner";

const UNLOCK_KEY = "pmg-unlocked";

type Stage = "input" | "loading" | "result";
type DownloadKind = "drawio" | "xlsx";

function fileErrorMessage(e: unknown): string {
  if (e instanceof FileParseError) {
    if (e.code === "SCANNED_PDF")
      return "This PDF has no selectable text. Paste the process description instead.";
    if (e.code === "EMPTY") return "We couldn't find any text in that file.";
    return "Upload a .txt, .md, .docx or .pdf — or just paste the text.";
  }
  return "We couldn't read that file. Paste the text instead.";
}

export default function ProcessMapApp({
  minInputChars,
  maxInputChars,
  bookingUrl,
}: {
  minInputChars: number;
  maxInputChars: number;
  bookingUrl: string;
}) {
  const [stage, setStage] = useState<Stage>("input");
  const [text, setText] = useState("");
  const [model, setModel] = useState<ProcessModel | null>(null);
  const [skill, setSkill] = useState<ClientSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);

  const [unlocked, setUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [pending, setPending] = useState<DownloadKind | null>(null);
  const [downloadBusy, setDownloadBusy] = useState<DownloadKind | null>(null);

  useEffect(() => {
    trackClient("tool_started");
    try {
      // Read client-only sessionStorage AFTER hydration; a lazy useState
      // initializer would diverge from the server render and mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionStorage.getItem(UNLOCK_KEY)) setUnlocked(true);
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  const pages = useMemo(
    () => (model && skill ? buildPreview(model, skill) : null),
    [model, skill],
  );

  // Stamp the skill version on funnel events once we have it (PRD §15).
  const sv = () => (skill ? { skillVersion: skill.manifest.version } : {});

  async function handleGenerate() {
    setError(null);
    setStage("loading");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error ?? "Something went wrong. Please try again.");
        // extraction_succeeded / extraction_failed are tracked server-side
        // (authoritative, with skillVersion + usedRetry).
        setStage("input");
        return;
      }
      setModel(json.model);
      setSkill(json.skill);
      setIsMock(Boolean(json.mock));
      setStage("result");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setStage("input");
    }
  }

  async function handleFile(file: File) {
    setUploadNote(null);
    setError(null);
    try {
      const parsed = await parseFile(file);
      setText(parsed.slice(0, maxInputChars));
      setUploadNote(`Loaded “${file.name}”. Review and edit before generating.`);
    } catch (e) {
      setUploadNote(fileErrorMessage(e));
    }
  }

  function requestDownload(kind: DownloadKind) {
    if (unlocked) {
      void doDownload(kind);
      return;
    }
    setPending(kind);
    setGateOpen(true);
    trackClient("gate_shown", sv());
  }

  async function doDownload(kind: DownloadKind) {
    if (!model || !skill) return;
    setDownloadBusy(kind);
    try {
      if (kind === "drawio") {
        downloadDrawio(model, skill);
        trackClient("download_drawio", { processName: model.processName, ...sv() });
      } else {
        await downloadXlsx(model, skill, bookingUrl);
        trackClient("download_xlsx", { processName: model.processName, ...sv() });
      }
    } catch {
      setError("The file couldn't be generated. Please try again.");
    } finally {
      setDownloadBusy(null);
    }
  }

  function handleGateSubmit(data: { email: string; company: string; consent: boolean }) {
    if (!model) return;
    setGateSubmitting(true);
    // Fire-and-forget — the download must never wait on the webhook.
    void fetch("/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: data.email,
        company: data.company || undefined,
        processName: model.processName,
        taskCount: model.tasks.length,
        laneCount: model.lanes.length,
        source: "process-map-generator",
      }),
    }).catch(() => {});
    try {
      sessionStorage.setItem(UNLOCK_KEY, "1");
    } catch {
      /* ignore */
    }
    setUnlocked(true);
    // lead_captured is tracked server-side by /api/lead.
    setGateOpen(false);
    setGateSubmitting(false);
    const kind = pending;
    setPending(null);
    if (kind) void doDownload(kind);
  }

  const isMultiPage = (pages?.length ?? 0) > 1;
  // Only the "bigger than this tool" note when a single page still overflows;
  // a decomposed multi-page map is a success, not a truncation.
  const showBigProcessNote =
    !isMultiPage && (pages?.[0]?.fitWarnings.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-12">
      {stage !== "result" && (
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Turn a process description into a diagram in under a minute
          </h1>
          <p className="mt-3 text-lg text-slate-600">
            Paste how a process works. Get an editable draw.io swimlane diagram and an Excel
            register — free, no account.
          </p>
        </div>
      )}

      {stage === "input" && (
        <div className="mx-auto max-w-2xl">
          <InputPanel
            value={text}
            onChange={setText}
            onGenerate={handleGenerate}
            onFile={handleFile}
            loading={false}
            minInputChars={minInputChars}
            maxInputChars={maxInputChars}
            error={error}
            uploadNote={uploadNote}
          />
        </div>
      )}

      {stage === "loading" && <ProgressStages />}

      {stage === "result" && model && pages && (
        <div className="flex flex-col gap-8">
          {isMock && (
            <Banner tone="error">
              <strong>Demo mode — this is not a real extraction.</strong> No{" "}
              <code>ANTHROPIC_API_KEY</code> is set, so the offline mock just split your text
              into steps. Set a key to map your process with Claude.
            </Banner>
          )}
          {showBigProcessNote && (
            <Banner tone="info">
              Your process is bigger than this free tool handles — we mapped the core flow. The
              full picture usually needs sub-process decomposition.
            </Banner>
          )}
          {isMultiPage && (
            <Banner tone="info">
              This process was large, so we split it across {pages.length} pages — an overview
              plus one page per phase. The downloaded .drawio has a tab for each.
            </Banner>
          )}

          <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-2">
            <SummaryPanel model={model} onEdit={() => setStage("input")} />
            <PreviewPane pages={pages} processName={model.processName} />
          </div>

          <div className="flex flex-col gap-3">
            <DownloadButtons
              onDrawio={() => requestDownload("drawio")}
              onXlsx={() => requestDownload("xlsx")}
              busy={downloadBusy}
            />
            {unlocked && (
              <p className="text-center text-xs text-slate-400">
                Both files are unlocked for this session.
              </p>
            )}
          </div>

          <CtaSection bookingUrl={bookingUrl} onClick={() => trackClient("cta_clicked", sv())} />
        </div>
      )}

      <EmailGateModal
        open={gateOpen}
        submitting={gateSubmitting}
        error={null}
        onSubmit={handleGateSubmit}
        onClose={() => setGateOpen(false)}
      />
    </div>
  );
}
