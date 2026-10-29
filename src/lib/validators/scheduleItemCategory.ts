import { z } from "zod";

export const scheduleItemCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  color: z.string().trim().optional(),
  kind: z
    .enum(["VISIT", "MEAL", "PRESENTATION", "TRAVEL", "FREE", "OTHER"])
    .default("OTHER"),
  sortOrder: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int("Use a whole number.").optional(),
  ),
});

export type ScheduleItemCategoryInput = z.infer<
  typeof scheduleItemCategorySchema
>;
