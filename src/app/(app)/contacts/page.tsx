import Link from "next/link";
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
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ groupBy?: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { groupBy } = await searchParams;
  const isGrouped = groupBy === "location";

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            A reusable directory. A contact can serve several locations.
          </p>
        </div>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a contact</CardTitle>
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
        <Link
          href={qs()}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            !isGrouped ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          Flat
        </Link>
        <Link
          href={qs("location")}
          className={cn(
            "rounded-full border px-3 py-1 text-sm",
            isGrouped ? "bg-muted font-medium" : "text-muted-foreground",
          )}
        >
          By location
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
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
