# Cross-Platform Listing Publisher — Design Spec
**Date:** 2026-04-19  
**Status:** Approved  

## Overview

Add a cross-posting feature to VZT (vendor-zen-tool) so that any listing generated on the platform can be published to multiple selling platforms with one click. VZT is the source of truth. The AI reformats the listing for each target platform automatically. No manual copy-paste.

Inspired by List Perfectly but fully integrated into the existing DOA/eBay/Denver agent architecture.

---

## Platforms in Scope (v1)

| Platform | Publish Method | Notes |
|---|---|---|
| eBay | Existing direct API push | Do not modify — already working |
| LiveAuctioneers | Existing LA batch → CSV export | Do not modify |
| Denver Online Auctions | Existing `denver_batch_rows` → DOA Playwright agent | Do not modify |
| Mercari | New Playwright agent (queue-based) | New agent needed |
| Poshmark | New Playwright agent (queue-based) | New agent needed |
| Etsy | Supabase edge function → Etsy API | New edge function needed |

Facebook Marketplace is explicitly excluded from v1.

Architecture must be extensible — adding a new platform in the future requires only: one registry entry + one agent or edge function.

---

## User Flow

1. User uploads photos and generates a listing in `CreateListing.tsx` (no change to this step)
2. Listing is auto-saved to the `listings` table immediately after generation (provides the `listing_id` for cross-post jobs)
3. `CrossPostPanel` appears below the listing
4. User selects platforms via checkboxes (default: none selected)
5. Optionally clicks "Preview ↓" on any platform to see the AI-reformatted version before posting
6. Clicks "Cross-post to N platforms" — each selected platform is dispatched via its publish method
7. Platform rows update in real time as jobs complete:
   - Mercari / Poshmark / Etsy: real-time via Supabase subscription on `crosspost_jobs`
   - eBay / LA / Denver: local state update (optimistic) — these dispatch synchronously or via existing flows

---

## Data Model

### New table: `crosspost_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `listing_id` | uuid | FK → `listings` (source listing) |
| `batch_id` | uuid | FK → `la_batches` (project context, nullable) |
| `platform` | text | `mercari`, `poshmark`, `etsy` only — existing platforms use their own tables |
| `status` | text | `pending` → `in_progress` → `completed` / `failed` |
| `formatted_data` | jsonb | AI-reformatted payload for this platform |
| `error_log` | text | Error detail on failure, null otherwise |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Note:** `crosspost_jobs` is only for net-new platforms (Mercari, Poshmark, Etsy). eBay, LiveAuctioneers, and Denver continue using their existing tables and flows.

---

## Platform Adapter Registry

**File:** `src/lib/crosspost/registry.ts`

```ts
type PublishType = 'ebay-api' | 'la-csv' | 'denver-agent' | 'queue' | 'etsy-api'

interface PlatformAdapter {
  id: string           // unique platform key
  name: string         // display name
  icon: LucideIcon
  color: string        // tailwind color class
  publishType: PublishType
  description: string  // shown in CrossPostPanel
  formatPrompt?: string // platform-specific AI reformatting instructions (undefined for existing platforms)
}
```

All 6 platforms have a registry entry. The three existing platforms (`ebay-api`, `la-csv`, `denver-agent`) have no `formatPrompt` — their existing generation handles formatting.

### Platform format constraints (for `formatPrompt`)

| Platform | Key Rules |
|---|---|
| Mercari | Title ≤40 chars, casual tone, single category, condition required |
| Poshmark | Brand required, size required, style hashtags, title ≤80 chars |
| Etsy | SEO-optimized title, exactly 13 tags, vintage/handmade framing |

Adding a future platform = one new `PlatformAdapter` object in this file. Nothing else changes.

---

## CrossPostPanel Component

**File:** `src/components/crosspost/CrossPostPanel.tsx`

**Props:**
```ts
interface CrossPostPanelProps {
  listing: GeneratedListing
  images: string[]
  projectId?: string
}
```

**Rendered in `CreateListing.tsx`** after a listing is generated — a single line addition: `<CrossPostPanel listing={generatedListing} images={imageUrls} projectId={selectedProject?.id} />`

**UI Structure:**
- One row per platform from the registry
- Each row: checkbox · platform icon + name · status badge · "Preview ↓" toggle
- Preview is **lazy** — AI reformat call fires only when "Preview ↓" is clicked, not upfront
- "+ Add platform" link opens a dropdown of platforms not currently in the list (future platforms)
- "Cross-post to N platforms" button dispatches all checked platforms
- Real-time status badges update via Supabase subscription on `crosspost_jobs`

