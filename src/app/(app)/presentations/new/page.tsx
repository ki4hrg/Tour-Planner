import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PresentationForm } from "../presentation-form";
import { createPresentation } from "../actions";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

export default async function NewPresentationPage() {
  await requireRole("PLANNER");
  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/presentations" label="All presentations" />
        <h1 className="text-2xl font-semibold">New presentation</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <PresentationForm
            action={createPresentation}
            submitLabel="Create presentation"
            contacts={contacts}
          />
        </CardContent>
      </Card>
    </div>
  );
}
