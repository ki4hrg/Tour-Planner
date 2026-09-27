import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; archived?: string; q?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { type, archived, q } = await searchParams;
  const showArchived = archived === "1";
  const query = q?.trim() || undefined;

  const where: Prisma.LocationWhereInput = {
    archivedAt: showArchived ? { not: null } : null,
    ...(type ? { tripTypes: { some: { id: type } } } : {}),
    ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
  };

  const [locations, tripTypes] = await Promise.all([
    prisma.location.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        tripTypes: { select: { id: true, name: true, color: true } },
        hostSite: { select: { id: true } },
        region: { select: { name: true } },
      },
    }),
    prisma.tripType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const qs = (params: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    if (params.type) sp.set("type", params.type);
    if (params.archived) sp.set("archived", params.archived);
    if (params.q) sp.set("q", params.q);
    const s = sp.toString();
    return s ? `/locations?${s}` : "/locations";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Locations</h1>
        {canEdit ? (
          <Button asChild>
            <Link href="/locations/new">New location</Link>
          </Button>
        ) : null}
      </div>

      {/* GET form: name search composes with the trip-type filter links below,
          which round-trip q via qs(). */}
      <form action="/locations" method="get" className="flex max-w-sm gap-2">
        {type ? <input type="hidden" name="type" value={type} /> : null}
        {showArchived ? <input type="hidden" name="archived" value="1" /> : null}
        <Input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name…"
          aria-label="Search locations by name"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={qs({ archived: showArchived ? "1" : undefined, q: query })}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            !type ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          All
        </Link>
        {tripTypes.map((t) => (
          <Link
            key={t.id}
            href={qs({
              type: t.id,
              archived: showArchived ? "1" : undefined,
              q: query,
            })}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              type === t.id ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            {t.name}
          </Link>
        ))}
        <span className="ml-auto">
          <Link
            href={qs({ type, archived: showArchived ? undefined : "1", q: query })}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {showArchived ? "← Active locations" : "Show archived"}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {locations.map((l) => (
          <Card key={l.id} className={l.archivedAt ? "opacity-70" : undefined}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/locations/${l.id}`} className="hover:underline">
                  {l.name}
                </Link>
                {l.archivedAt ? (
                  <Badge variant="outline" className="ml-2 align-middle">
                    archived
                  </Badge>
                ) : null}
                {l.hostSite ? (
                  <Badge variant="secondary" className="ml-2 align-middle">
                    Host site
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {l.region ? <p>{l.region.name}</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {l.tripTypes.map((t) => (
                  <Badge key={t.id} variant="secondary">
                    {t.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showArchived ? "No archived locations." : "No locations."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
