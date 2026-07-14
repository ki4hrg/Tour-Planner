import { describe, expect, it } from "vitest";
import {
  resolveSchedule,
  scheduleAttention,
  sortInstallments,
  type ScheduleInstallmentInput,
} from "./payment-schedule";

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const inst = (
  over: Partial<ScheduleInstallmentInput> & { id: string },
): ScheduleInstallmentInput => ({
  label: null,
  percent: null,
  fixedAmount: null,
  dueOffsetDays: 0,
  sortOrder: 0,
  ...over,
});

// The issue's canonical example: 20% at 180 days out, 30% at 90, balance at 30.
const deposit = inst({ id: "a", label: "Deposit", percent: 20, dueOffsetDays: 180 });
const second = inst({ id: "b", percent: 30, dueOffsetDays: 90 });
const balance = inst({ id: "c", label: "Balance", percent: 50, dueOffsetDays: 30 });

describe("sortInstallments", () => {
  it("orders furthest-out first, sortOrder as tiebreak", () => {
    const tied = [
      inst({ id: "y", dueOffsetDays: 90, sortOrder: 1 }),
      inst({ id: "x", dueOffsetDays: 90, sortOrder: 0 }),
    ];
    expect(sortInstallments([balance, ...tied, deposit]).map((i) => i.id)).toEqual([
      "a",
      "x",
      "y",
      "c",
    ]);
  });
});

describe("resolveSchedule", () => {
  const opts = {
    agreedAmount: 1000,
    paidTotal: 0,
    tripStartDate: utc("2026-12-01"),
    today: utc("2026-07-14"),
  };

  it("derives amounts from percentages and dates from offsets", () => {
    const [a, b, c] = resolveSchedule([deposit, second, balance], opts);
    expect(a).toMatchObject({ amountDue: 200, dueDate: "2026-06-04", state: "overdue" });
    expect(b).toMatchObject({ amountDue: 300, dueDate: "2026-09-02", state: "upcoming" });
    expect(c).toMatchObject({ amountDue: 500, dueDate: "2026-11-01", state: "upcoming" });
  });

  it("rounds percentage amounts to cents", () => {
    const [third] = resolveSchedule(
      [inst({ id: "t", percent: 33.33, dueOffsetDays: 30 })],
      opts,
    );
    expect(third.amountDue).toBe(333.3);
  });

  it("uses a fixed amount as-is, even without an agreed price", () => {
    const [fixed] = resolveSchedule(
      [inst({ id: "f", fixedAmount: 250, dueOffsetDays: 60 })],
      { ...opts, agreedAmount: null },
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
    const [row] = resolveSchedule([inst({ id: "d", percent: 100, dueOffsetDays: 140 })], opts);
    expect(row).toMatchObject({ dueDate: "2026-07-14", state: "upcoming" });
  });

  it("supports negative offsets (due after trip start)", () => {
    const [row] = resolveSchedule(
      [inst({ id: "n", percent: 100, dueOffsetDays: -7 })],
      opts,
    );
    expect(row.dueDate).toBe("2026-12-08");
  });

  it("marks unresolvable installments unscheduled", () => {
    // Percentage with no agreed price…
    const [noPrice] = resolveSchedule([deposit], { ...opts, agreedAmount: null });
    expect(noPrice).toMatchObject({ amountDue: null, outstanding: null, state: "unscheduled" });
    // …and any installment on a date-less trip (template).
    const [noDates] = resolveSchedule([deposit], { ...opts, tripStartDate: null });
    expect(noDates).toMatchObject({ dueDate: null, state: "unscheduled" });
  });
});

describe("scheduleAttention", () => {
  it("totals overdue outstanding and picks the next upcoming installment", () => {
    const resolved = resolveSchedule([deposit, second, balance], {
      agreedAmount: 1000,
      paidTotal: 50,
      tripStartDate: utc("2026-12-01"),
      today: utc("2026-10-01"), // deposit + second both past due
    });
    const { overdueAmount, nextDue } = scheduleAttention(resolved);
    expect(overdueAmount).toBe(450); // (200-50) overdue + 300 overdue
    expect(nextDue?.id).toBe("c");
  });

  it("reports nothing when the schedule is fully covered", () => {
    const resolved = resolveSchedule([deposit, second, balance], {
      agreedAmount: 1000,
      paidTotal: 1000,
      tripStartDate: utc("2026-12-01"),
      today: utc("2026-10-01"),
    });
    expect(scheduleAttention(resolved)).toEqual({ overdueAmount: 0, nextDue: null });
  });
});
