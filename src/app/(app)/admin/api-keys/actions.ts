"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { z } from "zod";
import {
  generateApiKey,
} from "@/lib/api-keys";

// Zod schema for creating an API key.
const createApiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  tripTypeIds: z
    .string()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string())),
});

export interface CreateApiKeyResult extends FormState {
  key?: string; // Full key (shown only once)
  prefix?: string;
}

/**
 * Create a new API key.
 * Returns the full key only this once; never again.
 * Caller should display the full key and advise the user to copy it.
 */
export async function createApiKey(
  _prev: FormState,
  formData: FormData,
): Promise<CreateApiKeyResult> {
  await assertRole("ADMIN");

  const parsed = createApiKeySchema.safeParse({
    name: formData.get("name"),
    tripTypeIds: formData.get("tripTypeIds") || "",
  });
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, tripTypeIds } = parsed.data;

  // Generate a new key.
  const { key, prefix, keyHash } = generateApiKey();

  try {
    await prisma.apiKey.create({
      data: {
        name,
        prefix,
        keyHash,
        tripTypeIds,
      },
    });
  } catch (e) {
    // Collision on keyHash should never happen (1 in 2^256), but be safe.
    throw e;
  }

  revalidatePath("/admin/api-keys");
  return {
    ok: true,
    message: "API key created. Copy the key below now — it will never be shown again.",
    key,
    prefix,
  };
}

/**
 * Revoke an API key by ID.
 */
export async function revokeApiKey(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");

  const keyId = formData.get("keyId") as string;
  if (!keyId) return { error: "Key ID is required." };

  try {
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Record to update not found")) {
      return { error: "API key not found." };
    }
    throw e;
  }

  revalidatePath("/admin/api-keys");
  return { ok: true, message: "API key revoked." };
}

/**
 * Delete an API key by ID (hard delete; use revoke if you want history).
 * Not exposed in the UI by default, but available for cleanup.
 */
export async function deleteApiKey(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");

  const keyId = formData.get("keyId") as string;
  if (!keyId) return { error: "Key ID is required." };

  try {
    await prisma.apiKey.delete({
      where: { id: keyId },
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Record to delete not found")) {
      return { error: "API key not found." };
    }
    throw e;
  }

  revalidatePath("/admin/api-keys");
  return { ok: true, message: "API key deleted." };
}
