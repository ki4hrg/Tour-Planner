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
import { serializeCost, isCostStale, formatMoney } from "@/lib/money";
import { agreedTotal, tripHeadcount } from "@/lib/costs";
import { bookingStageText } from "@/lib/trips";
import {
  BOOKING_PROGRESS_SELECT,
  WORKFLOW_STEP_SELECT,
  progressView,
  waitingOn,
  waitingView,
} from "@/lib/booking-workflow";
import { WaitingNote } from "../../trips/waiting-note";
import { LocationWorkflowSelect } from "../location-workflow-select";
import { ProgressList, type ProgressLine } from "../../trips/booking-progress";
import {
  resolveSchedule,
  scheduleAttention,
  serializeInstallment,
} from "@/lib/payment-schedule";
import { mapHref } from "@/lib/maps";
import { placesEnabled } from "@/lib/google-places";
import { effectiveDialCode } from "@/lib/regions";
import { serializeNote } from "@/lib/notes";
import {
  serializeDocument,
  DOCUMENT_SELECT,
  bookingDashboardHref,
} from "@/lib/documents";
import { todayUtc, toDateInput, formatDate, addDays, isOngoing } from "@/lib/dates";
import { EditableSection } from "@/components/editable-section";
import { LocationForm } from "../location-form";
import { CostsManager } from "../costs-manager";
import { LocationPaymentTerms } from "../location-payment-terms";
import { LocationContactsManager } from "../location-contacts-manager";
import { LocationTripsPanel, type LocationTripRow } from "../location-trips-panel";
import { HostSitePanel } from "../host-site-panel";
import { MergeLocationPanel } from "../merge-location-panel";
import { NotesThread } from "../../notes/notes-thread";
import { DocumentRow, DocumentsPanel } from "../../documents/documents-panel";
import { updateLocation, deleteLocation, unarchiveLocation } from "../actions";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const location = await prisma.location.findUnique({
    where: { id },
    include: {
      tripTypes: { select: { id: true, name: true } },
      region: { select: { id: true, name: true, parentId: true } },
      costs: { orderBy: { label: "asc" } },
      defaultPaymentSchedule: { orderBy: { sortOrder: "asc" } },
      contacts: { orderBy: { name: "asc" } },
      siteNotes: {
        orderBy: { contactedOn: "desc" },
        include: {
          contact: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      },
      // Venue paperwork that outlives any one trip — floor plans, standing
      // terms, risk assessments.
      documents: { orderBy: { createdAt: "desc" }, select: DOCUMENT_SELECT },
      hostSite: {
        select: {
          id: true,
          providesLodging: true,
          providesMeals: true,
          providesMeetingSpace: true,
          staffNotes: true,
          logisticsNotes: true,
        },
      },
      _count: { select: { scheduleItems: true } },
    },
  });
  if (!location) notFound();

  const [allTripTypes, allContacts, allRegions] = await Promise.all([
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.region.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true, dialCode: true },
    }),
  ]);

  // Merge targets: every other location, archived ones included (a duplicate
  // may well be merged into the archived original).
  const mergeCandidates = canEdit
    ? (
        await prisma.location.findMany({
          where: { id: { not: id } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, region: { select: { name: true } } },
        })
      ).map((l) => ({ id: l.id, name: l.name, region: l.region?.name ?? null }))
    : [];

  // Default dial code for new contact phones: the region chain's, else +1.
  const defaultDialCode = effectiveDialCode(
    location.regionId,
    new Map(allRegions.map((r) => [r.id, r])),
  );

  // Follow-ups on location notes can pick a Todoist destination when the
  // viewer has a connection (the picker lazy-loads project options itself).
  const todoistConnected =
    canEdit &&
    (await prisma.todoistConnection.count({ where: { userId: user.id } })) > 0;

  const linkedIds = new Set(location.contacts.map((c) => c.id));
  const availableContacts = allContacts.filter((c) => !linkedIds.has(c.id));
  // The contact-log picker is scoped to the people actually linked to this
  // location — you log calls with this venue's contacts, not the global list.
  const linkedContacts = location.contacts.map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const defaultCurrency = "USD";
  const referenced = location._count.scheduleItems > 0;

  // Flag prices unconfirmed or confirmed over a year ago.
  const costs = location.costs.map((c) => ({
    ...serializeCost(c),
    stale: isCostStale(c.confirmedAt),
  }));

  // Standing payment terms (GH #86) — Decimals flattened at the boundary. The
  // currency is per-engagement, so the read view just borrows the first cost's
  // currency (else USD) to format any fixed amounts.
  const paymentTerms = location.defaultPaymentSchedule.map((t) => ({
    id: t.id,
    label: t.label,
    percent: t.percent == null ? null : Number(t.percent),
    fixedAmount: t.fixedAmount == null ? null : Number(t.fixedAmount),
    anchor: t.anchor,
    offsetValue: t.offsetValue,
    offsetUnit: t.offsetUnit,
  }));
  const termsCurrency = location.costs[0]?.currency ?? "USD";

  // Trips touching this venue that are ongoing or start within 30 days — the
  // on-site working set. Touch = engagement booking, schedule-item site, stay,
  // or a rough-plan (time-less) day assignment.
  const today = todayUtc();
  const currentTripRows = await prisma.trip.findMany({
    where: {
      isTemplate: false,
      startDate: { lte: addDays(today, 30) },
      endDate: { gte: today },
      OR: [
        { bookings: { some: { locationId: id } } },
        { stays: { some: { locationId: id } } },
        {
          days: {
            some: {
              scheduleItems: { some: { sites: { some: { locationId: id } } } },
            },
          },
        },
        { days: { some: { plannedLocations: { some: { locationId: id } } } } },
      ],
    },
    orderBy: { startDate: "asc" },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      bookings: { where: { locationId: id }, select: BOOKING_PROGRESS_SELECT },
      stays: { where: { locationId: id }, select: { id: true } },
      days: {
        select: {
          scheduleItems: {
            where: { sites: { some: { locationId: id } } },
            select: { id: true },
          },
          plannedLocations: { where: { locationId: id }, select: { id: true } },
        },
      },
    },
  });
  const currentTrips: LocationTripRow[] = currentTripRows.map((t) => ({
    tripId: t.id,
    tripName: t.name,
    dates: [formatDate(t.startDate), formatDate(t.endDate)]
      .filter(Boolean)
      .join(" – "),
    ongoing: isOngoing(t.startDate, t.endDate),
    booking: progressView(t.bookings[0] ?? null, location.defaultWorkflowId),
    sessionCount: t.days.reduce((n, d) => n + d.scheduleItems.length, 0),
    plannedCount: t.days.reduce((n, d) => n + d.plannedLocations.length, 0),
    hasLodging: t.stays.length > 0,
  }));

  // Booking progress: this venue's engagement on every active trip that hasn't
  // ended (or has no dates yet) and touches it — the one place to move the
  // venue's bookings along across trips. A trip with no engagement yet shows
  // the workflow its first tick will seed.
  const progressTripRows = location.bookable
    ? await prisma.trip.findMany({
        where: {
          isTemplate: false,
          status: "ACTIVE",
          OR: [{ endDate: null }, { endDate: { gte: today } }],
          AND: {
            OR: [
              { bookings: { some: { locationId: id } } },
              { stays: { some: { locationId: id } } },
              {
                days: {
                  some: {
                    scheduleItems: { some: { sites: { some: { locationId: id } } } },
                  },
                },
              },
              { days: { some: { plannedLocations: { some: { locationId: id } } } } },
            ],
          },
        },
        orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          startDate: true,
          bookings: { where: { locationId: id }, select: BOOKING_PROGRESS_SELECT },
        },
      })
    : [];
  const progressLines: ProgressLine[] = progressTripRows.map((t) => ({
    key: t.id,
    name: t.name,
    href: bookingDashboardHref(t.id, id),
    detail: t.startDate ? formatDate(t.startDate) : "No dates",
    target: { tripId: t.id, locationId: id },
    progress: progressView(t.bookings[0] ?? null, location.defaultWorkflowId),
  }));

  // Visit history: which non-template trips this venue appears in, newest first.
  // Timed schedule-item stops and rough-plan (time-less) day assignments are
  // counted separately so an unfirmed plan still shows up here.
  const tripSelect = {
    day: { select: { trip: { select: { id: true, name: true, startDate: true } } } },
  } as const;
  const [visitRows, plannedRows] = await Promise.all([
    prisma.scheduleItemSite.findMany({
      where: {
        locationId: id,
        scheduleItem: { day: { trip: { isTemplate: false } } },
      },
      select: { scheduleItem: { select: tripSelect } },
    }),
    prisma.itineraryDayLocation.findMany({
      where: { locationId: id, day: { trip: { isTemplate: false } } },
      select: tripSelect,
    }),
  ]);
  const visitMap = new Map<
    string,
    {
      id: string;
      name: string;
      startDate: Date | null;
      count: number;
      planned: number;
    }
  >();
  const tally = (
    t: { id: string; name: string; startDate: Date | null },
    key: "count" | "planned",
  ) => {
    const existing =
      visitMap.get(t.id) ??
      { id: t.id, name: t.name, startDate: t.startDate, count: 0, planned: 0 };
    existing[key] += 1;
    visitMap.set(t.id, existing);
  };
  for (const v of visitRows) tally(v.scheduleItem.day.trip, "count");
  for (const p of plannedRows) tally(p.day.trip, "planned");
  const visits = [...visitMap.values()].sort(
    (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
  );

  // Engagement history (GH #86 part C): the money conversation for this venue in
  // one place — every non-template trip's booking here with its status and
  // agreed/paid/outstanding/overdue state, newest first.
  const engagementRows = location.bookable
    ? await prisma.booking.findMany({
        where: { locationId: id, trip: { isTemplate: false } },
        select: {
          id: true,
          status: true,
          stageLabel: true,
          workflow: {
            select: {
              steps: {
                orderBy: { sortOrder: "asc" },
                select: WORKFLOW_STEP_SELECT,
              },
            },
          },
          stepCompletions: { select: { stepId: true, completedOn: true } },
          bookedOn: true,
          createdAt: true,
          agreedAmount: true,
          agreedCurrency: true,
          agreedUnit: true,
          payments: { select: { amount: true } },
          paymentSchedule: true,
          trip: {
            select: {
              id: true,
              name: true,
              startDate: true,
              participantCount: true,
              capacity: true,
            },
          },
        },
      })
    : [];
  const engagements = engagementRows
    .filter((b) => b.trip != null)
    .map((b) => {
      const rate = b.agreedAmount == null ? null : Number(b.agreedAmount);
      // Per-person rates × the trip's headcount; null when that's unknown.
      const agreed = agreedTotal(
        { agreedAmount: rate, agreedUnit: b.agreedUnit },
        tripHeadcount(b.trip!),
      );
      const paid = b.payments.reduce((s, p) => s + Number(p.amount), 0);
      const resolved = resolveSchedule(
        b.paymentSchedule.map(serializeInstallment),
        {
          agreedAmount: agreed,
          paidTotal: paid,
          tripStartDate: b.trip!.startDate,
          bookingDate: b.bookedOn ?? b.createdAt,
          today,
        },
      );
      const { overdueAmount } = scheduleAttention(resolved);
      return {
        bookingId: b.id,
        tripId: b.trip!.id,
        tripName: b.trip!.name,
        startDate: b.trip!.startDate,
        status: b.status,
        stageLabel: b.stageLabel,
        // Whose move: the upcoming step + its owner, days waiting as of today.
        waiting: b.workflow
          ? waitingView(
              waitingOn(
                b.workflow.steps,
                b.stepCompletions,
                b.status,
                b.bookedOn ?? b.createdAt,
              ),
              today,
            )
          : null,
        currency: b.agreedCurrency,
        // Set only for a per-person rate whose trip has no headcount.
        unresolvedRate: rate != null && agreed == null ? rate : null,
        agreed,
        paid,
        outstanding: agreed == null ? null : Math.max(0, agreed - paid),
        overdueAmount,
      };
    })
    .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));

  // Contracts by trip: paperwork filed on each trip's engagement with this
  // venue (not the venue's own library above), grouped by trip, newest first.
  const engagementDocRows = await prisma.document.findMany({
    where: { booking: { locationId: id, tripId: { not: null } } },
    orderBy: { createdAt: "desc" },
    select: {
      ...DOCUMENT_SELECT,
      booking: {
        select: { trip: { select: { id: true, name: true, startDate: true } } },
      },
    },
  });
  const contractsByTrip = new Map<
    string,
    {
      tripId: string;
      tripName: string;
      startDate: Date | null;
      documents: ReturnType<typeof serializeDocument>[];
    }
  >();
  for (const doc of engagementDocRows) {
    const trip = doc.booking?.trip;
    if (!trip) continue;
    const entry = contractsByTrip.get(trip.id) ?? {
      tripId: trip.id,
      tripName: trip.name,
      startDate: trip.startDate,
      documents: [],
    };
    entry.documents.push(serializeDocument(doc));
    contractsByTrip.set(trip.id, entry);
  }
  const contractGroups = [...contractsByTrip.values()].sort(
    (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
  );

  const hostSiteSummary = location.hostSite
    ? [
        location.hostSite.providesLodging ? "lodging" : null,
        location.hostSite.providesMeals ? "meals" : null,
        location.hostSite.providesMeetingSpace ? "meeting space" : null,
      ]
        .filter(Boolean)
        .join(", ") || "yes"
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {location.name}
          {location.archivedAt ? (
            <Badge variant="outline" className="ml-2 align-middle">
              archived
            </Badge>
          ) : null}
        </h1>
        <Link
          href="/locations"
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="size-4" />
          All locations
        </Link>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        {/* Contact log — right 2/3 on desktop, below the metadata on mobile. This
            is the surface you work in, so it mirrors the itinerary on the trip page. */}
        <div className="order-2 min-w-0 space-y-6 lg:col-span-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes &amp; contact log</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesThread
            target="location"
            targetId={location.id}
            notes={location.siteNotes.map(serializeNote)}
            contacts={linkedContacts}
            canEdit={canEdit}
            today={toDateInput(todayUtc())}
            todoistDestinationPicker={todoistConnected}
          />
        </CardContent>
      </Card>

      {progressLines.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressList lines={progressLines} canEdit={canEdit} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentsPanel
            target="location"
            targetId={location.id}
            venueName={location.name}
            documents={location.documents.map(serializeDocument)}
            canEdit={canEdit}
            emptyLabel="No files."
          />
        </CardContent>
      </Card>

      {contractGroups.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contracts by trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {contractGroups.map((g) => (
              <section key={g.tripId} className="space-y-2">
                <h4 className="text-sm font-medium">
                  <Link
                    href={bookingDashboardHref(g.tripId, location.id)}
                    className="hover:underline"
                  >
                    {g.tripName}
                  </Link>{" "}
                  <span className="font-normal text-muted-foreground">
                    · {g.startDate ? formatDate(g.startDate) : "—"} ·{" "}
                    {g.documents.length} file{g.documents.length === 1 ? "" : "s"}
                  </span>
                </h4>
                <ul className="space-y-2">
                  {g.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      shareContext={{ target: "booking", venueName: location.name }}
                      canEdit={false}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visit history</CardTitle>
        </CardHeader>
        <CardContent>
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No visits.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {visits.map((v) => (
                <li
                  key={v.id}
                  className="flex items-baseline justify-between gap-2"
                >
                  <Link href={`/trips/${v.id}`} className="hover:underline">
                    {v.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[
                      v.startDate ? formatDate(v.startDate) : "—",
                      v.count
                        ? `${v.count} visit${v.count === 1 ? "" : "s"}`
                        : null,
                      v.planned ? `${v.planned} planned` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {location.bookable && engagements.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engagement history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {engagements.map((e) => (
                <li
                  key={e.bookingId}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <Link
                      href={bookingDashboardHref(e.tripId, location.id)}
                      className="font-medium hover:underline"
                    >
                      {e.tripName}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {e.startDate ? formatDate(e.startDate) : "—"} ·{" "}
                      {e.waiting ? (
                        <WaitingNote waiting={e.waiting} />
                      ) : (
                        bookingStageText(e)
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">
                    {e.unresolvedRate != null ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        {formatMoney(e.unresolvedRate, e.currency)}/person · no
                        headcount
                      </span>
                    ) : e.agreed == null ? (
                      <span className="text-muted-foreground">no agreed price</span>
                    ) : (
                      <>
                        <span className="text-muted-foreground">
                          {formatMoney(e.paid, e.currency)} /{" "}
                          {formatMoney(e.agreed, e.currency)}
                        </span>{" "}
                        {e.overdueAmount > 0 ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            · {formatMoney(e.overdueAmount, e.currency)} overdue
                          </span>
                        ) : e.outstanding && e.outstanding > 0 ? (
                          <span className="font-medium text-amber-700 dark:text-amber-300">
                            · {formatMoney(e.outstanding, e.currency)} left
                          </span>
                        ) : (
                          <span className="font-medium text-emerald-700 dark:text-emerald-300">
                            · settled
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
        </div>

        {/* Reference/metadata — leads on mobile, left 1/3 on desktop. */}
        <div className="order-1 min-w-0 space-y-6 lg:col-span-1">
      {currentTrips.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current trips here</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationTripsPanel
              locationId={location.id}
              rows={currentTrips}
              canEdit={canEdit}
              bookable={location.bookable}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditableSection
            canEdit={canEdit}
            view={
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <dt className="text-muted-foreground">Region</dt>
                <dd className="col-span-2">{location.region?.name ?? "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="col-span-2">
                  {location.address ?? "—"}
                  {mapHref(location) ? (
                    <a
                      href={mapHref(location)!}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 whitespace-nowrap text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Open in Maps
                    </a>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Trip types</dt>
                <dd className="col-span-2">
                  {location.tripTypes.length
                    ? location.tripTypes.map((t) => t.name).join(", ")
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Website</dt>
                <dd className="col-span-2 truncate">
                  {location.website ? (
                    <a
                      href={location.website}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {location.website}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="col-span-2 whitespace-pre-wrap">
                  {location.description ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Schedule</dt>
                <dd className="col-span-2">
                  {location.scheduleLimitations ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Bookable</dt>
                <dd className="col-span-2">
                  {location.bookable ? "Yes" : "No"}
                </dd>
                {location.bookable ? (
                  <>
                    <dt className="text-muted-foreground">Booking opens</dt>
                    <dd className="col-span-2">
                      {location.bookingOpensLeadDays != null
                        ? `${location.bookingOpensLeadDays} days before`
                        : "—"}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Host site</dt>
                <dd className="col-span-2">
                  {hostSiteSummary
                    ? hostSiteSummary === "yes"
                      ? "Yes"
                      : `Yes — ${hostSiteSummary}`
                    : "No"}
                </dd>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="col-span-2 whitespace-pre-wrap">
                  {location.notes ?? "—"}
                </dd>
              </dl>
            }
          >
            <LocationForm
              action={updateLocation}
              submitLabel="Save changes"
              tripTypes={allTripTypes}
              regions={allRegions}
              placesEnabled={placesEnabled()}
              initial={{
                id: location.id,
                name: location.name,
                regionId: location.regionId,
                address: location.address,
                description: location.description,
                notes: location.notes,
                website: location.website,
                mapUrl: location.mapUrl,
                googlePlaceId: location.googlePlaceId,
                lat: location.lat,
                lng: location.lng,
                bookable: location.bookable,
                bookingOpensLeadDays: location.bookingOpensLeadDays,
                bookingNotes: location.bookingNotes,
                scheduleLimitations: location.scheduleLimitations,
                tripTypeIds: location.tripTypes.map((t) => t.id),
              }}
            />
          </EditableSection>
        </CardContent>
      </Card>

      <Card id="contacts" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationContactsManager
            locationId={location.id}
            linked={location.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              role: c.role,
              organization: c.organization,
              phone: c.phone,
              email: c.email,
            }))}
            available={availableContacts}
            primaryContactId={location.primaryContactId}
            canEdit={canEdit}
            defaultDialCode={defaultDialCode}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <CostsManager
            locationId={location.id}
            costs={costs}
            defaultCurrency={defaultCurrency}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {location.bookable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationWorkflowSelect
              locationId={location.id}
              workflowId={location.defaultWorkflowId}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      ) : null}

      {location.bookable && (paymentTerms.length > 0 || canEdit) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment terms</CardTitle>
          </CardHeader>
          <CardContent>
            <LocationPaymentTerms
              locationId={location.id}
              terms={paymentTerms}
              currency={termsCurrency}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      ) : null}

      {location.hostSite || canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Host site</CardTitle>
          </CardHeader>
          <CardContent>
            <HostSitePanel
              locationId={location.id}
              hostSite={location.hostSite}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      ) : null}
        </div>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {location.archivedAt ? (
              <form action={unarchiveLocation}>
                <input type="hidden" name="id" value={location.id} />
                <Button type="submit" variant="outline">
                  Unarchive location
                </Button>
              </form>
            ) : (
              <form action={deleteLocation}>
                <input type="hidden" name="id" value={location.id} />
                <Button type="submit" variant="destructive">
                  {referenced ? "Archive location" : "Delete location"}
                </Button>
                <p className="mt-2 text-sm text-muted-foreground">
                  {referenced
                    ? `Used by ${location._count.scheduleItems} item(s); archives instead of deleting.`
                    : "Permanently deletes."}
                </p>
              </form>
            )}
            <div className="border-t pt-4">
              <MergeLocationPanel
                locationId={location.id}
                locationName={location.name}
                candidates={mergeCandidates}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
