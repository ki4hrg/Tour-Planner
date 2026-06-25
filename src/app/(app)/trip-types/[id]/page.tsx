import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TripTypeForm } from "../trip-type-form";
import { updateTripType, deleteTripType } from "../actions";

export const dynamic = "force-dynamic";

export default async function TripTypeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;

  const tripType = await prisma.tripType.findUnique({
    where: { id },
    include: { _count: { select: { sites: true, trips: true } } },
  });
  if (!tripType) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tripType.name}</h1>
        <Link
          href="/trip-types"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All trip types
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edit</CardTitle>
        </CardHeader>
        <CardContent>
          <TripTypeForm
            action={updateTripType}
            submitLabel="Save changes"
            initial={{
              id: tripType.id,
              name: tripType.name,
              description: tripType.description,
              color: tripType.color,
              defaultCurrency: tripType.defaultCurrency,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={deleteTripType}>
            <input type="hidden" name="id" value={tripType.id} />
            <Button
              type="submit"
              variant="destructive"
              disabled={tripType._count.trips > 0}
              title={
                tripType._count.trips > 0
                  ? "Reassign or delete this type's trips first"
                  : undefined
              }
            >
              Delete trip type
            </Button>
            {tripType._count.trips > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {tripType._count.trips} trip(s) use this type. Reassign or
                delete them before deleting the type.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
