import Link from "next/link";
import { notFound } from "next/navigation";
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
import { EditableSection } from "@/components/editable-section";
import { PresentationForm } from "../presentation-form";
import {
  updatePresentation,
  deletePresentation,
  unarchivePresentation,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function PresentationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const presentation = await prisma.presentation.findUnique({
    where: { id },
    include: {
      defaultPresenters: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });
  if (!presentation) notFound();

  const allContacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {presentation.title}
          {presentation.archivedAt ? (
            <Badge variant="outline" className="ml-2 align-middle">
              archived
            </Badge>
          ) : null}
        </h1>
        <Link
          href="/presentations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All presentations
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditableSection
            canEdit={canEdit}
            view={
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Duration</dt>
                <dd>
                  {presentation.durationMinutes
                    ? `${presentation.durationMinutes} minutes`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="whitespace-pre-wrap">
                  {presentation.description ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">
                  {presentation.notes ?? "—"}
                </dd>
              </dl>
            }
          >
            <PresentationForm
              action={updatePresentation}
              submitLabel="Save changes"
              initial={{
                id: presentation.id,
                title: presentation.title,
                description: presentation.description,
                notes: presentation.notes,
                durationMinutes: presentation.durationMinutes,
                defaultPresenterIds: presentation.defaultPresenters.map(
                  (c) => c.id,
                ),
              }}
              contacts={allContacts}
            />
          </EditableSection>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Default presenters ({presentation.defaultPresenters.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {presentation.defaultPresenters.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {presentation.defaultPresenters.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="hover:underline"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No default presenters.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Scheduled in <strong>{presentation._count.items}</strong> trip
            item{presentation._count.items === 1 ? "" : "s"}.
          </p>
        </CardContent>
      </Card>

      {canEdit ? (
        <>
          {presentation.archivedAt ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Archived</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={unarchivePresentation}>
                  <input type="hidden" name="id" value={presentation.id} />
                  <Button type="submit" variant="outline">
                    Unarchive
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                Danger zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                {presentation._count.items > 0
                  ? `Used by ${presentation._count.items} item(s); archives instead of deleting.`
                  : "Permanently deletes."}
              </p>
              <form action={deletePresentation}>
                <input type="hidden" name="id" value={presentation.id} />
                <Button type="submit" variant="destructive">
                  {presentation._count.items > 0 ? "Archive" : "Delete"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
