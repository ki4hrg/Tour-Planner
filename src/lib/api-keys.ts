// API key management for server-to-server export access.
// Keys are opaque tpk_* tokens; staff only sees prefix + hash.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import type { ApiKey } from "@prisma/client";

// Prefix for all API keys, followed by 32 bytes of random base64url-encoded data.
const KEY_PREFIX = "tpk_";
const KEY_RANDOM_BYTES = 32;

export interface GeneratedKey {
  key: string; // Full key (tpk_...), shown only once at creation
  prefix: string; // First 8 chars after prefix (shown in UI)
  keyHash: string; // SHA-256 hex digest (stored in DB)
}

/**
 * Generate a new API key and its hash for storage.
 * The key is shown to the user only once; the prefix and hash are stored.
 */
export function generateApiKey(): GeneratedKey {
  const random = randomBytes(KEY_RANDOM_BYTES).toString("base64url");
  const key = `${KEY_PREFIX}${random}`;
  const keyHash = hashApiKey(key);
  const prefix = key.substring(0, KEY_PREFIX.length + 8); // "tpk_" + 8 chars
  return { key, prefix, keyHash };
}

/**
 * SHA-256 hash of a key (for storage).
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Verify and decode an "Authorization: Bearer tpk_..." header.
 * Returns the ApiKey record if valid and active, null otherwise.
 * Updates lastUsedAt at most once per minute (prevents excessive writes).
 */
export async function verifyApiKey(
  authorizationHeader: string | undefined,
): Promise<ApiKey | null> {
  if (!authorizationHeader) return null;

  const match = authorizationHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  const key = match[1];
  const keyHash = hashApiKey(key);

  // Look up by SHA-256 of the presented key. The plaintext is never stored or
  // compared, so there's no secret-dependent string comparison to time.
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!apiKey || apiKey.revokedAt) return null;

  // Update lastUsedAt at most once per minute to avoid excessive writes.
  const now = new Date();
  const lastUsed = apiKey.lastUsedAt ? apiKey.lastUsedAt.getTime() : 0;
  if (now.getTime() - lastUsed > 60 * 1000) {
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: now },
    });
  }

  return apiKey;
}

/**
 * Check if a key can read a given trip.
 * Returns true if:
 * - The key has no trip-type scope (empty tripTypeIds), OR
 * - The trip's tripTypeId is in the key's tripTypeIds.
 */
export async function keyCanReadTrip(
  apiKey: ApiKey | null,
  trip: { tripTypeId: string },
): Promise<boolean> {
  if (!apiKey || apiKey.revokedAt) return false;
  if (apiKey.tripTypeIds.length === 0) return true; // No scope = all trip types
  return apiKey.tripTypeIds.includes(trip.tripTypeId);
}
