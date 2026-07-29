/**
 * ebay-reconcile
 * ─────────────────────────────────────────────────────────────────────────────
 * Marks VZT rows as "published" when a matching ACTIVE listing already exists on
 * eBay, so the duplicate guard in EbayBatchPanel can actually protect the
 * backlog. Also reports titles that are already listed more than once — existing
 * duplicates the operator may want to end.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless { apply: true } is passed.
 *
 * Matching key is the TITLE, not the SKU: every historical push sent
 * SKU = lot_number (custom_sku was never populated), and lot numbers repeat
 * across batches — SKU matching would mark the wrong rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitizeSecret(name: string): string {
  return (Deno.env.get(name) ?? "").trim().replace(/^['"]/g, "").replace(/['"]$/g, "");
}

/** Normalises a title so eBay's copy and ours compare equal. */
function normalizeTitle(title: string): string {
  return (title || "")
    .substring(0, 80)
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getUserRefreshToken(authHeader: string | null): Promise<{ userId: string; refreshToken: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  try {
    const jwt = authHeader.slice(7);
    const userId = JSON.parse(atob(jwt.split(".")[1])).sub as string;
    if (!userId) return null;
    const sb = createClient(supabaseUrl, serviceRoleKey);
    const { data } = await sb
      .from("user_ebay_credentials")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.refresh_token) return null;
    return { userId, refreshToken: data.refresh_token };
  } catch {
    return null;
  }
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = sanitizeSecret("EBAY_CLIENT_ID");
  const clientSecret = sanitizeSecret("EBAY_CLIENT_SECRET");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!res.ok) throw new Error(`eBay OAuth refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

interface EbayListing { itemId: string; sku: string; title: string }

/** Pulls every ACTIVE listing via Trading API GetMyeBaySelling (paginated). */
async function fetchActiveListings(accessToken: string): Promise<EbayListing[]> {
  const listings: EbayListing[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;

    const res = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body: xml,
    });

    const text = await res.text();
    const ack = text.match(/<Ack>(.*?)<\/Ack>/)?.[1] ?? "";
    if (ack !== "Success" && ack !== "Warning") {
      const short = text.match(/<ShortMessage>(.*?)<\/ShortMessage>/)?.[1] ?? "unknown error";
      const long = text.match(/<LongMessage>(.*?)<\/LongMessage>/)?.[1] ?? "";
      throw new Error(`GetMyeBaySelling failed: ${short} ${long}`.trim());
    }

    const activeBlock = text.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/)?.[1] ?? "";
    for (const m of activeBlock.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
      const item = m[1];
      const itemId = item.match(/<ItemID>(.*?)<\/ItemID>/)?.[1] ?? "";
      const title = item.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? "";
      const sku = item.match(/<SKU>(.*?)<\/SKU>/)?.[1] ?? "";
      if (itemId && title) listings.push({ itemId, sku, title });
    }

    const pages = activeBlock.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1];
    totalPages = pages ? parseInt(pages, 10) : 1;
    page++;
  } while (page <= totalPages && page <= 25); // hard stop: 5,000 listings

  return listings;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const apply: boolean = body.apply === true;
    const batchId: string | undefined = body.batch_id;

    const creds = await getUserRefreshToken(req.headers.get("authorization"));
    if (!creds) {
      return new Response(
        JSON.stringify({ error: "Connect your eBay account in Settings → Platforms first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessToken = await getAccessToken(creds.refreshToken);
    const listings = await fetchActiveListings(accessToken);

    // title → listings (more than one means it is ALREADY duplicated on eBay)
    const byTitle = new Map<string, EbayListing[]>();
    for (const l of listings) {
      const key = normalizeTitle(l.title);
      if (!key) continue;
      const arr = byTitle.get(key) ?? [];
      arr.push(l);
      byTitle.set(key, arr);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceRoleKey);

    let query = sb
      .from("ebay_batch_rows")
      .select("id, batch_id, lot_number, title, status")
      .neq("status", "published");
    if (batchId) query = query.eq("batch_id", batchId);

    const { data: rows, error: rowsError } = await query;
    if (rowsError) throw new Error(`Could not read ebay_batch_rows: ${rowsError.message}`);

    const toMark: { id: string; lot_number: number; title: string; itemId: string }[] = [];
    const unmatched: { lot_number: number; title: string }[] = [];

    for (const row of rows ?? []) {
      const key = normalizeTitle(row.title ?? "");
      const hit = key ? byTitle.get(key) : undefined;
      if (hit && hit.length > 0) {
        toMark.push({ id: row.id, lot_number: row.lot_number, title: row.title ?? "", itemId: hit[0].itemId });
      } else {
        unmatched.push({ lot_number: row.lot_number, title: (row.title ?? "").substring(0, 60) });
      }
    }

    // Titles already live more than once — pre-existing duplicates worth ending.
    const duplicatesOnEbay = [...byTitle.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([, v]) => ({ title: v[0].title.substring(0, 70), count: v.length, itemIds: v.map(x => x.itemId) }));

    let marked = 0;
    if (apply && toMark.length > 0) {
      // Chunked so a large backlog doesn't exceed URL/statement limits.
      for (let i = 0; i < toMark.length; i += 100) {
        const ids = toMark.slice(i, i + 100).map(t => t.id);
        const { error } = await sb.from("ebay_batch_rows").update({ status: "published" }).in("id", ids);
        if (error) throw new Error(`Failed marking rows published: ${error.message}`);
        marked += ids.length;
      }
    }

    return new Response(
      JSON.stringify({
        dryRun: !apply,
        activeListingsOnEbay: listings.length,
        rowsChecked: rows?.length ?? 0,
        wouldMark: toMark.length,
        marked,
        // Full id list so the client can update its rows without a refetch.
        markedIds: apply ? toMark.map(t => t.id) : [],
        matches: toMark.slice(0, 50).map(t => ({ id: t.id, lot: t.lot_number, title: t.title.substring(0, 60), itemId: t.itemId })),
        unmatchedSample: unmatched.slice(0, 25),
        duplicatesOnEbay,
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[ebay-reconcile]", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
