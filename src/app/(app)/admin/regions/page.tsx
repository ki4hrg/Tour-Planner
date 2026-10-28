import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RegionForm } from "./region-form";
import { RegionsManager, type RegionRow } from "./regions-manager";
import { createRegion } from "./actions";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

export default async function RegionsAdminPage() {
  await requireRole("ADMIN");

  const [regions, tripTypes] = await Promise.all([
    prisma.region.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        dialCode: true,
        tripTypes: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        _count: { select: { locations: true, children: true } },
      },
    }),
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: RegionRow[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    dialCode: r.dialCode,
    tripTypes: r.tripTypes,
    locationCount: r._count.locations,
    childCount: r._count.children,
  }));
  const regionNodes = regions.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/admin" label="Admin" />
        <h1 className="text-2xl font-semibold">Regions</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add region</CardTitle>
        </CardHeader>
        <CardContent>
          <RegionForm
            action={createRegion}
            submitLabel="Create"
            regions={regionNodes}
            tripTypes={tripTypes}
          />
        </CardContent>
      </Card>

      <RegionsManager regions={rows} tripTypes={tripTypes} />
    </div>
  );
}
