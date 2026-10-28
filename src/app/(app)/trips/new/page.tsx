import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TripForm, type TripSource } from "../trip-form";
import { createTrip } from "../actions";
import { toDateInput } from "@/lib/dates";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; from?: string }>;
}) {
  await requireRole("PLANNER");
  const { template, from } = await searchParams;
  const asTemplate = template === "1";

  // "Start from" choices: every template plus every ordinary trip (archived
  // and cancelled included — last year's plan is the usual seed), newest
  // first. The form scopes them to the chosen type.
  const [tripTypes, sourceRows] = await Promise.all([
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultCurrency: true },
    }),
    prisma.trip.findMany({
      orderBy: [
        { startDate: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        name: true,
        tripTypeId: true,
        isTemplate: true,
        startDate: true,
        _count: { select: { days: true } },
      },
    }),
  ]);
  const sources: TripSource[] = sourceRows.map((t) => ({
    id: t.id,
    name: t.name,
    tripTypeId: t.tripTypeId,
    isTemplate: t.isTemplate,
    startDate: t.startDate ? toDateInput(t.startDate) : null,
    dayCount: t._count.days,
  }));
  const initialSourceId = sources.some((s) => s.id === from) ? from : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {asTemplate ? "New template" : "New trip"}
        </h1>
        <Link
          href={asTemplate ? "/trips?templates=1" : "/trips"}
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="size-4" />
          {asTemplate ? "All templates" : "All trips"}
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {asTemplate ? "Template details" : "Trip details"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tripTypes.length ? (
            <TripForm
              action={createTrip}
              submitLabel={asTemplate ? "Create template" : "Create trip"}
              tripTypes={tripTypes}
              sources={asTemplate ? undefined : sources}
              initialSourceId={asTemplate ? undefined : initialSourceId}
              defaultIsTemplate={asTemplate}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No trip types.{" "}
              <Link href="/trip-types" className="underline">
                Add trip type
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
