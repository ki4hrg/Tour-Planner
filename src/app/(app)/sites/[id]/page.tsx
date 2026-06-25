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
import { SiteForm } from "../site-form";
import { CostsManager } from "../costs-manager";
import { SiteContactsManager } from "../site-contacts-manager";
import { updateSite, deleteSite, unarchiveSite } from "../actions";

export const dynamic = "force-dynamic";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      tripTypes: { select: { id: true, name: true } },
      costs: { orderBy: { label: "asc" } },
      contacts: { orderBy: { name: "asc" } },
      _count: { select: { scheduleItems: true } },
    },
  });
  if (!site) notFound();

  const [allTripTypes, allContacts] = await Promise.all([
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const linkedIds = new Set(site.contacts.map((c) => c.id));
  const availableContacts = allContacts.filter((c) => !linkedIds.has(c.id));
  const defaultCurrency = "USD";
  const referenced = site._count.scheduleItems > 0;

  // Flag prices unconfirmed or confirmed over a year ago.
  const costs = site.costs.map((c) => ({
    ...serializeCost(c),
    stale: isCostStale(c.confirmedAt),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {site.name}
          {site.archivedAt ? (
            <Badge variant="outline" className="ml-2 align-middle">
              archived
            </Badge>
          ) : null}
        </h1>
        <Link
          href="/sites"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All sites
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <SiteForm
              action={updateSite}
              submitLabel="Save changes"
              tripTypes={allTripTypes}
              initial={{
                id: site.id,
                name: site.name,
                region: site.region,
                address: site.address,
                description: site.description,
                notes: site.notes,
                website: site.website,
                mapUrl: site.mapUrl,
                bookingOpensLeadDays: site.bookingOpensLeadDays,
                bookingNotes: site.bookingNotes,
                scheduleLimitations: site.scheduleLimitations,
                tripTypeIds: site.tripTypes.map((t) => t.id),
              }}
            />
          ) : (
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <dt className="text-muted-foreground">Region</dt>
              <dd className="col-span-2">{site.region ?? "—"}</dd>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="col-span-2">{site.description ?? "—"}</dd>
              <dt className="text-muted-foreground">Schedule</dt>
              <dd className="col-span-2">{site.scheduleLimitations ?? "—"}</dd>
              <dt className="text-muted-foreground">Booking opens</dt>
              <dd className="col-span-2">
                {site.bookingOpensLeadDays != null
                  ? `${site.bookingOpensLeadDays} days before`
                  : "—"}
              </dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <CostsManager
            siteId={site.id}
            costs={costs}
            defaultCurrency={defaultCurrency}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <SiteContactsManager
            siteId={site.id}
            linked={site.contacts.map((c) => ({
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

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {site.archivedAt ? (
              <form action={unarchiveSite}>
                <input type="hidden" name="id" value={site.id} />
                <Button type="submit" variant="outline">
                  Unarchive site
                </Button>
              </form>
            ) : (
              <form action={deleteSite}>
                <input type="hidden" name="id" value={site.id} />
                <Button type="submit" variant="destructive">
                  {referenced ? "Archive site" : "Delete site"}
                </Button>
                <p className="mt-2 text-sm text-muted-foreground">
                  {referenced
                    ? `Used by ${site._count.scheduleItems} itinerary item(s), so it will be archived (hidden from pickers) rather than deleted.`
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
