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
import { ContactForm } from "./contact-form";
import { createContact } from "./actions";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");

  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          A reusable directory. A contact can serve several sites.
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Directory ({contacts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/contacts/${c.id}`}
                  className="font-medium hover:underline"
                >
                  {c.name}
                </Link>
                <div className="truncate text-sm text-muted-foreground">
                  {[c.role, c.organization].filter(Boolean).join(" · ")}
                  {c.email ? ` · ${c.email}` : ""}
                  {c.phone ? ` · ${c.phone}` : ""}
                </div>
              </div>
              <Badge variant="outline">{c._count.sites} sites</Badge>
            </div>
          ))}
          {contacts.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No contacts yet.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
