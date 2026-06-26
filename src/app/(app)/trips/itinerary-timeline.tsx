"use client";

import { cn } from "@/lib/utils";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
  effectivePresenters,
  groupItemsByVenue,
  scheduleItemPrimaryLabel,
  type SerializedScheduleItem,
  type SerializedBooking,
  type VenueRun,
} from "@/lib/trips";

// Read-only itinerary rendering shared by the overview panel and the itinerary
// page's viewer mode. Items are grouped into chronological venue runs so a
// location is shown once per run (as a subheader) instead of on every row.
export function TimelineGroups({
  items,
  showBookings = false,
}: {
  items: SerializedScheduleItem[];
  showBookings?: boolean;
}) {
  const runs = groupItemsByVenue(items);
  return (
    <div className="space-y-5">
      {runs.map((run, i) => (
        <div key={i}>
          <RunHeader run={run} />
          <ul className="space-y-1">
            {run.items.map((item) => (
              <TimelineRow
                key={item.id}
                item={item}
                showBookings={showBookings}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// The venue subheader for a run: simply the venue name(s). Location-less
// (leading / post-block) runs render no heading at all.
function RunHeader({ run }: { run: VenueRun }) {
  if (run.venues.length === 0) return null;
  return (
    <h4 className="mb-2 text-base font-semibold tracking-tight text-foreground">
      {run.venues.join(" · ")}
    </h4>
  );
}

// One item row: a fixed time / chip / content grid so every title shares a left
// edge regardless of chip width. The category chip is dropped when the label IS
// the category name (the label is tinted in the category colour instead).
function TimelineRow({
  item,
  showBookings,
}: {
  item: SerializedScheduleItem;
  showBookings: boolean;
}) {
  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  const speakers = effectivePresenters(item);
  const { primary, presentationIsPrimary, labelFromCategory } =
    scheduleItemPrimaryLabel(item);
  const showChip = !!item.category && !labelFromCategory;
  const showPresentation = item.presentation && !presentationIsPrimary;
  const hasSecondary =
    showPresentation || speakers.length > 0 || Boolean(item.notes);

  return (
    <li className="grid grid-cols-[5.25rem_7rem_1fr] items-baseline gap-x-2">
      <time className="font-mono text-xs tabular-nums text-muted-foreground">
        {time}
      </time>
      <span>{showChip ? <CategoryChip category={item.category!} /> : null}</span>
      <div className="min-w-0">
        <span
          className="font-medium"
          style={
            labelFromCategory && item.category?.color
              ? { color: item.category.color }
              : undefined
          }
        >
          {primary}
        </span>
        {hasSecondary ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {showPresentation ? (
              <span className="italic">{item.presentation?.title}</span>
            ) : null}
            {speakers.length > 0 ? (
              <span>
                {showPresentation ? "· " : ""}
                {speakers.map((p) => p.name).join(", ")}
              </span>
            ) : null}
            {item.notes ? <span>· {item.notes}</span> : null}
          </div>
        ) : null}
        {showBookings && item.bookings.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {item.bookings.map((b) => (
              <BookingPill key={b.id} booking={b} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// The category chip — a colour-tinted pill. Shared so the editor's flat rows and
// the grouped read views render it identically.
export function CategoryChip({
  category,
}: {
  category: { name: string; color: string | null };
}) {
  return (
    <span
      className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        color: category.color ?? "var(--muted-foreground)",
        backgroundColor: category.color
          ? `color-mix(in oklab, ${category.color} 14%, transparent)`
          : "var(--muted)",
      }}
    >
      {category.name}
    </span>
  );
}

// A booking summary pill — status badge plus what/who/ref. Read-only.
export function BookingPill({
  booking,
  item,
}: {
  booking: SerializedBooking;
  item: SerializedScheduleItem;
}) {
  const forLocation =
    booking.locationId != null
      ? item.sites.find((s) => s.locationId === booking.locationId)?.location
          .name
      : null;
  const what = booking.label ?? forLocation ?? null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-medium",
          BOOKING_STATUS_CLASSES[booking.status],
        )}
      >
        {BOOKING_STATUS_LABELS[booking.status]}
      </span>
      {what ? <span className="text-muted-foreground">{what}</span> : null}
      {booking.bookedContact ? (
        <span className="text-muted-foreground">
          · {booking.bookedContact.name}
        </span>
      ) : null}
      {booking.confirmationRef ? (
        <span className="text-muted-foreground">
          · ref {booking.confirmationRef}
        </span>
      ) : null}
    </span>
  );
}
