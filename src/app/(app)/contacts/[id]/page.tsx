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
import { ConfirmButton } from "@/components/confirm-dialog";
import { ContactChannels } from "@/components/contact-channels";
import { EditableSection } from "@/components/editable-section";
import { ContactForm } from "../contact-form";
import { updateContact, deleteContact } from "../actions";
import { BackLink } from "@/components/back-link";

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
    include: {
      locations: {
        orderBy: { name: "asc" },
        include: { region: { select: { name: true } } },
      },
    },
  });
  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/contacts" label="All contacts" />
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <ContactChannels phone={contact.phone} email={contact.email} />
        </div>
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
                <dt className="text-muted-foreground">Organization</dt>
                <dd>{contact.organization ?? "—"}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{contact.role ?? "—"}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="link-quiet">
                      {contact.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-muted-foreground">Phone</dt>
                <dd>
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="link-quiet">
                      {contact.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{contact.notes ?? "—"}</dd>
              </dl>
            }
          >
            <ContactForm
              action={updateContact}
              submitLabel="Save"
              initial={contact}
            />
          </EditableSection>
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
                  <Link href={`/locations/${l.id}`} className="link-quiet">
                    {l.name}
                  </Link>
                  {l.region ? (
                    <span className="text-muted-foreground"> · {l.region.name}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No locations.</p>
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
            <form id="delete-contact-form" action={deleteContact}>
              <input type="hidden" name="id" value={contact.id} />
              <ConfirmButton
                formId="delete-contact-form"
                variant="destructive"
                title="Delete contact"
                description="Permanently deletes. Links from locations, bookings and notes are removed."
                confirmLabel="Delete contact"
              >
                Delete contact
              </ConfirmButton>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
