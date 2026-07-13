/**
 * Client-side file → text extraction. Phase 6 handles .txt/.md directly;
 * Phase 7 adds .docx (mammoth) and .pdf (pdf.js), lazy-loaded.
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
  } else {
    throw new FileParseError("UNSUPPORTED");
  }

  text = text.trim();
  if (!text) throw new FileParseError("EMPTY");
  return text;
}
