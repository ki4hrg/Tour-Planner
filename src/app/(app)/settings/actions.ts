"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import type { FormState } from "@/lib/forms";
import { encryptSecret } from "@/lib/crypto";
import { TOUR_PLANNER_LABEL, ensureLabel, listProjects } from "@/lib/todoist";
import { getTodoistAuth } from "@/lib/todoist-sync";

// Personal Todoist settings. Every action operates on the CURRENT user's own
// connection — there is deliberately no way to touch anyone else's.

export async function connectTodoist(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Token required." };

  // Validate the token against the live API before storing anything, and make
  // sure our marker label exists so pushed tasks are filterable.
  try {
    await listProjects(token);
    await ensureLabel(token, TOUR_PLANNER_LABEL);
  } catch {
    return { error: "Todoist rejected that token." };
  }

  await prisma.todoistConnection.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      authType: "PERSONAL_TOKEN",
      accessToken: encryptSecret(token),
    },
    update: {
      authType: "PERSONAL_TOKEN",
      accessToken: encryptSecret(token),
      refreshToken: null,
      expiresAt: null,
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Todoist connected." };
}

export async function disconnectTodoist(): Promise<FormState> {
  const user = await assertRole("PLANNER");
  // Routing links survive a reconnect; only the credentials go.
  await prisma.todoistConnection.deleteMany({ where: { userId: user.id } });
  revalidatePath("/settings");
  return { ok: true, message: "Todoist disconnected." };
}

export async function setDefaultTodoistProject(
  projectId: string | null,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  const updated = await prisma.todoistConnection.updateMany({
    where: { userId: user.id },
    data: { defaultProjectId: projectId },
  });
  if (updated.count === 0) return { error: "Todoist not connected." };
  revalidatePath("/settings");
  return { ok: true, message: "Default project saved." };
}

// Project options for pickers elsewhere (trip page panel). null = not
// connected or Todoist unreachable.
export async function listMyTodoistProjects(): Promise<
  { id: string; name: string }[] | null
> {
  const user = await assertRole("PLANNER");
  const auth = await getTodoistAuth(user.id);
  if (!auth) return null;
  try {
    return (await listProjects(auth.token)).map((p) => ({
      id: p.id,
      name: p.name,
    }));
  } catch {
    return null;
  }
}

export async function setTripTypeTodoistProject(
  tripTypeId: string,
  projectId: string | null,
): Promise<FormState> {
  const user = await assertRole("PLANNER");
  if (projectId) {
    await prisma.tripTypeTodoistLink.upsert({
      where: { userId_tripTypeId: { userId: user.id, tripTypeId } },
      create: { userId: user.id, tripTypeId, todoistProjectId: projectId },
      update: { todoistProjectId: projectId },
    });
  } else {
    await prisma.tripTypeTodoistLink.deleteMany({
      where: { userId: user.id, tripTypeId },
    });
  }
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}
