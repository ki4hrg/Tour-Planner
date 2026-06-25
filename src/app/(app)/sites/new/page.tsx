import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SiteForm } from "../site-form";
import { createSite } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  await requireRole("PLANNER");
  const tripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New site</h1>
        <Link
          href="/sites"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All sites
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site details</CardTitle>
        </CardHeader>
        <CardContent>
          <SiteForm
            action={createSite}
            submitLabel="Create site"
            tripTypes={tripTypes}
          />
        </CardContent>
      </Card>
    </div>
  );
}
