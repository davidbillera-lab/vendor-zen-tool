import { supabase } from "@/integrations/supabase/client";

/**
 * DOA (Denver Online Auctions) AI Verify — shared by the lot card on the main
 * screen and the lot editor, so both behave identically.
 *
 * Mirrors the eBay verify contract: this only FETCHES the audit. Nothing is
 * applied until the operator accepts it, which is also when the Hermes loop
 * captures the correction — capturing an unaccepted suggestion would teach the
 * loop from output a human never approved.
 */

export interface DoaLotFields {
  title: string;
  description: string;
  starting_bid: number;
}

export interface DoaVerifyResult {
  passed: boolean;
  report: string;
  corrected: Partial<DoaLotFields>;
}

export async function verifyDoaLot(
  lot: DoaLotFields & { image_urls?: string[] | null },
  masterPrompt?: string,
): Promise<DoaVerifyResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expired — sign in again");

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-listing`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        currentListing: {
          title: lot.title,
          description: lot.description,
          startingBid: lot.starting_bid,
        },
        correctionPrompt: "",
        imageUrls: lot.image_urls || [],
        platform: "denver",
        mode: "verify",
        masterPrompt: masterPrompt || undefined,
      }),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Verify failed (${response.status})`);
  }

  const data = await response.json();
  const cl = data.correctedListing ?? {};

  return {
    passed: !!data.passed,
    report: data.report || "",
    corrected: {
      // DOA titles cap at 100 characters.
      ...(cl.title ? { title: String(cl.title).substring(0, 100) } : {}),
      ...(cl.description ? { description: String(cl.description) } : {}),
      ...(cl.startingBid != null ? { starting_bid: Number(cl.startingBid) } : {}),
    },
  };
}

/** Fields the audit would actually change, ignoring no-op suggestions. */
export function changedFields(
  before: DoaLotFields,
  corrected: Partial<DoaLotFields>,
): Array<keyof DoaLotFields> {
  const changed: Array<keyof DoaLotFields> = [];
  if (corrected.title !== undefined && corrected.title !== before.title) changed.push("title");
  if (corrected.description !== undefined && corrected.description !== before.description) {
    changed.push("description");
  }
  if (corrected.starting_bid !== undefined && corrected.starting_bid !== before.starting_bid) {
    changed.push("starting_bid");
  }
  return changed;
}
