# Deploying the Process Map Generator

This app is a stateless Next.js app. It holds **no server-side session state** —
every request is an independent serverless function invocation — so it scales
horizontally with no extra work. That is why it can move off your laptop to a
host that spins functions up per request.

Recommended host: **Vercel** (free "Hobby" tier is enough to start).

---

## 1. Prerequisites

- A **GitHub** account (to host the code).
- A **Vercel** account (sign in with GitHub).
- Your **Anthropic API key** (already have it).
- Optional but recommended for production:
  - **Upstash Redis** (free) — durable rate limiting across serverless instances.
  - A **lead webhook** (Airtable / Resend / your CRM) — to capture emails.

Your API key is **never** committed or placed on any laptop in production — it
lives only in Vercel's encrypted Environment Variables.

---

## 2. Push the code to GitHub

From the project folder:

```bash
git remote add origin https://github.com/<you>/process-map-generator.git
git push -u origin master
```

(The repo is already committed. `.env*` is gitignored, so no secrets are pushed.)

---

## 3. Import into Vercel

1. Vercel dashboard → **Add New… → Project**.
2. Import the `process-map-generator` GitHub repo.
3. Framework preset auto-detects **Next.js**. Leave build settings default.
4. **Before clicking Deploy**, add the environment variables below.

---

## 4. Environment variables (set in Vercel → Project → Settings → Environment Variables)

| Variable | Required? | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | your `sk-ant-…` key |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5` (default) or `claude-haiku-4-5-20251001` |
| `NEXT_PUBLIC_BOOKING_URL` | Recommended | your consultation booking link |
| `LEAD_WEBHOOK_URL` | Recommended | webhook that receives captured emails |
| `UPSTASH_REDIS_REST_URL` | Recommended | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | from Upstash |
| `SKILL_BUNDLE_URL` | No | remote skill bundle override (hot-swap without redeploy) |
| `ANALYTICS_WEBHOOK_URL` | No | endpoint to receive analytics events |

**Do NOT set** `PMG_MOCK_EXTRACT` or `PMG_DEBUG_EXTRACT` in production — the mock
is refused in production anyway, but keep them unset.

Then click **Deploy**. You get a URL like `process-map-generator.vercel.app`.

---

## 5. Custom domain (optional)

Vercel → Project → **Settings → Domains** → add e.g. `tools.growthrivescale.com`,
then add the CNAME record Vercel shows you at your DNS provider.

---

## Production notes

- **Rate limiting.** Without Upstash, the app uses an in-memory limiter that only
  counts within a single serverless instance — so the "5 requests/hour/IP" cap
  leaks across instances. For real abuse protection, set the two `UPSTASH_*`
  vars (free tier is plenty). The code already uses them automatically when present.
- **Cost & latency (Sonnet).** Sonnet 5 "thinks" before answering, so an
  extraction runs ~30–50s and uses ~10–16k output tokens (~$0.10–0.25 each). For
  a free, high-traffic lead magnet, either (a) keep the 5/hour/IP limit and a
  Vercel/Anthropic spend alert, or (b) switch `ANTHROPIC_MODEL` to Haiku for a
  ~10x cheaper, ~3–5s extraction that is still good on typical inputs.
- **Privacy.** Process text is never persisted server-side and is never sent to
  the lead webhook — only that the tool was used, plus the email. Keep it that way.
- **Skill updates without redeploy.** Point `SKILL_BUNDLE_URL` at a hosted JSON
  bundle to change caps/colours/prompt live (cached for `SKILL_CACHE_TTL`s). A
  bad remote bundle safely falls back to the committed `/skill` copy.
