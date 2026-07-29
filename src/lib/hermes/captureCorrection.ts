import { supabase } from "@/integrations/supabase/client";

/**
 * Hermes loop — Stage 1 (Capture).
 *
 * Records an operator-accepted AI correction so later generations can learn from
 * it. Shared by every surface that lets a human correct AI output (the eBay batch
 * panel and the Create Listing page); keeping one implementation is what stops a
 * new UI from silently dropping out of the loop, which is exactly what happened
 * when the post-generation controls moved to CreateListing (8fff906, 2026-07-17)
 * and captures stopped for 12 days.
 *
 * Never throws — capture must not break the editing path.
 */
export async function captureCorrection(input: {
  // "guardrail" = a standing instruction the operator saved for a project. It has
  // no before/after pair, but it is the most explicit signal there is, so it feeds
  // the loop and becomes a lesson that outlives the project it was set on.
  source: "ai_verify" | "refine" | "guardrail";
  platform?: string;
  category?: string | null;
  wrongTitle?: string | null;
  correctedTitle?: string | null;
  wrongSpecifics?: Record<string, string> | null;
  correctedSpecifics?: Record<string, string> | null;
  correctionNote?: string | null;
  imageUrls?: string[] | null;
  // v2.4: when this correction lands on a row that was generated WITH learned
  // corrections injected, the injected lesson(s) failed -> flag them so they get
  // down-weighted/retired. All optional; absent = nothing to flag (v1 behavior).
  rowId?: string | null;
  injectedCorrectionIds?: string[] | null;
  correctedField?: "title" | "specifics" | "both";
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("listing_corrections").insert({
      user_id: user.id,
      source: input.source,
      platform: input.platform ?? "ebay",
      category: input.category ?? null,
      wrong_title: input.wrongTitle ?? null,
      corrected_title: input.correctedTitle ?? null,
      wrong_specifics: input.wrongSpecifics ?? null,
      corrected_specifics: input.correctedSpecifics ?? null,
      correction_note: input.correctionNote ?? null,
      image_urls: input.imageUrls ?? null,
    });
    // v2.4: if this row was shaped by injected lessons and got re-corrected on the
    // same kind of field, the lesson failed -> mark it (bumps times_failed, retires
    // at threshold, feeds the re-correction-rate metric). Fire-and-forget.
    if (input.rowId && input.injectedCorrectionIds?.length) {
      supabase.rpc("mark_corrections_re_corrected", {
        p_row_id: input.rowId,
        p_field: input.correctedField ?? "both",
        p_ids: input.injectedCorrectionIds,
      }).then(({ error }) => {
        if (error) console.warn("mark_corrections_re_corrected skipped (non-blocking):", error.message);
      });
    }
    // Fire-and-forget: embed the new correction(s) so semantic retrieval can
    // surface them later. Never awaited into the UI path; failures are ignored.
    supabase.functions
      .invoke("embed-corrections", { body: { limit: 25 } })
      .catch((e) => console.warn("embed-corrections invoke skipped (non-blocking):", e));
    supabase.functions
      .invoke("distill-lessons", { body: {} })
      .catch((e) => console.warn("distill-lessons trigger skipped (non-blocking):", e));
  } catch (e) {
    console.warn("captureCorrection failed (non-blocking):", e);
  }
}

export { diffCorrection } from "./diffCorrection";
