// Covers supabase/functions/generate-listing/pick-category.ts (plain TS, no Deno APIs),
// placed under src/ so the standard `npx vitest` run enforces it.
import { describe, it, expect } from "vitest";
import { type CategorySuggestion, pickCategorySuggestion } from "../../supabase/functions/generate-listing/pick-category";

const s = (categoryId: string, path: string[]): CategorySuggestion => ({
  category: { categoryId, categoryName: path[path.length - 1] },
  categoryTreeNodeAncestors: path.slice(0, -1).reverse().map((categoryName) => ({ categoryName })),
});
const pick = (name: string | undefined, list: CategorySuggestion[]) => pickCategorySuggestion(name, list)?.category.categoryId;

const shirts = s("57990", ["Clothing, Shoes & Accessories", "Men", "Men's Clothing", "Shirts", "Casual Button-Down Shirts"]);
const tees = s("15687", ["Clothing, Shoes & Accessories", "Men", "Men's Clothing", "Shirts", "T-Shirts"]);
const patches = s("4725", ["Collectibles", "Militaria", "WW II (1939-45)", "Original Period Items", "United States", "Patches"]);
const tanks = s("171138", ["Toys & Hobbies", "Diecast & Toy Vehicles", "Tanks & Military Vehicles"]);
const locomotives = s("262303", ["Toys & Hobbies", "Model Railroads & Trains", "Railroads & Trains", "Locomotives"]);
const decals = s("262310", ["Toys & Hobbies", "Model Railroads & Trains", "Railroads & Trains", "Parts & Accessories", "Decals"]);
const contemporary = s("180506", ["Toys & Hobbies", "Diecast & Toy Vehicles", "Cars, Trucks & Vans", "Contemporary Manufacture"]);
const cokeTrucks = s("13611", ["Collectibles", "Advertising", "Soda", "Coca-Cola", "Trucks & Cars"]);

describe("pickCategorySuggestion", () => {
  it("WWII model: the model's category name beats eBay's #1 (shirts)", () => {
    expect(pick("Tanks & Military Vehicles", [shirts, patches, tanks])).toBe("171138");
    expect(pick("Diecast Military Vehicles", [shirts, patches, tanks])).toBe("171138");
  });

  it("trains and diecast keep the right category", () => {
    expect(pick("HO Scale Locomotives", [decals, locomotives])).toBe("262303");
    expect(pick("Model Railroads & Trains", [locomotives, decals])).toBe("262303");
    expect(pick("Die-Cast Toy Vehicles", [cokeTrucks, contemporary])).toBe("180506");
  });

  it("matches hyphenated names both joined and split", () => {
    expect(pick("Button Down Shirts", [tees, shirts])).toBe("57990");
    expect(pick("T-Shirts", [shirts, tees])).toBe("15687"); // "t" alone is too short to count; the joined "tshirt" decides
  });

  it("no name or no overlap keeps eBay's #1 (previous behaviour)", () => {
    expect(pick(undefined, [shirts, tanks])).toBe("57990");
    expect(pick("Collectible Figurine", [locomotives, decals])).toBe("262303");
    expect(pick("Anything", [])).toBeUndefined();
  });
});
