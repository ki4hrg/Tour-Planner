import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ContactForm } from "./contact-form";
import { createContact } from "./actions";
import { ContactsList } from "./contacts-list";
import { FilterChip } from "@/components/filter-chip";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ groupBy?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { groupBy } = await searchParams;
  // Grouped-by-location is the default view; ?groupBy=flat opts into A–Z.
  const isGrouped = groupBy !== "flat";

  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    include: {
      locations: {
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
      _count: { select: { locations: true } },
    },
  });

  const qs = (groupByVal?: string) => {
    const sp = new URLSearchParams();
    if (groupByVal) sp.set("groupBy", groupByVal);
    const s = sp.toString();
    return s ? `/contacts?${s}` : "/contacts";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Contacts</h1>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>New contact</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactForm
              action={createContact}
              submitLabel="Add contact"
              resetOnSuccess
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href={qs()} active={isGrouped}>
          By location
        </FilterChip>
        <FilterChip href={qs("flat")} active={!isGrouped}>
          Flat
        </FilterChip>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Directory ({contacts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ContactsList contacts={contacts} isGrouped={isGrouped} />
        </CardContent>
      </Card>
    </div>
  );
}
