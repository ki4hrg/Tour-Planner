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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; archived?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { type, archived } = await searchParams;
  const showArchived = archived === "1";

  const where: Prisma.SiteWhereInput = {
    archivedAt: showArchived ? { not: null } : null,
    ...(type ? { tripTypes: { some: { id: type } } } : {}),
  };

  const [sites, tripTypes] = await Promise.all([
    prisma.site.findMany({
      where,
      orderBy: { name: "asc" },
      include: { tripTypes: { select: { id: true, name: true, color: true } } },
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
    const s = sp.toString();
    return s ? `/sites?${s}` : "/sites";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sites</h1>
          <p className="text-sm text-muted-foreground">
            The global site library. Filter by trip type.
          </p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href="/sites/new">New site</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={qs({ archived: showArchived ? "1" : undefined })}
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
            href={qs({ type: t.id, archived: showArchived ? "1" : undefined })}
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
            href={qs({ type, archived: showArchived ? undefined : "1" })}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {showArchived ? "← Active sites" : "Show archived"}
          </Link>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sites.map((s) => (
          <Card key={s.id} className={s.archivedAt ? "opacity-70" : undefined}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/sites/${s.id}`} className="hover:underline">
                  {s.name}
                </Link>
                {s.archivedAt ? (
                  <Badge variant="outline" className="ml-2 align-middle">
                    archived
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {s.region ? <p>{s.region}</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {s.tripTypes.map((t) => (
                  <Badge key={t.id} variant="secondary">
                    {t.name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showArchived ? "No archived sites." : "No sites yet."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
