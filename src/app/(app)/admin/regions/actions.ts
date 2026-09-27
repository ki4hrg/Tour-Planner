"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertRole } from "@/lib/authz";
import { type FormState, zodErrorMessage } from "@/lib/forms";
import { regionSchema } from "@/lib/validators/region";

function parse(formData: FormData) {
  return regionSchema.safeParse({
    name: formData.get("name"),
    parentId: formData.get("parentId") || undefined,
    tripTypeIds: formData.getAll("tripTypeIds").map(String),
    dialCode: formData.get("dialCode") ?? undefined,
  });
}

// Would setting `parentId` as the parent of `regionId` create a cycle? True when
// the proposed parent is the region itself or one of its descendants (walk up
// from the proposed parent; hitting regionId means it sits below it).
async function wouldCycle(
  regionId: string,
  parentId: string,
): Promise<boolean> {
  if (parentId === regionId) return true;
  const all = await prisma.region.findMany({
    select: { id: true, parentId: true },
  });
  const parentOf = new Map(all.map((r) => [r.id, r.parentId]));
  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === regionId) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

export async function createRegion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, parentId, tripTypeIds, dialCode } = parsed.data;
  try {
    await prisma.region.create({
      data: {
        name,
        dialCode: dialCode ?? null,
        ...(parentId ? { parent: { connect: { id: parentId } } } : {}),
        tripTypes: { connect: (tripTypeIds ?? []).map((id) => ({ id })) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That name is already used here." };
    }
    throw e;
  }

  revalidatePath("/admin/regions");
  revalidatePath("/locations");
  return { ok: true, message: `Created ${name}.` };
}

export async function updateRegion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing region." };

  const parsed = parse(formData);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error) };

  const { name, parentId, tripTypeIds, dialCode } = parsed.data;
  if (parentId && (await wouldCycle(id, parentId))) {
    return { error: "A region can't be its own parent or descendant." };
  }

  try {
    await prisma.region.update({
      where: { id },
      data: {
        name,
        dialCode: dialCode ?? null,
        parent: parentId
          ? { connect: { id: parentId } }
          : { disconnect: true },
        tripTypes: { set: (tripTypeIds ?? []).map((tid) => ({ id: tid })) },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "That name is already used here." };
    }
    throw e;
  }

  revalidatePath("/admin/regions");
  revalidatePath("/locations");
  return { ok: true, message: "Saved." };
}

export async function deleteRegion(formData: FormData): Promise<void> {
  await assertRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // onDelete SetNull: child regions re-parent to root, locations lose the tag.
  await prisma.region.delete({ where: { id } });
  revalidatePath("/admin/regions");
  revalidatePath("/locations");
}
