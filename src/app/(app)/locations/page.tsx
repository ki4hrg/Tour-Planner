import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LinkCard } from "@/components/link-card";
import { FilterChip } from "@/components/filter-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        <FilterChip
          href={qs({ archived: showArchived ? "1" : undefined, q: query })}
          active={!type}
        >
          All
        </FilterChip>
        {tripTypes.map((t) => (
          <FilterChip
            key={t.id}
            href={qs({
              type: t.id,
              archived: showArchived ? "1" : undefined,
              q: query,
            })}
            active={type === t.id}
          >
            {t.name}
          </FilterChip>
        ))}
        <span className="ml-auto">
          <Link
            href={qs({ type, archived: showArchived ? undefined : "1", q: query })}
            className="text-sm text-muted-foreground link-quiet"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {locations.map((l) => (
          <LinkCard
            key={l.id}
            href={`/locations/${l.id}`}
            cardClassName={l.archivedAt ? "opacity-70" : undefined}
          >
            <CardHeader>
              <CardTitle>
                {l.name}
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
          </LinkCard>
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
