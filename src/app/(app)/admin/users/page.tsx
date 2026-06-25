import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { UsersManager } from "./users-manager";

export default async function AdminUsersPage() {
  const current = await requireRole("ADMIN");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Create accounts and reset passwords. No self-service email reset in
          v1 — passwords are set here.
        </p>
      </div>
      <UsersManager
        users={users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
        }))}
        currentUserId={current.id}
      />
    </div>
  );
}
