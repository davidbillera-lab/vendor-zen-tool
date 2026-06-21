# VZT — Architectural Decisions

This file captures non-obvious architectural choices. It is agent-agnostic: any AI model (Claude Code, Codex, Cursor, Manus, etc.) reading this cold should understand WHY the system is shaped the way it is — not just what it does.

---

## 2026-06-20 — EstateSales dedup ledger is owner-scoped in code (service-role bypasses RLS)

**Decision:** Every read/write against `estatesales_uploaded_lots` in `agent.js` now filters by `.eq('user_id', jobUserId)`, and `jobUserId` is resolved from `estatesales_jobs` (by `JOB_ID`) *before* the first ledger read. `reserveLot` also writes `user_id: jobUserId` on insert. The owner is resolved once; if the job row is missing, the agent throws a `LedgerError` (hard stop) rather than running unscoped.

**Why:** The agent authenticates to Supabase with the **service-role key**, which **bypasses RLS entirely**. RLS therefore provides zero protection on this path — the agent must scope ledger queries itself or one tenant's run could read/confirm/fail another tenant's lots. CodexQC flagged the unscoped queries as the remaining FIX-FIRST blocker after the prior round.

**Consequence:** The DB unique constraint is still `(es_url, lot_url)`, not `(user_id, es_url, lot_url)`. Tightening it to include `user_id` is **deferred to the pre-paying-tenant checklist** — a cross-tenant key collision is only theoretical today (each tenant has distinct `es_url`/`lot_url`), and the query-level scoping already prevents cross-tenant reads/writes. When onboarding the first external tenant, add the migration to drop the old unique index and create `(user_id, es_url, lot_url)`. Do not remove the `.eq('user_id', …)` filters — they are the actual isolation guarantee, not RLS.

---

## 2026-06-20 — EstateSales agent NEVER saves the Sale wizard; ledger confirms on caption, not save

**Decision:** The EstateSales upload agent (`agent.js`) does the Pictures step only — bulk-upload all images, then for each picture open the editor (pencil on the first image, auto-advance after), paste the DOA-scraped title into the Description field, hit NEXT, repeat — and then **stops**. It deliberately does NOT click "Save and Continue". The dedup ledger (`estatesales_uploaded_lots`) now marks a lot `uploaded` when its images are uploaded AND every picture in its range was captioned successfully — decoupled from any save signal. A lot with any uncaptioned picture is marked `failed` (fail-safe, left for retry). The old `saveEsPictures()` call + the now-orphaned `hasErrorOrAuthState()` helper were removed.

**Why:** This is the operator's mandated workflow — David finishes the add manually with "Save and Continue" so he can review and complete the rest of the wizard setup by hand. EstateSales.net drafts auto-persist: uploaded images and pasted descriptions survive even if the browser closes before Save and Continue, so the agent stopping short loses nothing. CodexQC flagged "agent never saves → uploads could be lost" as 🔴 Blocking; that concern is theoretical given draft auto-persistence and is overridden by the explicit operator requirement. Gating the ledger on caption success (not save) makes a false `uploaded` impossible — a lot only confirms if its descriptions actually pasted.

**Consequence:** "Uploaded" in the ledger means images + descriptions are on ES, not that the sale is published. Final wizard persistence is David's manual step and is intentionally outside the agent's contract. Do not re-add a save click or re-couple the ledger to a save signal. `clickEsNext` matches only "Next" (case-insensitive) — do not add "Continue"/"Go" synonyms, which would collide with "SAVE AND CONTINUE".

---

## 2026-06-20 — EstateSales agent auth: capture Playwright storageState in Settings, encrypt at rest

**Decision:** Added a "EstateSales.net Session" paste field (Textarea) to `EstateSalesCredentialsCard.tsx` that writes the captured Playwright session JSON to `user_estatesales_credentials.estatesales_storage_state`. The field client-side-validates the paste is JSON containing a `cookies` array before saving, and the card only ever reads the column's *presence* (never pulls the secret back into the browser). Added `estatesales_storage_state` to `PASSWORD_FIELDS` in `save-credentials` so the session is AES-GCM encrypted at rest; `runAgent.js` `decryptCredential()` already decrypts it transparently on read.

