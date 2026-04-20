# Cross-Platform Listing Publisher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CrossPostPanel to VZT so any generated listing can be queued to eBay, LiveAuctioneers, Denver, Mercari, Poshmark, and Etsy with one click, each receiving a correctly AI-reformatted version.

**Architecture:** A platform adapter registry defines all 6 platforms with publish types and AI format prompts. The CrossPostPanel reads the registry, reformats via a new `reformat-listing` edge function, and dispatches to each platform's existing table (eBay/LA/Denver) or a new `crosspost_jobs` queue (Mercari/Poshmark/Etsy). Two new Playwright agents poll `crosspost_jobs` for Mercari and Poshmark. A new `etsy-publish` edge function handles Etsy via API.

**Tech Stack:** React + TypeScript (frontend), Supabase edge functions (Deno), Node.js + Playwright (agents), Vitest (tests), Lovable AI gateway (Gemini 2.5 Flash)

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `supabase/migrations/20260419000002_crosspost_jobs.sql` | New crosspost_jobs table |
| `src/lib/crosspost/registry.ts` | Platform adapter definitions |
| `src/lib/crosspost/registry.test.ts` | Registry unit tests |
| `src/lib/crosspost/api.ts` | createCrosspostJob + dispatch helpers |
| `src/lib/crosspost/api.test.ts` | API helper unit tests |
| `src/components/crosspost/CrossPostPanel.tsx` | Cross-post UI panel |
| `supabase/functions/reformat-listing/index.ts` | AI reformatting edge function |
| `supabase/functions/etsy-publish/index.ts` | Etsy API publisher edge function |
| `doa-listing-agent/mercari-agent/agent.js` | Mercari Playwright agent |
| `doa-listing-agent/mercari-agent/package.json` | Mercari agent dependencies |
| `doa-listing-agent/mercari-agent/.env.template` | Mercari credentials template |
| `doa-listing-agent/poshmark-agent/agent.js` | Poshmark Playwright agent |
| `doa-listing-agent/poshmark-agent/package.json` | Poshmark agent dependencies |
| `doa-listing-agent/poshmark-agent/.env.template` | Poshmark credentials template |
| `start-mercari-agent.bat` | Mercari agent launcher |
| `start-poshmark-agent.bat` | Poshmark agent launcher |

### Modified files
| File | Change |
|---|---|
| `src/pages/CreateListing.tsx` | Add `<CrossPostPanel />` after listing generation — one addition |

### Explicitly untouched
- All eBay API publish logic and `EbayBatchPanel.tsx`
- LA batch flow and CSV export
- DOA agent and `denver_batch_rows` flow
- `src/lib/api/listings.ts` (no changes needed — dispatch logic goes in `api.ts`)

---

## Task 1: Supabase Migration — crosspost_jobs Table

**Files:**
- Create: `supabase/migrations/20260419000002_crosspost_jobs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260419000002_crosspost_jobs.sql
create table if not exists public.crosspost_jobs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  batch_id uuid references public.la_batches(id) on delete set null,
  platform text not null check (platform in ('mercari', 'poshmark', 'etsy')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'failed')),
  formatted_data jsonb,
  error_log text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for agent polling (platform + status is the hot query path)
create index if not exists crosspost_jobs_platform_status_idx
  on public.crosspost_jobs (platform, status)
  where status = 'pending';

-- Auto-update updated_at on row change
create or replace function public.update_crosspost_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger crosspost_jobs_updated_at
  before update on public.crosspost_jobs
  for each row execute function public.update_crosspost_jobs_updated_at();

-- RLS: authenticated users can read/insert their own jobs (agents use service role, bypass RLS)
alter table public.crosspost_jobs enable row level security;

create policy "Users can manage their own crosspost jobs"
  on public.crosspost_jobs
  for all
  using (
    listing_id in (
      select id from public.listings where user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Apply the migration via Supabase dashboard**

Open the Supabase dashboard → SQL Editor → paste and run the migration SQL. Verify the table appears in Table Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260419000002_crosspost_jobs.sql
git commit -m "feat(db): add crosspost_jobs table for Mercari/Poshmark/Etsy queue"
```

---

## Task 2: Platform Adapter Registry

**Files:**
- Create: `src/lib/crosspost/registry.ts`
- Create: `src/lib/crosspost/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crosspost/registry.test.ts
import { describe, it, expect } from 'vitest';
import { PLATFORM_ADAPTERS, getPlatform } from './registry';

describe('PLATFORM_ADAPTERS', () => {
  const EXPECTED_IDS = ['ebay', 'liveauctioneers', 'denver', 'mercari', 'poshmark', 'etsy'];

  it('contains all 6 platforms', () => {
    const ids = PLATFORM_ADAPTERS.map(p => p.id);
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id);
    }
    expect(PLATFORM_ADAPTERS).toHaveLength(6);
  });

  it('every adapter has required fields', () => {
    for (const adapter of PLATFORM_ADAPTERS) {
      expect(adapter.id, `${adapter.id} missing id`).toBeTruthy();
      expect(adapter.name, `${adapter.id} missing name`).toBeTruthy();
      expect(adapter.publishType, `${adapter.id} missing publishType`).toBeTruthy();
      expect(adapter.description, `${adapter.id} missing description`).toBeTruthy();
    }
  });

  it('Mercari, Poshmark, and Etsy have formatPrompt defined', () => {
    for (const id of ['mercari', 'poshmark', 'etsy']) {
      const adapter = PLATFORM_ADAPTERS.find(p => p.id === id)!;
      expect(adapter.formatPrompt, `${id} missing formatPrompt`).toBeTruthy();
    }
  });

  it('eBay, LA, Denver have formatPrompt defined for cross-posting', () => {
    for (const id of ['ebay', 'liveauctioneers', 'denver']) {
      const adapter = PLATFORM_ADAPTERS.find(p => p.id === id)!;
      expect(adapter.formatPrompt, `${id} missing formatPrompt`).toBeTruthy();
    }
  });
});

describe('getPlatform', () => {
  it('returns adapter by id', () => {
    const adapter = getPlatform('mercari');
    expect(adapter?.id).toBe('mercari');
  });

  it('returns undefined for unknown platform', () => {
    expect(getPlatform('unknown')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent"
npx vitest run src/lib/crosspost/registry.test.ts
```

Expected: FAIL — `Cannot find module './registry'`

- [ ] **Step 3: Write the registry**

```ts
// src/lib/crosspost/registry.ts
import { Store, Gavel, ShoppingBag, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PublishType = 'ebay-batch' | 'la-batch' | 'denver-batch' | 'queue' | 'etsy-api';

export interface PlatformAdapter {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;          // Tailwind text color class
  bgColor: string;        // Tailwind bg color class
  publishType: PublishType;
  description: string;
  formatPrompt: string;   // AI prompt for reformatting source listing into this platform's format
}

export const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  {
    id: 'ebay',
    name: 'eBay',
    icon: Store,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    publishType: 'ebay-batch',
    description: 'Added to eBay batch — push from eBay tab',
    formatPrompt: `You are an expert eBay seller. Reformat this item listing for eBay.
