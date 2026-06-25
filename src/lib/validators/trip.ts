import { z } from "zod";
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
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
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
    notes: z.string().trim().optional(),
    isTemplate: z.coerce.boolean().optional(),
  })
  .refine(
    (d) => !d.startDate || !d.endDate || d.endDate >= d.startDate,
    { message: "End date cannot be before start date.", path: ["endDate"] },
  );

export type TripInput = z.infer<typeof tripSchema>;
