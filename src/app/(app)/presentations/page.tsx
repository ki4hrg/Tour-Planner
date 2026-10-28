import Link from "next/link";
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

export const dynamic = "force-dynamic";

export default async function PresentationsPage() {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");

  const presentations = await prisma.presentation.findMany({
    where: { archivedAt: null },
    orderBy: { title: "asc" },
    include: {
      defaultPresenters: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Presentations</h1>
        {canEdit ? (
          <Button asChild>
            <Link href="/presentations/new">New presentation</Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Talks ({presentations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {presentations.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              {/* The row's text block is the link; the badge stays outside it. */}
              <Link
                href={`/presentations/${p.id}`}
                className="block min-w-0 flex-1 rounded-md focus-ring"
              >
                <span className="font-medium link-quiet">{p.title}</span>
                {p.description && (
                  <span className="block truncate text-sm text-muted-foreground">
                    {p.description}
                  </span>
                )}
                {p.defaultPresenters.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {p.defaultPresenters.map((c) => c.name).join(", ")}
                  </span>
                )}
              </Link>
              <div className="flex gap-2">
                <Badge variant="outline">{p._count.items} uses</Badge>
              </div>
            </div>
          ))}
          {presentations.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No presentations.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
