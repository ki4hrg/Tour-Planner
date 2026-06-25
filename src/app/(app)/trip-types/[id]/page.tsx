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

  const templates = await prisma.trip.findMany({
    where: { tripTypeId: id, isTemplate: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { days: true } } },
  });

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Template itineraries</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/trips/new?template=1">New template</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          {templates.length === 0 ? (
            <p className="text-muted-foreground">
              No templates for this type yet. Create one, then new trips of this
              type can start from it.
            </p>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <Link
                    href={`/trips/${t.id}/itinerary`}
                    className="font-medium hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {t._count.days} day{t._count.days === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
