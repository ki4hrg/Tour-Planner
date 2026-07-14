import { z } from "zod";

// "HH:MM" 24-hour time, or empty → undefined.
const optionalTime = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).")
    .optional(),
);

const optionalId = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().optional(),
);

// An en-route stop on a travel leg: a catalogued location and/or free text.
const travelStopSchema = z
  .object({
    locationId: optionalId,
    label: z.string().trim().optional(),
    dwellMinutes: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z.number().int().nonnegative().optional(),
    ),
  })
  .refine((s) => s.locationId || s.label, {
    message: "Each stop needs a location or a label.",
  });

// The travel-span extension (GH #80): method + endpoints (location or free
// text, all optional) + ordered stops. Attached to an item via `travel`.
export const travelLegSchema = z.object({
  method: z.enum([
    "COACH",
    "TRAIN",
    "FERRY",
    "FLIGHT",
    "WALK",
    "TAXI",
    "OTHER",
  ]),
  fromLocationId: optionalId,
  fromLabel: z.string().trim().optional(),
  toLocationId: optionalId,
  toLabel: z.string().trim().optional(),
  stops: z.array(travelStopSchema).max(20).default([]),
});

export type TravelLegInput = z.infer<typeof travelLegSchema>;

export const scheduleItemSchema = z
  .object({
    categoryId: optionalId,
    title: z.string().trim().optional(),
    startTime: optionalTime,
    endTime: optionalTime,
    notes: z.string().trim().optional(),
    isBlock: z.boolean().optional(),
    // The catalogued talk this item delivers (optional).
    presentationId: optionalId,
    // Per-occurrence speaker override; empty ⇒ use the talk's default presenters.
    presenterIds: z.array(z.string().min(1)).default([]),
    // The locations this item visits (0 = informational line, 1 = stop, many = block).
    locationIds: z.array(z.string().min(1)).default([]),
    // Present ⇒ the item is a travel span; null on update ⇒ remove the leg;
    // undefined ⇒ leave whatever leg exists untouched.
    travel: travelLegSchema.nullish(),
  })
  // The "needs a title or a location" rule is enforced in the server actions,
  // which can see whether the chosen category is a self-describing built-in
  // (Free time / Break) that legitimately needs neither.
  .refine((d) => !d.startTime || !d.endTime || d.endTime >= d.startTime, {
    message: "End time cannot be before start time.",
    path: ["endTime"],
  });

export type ScheduleItemInput = z.infer<typeof scheduleItemSchema>;
