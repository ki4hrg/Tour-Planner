import { describe, expect, it } from "vitest";
import { isSelfDescribingKind, kindFields } from "./schedule-kinds";

describe("kindFields", () => {
  it("shows meal fields only for a meal (or an item already a meal)", () => {
    expect(kindFields("MEAL").meal).toBe(true);
    expect(kindFields("VISIT").meal).toBe(false);
    expect(kindFields("VISIT", { meal: true }).meal).toBe(true);
    expect(kindFields(null).meal).toBe(false);
  });

  it("shows the talk for presentations and general items", () => {
    expect(kindFields("PRESENTATION").talk).toBe(true);
    expect(kindFields(null).talk).toBe(true);
    expect(kindFields("OTHER").talk).toBe(true);
    expect(kindFields("MEAL").talk).toBe(false);
    expect(kindFields("MEAL", { talk: true }).talk).toBe(true);
  });

  it("strips Free time to times + notes", () => {
    expect(kindFields("FREE")).toEqual({ venue: false, block: false, meal: false, talk: false });
    // …but never hides what an existing item already holds.
    expect(kindFields("FREE", { meal: true, venue: true, talk: true })).toEqual({
      venue: true,
      block: false,
      meal: true,
      talk: true,
    });
    expect(kindFields("TRAVEL", { talk: true }).talk).toBe(true);
    expect(isSelfDescribingKind("FREE")).toBe(true);
    expect(isSelfDescribingKind("MEAL")).toBe(false);
    expect(isSelfDescribingKind(null)).toBe(false);
  });
});
