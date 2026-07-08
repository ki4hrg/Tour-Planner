import { describe, it, expect } from "vitest";
import { timedInsertIndex } from "./schedule-order";

const item = (order: number, startTime: string | null) => ({ order, startTime });

describe("timedInsertIndex", () => {
  it("appends when the new item has no startTime", () => {
    const items = [item(1, "08:00"), item(2, "10:00")];
    expect(timedInsertIndex(items, null)).toBe(2);
    expect(timedInsertIndex(items, undefined)).toBe(2);
    expect(timedInsertIndex(items, "")).toBe(2);
  });

  it("slots an earlier item ahead of a later one", () => {
    // existing 10:00 item, add 07:00 → goes to the front
    const items = [item(1, "10:00")];
    expect(timedInsertIndex(items, "07:00")).toBe(0);
  });

  it("appends when the new item is the latest", () => {
    const items = [item(1, "08:00"), item(2, "10:00")];
    expect(timedInsertIndex(items, "12:00")).toBe(2);
  });

  it("inserts in the middle, before the first strictly-later item", () => {
    const items = [item(1, "08:00"), item(2, "10:00"), item(3, "14:00")];
    expect(timedInsertIndex(items, "11:00")).toBe(2);
  });

  it("places an equal-time item after existing same-time items", () => {
    const items = [item(1, "09:00"), item(2, "09:00"), item(3, "11:00")];
    expect(timedInsertIndex(items, "09:00")).toBe(2);
  });

  it("slots a timed item before unscheduled items (they sink to the end)", () => {
    // untimed items cluster at the end; a timed item never lands after one
    const items = [item(1, "08:00"), item(2, "10:00"), item(3, null)];
    expect(timedInsertIndex(items, "09:00")).toBe(1);
    // later than every timed item, but still ahead of the unscheduled item
    expect(timedInsertIndex(items, "12:00")).toBe(2);
    // front, ahead of everything
    expect(timedInsertIndex(items, "07:00")).toBe(0);
  });

  it("sorts by order before scanning (ignores array insertion order)", () => {
    const items = [item(3, "14:00"), item(1, "08:00"), item(2, "10:00")];
    expect(timedInsertIndex(items, "09:00")).toBe(1);
  });

  it("slots a timed item ahead of an all-untimed day", () => {
    const items = [item(1, null), item(2, null)];
    expect(timedInsertIndex(items, "09:00")).toBe(0);
  });

  it("appends a new untimed item to an all-untimed day", () => {
    const items = [item(1, null), item(2, null)];
    expect(timedInsertIndex(items, null)).toBe(2);
  });
});
