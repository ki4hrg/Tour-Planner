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
import { formatDate, toDateInput } from "@/lib/dates";
import {
  TRIP_STATUS_LABELS,
  serializeStay,
  serializeDay,
  summarizeDayLodging,
} from "@/lib/trips";
import { rollUpCosts } from "@/lib/costs";
import { rollUpStays } from "@/lib/stays";
import { formatMoney, isCostStale } from "@/lib/money";
import { EditableSection } from "@/components/editable-section";
import { TripForm } from "../trip-form";
import { LodgingManager } from "../lodging-manager";
import { ItineraryOverview } from "../itinerary-overview";
import { ShareManager } from "../share-manager";
import { updateTrip, deleteTrip, saveTripAsTemplate } from "../actions";

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

  const allTripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
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
        select: { costs: true },
      })
    : [];
  const allCosts = costLocations.flatMap((s) => s.costs);
  const rollups = rollUpCosts(
    allCosts.map((c) => ({
      amount: Number(c.amount),
      currency: c.currency,
      unit: c.unit,
    })),
    trip.participantCount,
  );
  const hasStaleCost = allCosts.some((c) => isCostStale(c.confirmedAt));

  // Lodging (Stay) data — feeds the cost estimate and the Lodging section.
  const stays = await prisma.stay.findMany({
    where: { tripId: id },
    orderBy: [{ priority: "desc" }, { checkIn: "asc" }],
    include: {
      location: { select: { id: true, name: true } },
      booking: {
        include: { bookedContact: { select: { id: true, name: true } } },
      },
    },
  });
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

  // For the Lodging manager (PLANNER edits inline). Only host sites flagged as
  // providing lodging can be picked for a stay.
  const lodgingLocations = await prisma.location.findMany({
    where: { archivedAt: null, hostSite: { providesLodging: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, region: { select: { name: true } } },
  });
  const lodgingContacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

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

  return (
    // This is the most information-dense screen, so let it grow past the shared
    // max-w-5xl into the surrounding whitespace once there's room (xl/2xl).
    <div className="space-y-6 xl:-mx-16 2xl:-mx-32">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {trip.name}
          <Badge variant="secondary">{TRIP_STATUS_LABELS[trip.status]}</Badge>
          {trip.isTemplate ? <Badge variant="outline">template</Badge> : null}
        </h1>
        <Link
          href="/trips"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All trips
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Itinerary — right 2/3 on desktop, below the details on mobile. */}
        <div className="order-2 lg:col-span-2">
          <ItineraryOverview
            tripId={trip.id}
            canEdit={canEdit}
            days={trip.days.map(serializeDay)}
            lodgingByDay={summarizeDayLodging(trip.days, stays)}
          />
        </div>

        {/* Trip meta — leads on mobile, left 1/3 on desktop. */}
        <div className="order-1 space-y-6 lg:col-span-1">
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
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="col-span-2">
                      {TRIP_STATUS_LABELS[trip.status]}
                    </dd>
                    <dt className="text-muted-foreground">Dates</dt>
                    <dd className="col-span-2">
                      {trip.startDate
                        ? `${formatDate(trip.startDate)}${
                            trip.endDate ? ` → ${formatDate(trip.endDate)}` : ""
                          }`
                        : "—"}
                    </dd>
                    <dt className="text-muted-foreground">Capacity</dt>
                    <dd className="col-span-2">{trip.capacity ?? "—"}</dd>
                    <dt className="text-muted-foreground">Participants</dt>
                    <dd className="col-span-2">
                      {trip.participantCount ?? "—"}
                    </dd>
                    {trip.isTemplate ? (
                      <>
                        <dt className="text-muted-foreground">Template</dt>
                        <dd className="col-span-2">Yes</dd>
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
                  {trip.participantCount == null ? (
                    <p className="text-muted-foreground">
                      Set a participant count to include per-person costs.
                      Showing per-group costs only.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      Estimated for {trip.participantCount} participant
                      {trip.participantCount === 1 ? "" : "s"} across{" "}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lodging</CardTitle>
            </CardHeader>
            <CardContent>
              <LodgingManager
                tripId={trip.id}
                canEdit={canEdit}
                locations={lodgingLocations.map((l) => ({
                  id: l.id,
                  name: l.name,
                  region: l.region?.name ?? null,
                }))}
                contacts={lodgingContacts}
                stays={stays.map(serializeStay)}
              />
            </CardContent>
          </Card>

          {canEdit ? (
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
