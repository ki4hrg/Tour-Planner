import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, toDateInput, isOngoing, todayUtc } from "@/lib/dates";
import {
  TRIP_LIFECYCLE_LABELS,
  BOOKING_STATUS_LABELS,
  deriveTripLifecycle,
  serializeStay,
  serializeDay,
  serializeBooking,
  bookingsByLocation,
  summarizeDayLodging,
  TRAVEL_LEG_INCLUDE,
} from "@/lib/trips";
import { rollUpCosts } from "@/lib/costs";
import { rollUpStays } from "@/lib/stays";
import { formatMoney, isCostStale } from "@/lib/money";
import {
  resolveSchedule,
  scheduleAttention,
  serializeInstallment,
} from "@/lib/payment-schedule";
import { EditableSection } from "@/components/editable-section";
import { TripForm } from "../trip-form";
import { LodgingManager } from "../lodging-manager";
import { ItineraryOverview } from "../itinerary-overview";
import { ShareManager } from "../share-manager";
import { CalendarFeedManager } from "../../calendar-feeds/calendar-feed-manager";
import { TemplateChip } from "../template-chip";
import { TripTodoistPanel } from "../trip-todoist-panel";
import {
  updateTrip,
  deleteTrip,
  saveTripAsTemplate,
  archiveTrip,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function TripOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      tripType: { select: { name: true } },
      days: {
        orderBy: { dayIndex: "asc" },
        include: {
          scheduleItems: {
            orderBy: { order: "asc" },
            include: {
              category: { select: { id: true, name: true, color: true } },
              presentation: {
                select: {
                  id: true,
                  title: true,
                  defaultPresenters: { select: { id: true, name: true } },
                },
              },
              presenters: { select: { id: true, name: true } },
              travel: TRAVEL_LEG_INCLUDE,
              sites: {
                orderBy: { order: "asc" },
                include: {
                  location: { select: { id: true, name: true } },
                },
              },
              bookings: {
                orderBy: { createdAt: "asc" },
                include: { bookedContact: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!trip) notFound();

  // If the trip is happening now, find the day that falls on today so the
  // itinerary panel opens straight to it. Templates/off-dates → null (day 1).
  const todayMs = todayUtc().getTime();
  const currentDayId =
    !trip.isTemplate && isOngoing(trip.startDate, trip.endDate)
      ? (trip.days.find((d) => d.date?.getTime() === todayMs)?.id ?? null)
      : null;

  const allTripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, defaultCurrency: true },
  });

  // Cost estimate: roll up the reference costs of the distinct locations this
  // trip's itinerary visits (estimates only — plan decision 6).
  const referencedLocations = await prisma.scheduleItemSite.findMany({
    where: { scheduleItem: { day: { tripId: id } } },
    select: { locationId: true },
  });
  const locationIds = [
    ...new Set(referencedLocations.map((s) => s.locationId)),
  ];
  const costLocations = locationIds.length
    ? await prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, costs: true },
      })
    : [];
  const allCosts = costLocations.flatMap((s) => s.costs);
  // Scale per-person costs by the actual participant count, falling back to the
  // planned capacity when it's unset — so templates (which have no participants)
  // and not-yet-registered trips still estimate against capacity.
  const estimateHeadcount = trip.participantCount ?? trip.capacity;
  const rollups = rollUpCosts(
    allCosts.map((c) => ({
      amount: Number(c.amount),
      currency: c.currency,
      unit: c.unit,
    })),
    estimateHeadcount,
  );
  const hasStaleCost = allCosts.some((c) => isCostStale(c.confirmedAt));

  // Lodging (Stay) data — feeds the cost estimate and the Lodging section.
  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: {
      location: { select: { id: true, name: true } },
    },
  });

  // Venue-engagement bookings for this trip, indexed by location, so a stay can
  // reflect the single booking covering its lodging venue.
  const engagementBookings = await prisma.booking.findMany({
    where: { tripId: id },
    include: {
      bookedContact: { select: { id: true, name: true } },
      location: { select: { name: true } },
      payments: { select: { amount: true } },
      paymentSchedule: true,
    },
  });
  const bookingByLocation = bookingsByLocation(
    engagementBookings.map(serializeBooking),
  );
  const stayRollups = rollUpStays(
    stays.map((s) => ({
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      headcount: s.headcount,
      costPerPersonPerNight:
        s.costPerPersonPerNight == null
          ? null
          : Number(s.costPerPersonPerNight),
      currency: s.currency,
    })),
  );
  const lodgingByCurrency = new Map(stayRollups.map((r) => [r.currency, r.total]));
  // Unified per-currency estimate = visited-location costs + lodging.
  const estimate = [
    ...new Set([
      ...rollups.map((r) => r.currency),
      ...stayRollups.map((r) => r.currency),
    ]),
  ]
    .sort()
    .map((currency) => {
      const cost = rollups.find((r) => r.currency === currency) ?? null;
      const lodging = lodgingByCurrency.get(currency) ?? 0;
      return { currency, cost, lodging, total: (cost?.total ?? 0) + lodging };
    });

  // Money panel (GH #86): actual committed spend across this trip's venue
  // engagements — agreed / paid / outstanding per currency — plus the overdue
  // or next-due installment, so a payment problem is visible from the trip page
  // without opening the booking dashboard. Templates have no dates, so their
  // installments never resolve — the panel is dated-trip only.
  const moneyByCurrency = new Map<
    string,
    { agreed: number; paid: number; outstanding: number }
  >();
  const moneyAttention: {
    venue: string;
    currency: string;
    amount: number;
    dueDate: string;
    overdue: boolean;
  }[] = [];
  const moneyToday = todayUtc();
  for (const b of engagementBookings) {
    const agreed = b.agreedAmount == null ? null : Number(b.agreedAmount);
    const paid = b.payments.reduce((s, p) => s + Number(p.amount), 0);
    if (agreed != null || paid > 0) {
      const row = moneyByCurrency.get(b.agreedCurrency) ?? {
        agreed: 0,
        paid: 0,
        outstanding: 0,
      };
      row.agreed += agreed ?? 0;
      row.paid += paid;
      row.outstanding += agreed != null ? Math.max(0, agreed - paid) : 0;
      moneyByCurrency.set(b.agreedCurrency, row);
    }
    const resolved = resolveSchedule(
      b.paymentSchedule.map(serializeInstallment),
      {
        agreedAmount: agreed,
        paidTotal: paid,
        tripStartDate: trip.startDate,
        today: moneyToday,
      },
    );
    const venue = b.location?.name ?? b.label ?? "Booking";
    for (const inst of resolved) {
      if (inst.state === "overdue" && inst.outstanding && inst.dueDate) {
        moneyAttention.push({
          venue,
          currency: b.agreedCurrency,
          amount: inst.outstanding,
          dueDate: inst.dueDate,
          overdue: true,
        });
      }
    }
    const { nextDue } = scheduleAttention(resolved);
    if (nextDue?.dueDate && nextDue.outstanding) {
      moneyAttention.push({
        venue,
        currency: b.agreedCurrency,
        amount: nextDue.outstanding,
        dueDate: nextDue.dueDate,
        overdue: false,
      });
    }
  }
  const moneyRows = [...moneyByCurrency.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  // Overdue first, then soonest due.
  moneyAttention.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate),
  );
  const overdueCount = moneyAttention.filter((a) => a.overdue).length;
  const showMoney =
    !trip.isTemplate && (moneyRows.length > 0 || moneyAttention.length > 0);

  // For the Lodging manager (PLANNER edits inline). Only host sites flagged as
  // providing lodging can be picked for a stay.
  const lodgingLocations = await prisma.location.findMany({
    where: { archivedAt: null, hostSite: { providesLodging: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, region: { select: { name: true } } },
  });

  // Trip wrap-up: once the dates have passed but the trip hasn't been archived,
  // surface what's left to reconcile before closing it out.
  const lifecycle = deriveTripLifecycle(trip, todayUtc());
  const pastEnd =
    !trip.isTemplate &&
    trip.endDate != null &&
    trip.endDate.getTime() < todayMs &&
    trip.status === "ACTIVE";

  const engagedVenueIds = [
    ...new Set([
      ...locationIds,
      ...stays.map((s) => s.locationId),
      ...engagementBookings.flatMap((b) => (b.locationId ? [b.locationId] : [])),
    ]),
  ];
  const wrapUpFollowUps = pastEnd
    ? await prisma.note.findMany({
        where: {
          followUp: true,
          OR: [
            { tripId: id },
            { booking: { tripId: id } },
            { stay: { tripId: id } },
            ...(engagedVenueIds.length
              ? [{ locationId: { in: engagedVenueIds } }]
              : []),
          ],
        },
        orderBy: [{ dueDate: { sort: "asc" as const, nulls: "last" as const } }],
        take: 10,
        select: {
          id: true,
          body: true,
          location: { select: { name: true } },
          booking: { select: { location: { select: { name: true } }, label: true } },
          trip: { select: { name: true } },
          stay: { select: { location: { select: { name: true } } } },
        },
      })
    : [];
  const wrapUp = pastEnd
    ? {
        followUps: wrapUpFollowUps.map((n) => ({
          id: n.id,
          firstLine: n.body.split("\n")[0],
          where:
            n.location?.name ??
            n.booking?.location?.name ??
            n.booking?.label ??
            n.stay?.location.name ??
            n.trip?.name ??
            "Note",
        })),
        // Venue prices to re-confirm while the visit is fresh.
        staleCostLocations: costLocations
          .filter(
            (l) =>
              l.costs.length === 0 ||
              l.costs.some((c) => isCostStale(c.confirmedAt)),
          )
          .map((l) => ({ id: l.id, name: l.name })),
        // Engagements not yet financially/administratively closed.
        openEngagements: engagementBookings
          .map((b) => {
            const agreed =
              b.agreedAmount == null ? null : Number(b.agreedAmount);
            const paid = b.payments.reduce((s, p) => s + Number(p.amount), 0);
            const unpaid = agreed != null && paid < agreed ? agreed - paid : 0;
            const openStatus =
              b.status !== "FINALIZED" && b.status !== "NOT_NEEDED";
            if (!unpaid && !openStatus) return null;
            return {
              id: b.id,
              name: b.location?.name ?? b.label ?? "Booking",
              status: b.status,
              unpaid,
              currency: b.agreedCurrency,
            };
          })
          .filter((e) => e != null),
      }
    : null;

  // Todoist routing row — only for planners with a connection, on real trips.
  const todoistConnected =
    canEdit && !trip.isTemplate
      ? (await prisma.todoistConnection.count({ where: { userId: user.id } })) > 0
      : false;
  const tripTodoistLink = todoistConnected
    ? await prisma.tripTodoistLink.findUnique({
        where: { userId_tripId: { userId: user.id, tripId: id } },
        select: { todoistProjectId: true, todoistProjectName: true },
      })
    : null;

  // Share links (PLANNER-managed) + the host sites a HOST_SITE link can target.
  const shareLinks = canEdit
    ? await prisma.shareLink.findMany({
        where: { tripId: id },
        orderBy: { createdAt: "desc" },
        include: { location: { select: { name: true } } },
      })
    : [];
  const hostSites = canEdit
    ? await prisma.location.findMany({
        where: { archivedAt: null, hostSite: { isNot: null } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  // Subscribable calendar feeds for this trip (dated trips only — templates have
  // no calendar to anchor to).
  const calendarFeeds =
    canEdit && !trip.isTemplate
      ? await prisma.calendarFeed.findMany({
          where: { scope: "TRIP", tripId: id },
          orderBy: { createdAt: "desc" },
          select: { id: true, token: true, label: true, enabled: true },
        })
      : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {trip.name}
          {trip.isTemplate ? (
            <TemplateChip />
          ) : (
            <Badge variant="secondary">{TRIP_LIFECYCLE_LABELS[lifecycle]}</Badge>
          )}
        </h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {!trip.isTemplate ? (
            <Link
              href={`/trips/compare?type=${trip.tripTypeId}`}
              className="hover:underline"
            >
              Compare years
            </Link>
          ) : null}
          <Link href="/trips" className="hover:underline">
            ← All trips
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Itinerary — right 2/3 on desktop, below the details on mobile. */}
        <div className="order-2 min-w-0 lg:col-span-2">
          <ItineraryOverview
            tripId={trip.id}
            canEdit={canEdit}
            days={trip.days.map(serializeDay)}
            lodgingByDay={summarizeDayLodging(trip.days, stays)}
            currentDayId={currentDayId}
          />
        </div>

        {/* Trip meta — leads on mobile, left 1/3 on desktop. */}
        <div className="order-1 min-w-0 space-y-6 lg:col-span-1">
          {wrapUp ? (
            <Card className="border-amber-300 dark:border-amber-800">
              <CardHeader>
                <CardTitle className="text-base">Wrap up this trip</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  The trip ended {formatDate(trip.endDate)} but hasn&apos;t been
                  archived yet. Loose ends:
                </p>

                {wrapUp.followUps.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Open follow-ups
                    </p>
                    <ul className="space-y-0.5">
                      {wrapUp.followUps.map((f) => (
                        <li key={f.id} className="truncate">
                          <span className="font-medium">{f.where}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            — {f.firstLine}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {wrapUp.openEngagements.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Bookings to close out
                    </p>
                    <ul className="space-y-0.5">
                      {wrapUp.openEngagements.map((e) => (
                        <li key={e.id}>
                          <Link
                            href={`/trips/${trip.id}/booking`}
                            className="font-medium hover:underline"
                          >
                            {e.name}
                          </Link>
                          <span className="text-muted-foreground">
                            {" "}
                            — {BOOKING_STATUS_LABELS[e.status]}
                            {e.unpaid > 0
                              ? ` · ${formatMoney(e.unpaid, e.currency)} unpaid`
                              : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {wrapUp.staleCostLocations.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Prices to re-confirm while it&apos;s fresh
                    </p>
                    <ul className="space-y-0.5">
                      {wrapUp.staleCostLocations.map((l) => (
                        <li key={l.id}>
                          <Link
                            href={`/locations/${l.id}`}
                            className="hover:underline"
                          >
                            {l.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {wrapUp.followUps.length === 0 &&
                wrapUp.openEngagements.length === 0 &&
                wrapUp.staleCostLocations.length === 0 ? (
                  <p className="text-muted-foreground">
                    Nothing outstanding — ready to close.
                  </p>
                ) : null}

                {canEdit ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <form action={archiveTrip}>
                      <input type="hidden" name="id" value={trip.id} />
                      <Button type="submit" size="sm">
                        Archive trip
                      </Button>
                    </form>
                    <form action={saveTripAsTemplate}>
                      <input type="hidden" name="id" value={trip.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Save as template
                      </Button>
                    </form>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Details</CardTitle>
              {canEdit && !trip.isTemplate ? (
                <form action={saveTripAsTemplate}>
                  <input type="hidden" name="id" value={trip.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Save as template
                  </Button>
                </form>
              ) : null}
            </CardHeader>
            <CardContent>
              <EditableSection
                canEdit={canEdit}
                view={
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <dt className="text-muted-foreground">Trip type</dt>
                    <dd className="col-span-2">{trip.tripType.name}</dd>
                    {!trip.isTemplate ? (
                      <>
                        <dt className="text-muted-foreground">Status</dt>
                        <dd className="col-span-2">
                          {TRIP_LIFECYCLE_LABELS[lifecycle]}
                        </dd>
                        <dt className="text-muted-foreground">Dates</dt>
                        <dd className="col-span-2">
                          {trip.startDate
                            ? `${formatDate(trip.startDate)}${
                                trip.endDate
                                  ? ` → ${formatDate(trip.endDate)}`
                                  : ""
                              }`
                            : "—"}
                        </dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">Capacity</dt>
                    <dd className="col-span-2">{trip.capacity ?? "—"}</dd>
                    <dt className="text-muted-foreground">Currencies</dt>
                    <dd className="col-span-2">
                      {trip.currencies.length ? trip.currencies.join(", ") : "—"}
                    </dd>
                    {!trip.isTemplate ? (
                      <>
                        <dt className="text-muted-foreground">Participants</dt>
                        <dd className="col-span-2">
                          {trip.participantCount ?? "—"}
                        </dd>
                      </>
                    ) : null}
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="col-span-2 whitespace-pre-wrap">
                      {trip.notes ?? "—"}
                    </dd>
                  </dl>
                }
              >
                <TripForm
                  action={updateTrip}
                  submitLabel="Save changes"
                  tripTypes={allTripTypes}
                  initial={{
                    id: trip.id,
                    name: trip.name,
                    tripTypeId: trip.tripTypeId,
                    startDate: trip.startDate
                      ? trip.startDate.toISOString().slice(0, 10)
                      : null,
                    endDate: trip.endDate
                      ? trip.endDate.toISOString().slice(0, 10)
                      : null,
                    capacity: trip.capacity,
                    participantCount: trip.participantCount,
                    status: trip.status,
                    currencies: trip.currencies,
                    notes: trip.notes,
                    isTemplate: trip.isTemplate,
                  }}
                />
              </EditableSection>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost estimate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {estimate.length === 0 ? (
                <p className="text-muted-foreground">
                  No costs to estimate — add costs to the locations this trip
                  visits, or lodging below.
                </p>
              ) : (
                <>
                  {estimateHeadcount == null ? (
                    <p className="text-muted-foreground">
                      Set a {trip.isTemplate ? "capacity" : "participant count or capacity"} to include
                      per-person costs. Showing per-group costs only.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Estimated for {estimateHeadcount}{" "}
                      {trip.participantCount != null ? "participant" : "capacity place"}
                      {estimateHeadcount === 1 ? "" : "s"}
                      {trip.participantCount == null ? " (capacity)" : ""} across{" "}
                      {locationIds.length} location
                      {locationIds.length === 1 ? "" : "s"}.
                    </p>
                  )}
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                    {estimate.map((e) => (
                      <div key={e.currency} className="contents">
                        <dt className="font-medium">{e.currency}</dt>
                        <dd className="text-muted-foreground">
                          {e.cost
                            ? `${formatMoney(e.cost.perPersonPerHead, e.currency)}/person × ${e.cost.participantCount}${
                                e.cost.perGroup > 0
                                  ? ` + ${formatMoney(e.cost.perGroup, e.currency)} group`
                                  : ""
                              }`
                            : "—"}
                          {e.lodging > 0
                            ? ` + ${formatMoney(e.lodging, e.currency)} lodging`
                            : ""}
                        </dd>
                        <dd className="text-right font-medium">
                          {formatMoney(e.total, e.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {hasStaleCost ? (
                    <p className="text-xs text-muted-foreground">
                      ⚠ Some prices are unconfirmed or over a year old — verify
                      before relying on this estimate.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Estimate only. Counts each visited location once; lodging is
                    summed per stay.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {showMoney ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">Money</CardTitle>
                <Link
                  href={`/trips/${trip.id}/booking`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Booking dashboard →
                </Link>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {moneyRows.length > 0 ? (
                  <dl className="space-y-1">
                    {moneyRows.map((r) => (
                      <div
                        key={r.currency}
                        className="grid grid-cols-3 items-baseline gap-x-3"
                      >
                        <dt className="font-medium">{r.currency}</dt>
                        <dd className="text-muted-foreground">
                          {formatMoney(r.paid, r.currency)} paid of{" "}
                          {formatMoney(r.agreed, r.currency)}
                        </dd>
                        <dd className="text-right font-medium">
                          {r.outstanding > 0
                            ? `${formatMoney(r.outstanding, r.currency)} left`
                            : "settled"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">
                    No agreed prices logged yet.
                  </p>
                )}

                {moneyAttention.length > 0 ? (
                  <div className="border-t pt-2">
                    {overdueCount > 0 ? (
                      <p className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">
                        {overdueCount} payment{overdueCount === 1 ? "" : "s"} overdue
                      </p>
                    ) : (
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Next due
                      </p>
                    )}
                    <ul className="space-y-0.5">
                      {moneyAttention.slice(0, 3).map((a, i) => (
                        <li key={`${a.venue}-${a.dueDate}-${i}`} className="truncate">
                          <span
                            className={
                              a.overdue
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "font-medium text-amber-700 dark:text-amber-300"
                            }
                          >
                            {formatMoney(a.amount, a.currency)}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            — {a.venue} · {a.overdue ? "was due" : "due"}{" "}
                            {formatDate(a.dueDate)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lodging</CardTitle>
            </CardHeader>
            <CardContent>
              <LodgingManager
                tripId={trip.id}
                canEdit={canEdit}
                isTemplate={trip.isTemplate}
                dayCount={trip.days.length}
                currencies={trip.currencies}
                locations={lodgingLocations.map((l) => ({
                  id: l.id,
                  name: l.name,
                  region: l.region?.name ?? null,
                }))}
                stays={stays.map((s) =>
                  serializeStay(s, bookingByLocation.get(s.locationId) ?? null),
                )}
              />
            </CardContent>
          </Card>

          {todoistConnected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Todoist</CardTitle>
              </CardHeader>
              <CardContent>
                <TripTodoistPanel
                  tripId={trip.id}
                  linkedProjectId={tripTodoistLink?.todoistProjectId ?? null}
                  linkedProjectName={tripTodoistLink?.todoistProjectName ?? null}
                />
              </CardContent>
            </Card>
          ) : null}

          {canEdit && !trip.isTemplate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Share links</CardTitle>
              </CardHeader>
              <CardContent>
                <ShareManager
                  tripId={trip.id}
                  canEdit={canEdit}
                  hostSites={hostSites}
                  links={shareLinks.map((l) => ({
                    id: l.id,
                    token: l.token,
                    audience: l.audience,
                    label: l.label,
                    locationName: l.location?.name ?? null,
                    enabled: l.enabled,
                    expiresAt: l.expiresAt ? toDateInput(l.expiresAt) : null,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          {canEdit && !trip.isTemplate ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Calendar feed</CardTitle>
              </CardHeader>
              <CardContent>
                <CalendarFeedManager
                  scope="TRIP"
                  tripId={trip.id}
                  canEdit={canEdit}
                  feeds={calendarFeeds}
                />
              </CardContent>
            </Card>
          ) : null}

          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-destructive">
                  Danger zone
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={deleteTrip}>
                  <input type="hidden" name="id" value={trip.id} />
                  <Button type="submit" variant="destructive">
                    Delete trip
                  </Button>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Permanently deletes this trip and all of its days and items.
                  </p>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
