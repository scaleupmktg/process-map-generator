// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import ProcessMapApp from "@/components/ProcessMapApp";
import { loadBundledSkill } from "@/lib/skill/load";
import { toClientSkill, type ClientSkill } from "@/lib/skill/schema";
import type { ProcessModel } from "@/lib/model/schema";

const model = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "approval-flow.json"), "utf8"),
) as ProcessModel;

let clientSkill: ClientSkill;
beforeAll(async () => {
  clientSkill = toClientSkill(await loadBundledSkill());
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  // download plumbing that jsdom doesn't implement
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();

  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/extract")) return json({ ok: true, model, skill: clientSkill });
    if (u.includes("/api/lead")) return json({ ok: true });
    if (u.includes("/api/analytics")) return json({ ok: true });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => cleanup());

function renderApp() {
  return render(
    <ProcessMapApp minInputChars={40} maxInputChars={6000} bookingUrl="https://example.com/book" />,
  );
}

const DESC =
  "A customer submits a request. The manager approves it or asks for a revision. Finance checks the budget and raises a purchase order.";

async function generate() {
  fireEvent.change(screen.getByLabelText(/process description/i), {
    target: { value: DESC },
  });
  fireEvent.click(screen.getByRole("button", { name: /generate my process map/i }));
  await screen.findByText(/here's what we extracted/i);
}

describe("ProcessMapApp — full flow", () => {
  it("input → generate → result renders summary, preview and downloads", async () => {
    renderApp();
    await generate();

    // extraction summary
    expect(screen.getByRole("heading", { name: model.processName })).toBeTruthy();
    // preview SVG (inert data URI)
    const img = screen.getByRole("img", { name: /swimlane process map/i }) as HTMLImageElement;
    expect(img.src.startsWith("data:image/svg+xml")).toBe(true);
    // both downloads
    expect(screen.getByRole("button", { name: /download .drawio/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download .xlsx/i })).toBeTruthy();
    // extract was called
    expect(fetchMock).toHaveBeenCalledWith("/api/extract", expect.anything());
  });

  it("first download opens the email gate; submitting unlocks and triggers the download", async () => {
    renderApp();
    await generate();

    fireEvent.click(screen.getByRole("button", { name: /download .drawio/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/work email/i), {
      target: { value: "manager@acme.com" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /send me my files/i }));

    // lead posted (never blocks the download), and the file was triggered
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/lead", expect.anything()),
    );
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    // gate closed, session unlocked
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sessionStorage.getItem("pmg-unlocked")).toBe("1");
  });

  it("the gate shows once per session — a later download skips it", async () => {
    sessionStorage.setItem("pmg-unlocked", "1");
    renderApp();
    await generate();

    fireEvent.click(screen.getByRole("button", { name: /download .drawio/i }));
    // no gate; download fires immediately
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a loud demo banner when the response is from the mock", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/extract")
        ? json({ ok: true, model, skill: clientSkill, mock: true })
        : json({ ok: true }),
    );
    renderApp();
    await generate();
    expect(screen.getByText(/not a real extraction/i)).toBeTruthy();
  });

  it("surfaces a server error and stays on the input screen", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/extract")
        ? json({ ok: false, code: "EXTRACTION_FAILED", error: "We couldn't find a clear sequence of steps." }, 422)
        : json({ ok: true }),
    );
    renderApp();
    fireEvent.change(screen.getByLabelText(/process description/i), { target: { value: DESC } });
    fireEvent.click(screen.getByRole("button", { name: /generate my process map/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/clear sequence of steps/i);
    expect(screen.queryByText(/here's what we extracted/i)).toBeNull();
  });
});
