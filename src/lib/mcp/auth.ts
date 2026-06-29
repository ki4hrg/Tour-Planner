import { SignJWT, jwtVerify } from "jose";
import { randomBytes, createHash } from "crypto";
import type { SessionUser } from "@/lib/authz";
import type { Role } from "@prisma/client";

const ISSUER = "tour-planner";
const AUDIENCE = "tour-planner-mcp";

// Access tokens are short-lived so that a revoked session (refresh token) stops
// granting access quickly even though the JWT itself is self-contained and never
// checked against the database on the MCP hot path.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const ACCESS_TOKEN_TTL = `${ACCESS_TOKEN_TTL_SECONDS}s`;

// Refresh tokens are long-lived and rotated on every use.
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecret() {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export function scopesForRole(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "mcp:read mcp:write mcp:admin";
    case "PLANNER":
      return "mcp:read mcp:write";
    default:
      return "mcp:read";
  }
}

export async function createAccessToken(
  user: {
    id: string;
    email: string;
    role: Role;
  },
  // The refresh-token (session) id this access token belongs to. Embedded as
  // `sid` so the revocation endpoint can map an access token back to its session.
  sessionId?: string,
): Promise<string> {
  const scope = scopesForRole(user.role);
  const claims: Record<string, unknown> = {
    email: user.email,
    role: user.role,
    scope,
  };
  if (sessionId) claims.sid = sessionId;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

export type McpTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  scope: string;
  sid?: string;
};

// Opaque refresh token: 32 random bytes, base64url-encoded. Returned to the
// client once; only its SHA-256 hash is persisted.
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyAccessToken(
  token: string,
): Promise<McpTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      !payload.sub ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.scope !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role as Role,
      scope: payload.scope,
      sid: typeof payload.sid === "string" ? payload.sid : undefined,
    };
  } catch {
    return null;
  }
}

export async function getMcpUser(
  request: Request,
): Promise<SessionUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const payload = await verifyAccessToken(token);
  if (!payload) return null;
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}

export function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
): boolean {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  // Use synchronous Web Crypto for S256 PKCE verification
  return crypto.subtle
    .digest("SHA-256", data)
    .then((hash) => {
      const base64url = Buffer.from(hash)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return base64url === codeChallenge;
    }) as unknown as boolean;
}

export async function verifyCodeChallengeAsync(
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> {
  const data = new TextEncoder().encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const base64url = Buffer.from(hash)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64url === codeChallenge;
}

export function getBaseUrl(): string {
  return process.env.AUTH_URL || "http://localhost:3076";
}
