# VZT — Architectural Decisions

This file captures non-obvious architectural choices. It is agent-agnostic: any AI model (Claude Code, Codex, Cursor, Manus, etc.) reading this cold should understand WHY the system is shaped the way it is — not just what it does.

---

## 2026-05 — Multi-tenant credential pattern: zero secrets in GitHub, all creds from Supabase at runtime

**Decision:** User platform credentials (DOA, EstateSales.net) are stored in Supabase tables (`user_doa_credentials`, `user_estatesales_credentials`) per-user, never in GitHub Secrets or `.env` files. GitHub Actions workflows only receive `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. The `runAgent.js` entrypoint for each agent fetches the calling user's credentials from Supabase at runtime using `user_id` from the job record.

**Why:** The original DOA agent used `DOA_EMAIL`/`DOA_PASSWORD` as hardcoded GitHub Secrets (single-tenant, David's account only). A colleague needed access with her own credentials. Storing per-user creds in GitHub Secrets doesn't scale to multi-tenant — it would require a new secret per user per platform. Supabase already had the credential tables and RLS policies. The fix was to remove the credential secrets from GitHub and have agents fetch them at runtime.

**Consequence:** Never add per-user platform credentials back to GitHub Secrets. If a new agent platform is added, follow the same pattern: store creds in a `user_<platform>_credentials` table with RLS, pass only the job ID or user ID to the GitHub workflow. The workflow should only know how to talk to Supabase, not individual platform accounts.

---

## 2026-05 — EstateSales agent uses job record as coordination primitive

**Decision:** The `trigger-estatesales-agent` edge function creates an `estatesales_jobs` row first, then dispatches that `job_id` to GitHub Actions. The agent reads everything it needs (user_id, doa_url, estatesales_url, credentials) from the job record via Supabase at runtime.

**Why:** This gives the frontend a stable row to poll for status updates (`pending → running → completed/failed`) without needing a webhook or WebSocket. It also means the GitHub workflow is completely stateless — it only knows the job ID.

**Consequence:** The `estatesales_jobs` table is the source of truth for job state. Don't move status tracking to GitHub Actions outputs or workflow metadata — agents read/write status directly to this table via the service key.

---

## 2026-05 — `refine-listing` edge function: verify mode uses claude-sonnet-4-6 with real sold comp instructions

**Decision:** AI Verify in EbayBatchPanel calls the `refine-listing` edge function with `mode: 'verify'`. Verify mode was upgraded from Gemini Flash (no pricing research) to `claude-sonnet-4-6` via direct Anthropic API, with an explicit prompt to check eBay sold comps from the last 90 days and flag under/overpriced listings.

**Why:** The original verify mode only audited what was already in the listing. It had no pricing signal. A listing priced at $5 when comps sell for $50 would pass verification. The upgrade adds real market pricing context.

**Consequence:** `refine-listing` now requires `ANTHROPIC_API_KEY` in Supabase secrets (already set). If the verify prompt is changed, preserve the PRICING VERIFICATION block — removing it reverts to the old behavior of no comp checking.

---

## 2026-05 — Inline listing editor: `generatedListing` state is the source of truth post-generation

**Decision:** After AI generates a listing in `CreateListing.tsx`, all fields (title, description, price, condition) are editable inline via controlled inputs that write directly to `generatedListing` state. If an eBay row exists (`lastEbayRow`), a 600ms debounced effect syncs changes to `ebay_batch_rows` in Supabase. Platform push functions use `generatedListing` state at time of push — not a snapshot from generation time.

**Why:** Users were editing listings by clicking "Start Next Item" and going back through generation, which was a full round-trip. Inline editing eliminates that loop.

**Consequence:** Don't replace the editable inputs with static `<p>` tags for "simpler" rendering. The inputs ARE the preview. The debounce on the Supabase sync is intentional — don't remove it to make the sync immediate (it would fire on every keystroke).

---

## 2026-05 — AIGuardrailPrompt is rendered per-platform section, not globally

**Decision:** `<AIGuardrailPrompt>` is rendered once per platform section in `CreateListing.tsx` (Facebook/crosspost section, LiveAuctioneers section, Denver section, eBay section). Four instances total, all sharing the same `masterPrompt` state and `currentProjectId`.

**Why:** The guardrail prompt is contextual to where the user is in the listing flow. A single global guardrail above all sections would be easy to miss. Placing it near each platform's generate button makes it visible at decision time.

**Consequence:** If a new platform section is added to `CreateListing.tsx`, add `<AIGuardrailPrompt>` to that section. Don't consolidate into one global instance — the per-section placement is intentional.

---

## 2026-05 — DOA multi-tenant: `trigger-doa-agent` extracts user_id from JWT, passes to workflow

**Decision:** `trigger-doa-agent` edge function extracts the calling user's JWT from the `Authorization` header, validates it via `supabase.auth.getUser()`, and passes `user_id` in the GitHub `client_payload`. The `doa-listing-agent/runAgent.js` entrypoint then uses that `user_id` to fetch the correct `user_doa_credentials` row from Supabase.

**Why:** The original function had no auth — any caller could trigger a DOA agent run for any batch. Adding JWT extraction ties the agent run to the specific user's credentials.

**Consequence:** The `trigger-doa-agent` function will return 401 for unauthenticated requests. Frontend callers must pass the Supabase session token in the `Authorization` header. This is already how all other VZT edge functions work.

---

## 2026-05 — Supabase Management API callable via PAT stored in Windows Credential Manager

**Decision:** The Supabase CLI (installed via Scoop) stores the user's personal access token (PAT) in Windows Credential Manager under the key `Supabase CLI:supabase`. This PAT can be extracted programmatically and used to call the Supabase Management API (`api.supabase.com/v1/projects/{ref}/database/query`) to run DDL SQL without needing the DB password.

**Why:** `supabase db push --linked` requires `SUPABASE_DB_PASSWORD` which is not stored in any local env file. The Supabase CLI is authenticated (can list projects, deploy functions, list secrets) but the DB push path is blocked. The Management API with the PAT is an alternative for running migrations in the same session without a separate password.

**Consequence:** The PAT is scoped to the Supabase user account — treat it as a secret. Don't hardcode it. Extract it from Credential Manager when needed. Alternatively, store `SUPABASE_DB_PASSWORD` in `.env.local` to enable `db push` without the workaround.

---

## 2026-05 — doa-agent.yml was missing SUPABASE_SERVICE_ROLE_KEY; supabaseReader.js reads this specific var to bypass RLS

**Decision:** `doa-agent.yml` injects `SUPABASE_SERVICE_ROLE_KEY` (with `_ROLE_`) as a separate env var alongside `SUPABASE_SERVICE_KEY`. Both must be present in the workflow env block.

**Why:** `supabaseReader.js` reads `process.env.SUPABASE_SERVICE_ROLE_KEY` specifically to bypass Row-Level Security on `denver_batch_rows`. If this var is missing, it falls back to `SUPABASE_ANON_KEY` — the anon key is subject to RLS and returns 0 rows silently. The workflow was injecting `SUPABASE_SERVICE_KEY` (no `_ROLE_`) which `runAgent.js` uses to authenticate to Supabase, but `supabaseReader.js` never saw the service role key it needed. The GitHub Secret `SUPABASE_SERVICE_ROLE_KEY` existed (added 2026-04-14) but was never wired into the workflow env block.

**Consequence:** Both vars serve different purposes — do not consolidate them. `SUPABASE_SERVICE_KEY` → `runAgent.js` (fetches user credentials). `SUPABASE_SERVICE_ROLE_KEY` → `supabaseReader.js` (reads `denver_batch_rows` bypassing RLS). Any future workflow that uses `supabaseReader.js` must inject both.
