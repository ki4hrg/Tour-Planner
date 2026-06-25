import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
};

// Role hierarchy: ADMIN ⊃ PLANNER ⊃ VIEWER.
const RANK: Record<Role, number> = {
  VIEWER: 0,
  PLANNER: 1,
  ADMIN: 2,
};

export function hasRole(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name,
    role: session.user.role,
  };
}

/** Redirects to /login if there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Ensures the current user meets a minimum role. Use in Server Components for
 * page-level gating and at the top of every mutating Server Action.
 */
export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.role, minimum)) {
    // VIEWERs (and PLANNERs hitting admin) get bounced home.
    redirect("/");
  }
  return user;
}

/** Throws instead of redirecting — for use inside Server Actions. */
export async function assertRole(minimum: Role): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.role, minimum)) {
    throw new Error("Not authorized.");
  }
  return user;
}