STRICT RULES:
- title: EXACTLY 80 characters or fewer (count every character). Cassini keyword-optimized: Brand + Item Type + Key Attributes. No filler words.
- description: 150+ words. Structured: opening hook, specifications, condition report, what is included, shipping note.
- price: USD decimal based on sold comps.
- categoryId: eBay leaf category numeric ID (most specific possible, never a parent).
- category: human-readable name matching categoryId.
- condition: one of: "New", "Open box", "Used", "For parts or not working"
- itemSpecifics: key-value object. Always include Brand, Type, Material, Color. For clothing also include Department (Men/Women/Boys/Girls), Size, Size Type (Regular/Petite/Plus/Tall).
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "categoryId": number, "category": string, "condition": string, "itemSpecifics": object }`,
  },
  {
    id: 'liveauctioneers',
    name: 'LiveAuctioneers',
    icon: Gavel,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    publishType: 'la-batch',
    description: 'Added to LA batch — export CSV from LA tab',
    formatPrompt: `You are an expert auction catalog writer for LiveAuctioneers.
STRICT RULES:
- title: max 100 characters. SEO keyword-rich: Maker + Item Type + Material + Era/Style. Count every character.
- description: 6-10+ sentences. Professional auction house style. Include: precise identification, physical details, historical context, expert observations, detailed condition report.
- lowEst: conservative auction estimate in USD (whole number).
- highEst: optimistic estimate, typically 2-4x lowEst (whole number).
- startPrice: always 5.
- condition: detailed condition paragraph.
- category: auction category string.
- consignor: always "JSG".
- locationNickname: always "Highlands Ranch".
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "lowEst": number, "highEst": number, "startPrice": 5, "condition": string, "category": string, "consignor": "JSG", "locationNickname": "Highlands Ranch" }`,
  },
  {
    id: 'denver',
    name: 'Denver Auctions',
    icon: Gavel,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    publishType: 'denver-batch',
    description: 'Queued for DOA agent',
    formatPrompt: `You are an expert auction catalog writer for Denver Online Auctions.
STRICT RULES:
- title: max 100 characters. SEO + GEO optimized for Colorado market. Brand/Maker + Item Type + Material + Era. No filler words.
- description: 5-8+ sentences. Professional catalog style. Include: precise ID, physical details, historical context, expert observations, detailed condition report.
- startingBid: conservative whole number USD ($5-$25 generates most bidding activity).
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "startingBid": number }`,
  },
  {
    id: 'mercari',
    name: 'Mercari',
    icon: ShoppingBag,
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
    publishType: 'queue',
    description: 'Queued for Mercari agent',
    formatPrompt: `You are an expert Mercari seller. Reformat this item listing for Mercari.
STRICT RULES:
- title: max 40 characters. Descriptive and clear. No punctuation at end. Count every character.
- description: casual and friendly tone, 2-4 sentences. Mention condition, what is included, any flaws.
- price: USD whole number. Mercari takes 10% fee — price slightly above target net.
- category: Mercari category name (e.g., "Men's Tops", "Home Decor", "Electronics & Accessories").
- condition: one of exactly: "New", "Like New", "Good", "Fair", "Poor"
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "category": string, "condition": string }`,
  },
  {
    id: 'poshmark',
    name: 'Poshmark',
    icon: Tag,
    color: 'text-pink-500',
    bgColor: 'bg-pink-500/10',
    publishType: 'queue',
    description: 'Queued for Poshmark agent',
    formatPrompt: `You are an expert Poshmark seller. Reformat this item listing for Poshmark.
STRICT RULES:
- title: max 80 characters. Brand name first (if known). Include key item details and condition signal.
- description: style-forward and engaging tone. Include brand, size, material, measurements if available, condition details, any flaws. Mention "bundle discounts available."
- price: USD whole number. Poshmark buyers pay premium — price 10-20% above Mercari equivalents.
- brand: extract from item details, use "No Brand" if unknown.
- size: clothing size (XS/S/M/L/XL/XXL/etc.) or "OS" for one-size non-clothing items.
- category: Poshmark category (e.g., "Women's Tops", "Men's Jackets", "Home & Living", "Electronics").
- condition: one of: "NWT" (New With Tags), "NWOT" (New Without Tags), "Excellent", "Good", "Fair", "Poor"
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "brand": string, "size": string, "category": string, "condition": string }`,
  },
  {
    id: 'etsy',
    name: 'Etsy',
    icon: Tag,
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    publishType: 'etsy-api',
    description: 'Published via Etsy API',
    formatPrompt: `You are an expert Etsy seller specializing in vintage, handmade, and unique items. Reformat this item listing for Etsy.
STRICT RULES:
- title: max 140 characters. SEO keyword-rich. Include material, style, era (e.g., "Vintage 1970s", "Mid Century"), and exact search terms buyers use.
- description: detailed and keyword-rich, minimum 100 words. Cover: what it is, dimensions, materials, era/style, condition report, what is included, care instructions if relevant. Write naturally for both buyers and Etsy search.
- price: USD decimal (e.g., 45.00). Etsy buyers expect premium pricing for unique items.
- tags: EXACTLY 13 tags as a JSON array. Single words or short phrases (max 20 chars each). Focus on searchable terms, materials, styles, eras. No # symbol, no commas within a tag.
- category: Etsy category path (e.g., "Vintage > Clothing > Women's Clothing > Tops & Blouses").
- quantity: 1
ALWAYS return valid JSON only, no markdown:
{ "title": string, "description": string, "price": number, "tags": string[], "category": string, "quantity": 1 }`,
  },
];

export function getPlatform(id: string): PlatformAdapter | undefined {
  return PLATFORM_ADAPTERS.find(p => p.id === id);
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run src/lib/crosspost/registry.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/crosspost/registry.ts src/lib/crosspost/registry.test.ts
git commit -m "feat(crosspost): platform adapter registry with 6 platforms"
```

---

## Task 3: Dispatch API Helpers

