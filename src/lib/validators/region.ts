import { z } from "zod";

export const regionSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  parentId: z.string().trim().optional(),
  tripTypeIds: z.array(z.string()).optional(),
  // Phone country code, normalized to digits ("+44", "44 " → "44"); empty → unset.
  dialCode: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const digits = v.replace(/[^\d]/g, "");
      return digits || undefined;
    },
    z
      .string()
      .regex(/^\d{1,4}$/, "Dial code must be 1–4 digits.")
      .optional(),
  ),
});

export type RegionInput = z.infer<typeof regionSchema>;
