import { describe, it, expect } from "vitest";
import { parseMissingSpecifics, withBlankSpecifics } from "./ebay-missing-specifics";

describe("parseMissingSpecifics", () => {
  it("reads every aspect from the ebay-publish guardrail message", () => {
    expect(parseMissingSpecifics(
      "Lot 3: Missing required item specifics (2): Gauge, Type. Add all of these in the item specifics panel before publishing.",
    )).toEqual(["Gauge", "Type"]);
  });

  it("reads every aspect from eBay's combined rejection", () => {
    expect(parseMissingSpecifics(
      "Lot 1 (cat:262303): eBay needs these item specifics — Type, Country/Region of Manufacture. Fill all of them, then push again.",
    )).toEqual(["Type", "Country/Region of Manufacture"]);
  });

  it("falls back to single-aspect wording and ignores unrelated errors", () => {
    expect(parseMissingSpecifics("The item specific Brand is missing.")).toEqual(["Brand"]);
    expect(parseMissingSpecifics("Lot 4 (cat:262303): [21916883] Condition is invalid")).toEqual([]);
  });
});

describe("withBlankSpecifics", () => {
  it("adds blank inputs without wiping values already typed", () => {
    expect(withBlankSpecifics({ Type: "Locomotive" }, ["Gauge", "Type"])).toEqual({ Gauge: "", Type: "Locomotive" });
  });
});
