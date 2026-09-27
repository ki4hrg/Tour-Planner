import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  bookingDashboardHref,
  defaultKindForTarget,
  documentTarget,
  fileExtension,
  filterDocumentsForShare,
  formatFileSize,
  isInlineViewable,
  resolveContentType,
  sanitizeFilename,
  shareAudienceOptions,
  shareBadgeLabel,
  stayHref,
  visibleToShareAudience,
  type DocumentTargetRow,
} from "./documents";

describe("sanitizeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeFilename("Vienna contract 2027.pdf")).toBe(
      "Vienna contract 2027.pdf",
    );
  });

  it("drops directory components from a path-shaped upload", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\john\\roster.xlsx")).toBe("roster.xlsx");
  });

  it("strips control characters and quotes that would break the header", () => {
    expect(sanitizeFilename('in\u0000voi"ce\u001f.pdf')).toBe("invoice.pdf");
  });

  it("refuses to produce a dotfile or an empty name", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });

  it("bounds the length, keeping the extension end", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const out = sanitizeFilename(long);
    expect(out).toHaveLength(200);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("fileExtension", () => {
  it("lowercases and drops the dot", () => {
    expect(fileExtension("Contract.PDF")).toBe("pdf");
  });

  it("is empty when there is no extension", () => {
    expect(fileExtension("contract")).toBe("");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
});

describe("resolveContentType", () => {
  it("accepts an allowlisted type as reported", () => {
    expect(resolveContentType("application/pdf", "a.pdf")).toBe(
      "application/pdf",
    );
  });

  it("normalizes case and strips parameters", () => {
    expect(resolveContentType("TEXT/CSV; charset=utf-8", "a.csv")).toBe(
      "text/csv",
    );
  });

  it("falls back to the extension when the browser says octet-stream", () => {
    expect(resolveContentType("application/octet-stream", "roster.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(resolveContentType("", "itinerary.pdf")).toBe("application/pdf");
    expect(resolveContentType(null, "notes.md")).toBe("text/markdown");
  });

  it("rejects executable-ish uploads outright", () => {
    expect(resolveContentType("text/html", "page.html")).toBeNull();
    expect(resolveContentType("image/svg+xml", "logo.svg")).toBeNull();
    expect(resolveContentType("application/x-sh", "run.sh")).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("reports bytes below a kilobyte", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("switches units and keeps one decimal until double digits", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatFileSize(1024 * 1024 * 12.4)).toBe("12 MB");
    expect(formatFileSize(1024 * 1024 * 1024 * 3)).toBe("3.0 GB");
  });
});

describe("isInlineViewable", () => {
  it("allows PDFs, plain text and raster images", () => {
    expect(isInlineViewable("application/pdf")).toBe(true);
    expect(isInlineViewable("image/png")).toBe(true);
    expect(isInlineViewable("text/plain")).toBe(true);
  });

  it("never allows SVG or office formats inline", () => {
    expect(isInlineViewable("image/svg+xml")).toBe(false);
    expect(
      isInlineViewable(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("marks attachments by default and inline on request", () => {
    expect(contentDisposition("a.pdf", false)).toMatch(/^attachment; /);
    expect(contentDisposition("a.pdf", true)).toMatch(/^inline; /);
  });

  it("carries a non-ASCII name in filename* and a safe ASCII fallback", () => {
    const header = contentDisposition("Führung Wien.pdf", false);
    expect(header).toContain('filename="F_hrung Wien.pdf"');
    expect(header).toContain(
      "filename*=UTF-8''F%C3%BChrung%20Wien.pdf",
    );
  });
});

describe("share visibility", () => {
  const participantDoc = { shareAudiences: ["PARTICIPANT"] as const };
  const hostDoc = { shareAudiences: ["HOST_SITE"] as const };
  const internalDoc = { shareAudiences: [] as const };

  it("shows staff links everything, released or not", () => {
    expect(visibleToShareAudience(internalDoc, "STAFF")).toBe(true);
    expect(visibleToShareAudience(participantDoc, "STAFF")).toBe(true);
  });

  it("releases a document only to the audiences it names", () => {
    expect(visibleToShareAudience(participantDoc, "PARTICIPANT")).toBe(true);
    expect(visibleToShareAudience(participantDoc, "HOST_SITE")).toBe(false);
    expect(visibleToShareAudience(hostDoc, "HOST_SITE")).toBe(true);
  });

  it("keeps unreleased documents off every non-staff link", () => {
    expect(visibleToShareAudience(internalDoc, "PARTICIPANT")).toBe(false);
    expect(visibleToShareAudience(internalDoc, "HOST_SITE")).toBe(false);
  });

  it("filters a list down to what the audience may see", () => {
    const docs = [participantDoc, hostDoc, internalDoc];
    expect(filterDocumentsForShare(docs, "PARTICIPANT")).toEqual([
      participantDoc,
    ]);
    expect(filterDocumentsForShare(docs, "HOST_SITE")).toEqual([hostDoc]);
    expect(filterDocumentsForShare(docs, "STAFF")).toHaveLength(3);
  });
});

describe("documentTarget", () => {
  const empty: DocumentTargetRow = {
    location: null,
    booking: null,
    trip: null,
    stay: null,
  };

  it("points a location document at the venue page", () => {
    expect(
      documentTarget({ ...empty, location: { id: "loc1", name: "Melk Abbey" } }),
    ).toEqual({ label: "Melk Abbey", href: "/locations/loc1" });
  });

  it("points a venue-engagement document at its row on the booking dashboard", () => {
    expect(
      documentTarget({
        ...empty,
        booking: {
          label: null,
          locationId: "loc1",
          location: { name: "Melk Abbey" },
          trip: { id: "t1", name: "Wesley 2027" },
          scheduleItem: null,
        },
      }),
    ).toEqual({
      label: "Melk Abbey — Wesley 2027",
      href: "/trips/t1/booking?venue=loc1",
    });
  });

  it("falls back to the plain dashboard when the venue id wasn't selected", () => {
    expect(
      documentTarget({
        ...empty,
        booking: {
          label: null,
          location: { name: "Melk Abbey" },
          trip: { id: "t1", name: "Wesley 2027" },
          scheduleItem: null,
        },
      }).href,
    ).toBe("/trips/t1/booking");
  });

  it("resolves a site-less item booking through its schedule item", () => {
    expect(
      documentTarget({
        ...empty,
        booking: {
          label: "Coach hire",
          location: null,
          trip: null,
          scheduleItem: { day: { trip: { id: "t2", name: "Wesley 2028" } } },
        },
      }),
    ).toEqual({ label: "Coach hire — Wesley 2028", href: "/trips/t2/booking" });
  });

  it("points trip documents at the trip page and stays at their anchor", () => {
    expect(
      documentTarget({ ...empty, trip: { id: "t3", name: "Wesley 2029" } }),
    ).toEqual({ label: "Wesley 2029", href: "/trips/t3" });
    expect(
      documentTarget({
        ...empty,
        stay: {
          id: "s1",
          trip: { id: "t4", name: "Wesley 2030" },
          location: { name: "Hotel Post" },
        },
      }),
    ).toEqual({ label: "Hotel Post — Wesley 2030", href: "/trips/t4#stay-s1" });
    expect(
      documentTarget({
        ...empty,
        stay: {
          trip: { id: "t4", name: "Wesley 2030" },
          location: { name: "Hotel Post" },
        },
      }).href,
    ).toBe("/trips/t4");
  });
});

describe("booking / stay hrefs", () => {
  it("encodes the venue and anchors the stay", () => {
    expect(bookingDashboardHref("t1")).toBe("/trips/t1/booking");
    expect(bookingDashboardHref("t1", null)).toBe("/trips/t1/booking");
    expect(bookingDashboardHref("t1", "a b")).toBe("/trips/t1/booking?venue=a%20b");
    expect(stayHref("t1", "s9")).toBe("/trips/t1#stay-s9");
  });
});

describe("defaultKindForTarget", () => {
  it("pre-sets the kind that usually belongs on each target", () => {
    expect(defaultKindForTarget("booking")).toBe("CONTRACT");
    expect(defaultKindForTarget("trip")).toBe("ITINERARY");
    expect(defaultKindForTarget("stay")).toBe("ROSTER");
    expect(defaultKindForTarget("location")).toBe("OTHER");
  });
});

describe("shareAudienceOptions", () => {
  const audiences = (ctx: Parameters<typeof shareAudienceOptions>[0]) =>
    shareAudienceOptions(ctx).map((o) => o.audience);

  it("never offers Participant on a venue file (participant links can't reach it)", () => {
    expect(audiences({ target: "location", venueName: "Melk" })).toEqual([
      "HOST_SITE",
    ]);
  });

  it("offers no host-site release on a site-less item booking", () => {
    expect(audiences({ target: "booking", venueName: null })).toEqual([
      "PARTICIPANT",
    ]);
  });

  it("offers both on trip, engagement and stay files", () => {
    expect(audiences({ target: "trip" })).toEqual(["PARTICIPANT", "HOST_SITE"]);
    expect(audiences({ target: "booking", venueName: "Melk" })).toEqual([
      "PARTICIPANT",
      "HOST_SITE",
    ]);
    expect(audiences({ target: "booking" })).toEqual(["PARTICIPANT", "HOST_SITE"]);
    expect(audiences({ target: "stay", venueName: "Hotel Post" })).toEqual([
      "PARTICIPANT",
      "HOST_SITE",
    ]);
  });

  it("says a trip file's host-site release reaches every venue", () => {
    const host = shareAudienceOptions({ target: "trip" }).find(
      (o) => o.audience === "HOST_SITE",
    );
    expect(host?.label).toBe("All host sites");
    expect(host?.hint).toMatch(/Every venue/);
  });
});

describe("shareBadgeLabel", () => {
  it("is staff only with nothing released", () => {
    expect(shareBadgeLabel([], { target: "trip" })).toBe("Staff only");
  });

  it("names every audience that the release reaches", () => {
    expect(shareBadgeLabel(["PARTICIPANT"], { target: "trip" })).toBe(
      "Participants",
    );
    expect(
      shareBadgeLabel(["PARTICIPANT", "HOST_SITE"], { target: "stay" }),
    ).toBe("Participants + Host sites");
  });

  it("ignores a release that can't reach the file", () => {
    expect(shareBadgeLabel(["PARTICIPANT"], { target: "location" })).toBe(
      "Staff only",
    );
  });
});
