// ebay-publish reports missing specifics as a LIST — its guardrail says
// "Missing required item specifics (2): Gauge, Type." and eBay's combined
// rejection says "eBay needs these item specifics — Gauge, Type." — so read the
// whole list. The single-aspect patterns stay as a fallback for other wording.
export function parseMissingSpecifics(err: string): string[] {
  const list = err.match(/(?:Missing required item specifics \(\d+\):|eBay needs these item specifics —)\s*([^.]+)\./i);
  if (list) return list[1].split(",").map(s => s.trim()).filter(Boolean);
  const one = err.match(/item\s+specific[s]?\s+["']?([^"'.]+?)["']?\s+(is\s+missing|required)/i)
           || err.match(/Required[:\s]+([A-Za-z][^.]+?)(?:\.|$)/i);
  return one ? [one[1].trim()] : [];
}

// Blank inputs for the missing aspects; a value the operator already typed wins.
export const withBlankSpecifics = (specifics: Record<string, string> | undefined, names: string[]) =>
  ({ ...Object.fromEntries(names.map(n => [n, ""])), ...(specifics || {}) });
