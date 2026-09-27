import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { ApiKeysManager } from "./api-keys-manager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  await requireRole("ADMIN");

  // Load existing API keys and trip types.
  const [keys, tripTypes] = await Promise.all([
    prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        prefix: true,
        tripTypeIds: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tripType.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">API Keys</h1>
      <ApiKeysManager
        keys={keys.map((k) => ({
          ...k,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revokedAt: k.revokedAt?.toISOString() ?? null,
        }))}
        tripTypes={tripTypes}
      />
    </div>
  );
}
