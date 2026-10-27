import { describe, expect, it } from "vitest";
import {
  joinText,
  mergeBookingFields,
  takesSourcePrice,
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
  googlePlaceId: null,
  lat: null,
  lng: null,
  placeIdCheckedAt: null,
  placeIdNeedsReview: false,
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
  agreedCurrency: "USD",
  priceLineCount: 0,
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
  it("adopts the source's place link and coordinates when the target has none", () => {
    const checked = new Date("2026-03-01");
    const m = mergeLocationFields(
      loc({ placeIdNeedsReview: true }),
      loc({ googlePlaceId: "ChIJsrc", placeIdCheckedAt: checked, lat: 53.5, lng: -0.8 }),
    );
    expect(m.googlePlaceId).toBe("ChIJsrc");
    expect(m.placeIdCheckedAt).toBe(checked);
    // The adopted link is a confirmed one; the target's stale flag goes with its missing ID.
    expect(m.placeIdNeedsReview).toBe(false);
    expect([m.lat, m.lng]).toEqual([53.5, -0.8]);
  });
  it("keeps the target's place link and coordinates as units", () => {
    const tChecked = new Date("2026-01-01");
    const m = mergeLocationFields(
      loc({ googlePlaceId: "ChIJtgt", placeIdCheckedAt: tChecked, lat: 51.5, lng: -0.1 }),
      loc({
        googlePlaceId: "ChIJsrc",
        placeIdCheckedAt: new Date("2026-06-01"),
        placeIdNeedsReview: true,
        lat: 53.5,
        lng: -0.8,
      }),
    );
    expect(m.googlePlaceId).toBe("ChIJtgt");
    expect(m.placeIdCheckedAt).toBe(tChecked);
    expect(m.placeIdNeedsReview).toBe(false);
    expect([m.lat, m.lng]).toEqual([51.5, -0.1]);
  });
  it("never mixes coordinates across sides", () => {
    // A half-set target pair (invalid, but defensive) falls back to the source pair whole.
    const m = mergeLocationFields(loc({ lat: 10 }), loc({ lat: 53.5, lng: -0.8 }));
    expect([m.lat, m.lng]).toEqual([53.5, -0.8]);
    expect(mergeLocationFields(loc(), loc({ lat: 1 }))).toMatchObject({ lat: null, lng: null });
  });
  it("keeps an open review flag when neither side is linked", () => {
    expect(mergeLocationFields(loc(), loc({ placeIdNeedsReview: true })).placeIdNeedsReview).toBe(true);
  });
});

describe("mergeBookingFields", () => {
  it("keeps the further-along status; NOT_NEEDED never beats a real booking", () => {
    expect(mergeBookingFields(booking({ status: "IN_PROGRESS" }), booking({ status: "CONFIRMED" })).status).toBe("CONFIRMED");
    expect(mergeBookingFields(booking({ status: "NOT_NEEDED" }), booking()).status).toBe("PLANNED");
    expect(mergeBookingFields(booking({ status: "CONFIRMED" }), booking({ status: "IN_PROGRESS" })).status).toBe("CONFIRMED");
  });
  it("carries the agreed price (lines + currency) as a unit; the target's wins", () => {
    const unpriced = booking({ agreedCurrency: "USD" });
    const priced = booking({ priceLineCount: 2, agreedCurrency: "GBP" });
    expect(takesSourcePrice(unpriced, priced)).toBe(true);
    const m = mergeBookingFields(unpriced, priced);
    expect(m).toMatchObject({ agreedCurrency: "GBP" });
    expect(m).not.toHaveProperty("priceLineCount");

    const target = booking({ priceLineCount: 1, agreedCurrency: "USD" });
    expect(takesSourcePrice(target, priced)).toBe(false);
    expect(mergeBookingFields(target, priced)).toMatchObject({ agreedCurrency: "USD" });
    expect(takesSourcePrice(unpriced, booking())).toBe(false);
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
