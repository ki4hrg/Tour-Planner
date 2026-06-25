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
import { formatDate } from "@/lib/dates";
import { TRIP_STATUS_LABELS } from "@/lib/trips";
import { rollUpCosts } from "@/lib/costs";
import { formatMoney, isCostStale } from "@/lib/money";
import { TripForm } from "../trip-form";
import { updateTrip, deleteTrip } from "../actions";

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
        select: {
          id: true,
          dayIndex: true,
          date: true,
          title: true,
          _count: { select: { scheduleItems: true } },
        },
      },
    },
  });
  if (!trip) notFound();

  const allTripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Cost estimate: roll up the reference costs of the distinct sites this trip's
  // itinerary visits (estimates only — plan decision 6).
  const referencedSites = await prisma.scheduleItemSite.findMany({
    where: { scheduleItem: { day: { tripId: id } } },
    select: { siteId: true },
  });
  const siteIds = [...new Set(referencedSites.map((s) => s.siteId))];
  const costSites = siteIds.length
    ? await prisma.site.findMany({
        where: { id: { in: siteIds } },
        select: { costs: true },
      })
    : [];
  const allCosts = costSites.flatMap((s) => s.costs);
  const rollups = rollUpCosts(
    allCosts.map((c) => ({
      amount: Number(c.amount),
      currency: c.currency,
      unit: c.unit,
    })),
    trip.participantCount,
  );
  const hasStaleCost = allCosts.some((c) => isCostStale(c.confirmedAt));

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Itinerary</CardTitle>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/trips/${trip.id}/booking`}>Booking</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/trips/${trip.id}/itinerary`}>
                {canEdit ? "Edit itinerary" : "View itinerary"}
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {trip.days.length === 0 ? (
            <p className="text-muted-foreground">
              No days yet.{" "}
              {canEdit ? "Open the itinerary editor to add days." : ""}
            </p>
          ) : (
            <ol className="divide-y">
              {trip.days.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span>
                    <span className="font-medium">Day {d.dayIndex}</span>
                    {d.title ? ` — ${d.title}` : ""}
                    {d.date ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatDate(d.date)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">
                    {d._count.scheduleItems} item
                    {d._count.scheduleItems === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
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
          ) : (
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-muted-foreground">Trip type</dt>
              <dd className="col-span-2">{trip.tripType.name}</dd>
              <dt className="text-muted-foreground">Dates</dt>
              <dd className="col-span-2">
                {trip.startDate
                  ? `${formatDate(trip.startDate)}${
                      trip.endDate ? ` → ${formatDate(trip.endDate)}` : ""
                    }`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Participants</dt>
              <dd className="col-span-2">{trip.participantCount ?? "—"}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="col-span-2">{trip.notes ?? "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost estimate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rollups.length === 0 ? (
            <p className="text-muted-foreground">
              No costs to estimate — add costs to the sites this trip visits.
            </p>
          ) : (
            <>
              {trip.participantCount == null ? (
                <p className="text-muted-foreground">
                  Set a participant count to include per-person costs. Showing
                  per-group costs only.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Estimated for {trip.participantCount} participant
                  {trip.participantCount === 1 ? "" : "s"} across{" "}
                  {siteIds.length} site{siteIds.length === 1 ? "" : "s"}.
                </p>
              )}
              <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                {rollups.map((r) => (
                  <div key={r.currency} className="contents">
                    <dt className="font-medium">{r.currency}</dt>
                    <dd className="text-muted-foreground">
                      {formatMoney(r.perPersonPerHead, r.currency)}/person ×{" "}
                      {r.participantCount}
                      {r.perGroup > 0
                        ? ` + ${formatMoney(r.perGroup, r.currency)} group`
                        : ""}
                    </dd>
                    <dd className="text-right font-medium">
                      {formatMoney(r.total, r.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
              {hasStaleCost ? (
                <p className="text-xs text-muted-foreground">
                  ⚠ Some prices are unconfirmed or over a year old — verify before
                  relying on this estimate.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Estimate only. Counts each visited site once.
              </p>
            </>
          )}
        </CardContent>
      </Card>

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
  );
}
