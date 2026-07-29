/**
 * Hermes loop — pure decision logic for Stage 1 (Capture).
 *
 * Kept free of any Supabase/client import so it stays unit-testable: this is the
 * gate that decides what the loop learns from, so it needs real test coverage.
 */

/**
 * Decides whether an AI edit is worth capturing, and which field changed.
 * Returns null when nothing meaningful changed (identical output = nothing learned).
 */
export function diffCorrection(
  before: { title?: string | null; specifics?: Record<string, string> | null },
  after: { title?: string | null; specifics?: Record<string, string> | null },
): { changed: boolean; correctedField: "title" | "specifics" | "both" } | null {
  // Compare titles at eBay's 80-char limit — anything past it is never stored,
  // so a difference beyond that is not a real correction.
  const titleChanged = !!after.title &&
    String(after.title).substring(0, 80) !== (before.title ?? "").substring(0, 80);
  const specsChanged = !!after.specifics &&
    JSON.stringify(after.specifics) !== JSON.stringify(before.specifics ?? null);
  if (!titleChanged && !specsChanged) return null;
  return {
    changed: true,
    correctedField: titleChanged && specsChanged ? "both" : titleChanged ? "title" : "specifics",
  };
}
