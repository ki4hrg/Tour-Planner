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
import { serializeCost, isCostStale } from "@/lib/money";
import { serializeNote } from "@/lib/notes";
import { todayUtc, toDateInput, formatDate } from "@/lib/dates";
import { EditableSection } from "@/components/editable-section";
import { LocationForm } from "../location-form";
import { CostsManager } from "../costs-manager";
import { LocationContactsManager } from "../location-contacts-manager";
import { HostSitePanel } from "../host-site-panel";
import { NotesThread } from "../../notes/notes-thread";
import { updateLocation, deleteLocation, unarchiveLocation } from "../actions";

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
      contacts: { orderBy: { name: "asc" } },
      siteNotes: {
        orderBy: { contactedOn: "desc" },
        include: {
          contact: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      },
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
      select: { id: true, name: true, parentId: true },
    }),
  ]);

  const linkedIds = new Set(location.contacts.map((c) => c.id));
  const availableContacts = allContacts.filter((c) => !linkedIds.has(c.id));
  const defaultCurrency = "USD";
  const referenced = location._count.scheduleItems > 0;

  // Flag prices unconfirmed or confirmed over a year ago.
  const costs = location.costs.map((c) => ({
    ...serializeCost(c),
    stale: isCostStale(c.confirmedAt),
  }));

  // Visit history: which non-template trips this venue appears in, newest first.
  const visitRows = await prisma.scheduleItemSite.findMany({
    where: {
      locationId: id,
      scheduleItem: { day: { trip: { isTemplate: false } } },
    },
    select: {
      scheduleItem: {
        select: {
          day: {
            select: {
              trip: { select: { id: true, name: true, startDate: true } },
            },
          },
        },
      },
    },
  });
  const visitMap = new Map<
    string,
    { id: string; name: string; startDate: Date | null; count: number }
  >();
  for (const v of visitRows) {
    const t = v.scheduleItem.day.trip;
    const existing = visitMap.get(t.id);
    if (existing) existing.count += 1;
    else visitMap.set(t.id, { id: t.id, name: t.name, startDate: t.startDate, count: 1 });
  }
  const visits = [...visitMap.values()].sort(
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
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All locations
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Left column: what this place is */}
        <div className="space-y-6">
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
                <dd className="col-span-2">{location.address ?? "—"}</dd>
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
                  {location.bookable ? "Yes" : "No — walk-by stop"}
                </dd>
                <dt className="text-muted-foreground">Booking opens</dt>
                <dd className="col-span-2">
                  {location.bookingOpensLeadDays != null
                    ? `${location.bookingOpensLeadDays} days before`
                    : "—"}
                </dd>
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
              initial={{
                id: location.id,
                name: location.name,
                regionId: location.regionId,
                address: location.address,
                description: location.description,
                notes: location.notes,
                website: location.website,
                mapUrl: location.mapUrl,
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

        {/* Right column: who we talk to & how it's been used */}
        <div className="space-y-6">
      <Card>
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
            }))}
            available={availableContacts}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes &amp; contact log</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesThread
            target="location"
            targetId={location.id}
            notes={location.siteNotes.map(serializeNote)}
            contacts={allContacts}
            canEdit={canEdit}
            today={toDateInput(todayUtc())}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visit history</CardTitle>
        </CardHeader>
        <CardContent>
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not used by any trip yet.
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
                    {v.startDate ? formatDate(v.startDate) : "—"} · {v.count}{" "}
                    visit{v.count === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
        </div>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
                    ? `Used by ${location._count.scheduleItems} itinerary item(s), so it will be archived (hidden from pickers) rather than deleted.`
                    : "Not used by any itinerary, so it will be permanently deleted."}
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
