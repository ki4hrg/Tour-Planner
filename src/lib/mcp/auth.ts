import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "@/lib/authz";
import type { Role } from "@prisma/client";

const ISSUER = "tour-planner";
const AUDIENCE = "tour-planner-mcp";
const TOKEN_TTL = "1h";

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

export async function createAccessToken(user: {
  id: string;
  email: string;
  role: Role;
}): Promise<string> {
  const scope = scopesForRole(user.role);
  return new SignJWT({ email: user.email, role: user.role, scope })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());
}

export type McpTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  scope: string;
};

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
