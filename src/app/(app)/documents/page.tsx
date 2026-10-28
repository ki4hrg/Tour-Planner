import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import {
  DOCUMENT_SELECT,
  documentHref,
  documentTarget,
  formatFileSize,
} from "@/lib/documents";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  type DocumentKindValue,
} from "@/lib/validators/document";
import { SHARE_AUDIENCE_LABELS } from "@/lib/share";

export const dynamic = "force-dynamic";

// The relations `documentTarget` needs to say where a file is filed.
const TARGET_SELECT = {
  location: { select: { id: true, name: true } },
  booking: {
    select: {
      label: true,
      locationId: true,
      location: { select: { name: true } },
      trip: { select: { id: true, name: true } },
      scheduleItem: {
        select: { day: { select: { trip: { select: { id: true, name: true } } } } },
      },
    },
  },
  trip: { select: { id: true, name: true } },
  stay: {
    select: {
      id: true,
      trip: { select: { id: true, name: true } },
      location: { select: { name: true } },
    },
  },
} as const;

/**
 * The whole file library in one list. Individual panels (trip, venue, booking)
 * are where files get filed; this is where you go when you know a contract
 * exists but not which venue it was filed under.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  await requireUser();
  const { kind, q } = await searchParams;
  const query = q?.trim() || undefined;
  const kindFilter = DOCUMENT_KINDS.includes(kind as DocumentKindValue)
    ? (kind as DocumentKindValue)
    : undefined;

  const where: Prisma.DocumentWhereInput = {
    ...(kindFilter ? { kind: kindFilter } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { filename: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const documents = await prisma.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { ...DOCUMENT_SELECT, ...TARGET_SELECT },
  });

  const qs = (params: { kind?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params.kind) sp.set("kind", params.kind);
    if (params.q) sp.set("q", params.q);
    const s = sp.toString();
    return s ? `/documents?${s}` : "/documents";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Documents</h1>

      <form className="flex max-w-sm gap-2" action="/documents">
        {kindFilter ? (
          <input type="hidden" name="kind" value={kindFilter} />
        ) : null}
        <Input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search…"
          aria-label="Search documents"
          className="flex-1"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={qs({ q: query })}
          className={cn(
            "rounded-full border px-3 py-1 focus-ring",
            !kindFilter && "bg-muted font-medium",
          )}
        >
          All
        </Link>
        {DOCUMENT_KINDS.map((k) => (
          <Link
            key={k}
            href={qs({ kind: k, q: query })}
            className={cn(
              "rounded-full border px-3 py-1 focus-ring",
              kindFilter === k && "bg-muted font-medium",
            )}
          >
            {DOCUMENT_KIND_LABELS[k]}
          </Link>
        ))}
      </div>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {query || kindFilter
              ? "No documents match."
              : "No documents."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => {
            const target = documentTarget(doc);
            return (
              <li key={doc.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <a
                    href={documentHref(doc.id)}
                    className="font-medium link-quiet"
                  >
                    {doc.title}
                  </a>
                  <Link
                    href={target.href}
                    className="text-xs text-muted-foreground link-quiet"
                  >
                    {target.label}
                  </Link>
                </div>
                {doc.description ? (
                  <p className="mt-1 text-muted-foreground">{doc.description}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                    {DOCUMENT_KIND_LABELS[doc.kind]}
                  </span>
                  <span>{formatFileSize(doc.size)}</span>
                  <span className="truncate">· {doc.filename}</span>
                  <span>
                    · {doc.uploadedBy?.name ?? "Unknown"},{" "}
                    {formatDate(doc.createdAt.toISOString().slice(0, 10))}
                  </span>
                  {doc.shareAudiences.map((a) => (
                    <span
                      key={a}
                      className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                    >
                      Shared: {SHARE_AUDIENCE_LABELS[a]}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {documents.length === 200 ? (
        <p className="text-xs text-muted-foreground">
          Showing 200 most recent.
        </p>
      ) : null}
    </div>
  );
}
