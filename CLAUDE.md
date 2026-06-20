# CLAUDE.md — Vendor Zen Tool (VZT)
mission_control_id: f254f906-3942-4b8a-815d-11a6112599d9

**Read first:** `~/.claude/CLAUDE.md` (operator profile) before this file.
**Status:** Multi-tenant transition in progress. Tier 1 — protected.

---

## What This Is

VZT is the internal operations tool for JSG Estate Liquidators. It manages the full listing pipeline: intake, photo processing, listing creation, and multi-platform publishing (DOA, LiveAuctioneers, eBay, EstateSales.net). Currently single-tenant (JSG internal). Multi-tenant transition underway — the goal is a SaaS platform for other auction houses and estate liquidators.

This is a cash-flow-generating production tool. Do not break it.

---

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS
- **Backend:** Supabase (Postgres, auth, edge functions, storage)
- **Hosting:** Vercel
- **Image processing:** `@imgly/background-removal` (client-side)
- **Testing:** Vitest + Testing Library

---

## Commands

```bash
npm run dev      # dev server (Vite)
npm run build    # production build
npm run lint     # ESLint
npx vitest       # run tests
```

---

## Sub-modules

- `doa-bulk-upload/` — workflow docs for bulk image upload to Denver Online Auctions
- `doa-listing-agent/` — DOA listing automation agent
- `estatesales-agent/` — EstateSales.net listing agent

---

## Key Pages

- `Index.tsx` — dashboard / home
- `Inventory.tsx` — inventory management
- `CreateListing.tsx` — listing creation pipeline
- `Platforms.tsx` — platform integration settings
- `DenverBatches.tsx` — DOA batch management
- `EstateSalesUpload.tsx` — EstateSales upload workflow
- `Orders.tsx` — order management
- `Projects.tsx` — project/batch grouping
- `Settings.tsx` — app settings

---

## Protection Rules (Tier 1)

1. All changes get Codex second-opinion review before merge
2. Staging Supabase environment separate from production — test there first
3. Automated tests must pass on listing generation + image processing pipelines
4. Every architectural change logged in `decisions.md` with reasoning
5. No Lovable for this project — Claude Code + Codex only

---

## Multi-Tenant Transition Notes

- Single-tenant today: all data scoped to JSG
- Target: per-tenant data isolation via RLS, tenant-scoped Supabase rows
- Before first paying tenant: feature flags, manual deploy approval gate, health monitoring in MC dashboard, tenant data isolation testing, incident response playbook
- Bus factor: JJ (tier 1 secondary), Vinnie (tier 2 runbook execution only)

---

## Env Vars Needed

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
MC_SUPABASE_URL=https://dmtctlpzlfpcogpjweuv.supabase.co
MC_SUPABASE_ANON_KEY=<personal-os anon key>
```

---

## Self-Improving AI Loop (Hermes Loop)

VZT has a fully closed 3-stage corrective knowledge loop. Any agent touching the listing pipeline must understand this to avoid breaking it.

**Stage 1 — Capture:** When an operator accepts a changed AI output (title or item_specifics changed), `captureCorrection()` in `EbayBatchPanel.tsx` writes the before/after to `listing_corrections` and fires `distill-lessons` + `embed-corrections` fire-and-forget.

**Stage 2 — Distill:** `distill-lessons` edge function (Sonnet 4.6) triggers after every capture. When 5+ undistilled corrections have accumulated, it synthesises them into general rules in `listing_correction_lessons`. Do not downgrade this function to Haiku — it needs reasoning quality to find patterns across corrections.

**Stage 3 — Re-inject:** Every evaluative AI call reads up to 5 active lessons via `authedClient` (RLS-scoped — do NOT use anon client) and prepends a `=== LEARNED LESSONS ===` block to the system prompt.

**Which functions are closed:**
- `generate-listing` — reads lessons at lines ~935-940
- `refine-listing` (verify mode only) — reads lessons before building system prompt; refine mode is intentionally excluded (directive mode — user gives specific instruction, lessons cause drift)

**Do not inject lessons into refine mode.** It is directive. If the user says "change the title to X", the AI should only change the title. Learned lessons in that context risk unwanted modifications to other fields.

**Key tables:** `listing_corrections`, `listing_correction_lessons`, `correction_injections`
**authedClient pattern:** `createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })`

See `~/.claude/skills/hermes-loop/SKILL.md` for the portable framework (adapts to any domain).

---

## Standing Rules

- Never push directly to main without review
- Cost-log every API call to `model_costs` table
- Session end: push to GitHub + update Mission Control via MC skill
- Session start: pull `next_action` from Mission Control before doing anything

---

## Last Updated

2026-06-11
