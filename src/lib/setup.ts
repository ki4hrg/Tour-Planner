import { prisma } from "@/lib/db";

/**
 * True when the instance has no users yet — the app should route to the
 * first-run /setup flow instead of /login.
 */
export async function needsSetup(): Promise<boolean> {
  const count = await prisma.user.count();
  return count === 0;
}
