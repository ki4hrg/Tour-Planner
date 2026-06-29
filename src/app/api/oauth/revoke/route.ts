import { prisma } from "@/lib/db";
import { hashToken, verifyAccessToken } from "@/lib/mcp/auth";

// RFC 7009 — OAuth 2.0 Token Revocation.
// Revokes a session (refresh-token family). A caller may present either the
// refresh token itself or an access token (whose `sid` claim points at the
// session). Per the spec we respond 200 even for unknown/already-revoked tokens
// so callers can't probe which tokens exist. Access tokens are self-contained
// JWTs, so a revoked one keeps working until it expires (<= 15 min); revoking
// here stops the session from minting any further access tokens immediately.

async function revokeFamily(familyId: string) {
  await prisma.oAuthRefreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeToken(token: string, hint: string | null) {
  // When the hint says access_token, skip the refresh-token lookup.
  if (hint !== "access_token") {
    const stored = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (stored) {
      await revokeFamily(stored.familyId);
      return;
    }
  }

  // Fall back to treating it as an access token: decode and revoke its session.
  const payload = await verifyAccessToken(token);
  if (payload?.sid) {
    const session = await prisma.oAuthRefreshToken.findUnique({
      where: { id: payload.sid },
    });
    if (session) await revokeFamily(session.familyId);
  }
}

export async function POST(request: Request) {
  let params: URLSearchParams;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else if (contentType.includes("application/json")) {
    const body = await request.json();
    params = new URLSearchParams(body as Record<string, string>);
  } else {
    return Response.json(
      { error: "invalid_request", error_description: "Unsupported content type." },
      { status: 400 },
    );
  }

  const token = params.get("token");
  if (!token) {
    return Response.json(
      { error: "invalid_request", error_description: "Missing token." },
      { status: 400 },
    );
  }

  await revokeToken(token, params.get("token_type_hint"));

  // Always 200, regardless of whether the token existed (RFC 7009 §2.2).
  return new Response(null, { status: 200 });
}
