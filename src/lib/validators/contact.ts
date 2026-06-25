import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  organization: z.string().trim().optional(),
  role: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal("")),
  phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  siteIds: z.array(z.string()).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
