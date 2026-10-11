import { describe, it, expect } from "vitest";
import { normalizeClothingSize, deriveSizeFromText } from "../../../supabase/functions/_shared/clothingSize";

describe("normalizeClothingSize", () => {
  it("maps words to codes and drops junk", () => {
    expect(normalizeClothingSize("Small")).toBe("S");
    expect(normalizeClothingSize("medium")).toBe("M");
    expect(normalizeClothingSize("Large")).toBe("L");
    expect(normalizeClothingSize("X-Large")).toBe("XL");
    expect(normalizeClothingSize("Extra Small")).toBe("XS");
    expect(normalizeClothingSize("2XL")).toBe("XXL");
    expect(normalizeClothingSize("Size: Medium")).toBe("M");
    expect(normalizeClothingSize("Small/Medium")).toBe("S/M");
    expect(normalizeClothingSize("See Description")).toBeNull();
    expect(normalizeClothingSize("")).toBeNull();
  });
  it("leaves numeric sizes alone", () => {
    expect(normalizeClothingSize("10")).toBe("10");
    expect(normalizeClothingSize("32x30")).toBe("32x30");
  });
});

describe("deriveSizeFromText", () => {
  it("finds explicit sizes, ignores stray letters", () => {
    expect(deriveSizeFromText("Foxmoor Vintage Suede Blazer Womens Medium")).toBe("M");
    expect(deriveSizeFromText("Blouse", "Tag reads size L, pit to pit 20in")).toBe("L");
    expect(deriveSizeFromText("Boho Top (S) Floral")).toBe("S");
    expect(deriveSizeFromText("Lot L Vintage Blouse")).toBeNull();
  });
});
