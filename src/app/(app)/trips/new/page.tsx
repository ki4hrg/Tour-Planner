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

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  await requireRole("PLANNER");
  const tripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New trip</h1>
        <Link
          href="/trips"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All trips
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trip details</CardTitle>
        </CardHeader>
        <CardContent>
          {tripTypes.length ? (
            <TripForm
              action={createTrip}
              submitLabel="Create trip"
              tripTypes={tripTypes}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Create a{" "}
              <Link href="/trip-types" className="underline">
                trip type
              </Link>{" "}
              first — every trip needs one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
