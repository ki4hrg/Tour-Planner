import { describe, it, expect } from "vitest";
import { buildTripFinance, type FinanceInput } from "./trip-finance";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = d("2026-10-28");

const base: FinanceInput = {
  tripId: "t1",
  headcount: 40,
  tripStartDate: d("2027-07-12"),
  today,
  locations: [
    {
      id: "sarum",
      name: "Sarum College",
      costs: [
        { label: "Room", amount: 100, currency: "GBP", unit: "PER_PERSON", confirmedAt: today },
      ],
    },
    {
      id: "chapel",
      name: "Wesley's Chapel",
      costs: [
        { label: "Admission", amount: 5, currency: "GBP", unit: "PER_PERSON", confirmedAt: null },
        { label: "Guide", amount: 60, currency: "GBP", unit: "PER_GROUP", confirmedAt: today },
      ],
    },
    { id: "free", name: "Free church", costs: [] },
    { id: "walk", name: "Walk-by", bookable: false, costs: [] },
  ],
  visitedLocationIds: ["chapel", "free", "walk", "sarum"],
  stays: [
    {
      id: "s1",
      locationId: "sarum",
      checkIn: d("2027-07-12"),
      checkOut: d("2027-07-15"),
      headcount: null,
      costPerPersonPerNight: 111,
      currency: "GBP",
    },
  ],
  bookings: [],
};

describe("buildTripFinance estimate", () => {
  it("prices visited venues from list prices and stays from nightly rates", () => {
    const f = buildTripFinance(base);
    expect(f.estimate).toHaveLength(1);
    const gbp = f.estimate[0];
    expect(gbp.currency).toBe("GBP");
    const byKey = Object.fromEntries(gbp.lines.map((l) => [l.key, l]));
    // 5 × 40 + 60
    expect(byKey["list:chapel:GBP"].amount).toBe(260);
    expect(byKey["list:chapel:GBP"].stale).toBe(true);
    // Sarum: list price 100 × 40 for the sessions + 3 nights × 40 × 111 lodging
    expect(byKey["list:sarum:GBP"].amount).toBe(4000);
    expect(byKey["stay:s1"].amount).toBe(13320);
    expect(byKey["stay:s1"].detail).toBe("3 nights × 40 × £111.00/person");
    expect(gbp.total).toBe(260 + 4000 + 13320);
    expect(f.hasStaleCost).toBe(true);
    // Only the bookable venue with no price at all is reported unpriced.
    expect(f.unpriced.map((u) => u.id)).toEqual(["free"]);
    expect(f.unpriced[0].href).toBe("/trips/t1/booking?venue=free");
  });

  it("an agreed engagement replaces the venue's list price AND its stays", () => {
    const f = buildTripFinance({
      ...base,
      bookings: [
        {
          id: "b1",
          locationId: "sarum",
          label: null,
          status: "CONFIRMED",
          stageLabel: "Confirmed",
          agreedCurrency: "GBP",
          priceLines: [{ label: "Package", amount: 300, unit: "PER_PERSON" }],
          payments: [2000],
          paymentSchedule: [],
          bookedOn: null,
          createdAt: d("2026-09-01"),
        },
      ],
    });
    const keys = f.estimate[0].lines.map((l) => l.key);
    expect(keys).toContain("agreed:b1");
    expect(keys).not.toContain("list:sarum:GBP");
    expect(keys).not.toContain("stay:s1");
    expect(f.estimate[0].total).toBe(260 + 12000);
    const money = f.money[0];
    expect(money).toMatchObject({
      currency: "GBP",
      estimate: 12260,
      agreed: 12000,
      paid: 2000,
      outstanding: 10000,
      unknown: 0,
    });
    expect(f.commitments[0]).toMatchObject({
      name: "Sarum College",
      href: "/trips/t1/booking?venue=sarum",
      agreedTotal: 12000,
      paid: 2000,
      outstanding: 10000,
      settled: false,
    });
  });

  it("drops a not-needed venue from the estimate entirely", () => {
    const f = buildTripFinance({
      ...base,
      bookings: [
        {
          id: "b2",
          locationId: "chapel",
          label: null,
          status: "NOT_NEEDED",
          stageLabel: null,
          agreedCurrency: "GBP",
          priceLines: [],
          payments: [],
          paymentSchedule: [],
          bookedOn: null,
          createdAt: d("2026-09-01"),
        },
      ],
    });
    expect(f.estimate[0].lines.map((l) => l.key)).not.toContain("list:chapel:GBP");
  });

  it("counts a per-person price with no headcount as unknown, not zero", () => {
    const f = buildTripFinance({ ...base, headcount: null, stays: [] });
    const gbp = f.estimate[0];
    expect(gbp.unknown).toBe(2);
    const chapel = gbp.lines.find((l) => l.key === "list:chapel:GBP")!;
    // Only the per-group line can be counted.
    expect(chapel.amount).toBe(0);
    expect(chapel.unknown).toBe(true);
  });

  it("a site booked via a parent is priced by the parent's agreed engagement", () => {
    const f = buildTripFinance({
      ...base,
      locations: [
        ...base.locations,
        { id: "child", name: "Charles' House", bookedViaId: "newroom", costs: [
          { label: "Entry", amount: 8, currency: "GBP", unit: "PER_PERSON", confirmedAt: today },
        ] },
        { id: "newroom", name: "New Room", costs: [] },
      ],
      visitedLocationIds: ["child"],
      stays: [],
      bookings: [
        {
          id: "b3",
          locationId: "newroom",
          label: null,
          status: "IN_PROGRESS",
          stageLabel: null,
          agreedCurrency: "GBP",
          priceLines: [{ label: "Combined", amount: 500, unit: "PER_GROUP" }],
          payments: [],
          paymentSchedule: [],
          bookedOn: null,
          createdAt: d("2026-09-01"),
        },
      ],
    });
    const keys = f.estimate[0].lines.map((l) => l.key);
    expect(keys).toEqual(["agreed:b3"]);
    expect(f.estimate[0].total).toBe(500);
  });
});

