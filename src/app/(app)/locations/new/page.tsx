import Link from "next/link";
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New location</h1>
        <Link
          href="/locations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All locations
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location details</CardTitle>
        </CardHeader>
        <CardContent>
          <LocationForm
            action={createLocation}
            submitLabel="Create location"
            tripTypes={tripTypes}
            regions={regions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
