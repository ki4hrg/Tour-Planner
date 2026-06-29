"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { BookingStatus } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
} from "@/lib/trips";
import type { FormState } from "@/lib/forms";

// One-click status control shared by the booking dashboard and the multi-year grid.
// `onSet` is wired by the row to the right action (venue upsert vs item update) so
// this stays layout- and target-agnostic.
export function StatusControl({
  status,
  canEdit,
  onSet,
}: {
  status: BookingStatus;
  canEdit: boolean;
  onSet: (status: BookingStatus) => Promise<FormState>;
}) {
  const [pending, start] = useTransition();

  if (!canEdit) {
    return (
      <span
        className={cn(
          "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
          BOOKING_STATUS_CLASSES[status],
        )}
      >
        {BOOKING_STATUS_LABELS[status]}
      </span>
    );
  }

  const change = (next: string) =>
    start(async () => {
      const res = await onSet(next as BookingStatus);
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });

  return (
    <Select value={status} onValueChange={change} disabled={pending}>
      <SelectTrigger
        size="sm"
        className={cn(
          "h-auto w-auto gap-1 rounded-full border-0 px-2 py-0.5 text-xs font-medium",
          BOOKING_STATUS_CLASSES[status],
          pending && "opacity-60",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BOOKING_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {BOOKING_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
