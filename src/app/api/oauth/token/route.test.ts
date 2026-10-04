import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import { prisma } from "@/lib/db";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_GRACE_SECONDS,
} from "@/lib/mcp/auth";

// Mock prisma database for isolation
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    oAuthRefreshToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock auth functions that depend on environment
vi.mock("@/lib/mcp/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  return {
    ...actual,
    createAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  };
});

// Helper to create a request with URLSearchParams body
function createRequest(body: Record<string, string>) {
  const params = new URLSearchParams(body);
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

async function parseJsonResponse(response: Response) {
  return response.json();
}

describe("POST /api/oauth/token - refresh_token grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("grace window logic", () => {
    it("returns fresh tokens when retry occurs within grace window with unused successor", async () => {
      const now = Date.now();
      const rawToken1 = generateRefreshToken();
      const rawToken2 = generateRefreshToken();

      const token1 = {
        id: "token-1",
        tokenHash: hashToken(rawToken1),
        familyId: "family-1",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 30_000), // 30 seconds ago
        replacedById: "token-2",
        createdAt: new Date(),
      };

      const token2 = {
        id: "token-2",
        tokenHash: hashToken(rawToken2),
        familyId: "family-1",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      const user: { id: string; email: string; role: "VIEWER" } = {
        id: "user-1",
        email: "test@example.com",
        role: "VIEWER",
      };

      const newToken1 = {
        id: "token-3",
        tokenHash: "newhash1",
        familyId: "family-1",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique)
        .mockResolvedValueOnce(token1) // First call for stored token
        .mockResolvedValueOnce(token2); // Second call for successor check

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user as any);

      vi.mocked(prisma.oAuthRefreshToken.create).mockResolvedValueOnce(newToken1);

      vi.mocked(prisma.oAuthRefreshToken.update).mockResolvedValueOnce({
        ...newToken1,
        id: "token-3",
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken1,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const body = await parseJsonResponse(response);
      expect(body).toHaveProperty("access_token");
      expect(body).toHaveProperty("refresh_token");
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.scope).toBe("mcp:read");
    });

    it("revokes family when retry occurs after successor has been used", async () => {
      const now = Date.now();
      const rawToken1 = generateRefreshToken();

      const token1 = {
        id: "token-1",
        tokenHash: hashToken(rawToken1),
        familyId: "family-2",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 30_000), // 30 seconds ago
        replacedById: "token-2",
        createdAt: new Date(),
      };

      const successor = {
        id: "token-2",
        tokenHash: "hash2",
        familyId: "family-2",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 20_000), // successor was rotated (used)
        replacedById: "token-3",
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique)
        .mockResolvedValueOnce(token1) // First call for stored token
        .mockResolvedValueOnce(successor); // Second call for successor check

      vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken1,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("revoked");

      // Verify family was revoked
      expect(vi.mocked(prisma.oAuthRefreshToken.updateMany)).toHaveBeenCalled();
    });

    it("revokes family when retry occurs outside grace window", async () => {
      const now = Date.now();
      const rawToken1 = generateRefreshToken();

      const token1 = {
        id: "token-1",
        tokenHash: hashToken(rawToken1),
        familyId: "family-3",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - REFRESH_GRACE_SECONDS * 1000 - 10_000), // outside grace window
        replacedById: "token-2",
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(token1);

      vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken1,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");

      // Verify family was revoked
      expect(vi.mocked(prisma.oAuthRefreshToken.updateMany)).toHaveBeenCalled();
    });

    it("revokes family when it was revoked by user (no replacedById)", async () => {
      const now = Date.now();
      const rawToken1 = generateRefreshToken();

      const token1 = {
        id: "token-1",
        tokenHash: hashToken(rawToken1),
        familyId: "family-4",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 30_000), // 30 seconds ago
        replacedById: null, // explicit revocation, not rotation
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(token1);

      vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken1,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");

      // Verify family was revoked
      expect(vi.mocked(prisma.oAuthRefreshToken.updateMany)).toHaveBeenCalled();
    });

    it("rejects grace retry if successor expired", async () => {
      const now = Date.now();
      const rawToken1 = generateRefreshToken();

      const token1 = {
        id: "token-1",
        tokenHash: hashToken(rawToken1),
        familyId: "family-5",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(now - 30_000), // 30 seconds ago
        replacedById: "token-2",
        createdAt: new Date(),
      };

      const successor = {
        id: "token-2",
        tokenHash: "hash2",
        familyId: "family-5",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now - 1000), // already expired
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique)
        .mockResolvedValueOnce(token1) // First call for stored token
        .mockResolvedValueOnce(successor); // Second call for successor check

      vi.mocked(prisma.oAuthRefreshToken.updateMany).mockResolvedValueOnce({
        count: 1,
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken1,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");

      // Verify family was revoked
      expect(vi.mocked(prisma.oAuthRefreshToken.updateMany)).toHaveBeenCalled();
    });
  });

  describe("normal rotation (no grace window needed)", () => {
    it("successfully rotates a live refresh token", async () => {
      const now = Date.now();
      const rawToken = generateRefreshToken();

      const token = {
        id: "token-1",
        tokenHash: hashToken(rawToken),
        familyId: "family-live",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read mcp:write",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      const user: { id: string; email: string; role: "VIEWER" } = {
        id: "user-1",
        email: "test@example.com",
        role: "VIEWER",
      };

      const newToken = {
        id: "token-2",
        tokenHash: "newhash",
        familyId: "family-live",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read mcp:write",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      // Mock the database calls
      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(user as any);
      vi.mocked(prisma.oAuthRefreshToken.create).mockResolvedValueOnce(newToken);
      vi.mocked(prisma.oAuthRefreshToken.update).mockResolvedValueOnce({
        ...newToken,
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken,
        client_id: "client-1",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const body = await parseJsonResponse(response);
      expect(body).toHaveProperty("access_token");
      expect(body).toHaveProperty("refresh_token");
      expect(body.scope).toBe("mcp:read mcp:write");

      // Verify original token was marked rotated
      expect(vi.mocked(prisma.oAuthRefreshToken.update)).toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("rejects request with missing refresh_token", async () => {
      const request = createRequest({
        grant_type: "refresh_token",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("Missing refresh_token");
    });

    it("rejects unknown refresh_token", async () => {
      // Mock returns null for unknown token
      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(null);

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: "unknown-token",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("Unknown");
    });

    it("rejects expired token", async () => {
      const now = Date.now();
      const rawToken = generateRefreshToken();

      const token = {
        id: "token-1",
        tokenHash: hashToken(rawToken),
        familyId: "family-expired",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now - 1000), // already expired
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(token);
      vi.mocked(prisma.oAuthRefreshToken.update).mockResolvedValueOnce({
        ...token,
        revokedAt: new Date(),
      });

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken,
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("expired");
    });

    it("rejects token with mismatched client_id", async () => {
      const now = Date.now();
      const rawToken = generateRefreshToken();

      const token = {
        id: "token-1",
        tokenHash: hashToken(rawToken),
        familyId: "family-mismatch",
        clientId: "client-1",
        userId: "user-1",
        scope: "mcp:read",
        expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        replacedById: null,
        createdAt: new Date(),
      };

      vi.mocked(prisma.oAuthRefreshToken.findUnique).mockResolvedValueOnce(token);

      const request = createRequest({
        grant_type: "refresh_token",
        refresh_token: rawToken,
        client_id: "different-client",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const body = await parseJsonResponse(response);
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("client_id");
    });
  });
});
