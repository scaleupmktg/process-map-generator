import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFile, FileParseError } from "@/lib/client/parseFile";

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(async () => ({
    value: "Docx export: the team reviews the request and approves it.",
  })),
}));

const { pdfState } = vi.hoisted(() => ({
  pdfState: { pages: [[{ str: "hello" }]] as { str: string }[][] },
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pdfState.pages.length,
      getPage: async (i: number) => ({
        getTextContent: async () => ({ items: pdfState.pages[i - 1] }),
      }),
    }),
  }),
}));

function fakeFile(name: string, opts: { text?: string; buffer?: ArrayBuffer }): File {
  return {
    name,
    async text() {
      return opts.text ?? "";
    },
    async arrayBuffer() {
      return opts.buffer ?? new ArrayBuffer(0);
    },
  } as unknown as File;
}

beforeEach(() => {
  pdfState.pages = [[{ str: "hello" }]];
});

describe("parseFile", () => {
  it("reads .txt and .md directly", async () => {
    expect(await parseFile(fakeFile("p.txt", { text: "  The team does X. Then Y.  " }))).toBe(
      "The team does X. Then Y.",
    );
    expect(await parseFile(fakeFile("p.md", { text: "# Steps\nDo the thing." }))).toContain(
      "Do the thing.",
    );
  });

  it("extracts .docx text via mammoth", async () => {
    const text = await parseFile(fakeFile("proc.docx", {}));
    expect(text).toContain("the team reviews the request");
  });

  it("extracts .pdf text via pdf.js", async () => {
    pdfState.pages = [[{ str: "Customer" }, { str: "places" }, { str: "order" }]];
    const text = await parseFile(fakeFile("proc.pdf", {}));
    expect(text).toContain("Customer places order");
  });

  it("flags a scanned PDF (no selectable text) as SCANNED_PDF", async () => {
    pdfState.pages = [[]];
    await expect(parseFile(fakeFile("scan.pdf", {}))).rejects.toMatchObject({
      code: "SCANNED_PDF",
    });
  });

  it("rejects an empty text file as EMPTY", async () => {
    await expect(parseFile(fakeFile("p.txt", { text: "   " }))).rejects.toMatchObject({
      code: "EMPTY",
    });
  });

  it("rejects an unsupported extension as UNSUPPORTED", async () => {
    const err = await parseFile(fakeFile("p.rtf", { text: "x" })).catch((e) => e);
    expect(err).toBeInstanceOf(FileParseError);
    expect((err as FileParseError).code).toBe("UNSUPPORTED");
  });
});
