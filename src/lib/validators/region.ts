import { z } from "zod";

export const regionSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  parentId: z.string().trim().optional(),
  tripTypeIds: z.array(z.string()).optional(),
});

export type RegionInput = z.infer<typeof regionSchema>;
