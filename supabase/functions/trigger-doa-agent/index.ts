/**
 * trigger-doa-agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Supabase Edge Function that marks a batch's lots as "pending" so the local
 * DOA listing agent (running in --supabase-watch mode via pm2) picks them up.
 *
 * POST /functions/v1/trigger-doa-agent
 * Body: { batch_id: string, doa_first_lot_url?: string, reset_failed?: boolean }
 *
 * GET  /functions/v1/trigger-doa-agent?list=1
 * Returns all batches with their lot counts and statuses.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── GET: list batches ────────────────────────────────────────────────────
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("list") === "1") {
        return await handleListBatches(supabase);
      }
      return json({ error: "Use POST to trigger agent or GET ?list=1 to list batches" }, 400);
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const { batch_id, doa_first_lot_url, reset_failed = false } = body;

    if (!batch_id) {
      return json({ error: "batch_id is required" }, 400);
    }

    // ── Mark lots as pending ─────────────────────────────────────────────────
    // Only reset lots that are pending/failed (never touch completed ones)
    const statusFilter = reset_failed
      ? ["pending", "failed", null]
      : ["pending", null];

    const { data: updatedRows, error: updateError } = await supabase
      .from("denver_batch_rows")
      .update({ status: "pending", error_log: null })
      .eq("batch_id", batch_id)
      .in("status", statusFilter)
      .select("id, lot_number, status");

    if (updateError) throw updateError;

    // Also reset rows with null status (not captured by .in() above)
    const { data: nullRows } = await supabase
      .from("denver_batch_rows")
      .update({ status: "pending", error_log: null })
      .eq("batch_id", batch_id)
      .is("status", null)
      .select("id, lot_number");

    const totalQueued = (updatedRows?.length ?? 0) + (nullRows?.length ?? 0);

    // ── Optionally store the DOA first lot URL ────────────────────────────────
    if (doa_first_lot_url) {
      const { error: urlError } = await supabase
        .from("la_batches")
        .update({ doa_first_lot_url })
        .eq("id", batch_id);

      if (urlError) {
        console.warn("Could not save doa_first_lot_url:", urlError.message);
      }
    }

    // ── Fetch batch summary for response ────────────────────────────────────
    const { data: batchRow } = await supabase
      .from("la_batches")
      .select("id, name, created_at, doa_first_lot_url")
      .eq("id", batch_id)
      .maybeSingle();

    const { data: lotCounts } = await supabase
      .from("denver_batch_rows")
      .select("status")
      .eq("batch_id", batch_id);

    const counts = { pending: 0, in_progress: 0, completed: 0, failed: 0 };
    for (const row of lotCounts ?? []) {
      const s = row.status ?? "pending";
      if (s in counts) counts[s as keyof typeof counts]++;
    }

    return json({
      ok: true,
      batch_id,
      batch_name: batchRow?.name ?? batch_id,
      lots_queued: totalQueued,
      lot_counts: counts,
      doa_first_lot_url: batchRow?.doa_first_lot_url ?? null,
      message: totalQueued > 0
        ? `${totalQueued} lot(s) queued. The agent will pick them up within 30 seconds.`
        : "No pending lots found — all may already be completed.",
    });
  } catch (err) {
    console.error("trigger-doa-agent error:", err);
    return json({ error: String(err) }, 500);
  }
});

// ── List all batches with status counts ──────────────────────────────────────

async function handleListBatches(supabase: ReturnType<typeof createClient>) {
  const { data: rows, error } = await supabase
    .from("denver_batch_rows")
    .select("batch_id, status, lot_number, title")
    .order("lot_number");

  if (error) return json({ error: error.message }, 500);

  // Group by batch_id
  const batchMap = new Map<string, {
    id: string; pending: number; in_progress: number;
    completed: number; failed: number; total: number;
  }>();

  for (const row of rows ?? []) {
    const key = row.batch_id ?? "unknown";
    if (!batchMap.has(key)) {
      batchMap.set(key, { id: key, pending: 0, in_progress: 0, completed: 0, failed: 0, total: 0 });
    }
    const b = batchMap.get(key)!;
    b.total++;
    const s = row.status ?? "pending";
    if (s in b) (b as any)[s]++;
  }

  // Enrich with batch names
  const batchIds = Array.from(batchMap.keys()).filter(id => id !== "unknown");
  let nameMap = new Map<string, string>();
  if (batchIds.length > 0) {
    const { data: batchMeta } = await supabase
      .from("la_batches")
      .select("id, name, created_at, doa_first_lot_url")
      .in("id", batchIds);
    for (const b of batchMeta ?? []) {
      nameMap.set(b.id, b.name);
    }
  }

  const batches = Array.from(batchMap.values()).map(b => ({
    ...b,
    name: nameMap.get(b.id) ?? b.id.slice(0, 8) + "…",
  }));

  return json({ batches });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
