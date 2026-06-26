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

export const BOARD_TYPES = [
  "NONE",
  "BED_AND_BREAKFAST",
  "HALF_BOARD",
  "FULL_BOARD",
] as const;

export const staySchema = z
  .object({
    locationId: z.string().min(1, "Pick a lodging location."),
    label: z.string().trim().optional(),
    checkIn: z.string().min(1, "Check-in date is required."),
    checkOut: z.string().min(1, "Check-out date is required."),
    arrivalTime: optionalTime,
    departureTime: optionalTime,
    board: z.enum(BOARD_TYPES).default("NONE"),
    headcount: optionalInt,
    costPerPersonPerNight: optionalMoney,
    currency: z.string().trim().min(1).default("USD"),
    priority: optionalInt,
    notes: z.string().trim().optional(),
  })
  // [checkIn, checkOut) — the checkout morning is not a night, so they must differ.
  .refine((d) => d.checkOut > d.checkIn, {
    message: "Check-out must be after check-in.",
    path: ["checkOut"],
  });

export type StayInput = z.infer<typeof staySchema>;
