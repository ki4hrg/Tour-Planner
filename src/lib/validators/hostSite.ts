import { z } from "zod";

// A location becomes a host site when this row exists; the form edits its
// capability flags + staff/logistics free-text.
export const hostSiteSchema = z.object({
  providesLodging: z.boolean().optional(),
  providesMeals: z.boolean().optional(),
  providesMeetingSpace: z.boolean().optional(),
  staffNotes: z.string().trim().optional(),
  logisticsNotes: z.string().trim().optional(),
});

export type HostSiteInput = z.infer<typeof hostSiteSchema>;