**Dispatch logic per platform:**
- `ebay-api` → calls existing eBay API publish function (no change). This is a **single-item direct publish** — distinct from `EbayBatchPanel` which manages batch CSV workflows. Both coexist; CrossPostPanel adds a one-click path for single listings.
- `la-csv` → adds to existing LA batch (no change)
- `denver-agent` → writes to `denver_batch_rows` (no change)
- `queue` (Mercari, Poshmark) → writes `crosspost_jobs` row with `formatted_data`
- `etsy-api` → calls `etsy-publish` Supabase edge function

---

## AI Reformatting

**New Supabase edge function:** `reformat-listing`

Called only for Mercari, Poshmark, and Etsy. Not called for eBay, LA, or Denver.

**Input:**
```json
{
  "platform": "mercari",
  "listing": { "title": "...", "description": "...", "price": 45, "condition": "Used", "category": "...", "imageUrls": [...] },
  "formatPrompt": "..."
}
```

**Output:** Platform-ready payload stored in `crosspost_jobs.formatted_data`.

Reformatted payload is generated once (at Preview or at Cross-post time) and stored — agents do not re-call AI at publish time.

---

## New Playwright Agents

Both agents follow the exact same pattern as the existing DOA/eBay agents.

### Mercari Agent — `doa-listing-agent/mercari-agent/agent.js`
- Polls `crosspost_jobs` for `platform = 'mercari'` and `status = 'pending'`
- Marks row `in_progress`, navigates Mercari sell flow via Playwright
- Fills fields from `formatted_data` (title, description, price, category, condition, photos)
- Marks `completed` or `failed` with `error_log`
- `.env`: Mercari credentials
- `browser-session/`: persisted login session
- `start-mercari-agent.bat`: run launcher

### Poshmark Agent — `doa-listing-agent/poshmark-agent/agent.js`
- Same pattern as Mercari agent, targeting Poshmark's sell flow
- `.env`: Poshmark credentials
- `browser-session/`: persisted login session
- `start-poshmark-agent.bat`: run launcher

Both agents can be added to the existing Windows scheduled task later.

---

## Etsy Publishing

**New Supabase edge function:** `etsy-publish`

- Reads `formatted_data` from the `crosspost_jobs` row
- Calls Etsy API to create a draft listing
- Stores returned Etsy listing ID back into `formatted_data`
- Updates job `status` to `completed` or `failed`
- Etsy API key + OAuth token stored in Supabase secrets

Etsy OAuth setup is a prerequisite — requires a one-time token exchange before first use.

---

## File Changelist

### New files
- `src/lib/crosspost/registry.ts` — platform adapter registry
- `src/components/crosspost/CrossPostPanel.tsx` — cross-post UI panel
- `supabase/functions/reformat-listing/index.ts` — AI reformatting edge function
- `supabase/functions/etsy-publish/index.ts` — Etsy API publisher
- `doa-listing-agent/mercari-agent/agent.js` — Mercari Playwright agent
- `doa-listing-agent/mercari-agent/.env` — Mercari credentials (template)
- `doa-listing-agent/mercari-agent/package.json`
- `doa-listing-agent/poshmark-agent/agent.js` — Poshmark Playwright agent
- `doa-listing-agent/poshmark-agent/.env` — Poshmark credentials (template)
- `doa-listing-agent/poshmark-agent/package.json`
- `start-mercari-agent.bat`
- `start-poshmark-agent.bat`
- `supabase/migrations/<datestamp>_crosspost_jobs.sql` — new table migration (filename uses actual date at creation time)

### Modified files
- `src/pages/CreateListing.tsx` — add `<CrossPostPanel />` after generation (one line)
- `src/lib/api/listings.ts` — add `createCrosspostJob()` helper

### Untouched (explicitly)
- All existing eBay API publish logic
- `EbayBatchPanel.tsx` and related eBay components
- LA batch flow and CSV export
- DOA agent and `denver_batch_rows` flow

---

## Success Criteria

- User can generate a listing and cross-post to any combination of eBay, LA, Denver, Mercari, Poshmark, Etsy from one panel
- Each platform receives a correctly formatted listing (title length, required fields, tone)
- Mercari and Poshmark jobs appear in `crosspost_jobs` and agents process them
- Status updates in the panel in real time as agents complete jobs
- Adding a 7th platform in the future requires no changes to `CrossPostPanel.tsx` or `CreateListing.tsx`
- Existing eBay, LA, and Denver flows are unaffected
