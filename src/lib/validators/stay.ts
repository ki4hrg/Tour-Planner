import { z } from "zod";

const optionalTime = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).")
    .optional(),
);

const optionalInt = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int("Must be a whole number.").nonnegative().optional(),
);

const optionalMoney = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().nonnegative("Cannot be negative.").optional(),
);

// A 1-based day index (>= 1). Empty string / null → undefined.
const optionalDayIndex = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce
    .number()
    .int("Must be a whole number.")
    .positive("Day must be 1 or greater.")
    .optional(),
);

export const BOARD_TYPES = [
  "NONE",
  "BED_AND_BREAKFAST",
  "HALF_BOARD",
  "FULL_BOARD",
] as const;

// A stay anchors EITHER to absolute dates (dated trip) or 1-based day indices
// (date-less template). All four anchor fields are optional at the field level;
// the superRefine enforces that exactly one complete, well-ordered pair is set.
export const staySchema = z
  .object({
    locationId: z.string().min(1, "Pick a lodging location."),
    label: z.string().trim().optional(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    checkInDayIndex: optionalDayIndex,
    checkOutDayIndex: optionalDayIndex,
    arrivalTime: optionalTime,
    departureTime: optionalTime,
    board: z.enum(BOARD_TYPES).default("NONE"),
    headcount: optionalInt,
    costPerPersonPerNight: optionalMoney,
    currency: z.string().trim().min(1).default("USD"),
    priority: optionalInt,
    notes: z.string().trim().optional(),
  })
  .superRefine((d, ctx) => {
    const hasDates = Boolean(d.checkIn) || Boolean(d.checkOut);
    const hasIndices = d.checkInDayIndex != null || d.checkOutDayIndex != null;

    if (hasDates && hasIndices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either calendar dates or day numbers, not both.",
        path: ["checkOut"],
      });
      return;
    }

    if (hasIndices) {
      // Day-relative (template) mode.
      if (d.checkInDayIndex == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-in day is required.", path: ["checkInDayIndex"] });
      if (d.checkOutDayIndex == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out day is required.", path: ["checkOutDayIndex"] });
      // [checkIn, checkOut) — the checkout morning is not a night, so they differ.
      if (
        d.checkInDayIndex != null &&
        d.checkOutDayIndex != null &&
        d.checkOutDayIndex <= d.checkInDayIndex
      )
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out day must be after check-in day.", path: ["checkOutDayIndex"] });
      return;
    }

    // Absolute-date (dated trip) mode — the default.
    if (!d.checkIn)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-in date is required.", path: ["checkIn"] });
    if (!d.checkOut)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out date is required.", path: ["checkOut"] });
    if (d.checkIn && d.checkOut && d.checkOut <= d.checkIn)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Check-out must be after check-in.", path: ["checkOut"] });
  });

export type StayInput = z.infer<typeof staySchema>;