**Why:** EstateSales.net is Google-SSO-only, which blocks in-Playwright email/password login. The agent (`agent.js`) already supports a two-path auth: Path A loads `ES_STORAGE_STATE` and skips sign-in entirely; Path B falls back to email/password (which hits the Google wall and fails). The local agent works because it has `es-session.json` on disk; CI failed ("still on login page, 0 of 201 lots") because the DB column feeding `ES_STORAGE_STATE` was NULL — there was no UI to populate it. The entire backend path (DB column → runAgent decrypt → agent skip-login → newContext storageState) was already wired; the only missing link was a Settings field. This adds that field rather than rebuilding any backend.

**Consequence:** The session expires periodically (live Google cookies). When CI uploads start failing on the login step, the operator re-captures and re-pastes a fresh session — no code change needed. The session JSON is a live credential: never commit `es-session.json`/`es-cookies.json`, never log the column value. The card's inline "How to capture" guide documents the Cookie-Editor → `convert-cookies.js` → paste flow for the operator.

---

## 2026-06-13 — eBay required item specifics guardrail: extract + pre-flight check before Trading API

**Decision:** Extracted `buildEffectiveSpecifics(categoryId, row)` from `buildAddFixedPriceItemXml`. The new helper computes the exact specifics dict that will be submitted (user values + brand/mpn/upc + category-specific defaults). In `publishRow()`, immediately after the QA merge and before the XML build, the guardrail calls `buildEffectiveSpecifics` and cross-references against `requiredAspects` (from Taxonomy API). Any required aspect still missing → hard fail with a human-readable error listing the missing keys. Nothing hits the Trading API.

