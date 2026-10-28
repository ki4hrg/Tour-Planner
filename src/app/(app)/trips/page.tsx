import Link from "next/link";
import type { Prisma } from "@prisma/client";
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
import { cn } from "@/lib/utils";
import { formatDate, todayUtc } from "@/lib/dates";
import {
  TRIP_LIFECYCLE_LABELS,
  TRIP_LIFECYCLES,
  type TripLifecycle,
  deriveTripLifecycle,
  tripLifecycleWhere,
} from "@/lib/trips";
import { TemplateChip } from "./template-chip";

export const dynamic = "force-dynamic";

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; templates?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { status, templates } = await searchParams;
  const showTemplates = templates === "1";
  const today = todayUtc();

  // The filter chips are derived-lifecycle filters (GH #56): Planning /
  // In progress / Complete come from dates, Archived / Cancelled from the
  // stored override.
  const lifecycle =
    status && TRIP_LIFECYCLES.includes(status as TripLifecycle)
      ? (status as TripLifecycle)
      : undefined;
  // No filter = the working set: archived and cancelled trips stay out until
  // asked for by their own chip or "All".
  const showAll = status === "all";
  const where: Prisma.TripWhereInput = {
    isTemplate: showTemplates,
    ...(lifecycle
      ? tripLifecycleWhere(lifecycle, today)
      : showAll
        ? {}
        : { status: { notIn: ["ARCHIVED", "CANCELLED"] } }),
  };

  const trips = await prisma.trip.findMany({
    where,
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: {
      tripType: { select: { name: true } },
      _count: { select: { days: true } },
    },
  });

  // Trip types with more than one trip can be compared across years.
  const grouped = await prisma.trip.groupBy({
    by: ["tripTypeId"],
    where: { isTemplate: false },
    _count: { _all: true },
  });
  const multiYearIds = grouped
    .filter((g) => g._count._all > 1)
    .map((g) => g.tripTypeId);
  const multiYearTypes =
    !showTemplates && multiYearIds.length
      ? await prisma.tripType.findMany({
          where: { id: { in: multiYearIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : [];

  const qs = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.templates) sp.set("templates", params.templates);
    const s = sp.toString();
    return s ? `/trips?${s}` : "/trips";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {showTemplates ? "Templates" : "Trips"}
        </h1>
        {canEdit ? (
          <Button asChild>
            <Link href={showTemplates ? "/trips/new?template=1" : "/trips/new"}>
              {showTemplates ? "New template" : "New trip"}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={qs({ templates: showTemplates ? "1" : undefined })}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            !lifecycle && !showAll ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          Current
        </Link>
        {TRIP_LIFECYCLES.map((s) => (
          <Link
            key={s}
            href={qs({ status: s, templates: showTemplates ? "1" : undefined })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              lifecycle === s ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            {TRIP_LIFECYCLE_LABELS[s]}
          </Link>
        ))}
        <Link
          href={qs({ status: "all", templates: showTemplates ? "1" : undefined })}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            showAll ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          All
        </Link>
        <span className="ml-auto">
          <Link
            href={qs({ status, templates: showTemplates ? undefined : "1" })}
            className="text-sm text-muted-foreground link-quiet"
          >
            {showTemplates ? "Hide templates" : "Show templates"}
          </Link>
        </span>
      </div>

      {multiYearTypes.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compare years</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {multiYearTypes.map((tt) => (
              <Button key={tt.id} asChild variant="outline" size="sm">
                <Link href={`/trips/compare?type=${tt.id}`}>{tt.name}</Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <Link href={`/trips/${t.id}`} className="hover:underline">
                  {t.name}
                </Link>
                {t.isTemplate ? (
                  <TemplateChip />
                ) : (
                  <Badge variant="secondary" className="shrink-0">
                    {TRIP_LIFECYCLE_LABELS[deriveTripLifecycle(t, today)]}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{t.tripType.name}</p>
              {!t.isTemplate ? (
                <p>
                  {t.startDate
                    ? `${formatDate(t.startDate)}${
                        t.endDate ? ` → ${formatDate(t.endDate)}` : ""
                      }`
                    : "Dates not set"}
                </p>
              ) : null}
              <p>
                {t._count.days} day{t._count.days === 1 ? "" : "s"}
                {t.participantCount != null
                  ? ` · ${t.participantCount} participant${
                      t.participantCount === 1 ? "" : "s"
                    }`
                  : ""}
              </p>
              {canEdit ? (
                <p>
                  <Link href={`/trips/new?from=${t.id}`} className="link-quiet">
                    Duplicate
                  </Link>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showTemplates ? "No templates." : "No trips."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
