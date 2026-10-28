import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocationForm } from "../location-form";
import { createLocation } from "../actions";
import { placesEnabled } from "@/lib/google-places";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

export default async function NewLocationPage() {
  await requireRole("PLANNER");
  const [tripTypes, regions] = await Promise.all([
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.region.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/locations" label="All locations" />
        <h1 className="text-2xl font-semibold">New location</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationForm
            action={createLocation}
            submitLabel="Create location"
            tripTypes={tripTypes}
            regions={regions}
            placesEnabled={placesEnabled()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