**Files:**
- Create: `src/lib/crosspost/api.ts`
- Create: `src/lib/crosspost/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crosspost/api.test.ts
import { describe, it, expect } from 'vitest';
import { buildEbayBatchRow, buildLaBatchRow, buildDenverBatchRow } from './api';

describe('buildEbayBatchRow', () => {
  it('maps formatted_data fields to ebay_batch_rows schema', () => {
    const data = {
      title: 'Test Item',
      description: 'A description',
      price: 45,
      categoryId: 57990,
      category: "Men's Casual Shirts",
      condition: 'Used',
      itemSpecifics: { Brand: 'Nike', Color: 'Blue' },
    };
    const result = buildEbayBatchRow(data, ['https://img.jpg'], 'batch-id-123', 1);
    expect(result.title).toBe('Test Item');
    expect(result.price).toBe(45);
    expect(result.category_id).toBe(57990);
    expect(result.item_specifics).toEqual({ Brand: 'Nike', Color: 'Blue' });
    expect(result.batch_id).toBe('batch-id-123');
    expect(result.lot_number).toBe(1);
    expect(result.image_urls).toEqual(['https://img.jpg']);
    expect(result.status).toBe('pending');
  });
});

describe('buildLaBatchRow', () => {
  it('maps formatted_data fields to la_batch_rows schema', () => {
    const data = {
      title: 'Vintage Vase',
      description: 'Fine piece',
      lowEst: 50,
      highEst: 150,
      startPrice: 5,
      condition: 'Very good',
      consignor: 'JSG',
      category: 'Ceramics',
      locationNickname: 'Highlands Ranch',
    };
    const result = buildLaBatchRow(data, ['https://img.jpg'], 'batch-123', 5);
    expect(result.low_est).toBe(50);
    expect(result.high_est).toBe(150);
    expect(result.start_price).toBe(5);
    expect(result.consignor).toBe('JSG');
    expect(result.lot_number).toBe(5);
  });
});

describe('buildDenverBatchRow', () => {
  it('maps formatted_data fields to denver_batch_rows schema', () => {
    const data = { title: 'Antique Clock', description: 'Beautiful piece', startingBid: 15 };
    const result = buildDenverBatchRow(data, ['https://img.jpg'], 'batch-123', 3);
    expect(result.title).toBe('Antique Clock');
    expect(result.starting_bid).toBe(15);
    expect(result.lot_number).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/lib/crosspost/api.test.ts
```

Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 3: Write the helpers**

```ts
// src/lib/crosspost/api.ts
import { supabase } from "@/integrations/supabase/client";
import type { GeneratedListing } from "@/lib/api/listings";
import { getPlatform } from "./registry";

// ── Row builders (pure functions, easy to test) ──────────────────────────────

export function buildEbayBatchRow(
  data: Record<string, any>,
  imageUrls: string[],
  batchId: string,
  lotNumber: number
) {
  return {
    batch_id: batchId,
    lot_number: lotNumber,
    title: (data.title || '').substring(0, 80),
    description: data.description || '',
    price: data.price ?? null,
    category: data.category || null,
    category_id: data.categoryId ?? null,
    condition: data.condition || null,
    item_specifics: data.itemSpecifics || {},
    image_urls: imageUrls,
    status: 'pending',
    shipping_type: 'flat',
    shipping_cost: 9.98,
    handling_time: 1,
    returns_accepted: true,
    return_period: 30,
    return_shipping: 'seller',
    promotion_rate: 5.0,
    promotion_type: 'flat',
  };
}

export function buildLaBatchRow(
  data: Record<string, any>,
  imageUrls: string[],
  batchId: string,
  lotNumber: number
) {
  return {
    batch_id: batchId,
    lot_number: lotNumber,
    title: (data.title || '').substring(0, 100),
    description: data.description || '',
    low_est: data.lowEst ?? 0,
    high_est: data.highEst ?? 0,
    start_price: data.startPrice ?? 5,
    condition: data.condition || '',
    consignor: data.consignor || 'JSG',
    category: data.category || '',
    location_nickname: data.locationNickname || 'Highlands Ranch',
    image_urls: imageUrls,
    status: 'pending',
  };
}

export function buildDenverBatchRow(
  data: Record<string, any>,
  imageUrls: string[],
  batchId: string,
  lotNumber: number
) {
  return {
    batch_id: batchId,
    lot_number: lotNumber,
    title: (data.title || '').substring(0, 100),
    description: data.description || '',
    starting_bid: data.startingBid ?? 5,
    image_urls: imageUrls,
    status: 'pending',
  };
}

// ── Reformatting ─────────────────────────────────────────────────────────────

export async function reformatListing(
  platformId: string,
  sourceListing: GeneratedListing,
  imageUrls: string[]
): Promise<Record<string, any>> {
  const adapter = getPlatform(platformId);
  if (!adapter?.formatPrompt) throw new Error(`No format prompt for platform: ${platformId}`);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Session expired');

  const { data, error } = await supabase.functions.invoke('reformat-listing', {
    body: {
      platform: platformId,
      listing: sourceListing,
      imageUrls,
      formatPrompt: adapter.formatPrompt,
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data.formatted;
}

// ── Dispatch per platform ─────────────────────────────────────────────────────

export type DispatchResult = { ok: true } | { ok: false; error: string };

export async function dispatchPlatform(
  platformId: string,
  formattedData: Record<string, any>,
  imageUrls: string[],
  listingId: string | null,
  batchId: string | undefined
): Promise<DispatchResult> {
  const adapter = getPlatform(platformId);
  if (!adapter) return { ok: false, error: `Unknown platform: ${platformId}` };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    if (adapter.publishType === 'ebay-batch') {
      const batchIdOrFirst = batchId ?? await getOrCreateEbayBatchId(user.id);
      const nextLot = await getNextLotNumber('ebay_batch_rows', batchIdOrFirst);
      const row = buildEbayBatchRow(formattedData, imageUrls, batchIdOrFirst, nextLot);
      const { error } = await supabase.from('ebay_batch_rows').insert(row);
      if (error) throw error;
      return { ok: true };
    }

    if (adapter.publishType === 'la-batch') {
      if (!batchId) throw new Error('A project must be selected to add to LiveAuctioneers batch');
      const nextLot = await getNextLotNumber('la_batch_rows', batchId);
      const row = buildLaBatchRow(formattedData, imageUrls, batchId, nextLot);
      const { error } = await supabase.from('la_batch_rows').insert(row);
      if (error) throw error;
      return { ok: true };
    }

    if (adapter.publishType === 'denver-batch') {
      if (!batchId) throw new Error('A project must be selected to add to Denver Auctions batch');
      const nextLot = await getNextLotNumber('denver_batch_rows', batchId);
      const row = buildDenverBatchRow(formattedData, imageUrls, batchId, nextLot);
      const { error } = await supabase.from('denver_batch_rows').insert(row);
      if (error) throw error;
      return { ok: true };
    }

    if (adapter.publishType === 'queue' || adapter.publishType === 'etsy-api') {
      const { error } = await supabase.from('crosspost_jobs').insert({
        listing_id: listingId,
        batch_id: batchId ?? null,
        platform: platformId,
        status: 'pending',
        formatted_data: { ...formattedData, imageUrls }, // agents need imageUrls to download and upload photos
      });
      if (error) throw error;

      // Etsy: also call the edge function immediately (API publish, no agent needed)
      if (adapter.publishType === 'etsy-api') {
        supabase.functions.invoke('etsy-publish', {
          body: { platform: platformId, formatted: formattedData, imageUrls, listingId },
        }).catch(console.error); // fire and forget — job row tracks status
      }

      return { ok: true };
    }

    return { ok: false, error: `Unhandled publishType: ${adapter.publishType}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getNextLotNumber(table: string, batchId: string): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select('lot_number')
    .eq('batch_id', batchId)
    .order('lot_number', { ascending: false })
    .limit(1);
  return data?.[0]?.lot_number ? data[0].lot_number + 1 : 1;
}

