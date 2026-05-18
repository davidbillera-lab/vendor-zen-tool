# Inline Listing Editor + AI Tool Fix

**Date:** 2026-05-16  
**Status:** Approved  
**Scope:** `src/pages/CreateListing.tsx`, `src/components/ebay/EbayBatchPanel.tsx`

---

## Problem

After AI generates a listing, the preview panel shows title, description, price, and condition as static read-only text. To edit anything the user must click "Start Next Item," navigate back, and re-enter edits — an unnecessary round-trip that slows the workflow.

Additionally, the AI Verify and AI Refine tools in the eBay flow are silently disabled whenever no project is selected at generation time, because they require a saved DB row (`ebay_batch_rows`) to function. Users working without a project selected lose access to AI editing entirely.

---

## Solution

### Part 1 — Inline Editable Preview (all platforms)

Replace the static `<p>` text in the generated listing preview with live form inputs. Changes write directly to `generatedListing` state on every keystroke, so the listing is always up-to-date before being pushed to any platform.

**Fields:**
| Field | Component | Notes |
|-------|-----------|-------|
| Title | `<Input>` | Single line |
| Description | `<Textarea>` | Scrollable, auto-height |
| Price | `<Input type="number">` | Positive values only |
| Condition | `<Input>` | Or existing `<Select>` if present |

**State write:**
```tsx
setGeneratedListing(prev => ({ ...prev, [field]: value }));
```

**eBay DB sync (optional, non-blocking):**  
If a `lastEbayRow` exists (project was selected at generation), a 600ms debounce fires a Supabase `update` to keep the DB row in sync. If no row exists, changes live in `generatedListing` state only — no error, no gate.

**Platform coverage:** This preview block is shared across LiveAuctioneers, Denver Auctions, Facebook, Mercari, Poshmark, and Etsy. The same edit applies everywhere.

---

### Part 2 — Fix AI Verify / Refine (eBay)

Both `handleEbayVerify` and `handleEbayRefine` currently read their payload from `lastEbayRow` (the last saved Supabase row) and return early if it's undefined. This breaks whenever no project is selected.

**Fix:** Build the payload from `generatedListing` state directly. The DB row is still updated after a successful verify/refine if one exists, but it is no longer a prerequisite.

**Disable guard change:**
```tsx
// Before
disabled={ebayVerifying || ebayRefining || ebayRows.length === 0}

// After
disabled={ebayVerifying || ebayRefining || !generatedListing}
```

This means the AI tools activate the moment a listing is generated, regardless of project selection.

---

## Files Changed

| File | Change |
|------|--------|
| `src/pages/CreateListing.tsx` | Replace static preview `<p>` tags with `<Input>`/`<Textarea>`; add `setGeneratedListing` handlers; add debounced eBay DB sync |
| `src/components/ebay/EbayBatchPanel.tsx` | Fix `handleEbayVerify` and `handleEbayRefine` to read from `generatedListing`; update disable guard |

---

## Out of Scope

- AI Verify/Refine for non-eBay platforms (LiveAuctioneers, Denver, Facebook, etc.) — those platforms do not currently have verify/refine handlers; separate work
- Persisting `generatedListing` edits to platforms other than eBay — changes flow into the existing push/submit handlers naturally via state
- Changing the "Start Next Item" flow — that button still resets state as before; inline editing just removes the need to use it for edits

---

## Acceptance Criteria

1. Generate a listing → title, description, price fields are immediately editable in-place
2. Edit the title → `generatedListing.title` updates in state; pushing to any platform uses the edited value
3. With no project selected → generate an eBay listing → AI Verify button is enabled → clicking it runs verification
4. With a project selected → edit title inline → Supabase row updates within ~600ms
5. Build passes with no new TypeScript errors
