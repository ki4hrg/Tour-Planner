import { describe, expect, it } from "vitest";
import { shareDocumentWhere, shareableDocumentWhere } from "./share-documents";

describe("shareableDocumentWhere", () => {
  it("reaches the trip, its bookings and its stays for a whole-trip link", () => {
    expect(shareableDocumentWhere("t1", "PARTICIPANT", null)).toEqual({
      OR: [
        { tripId: "t1" },
        {
          booking: {
            OR: [{ tripId: "t1" }, { scheduleItem: { day: { tripId: "t1" } } }],
          },
        },
        { stay: { tripId: "t1" } },
      ],
    });
  });

  it("never reaches venue documents from a whole-trip link", () => {
    // Location files are global across trips — one trip's link must not open them.
    const where = shareableDocumentWhere("t1", "STAFF", null);
    expect(JSON.stringify(where)).not.toContain("locationId");
  });

  it("narrows a host-site link to its own venue", () => {
    const where = shareableDocumentWhere("t1", "HOST_SITE", "loc1");
    expect(where).toEqual({
      OR: [
        { locationId: "loc1" },
        { booking: { tripId: "t1", locationId: "loc1" } },
        { stay: { tripId: "t1", locationId: "loc1" } },
        { tripId: "t1" },
      ],
    });
  });

  it("treats an unscoped host-site link like any whole-trip link", () => {
    expect(shareableDocumentWhere("t1", "HOST_SITE", null)).toEqual(
      shareableDocumentWhere("t1", "PARTICIPANT", null),
    );
  });
});

describe("shareDocumentWhere", () => {
  it("requires an explicit release for every non-staff audience", () => {
    for (const audience of ["PARTICIPANT", "HOST_SITE"] as const) {
      const where = shareDocumentWhere({
        tripId: "t1",
        audience,
        locationId: null,
      });
      expect(where.AND).toContainEqual({ shareAudiences: { has: audience } });
    }
  });

  it("gives a staff link the unfiltered trip scope", () => {
    const where = shareDocumentWhere({
      tripId: "t1",
      audience: "STAFF",
      locationId: null,
    });
    expect(where).toEqual(shareableDocumentWhere("t1", "STAFF", null));
    expect(JSON.stringify(where)).not.toContain("shareAudiences");
  });

  it("keeps the venue scope on a released host-site link", () => {
    const where = shareDocumentWhere({
      tripId: "t1",
      audience: "HOST_SITE",
      locationId: "loc1",
    });
    expect(where.AND).toEqual([
      shareableDocumentWhere("t1", "HOST_SITE", "loc1"),
      { shareAudiences: { has: "HOST_SITE" } },
    ]);
  });
});
