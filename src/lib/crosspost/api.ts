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
    category: data.categoryId ? String(data.categoryId) : (data.category || null),
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
    image_urls: imageUrls,
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
      const resolvedBatchId = batchId ?? await getOrCreateEbayBatchId(user.id);
      const nextLot = await getNextLotNumber('ebay_batch_rows', resolvedBatchId);
      const row = buildEbayBatchRow(formattedData, imageUrls, resolvedBatchId, nextLot);
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
      // Guard: Mercari and Poshmark require the user to have saved their own credentials
      if (!await hasCredentials(user.id, platformId)) {
        return {
          ok: false,
          error: `Connect your ${platformId} account in Settings before cross-posting.`,
        };
      }

      const { error } = await (supabase as any).from('crosspost_jobs').insert({
        listing_id: listingId,
        batch_id: batchId ?? null,
        user_id: user.id,
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
  const { data } = await (supabase as any)
    .from(table)
    .select('lot_number')
    .eq('batch_id', batchId)
    .order('lot_number', { ascending: false })
    .limit(1);
  return data?.[0]?.lot_number ? data[0].lot_number + 1 : 1;
}

async function hasCredentials(userId: string, platform: string): Promise<boolean> {
  const tableMap: Record<string, string> = {
    mercari: 'user_mercari_credentials',
    poshmark: 'user_poshmark_credentials',
  };
  const table = tableMap[platform];
  if (!table) return true;
  const { data } = await supabase
    .from(table as any)
    .select('user_id')
    .eq('user_id', userId)
    .single();
  return data !== null;
}

async function getOrCreateEbayBatchId(userId: string): Promise<string> {
  // Use the most recent batch for this user that includes eBay, or create one
  const { data: existing } = await supabase
    .from('la_batches')
    .select('id')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existing?.[0]) return existing[0].id;

  const { data: created, error } = await supabase
    .from('la_batches')
    .insert({ created_by: userId, name: 'Cross-post batch', platforms: ['ebay'] })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}
