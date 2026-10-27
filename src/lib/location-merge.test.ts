import { describe, expect, it } from "vitest";
import {
  joinText,
  mergeBookingFields,
  mergeHostSiteFields,
  mergeLocationFields,
  type MergeableBookingFields,
  type MergeableLocationFields,
} from "./location-merge";

const loc = (o: Partial<MergeableLocationFields> = {}): MergeableLocationFields => ({
  regionId: null,
  address: null,
  description: null,
  notes: null,
  website: null,
  mapUrl: null,
  bookable: true,
  bookingOpensLeadDays: null,
  bookingNotes: null,
  scheduleLimitations: null,
  primaryContactId: null,
  archivedAt: null,
  ...o,
});

const booking = (o: Partial<MergeableBookingFields> = {}): MergeableBookingFields => ({
  status: "PLANNED",
  label: null,
  bookedContactId: null,
  confirmationRef: null,
  notes: null,
  bookedOn: null,
  agreedAmount: null,
  agreedCurrency: "USD",
  agreedUnit: null,
  ...o,
});

describe("joinText", () => {
  it("keeps whichever side is present", () => {
    expect(joinText(null, "b")).toBe("b");
    expect(joinText("a", null)).toBe("a");
    expect(joinText("  ", "")).toBeNull();
  });
  it("concatenates distinct text, never duplicates", () => {
    expect(joinText("a", "b")).toBe("a\n\nb");
    expect(joinText("same", "same")).toBe("same");
    expect(joinText("a\n\nb", "b")).toBe("a\n\nb");
  });
});

describe("mergeLocationFields", () => {
  it("target wins, source fills gaps", () => {
    const m = mergeLocationFields(
      loc({ address: "1 High St", regionId: "r1" }),
      loc({ address: "Elsewhere", website: "https://x", regionId: "r2", bookingOpensLeadDays: 90 }),
    );
    expect(m.address).toBe("1 High St");
    expect(m.regionId).toBe("r1");
    expect(m.website).toBe("https://x");
    expect(m.bookingOpensLeadDays).toBe(90);
  });
  it("concatenates notes and stays live unless both were archived", () => {
    const d = new Date("2026-01-01");
    expect(mergeLocationFields(loc({ notes: "a" }), loc({ notes: "b" })).notes).toBe("a\n\nb");
    expect(mergeLocationFields(loc({ archivedAt: d }), loc()).archivedAt).toBeNull();
    expect(mergeLocationFields(loc({ archivedAt: d }), loc({ archivedAt: d })).archivedAt).toBe(d);
  });
  it("is bookable if either was", () => {
    expect(mergeLocationFields(loc({ bookable: false }), loc()).bookable).toBe(true);
  });
});

describe("mergeBookingFields", () => {
  it("keeps the further-along status; NOT_NEEDED never beats a real booking", () => {
    expect(mergeBookingFields(booking({ status: "IN_PROGRESS" }), booking({ status: "CONFIRMED" })).status).toBe("CONFIRMED");
    expect(mergeBookingFields(booking({ status: "NOT_NEEDED" }), booking()).status).toBe("PLANNED");
    expect(mergeBookingFields(booking({ status: "CONFIRMED" }), booking({ status: "IN_PROGRESS" })).status).toBe("CONFIRMED");
  });
  it("carries the agreed price as a unit", () => {
    const m = mergeBookingFields(
      booking({ agreedCurrency: "USD" }),
      booking({ agreedAmount: "500.00", agreedCurrency: "GBP", agreedUnit: "PER_GROUP" }),
    );
    expect(m).toMatchObject({ agreedAmount: "500.00", agreedCurrency: "GBP", agreedUnit: "PER_GROUP" });
    const kept = mergeBookingFields(
      booking({ agreedAmount: 100, agreedCurrency: "USD", agreedUnit: "PER_PERSON" }),
      booking({ agreedAmount: 500, agreedCurrency: "GBP" }),
    );
    expect(kept).toMatchObject({ agreedAmount: 100, agreedCurrency: "USD", agreedUnit: "PER_PERSON" });
  });
  it("fills gaps and joins refs", () => {
    const d = new Date("2026-03-01");
    const m = mergeBookingFields(
      booking({ confirmationRef: "A1" }),
      booking({ confirmationRef: "B2", bookedOn: d, bookedContactId: "c1" }),
    );
    expect(m.confirmationRef).toBe("A1\n\nB2");
    expect(m.bookedOn).toBe(d);
    expect(m.bookedContactId).toBe("c1");
  });
});

describe("mergeHostSiteFields", () => {
  it("ORs capabilities and joins notes", () => {
    expect(
      mergeHostSiteFields(
        { providesLodging: true, providesMeals: false, providesMeetingSpace: false, staffNotes: "x", logisticsNotes: null },
        { providesLodging: false, providesMeals: true, providesMeetingSpace: false, staffNotes: "y", logisticsNotes: "z" },
      ),
    ).toEqual({ providesLodging: true, providesMeals: true, providesMeetingSpace: false, staffNotes: "x\n\ny", logisticsNotes: "z" });
  });
});