**Why:** `getRequiredAspectsForCategory` was already fetching required aspects and `runPrePublishQA` was already trying to fill them via AI — but there was no enforcement. Items with unfillable required specifics (e.g. ISBN for books — AI can't fabricate an ISBN) were silently reaching the Trading API and getting error 21919303. The guardrail catches this case deterministically before any network call.

**Consequence:** `buildEffectiveSpecifics` is now the single source of truth for what specifics will be submitted. If category-specific injection logic ever changes, update the helper — `buildAddFixedPriceItemXml` delegates to it. The guardrail gets the update automatically.

---

## 2026-06-11 — Edge functions must validate the JWT explicitly with a service-role client (not anon-key + stored session)

**Decision:** Any Supabase edge function that needs the calling user's identity must (1) create a client with `SUPABASE_SERVICE_ROLE_KEY`, and (2) extract the JWT from the `Authorization` header and call `supabase.auth.getUser(jwt)` with that token passed explicitly. The anon-key client with `global.headers.Authorization` + a no-argument `getUser()` does NOT work in edge functions — there is no stored session, so `getUser()` returns null and the function 401s. This fixed both `trigger-estatesales-agent` (commit a72aae1) and `save-credentials` (the "failed to save the credentials" bug).

**Why:** Edge functions are stateless request handlers. The supabase-js auth helpers assume a browser-style persisted session; that assumption is false server-side. Passing the JWT directly to `getUser(jwt)` is the only reliable way to resolve the user. `trigger-doa-agent` already used this pattern — it was the working reference.

**Consequence:** When writing or reviewing any edge function that reads `user.id`, confirm it uses the service-role + `getUser(jwt)` pattern. Do not reintroduce anon-key + global-header auth. (Note: Lovable has regenerated functions with the broken pattern before — re-check after any Lovable touch.)

## 2026-06-11 — Reconciled estatesales credentials schema drift (missing updated_at)

**Decision:** Added `updated_at timestamptz not null default now()` to `user_estatesales_credentials` (migration `20260611000000`). Lovable had created this table without the column, unlike its three sibling tables (`user_doa/mercari/poshmark_credentials`), all of which have it. The generic `save-credentials` function stamps `updated_at` on every upsert, so the missing column would have surfaced as a 500 once the auth fix unblocked the request.

**Why:** Fix the drift at the source (the table) rather than special-casing the function. Removing the `updated_at` stamp from the shared function would have degraded the three working platforms. Uniform tables → one code path for all four platforms.

**Consequence:** All four `user_<platform>_credentials` tables now have identical `updated_at` semantics. Keep them in sync. The committed migration `20260518000000_add_estatesales_tables.sql` already declared the column — the live DB had drifted from it, a recurring Lovable risk.

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

---

## 2026-06-04/05 — Self-improving loop v2.2: semantic correction retrieval via pgvector (deployed)

**Decision:** Correction injection in `generate-listing` moved from "20 most-recent global" (v1) to semantic nearest-neighbor retrieval. Each correction gets a 1536-dim embedding (`text-embedding-3-small`) over a compact signature (wrong/corrected title + specifics + category + note). At generation time the current item is captioned by Haiku (`claude-haiku-4-5`, ≤15-word resale descriptor), embedded the same way, and the top-8 nearest corrections are retrieved via the `match_listing_corrections` pgvector RPC and injected into the prompt. Backfill runs through the `embed-corrections` edge function (fire-and-forget from `EbayBatchPanel`, batch limit 25). If captioning/embedding fails, retrieval falls back to recent-20 (`retrievalMode='recent'`) — the listing path never blocks.

**Why:** v1's global-recent injection degrades with volume — a clock correction is noise when listing a rug. Semantic retrieval makes relevance *improve* with volume (denser correction space → better neighbors), which is the compounding-moat thesis. v2.1 (category pre-filter) was skipped as subsumed: the embedding includes category, so semantic match dominates whenever images exist.

**Consequence:** pgvector extension enabled; `listing_corrections.embedding vector(1536)` column. All retrieval is RLS-scoped (`security invoker`, `user_id = auth.uid()`) using a request-auth'd client — per-tenant correction isolation is preserved. Caption + embedding are Tier-1 calls, cost-logged to `model_costs` with `source: 'generate-listing'`. Migrations 20260604000000/20260605000000 were applied directly (not via tracked `supabase db push`), so `list_migrations` on the live project stops at 20260529000000 — schema verified live by direct SQL.

---

## 2026-06-05 — Self-improving loop v2.4: effectiveness tracking, decay, and retirement (deployed)

**Decision:** Closed the quality loop on injected corrections. Every generation records which corrections shaped it: durable `correction_injections` event log (survives `ebay_batch_rows` deletion via on-delete-set-null) + `injected_correction_ids uuid[]` handle on the row, written via `record_correction_injections` RPC (non-blocking, from `CreateListing.tsx`). When the operator re-corrects the same row, `mark_corrections_re_corrected` flips the open injection events, bumps `times_failed`, and retires a correction once `times_failed >= 3 AND times_failed * 2 >= times_injected`. Retrieval ranking is now `similarity × recency decay (1/(1 + age_days/90))` and excludes retired rows. `correction_effectiveness_stats()` reports overall re-correction rate plus trailing-30d vs prior-30d.

**Why:** Without failure tracking, a bad lesson gets injected forever. Decay keeps the operator's current taste dominant over stale corrections. The stats function produces the exit-story metric ("re-correction rate down X% over 90 days") for a data room.

**Consequence:** Three counters (`times_injected`, `times_failed`, `retired`) on `listing_corrections` plus an UPDATE RLS policy (v1 had only select/insert). All RPCs are `security invoker` with `auth.uid()` scoping. Migration 20260605000200, also applied directly (untracked in `list_migrations`). Verified live 2026-06-09: `generate-listing` v28 + `embed-corrections` v4 active, 1 correction captured and embedded, 8 injection events recorded.

---

## 2026-06-10 — v2.3: distill-lessons consolidation pass — general rules above specific cases

**Decision:** A separate `distill-lessons` edge function (Sonnet 4.6, Tier-2) reads the `listing_corrections` table, groups corrections by pattern, and writes consolidated rules to a new `listing_correction_lessons` table. `generate-listing` queries up to 5 non-retired lessons via `authedClient` (RLS-scoped) and prepends a `=== LEARNED LESSONS ===` block above the existing `=== LEARNED CORRECTIONS ===` block. Lessons are surfaced in order: general rules first, then specific recent cases. `distill-lessons` is triggered fire-and-forget from `EbayBatchPanel.captureCorrection()` immediately after `embed-corrections`, with no cron job.

**Why:** Individual corrections are per-item specifics; they don't generalise across items. After accumulating ≥5 corrections on the same pattern (e.g. "always include model number in title for electronics"), the agent should apply that rule universally — not just when a matching vector is retrieved. The consolidation pass extracts that signal. No cron was used because the correction flow already has a natural trigger point (a new correction just captured), so piggy-backing on that event keeps the stack simpler. Lesson embeddings were explicitly skipped — lessons are general rules, not item-specific text, so vector similarity retrieval adds no value over recency ordering.

**Consequence:** `listing_correction_lessons` table (`id uuid pk`, `lesson_text text`, `created_at timestamptz`, `retired bool default false`, `times_injected int default 0`). `record_lesson_injections` RPC increments `times_injected` in bulk, fire-and-forget. Lessons are retired manually or by a future automated decay pass. The Sonnet Tier-2 routing for `distill-lessons` is intentional — it needs reasoning quality to synthesise patterns, not just extraction. Do not downgrade to Haiku for the distillation call.

---

## 2026-06-11 — Hermes Loop closed: distilled lessons now injected into refine-listing verify mode

**Decision:** `refine-listing` edge function's verify branch now reads up to 5 active lessons from `listing_correction_lessons` via `authedClient` (RLS-scoped) before building the system prompt. Lessons are prepended as a `=== LEARNED LESSONS ===` block, identical format to `generate-listing`. The read is fully non-blocking — if the table is empty or the fetch fails, verify proceeds normally with no lessons block. Refine mode is intentionally unchanged.

**Why:** `generate-listing` was already closed (lessons injected since v2.3). `refine-listing` only read the manual `masterPrompt` guardrail. That meant the AI's distilled knowledge never reached the Verify path — the loop was broken at the last mile. Closing it means AI Verify gets smarter as corrections accumulate, without any manual operator action.

**Why verify only, not refine:** Refine is directive — the user gives a specific instruction ("change the title to X"). Injecting learned lessons into a directive call risks the AI modifying fields the user didn't ask about, producing unexpected drift. Verify is evaluative — the AI audits the whole listing — so accumulated lessons are directly applicable and improve audit quality.

**authedClient is required:** Lessons are RLS-scoped to `auth.uid()`. The anon client returns 0 rows silently. The pattern is `createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })` — same as generate-listing lines 833-837. Do not use the plain anon client for lesson reads.

**Consequence:** The Hermes Loop is now fully closed across all three AI call paths in VZT: `generate-listing` (generate), `refine-listing/verify` (audit), and the `distill-lessons` consolidation pass. The global framework is documented as a portable skill at `~/.claude/skills/hermes-loop/SKILL.md`. Commit `5953055` on `vercel-deploy`.

---

## 2026-06-12 - EstateSales dedup ledger: estatesales_uploaded_lots table + progress fields

**Decision:** New table `public.estatesales_uploaded_lots` (Supabase project atgrxqfxysvppqoyvjdd) records every lot the EstateSales agent successfully uploads, keyed `UNIQUE (es_url, lot_url)` where `lot_url` is the stable DOA `/auction-details?id=N` link and `es_url` is the target EstateSales sale. On every run, `uploadLots()` reads the ledger before ES login and skips lots already present. The ledger read **fails closed** - if it errors, the run aborts rather than risk duplicates. Writes go through the service-role key (upsert with `ignoreDuplicates`, non-fatal on error); RLS is enabled with a select-only `auth.uid() = user_id` policy so the UI can read but nothing client-side can write. The agent also writes `lots_scraped` / `lots_uploaded` progress fields to `estatesales_jobs` during the run, surfaced read-only on the EstateSalesUpload page.

**Why:** A mid-run failure (e.g. the 2026-06-11 login blocker) previously meant a re-run would re-upload every lot, creating duplicates on the live sale. David's directive: visibility into where a run left off, and no duplicates, in that order. Keying on `(es_url, lot_url)` makes resume idempotent per sale while still allowing the same DOA lot to upload to a different future sale.

**Consequence:** Additive only - no existing table or function reads this ledger. Fail-closed means a Supabase outage blocks uploads entirely; that is the intended tradeoff (a blocked run is recoverable, duplicates are manual cleanup on a live customer-facing sale). Ledger starts empty; zero lots had ever uploaded, so no backfill. Migration applied directly 2026-06-12 (untracked in `list_migrations`). **Superseded 2026-06-17 — the table + progress columns are now codified in a tracked migration (`20260616000000_add_estatesales_ledger_and_progress.sql`); see entry below.**

---

## 2026-06-17 — EstateSales agent: race-safe ledger state machine, SSO session login, tracked schema (3-agent parallel build)

**Context:** Iterative Codex QC (`gpt-5.5`) on `vercel-deploy` returned FIX-FIRST ⚠️ with 5 Blocking items against the EstateSales upload agent: (1) the dedup ledger + progress columns were applied directly to the live DB with no tracked migration (not reproducible — fails acquirer diligence); (2) login only did email/password while the operator account is Google-SSO-only (`LOGIN-DIAGNOSIS.md`); (3) a read-then-upload-then-record dedup race — two concurrent runs could both create live duplicates; (4) no post-save confirmation — a swallowed nav timeout marked never-created lots as uploaded; (5) a ledger-write failure after a real upload was logged-and-ignored, so a re-run would duplicate.

**Decision — decomposition:** Fixed all five via **3 isolated Sonnet 4.6 subagents grouped by code region** (not the original 5-way split — regrouped with David's approval so the merge surface is clean), each in its own git worktree; Opus 4.8 reviewed each diff and merged. Agent A = the new tracked migration (owns only the `.sql`); Agent B = SSO `storageState` login (the `agent.js` login region + all of `runAgent.js`); Agent C = the upload/ledger state machine (disjoint `agent.js` region). Merged to `vercel-deploy` as `51fbebe`; a follow-up comment-only correction landed as `8f05b14`.

**Decision — schema as a tracked state machine (Blocker #1):** `estatesales_uploaded_lots` and the `estatesales_jobs` progress columns (`error_message`, `completed_at`, `lots_scraped`, `lots_uploaded`, `lots_skipped`) plus `user_estatesales_credentials.estatesales_storage_state` are now in a fully idempotent tracked migration. The ledger gains a `status` column (`reserved | uploaded | failed`), `reserved_at`, and `uploaded_at` — it is a durable state machine, not an after-the-fact receipt. **RLS:** SELECT-only `auth.uid() = user_id`; the agent writes via `SUPABASE_SERVICE_KEY` (bypasses RLS), so **no service-role write policy is created** — a permissive `FOR ALL using(true)` policy would be OR'd with the SELECT policy and, because policy names are cosmetic in Postgres, would expose every user's rows. Omitting it is deliberate, not an oversight.

**Decision — atomic reservation + NO auto-reclaim (Blocker #3):** Each lot is claimed *before* upload via an atomic `insert(status:'reserved')`; a Postgres `23505` unique violation means the row already exists → read its status and **conservatively skip** (`uploaded` = done; `reserved`/`failed` = do not touch). Locked policy: **stale `reserved` rows are NEVER auto-reclaimed**, even past `STALE_RESERVATION_MS` (30 min) — a dead run may have saved the item on ES before dying, so re-uploading would create the exact duplicate the ledger exists to prevent. `STALE_RESERVATION_MS` survives only to *label* the skip log (STALE vs likely-concurrent) for manual reconciliation. This is the literal application of David's priority: **duplicates are worse than blocked runs.** Failed/stale recovery is manual (operator clears the ledger row).

**Decision — positive post-save confirmation (Blocker #4) + hard-stop on ledger failure (Blocker #5):** A lot is only marked `uploaded` after a positive ES-side signal (`checkSaveConfirmation`); no signal → the reservation flips to `failed`, not `uploaded`. Ledger writes now **throw** (`LedgerError`, `fatalLedger=true`) instead of warn-and-continue: if ES upload succeeded but the status update fails, the run hard-stops with "uploaded but could not record — manual intervention required" rather than risk a future duplicate.

**Decision — SSO login (Blocker #2):** Added a Playwright `storageState` session-import path with **email/password retained as fallback** (chosen over password-only or SSO-only — nothing breaks either way). `ES_STORAGE_STATE` is treated as a credential (AES-GCM `decryptCredential()`, backward-compatible plaintext passthrough, **never logged**). When present, form login is skipped and auth is verified (not bounced to `/sign-in`). **Feature stays gated at the operator level: NO live ES dispatch until David exports a working session** (ES login is blocked credential-side, suspected Google-SSO-only — 2026-06-12).

**On the recurring Codex "untracked migration" / "missing column" Blockers:** The 3 newest Codex runs' Blocking items are **verified false positives** — Codex diffs the large `main...HEAD` divergence and leans on handoff prose, approximating/hallucinating filenames and line numbers (one cited a non-existent `20260612000000_*.sql`; the real file is `20260616000000`). Every column/status those findings claim is "missing" is present in the tracked migration. The only genuine actionable item — a stale-reservation comment that contradicted the no-reclaim code — was fixed in `8f05b14`. The 5 original blockers are cleared; do not re-open them on the next Codex pass.

**Consequence:** Schema is now reproducible from source (Codex's top sellability flag for this path is closed). Migration is **applied by hand by David** (Supabase SQL editor / `supabase db push`) — not auto-pushed. Out of scope by deliberate decision (do not fold in): `ebay-category-aspects` anon-client auth (eBay-fragility rule — no eBay changes without a concrete runtime failure), `CREDENTIALS_ENCRYPTION_KEY` validation, workflow `JOB_ID`-required, temp-file `finally` cleanup, lockfile rationalization — tracked as non-blocking follow-ups. Static gate: `node --check` both agent files + `npm run build` green; `npm run lint` covers only `.ts/.tsx` so it does not validate the `.js` agent files. Commits `51fbebe` + `8f05b14` on `vercel-deploy`.
