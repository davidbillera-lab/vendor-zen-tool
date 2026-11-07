import { describe, it, expect } from "vitest";
import { normalizeClothingSize, deriveSizeFromText, reconcileSizeWithLiveValues } from "../../../supabase/functions/_shared/clothingSize";

describe("normalizeClothingSize", () => {
  it("maps words to codes and drops junk", () => {
    expect(normalizeClothingSize("Small")).toBe("S");
    expect(normalizeClothingSize("medium")).toBe("M");
    expect(normalizeClothingSize("Large")).toBe("L");
    expect(normalizeClothingSize("X-Large")).toBe("XL");
    expect(normalizeClothingSize("Extra Small")).toBe("XS");
    expect(normalizeClothingSize("2XL")).toBe("XXL");
    expect(normalizeClothingSize("Size: Medium")).toBe("M");
    expect(normalizeClothingSize("Small/Medium")).toBeNull();
    expect(normalizeClothingSize("6-8")).toBeNull();
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

describe("reconcileSizeWithLiveValues", () => {
  it("fixes the 10/30 shirt rejections", () => {
    const a: Record<string, string> = { Size: "XL", "Size Type": "Big & Tall" };
    reconcileSizeWithLiveValues(a, { size: ["S", "M", "L", "XL"], sizeType: ["Regular", "Big & Tall", "Tall"] });
    expect(a["Size Type"]).toBe("Regular");
    const b: Record<string, string> = { Size: "17 36/37", "Neck Size": "17", "Sleeve Length": "36/37", "Size Type": "Big & Tall" };
    reconcileSizeWithLiveValues(b, { size: ["16 34/35", "17 36/37"], sizeType: ["Regular", "Big & Tall"] });
    expect(b["Size"]).toBe("17 36/37");
    expect(b["Size Type"]).toBe("Big & Tall");
  });
});

it("rebuilds a deleted dress-shirt Size from neck + sleeve", () => {
  const c: Record<string, string> = { "Neck Size": "17", "Sleeve Length (Inches)": "36" };
  reconcileSizeWithLiveValues(c, { size: ["17 36/37"] });
  expect(c["Size"]).toBe("17 36/37");
});
