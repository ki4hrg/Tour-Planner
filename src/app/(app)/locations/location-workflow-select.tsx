"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookingWorkflows } from "@/components/booking-workflows";
import { setLocationDefaultWorkflow } from "./actions";

const INHERIT = "__default__";

// The workflow new engagements at this venue start on,
// like its standing payment terms. Unset = the global default workflow.
// Changing it never touches existing bookings.
export function LocationWorkflowSelect({
  locationId,
  workflowId,
  canEdit,
}: {
  locationId: string;
  workflowId: string | null;
  canEdit: boolean;
}) {
  const workflows = useBookingWorkflows();
  const [pending, start] = useTransition();
  const globalDefault = workflows.find((w) => w.isDefault);
  const inheritLabel = globalDefault ? `Default (${globalDefault.name})` : "None";

  if (!canEdit) {
    const own = workflows.find((w) => w.id === workflowId);
    return <p className="text-sm">{own?.name ?? inheritLabel}</p>;
  }

  return (
    <Select
      value={workflowId ?? INHERIT}
      disabled={pending}
      onValueChange={(v) =>
        start(async () => {
          const res = await setLocationDefaultWorkflow(
            locationId,
            v === INHERIT ? null : v,
          );
          if (res.error) toast.error(res.error);
          else if (res.message) toast.success(res.message);
        })
      }
    >
      <SelectTrigger className="w-full sm:w-72" aria-label="Booking workflow">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {workflows.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
