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
      who_made: 'someone_else',
      when_made: 'made_to_order',
      taxonomy_id: 0,
      tags: (formatted.tags || []).slice(0, 13),
      state: 'draft',
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
