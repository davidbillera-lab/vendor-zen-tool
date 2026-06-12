# HANDOFF — EstateSales dedup ledger + progress visibility

**Date:** 2026-06-12 (early UTC). Written so a fresh Claude Code session can finish this work cold.
**Branch:** `vercel-deploy` (all uncommitted work lives here).
**Read first:** `~/.claude/CLAUDE.md`, project `CLAUDE.md`, memory files `estatesales_agent_ci_ops.md` and `estatesales_job_blocker.md`.

---

## What this build is

David's directive: *"I would like to fix the issue with not being able to see where it left off. I would rather not have a bunch of duplicates so that is a priority."*

Two features for the DOA → EstateSales.net upload agent:
1. **Dedup ledger** — re-runs skip lots already uploaded to the same ES sale (no duplicates after a mid-run failure).
2. **Progress visibility** — `lots_scraped` / `lots_uploaded` written to the job row during the run, shown in the VZT UI.

---

## State: DONE ✅

### 1. Database migration — APPLIED. Do NOT re-apply.
Supabase project **atgrxqfxysvppqoyvjdd**, table `public.estatesales_uploaded_lots`:
- `id uuid pk default gen_random_uuid(), user_id uuid, job_id uuid, es_url text not null, lot_url text not null, lot_number text, lot_title text, uploaded_at timestamptz default now()`
- `UNIQUE (es_url, lot_url)`; RLS enabled; select-only policy `auth.uid() = user_id`.
- Agent uses the service-role key (bypasses RLS) so no insert policy is needed. Ledger starts empty — zero lots have ever uploaded, so there's no backfill problem.

### 2. `estatesales-agent/agent.js` — ALL edits complete, `node --check` passes. UNCOMMITTED.
What changed (all 8 edit groups landed):
- New helpers after `updateJobStatus`: `updateJobFields()`, `fetchUploadedLotUrls()` (**fails closed** — throws if the ledger can't be read; duplicates are worse than a blocked run), `recordUploadedLot()` (upsert `onConflict: 'es_url,lot_url', ignoreDuplicates: true`; insert failure is a non-fatal warning).
- Both `lots.push` sites (admin + public scrape modes) now capture `source_url: url` — the stable DOA `/auction-details?id=N` link, used as the dedup key.
- `uploadLots()` head: reads the ledger **before ES login**, filters to `pending`, early-returns `{ succeeded: 0, failed: 0, failedLots: [], skipped }` if nothing pending; fetches the job's `user_id` for ledger rows.
- Upload loop iterates `pending` (not `lots`); after each save calls `recordUploadedLot()` and writes `lots_uploaded` every 5 saves.
- `uploadLots` return includes `skipped`.
- `run()`: writes `lots_scraped` after Phase 1, `lots_uploaded` after Phase 2 (before the partial throw); partial-failure message uses attempted count (`lots.length - uploadResult.skipped`).

---

## State: REMAINING (in order)

### 3. `src/pages/EstateSalesUpload.tsx` (250 lines) — not yet edited
- **Job interface** (lines ~18-25): add `lots_scraped: number | null; lots_uploaded: number | null;` and add `"partial_failed"` to the status union (currently `"pending" | "running" | "completed" | "failed"` — partial_failed currently falls back to looking like "Pending", a known display bug).
- **loadJobs select** (~line 43): add `, lots_scraped, lots_uploaded` to the `.select(...)` string.
- **STATUS_CONFIG** (~lines 203-208): add `partial_failed: { label: "Partial", Icon: AlertCircle, cls: "text-orange-600 bg-orange-500/10", spin: false },` (AlertCircle is already imported).
- **JobCard** (~lines 210-249): near the created_at paragraph (~237-239), show "{lots_uploaded} of {lots_scraped} lots uploaded" when `lots_scraped` is non-null.
- Note: table is accessed via `from("estatesales_jobs" as any)`, so the types.ts mismatch is non-blocking. Page auto-refreshes every 10s.

### 4. `decisions.md` entry (Tier 1 rule — new table = architectural change)
Log the `estatesales_uploaded_lots` table: why (resume-after-failure without duplicates), keying choice `(es_url, lot_url)`, fail-closed read, service-role writes / select-only RLS.

### 5. Commit + dual-branch deploy
- Commit everything on `vercel-deploy` and push. **Do NOT touch eBay, enhance-image, or main.**
- The CI workflow runs from the repo **default branch `claude/debug-doa-automation-6YiEc`**, NOT vercel-deploy. `agent.js` must ALSO land there via GitHub contents-API PUT (UI/decisions.md changes only need vercel-deploy).
- Verify parity: `git hash-object --no-filters estatesales-agent/agent.js` must equal the API blob sha (plain `hash-object` applies CRLF filter and mismatches).
- PS 5.1 traps: no double quotes inside here-string commit messages; `--jq` with embedded quoted spaces breaks arg splitting.
- Leave David's local files alone: untracked `doa-listing-agent/doa-images-2026-06-11.zip`, modified `doa-listing-agent/DROP-HERE/START-URL.txt`, untracked `HANDOFF-bug2.md` (David's, unrelated).

### 6. Memory file updates (`~/.claude/projects/c--Users-david-vendor-zen-tool/memory/`)
- `estatesales_job_blocker.md` — STALE: says wait for creds re-save > 2026-06-11 23:11:47; reality: creds re-saved 05:10:44 UTC 2026-06-12 were ALSO rejected (run 27395981717 screenshot, same wrong-credentials banner). Blocker is credential-side: persists until David's manual browser sign-in succeeds; suspect Google-SSO-only account.
- `estatesales_agent_ci_ops.md` — the line "Known product gaps: no dedup/skip (re-runs duplicate listings), price always $0" → dedup is fixed once this ships; price $0 gap remains.

### 7. Session end: Mission Control sync (mc_* MCP tools work; VZT id `f254f906-3942-4b8a-815d-11a6112599d9`) + operator report.

---

## Open blocker (on David, not code)

ES login fails with "Email Address: jsgliquidators@gmail.com and/or Password was incorrect." on runs 27393111613 AND 27395981717 — even after creds were re-saved. Root cause is credential-side (wrong password or Google-SSO-only account). David needs to: manually test sign-in at estatesales.net/sign-in → Forgot Password if needed → save working password in VZT Settings. **Do NOT dispatch test runs until then.** David dispatches manually:
`gh workflow run estatesales-agent.yml --repo davidbillera-lab/vendor-zen-tool --ref claude/debug-doa-automation-6YiEc -f job_id=<id> -f triggered_by=<label>`

After login works, next untested territory: the ES sale-wizard upload flow (~199 lots; expect new selector issues; price always $0 is a known gap).

---

## Standing constraints (verbatim, still in force)

- "Do NOT touch eBay, enhance-image, or main."
- "Never print the PAT" — or any tokens/keys from `.env.local` (SUPABASE_ACCESS_TOKEN lives there).
- "cancel the scheduled wake up I can active the agent manually" — NO loops/wakeups/crons. David triggers runs from the VZT UI / gh CLI.
- Tier 1 project: Codex second-opinion review on architecturally important commits; blast radius here is one additive table nothing else reads + agent-only code + read-only UI additions.
