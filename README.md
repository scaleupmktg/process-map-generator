# Process Map Generator

A free web tool that turns a plain-English process description into a downloadable
**draw.io swimlane diagram** (`.drawio`) and an **Excel process register** (`.xlsx`).
Built by [GrowThriveScale](https://growthrivescale.com) as a lead magnet.

Paste text → one LLM extraction call → on-screen SVG preview + read-only summary →
email gate → both downloads. No account, no database, nothing about your process is
stored server-side.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in what you have (all optional in dev)
npm run dev                  # http://localhost:3000
```

In development, with **no `ANTHROPIC_API_KEY`**, extraction uses a deterministic
offline mock so you can click through the whole flow without spending tokens. In
production the API key is required.

```bash
npm run build && npm start   # production build
npm test                     # 150+ unit/integration tests (vitest)
npm run skill:check          # validate the skill bundle + re-render fixtures
npm run concurrency:test     # 50 parallel extractions, assert no contamination
```

---

## Architecture

**Stateless by construction.** The only server call is `POST /api/extract`, which is
pure (text in → JSON out). The entire process model lives in React state in the
browser tab. There is no session store, no temp files, no shared mutable state — so
N concurrent users are N independent function invocations with no possibility of
cross-contamination (verified by `npm run concurrency:test`).

```
ProcessModel ──► layout() ──► PositionedGraph ──┬─► renderSvg()    (on-screen preview)
   (Zod)          (engine)                       └─► renderDrawio() (.drawio file)
                                                     renderXlsx()   (.xlsx register)
```

One layout function, two renderers — the preview and the `.drawio` share the same
computed geometry, so they cannot diverge.

### Engine vs. Skill — the key structural rule

The opinionated parts of this tool are **content, not code**:

| Layer | What | Lives in | Changes |
|---|---|---|---|
| **Engine** | layout maths, edge routing, XML/SVG/xlsx serialisation, React UI | `/src` | rarely |
| **Skill** | caps, colours, fonts, shape styles, label rules, the extraction prompt | `/skill` | often |

Every hex colour, every cap number, every font size, and every sentence of the LLM
prompt comes from `/skill` — never hardcoded in `/src` (enforced by
`tests/no-literals.test.ts`). Changing the look or the caps is a **skill edit**, not a
code change.

```
/skill
  manifest.json    name, version (semver), schemaVersion, changelog
  extraction.md    the LLM system prompt (caps interpolated as {{maxTasks}} etc.)
  modeling.json    caps, layout budget, geometry, fonts, toggles
  style.json       palette + mxGraph style per shape kind + branding
```

### Skill-iteration workflow

1. Edit a file in `/skill` (a colour, a cap, a prompt sentence).
2. Bump `manifest.version`.
3. `npm run skill:check` — validates the schema, re-renders the 3 fixtures, writes
   preview SVGs to a temp dir, and reports which golden snapshots would change.
4. Review, then regenerate goldens: `UPDATE_GOLDENS=1 npx vitest run tests/golden.test.ts`.
5. Ship — commit, **or** (if using `SKILL_BUNDLE_URL`) just upload the new bundle; the
   next request picks it up within `SKILL_CACHE_TTL`. No redeploy, no engineer.

A malformed or unreachable remote bundle silently falls back to the committed copy and
logs `skill_load_failed` — a bad skill edit can never take the tool down.

---

## Environment variables

See [`.env.example`](.env.example). All are optional in development:

| Var | Purpose | Dev fallback |
|---|---|---|
| `ANTHROPIC_API_KEY` | extraction | offline mock (non-prod only) |
| `ANTHROPIC_MODEL` | model id | `claude-haiku-4-5-20251001` |
| `LEAD_WEBHOOK_URL` | lead capture (Airtable/CRM/Resend) | logs + returns 200 |
| `UPSTASH_REDIS_REST_URL/TOKEN` | IP rate limiting | in-memory limiter |
| `NEXT_PUBLIC_BOOKING_URL` | CTA target | `https://growthrivescale.com` |
| `SKILL_BUNDLE_URL` / `SKILL_CACHE_TTL` | remote skill override | committed `/skill` |
| `ANALYTICS_WEBHOOK_URL` | analytics sink | server console |

---

## Deploy (Vercel)

Push to a Vercel project and set the env vars above. `next.config.ts` traces the
`/skill` bundle into the `/api/extract` serverless function. Serverless functions
scale horizontally per request, which is what solves concurrency.

---

## Privacy

The process text is never persisted server-side and is never sent to the lead webhook
— we capture *that* the tool was used (email, process name, task/lane counts), not
*what* was mapped.