async function getOrCreateEbayBatchId(userId: string): Promise<string> {
  // Use the most recent ebay batch for this user, or create one
  const { data: existing } = await supabase
    .from('la_batches')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing?.[0]) return existing[0].id;

  const { data: created, error } = await supabase
    .from('la_batches')
    .insert({ user_id: userId, name: 'Cross-post batch', platforms: ['ebay'] })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/crosspost/api.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/crosspost/api.ts src/lib/crosspost/api.test.ts
git commit -m "feat(crosspost): dispatch helpers for all 6 platforms"
```

---

## Task 4: reformat-listing Edge Function

**Files:**
- Create: `supabase/functions/reformat-listing/index.ts`

- [ ] **Step 1: Write the edge function**

```ts
// supabase/functions/reformat-listing/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { platform, listing, imageUrls, formatPrompt } = await req.json();

    if (!platform || !listing || !formatPrompt) {
      return new Response(JSON.stringify({ error: 'Missing required fields: platform, listing, formatPrompt' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    // Build content array — pass up to 2 images for context (reformatting doesn't need all 4)
    const content: any[] = [];
    const previewImages = (imageUrls || []).slice(0, 2);
    for (const url of previewImages) {
      content.push({ type: "image_url", image_url: { url } });
    }

    const listingSummary = [
      `Title: ${listing.title || ''}`,
      `Description: ${(listing.description || '').substring(0, 400)}`,
      `Price: $${listing.price || 0}`,
      `Category: ${listing.category || ''}`,
      `Condition: ${listing.condition || ''}`,
      listing.itemSpecifics ? `Item Specifics: ${JSON.stringify(listing.itemSpecifics)}` : '',
      listing.lowEst ? `Estimates: $${listing.lowEst} – $${listing.highEst}` : '',
    ].filter(Boolean).join('\n');

    content.push({
      type: "text",
      text: `Reformat this listing for the target platform.\n\nSOURCE LISTING:\n${listingSummary}`,
    });

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: formatPrompt },
          { role: 'user', content },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI gateway error ${response.status}: ${errorText}`);
    }

    const aiData = await response.json();
    const aiText = aiData.choices?.[0]?.message?.content || '';

    let formatted: Record<string, any>;
    try {
      const match = aiText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiText];
      formatted = JSON.parse(match[1].trim());
    } catch {
      throw new Error('AI did not return valid JSON');
    }

    return new Response(JSON.stringify({ formatted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('reformat-listing error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 2: Deploy the function via Supabase dashboard**

Open Supabase dashboard → Edge Functions → New Function → name it `reformat-listing` → paste the code → Deploy.

- [ ] **Step 3: Smoke test via curl (replace TOKEN and PROJECT_URL)**

```bash
curl -X POST https://<PROJECT_URL>/functions/v1/reformat-listing \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "mercari",
    "listing": { "title": "Nike Air Max 90 Men Sneakers Size 10", "description": "Great shoes", "price": 65, "condition": "Used" },
    "imageUrls": [],
    "formatPrompt": "Reformat for Mercari. title max 40 chars. Return JSON: { \"title\": string, \"description\": string, \"price\": number, \"category\": string, \"condition\": string }"
  }'
```

Expected: `{ "formatted": { "title": "...", "description": "...", ... } }` with title ≤40 chars

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/reformat-listing/index.ts
git commit -m "feat(crosspost): reformat-listing edge function for AI platform reformatting"
```

---

## Task 5: CrossPostPanel Component

**Files:**
- Create: `src/components/crosspost/CrossPostPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/crosspost/CrossPostPanel.tsx
import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Plus, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { saveListing, type GeneratedListing } from "@/lib/api/listings";
import { PLATFORM_ADAPTERS, type PlatformAdapter } from "@/lib/crosspost/registry";
import { reformatListing, dispatchPlatform } from "@/lib/crosspost/api";

type PlatformStatus = 'idle' | 'reformatting' | 'posting' | 'done' | 'failed';

interface PlatformRowState {
  checked: boolean;
  status: PlatformStatus;
  previewOpen: boolean;
  previewLoading: boolean;
  preview: Record<string, any> | null;
  error: string | null;
}

interface CrossPostPanelProps {
  listing: GeneratedListing;
  images: string[];       // Supabase public URLs already uploaded
  projectId?: string;
  listingId?: string;     // If already saved to listings table
}

export function CrossPostPanel({ listing, images, projectId, listingId: initialListingId }: CrossPostPanelProps) {
  const [rows, setRows] = useState<Record<string, PlatformRowState>>(() =>
    Object.fromEntries(
      PLATFORM_ADAPTERS.map(p => [p.id, {
        checked: false, status: 'idle', previewOpen: false,
        previewLoading: false, preview: null, error: null,
      }])
    )
  );
  const [savedListingId, setSavedListingId] = useState<string | null>(initialListingId ?? null);
  const [posting, setPosting] = useState(false);

  // Real-time: track crosspost_jobs status updates
  useEffect(() => {
    if (!savedListingId) return;
    const channel = supabase
      .channel(`crosspost_${savedListingId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'crosspost_jobs',
        filter: `listing_id=eq.${savedListingId}`,
      }, (payload) => {
        const job = payload.new as { platform: string; status: string; error_log: string | null };
        setRows(prev => ({
          ...prev,
          [job.platform]: {
            ...prev[job.platform],
            status: job.status === 'completed' ? 'done'
                  : job.status === 'failed' ? 'failed'
                  : 'posting',
            error: job.error_log ?? null,
          },
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [savedListingId]);

  const checkedCount = Object.values(rows).filter(r => r.checked).length;

  function updateRow(id: string, patch: Partial<PlatformRowState>) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function ensureListingSaved(): Promise<string> {
    if (savedListingId) return savedListingId;
    const saved = await saveListing({
      platform: 'ebay', // source platform — used for record-keeping only
      status: 'draft',
      title: listing.title,
      description: listing.description,
      price: listing.price,
      category: listing.category,
      condition: listing.condition,
      item_specifics: listing.itemSpecifics,
      image_urls: images,
      project_id: projectId,
    });
    setSavedListingId(saved.id);
    return saved.id;
  }

  async function handlePreview(platformId: string) {
    const row = rows[platformId];
    if (row.previewOpen) {
      updateRow(platformId, { previewOpen: false });
      return;
    }
    if (row.preview) {
      updateRow(platformId, { previewOpen: true });
      return;
    }
    updateRow(platformId, { previewLoading: true, previewOpen: true });
    try {
      const formatted = await reformatListing(platformId, listing, images);
      updateRow(platformId, { preview: formatted, previewLoading: false });
    } catch (err) {
      updateRow(platformId, { previewLoading: false, previewOpen: false });
      toast({ title: 'Preview failed', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    }
  }

  async function handleCrossPost() {
    if (checkedCount === 0) return;
    setPosting(true);

    let listingId: string;
    try {
      listingId = await ensureListingSaved();
    } catch (err) {
      toast({ title: 'Could not save listing', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
      setPosting(false);
      return;
    }

    const targets = PLATFORM_ADAPTERS.filter(p => rows[p.id].checked);

    await Promise.all(targets.map(async (platform) => {
      updateRow(platform.id, { status: 'reformatting', error: null });
      try {
        // Use cached preview if available, otherwise reformat now
        const formatted = rows[platform.id].preview ?? await reformatListing(platform.id, listing, images);
        updateRow(platform.id, { status: 'posting' });
        const result = await dispatchPlatform(platform.id, formatted, images, listingId, projectId);
        if (result.ok) {
          // For batch platforms (eBay/LA/Denver), mark done immediately (no real-time job row)
          if (['ebay-batch', 'la-batch', 'denver-batch'].includes(platform.publishType)) {
            updateRow(platform.id, { status: 'done' });
          }
          // For queue/etsy-api, real-time subscription updates status
        } else {
          updateRow(platform.id, { status: 'failed', error: result.error });
        }
      } catch (err) {
        updateRow(platform.id, { status: 'failed', error: err instanceof Error ? err.message : 'Error' });
      }
    }));

    setPosting(false);
    toast({ title: 'Cross-post dispatched', description: `Sent to ${targets.length} platform${targets.length > 1 ? 's' : ''}` });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 mt-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Cross-post this listing</h3>

      <div className="space-y-2">
        {PLATFORM_ADAPTERS.map((platform) => (
          <PlatformRow
            key={platform.id}
            platform={platform}
            state={rows[platform.id]}
            onToggle={(checked) => updateRow(platform.id, { checked })}
            onPreview={() => handlePreview(platform.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <Plus className="h-3 w-3" /> add platform
        </button>
        <Button
          size="sm"
          disabled={checkedCount === 0 || posting}
          onClick={handleCrossPost}
        >
          {posting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Cross-post to {checkedCount} platform{checkedCount !== 1 ? 's' : ''} →
        </Button>
      </div>
    </div>
  );
}

function PlatformRow({
  platform,
  state,
  onToggle,
  onPreview,
}: {
  platform: PlatformAdapter;
  state: PlatformRowState;
  onToggle: (checked: boolean) => void;
  onPreview: () => void;
}) {
  const Icon = platform.icon;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2">
        <Checkbox
          checked={state.checked}
          onCheckedChange={(v) => onToggle(Boolean(v))}
          disabled={['reformatting', 'posting', 'done'].includes(state.status)}
        />
        <div className={cn("rounded p-1", platform.bgColor)}>
          <Icon className={cn("h-4 w-4", platform.color)} />
        </div>
        <span className="text-sm font-medium flex-1">{platform.name}</span>
        <StatusBadge status={state.status} />
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          onClick={onPreview}
        >
          preview {state.previewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {state.previewOpen && (
        <div className="px-3 pb-3 bg-muted/30 border-t border-border text-xs text-muted-foreground space-y-1">
          {state.previewLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Reformatting for {platform.name}…
            </div>
          ) : state.preview ? (
            <PreviewContent data={state.preview} />
          ) : null}
        </div>
      )}

      {state.status === 'failed' && state.error && (
        <div className="px-3 py-1 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive">
          {state.error}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PlatformStatus }) {
  if (status === 'idle') return <span className="text-xs text-muted-foreground">{''}</span>;
  if (status === 'reformatting') return <span className="flex items-center gap-1 text-xs text-blue-400"><Loader2 className="h-3 w-3 animate-spin" /> reformatting</span>;
  if (status === 'posting') return <span className="flex items-center gap-1 text-xs text-yellow-400"><Clock className="h-3 w-3" /> posting</span>;
  if (status === 'done') return <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 className="h-3 w-3" /> done</span>;
  if (status === 'failed') return <span className="flex items-center gap-1 text-xs text-red-400"><XCircle className="h-3 w-3" /> failed</span>;
  return null;
}

function PreviewContent({ data }: { data: Record<string, any> }) {
  const fields = Object.entries(data).filter(([k]) => !['imageUrls'].includes(k));
  return (
    <>
      {fields.slice(0, 6).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="shrink-0 w-24 text-muted-foreground/70">{key}:</span>
          <span className="truncate">{Array.isArray(value) ? value.join(', ') : String(value ?? '')}</span>
        </div>
      ))}
      {fields.length > 6 && <div className="text-muted-foreground/50">+{fields.length - 6} more fields</div>}
    </>
  );
}
```

- [ ] **Step 2: Verify the component renders without TS errors**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent"
npx tsc --noEmit
```

Expected: no errors in `CrossPostPanel.tsx` or `api.ts`

- [ ] **Step 3: Commit**

```bash
git add src/components/crosspost/CrossPostPanel.tsx
git commit -m "feat(crosspost): CrossPostPanel component with per-platform preview and real-time status"
```

---

## Task 6: Wire CrossPostPanel into CreateListing.tsx

**Files:**
- Modify: `src/pages/CreateListing.tsx`

- [ ] **Step 1: Add the import**

Find the last import block in `CreateListing.tsx` (around line 50) and add:

```ts
import { CrossPostPanel } from "@/components/crosspost/CrossPostPanel";
```

- [ ] **Step 2: Locate the correct insertion point**

Search for where `generatedListing` is rendered — it's where the platform-specific tabs/panels appear after generation. Find the JSX section that conditionally renders when `generatedListing !== null`. Add the CrossPostPanel just after the existing generated listing display section:

```tsx
{generatedListing && images.some(i => i.url) && (
  <CrossPostPanel
    listing={generatedListing}
    images={images.filter(i => i.url).map(i => i.url!)}
    projectId={selectedProject?.id}
  />
)}
```

- [ ] **Step 3: Verify no TS errors and dev server starts**

```bash
npx tsc --noEmit
```

Expected: clean compile

- [ ] **Step 4: Manual smoke test**
  1. Open the VZT app in browser
  2. Upload a photo and generate a listing for any platform
  3. Verify the CrossPostPanel appears below the generated listing
  4. Verify all 6 platform rows show
  5. Check a platform and click "Preview ↓" — verify it calls AI and shows a reformatted preview
  6. Check 2 platforms and click "Cross-post to 2 platforms" — verify toast appears and status badges update

- [ ] **Step 5: Commit**

```bash
git add src/pages/CreateListing.tsx
git commit -m "feat(crosspost): wire CrossPostPanel into CreateListing after generation"
```

---

## Task 7: etsy-publish Edge Function

**Files:**
- Create: `supabase/functions/etsy-publish/index.ts`

**Prerequisites:** Etsy API key + OAuth access token stored in Supabase secrets as `ETSY_API_KEY`, `ETSY_ACCESS_TOKEN`, and `ETSY_SHOP_ID`. Set these in Supabase dashboard → Settings → Edge Functions → Secrets before deploying.

- [ ] **Step 1: Write the edge function**

```ts
// supabase/functions/etsy-publish/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ETSY_BASE = 'https://openapi.etsy.com/v3/application';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let jobId: string | null = null;

  try {
    const body = await req.json();
    const { formatted, listingId } = body as {
      formatted: Record<string, any>;
      listingId?: string;
    };

    const ETSY_API_KEY = Deno.env.get('ETSY_API_KEY');
    const ETSY_ACCESS_TOKEN = Deno.env.get('ETSY_ACCESS_TOKEN');
    const ETSY_SHOP_ID = Deno.env.get('ETSY_SHOP_ID');

    if (!ETSY_API_KEY || !ETSY_ACCESS_TOKEN || !ETSY_SHOP_ID) {
      throw new Error('Etsy credentials not configured (ETSY_API_KEY, ETSY_ACCESS_TOKEN, ETSY_SHOP_ID)');
    }

    // Find the crosspost_jobs row for this listing + etsy
    if (listingId) {
      const { data: job } = await supabaseAdmin
        .from('crosspost_jobs')
        .select('id')
        .eq('listing_id', listingId)
        .eq('platform', 'etsy')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      jobId = job?.id ?? null;
    }

    // Mark in_progress
    if (jobId) {
      await supabaseAdmin.from('crosspost_jobs').update({ status: 'in_progress' }).eq('id', jobId);
    }

    // Create Etsy draft listing
    const listingPayload = {
      quantity: formatted.quantity ?? 1,
      title: (formatted.title || '').substring(0, 140),
      description: formatted.description || '',
      price: {
        amount: Math.round((formatted.price ?? 0) * 100),
        divisor: 100,
        currency_code: 'USD',
      },
      who_made: 'someone_else',         // for vintage/resale
      when_made: 'made_to_order',       // Etsy requires this field; adjust as needed
      taxonomy_id: 0,                   // 0 = uncategorized draft; update manually on Etsy
      tags: (formatted.tags || []).slice(0, 13),
      state: 'draft',                   // Create as draft — review on Etsy before activating
    };

    const response = await fetch(`${ETSY_BASE}/shops/${ETSY_SHOP_ID}/listings`, {
      method: 'POST',
      headers: {
        'x-api-key': ETSY_API_KEY,
        'Authorization': `Bearer ${ETSY_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(listingPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Etsy API ${response.status}: ${errText}`);
    }

    const etsyData = await response.json();
    const etsyListingId = etsyData.listing_id;

    // Mark completed
    if (jobId) {
      await supabaseAdmin.from('crosspost_jobs').update({
        status: 'completed',
        formatted_data: { ...formatted, etsy_listing_id: etsyListingId },
      }).eq('id', jobId);
    }

    return new Response(JSON.stringify({ ok: true, etsyListingId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('etsy-publish error:', err);
    if (jobId) {
      await supabaseAdmin.from('crosspost_jobs').update({
        status: 'failed',
        error_log: err instanceof Error ? err.message : 'Unknown error',
      }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 2: Add Etsy secrets to Supabase**

Supabase dashboard → Settings → Edge Functions → Secrets → add:
- `ETSY_API_KEY` — your Etsy app API key
- `ETSY_ACCESS_TOKEN` — OAuth access token from Etsy OAuth flow
- `ETSY_SHOP_ID` — your numeric Etsy shop ID

- [ ] **Step 3: Deploy**

Supabase dashboard → Edge Functions → New Function → name `etsy-publish` → paste → Deploy.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/etsy-publish/index.ts
git commit -m "feat(crosspost): etsy-publish edge function for Etsy API draft listing creation"
```

---

## Task 8: Mercari Playwright Agent

**Files:**
- Create: `doa-listing-agent/mercari-agent/agent.js`
- Create: `doa-listing-agent/mercari-agent/package.json`
- Create: `doa-listing-agent/mercari-agent/.env.template`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "mercari-agent",
  "version": "1.0.0",
  "description": "Polls crosspost_jobs for Mercari listings and publishes via Playwright",
  "type": "module",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "dotenv": "^16.3.0",
    "@supabase/supabase-js": "^2.39.0",
    "playwright": "^1.41.0"
  }
}
```

- [ ] **Step 2: Write .env.template**

```bash
# doa-listing-agent/mercari-agent/.env.template
# Copy to .env and fill in your values
SUPABASE_URL=https://atgrxqfxysvppqoyvjdd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
MERCARI_EMAIL=your_mercari_email@example.com
MERCARI_PASSWORD=your_mercari_password_here
```

- [ ] **Step 3: Write agent.js**

```js
// doa-listing-agent/mercari-agent/agent.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'browser-session');
const SESSION_FILE = path.join(SESSION_DIR, 'mercari-state.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MERCARI_EMAIL = process.env.MERCARI_EMAIL;
const MERCARI_PASSWORD = process.env.MERCARI_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!MERCARI_EMAIL || !MERCARI_PASSWORD) {
  console.error('Missing MERCARI_EMAIL or MERCARI_PASSWORD in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Download image from URL to a temp file ────────────────────────────────────
async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

// ── Log in to Mercari (only if session is invalid) ───────────────────────────
async function ensureLoggedIn(page) {
  await page.goto('https://www.mercari.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-testid="avatar-icon"], [aria-label="Account"]').count() > 0;
  if (isLoggedIn) {
    console.log('[mercari] Already logged in via saved session');
    return;
  }
  console.log('[mercari] Logging in...');
  await page.goto('https://www.mercari.com/login/', { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', MERCARI_EMAIL);
  await page.fill('input[name="password"]', MERCARI_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[mercari] Logged in');
}

// ── Post a single listing to Mercari ─────────────────────────────────────────
async function postListing(page, job) {
  const d = job.formatted_data;
  if (!d?.title || !d?.price) throw new Error('formatted_data missing title or price');

  // Download images to temp files
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const imageUrls = (d.imageUrls || []).slice(0, 12);
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'jpg';
    const tmpPath = path.join(tmpDir, `mercari_${job.id}_${i}.${ext}`);
    await downloadImage(imageUrls[i], tmpPath);
    imagePaths.push(tmpPath);
  }

  await page.goto('https://www.mercari.com/sell/', { waitUntil: 'networkidle', timeout: 30000 });

  // Upload photos
  if (imagePaths.length > 0) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('input[type="file"]').first().click(),
    ]);
    await fileChooser.setFiles(imagePaths);
    await page.waitForTimeout(2000); // let images upload
  }

  // Fill title (Mercari: char limit 40)
  const titleInput = page.locator('input[name="name"], input[placeholder*="Title"], input[placeholder*="title"]').first();
  await titleInput.click();
  await titleInput.fill(String(d.title).substring(0, 40));

  // Fill description
  const descInput = page.locator('textarea[name="description"], textarea[placeholder*="Description"]').first();
  await descInput.click();
  await descInput.fill(String(d.description || ''));

  // Fill price
  const priceInput = page.locator('input[name="price"], input[placeholder*="Price"], input[placeholder*="price"]').first();
  await priceInput.click();
  await priceInput.fill(String(Math.round(d.price)));

  // NOTE: Category and Condition on Mercari require navigating dropdown UI.
  // These are complex multi-step interactions that depend on Mercari's current UI.
  // The agent will leave these blank (user fills them on Mercari) or you can extend
  // this agent with the specific Playwright steps once you observe the current UI.
  console.log('[mercari] NOTE: Category/Condition dropdowns need manual verification of selectors');

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("List"), button:has-text("Submit")').first();
  await submitBtn.click();
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });

  // Cleanup temp files
  for (const p of imagePaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`[mercari] Posted job ${job.id}`);
}

// ── Main polling loop ─────────────────────────────────────────────────────────
async function run() {
  console.log('[mercari-agent] Starting up...');

  // Fetch pending jobs
  const { data: jobs, error } = await supabase
    .from('crosspost_jobs')
    .select('*')
    .eq('platform', 'mercari')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error('[mercari-agent] DB error:', error.message); process.exit(1); }
  if (!jobs || jobs.length === 0) { console.log('[mercari-agent] No pending jobs. Exiting.'); return; }

  console.log(`[mercari-agent] Found ${jobs.length} pending job(s)`);

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
  const browser = await chromium.launch({ headless: false }); // headed for visual debugging
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);
    await context.storageState({ path: SESSION_FILE }); // save session after login

    for (const job of jobs) {
      // Mark in_progress
      await supabase.from('crosspost_jobs').update({
        status: 'in_progress', updated_at: new Date().toISOString(),
      }).eq('id', job.id);

      try {
        await postListing(page, job);
        await supabase.from('crosspost_jobs').update({
          status: 'completed', updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        console.log(`[mercari-agent] ✓ Job ${job.id} completed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mercari-agent] ✗ Job ${job.id} failed:`, msg);
        await supabase.from('crosspost_jobs').update({
          status: 'failed', error_log: msg, updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }
  } finally {
    await context.storageState({ path: SESSION_FILE }); // always save session
    await browser.close();
  }

  console.log('[mercari-agent] Done.');
}

run().catch(err => {
  console.error('[mercari-agent] Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Install dependencies**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent/doa-listing-agent/mercari-agent"
npm install
```

- [ ] **Step 5: Copy .env.template to .env and fill in credentials**

```bash
cp .env.template .env
# Open .env and fill in SUPABASE_SERVICE_ROLE_KEY, MERCARI_EMAIL, MERCARI_PASSWORD
```

- [ ] **Step 6: Smoke test (dry run — needs at least one pending mercari job in DB)**

```bash
node agent.js
```

Expected: `[mercari-agent] No pending jobs. Exiting.` (clean exit with no errors)

- [ ] **Step 7: Commit**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent"
git add doa-listing-agent/mercari-agent/agent.js doa-listing-agent/mercari-agent/package.json doa-listing-agent/mercari-agent/.env.template
git commit -m "feat(crosspost): Mercari Playwright agent — polls crosspost_jobs and posts via browser"
```

---

## Task 9: Poshmark Playwright Agent

**Files:**
- Create: `doa-listing-agent/poshmark-agent/agent.js`
- Create: `doa-listing-agent/poshmark-agent/package.json`
- Create: `doa-listing-agent/poshmark-agent/.env.template`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "poshmark-agent",
  "version": "1.0.0",
  "description": "Polls crosspost_jobs for Poshmark listings and publishes via Playwright",
  "type": "module",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "dotenv": "^16.3.0",
    "@supabase/supabase-js": "^2.39.0",
    "playwright": "^1.41.0"
  }
}
```

- [ ] **Step 2: Write .env.template**

```bash
# doa-listing-agent/poshmark-agent/.env.template
SUPABASE_URL=https://atgrxqfxysvppqoyvjdd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
POSHMARK_EMAIL=your_poshmark_email@example.com
POSHMARK_PASSWORD=your_poshmark_password_here
```

- [ ] **Step 3: Write agent.js**

```js
// doa-listing-agent/poshmark-agent/agent.js
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, 'browser-session');
const SESSION_FILE = path.join(SESSION_DIR, 'poshmark-state.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POSHMARK_EMAIL = process.env.POSHMARK_EMAIL;
const POSHMARK_PASSWORD = process.env.POSHMARK_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
if (!POSHMARK_EMAIL || !POSHMARK_PASSWORD) {
  console.error('Missing POSHMARK_EMAIL or POSHMARK_PASSWORD in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${url}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

async function ensureLoggedIn(page) {
  await page.goto('https://poshmark.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-et-name="user_avatar"], .user-image, [data-testid="header-avatar"]').count() > 0;
  if (isLoggedIn) { console.log('[poshmark] Already logged in'); return; }

  console.log('[poshmark] Logging in...');
  await page.goto('https://poshmark.com/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="login_form[username_email]"], input[placeholder*="Email"]', POSHMARK_EMAIL);
  await page.fill('input[name="login_form[password]"], input[placeholder*="Password"]', POSHMARK_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[poshmark] Logged in');
}

async function postListing(page, job) {
  const d = job.formatted_data;
  if (!d?.title || !d?.price) throw new Error('formatted_data missing title or price');

  // Download images
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
  const imageUrls = (d.imageUrls || []).slice(0, 16); // Poshmark allows up to 16 photos
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = imageUrls[i].split('.').pop()?.split('?')[0] || 'jpg';
    const tmpPath = path.join(tmpDir, `poshmark_${job.id}_${i}.${ext}`);
    await downloadImage(imageUrls[i], tmpPath);
    imagePaths.push(tmpPath);
  }

  await page.goto('https://poshmark.com/create-listing', { waitUntil: 'networkidle', timeout: 30000 });

  // Upload photos
  if (imagePaths.length > 0) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      page.locator('input[type="file"]').first().click(),
    ]);
    await fileChooser.setFiles(imagePaths);
    await page.waitForTimeout(3000);
  }

  // Fill title
  const titleInput = page.locator('input[name="title"], input[placeholder*="Title"]').first();
  await titleInput.click();
  await titleInput.fill(String(d.title).substring(0, 80));

  // Fill description
  const descInput = page.locator('textarea[name="description"], textarea[placeholder*="Describe"]').first();
  await descInput.click();
  await descInput.fill(String(d.description || ''));

  // Fill original price and listing price
  // Poshmark has two price fields: "Original Price" and "Listing Price"
  const priceInputs = page.locator('input[name*="price"], input[placeholder*="Price"]');
  const priceCount = await priceInputs.count();
  if (priceCount >= 2) {
    await priceInputs.nth(0).fill(String(Math.round(d.price * 1.2))); // original price (slightly higher)
    await priceInputs.nth(1).fill(String(Math.round(d.price)));        // listing price
  } else if (priceCount === 1) {
    await priceInputs.nth(0).fill(String(Math.round(d.price)));
  }

  // NOTE: Category, Brand, Size, Condition on Poshmark are dropdown/search interactions.
  // These require specific Playwright steps based on Poshmark's current UI.
  // Extend this agent with those steps after observing the live UI.
  console.log('[poshmark] NOTE: Category/Brand/Size/Condition selectors need manual UI verification');

  // Submit
  const submitBtn = page.locator('button[type="submit"], button:has-text("List"), button:has-text("Next")').first();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Cleanup
  for (const p of imagePaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }

  console.log(`[poshmark] Posted job ${job.id}`);
}

async function run() {
  console.log('[poshmark-agent] Starting up...');

  const { data: jobs, error } = await supabase
    .from('crosspost_jobs')
    .select('*')
    .eq('platform', 'poshmark')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) { console.error('[poshmark-agent] DB error:', error.message); process.exit(1); }
  if (!jobs || jobs.length === 0) { console.log('[poshmark-agent] No pending jobs. Exiting.'); return; }

  console.log(`[poshmark-agent] Found ${jobs.length} pending job(s)`);

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page);
    await context.storageState({ path: SESSION_FILE });

    for (const job of jobs) {
      await supabase.from('crosspost_jobs').update({
        status: 'in_progress', updated_at: new Date().toISOString(),
      }).eq('id', job.id);

      try {
        await postListing(page, job);
        await supabase.from('crosspost_jobs').update({
          status: 'completed', updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        console.log(`[poshmark-agent] ✓ Job ${job.id} completed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[poshmark-agent] ✗ Job ${job.id} failed:`, msg);
        await supabase.from('crosspost_jobs').update({
          status: 'failed', error_log: msg, updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }
  } finally {
    await context.storageState({ path: SESSION_FILE });
    await browser.close();
  }

  console.log('[poshmark-agent] Done.');
}

run().catch(err => {
  console.error('[poshmark-agent] Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Install dependencies and set up .env**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent/doa-listing-agent/poshmark-agent"
npm install
cp .env.template .env
# Fill in SUPABASE_SERVICE_ROLE_KEY, POSHMARK_EMAIL, POSHMARK_PASSWORD
```

- [ ] **Step 5: Smoke test**

```bash
node agent.js
```

Expected: `[poshmark-agent] No pending jobs. Exiting.`

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/david/OneDrive/Desktop/doa-listing-agent"
git add doa-listing-agent/poshmark-agent/agent.js doa-listing-agent/poshmark-agent/package.json doa-listing-agent/poshmark-agent/.env.template
git commit -m "feat(crosspost): Poshmark Playwright agent — polls crosspost_jobs and posts via browser"
```

---

## Task 10: Launchers + .gitignore

**Files:**
- Create: `start-mercari-agent.bat`
- Create: `start-poshmark-agent.bat`
- Modify: `.gitignore` (add agent .env files)

- [ ] **Step 1: Write start-mercari-agent.bat**

```bat
@echo off
cd /d "%~dp0"
echo Starting Mercari agent...
node doa-listing-agent/mercari-agent/agent.js
pause
```

- [ ] **Step 2: Write start-poshmark-agent.bat**

```bat
@echo off
cd /d "%~dp0"
echo Starting Poshmark agent...
node doa-listing-agent/poshmark-agent/agent.js
pause
```

- [ ] **Step 3: Update .gitignore to exclude agent .env files**

Add to `.gitignore` (find the existing `.env` entries and add beside them):

```gitignore
doa-listing-agent/mercari-agent/.env
doa-listing-agent/mercari-agent/browser-session/
doa-listing-agent/mercari-agent/tmp/
doa-listing-agent/poshmark-agent/.env
doa-listing-agent/poshmark-agent/browser-session/
doa-listing-agent/poshmark-agent/tmp/
```

- [ ] **Step 4: Commit**

```bash
git add start-mercari-agent.bat start-poshmark-agent.bat .gitignore
git commit -m "feat(crosspost): add Mercari and Poshmark agent launchers"
```

---

## Post-Implementation Notes

**Mercari and Poshmark UI selectors:** Both agents include `console.log` notes where Category, Condition, Brand, and Size dropdowns need verification. These use complex multi-step Poshmark/Mercari UI interactions that vary with site updates. After running an agent for the first time with a test job, observe what the browser does and fill in the missing Playwright steps.

**Etsy OAuth:** The `etsy-publish` function uses a long-lived OAuth access token. Etsy tokens expire. When they do, run the OAuth flow again and update `ETSY_ACCESS_TOKEN` in Supabase secrets. Consider adding a token refresh flow to the edge function later.

**Image URLs in formatted_data:** The `reformatListing` function in `api.ts` passes `imageUrls` to the `reformat-listing` edge function for AI context, but the formatted payload stored in `crosspost_jobs.formatted_data` does NOT include image URLs. The agents receive images via `job.formatted_data.imageUrls` — make sure the dispatch in `api.ts` includes image URLs in the formatted_data payload before inserting into `crosspost_jobs`. Update the `dispatchPlatform` function in `api.ts` for queue platforms:

```ts
// In dispatchPlatform, for 'queue' and 'etsy-api':
const { error } = await supabase.from('crosspost_jobs').insert({
  listing_id: listingId,
  batch_id: batchId ?? null,
  platform: platformId,
  status: 'pending',
  formatted_data: { ...formattedData, imageUrls }, // include image URLs for agents
});
```

Apply this fix as part of Task 3 before agents run.
