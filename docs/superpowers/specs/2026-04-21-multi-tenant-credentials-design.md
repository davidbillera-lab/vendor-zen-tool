# Multi-Tenant Credential System — Design Spec
**Date:** 2026-04-21  
**Status:** Approved

---

## Goal

Each user authenticates with their own Mercari, Poshmark, and DOA marketplace accounts. No user shares David's credentials. Credentials are stored per-user in Supabase, fetched at runtime by the Playwright agents.

## Out of Scope

- Agent deployment / hosting model (decided later)
- eBay OAuth (already complete)
- EstateSales (already complete)
- LiveAuctioneers, Facebook Marketplace (no Playwright agent yet)

---

## 1. Database

Three new tables following the `user_estatesales_credentials` pattern exactly.

### `user_mercari_credentials`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | unique, not null |
| mercari_email | text | not null |
| mercari_password | text | not null |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `user_poshmark_credentials`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | unique, not null |
| poshmark_email | text | not null |
| poshmark_password | text | not null |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `user_doa_credentials`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | unique, not null |
| doa_email | text | not null |
| doa_password | text | not null |
| doa_first_lot_url | text | nullable (optional, used by DOA agent) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**RLS policy for all three tables (same pattern):**
- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id`
- `UPDATE`: `auth.uid() = user_id`
- `DELETE`: `auth.uid() = user_id`

---

## 2. Settings UI

Add three credential cards to `src/pages/Settings.tsx`, one per platform, inserted after the existing eBay Connection section.

Each card:
- Platform name + icon header
- Email input (type="email")
- Password input (type="password", masked)
- Save button — upserts the row in Supabase
- Status badge — "Connected" (green) if a row exists, "Not configured" (gray) if not
- Disconnect button — deletes the row (only shown when Connected)

Component location: `src/components/credentials/` — one component per platform:
- `MercariCredentialsCard.tsx`
- `PoshmarkCredentialsCard.tsx`
- `DoaCredentialsCard.tsx`

All three use the same local state shape: `{ email, password, isConnected, isSaving }`.

---

## 3. Onboarding Gate

When a user has a platform enabled (e.g. Mercari toggled ON in Settings > Active Platforms) but has no credentials saved for it, the CrossPostPanel should show an inline warning for that platform:

> "Connect your Mercari account in Settings before cross-posting."

This is a UI-only guard — no hard block on saving drafts. The warning appears at the moment the user tries to dispatch to an unconfigured platform.

Implementation: before dispatching a platform job in `src/lib/crosspost/api.ts` (or the CrossPostPanel component), check whether the user has credentials for that platform. If not, surface the warning instead of inserting the `crosspost_jobs` row.

---

## 4. Agent Updates

### Pattern (same for all three agents)

Each agent already reads `user_id` from the `crosspost_jobs` row it picks up. Add a `fetchCredentials(supabase, userId)` function to each agent that:

1. Queries the relevant credentials table for `user_id = userId`
2. Returns `{ email, password, ... }`
3. If no row found, falls back to `.env` values (preserves David's existing setup)

The credentials object replaces the current `process.env.MERCARI_EMAIL` / `process.env.MERCARI_PASSWORD` references.

### Files to modify

| Agent | File | Change |
|-------|------|--------|
| Mercari | `doa-listing-agent/mercari-agent/agent.js` | Add `fetchCredentials()`, pass creds to login step |
| Poshmark | `doa-listing-agent/poshmark-agent/agent.js` | Add `fetchCredentials()`, pass creds to login step |
| DOA | `doa-listing-agent/doaAgent.js` | Add `fetchCredentials()`, pass creds to login step; also use `doa_first_lot_url` if present |

### Supabase client in agents

All three agents already have a Supabase client initialized from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (or add one if missing — see EstateSales agent for the pattern). Service role is required to read credentials tables on behalf of a user (agents run server-side, outside the auth session).

---

## 5. Credential Storage Security

Passwords are stored as plaintext text columns in Supabase (same as `user_estatesales_credentials`). RLS ensures each user can only see their own row. The service role key used by agents is never exposed to the browser.

For a future hardening pass: encrypt passwords at rest using Supabase Vault or pgcrypto. Out of scope for this iteration.

---

## 6. Success Criteria

- [ ] User can save Mercari, Poshmark, and DOA credentials in Settings
- [ ] Status badge shows "Connected" after saving
- [ ] User can disconnect (delete) credentials
- [ ] Mercari agent uses DB credentials when `user_id` has a row; falls back to `.env` if not
- [ ] Poshmark agent same
- [ ] DOA agent same
- [ ] CrossPostPanel warns when user tries to post to Mercari/Poshmark without saved credentials
- [ ] David's own `.env`-based setup continues to work unchanged
