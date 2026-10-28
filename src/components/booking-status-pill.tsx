import type { BookingStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  BOOKING_STATUS_LABELS,
  bookingStatusVariant,
  bookingSubstatus,
} from "@/lib/trips";

/**
 * A booking's status as every surface shows it: the master status pill
 * ("In progress"), then the workflow stage it has reached as plain text
 * ("Availability confirmed"). The master status always leads, so the same
 * state reads the same whichever workflow a booking follows.
 */
export function BookingStatusPill({
  status,
  stageLabel,
  stageOn,
  showStage = true,
  className,
}: {
  status: BookingStatus;
  stageLabel?: string | null;
  stageOn?: string | null;
  showStage?: boolean;
  className?: string;
}) {
  const sub = showStage ? bookingSubstatus({ status, stageLabel }) : null;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      title={stageOn ? `Since ${formatDate(stageOn)}` : undefined}
    >
      <Badge variant={bookingStatusVariant(status)}>{BOOKING_STATUS_LABELS[status]}</Badge>
      {sub ? (
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      ) : null}
    </span>
  );
}
