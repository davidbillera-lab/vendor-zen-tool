import { describe, it, expect } from "vitest";
import { diffCorrection } from "../diffCorrection";

describe("diffCorrection — decides what the Hermes loop learns from", () => {
  it("returns null when the AI changed nothing (nothing to learn)", () => {
    expect(diffCorrection(
      { title: "Lionel O Gauge Tender", specifics: { Brand: "Lionel" } },
      { title: "Lionel O Gauge Tender", specifics: { Brand: "Lionel" } },
    )).toBeNull();
  });

  it("detects a title-only correction", () => {
    expect(diffCorrection(
      { title: "Toy Train Car", specifics: { Brand: "Lionel" } },
      { title: "Lionel O Gauge Prewar Tender", specifics: { Brand: "Lionel" } },
    )).toEqual({ changed: true, correctedField: "title" });
  });

  it("detects a specifics-only correction", () => {
    expect(diffCorrection(
      { title: "Lionel Tender", specifics: { Brand: "Unbranded" } },
      { title: "Lionel Tender", specifics: { Brand: "Lionel", Gauge: "O" } },
    )).toEqual({ changed: true, correctedField: "specifics" });
  });

  it("detects both changing at once", () => {
    expect(diffCorrection(
      { title: "Toy Train", specifics: { Brand: "Unbranded" } },
      { title: "Lionel O Gauge Tender", specifics: { Brand: "Lionel" } },
    )).toEqual({ changed: true, correctedField: "both" });
  });

  it("compares titles at eBay's 80-char limit, not full length", () => {
    const base = "A".repeat(80);
    // Differs only beyond char 80 — eBay would store them identically, so this
    // must NOT count as a correction.
    expect(diffCorrection({ title: base, specifics: null }, { title: base + "EXTRA", specifics: null })).toBeNull();
  });

  it("ignores absent AI output rather than treating it as a change", () => {
    expect(diffCorrection(
      { title: "Lionel Tender", specifics: { Brand: "Lionel" } },
      { title: null, specifics: null },
    )).toBeNull();
  });

  it("treats first-time specifics as a correction", () => {
    expect(diffCorrection(
      { title: "Lionel Tender", specifics: null },
      { title: "Lionel Tender", specifics: { Brand: "Lionel" } },
    )).toEqual({ changed: true, correctedField: "specifics" });
  });
});
