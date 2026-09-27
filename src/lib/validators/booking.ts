import { z } from "zod";
import { calendarDate } from "./date";
import { BOOKING_STATUSES } from "../trips";

const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

// Empty string / null → undefined; strings coerce to numbers (form inputs).
const optionalMoney = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().nonnegative("Amount can't be negative.").optional(),
);

export const bookingSchema = z.object({
  // Which member location this booking is for (empty = the item as a whole).
  locationId: optionalId,
  label: z.string().trim().optional(),
  status: z.enum(BOOKING_STATUSES as [string, ...string[]]),
  bookedContactId: optionalId,
  confirmationRef: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  // When the engagement was booked — anchors BOOKING-relative installments.
  bookedOn: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    calendarDate("Use a real yyyy-mm-dd date.").optional(),
  ),
  // The negotiated engagement price (asking price lives in the cost catalog).
  agreedAmount: optionalMoney,
  agreedCurrency: z.string().trim().optional(),
  agreedUnit: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.enum(["PER_PERSON", "PER_GROUP"]).optional(),
  ),
});

export type BookingInput = z.infer<typeof bookingSchema>;

export const paymentSchema = z.object({
  amount: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().positive("Amount must be positive."),
  ),
  currency: z.string().trim().min(1),
  // "yyyy-mm-dd"
  paidOn: calendarDate("Use a real yyyy-mm-dd date."),
  method: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

export const PAYMENT_ANCHORS = ["EVENT_START", "BOOKING", "NONE"] as const;
export const PAYMENT_OFFSET_UNITS = ["DAY", "WEEK", "MONTH"] as const;

// One installment of a payment schedule (GH #51; anchors #86 refinement). Exactly
// one of percent / fixedAmount. The due date is `offsetValue` `offsetUnit`s from
// the `anchor`: EVENT_START = before trip start (negative = after), BOOKING =
// after the booking date, NONE = no deadline (offset omitted).
const installmentSchema = z
  .object({
    label: z.string().trim().optional(),
    percent: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z
        .number()
        .positive("Percentage must be positive.")
        .max(100, "Percentage can't exceed 100.")
        .optional(),
    ),
    fixedAmount: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number().positive("Amount must be positive.").optional(),
    ),
    anchor: z.enum(PAYMENT_ANCHORS).default("EVENT_START"),
    offsetValue: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number().int("Offset must be a whole number.").optional(),
    ),
    offsetUnit: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.enum(PAYMENT_OFFSET_UNITS).optional(),
    ),
  })
  .refine((i) => (i.percent == null) !== (i.fixedAmount == null), {
    message: "Each installment needs a percentage or a fixed amount (not both).",
  })
  .refine(
    (i) =>
      i.anchor === "NONE" || (i.offsetValue != null && i.offsetUnit != null),
    {
      message: "A dated installment needs an offset value and unit.",
    },
  );

export const paymentScheduleSchema = z.object({
  installments: z.array(installmentSchema).max(20, "Too many installments."),
});

export type PaymentScheduleInput = z.infer<typeof paymentScheduleSchema>;

// Parsed installments → Prisma scalar rows shared by every write site (booking +
// location schedules, web action + MCP). Callers spread bookingId / locationId
// on top. NONE clears the offset fields to satisfy the payment_schedule_anchor CHECK.
export function installmentRows(installments: PaymentScheduleInput["installments"]) {
  return installments.map((i, idx) => ({
    label: i.label || null,
    percent: i.percent ?? null,
    fixedAmount: i.fixedAmount ?? null,
    anchor: i.anchor,
    offsetValue: i.anchor === "NONE" ? null : (i.offsetValue ?? null),
    offsetUnit: i.anchor === "NONE" ? null : (i.offsetUnit ?? null),
    sortOrder: idx,
  }));
}
