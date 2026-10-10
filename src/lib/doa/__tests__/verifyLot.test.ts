import { describe, it, expect } from "vitest";
import { changedFields, type DoaLotFields } from "../verifyLot";

const before: DoaLotFields = {
  title: "Marx O Gauge Tin Train Car",
  description: "Vintage tin litho car.",
  starting_bid: 5,
};

describe("changedFields — decides what AI Verify would actually change", () => {
  it("reports nothing when the audit returns no corrections", () => {
    expect(changedFields(before, {})).toEqual([]);
  });

  it("ignores corrections identical to the current values", () => {
    expect(changedFields(before, { ...before })).toEqual([]);
  });

  it("detects a title-only correction", () => {
    expect(changedFields(before, { title: "Marx O Gauge Tin Litho Gondola" })).toEqual(["title"]);
  });

  it("detects a starting-bid correction", () => {
    expect(changedFields(before, { starting_bid: 25 })).toEqual(["starting_bid"]);
  });

  it("detects multiple fields at once, in a stable order", () => {
    expect(
      changedFields(before, { title: "New Title", description: "New description", starting_bid: 9 }),
    ).toEqual(["title", "description", "starting_bid"]);
  });

  it("treats a bid of 0 as a real change, not as absent", () => {
    // 0 is falsy — a naive truthiness check would silently drop it.
    expect(changedFields(before, { starting_bid: 0 })).toEqual(["starting_bid"]);
  });

  it("does not report a change when the bid matches", () => {
    expect(changedFields(before, { starting_bid: 5 })).toEqual([]);
  });
});
