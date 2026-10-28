"use client";

import { Badge } from "@/components/ui/badge";
import { Fragment } from "react";
import Link from "next/link";
import {
  Bus,
  CarTaxiFront,
  Footprints,
  Lock,
  MapPin,
  Moon,
  MoveRight,
  Plane,
  Ship,
  TrainFront,
} from "lucide-react";
import type { TravelMethod } from "@prisma/client";
import { ContactChannels } from "@/components/contact-channels";
import { mapHref } from "@/lib/maps";
import {
  bookingStageText,
  bookingStatusVariant,
  effectivePresenters,
  groupItemsByVenue,
  scheduleItemPrimaryLabel,
  travelDetailLine,
  type DayLodgingSummary,
  type SerializedScheduleItem,
  type SerializedBooking,
  type VenueRun,
} from "@/lib/trips";
import {
  computeScheduleGaps,
  formatDuration,
  type ScheduleGap,
} from "@/lib/schedule-gaps";

// Read-only itinerary rendering shared by the overview panel and the itinerary
// page's viewer mode. Items are grouped into chronological venue runs so a
// location is shown once per run (as a subheader) instead of on every row.
export function TimelineGroups({
  items,
  showBookings = false,
  lodging,
  linkVenues = false,
  showVenueContacts = false,
  renderItemExtra,
  renderVenueExtra,
  itemLinkBase,
  showGaps = false,
}: {
  items: SerializedScheduleItem[];
  showBookings?: boolean;
  lodging?: OvernightLodging | null;
  // Link venue subheaders (and the overnight venue) to their location pages.
  // Only for authenticated app surfaces — the public share page and print view
  // keep plain text.
  linkVenues?: boolean;
  // Call/WhatsApp + map affordances on venue subheaders. Day-view only; the
  // data (primaryContact/mapUrl) is only loaded there anyway.
  showVenueContacts?: boolean;
  // Per-item slot rendered under the row content — the day view mounts its
  // inline quick-edit here. The timeline itself stays a read component.
  renderItemExtra?: (item: SerializedScheduleItem) => React.ReactNode;
  // Per-venue slot beside each venue subheader name — planner surfaces mount
  // the engagement's booking progress here.
  renderVenueExtra?: (locationId: string) => React.ReactNode;
  // Opt-in: link each item row to `${itemLinkBase}#item-{id}` (dashboard → the
  // trip's day view). A plain string so Server Components can pass it; share
  // and print views stay non-interactive by simply not passing it.
  itemLinkBase?: string;
  // Show muted interstitial lines for gaps (free time) between timed items.
  // Enabled for planner surfaces (trip overview, itinerary editor, day view);
  // disabled for public/print surfaces.
  showGaps?: boolean;
}) {
  const runs = groupItemsByVenue(items);
  // Each gap is anchored to the timed item it follows, so the "· X min free"
  // line renders in place right under that item's row (not clumped at the end).
  const gapsAfterItem = new Map<string, ScheduleGap[]>();
  if (showGaps) {
    for (const gap of computeScheduleGaps(items)) {
      const list = gapsAfterItem.get(gap.afterItemId) ?? [];
      list.push(gap);
      gapsAfterItem.set(gap.afterItemId, list);
    }
  }

  return (
    <div className="space-y-5">
      {runs.map((run, i) => (
        <div key={i} className="break-inside-avoid-page">
          <RunHeader
            run={run}
            linkVenues={linkVenues}
            showVenueContacts={showVenueContacts}
            canAddContacts={showBookings}
            renderVenueExtra={renderVenueExtra}
          />
          <ul className="space-y-1">
            {run.items.map((item) => (
              <Fragment key={item.id}>
                <TimelineRow
                  item={item}
                  showBookings={showBookings}
                  extra={renderItemExtra?.(item)}
                  href={itemLinkBase ? `${itemLinkBase}#item-${item.id}` : null}
                />
                {gapsAfterItem.get(item.id)?.map((gap, gi) => (
                  <GapLine key={`gap-${gi}`} gap={gap} />
                ))}
              </Fragment>
            ))}
          </ul>
        </div>
      ))}
      {lodging ? (
        <OvernightLine lodging={lodging} linkVenue={linkVenues} />
      ) : null}
    </div>
  );
}

// A venue's go-to person as the day view shows it. `email`/`role` ride along
// only where the page's query selected them (the staff day view); the base
// summary type carries name + phone.
type VenueContact = {
  name: string;
  phone: string | null;
  email?: string | null;
  role?: string | null;
};

// The lodging summary plus, where the caller resolved it, the venue's id so the
// overnight line can link through to the location page.
export type OvernightLodging = DayLodgingSummary & {
  locationId?: string | null;
};

