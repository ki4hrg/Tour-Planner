"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { signIn } from "@/lib/auth";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { firstAdminSchema } from "@/lib/validators/setup";

export async function createFirstAdmin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = firstAdminSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { email, name, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  // Atomically create the first admin only if no users exist yet. This closes
  // the race where two people open /setup simultaneously and prevents the page
  // from ever minting a second admin once setup is done.
  const created = await prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return false;
    await tx.user.create({
      data: { email, name: name || null, passwordHash, role: "ADMIN" },
    });
    return true;
  });

  if (!created) {
    return { error: "Setup already done." };
  }

  // Sign the new admin straight in.
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      // Account exists but auto-login failed — send them to sign in manually.
      redirect("/login");
    }
    throw error; // re-throw the NEXT_REDIRECT on success
  }
}
