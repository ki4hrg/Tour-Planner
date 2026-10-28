import type { BookingStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { FilterChip, FilterChipButton } from "@/components/filter-chip";
import { cn } from "@/lib/utils";
import {
  BOOKING_STATUS_FLOW,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUSES,
  bookingStatusVariant,
} from "@/lib/trips";

// The master-status filter: one chip per status with its count, so "every
// visit in progress, whatever its workflow stage" is one click. The ladder's
// four statuses always show (a zero is information); Cancelled / Not needed
// only when something is in them. Chips toggle (several statuses can be on);
// "All" clears. Two ways to apply a pick: `hrefFor` (a server page — the
// chips are links) or `onChange` (a client view keeping it in the URL).

type Props = {
  counts: Record<BookingStatus, number>;
  selected: BookingStatus[];
  // Omit "All" where the chips only navigate (the overview summary).
  showAll?: boolean;
  // false: a click picks only that status (the overview summary's links).
  multi?: boolean;
  className?: string;
} & (
  | { hrefFor: (next: BookingStatus[]) => string; onChange?: never }
  | { onChange: (next: BookingStatus[]) => void; hrefFor?: never }
);

export function BookingStatusChips(props: Props) {
  const { counts, selected, showAll = true, multi = true, className } = props;
  const total = BOOKING_STATUSES.reduce((n, s) => n + counts[s], 0);
  const shown = BOOKING_STATUSES.filter(
    (s) => BOOKING_STATUS_FLOW.includes(s) || counts[s] > 0 || selected.includes(s),
  );
  const toggled = (s: BookingStatus): BookingStatus[] => {
    if (!multi) return [s];
    const next = selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s];
    return BOOKING_STATUSES.filter((x) => next.includes(x));
  };

  const chip = (key: string, active: boolean, next: BookingStatus[], body: React.ReactNode) =>
    props.hrefFor ? (
      <FilterChip key={key} href={props.hrefFor(next)} active={active} scroll={false}>
        {body}
      </FilterChip>
    ) : (
      <FilterChipButton key={key} active={active} onClick={() => props.onChange(next)}>
        {body}
      </FilterChipButton>
    );

  return (
    <div
      role="group"
      aria-label="Booking status"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {showAll
        ? chip(
            "all",
            selected.length === 0,
            [],
            <>
              All
              <span className="text-xs tabular-nums text-muted-foreground">{total}</span>
            </>,
          )
        : null}
      {shown.map((s) =>
        chip(
          s,
          selected.includes(s),
          toggled(s),
          <>
            {BOOKING_STATUS_LABELS[s]}
            <Badge
              variant={counts[s] > 0 ? bookingStatusVariant(s) : "muted"}
              className="tabular-nums"
            >
              {counts[s]}
            </Badge>
          </>,
        ),
      )}
    </div>
  );
}
