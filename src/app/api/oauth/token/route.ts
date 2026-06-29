import { prisma } from "@/lib/db";
import {
  createAccessToken,
  verifyCodeChallengeAsync,
} from "@/lib/mcp/auth";

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

  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code") {
    return Response.json(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code is supported.",
      },
      { status: 400 },
    );
  }

  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");
  const clientId = params.get("client_id");

  if (!code || !redirectUri || !codeVerifier) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "Missing code, redirect_uri, or code_verifier.",
      },
      { status: 400 },
    );
  }

  const authCode = await prisma.oAuthAuthorizationCode.findUnique({
    where: { code },
  });

  if (!authCode) {
    return Response.json(
      { error: "invalid_grant", error_description: "Unknown authorization code." },
      { status: 400 },
    );
  }

  if (authCode.usedAt) {
    // Code replay — revoke by deleting it
    await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });
    return Response.json(
      { error: "invalid_grant", error_description: "Authorization code already used." },
      { status: 400 },
    );
  }

  if (authCode.expiresAt < new Date()) {
    await prisma.oAuthAuthorizationCode.delete({ where: { id: authCode.id } });
    return Response.json(
      { error: "invalid_grant", error_description: "Authorization code expired." },
      { status: 400 },
    );
  }

  if (authCode.redirectUri !== redirectUri) {
    return Response.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch." },
      { status: 400 },
    );
  }

  if (clientId && authCode.clientId !== clientId) {
    return Response.json(
      { error: "invalid_grant", error_description: "client_id mismatch." },
      { status: 400 },
    );
  }

  const pkceValid = await verifyCodeChallengeAsync(
    codeVerifier,
    authCode.codeChallenge,
  );
  if (!pkceValid) {
    return Response.json(
      { error: "invalid_grant", error_description: "PKCE verification failed." },
      { status: 400 },
    );
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
    return Response.json(
      { error: "invalid_grant", error_description: "User no longer exists." },
      { status: 400 },
    );
  }

  const accessToken = await createAccessToken(user);

  return Response.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: authCode.scope || "",
  });
}
