import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .url("Enter a valid URL.")
  .optional()
  .or(z.literal(""));

// Empty string → undefined, then coerce to a non-negative int.
const optionalLeadDays = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce
    .number()
    .int("Must be a whole number.")
    .nonnegative("Cannot be negative.")
    .optional(),
);

export const siteSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  region: z.string().trim().optional(),
  address: z.string().trim().optional(),
  description: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  website: optionalUrl,
  mapUrl: optionalUrl,
  bookingOpensLeadDays: optionalLeadDays,
  bookingNotes: z.string().trim().optional(),
  scheduleLimitations: z.string().trim().optional(),
  tripTypeIds: z.array(z.string()).optional(),
});

export type SiteInput = z.infer<typeof siteSchema>;
