import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    trip: { findUnique: vi.fn() },
    location: { findUnique: vi.fn() },
    locationPaymentScheduleItem: { findMany: vi.fn() },
    booking: { upsert: vi.fn(), findUnique: vi.fn() },
    // No global default workflow → new engagements start without one.
    bookingWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
    itineraryDay: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  applyStartDateChange,
  assertBookable,
  deleteItineraryDay,
  ensureVenueEngagement,
  shiftStaysForDeletedDay,
} from "./trip-mutations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

type StayRow = {
  id: string;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInDayIndex: number | null;
  checkOutDayIndex: number | null;
};

/** A minimal in-memory transaction client over days + stays. */
function fakeTx(opts: { days?: { id: string }[]; stays?: StayRow[] } = {}) {
  const stayUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const dayUpdates: { id: string; data: Record<string, unknown> }[] = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    itineraryDay: {
      findMany: vi.fn().mockResolvedValue(opts.days ?? []),
      findUnique: vi.fn(),
      update: vi.fn(async ({ where, data }) => {
        dayUpdates.push({ id: where.id, data });
      }),
      delete: vi.fn(),
    },
    stay: {
      findMany: vi.fn(async ({ where }) =>
        (opts.stays ?? []).filter((s) =>
          where.checkIn ? s.checkIn != null && s.checkOut != null : true,
        ),
      ),
      update: vi.fn(async ({ where, data }) => {
        stayUpdates.push({ id: where.id, data });
      }),
    },
  };
  return { tx, stayUpdates, dayUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shiftStaysForDeletedDay", () => {
  it("shifts template and dated stays, counts collapsed ones", async () => {
    const { tx, stayUpdates } = fakeTx({
      stays: [
        // template 1→3, delete day 2 → 1→2
        { id: "t1", checkIn: null, checkOut: null, checkInDayIndex: 1, checkOutDayIndex: 3 },
        // template 2→3 covers only night 2 → collapsed, untouched
        { id: "t2", checkIn: null, checkOut: null, checkInDayIndex: 2, checkOutDayIndex: 3 },
        // dated day 3→5 → day 2→4
        { id: "d1", checkIn: d("2026-06-03"), checkOut: d("2026-06-05"), checkInDayIndex: null, checkOutDayIndex: null },
        // dated before the deleted day → unchanged
        { id: "d2", checkIn: d("2026-06-01"), checkOut: d("2026-06-02"), checkInDayIndex: null, checkOutDayIndex: null },
      ],
    });
    const collapsed = await shiftStaysForDeletedDay(
      tx as never,
      "trip",
      2,
      d("2026-06-01"),
    );
    expect(collapsed).toBe(1);
    expect(stayUpdates).toEqual([
      { id: "t1", data: { checkInDayIndex: 1, checkOutDayIndex: 2 } },
      { id: "d1", data: { checkIn: d("2026-06-02"), checkOut: d("2026-06-04") } },
    ]);
  });
});

describe("applyStartDateChange", () => {
  it("redates days and shifts dated stays by the start delta", async () => {
    const { tx, stayUpdates, dayUpdates } = fakeTx({
      days: [{ id: "a" }, { id: "b" }],
      stays: [
        { id: "s", checkIn: d("2026-06-01"), checkOut: d("2026-06-02"), checkInDayIndex: null, checkOutDayIndex: null },
      ],
    });
    await applyStartDateChange(tx as never, "trip", d("2026-06-01"), d("2026-06-04"));
    expect(dayUpdates).toEqual([
      { id: "a", data: { dayIndex: 1, date: d("2026-06-04") } },
      { id: "b", data: { dayIndex: 2, date: d("2026-06-05") } },
    ]);
    expect(stayUpdates).toEqual([
      { id: "s", data: { checkIn: d("2026-06-04"), checkOut: d("2026-06-05") } },
    ]);
  });

  it("leaves stays alone on a dated ↔ date-less transition", async () => {
    const { tx, stayUpdates } = fakeTx({
      days: [{ id: "a" }],
      stays: [
        { id: "s", checkIn: d("2026-06-01"), checkOut: d("2026-06-02"), checkInDayIndex: null, checkOutDayIndex: null },
      ],
    });
    await applyStartDateChange(tx as never, "trip", d("2026-06-01"), null);
    expect(stayUpdates).toEqual([]);
  });
});

describe("assertBookable", () => {
  it("refuses a not-bookable location", async () => {
    db.location.findUnique.mockResolvedValue({ bookable: false });
    expect(await assertBookable("loc")).toMatch(/not bookable/);
  });
});

describe("ensureVenueEngagement", () => {
  it("errors when the trip does not exist", async () => {
    db.trip.findUnique.mockResolvedValue(null);
    expect(await ensureVenueEngagement("t", "l")).toEqual({
      error: "Trip not found.",
    });
    expect(db.booking.upsert).not.toHaveBeenCalled();
  });

  it("errors when the location is archived", async () => {
    db.trip.findUnique.mockResolvedValue({ id: "t" });
    db.location.findUnique.mockResolvedValue({
      archivedAt: new Date(),
      bookable: true,
    });
    expect(await ensureVenueEngagement("t", "l")).toEqual({
      error: "This location is archived.",
    });
    expect(db.booking.upsert).not.toHaveBeenCalled();
  });

  it("re-reads the booking after a concurrent-create P2002", async () => {
    db.trip.findUnique.mockResolvedValue({ id: "t" });
    db.location.findUnique.mockResolvedValue({ archivedAt: null, bookable: true });
    db.locationPaymentScheduleItem.findMany.mockResolvedValue([]);
    db.booking.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    db.booking.findUnique.mockResolvedValue({ id: "b1" });
    expect(await ensureVenueEngagement("t", "l")).toEqual({ bookingId: "b1" });
  });

  it("rethrows non-unique errors", async () => {
    db.trip.findUnique.mockResolvedValue({ id: "t" });
    db.location.findUnique.mockResolvedValue({ archivedAt: null, bookable: true });
    db.locationPaymentScheduleItem.findMany.mockResolvedValue([]);
    db.booking.upsert.mockRejectedValue(new Error("boom"));
    await expect(ensureVenueEngagement("t", "l")).rejects.toThrow("boom");
  });
});

describe("deleteItineraryDay", () => {
  it("locks the trip and reads the day inside the transaction", async () => {
    db.itineraryDay.findUnique.mockResolvedValue({ tripId: "trip" });
    const { tx } = fakeTx({ days: [] });
    tx.itineraryDay.findUnique.mockResolvedValue({
      tripId: "trip",
      dayIndex: 2,
      trip: { startDate: null },
    });
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    const res = await deleteItineraryDay("day");
    expect(res).toEqual({ tripId: "trip", collapsedStays: 0 });
    expect(tx.$queryRaw).toHaveBeenCalled();
    // Lock taken before the in-txn read.
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.itineraryDay.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.itineraryDay.delete).toHaveBeenCalledWith({ where: { id: "day" } });
  });

  it("reports not-found when the day vanished while waiting on the lock", async () => {
    db.itineraryDay.findUnique.mockResolvedValue({ tripId: "trip" });
    const { tx } = fakeTx();
    tx.itineraryDay.findUnique.mockResolvedValue(null);
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));
    expect(await deleteItineraryDay("day")).toEqual({ error: "Day not found." });
    expect(tx.itineraryDay.delete).not.toHaveBeenCalled();
  });
});
