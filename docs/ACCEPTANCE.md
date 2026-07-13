# Acceptance checklist (PRD §16)

Status against each acceptance item, with evidence. Run `npm test` (151 tests),
`npm run build`, `npm run skill:check`, `npm run concurrency:test`.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Paste ~300 words → correct swimlane in < 90s | ✅ mechanics | `route-extract.test.ts`, `layout.test.ts`; real-model quality needs `ANTHROPIC_API_KEY` |
| 2 | Upload `.docx` → same result | ✅ | `parseFile.test.ts` (mammoth); feeds the same textarea |
| 3 | `.drawio` opens in diagrams.net, no broken shapes/crossed edges, one landscape page | ⚠️ structurally verified | `drawio.test.ts` (validateDrawio), `layout.test.ts` (one-page fit), `render-check.test.ts` (orthogonal edges, perimeter endpoints); SVG rendered correctly in a real browser DOM. **Live diagrams.net canvas eyeball not done** — this env's browser is unresponsive (screenshots/interaction hang) |
| 4 | `.drawio` visually matches the SVG preview | ✅ by construction | Both renderers consume the same `PositionedGraph` (shared absolute geometry) |
| 5 | `.xlsx` opens with 3 sheets, styled headers, working filters | ✅ | `xlsx.test.ts` (fill/bold header, frozen pane, auto-filter, read-back) |
| 6 | Both files carry GrowThriveScale branding | ✅ | `drawio.test.ts` (footer), `xlsx.test.ts` (About sheet) |
| 7 | Email gate appears once, unlocks both, never blocks the preview | ✅ | `app-flow.test.tsx` (gate opens on first download, gate-once-per-session, preview always shown) |
| 8 | Download still works if the lead webhook is down | ✅ | `route-lead.test.ts` (webhook rejects → 200); client posts lead fire-and-forget |
| 9 | 50 parallel extractions: no cross-contamination, no 5xx | ✅ | `concurrency.test.ts` + `npm run concurrency:test` (50 distinct payloads, 50 unique responses, 0 non-200) |
| 10 | Malformed LLM response auto-repaired into a valid, renderable diagram | ✅ | `repair.test.ts` (malformed fixture → refs resolve → validateDrawio passes) |
| 11 | Works on a phone | ⚠️ by construction | Responsive: `min-[900px]:grid-cols-2` stacking, `overflow-x-auto` tables, `overflow-auto` SVG (body never scrolls horizontally), stacked buttons, bottom-sheet modal. **Live device eyeball not done** (browser unresponsive) |
| 12 | No process text persisted server-side | ✅ | Stateless by construction (§3); `route-lead.test.ts` (no-leak: text/model never forwarded) |
| 13 | Grep `/src` for hex/font/caps — none | ✅ | `no-literals.test.ts` (engine has no hex or typeface literals; all from skill) |
| 14 | Changing a colour in `style.json` changes output, no code edit | ✅ | `drawio.test.ts` ("colours come from the skill palette") |
| 15 | Changing `maxTasks` in `modeling.json` changes prompt + validation, no code edit | ✅ | `extract.test.ts` (prompt interpolation), `schema.test.ts` (caps-from-modeling) |
| 16 | Editing `extraction.md` changes LLM behaviour, no code edit | ✅ | `buildSystemPrompt` renders `extraction.md`; `extract.test.ts` |
| 17 | `SKILL_BUNDLE_URL` upload changes output within TTL — no redeploy | ✅ | `skill.test.ts` (remote override + TTL cache) |
| 18 | Malformed/unreachable remote bundle falls back; logs `skill_load_failed` | ✅ | `skill.test.ts` (HTTP error / bad JSON / schema-invalid → bundled copy) |
| 19 | `manifest.version` in `.drawio` footer, Excel About, every analytics event | ✅ | `drawio.test.ts` (footer + mxfile attr), `xlsx.test.ts` (About), extract route + client `sv()` stamp events |
| 20 | Golden snapshots for the 3 fixtures; engine change leaves them byte-identical | ✅ | `golden.test.ts` (committed `.drawio` + `.svg`, deterministic) |

## Outstanding (environment-limited, not code)

Two items are **structurally verified but not visually eyeballed** because this
environment's in-app browser is unresponsive (screenshots, resizing, and synthetic
input all hang; DOM read and navigation work):

- **#3 live diagrams.net render** — the `.drawio` is structurally valid and shares
  geometry with the SVG (which *was* confirmed rendering in a real browser DOM).
  Recommended manual check: open `tests/golden/approval-flow.drawio` in
  app.diagrams.net.
- **#11 live mobile render** — responsive layout is correct by construction.
  Recommended manual check: open the dev server on a phone or at a 375px viewport.

Both are 30-second manual confirmations on any working browser.
