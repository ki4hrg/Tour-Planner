import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LinkCard } from "@/components/link-card";
import { Badge } from "@/components/ui/badge";
import { TripTypeForm } from "./trip-type-form";
import { createTripType } from "./actions";

export const dynamic = "force-dynamic";

export default async function TripTypesPage() {
  const user = await requireUser();
  const canManage = user.role === "ADMIN";

  const tripTypes = await prisma.tripType.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { locations: true, trips: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Trip types</h1>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add trip type</CardTitle>
          </CardHeader>
          <CardContent>
            <TripTypeForm action={createTripType} submitLabel="Create" />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tripTypes.map((t) => {
          const body = (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {t.color ? (
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: t.color }}
                      aria-hidden
                    />
                  ) : null}
                  {t.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {t.description ? <p>{t.description}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{t.defaultCurrency}</Badge>
                  <Badge variant="outline">{t._count.locations} locations</Badge>
                  <Badge variant="outline">{t._count.trips} trips</Badge>
                </div>
              </CardContent>
            </>
          );
          // Only admins have a detail page to go to; others get an inert card.
          return canManage ? (
            <LinkCard key={t.id} href={`/trip-types/${t.id}`}>
              {body}
            </LinkCard>
          ) : (
            <Card key={t.id}>{body}</Card>
          );
        })}
        {tripTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trip types.</p>
        ) : null}
      </div>
    </div>
  );
}