describe("buildTripFinance commitments and dues", () => {
  it("lists overdue installments first, then the next due, and links the day for item bookings", () => {
    const f = buildTripFinance({
      ...base,
      stays: [],
      bookings: [
        {
          id: "coach",
          locationId: null,
          label: "Coach hire",
          status: "CONFIRMED",
          stageLabel: null,
          agreedCurrency: "GBP",
          priceLines: [{ label: "Coach", amount: 1000, unit: "PER_GROUP" }],
          payments: [],
          paymentSchedule: [
            {
              id: "i1",
              label: "Deposit",
              percent: 50,
              fixedAmount: null,
              anchor: "BOOKING",
              offsetValue: 7,
              offsetUnit: "DAY",
              sortOrder: 0,
            },
            {
              id: "i2",
              label: "Balance",
              percent: 50,
              fixedAmount: null,
              anchor: "EVENT_START",
              offsetValue: 30,
              offsetUnit: "DAY",
              sortOrder: 1,
            },
          ],
          bookedOn: d("2026-09-01"),
          createdAt: d("2026-09-01"),
          item: { dayId: "day1", itemId: "it1", dayIndex: 1 },
        },
      ],
    });
    expect(f.commitments).toHaveLength(1);
    expect(f.commitments[0].href).toBe("/trips/t1/days/day1#item-it1");
    expect(f.commitments[0].overdueAmount).toBe(500);
    expect(f.overdueCount).toBe(1);
    expect(f.due.map((x) => [x.overdue, x.dueDate, x.amount])).toEqual([
      [true, "2026-09-08", 500],
      [false, "2027-06-12", 500],
    ]);
    // The coach's agreed price is part of the estimate too.
    expect(f.estimate[0].lines.find((l) => l.key === "agreed:coach")?.kind).toBe("item");
  });

  it("a booking with a payment but no price still shows as a commitment", () => {
    const f = buildTripFinance({
      ...base,
      stays: [],
      bookings: [
        {
          id: "b4",
          locationId: "chapel",
          label: null,
          status: "IN_PROGRESS",
          stageLabel: null,
          agreedCurrency: "GBP",
          priceLines: [],
          payments: [50],
          paymentSchedule: [],
          bookedOn: null,
          createdAt: d("2026-09-01"),
        },
      ],
    });
    expect(f.commitments[0]).toMatchObject({ agreedTotal: null, paid: 50, outstanding: null });
    expect(f.money[0]).toMatchObject({ agreed: 0, paid: 50, outstanding: 0 });
  });
});

describe("buildTripFinance off-ladder bookings", () => {
  const engagement = (status: "CANCELLED" | "NOT_NEEDED", paid: number[]) => ({
    id: "eng",
    locationId: "sarum",
    label: null,
    status,
    stageLabel: "Contract signed",
    agreedCurrency: "GBP",
    priceLines: [{ label: "Package", amount: 5000, unit: "PER_GROUP" as const }],
    payments: paid,
    paymentSchedule: [],
    bookedOn: d("2026-09-01"),
    createdAt: d("2026-09-01"),
    item: null,
  });

  it("a cancelled engagement counts only what was paid and owes nothing", () => {
    const f = buildTripFinance({ ...base, bookings: [engagement("CANCELLED", [500])] });
    const gbp = f.estimate[0];
    const keys = gbp.lines.map((l) => l.key);
    // Its list price and stay drop out; the paid deposit stays.
    expect(keys).not.toContain("list:sarum:GBP");
    expect(keys).not.toContain("stay:s1");
    expect(gbp.lines.find((l) => l.key === "agreed:eng")?.amount).toBe(500);
    const c = f.commitments.find((x) => x.key === "v:eng");
    expect(c?.outstanding).toBe(0);
    expect(c?.agreedTotal).toBe(500);
    expect(f.money[0].outstanding).toBe(0);
  });

  it("an unpaid not-needed engagement drops out entirely", () => {
    const f = buildTripFinance({ ...base, bookings: [engagement("NOT_NEEDED", [])] });
    expect(f.commitments).toEqual([]);
    expect(f.estimate[0].lines.map((l) => l.key)).not.toContain("agreed:eng");
  });
});
