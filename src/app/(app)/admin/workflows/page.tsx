import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { WorkflowsManager } from "./workflows-manager";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  await requireRole("ADMIN");

  const workflows = await prisma.bookingWorkflow.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      steps: { orderBy: { sortOrder: "asc" } },
      _count: { select: { bookings: true, defaultForLocations: true } },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Booking workflows</h1>
      <WorkflowsManager
        workflows={workflows.map((w) => ({
          id: w.id,
          name: w.name,
          isDefault: w.isDefault,
          bookingCount: w._count.bookings,
          locationCount: w._count.defaultForLocations,
          steps: w.steps.map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status === "CONFIRMED" ? "CONFIRMED" : "IN_PROGRESS",
            actor: s.actor,
            dueOffsetValue: s.dueOffsetValue,
            dueOffsetUnit: s.dueOffsetUnit,
          })),
        }))}
      />
    </div>
  );
}
