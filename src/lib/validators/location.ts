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

// Empty string → undefined, then coerce to a number within ±limit.
const optionalCoord = (limit: number, label: string) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce
      .number()
      .min(-limit, `${label} must be between -${limit} and ${limit}.`)
      .max(limit, `${label} must be between -${limit} and ${limit}.`)
      .optional(),
  );

export const locationSchema = z
  .object({
  name: z.string().trim().min(1, "Name is required."),
  regionId: z.string().trim().optional(),
  address: z.string().trim().optional(),
  description: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  website: optionalUrl,
  mapUrl: optionalUrl,
  googlePlaceId: z.string().trim().optional(),
  lat: optionalCoord(90, "Latitude"),
  lng: optionalCoord(180, "Longitude"),
  bookable: z.boolean().default(true),
  bookingOpensLeadDays: optionalLeadDays,
  bookingNotes: z.string().trim().optional(),
  scheduleLimitations: z.string().trim().optional(),
  tripTypeIds: z.array(z.string()).optional(),
  })
  // Mirrors the DB CHECK location_coordinates.
  .refine((d) => (d.lat == null) === (d.lng == null), {
    message: "Enter both latitude and longitude, or neither.",
    path: ["lng"],
  });

export type LocationInput = z.infer<typeof locationSchema>;