// Browsers don't break lines after "/", so a compound like "House/Museum" is
// one unbreakable token that forces the whole thing onto the next line. Insert
// <wbr> after each slash to allow a break there.
function breakAfterSlashes(text: string): React.ReactNode {
  const parts = text.split("/");
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 ? (
        <>
          /<wbr />
        </>
      ) : null}
      {part}
    </Fragment>
  ));
}

// A muted gap line showing free time after the item row it follows. Rendered
// inside the run's <ul>, so it's a list item.
function GapLine({ gap }: { gap: { durationMinutes: number } }) {
  return (
    <li className="flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground">
      <span className="font-light">·</span>
      <span>{formatDuration(gap.durationMinutes)}</span>
    </li>
  );
}

// Where the group sleeps that night — surfaced inline in the itinerary so the
// overnight venue reads as part of the day, not just the Lodging panel (GH #15).
export function OvernightLine({
  lodging,
  linkVenue = false,
}: {
  lodging: OvernightLodging;
  // Link the venue name to its location page (needs `lodging.locationId`).
  linkVenue?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Moon className="size-3.5 shrink-0" />
      <span>
        Overnight ·{" "}
        {linkVenue && lodging.locationId ? (
          <Link
            href={`/locations/${lodging.locationId}`}
            className="font-medium text-foreground link-quiet"
          >
            {lodging.locationName}
          </Link>
        ) : (
          <span className="font-medium text-foreground">
            {lodging.locationName}
          </span>
        )}
      </span>
    </div>
  );
}

