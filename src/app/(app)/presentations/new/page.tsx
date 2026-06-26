import Link from "next/link";
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

export const dynamic = "force-dynamic";

export default async function NewPresentationPage() {
  await requireRole("PLANNER");
  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New presentation</h1>
        <Link
          href="/presentations"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← All presentations
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Presentation details</CardTitle>
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
