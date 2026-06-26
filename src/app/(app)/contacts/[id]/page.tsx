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
import { Button } from "@/components/ui/button";
import { ContactForm } from "../contact-form";
import { updateContact, deleteContact } from "../actions";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: { locations: { orderBy: { name: "asc" } } },
  });
  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{contact.name}</h1>
        <Link
          href="/contacts"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All contacts
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <ContactForm
              action={updateContact}
              submitLabel="Save changes"
              initial={contact}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Organization</dt>
              <dd>{contact.organization ?? "—"}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{contact.role ?? "—"}</dd>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{contact.email ?? "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{contact.phone ?? "—"}</dd>
              <dt className="text-muted-foreground">Notes</dt>
              <dd>{contact.notes ?? "—"}</dd>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Locations served ({contact.locations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {contact.locations.length ? (
            <ul className="space-y-1">
              {contact.locations.map((l) => (
                <li key={l.id}>
                  <Link href={`/locations/${l.id}`} className="hover:underline">
                    {l.name}
                  </Link>
                  {l.region ? (
                    <span className="text-muted-foreground"> · {l.region}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Not linked to any locations. Link from a location&apos;s page.
            </p>
          )}
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={deleteContact}>
              <input type="hidden" name="id" value={contact.id} />
              <Button type="submit" variant="destructive">
                Delete contact
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