// The venue subheader for a run: simply the venue name(s). Location-less
// (leading / post-block) runs render no heading at all.
function RunHeader({
  run,
  linkVenues,
  showVenueContacts,
  canAddContacts,
  renderVenueExtra,
}: {
  run: VenueRun;
  linkVenues?: boolean;
  showVenueContacts?: boolean;
  // Offer "Add contact" for a venue with no primary contact — planner surfaces
  // only (the location page's contact form is PLANNER-gated).
  canAddContacts?: boolean;
  renderVenueExtra?: (locationId: string) => React.ReactNode;
}) {
  if (run.venues.length === 0) return null;
  return (
    <div className="mb-2 break-after-avoid-page">
      <h4 className="text-base font-semibold tracking-tight text-foreground">
        {run.venues.map((v, i) => {
          const maps = showVenueContacts ? mapHref(v) : null;
          return (
            <span key={v.id} className="[&:not(:first-child)]:ml-1.5">
              {i > 0 ? "· " : ""}
              {linkVenues ? (
                <Link
                  href={`/locations/${v.id}`}
                  className="link-quiet"
                >
                  {breakAfterSlashes(v.name)}
                </Link>
              ) : (
                breakAfterSlashes(v.name)
              )}
              {maps ? (
                <a
                  href={maps}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${v.name} in Maps`}
                  title={`Open ${v.name} in Maps`}
                  className="ml-1 inline-flex size-7 items-center justify-center rounded-full border align-middle text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <MapPin className="size-3.5" />
                </a>
              ) : null}
              {renderVenueExtra ? (
                <span className="ml-2 inline-flex align-middle font-sans text-xs font-normal tracking-normal">
                  {renderVenueExtra(v.id)}
                </span>
              ) : null}
            </span>
          );
        })}
      </h4>
      {showVenueContacts
        ? run.venues.map((v) => (
            <Fragment key={v.id}>
              <VenueContactLine
                venue={v}
                // A multi-venue run names which venue each person belongs to.
                showVenueName={run.venues.length > 1}
                canAdd={!!canAddContacts}
              />
              {v.scheduleLimitations ? (
                <p
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={v.scheduleLimitations}
                >
                  {run.venues.length > 1 ? `${v.name} · ` : ""}
                  {v.scheduleLimitations}
                </p>
              ) : null}
            </Fragment>
          ))
        : null}
    </div>
  );
}

// Who to ring at the venue: "Name · Role" plus one-tap call / text / email,
// or (for planners) a link to add one. The channels are the point of this
// line on the coach, so the name is never shown without them.
function VenueContactLine({
  venue,
  showVenueName,
  canAdd,
}: {
  venue: { id: string; name: string; primaryContact?: VenueContact | null };
  showVenueName: boolean;
  canAdd: boolean;
}) {
  const c = venue.primaryContact;
  if (!c) {
    if (!canAdd) return null;
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        {showVenueName ? `${venue.name} · ` : ""}
        {/* Negative margins pad the tap target to 40px without adding space. */}
        <Link
          href={`/locations/${venue.id}#contacts`}
          className="-my-3 inline-block py-3 link-quiet"
        >
          Add contact
        </Link>
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        {showVenueName ? `${venue.name} · ` : ""}
        {c.name}
        {c.role ? ` · ${c.role}` : ""}
      </span>
      <ContactChannels phone={c.phone} email={c.email} />
    </p>
  );
}

const TRAVEL_METHOD_ICONS: Record<
  TravelMethod,
  React.ComponentType<{ className?: string }>
> = {
  COACH: Bus,
  TRAIN: TrainFront,
  FERRY: Ship,
  FLIGHT: Plane,
  WALK: Footprints,
  TAXI: CarTaxiFront,
  OTHER: MoveRight,
};

// The travel icon shared by the grouped timeline and the editor's flat rows.
export function TravelMethodIcon({
  method,
  className,
}: {
  method: TravelMethod;
  className?: string;
}) {
  const Icon = TRAVEL_METHOD_ICONS[method];
  return <Icon className={className} />;
}

// One item row: a fixed time / chip / content grid so every title shares a left
// edge regardless of chip width. The category chip is dropped when the label IS
// the category name (the label is tinted in the category colour instead).
function TimelineRow({
  item,
  showBookings,
  extra,
  href,
}: {
  item: SerializedScheduleItem;
  showBookings: boolean;
  extra?: React.ReactNode;
  href?: string | null;
}) {
  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  // Fixed-time marker — a staff planning cue, so only where bookings show.
  const fixed =
    showBookings && item.fixedTime && item.startTime ? (
      <Lock
        className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground"
        aria-label="Fixed time"
      />
    ) : null;
  const speakers = effectivePresenters(item);
  const { primary, presentationIsPrimary, labelFromCategory } =
    scheduleItemPrimaryLabel(item);

  // A travel span renders as the seam between venue runs: method icon in the
  // chip column, "Coach to Bristol" heading, route + stops underneath.
  if (item.travel) {
    const detail = travelDetailLine(item.travel);
    return (
      <li
        id={`item-${item.id}`}
        className="grid scroll-mt-20 grid-cols-[3.5rem_1fr] items-baseline gap-x-2 break-inside-avoid-page sm:grid-cols-[5.25rem_7rem_1fr]"
      >
        <time className="font-mono text-xs leading-tight tabular-nums text-muted-foreground [overflow-wrap:anywhere]">
          {time}
        </time>
        <span className="hidden text-muted-foreground sm:block">
          <TravelMethodIcon method={item.travel.method} className="size-4" />
        </span>
        <div className="min-w-0">
          {fixed}
          <span className="mr-1.5 inline-block align-middle text-muted-foreground sm:hidden">
            <TravelMethodIcon method={item.travel.method} className="size-3.5" />
          </span>
          {href ? (
            <Link
              href={href}
              className="font-medium italic text-muted-foreground link-quiet"
            >
              {breakAfterSlashes(primary)}
            </Link>
          ) : (
            <span className="font-medium italic text-muted-foreground">
              {breakAfterSlashes(primary)}
            </span>
          )}
          {detail || item.notes ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {detail ? <span>{detail}</span> : null}
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
          {extra}
        </div>
      </li>
    );
  }

  const showChip = !!item.category && !labelFromCategory;
  const showPresentation = item.presentation && !presentationIsPrimary;
  const hasSecondary =
    showPresentation || speakers.length > 0 || Boolean(item.notes);

  return (
    // <sm: a narrow two-column grid (the time range wraps onto two lines); the
    // chip column collapses and the chip renders inline before the title instead.
    <li
      id={`item-${item.id}`}
      className="grid scroll-mt-20 grid-cols-[3.5rem_1fr] items-baseline gap-x-2 sm:grid-cols-[5.25rem_7rem_1fr]"
    >
      <time className="font-mono text-xs leading-tight tabular-nums text-muted-foreground [overflow-wrap:anywhere]">
        {time}
      </time>
      <span className="hidden sm:block">
        {showChip ? <CategoryChip category={item.category!} /> : null}
      </span>
      <div className="min-w-0">
          {fixed}
        {showChip ? (
          <span className="mr-1.5 align-middle sm:hidden">
            <CategoryChip category={item.category!} />
          </span>
        ) : null}
        {href ? (
          <Link
            href={href}
            className="font-medium link-quiet"
            style={
              labelFromCategory && item.category?.color
                ? { color: item.category.color }
                : undefined
            }
          >
            {breakAfterSlashes(primary)}
          </Link>
        ) : (
          <span
            className="font-medium"
            style={
              labelFromCategory && item.category?.color
                ? { color: item.category.color }
                : undefined
            }
          >
            {breakAfterSlashes(primary)}
          </span>
        )}
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
        {extra}
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
    <Badge
      variant="muted"
      className="uppercase tracking-wide"
      style={{
        color: category.color ?? "var(--muted-foreground)",
        backgroundColor: category.color
          ? `color-mix(in oklab, ${category.color} 14%, transparent)`
          : "var(--muted)",
      }}
    >
      {category.name}
    </Badge>
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
      <Badge variant={bookingStatusVariant(booking.status)}>
        {bookingStageText(booking)}
      </Badge>
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
