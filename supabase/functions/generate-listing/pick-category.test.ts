// Run: deno test supabase/functions/generate-listing/pick-category.test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { type CategorySuggestion, pickCategorySuggestion } from "./pick-category.ts";

const s = (categoryId: string, path: string[]): CategorySuggestion => ({
  category: { categoryId, categoryName: path[path.length - 1] },
  categoryTreeNodeAncestors: path.slice(0, -1).reverse().map((categoryName) => ({ categoryName })),
});

const shirts = s("57990", ["Clothing, Shoes & Accessories", "Men", "Men's Clothing", "Shirts", "Casual Button-Down Shirts"]);
const patches = s("4725", ["Collectibles", "Militaria", "WW II (1939-45)", "Original Period Items", "United States", "Patches"]);
const tanks = s("171138", ["Toys & Hobbies", "Diecast & Toy Vehicles", "Tanks & Military Vehicles"]);
const locomotives = s("262303", ["Toys & Hobbies", "Model Railroads & Trains", "Railroads & Trains", "Locomotives"]);
const decals = s("262310", ["Toys & Hobbies", "Model Railroads & Trains", "Railroads & Trains", "Parts & Accessories", "Decals"]);
const contemporary = s("180506", ["Toys & Hobbies", "Diecast & Toy Vehicles", "Cars, Trucks & Vans", "Contemporary Manufacture"]);
const cokeTrucks = s("13611", ["Collectibles", "Advertising", "Soda", "Coca-Cola", "Trucks & Cars"]);

Deno.test("WWII model: the model's category name beats eBay's #1 (shirts)", () => {
  assertEquals(pickCategorySuggestion("Tanks & Military Vehicles", [shirts, patches, tanks])?.category.categoryId, "171138");
  assertEquals(pickCategorySuggestion("Diecast Military Vehicles", [shirts, patches, tanks])?.category.categoryId, "171138");
});

Deno.test("trains and diecast keep the right category", () => {
  assertEquals(pickCategorySuggestion("HO Scale Locomotives", [decals, locomotives])?.category.categoryId, "262303");
  assertEquals(pickCategorySuggestion("Model Railroads & Trains", [locomotives, decals])?.category.categoryId, "262303");
  assertEquals(pickCategorySuggestion("Die-Cast Toy Vehicles", [cokeTrucks, contemporary])?.category.categoryId, "180506");
});

Deno.test("no name or no overlap keeps eBay's #1 (previous behaviour)", () => {
  assertEquals(pickCategorySuggestion(undefined, [shirts, tanks])?.category.categoryId, "57990");
  assertEquals(pickCategorySuggestion("Collectible Figurine", [locomotives, decals])?.category.categoryId, "262303");
  assertEquals(pickCategorySuggestion("Anything", []), undefined);
});
