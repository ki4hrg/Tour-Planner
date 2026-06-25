import { z } from "zod";
import { CURRENCIES } from "../money";

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
  notes: z.string().trim().optional(),
});

export type CostInput = z.infer<typeof costSchema>;
