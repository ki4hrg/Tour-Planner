import { requireUser } from "@/lib/authz";
import { AppNav } from "@/components/app-nav";
import { OfflineBanner } from "@/components/offline-banner";
import { BookingWorkflowsProvider } from "@/components/booking-workflows";
import { prisma } from "@/lib/db";
import { WORKFLOW_STEP_SELECT } from "@/lib/booking-workflow";

// Authenticated shell. Middleware already gates these routes; we re-check here
// so Server Components in this group can rely on a present session.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Small admin catalog every booking status control reads (see provider).
  const workflows = await prisma.bookingWorkflow.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      steps: {
        orderBy: { sortOrder: "asc" },
        select: WORKFLOW_STEP_SELECT,
      },
    },
  });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <OfflineBanner />
      <AppNav user={user} />
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 print:max-w-none print:p-0">
        <BookingWorkflowsProvider workflows={workflows}>
          {children}
        </BookingWorkflowsProvider>
      </div>
    </div>
  );
}
