# eBay CSV Upload Rules — JSG Liquidators

Reference for all eBay bulk upload requirements, known failures, and JSG standard settings.
**Update this file every time a new rejection is discovered and fixed.**

---

## JSG Standard Listing Settings (Hardcoded in Vendor Zen)

| Field | Value | Notes |
|-------|-------|-------|
| Shipping service | `USPSGroundAdvantage` | USPS Ground Advantage |
| Shipping cost | `$9.98` flat rate | All listings |
| Format | `FixedPrice` | |
| Duration | `GTC` (Good Till Cancelled) | |
| Returns | `ReturnsAccepted`, 30 days, MoneyBack, Seller pays return shipping | |
| Handling time | 1 day | |
| Promoted Listings | 5% General campaign | Set in Seller Hub → Marketing → Promoted Listings → auto-enroll all listings. NOT in CSV — must be configured once as an always-on campaign. |

---

## Deprecated / Remapped Category IDs

Never use these. eBay either rejects (parent) or silently remaps to the wrong category.

| Bad ID | Problem | Use Instead |
|--------|---------|-------------|
| 1188 | Toys & Hobbies — parent category | 31787 |
| 51028 | Models & Kits — parent category | 31787 |
| 2611 | Aircraft Model Kits — eBay remaps to 183454 (video games), causes wrong required fields | 31787 |
| 20601 | Bedding — parent category | 20668 |
| 19130 | Old HO Scale Trains ID | 262318 |

---

## Known Good Leaf Category IDs

| ID | Category | Notes |
|----|----------|-------|
| 31787 | Military & Aircraft Model Kits | Use for all military vehicles, tanks, planes, any scale |
| 37278 | Ship/Boat Model Kits | |
| 51023 | Car/Truck Model Kits (non-military) | |
| 19063 | Figure Model Kits | |
| 262318 | HO Scale Model Trains | |
| 47006 | N Scale Model Trains | |
| 47004 | O Scale Model Trains | |
| 20668 | Blankets & Throws | eBay internally remaps to 133704 — that's fine |
| 133704 | Throws (eBay's remapped blanket ID) | Treat same as 20668 |
| 11724 | Camcorders & Video Cameras | |
| 15230 | Vintage Cameras | |
| 20625 | Kitchen Knives & Cutlery Sets | Paring knives, chef knives, cutlery sets |

---

## Required Item Specifics by Category

eBay rejects with **error 21919303** if these fields are missing. All auto-filled by Vendor Zen where a default exists.

| Category | Required Field | Auto-fill Default | Error if Missing |
|----------|---------------|-------------------|-----------------|
| 31787, 37278, 51023, 19063 (model kits) | `Shade` | `Multicolor` | 21919303 |
| 20668 / 133704 (blankets) | `Model` | *(must fill manually — use product line name e.g. "Silky Soft")* | 21919303 |

**Where coded:** `CATEGORY_REQUIRED_SPECIFICS` in `src/components/ebay/EbayBatchPanel.tsx`

---

## Condition ID Constraints by Category

eBay error **21916883** — "condition id is invalid for the selected primary category."

| Category | Allowed Conditions | NOT Allowed | Rule |
|----------|--------------------|-------------|------|
| 31787, 37278, 51023, 19063 (model kits) | 1000 (New), 1500 (New Other) | 3000 (Used) | Vintage unbuilt kits with shelf wear → use 1500 |
| 11724 (camcorders) | 3000 (Used), 7000 (For Parts) | 1000 (New) | Most camcorders are used |

**Condition ID reference:**
- `1000` = New (sealed, factory fresh)
- `1500` = New Other (unbuilt/unused but open box or shelf wear)
- `3000` = Used / Pre-owned
- `7000` = For parts or not working

**Where coded:** `MODEL_KIT_CATEGORIES` set + condition guard in `EbayBatchPanel.tsx` — auto-downgrades Used → New Other for model kit categories.

---

## Field Character Limits

eBay error **21919308** if exceeded.

| Field | Max Characters | Notes |
|-------|---------------|-------|
| Title | 80 | Auto-truncated |
| `C:Model` | 65 | Auto-truncated |
| `C:MPN` | 65 | Auto-truncated |
| `C:Series` | 65 | Auto-truncated |

**Where coded:** `SPECIFIC_CHAR_LIMITS` in `EbayBatchPanel.tsx`

---

## Field Value Rules

| Field | Rule | eBay Error |
|-------|------|-----------|
| `C:Year Manufactured` | Must be a numeric year (e.g. `1985`) or blank. Never `"Unknown"`. | 21919312 |
| Duplicate listing | eBay blocks identical listings from same seller. Check Seller Hub before re-uploading. | 21919067 |

---

## How to Handle Upload Failures

1. Download the error report CSV from **Seller Hub → Reports → Uploads**
2. Match `ErrorCode` to the table below:

| Error Code | Meaning | Fix |
|------------|---------|-----|
| 21919303 | Missing required item specific (field name in error message) | Add field to `CATEGORY_REQUIRED_SPECIFICS` in EbayBatchPanel.tsx |
| 21919312 | Invalid value in item specific (e.g. "Unknown" in Year field) | Clear the field or use a valid value |
| 21916883 | Condition ID invalid for category | Check allowed conditions table above; auto-fix is in EbayBatchPanel.tsx |
| 21919308 | Item specific value too long | Add to `SPECIFIC_CHAR_LIMITS` in EbayBatchPanel.tsx |
| 21919067 | Duplicate listing — identical item already live | Delete the old listing or skip this row |
| 87 | Category is not a leaf category (parent ID used) | Add to `DEPRECATED_CATEGORIES`, find correct leaf ID |
| 20505 | Category remapped (warning, not failure) | Update `DEPRECATED_CATEGORIES` to point to new ID |

---

## After Every Fix

1. Update `DEPRECATED_CATEGORIES` and/or `CATEGORY_REQUIRED_SPECIFICS` in [EbayBatchPanel.tsx](../src/components/ebay/EbayBatchPanel.tsx)
2. Update `CATEGORY_REMAPS` in [generate-listing/index.ts](../supabase/functions/generate-listing/index.ts) if it's a category remap
3. Add the new rule to this file
4. Commit and push — Lovable auto-deploys from GitHub
