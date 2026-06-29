import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { todayUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

// Resolves the trip's "current" day and redirects to its single-day view.
// Picks the day whose date is today; before the trip → first day, after → last.
// Falls back to the overview when the trip has no days.
export default async function TripTodayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      days: {
        orderBy: { dayIndex: "asc" },
        select: { id: true, date: true },
      },
    },
  });
  if (!trip) notFound();
  if (trip.days.length === 0) redirect(`/trips/${id}`);

  const today = todayUtc().getTime();
  const dated = trip.days.filter((d) => d.date != null);

  // Exact date match → that day. Otherwise clamp to the trip span: before the
  // first dated day → first; after the last → last. Undated trips → first day.
  let target = trip.days[0];
  const exact = dated.find((d) => d.date!.getTime() === today);
  if (exact) {
    target = exact;
  } else if (dated.length > 0) {
    const last = dated[dated.length - 1];
    if (today > last.date!.getTime()) target = last;
    else target = dated[0];
  }

  redirect(`/trips/${id}/days/${target.id}`);
}
