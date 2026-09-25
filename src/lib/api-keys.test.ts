import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  keyCanReadTrip,
} from "./api-keys";
import { prisma } from "@/lib/db";

// Mock prisma for integration tests; keep pure functions pure.
vi.mock("@/lib/db", () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("generateApiKey", () => {
  it("generates a key starting with tpk_", () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^tpk_/);
  });

  it("generates a prefix with tpk_ + 8 random chars", () => {
    const { key, prefix } = generateApiKey();
    expect(prefix).toBe(key.substring(0, 12)); // "tpk_" (4) + 8
    expect(prefix.length).toBe(12);
  });

  it("generates unique keys on each call", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.key).not.toBe(key2.key);
    expect(key1.keyHash).not.toBe(key2.keyHash);
  });

  it("produces a valid hash", () => {
    const { key, keyHash } = generateApiKey();
    const rehashedKey = hashApiKey(key);
    expect(keyHash).toBe(rehashedKey);
  });
});

describe("hashApiKey", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashApiKey("tpk_test");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces deterministic output", () => {
    const hash1 = hashApiKey("tpk_test");
    const hash2 = hashApiKey("tpk_test");
    expect(hash1).toBe(hash2);
  });

  it("is sensitive to input changes", () => {
    const hash1 = hashApiKey("tpk_test1");
    const hash2 = hashApiKey("tpk_test2");
    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for missing header", async () => {
    const result = await verifyApiKey(undefined);
    expect(result).toBeNull();
  });

  it("returns null for missing Bearer prefix", async () => {
    const result = await verifyApiKey("Basic abc123");
    expect(result).toBeNull();
  });

  it("returns null for malformed header", async () => {
    const result = await verifyApiKey("Bearer");
    expect(result).toBeNull();
  });

  it("returns null when key not found in DB", async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);
    const result = await verifyApiKey("Bearer tpk_test");
    expect(result).toBeNull();
  });

  it("returns null when key is revoked", async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      id: "key1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: new Date(),
    });
    const result = await verifyApiKey("Bearer tpk_test");
    expect(result).toBeNull();
  });

  it("returns the ApiKey when valid and active", async () => {
    const mockKey = {
      id: "key1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
    };
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockKey);
    const result = await verifyApiKey("Bearer tpk_test");
    expect(result).toEqual(mockKey);
  });

  it("updates lastUsedAt when enough time has passed", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const mockKey = {
      id: "key1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: oneHourAgo,
    };
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockKey);

    await verifyApiKey("Bearer tpk_test");

    expect(vi.mocked(prisma.apiKey.update)).toHaveBeenCalledWith({
      where: { id: "key1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("does not update lastUsedAt within a minute", async () => {
    const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
    const mockKey = {
      id: "key1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: tenSecondsAgo,
    };
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockKey);

    await verifyApiKey("Bearer tpk_test");

    expect(vi.mocked(prisma.apiKey.update)).not.toHaveBeenCalled();
  });

  it("handles Bearer header case-insensitively", async () => {
    const mockKey = {
      id: "key1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
    };
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(mockKey);
    const result = await verifyApiKey("bearer tpk_test");
    expect(result).toEqual(mockKey);
  });
});

describe("keyCanReadTrip", () => {
  it("returns false when key is null", async () => {
    const result = await keyCanReadTrip(null, { tripTypeId: "type1" });
    expect(result).toBe(false);
  });

  it("returns false when key is revoked", async () => {
    const key = {
      id: "k1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: new Date(),
    };
    const result = await keyCanReadTrip(key, { tripTypeId: "type1" });
    expect(result).toBe(false);
  });

  it("returns true when key has no trip-type scope", async () => {
    const key = {
      id: "k1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: [],
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    const result = await keyCanReadTrip(key, { tripTypeId: "type1" });
    expect(result).toBe(true);
  });

  it("returns true when trip type is in key scope", async () => {
    const key = {
      id: "k1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: ["type1", "type2"],
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    const result = await keyCanReadTrip(key, { tripTypeId: "type1" });
    expect(result).toBe(true);
  });

  it("returns false when trip type is not in key scope", async () => {
    const key = {
      id: "k1",
      name: "test",
      prefix: "tpk_",
      keyHash: "hash",
      tripTypeIds: ["type1"],
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };
    const result = await keyCanReadTrip(key, { tripTypeId: "type2" });
    expect(result).toBe(false);
  });
});
