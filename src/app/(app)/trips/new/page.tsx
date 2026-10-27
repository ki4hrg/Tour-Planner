import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TripForm } from "../trip-form";
import { createTrip } from "../actions";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  await requireRole("PLANNER");
  const { template } = await searchParams;
  const asTemplate = template === "1";

  const [tripTypes, templates] = await Promise.all([
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, defaultCurrency: true },
    }),
    prisma.trip.findMany({
      where: { isTemplate: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tripTypeId: true },
    }),
  ]);

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
              templates={asTemplate ? undefined : templates}
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
