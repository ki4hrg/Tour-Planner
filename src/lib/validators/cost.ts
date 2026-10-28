import { z } from "zod";
import { CURRENCIES } from "../money";
import { isCalendarDate } from "./date";

// Empty string → undefined; otherwise a "yyyy-mm-dd" string.
const optionalDate = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().refine(isCalendarDate, "Enter a valid date.").optional(),
);

export const costSchema = z.object({
  label: z.string().trim().min(1, "Label is required."),
  amount: z.coerce
    .number({ message: "Enter a valid amount." })
    .nonnegative("Cannot be negative."),
  currency: z.enum(CURRENCIES),
  unit: z.enum(["PER_PERSON", "PER_GROUP"]),
  // Empty string → undefined; otherwise an ISO date (yyyy-mm-dd from the input).
  confirmedAt: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.string().optional(),
  ),
  // Active dates (yyyy-mm-dd): the line applies to trips starting inside
  // [validFrom, validTo]; either bound open; both blank = always.
  validFrom: optionalDate,
  validTo: optionalDate,
  notes: z.string().trim().optional(),
}).refine((d) => !d.validFrom || !d.validTo || d.validFrom <= d.validTo, {
  message: "Valid-to cannot be before valid-from.",
  path: ["validTo"],
});

export type CostInput = z.infer<typeof costSchema>;
