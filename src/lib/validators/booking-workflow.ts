import { z } from "zod";
import { STEP_ACTORS, STEP_DUE_UNITS, STEP_STATUSES } from "../booking-workflow";

// An admin's save of one workflow: its name, whether it is the global default,
// and the full ordered step list. Steps with an `id` are kept (their
// completions follow them through renames/re-ordering); omitted ids are
// deleted; steps without one are created.
export const bookingWorkflowSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  isDefault: z.boolean(),
  steps: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().trim().min(1, "Every step needs a label.").max(120),
        status: z.enum(STEP_STATUSES),
        actor: z.enum(STEP_ACTORS),
        // Due this many units before the trip's start — both or neither.
        dueOffsetValue: z.number().int().nullable().optional(),
        dueOffsetUnit: z.enum(STEP_DUE_UNITS).nullable().optional(),
      })
      .refine(
        (s) => (s.dueOffsetValue == null) === (s.dueOffsetUnit == null),
        { message: "A due offset needs both a number and a unit.", path: ["dueOffsetValue"] },
      ),
    )
    .max(30),
});

export type BookingWorkflowInput = z.infer<typeof bookingWorkflowSchema>;
