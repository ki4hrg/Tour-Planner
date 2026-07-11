import { z } from "zod";
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
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd."),
  method: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export type PaymentInput = z.infer<typeof paymentSchema>;
