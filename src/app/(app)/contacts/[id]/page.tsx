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
import { ContactLocationsManager } from "../contact-locations-manager";
import { MergeContactPanel } from "../merge-contact-panel";

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
        select: { id: true, name: true, region: { select: { name: true } } },
      },
      primaryForLocations: { select: { id: true } },
    },
  });
  if (!contact) notFound();

  const linkedIds = new Set(contact.locations.map((l) => l.id));
  // Link picker: live locations not linked yet. Merge picker: every other
  // contact.
  const [availableLocations, mergeCandidates] = canEdit
    ? await Promise.all([
        prisma.location.findMany({
          where: { archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, region: { select: { name: true } } },
        }),
        prisma.contact.findMany({
          where: { id: { not: id } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, organization: true },
        }),
      ])
    : [[], []];

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
          <CardTitle>Details</CardTitle>
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
                    <a
                      href={`mailto:${contact.email}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-quiet"
                    >
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
          <CardTitle>
            Locations served ({contact.locations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ContactLocationsManager
            contactId={contact.id}
            linked={contact.locations.map((l) => ({
              id: l.id,
              name: l.name,
              region: l.region?.name ?? null,
            }))}
            available={availableLocations
              .filter((l) => !linkedIds.has(l.id))
              .map((l) => ({
                id: l.id,
                name: l.name,
                detail: l.region?.name ?? null,
              }))}
            primaryForIds={contact.primaryForLocations.map((l) => l.id)}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">
              Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <div className="border-t pt-4">
              <MergeContactPanel
                contactId={contact.id}
                contactName={contact.name}
                candidates={mergeCandidates.map((c) => ({
                  id: c.id,
                  name: c.name,
                  detail: c.organization,
                }))}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
