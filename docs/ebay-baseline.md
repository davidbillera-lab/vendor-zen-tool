# eBay System — Golden Master Baseline

**Anchor commit:** `4a78b00` on branch `vercel-deploy`
**Date captured:** 2026-06-11
**Status at capture:** Fully working. eBay publish, OAuth, enrich, promoted listings, category learning all operational.

Use this document to diff against after any break. If behavior diverges from what's described here, this is the known-good reference.

---

## Files Covered

| File | Lines | Role |
|---|---|---|
| `supabase/functions/ebay-publish/index.ts` | 806 | Full publish pipeline — auth, QA agent, XML build, Trading API call, retry, promoted listings, category learning |
| `supabase/functions/ebay-oauth/index.ts` | 321 | OAuth 2.0 consent flow, credential management, per-user refresh_token storage |
| `supabase/functions/enrich-ebay-batch/index.ts` | 80+ | Sonnet-based batch item-specifics enrichment (called pre-publish from UI) |
| `supabase/functions/suggest-ebay-category/index.ts` | — | Taxonomy API category suggestion wrapper |

---

## OAuth Architecture

**Model:** Multi-tenant SaaS. App credentials are shared; tokens are per-user.

- **Shared app creds (env vars):** `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`
- **Per-user storage:** `user_ebay_credentials` table — columns: `user_id`, `refresh_token`, `connected_at`, `updated_at`. Upsert on conflict `user_id`.
- **Token grant:** `refresh_token` → POST to eBay OAuth token URL → `access_token` (short-lived, used per-request). No long-lived access tokens stored.
- **Token format detection:** `v^1.1` prefix = Auth'n'Auth (wrong type, won't work). `v^1` prefix without `.1` = OAuth 2.0 (correct).

### Required Scopes (DO NOT ADD `commerce.media.upload`)

```
api_scope
sell.inventory
sell.account
sell.fulfillment
sell.marketing
```

`commerce.media.upload` was intentionally removed 2026-05-30. The eBay app keyset (`DavidBil-zapier-PRD-*`) is not provisioned for it — adding it back causes `invalid_scope` and breaks the entire OAuth flow.

### OAuth Actions (`ebay-oauth/index.ts`)

- `get_auth_url` — returns eBay consent URL using `EBAY_RUNAME`
- `exchange_code` — exchanges auth code for refresh_token, upserts to DB
- `get_status` — returns connected/disconnected status for current user
- `disconnect` — deletes the user's credential row
- `test_credentials` / `diagnose` — admin diagnostic tools

### Known Error Meanings

| Error | Cause |
|---|---|
| `invalid_grant` | Expired refresh_token or wrong token type (Auth'n'Auth vs OAuth 2.0) |
| `invalid_client` | Bad `EBAY_CLIENT_ID` or `EBAY_CLIENT_SECRET` env var |
| `invalid_scope` | Scope in DB token doesn't match requested scopes — usually caused by adding `commerce.media.upload` |

---

## Publish Pipeline (`ebay-publish/index.ts`)

### Invocation

POST to the function with:
```json
{
  "rows": [{ ...EbayRow fields... }],
  "test_auth_only": false
}
```

Auth header (JWT) required. Function decodes it to look up the user's refresh_token.

### EbayRow Fields Used

```typescript
id, lot_number, title, description, price, category, condition,
item_specifics,      // Record<string,string> | null
image_urls,          // string[]
shipping_type, shipping_cost, handling_time,
returns_accepted, return_period, return_shipping,
best_offer_enabled, best_offer_auto_accept, minimum_best_offer,
brand, upc, mpn, subtitle, promotion_rate, custom_sku
```

### Pipeline — Step by Step

```
1. Guard check
   └─ If no numeric category ID → immediate fail ("Category required")

2. getRequiredAspectsForCategory(categoryId)
   └─ Client-credentials token → eBay Taxonomy API
   └─ Filters aspectRequired=true OR aspectUsage="REQUIRED"
   └─ Returns string[] of aspect names

3. runPrePublishQA(row, categoryId, categoryName, requiredAspects)
   └─ Model: Haiku 4.5 (multimodal, up to 4 image URLs)
   └─ Returns: { categoryOk, filledSpecifics, reasoning }
   └─ If categoryOk=false: calls Taxonomy API to resolve new categoryId
   └─ QA-filled specifics NEVER overwrite existing user values
   └─ NON-FATAL — errors here do not block publish

4. Merge item_specifics
   └─ Priority: user values > QA-filled values > category defaults

5. buildAddFixedPriceItemXml(row)
   └─ See "XML Defaults" section below

6. POST to eBay Trading API
   └─ See "Trading API Call Shape" section below

7. Parse response
   └─ Ack = "Success" or "Warning" → success (Warning = non-fatal eBay notices)
   └─ Ack = "Failure" → check error codes

8. Auto-retry on category errors
   └─ Error code 87 (invalid category) or 107 (non-leaf category)
   └─ Triggers Taxonomy API lookup for valid leaf category
   └─ One automatic retry with corrected categoryId

9. Apply Promoted Listings (if promotion_rate > 0)
   └─ See "Promoted Listings" section below

10. Record category learning on success
    └─ record_category_learning RPC: keyword → categoryId mapping
```

### Trading API Call Shape

```
URL: https://api.ebay.com/ws/api.dll
Method: POST
Content-Type: text/xml

Headers:
  X-EBAY-API-CALL-NAME: AddFixedPriceItem
  X-EBAY-API-SITEID: 0
  X-EBAY-API-COMPATIBILITY-LEVEL: 1193
  X-EBAY-API-IAF-TOKEN: <accessToken>
```

### JSG Hardcoded XML Defaults

These are **always** set by `buildAddFixedPriceItemXml`. Do not expect the frontend to provide them.

| Field | Value |
|---|---|
| DispatchTimeMax | 1 |
| ListingDuration | GTC |
| ListingType | FixedPriceItem |
| Location | Highlands Ranch CO |
| PostalCode | 80129 |
| Quantity | 1 |
| ShippingType | Flat |
| ShippingService | USPSFirstClass |
| ShippingCost | $9.98 (overrideable via `shipping_cost`) |
| ReturnsAccepted | Returns accepted |
| RefundOption | MoneyBack |
| ReturnsWithinOption | Days_30 |
| ShippingCostPaidBy | Seller |

Title is truncated to 80 chars. Max 12 pictures.

### Category-Specific Item Specifics Injection

Injected by `buildAddFixedPriceItemXml` — these fire AFTER user values are merged, and only fill keys that aren't already set.

**Model kits** (categories: 31787, 37278, 51023, 19063):
- `Shade = Multicolor`
- `Type = Scale Model Kit`
- `Brand = Unbranded`

**Fragrances** (categories: 11848, 11849, 11850, 11846, 31786, 177989, 177990):
- `Fragrance Name` — extracted from title, strips oz/ml/type suffixes, 65-char limit
- `Type = Eau de Parfum`
- `Volume` — regex extracted from title (e.g., "3.4 oz")

**Men's clothing** (categories: 21235, 57990, 57991, 11483, 57989, 11484, 3001, 15709, 24087, 53120, 4250):
- `Department = Men`
- `Size = See Description`

**Women's clothing** (categories: 63862, 53159, 63861, 11554, 63866, 185176, 55793, 45333, 95672, 169291):
- `Department = Women`
- `Size = See Description`

**Universal fallback** (all categories):
- `Compatible Brand = "Does Not Apply"` — injected if `Compatible Brand` not already set

### Condition ID Mapping

```
"New" / "New in Box"             → 1000
"Used"                           → 3000
"Pre-owned"                      → 3000  (eBay maps both Used/Pre-owned → 3000)
"Like New" / "Open Box"          → 1500
"Very Good" / "Good"             → 2000
"Acceptable" / "Fair"            → 2500
"For Parts" / "Not Working"      → 7000
(default if unrecognized)        → 3000
```

---

## Enrich Pipeline (`enrich-ebay-batch/index.ts`)

Called from the UI before publish to pre-fill item_specifics.

- Model: Sonnet (or equivalent mid-weight — reads code closely to infer from title/description)
- Input: batch of rows with `{id, title, description, category, condition, item_specifics, image_urls}`
- Output: array of `{id, item_specifics (merged), category_id (or null)}`
- Rule: NEVER removes existing specifics. Only ADDS missing ones.
- Returns enriched item_specifics as a complete merged object (existing + new)

---

## Promoted Listings (`ebay-publish/index.ts` — `applyPromotedListings()`)

Fires after successful publish if `promotion_rate > 0` on any row.

- Scope required: `sell.marketing`
- Campaign type: `PROMOTED_LISTINGS_STANDARD`
- Campaign name format: `"JSG Auto-Promote X%"` (creates if not found, reuses if exists)
- API call: `bulk_create_ads_by_listing_id` with the listingId returned from AddFixedPriceItem

---

## Hermes Loop Interaction

The publish pipeline integrates with the self-correcting knowledge loop (Hermes Loop):

- `generate-listing` edge function reads up to 5 active lessons from `listing_correction_lessons` via authedClient (RLS-scoped) — prepends `=== LEARNED LESSONS ===` block to system prompt
- `refine-listing` in VERIFY mode also reads lessons
- `refine-listing` in REFINE (directive) mode deliberately does NOT read lessons — user gave a specific instruction; lessons cause unwanted drift

Relevant tables: `listing_corrections`, `listing_correction_lessons`, `correction_injections`

**Do not** switch lesson reads to anon client — RLS filters to zero rows without the user's JWT in the auth header.

---

## Known-Good Response Patterns

### Successful publish
```xml
<Ack>Success</Ack>
<ItemID>123456789012</ItemID>
```

### Success with eBay notices (non-fatal)
```xml
<Ack>Warning</Ack>
<ItemID>123456789012</ItemID>
<Errors><SeverityCode>Warning</SeverityCode>...</Errors>
```
Warnings do not block the listing. The item is live.

### Category error (auto-retried)
```xml
<Ack>Failure</Ack>
<Errors><ErrorCode>87</ErrorCode>...</Errors>  <!-- invalid category -->
<Errors><ErrorCode>107</ErrorCode>...</Errors> <!-- non-leaf category -->
```
Function automatically queries Taxonomy API and retries once with corrected category.

### Auth error (not retried)
```xml
<Ack>Failure</Ack>
<Errors><ErrorCode>21917053</ErrorCode>...</Errors> <!-- token expired -->
```
Return 401 to frontend. User must re-connect eBay account.

---

## What Has Never Been Touched / Known Fragile Points

- **Do not add `commerce.media.upload` to scopes** — app keyset not provisioned for it
- **Do not change `X-EBAY-API-COMPATIBILITY-LEVEL`** from 1193 without testing
- **Do not use anon client for lesson reads** in generate-listing / refine-listing — must be authedClient with user JWT
- **Do not inject lessons into refine mode** (directive path) — already explicitly excluded, keep it that way
- **`connected_at` column must exist** in `user_ebay_credentials` — upsert writes it on exchange_code; absence caused a past break (see memory `ebay_oauth_break_fix_runbook.md`)

---

## Quick Diagnostic Checklist (when eBay breaks)

1. **Auth issue?** Check `ebay-oauth` logs. Error `invalid_grant` = expired token, `invalid_scope` = someone added a scope, `invalid_client` = env var problem.
2. **Publish failing pre-Trading-API?** Check for "Category required" in logs — means `category` column is null/non-numeric for the row.
3. **XML rejected by eBay?** Error code 87/107 = category — pipeline auto-retries, so if it's still failing after retry, Taxonomy API call is broken. Check client_credentials grant.
4. **Promoted listings failing?** Scope `sell.marketing` must be in the user's token. Reconnecting eBay re-grants it.
5. **Lessons not applying?** `generate-listing` must use authedClient with `Authorization: Bearer <userJwt>` header — if using anon key, RLS returns zero lessons silently.
6. **Diff against this baseline:** Compare `ebay-publish/index.ts` against commit `4a78b00` to spot what changed.
