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
import { formatDate } from "@/lib/dates";
import { TRIP_STATUS_LABELS, TRIP_STATUSES } from "@/lib/trips";

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

  const where: Prisma.TripWhereInput = {
    isTemplate: showTemplates,
    ...(status && TRIP_STATUSES.includes(status as (typeof TRIP_STATUSES)[number])
      ? { status: status as (typeof TRIP_STATUSES)[number] }
      : {}),
  };

  const trips = await prisma.trip.findMany({
    where,
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    include: {
      tripType: { select: { name: true } },
      _count: { select: { days: true } },
    },
  });

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
        <div>
          <h1 className="text-2xl font-semibold">
            {showTemplates ? "Templates" : "Trips"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {showTemplates
              ? "Reusable trip blueprints."
              : "Plan itineraries day by day."}
          </p>
        </div>
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
            !status ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          All
        </Link>
        {TRIP_STATUSES.map((s) => (
          <Link
            key={s}
            href={qs({ status: s, templates: showTemplates ? "1" : undefined })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              status === s ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            {TRIP_STATUS_LABELS[s]}
          </Link>
        ))}
        <span className="ml-auto">
          <Link
            href={qs({ status, templates: showTemplates ? undefined : "1" })}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {showTemplates ? "← Trips" : "Show templates"}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {trips.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <Link href={`/trips/${t.id}`} className="hover:underline">
                  {t.name}
                </Link>
                <Badge variant="secondary" className="shrink-0">
                  {TRIP_STATUS_LABELS[t.status]}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{t.tripType.name}</p>
              <p>
                {t.startDate
                  ? `${formatDate(t.startDate)}${
                      t.endDate ? ` → ${formatDate(t.endDate)}` : ""
                    }`
                  : "Dates not set"}
              </p>
              <p>
                {t._count.days} day{t._count.days === 1 ? "" : "s"}
                {t.participantCount != null
                  ? ` · ${t.participantCount} participant${
                      t.participantCount === 1 ? "" : "s"
                    }`
                  : ""}
              </p>
            </CardContent>
          </Card>
        ))}
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showTemplates ? "No templates yet." : "No trips yet."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
