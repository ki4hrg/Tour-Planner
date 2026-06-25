import { z } from "zod";

export const daySchema = z.object({
  title: z.string().trim().optional(),
  logisticalNotes: z.string().trim().optional(),
});

export type DayInput = z.infer<typeof daySchema>;
