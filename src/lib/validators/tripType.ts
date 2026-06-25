import { z } from "zod";
import { CURRENCIES } from "../money";

export const tripTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z.string().trim().optional(),
  color: z.string().trim().optional(),
  defaultCurrency: z.enum(CURRENCIES),
});

export type TripTypeInput = z.infer<typeof tripTypeSchema>;
