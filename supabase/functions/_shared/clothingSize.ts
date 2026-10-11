// eBay now rejects free-text clothing sizes ("Medium", "See Description"):
// Size must be a standard code — XS, S, M, L, XL, XXL, 3XL — or a number (8, 32x30).
// Pure (no Deno APIs) so vitest can import it from src/.

const WORD_SIZES: Record<string, string> = {
  "xxs": "XXS", "2xs": "XXS", "extra extra small": "XXS", "xx small": "XXS", "xx-small": "XXS",
  "xs": "XS", "x small": "XS", "x-small": "XS", "extra small": "XS", "extra-small": "XS",
  "s": "S", "sm": "S", "small": "S",
  "m": "M", "med": "M", "md": "M", "medium": "M",
  "l": "L", "lg": "L", "large": "L",
  "xl": "XL", "x large": "XL", "x-large": "XL", "extra large": "XL", "extra-large": "XL",
  "xxl": "XXL", "2xl": "XXL", "xx large": "XXL", "xx-large": "XXL", "extra extra large": "XXL",
  "xxxl": "3XL", "3xl": "3XL", "xxx-large": "3XL",
  "xxxxl": "4XL", "4xl": "4XL",
  "5xl": "5XL",
};

const JUNK = /^(see\s*(desc\w*|title|photos?|pics?)|n\/?a|none|unknown|tbd|\?+|-+|one size fits all|os)$/i;

/** Returns a standard size, or null if the value is empty/junk. Numeric sizes pass through. */
export function normalizeClothingSize(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().replace(/^size[:\s]+/i, "");
  if (!v || JUNK.test(v)) return null;
  const whole = WORD_SIZES[v.toLowerCase().replace(/\s+/g, " ")];
  if (whole) return whole;
  // Ranges ("S/M", "6-8") are rejected by eBay: no single size, caller leaves Size unset.
  if (/[/]|\d+\s*-\s*\d+/.test(v)) return null;
  return v;
}

const TEXT_WORD = "(?:xxs|xs|extra[- ]small|small|medium|large|x-?large|extra[- ]large|xxl|2xl|xxxl|3xl|4xl|5xl)";

/**
 * Finds an unambiguous size in listing text. Single letters (S/M/L) only count
 * after "Size"/"Sz" or in parentheses — a bare "L" in a title is not a size.
 */
export function deriveSizeFromText(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    const labelled = t.match(/\b(?:size|sz)\s*[:\-]?\s*(xxs|xs|s|m|l|xl|xxl|2xl|xxxl|3xl|4xl|5xl|small|medium|large|x-?large|extra[- ]large|extra[- ]small)\b/i);
    if (labelled) return normalizeClothingSize(labelled[1]);
    const paren = t.match(/\(\s*(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|5xl)\s*\)/i);
    if (paren) return normalizeClothingSize(paren[1]);
    const word = t.match(new RegExp(`\\b(${TEXT_WORD})\\b`, "i"));
    if (word) return normalizeClothingSize(word[1]);
  }
  return null;
}
