"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import {
  createUserSchema,
  resetPasswordSchema,
  updateRoleSchema,
} from "@/lib/validators/user";

export async function createUser(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { email, name, password, role } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.user.create({
      data: { email, name: name || null, passwordHash, role },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw e;
  }

  revalidatePath("/admin/users");
  return { ok: true, message: `Created ${email}.` };
}

export async function resetUserPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { passwordHash },
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "Password reset." };
}

export async function updateUserRole(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const current = await assertRole("ADMIN");

  const parsed = updateRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  // Don't let an admin demote themselves (avoid locking out the last admin).
  if (parsed.data.userId === current.id && parsed.data.role !== "ADMIN") {
    return { error: "You cannot change your own admin role." };
  }

  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { role: parsed.data.role },
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "Role updated." };
}

export async function deleteUser(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const current = await assertRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing user." };

  if (userId === current.id) {
    return { error: "You cannot delete your own account." };
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
  return { ok: true, message: "User deleted." };
}
