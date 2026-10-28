import { z } from "zod";
import { isCalendarDate } from "./date";
import { TRIP_STATUSES } from "../trips";

// Empty string → undefined, then coerce to a positive int (headcount/capacity).
const optionalCount = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce
    .number()
    .int("Must be a whole number.")
    .nonnegative("Cannot be negative.")
    .optional(),
);

// Empty string → undefined; otherwise a "yyyy-mm-dd" string.
const optionalDate = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z
    .string()
    .refine(isCalendarDate, "Enter a valid date.")
    .optional(),
);

export const tripSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required."),
    tripTypeId: z.string().trim().min(1, "Choose a trip type."),
    startDate: optionalDate,
    endDate: optionalDate,
    capacity: optionalCount,
    participantCount: optionalCount,
    status: z.enum(TRIP_STATUSES as [string, ...string[]]),
    // The trip's currency vocabulary (checkbox group in the form). 3-letter ISO
    // codes, normalized to uppercase.
    currencies: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/, "Use 3-letter currency codes.")
          .transform((s) => s.toUpperCase()),
      )
      .min(1, "Pick at least one currency."),
    // The currency new stays / bookings / price lines start in — one of
    // `currencies`; omitted = the first one.
    defaultCurrency: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code.")
        .transform((s) => s.toUpperCase())
        .optional(),
    ),
    notes: z.string().trim().optional(),
    isTemplate: z.coerce.boolean().optional(),
  })
  .transform((d) => ({ ...d, defaultCurrency: d.defaultCurrency ?? d.currencies[0] }))
  .refine(
    (d) => !d.startDate || !d.endDate || d.endDate >= d.startDate,
    { message: "End date cannot be before start date.", path: ["endDate"] },
  )
  .refine((d) => d.currencies.includes(d.defaultCurrency), {
    message: "The default currency must be one of the trip's currencies.",
    path: ["defaultCurrency"],
  });

export type TripInput = z.infer<typeof tripSchema>;

// "Start from" on the create form: a template OR an ordinary (incl. archived)
// trip of the same type whose itinerary seeds the new one. Empty = blank.
export const sourceTripIdSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().trim().min(1).optional(),
);
