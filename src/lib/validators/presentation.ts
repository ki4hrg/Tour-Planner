import { z } from "zod";

// Empty string → undefined, then coerce to a positive int (minutes).
const optionalDuration = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce
    .number()
    .int("Must be a whole number.")
    .positive("Must be greater than zero.")
    .optional(),
);

export const presentationSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  durationMinutes: optionalDuration,
  defaultPresenterIds: z.array(z.string()).optional(),
});

export type PresentationInput = z.infer<typeof presentationSchema>;
