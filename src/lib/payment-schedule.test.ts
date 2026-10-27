import { describe, expect, it } from "vitest";
import {
  addUnits,
  resolveSchedule,
  scheduleAttention,
  describeCadence,
  type ScheduleInstallmentInput,
} from "./payment-schedule";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const inst = (
  over: Partial<ScheduleInstallmentInput> & { id: string },
): ScheduleInstallmentInput => ({
  label: null,
  percent: null,
  fixedAmount: null,
  anchor: "EVENT_START",
  offsetValue: 0,
  offsetUnit: "DAY",
  sortOrder: 0,
  ...over,
});

// The issue's canonical example: 20% at 180 days out, 30% at 90, balance at 30.
const deposit = inst({ id: "a", label: "Deposit", percent: 20, offsetValue: 180 });
const second = inst({ id: "b", percent: 30, offsetValue: 90 });
const balance = inst({ id: "c", label: "Balance", percent: 50, offsetValue: 30 });

const opts = {
  agreedTotal: 1000,
  paidTotal: 0,
  tripStartDate: utc("2026-12-01"),
  bookingDate: utc("2026-05-01"),
  today: utc("2026-07-14"),
};

describe("resolveSchedule — EVENT_START anchor", () => {
  it("derives amounts from percentages and dates from offsets before start", () => {
    const [a, b, c] = resolveSchedule([deposit, second, balance], opts);
    expect(a).toMatchObject({ amountDue: 200, dueDate: "2026-06-04", state: "overdue" });
    expect(b).toMatchObject({ amountDue: 300, dueDate: "2026-09-02", state: "upcoming" });
    expect(c).toMatchObject({ amountDue: 500, dueDate: "2026-11-01", state: "upcoming" });
  });

  it("orders earliest-due first regardless of input order", () => {
    const ids = resolveSchedule([balance, deposit, second], opts).map((r) => r.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("rounds percentage amounts to cents", () => {
    const [third] = resolveSchedule(
      [inst({ id: "t", percent: 33.33, offsetValue: 30 })],
      opts,
    );
    expect(third.amountDue).toBe(333.3);
  });

  it("uses a fixed amount as-is, even without an agreed price", () => {
    const [fixed] = resolveSchedule(
      [inst({ id: "f", fixedAmount: 250, offsetValue: 60 })],
      { ...opts, agreedTotal: null },
    );
    expect(fixed).toMatchObject({ amountDue: 250, state: "upcoming" });
  });

  it("allocates the payment log oldest-due-first", () => {
    const rows = resolveSchedule([deposit, second, balance], {
      ...opts,
      paidTotal: 350,
    });
    expect(rows.map((r) => ({ covered: r.covered, state: r.state }))).toEqual([
      { covered: 200, state: "paid" },
      { covered: 150, state: "upcoming" },
      { covered: 0, state: "upcoming" },
    ]);
  });

  it("treats an installment due exactly today as not yet overdue", () => {
    const [row] = resolveSchedule(
      [inst({ id: "d", percent: 100, offsetValue: 140 })],
      opts,
    );
    expect(row).toMatchObject({ dueDate: "2026-07-14", state: "upcoming" });
  });

  it("supports negative offsets (due after trip start)", () => {
    const [row] = resolveSchedule(
      [inst({ id: "n", percent: 100, offsetValue: -7 })],
      opts,
    );
    expect(row.dueDate).toBe("2026-12-08");
  });

  it("marks unresolvable installments unscheduled", () => {
    // Percentage with no agreed price…
    const [noPrice] = resolveSchedule([deposit], { ...opts, agreedTotal: null });
    expect(noPrice).toMatchObject({ amountDue: null, outstanding: null, state: "unscheduled" });
    // …and a dated anchor on a date-less trip (template).
    const [noDates] = resolveSchedule([deposit], { ...opts, tripStartDate: null });
    expect(noDates).toMatchObject({ dueDate: null, state: "unscheduled" });
  });
});

describe("resolveSchedule — BOOKING anchor", () => {
  it("dates installments forward from the booking date, by unit", () => {
    const [days] = resolveSchedule(
      [inst({ id: "d", fixedAmount: 100, anchor: "BOOKING", offsetValue: 14, offsetUnit: "DAY" })],
      opts,
    );
    expect(days.dueDate).toBe("2026-05-15"); // 2026-05-01 + 14 days

    const [months] = resolveSchedule(
      [inst({ id: "m", fixedAmount: 100, anchor: "BOOKING", offsetValue: 3, offsetUnit: "MONTH" })],
      opts,
    );
    expect(months.dueDate).toBe("2026-08-01"); // + 3 calendar months

    const [onBooking] = resolveSchedule(
      [inst({ id: "z", fixedAmount: 100, anchor: "BOOKING", offsetValue: 0, offsetUnit: "DAY" })],
      opts,
    );
    // Booking date is in the past relative to `today` → overdue.
    expect(onBooking).toMatchObject({ dueDate: "2026-05-01", state: "overdue" });
  });

  it("is unscheduled when the booking date isn't known yet", () => {
    const [row] = resolveSchedule(
      [inst({ id: "b", fixedAmount: 100, anchor: "BOOKING", offsetValue: 30, offsetUnit: "DAY" })],
      { ...opts, bookingDate: null },
    );
    expect(row).toMatchObject({ dueDate: null, state: "unscheduled" });
  });
});

describe("resolveSchedule — NONE anchor", () => {
  const none = inst({ id: "n", fixedAmount: 300, anchor: "NONE", offsetValue: null, offsetUnit: null });

  it("is owed but never overdue and carries no date", () => {
    const [row] = resolveSchedule([none], { ...opts, today: utc("2030-01-01") });
    expect(row).toMatchObject({ dueDate: null, state: "upcoming", outstanding: 300 });
  });

  it("becomes paid once covered", () => {
    const [row] = resolveSchedule([none], { ...opts, paidTotal: 300 });
    expect(row.state).toBe("paid");
  });

  it("sorts after dated installments, so it absorbs payments last", () => {
    const dated = inst({ id: "d", fixedAmount: 200, offsetValue: 30 });
    const rows = resolveSchedule([none, dated], { ...opts, paidTotal: 200 });
    // dated (earliest) covered first; the undated NONE gets nothing.
    expect(rows.map((r) => ({ id: r.id, covered: r.covered }))).toEqual([
      { id: "d", covered: 200 },
      { id: "n", covered: 0 },
    ]);
  });
});

describe("scheduleAttention", () => {
  it("totals overdue outstanding and picks the next dated upcoming installment", () => {
    const resolved = resolveSchedule([deposit, second, balance], {
      ...opts,
      paidTotal: 50,
      today: utc("2026-10-01"), // deposit + second both past due
    });
    const { overdueAmount, nextDue } = scheduleAttention(resolved);
    expect(overdueAmount).toBe(450); // (200-50) overdue + 300 overdue
    expect(nextDue?.id).toBe("c");
  });

  it("reports nothing when the schedule is fully covered", () => {
    const resolved = resolveSchedule([deposit, second, balance], {
      ...opts,
      paidTotal: 1000,
      today: utc("2026-10-01"),
    });
    expect(scheduleAttention(resolved)).toEqual({ overdueAmount: 0, nextDue: null });
  });
});

describe("describeCadence", () => {
  it("phrases each anchor in its natural direction", () => {
    expect(describeCadence({ anchor: "EVENT_START", offsetValue: 180, offsetUnit: "DAY" })).toBe(
      "180 days before start",
    );
    expect(describeCadence({ anchor: "EVENT_START", offsetValue: -7, offsetUnit: "DAY" })).toBe(
      "7 days after start",
    );
    expect(describeCadence({ anchor: "BOOKING", offsetValue: 3, offsetUnit: "MONTH" })).toBe(
      "3 months after booking",
    );
    expect(describeCadence({ anchor: "BOOKING", offsetValue: 0, offsetUnit: "DAY" })).toBe(
      "on booking date",
    );
    expect(describeCadence({ anchor: "NONE", offsetValue: null, offsetUnit: null })).toBe(
      "no set deadline",
    );
  });
});

describe("addUnits (MONTH clamps to the target month's last day)", () => {
  it("1 month before May 31 is Apr 30, not May 1", () => {
    expect(addUnits(utc("2026-05-31"), -1, "MONTH")).toEqual(utc("2026-04-30"));
  });

  it("Jan 31 + 1 month is the end of February (leap-aware)", () => {
    expect(addUnits(utc("2026-01-31"), 1, "MONTH")).toEqual(utc("2026-02-28"));
    expect(addUnits(utc("2024-01-31"), 1, "MONTH")).toEqual(utc("2024-02-29"));
  });

  it("crosses year boundaries and keeps in-range days as-is", () => {
    expect(addUnits(utc("2026-03-15"), -3, "MONTH")).toEqual(utc("2025-12-15"));
    expect(addUnits(utc("2026-11-30"), 3, "MONTH")).toEqual(utc("2027-02-28"));
  });

  it("keeps the time of day on a timestamped anchor", () => {
    const at = new Date("2026-03-31T14:25:00.000Z");
    expect(addUnits(at, -1, "MONTH")).toEqual(new Date("2026-02-28T14:25:00.000Z"));
  });
});
