import { z } from "zod";
import { STEP_STATUSES } from "../booking-workflow";

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
      }),
    )
    .max(30),
});

export type BookingWorkflowInput = z.infer<typeof bookingWorkflowSchema>;
