import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TripDocumentsHub } from "../../../documents/trip-documents-hub";

export const dynamic = "force-dynamic";

// The trip's paperwork, one tab: every file filed against the trip, its venue
// engagements, its item bookings and its stays (TripDocumentsHub).
export default async function TripDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canEdit = hasRole(user.role, "PLANNER");
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!trip) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <TripDocumentsHub tripId={trip.id} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
