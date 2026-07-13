/**
 * Client-side file → text extraction (PRD §2, §11). Everything runs in the
 * browser; heavy parsers are lazy-loaded only when a matching file is dropped.
 *   .txt / .md  — read directly
 *   .docx       — mammoth (raw text)
 *   .pdf        — pdf.js text layer; a PDF with no selectable text is a scanned
 *                 document → SCANNED_PDF (the user is told to paste instead)
 */
export type FileErrorCode = "UNSUPPORTED" | "SCANNED_PDF" | "EMPTY";

export class FileParseError extends Error {
  code: FileErrorCode;
  constructor(code: FileErrorCode) {
    super(code);
    this.name = "FileParseError";
    this.code = code;
  }
}

export async function parseFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  let text = "";

  if (ext === "txt" || ext === "md") {
    text = await file.text();
  } else if (ext === "docx") {
    text = await extractDocx(file);
  } else if (ext === "pdf") {
    text = await extractPdf(file);
  } else {
    throw new FileParseError("UNSUPPORTED");
  }

  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!text) throw new FileParseError(ext === "pdf" ? "SCANNED_PDF" : "EMPTY");
  return text;
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value ?? "";
}

let pdfWorkerReady = false;

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfWorkerReady && typeof Worker !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
    pdfWorkerReady = true;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text +=
      content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return text;
}
