import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";
import {
  createAccessToken,
  verifyCodeChallengeAsync,
  generateRefreshToken,
  hashToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_GRACE_SECONDS,
} from "@/lib/mcp/auth";

type IssuedUser = { id: string; email: string; role: Role };

function oauthError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status },
  );
}

// Issue a fresh access + refresh token pair. When `familyId` is omitted the new
// refresh token starts its own rotation family (it adopts its own id as the
// family id); on rotation the caller threads the existing family through.
async function issueTokens(user: IssuedUser, clientId: string, scope: string | null, familyId?: string) {
  const rawRefresh = generateRefreshToken();
  const refresh = await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: hashToken(rawRefresh),
      familyId: familyId ?? "",
      clientId,
      userId: user.id,
      scope,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  if (!familyId) {
    await prisma.oAuthRefreshToken.update({
      where: { id: refresh.id },
      data: { familyId: refresh.id },
    });
  }
  const accessToken = await createAccessToken(user, refresh.id);
  return { accessToken, refreshToken: rawRefresh, refreshId: refresh.id };
}

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  scope: string | null,
) {
  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scope || "",
  });
}

async function handleAuthorizationCode(params: URLSearchParams) {
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");
  const clientId = params.get("client_id");

  if (!code || !redirectUri || !codeVerifier) {
    return oauthError(
      "invalid_request",
      "Missing code, redirect_uri, or code_verifier.",
    );
  }

  const authCode = await prisma.oAuthAuthorizationCode.findUnique({
    where: { code },
  });

  if (!authCode) {
    return oauthError("invalid_grant", "Unknown authorization code.");
  }

  if (authCode.usedAt) {
    // Code replay — revoke by deleting it
    await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });
    return oauthError("invalid_grant", "Authorization code already used.");
  }

  if (authCode.expiresAt < new Date()) {
    await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });
    return oauthError("invalid_grant", "Authorization code expired.");
  }

  if (authCode.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri mismatch.");
  }

  if (clientId && authCode.clientId !== clientId) {
    return oauthError("invalid_grant", "client_id mismatch.");
  }

  const pkceValid = await verifyCodeChallengeAsync(
    codeVerifier,
    authCode.codeChallenge,
  );
  if (!pkceValid) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  // Mark code as used
  await prisma.oAuthAuthorizationCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: authCode.userId },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    return oauthError("invalid_grant", "User no longer exists.");
  }

  const { accessToken, refreshToken } = await issueTokens(
    user,
    authCode.clientId,
    authCode.scope,
  );
  return tokenResponse(accessToken, refreshToken, authCode.scope);
}

async function handleRefreshToken(params: URLSearchParams) {
  const presented = params.get("refresh_token");
  const clientId = params.get("client_id");

  if (!presented) {
    return oauthError("invalid_request", "Missing refresh_token.");
  }

  const stored = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashToken(presented) },
  });

  if (!stored) {
    return oauthError("invalid_grant", "Unknown refresh token.");
  }

  // Reuse detection with grace window for retries.
  // A token that was just rotated (revokedAt + replacedById both set) within the
  // grace window is treated as a benign retry if its successor is still unused.
  // Genuine replay attacks (after grace window or with a used successor) revoke the family.
  if (stored.revokedAt) {
    // Grace window: if rotated moments ago and successor is still unused, issue a pair
    // under the same family instead of revoking (accommodates timeouts, proxy duplicates,
    // concurrent refreshes on unreliable networks).
    const isRotated = stored.replacedById !== null;
    const rotatedAt = stored.revokedAt.getTime();
    const isWithinGraceWindow = Date.now() - rotatedAt < REFRESH_GRACE_SECONDS * 1000;

    if (isRotated && isWithinGraceWindow && stored.replacedById) {
      // Check if the successor token is still live (not revoked, not expired).
      // If it's been used, the second presenter is not the client that used it, so the
      // grant must go regardless of the grace window.
      const successor = await prisma.oAuthRefreshToken.findUnique({
        where: { id: stored.replacedById },
      });

      if (successor && successor.revokedAt === null && successor.expiresAt > new Date()) {
        // Successor is still live and unused — this is a benign retry.
        // Verify client ID and user still exist, then issue a fresh pair in the same family.
        if (clientId && stored.clientId !== clientId) {
          return oauthError("invalid_grant", "client_id mismatch.");
        }

        const user = await prisma.user.findUnique({
          where: { id: stored.userId },
          select: { id: true, email: true, role: true },
        });

        if (!user) {
          // User is gone — revoke the family.
          await prisma.oAuthRefreshToken.updateMany({
            where: { familyId: stored.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return oauthError("invalid_grant", "User no longer exists.");
        }

        // Issue a fresh pair under the same family (grace window allowed the retry).
        const { accessToken, refreshToken } = await issueTokens(
          user,
          stored.clientId,
          stored.scope,
          stored.familyId,
        );
        return tokenResponse(accessToken, refreshToken, stored.scope);
      }
    }

    // Outside grace window, or successor was used/revoked — this is a replay.
    // Revoke the entire family (theft detection).
    await prisma.oAuthRefreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return oauthError("invalid_grant", "Refresh token has been revoked.");
  }

  if (stored.expiresAt < new Date()) {
    await prisma.oAuthRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return oauthError("invalid_grant", "Refresh token expired.");
  }

  if (clientId && stored.clientId !== clientId) {
    return oauthError("invalid_grant", "client_id mismatch.");
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    await prisma.oAuthRefreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return oauthError("invalid_grant", "User no longer exists.");
  }

  // Rotate: mint a new pair in the same family, then mark the presented token rotated.
  const { accessToken, refreshToken, refreshId } = await issueTokens(
    user,
    stored.clientId,
    stored.scope,
    stored.familyId,
  );
  await prisma.oAuthRefreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date(), replacedById: refreshId },
  });

  return tokenResponse(accessToken, refreshToken, stored.scope);
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
    return oauthError(
      "invalid_request",
      "Unsupported content type.",
    );
  }

  const grantType = params.get("grant_type");
  if (grantType === "authorization_code") {
    return handleAuthorizationCode(params);
  }
  if (grantType === "refresh_token") {
    return handleRefreshToken(params);
  }
  return oauthError(
    "unsupported_grant_type",
    "Only authorization_code and refresh_token are supported.",
  );
}
