import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/validators/auth";
import { scopesForRole } from "@/lib/mcp/auth";

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function renderForm(params: {
  clientName: string | null;
  error?: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
}) {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const errorHtml = params.error
    ? `<p style="color:#dc2626;margin-bottom:16px">${esc(params.error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tour Planner — Authorize</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 32px; max-width: 380px; width: 100%; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    input[type=email], input[type=password] { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; margin-bottom: 16px; }
    button { width: 100%; padding: 10px; background: #1e293b; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { background: #334155; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Tour Planner</h1>
    <p class="sub">${params.clientName ? `Authorize <strong>${esc(params.clientName)}</strong>` : "Sign in to authorize access"}</p>
    ${errorHtml}
    <form method="POST">
      <input type="hidden" name="client_id" value="${esc(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${esc(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${esc(params.codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${esc(params.codeChallengeMethod)}">
      <input type="hidden" name="state" value="${esc(params.state)}">
      <input type="hidden" name="scope" value="${esc(params.scope)}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

async function validateOAuthParams(url: URL) {
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod =
    url.searchParams.get("code_challenge_method") || "S256";
  const state = url.searchParams.get("state") || "";
  const scope = url.searchParams.get("scope") || "";
  const responseType = url.searchParams.get("response_type");

  if (responseType && responseType !== "code") {
    return { error: "Only response_type=code is supported." };
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return {
      error: "Missing required parameters: client_id, redirect_uri, code_challenge.",
    };
  }
  if (codeChallengeMethod !== "S256") {
    return { error: "Only S256 code_challenge_method is supported." };
  }

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });
  if (!client) {
    return { error: "Unknown client_id." };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return { error: "redirect_uri is not registered for this client." };
  }

  return {
    client,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state,
    scope,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await validateOAuthParams(url);

  if ("error" in result) {
    return html(
      `<p style="font-family:system-ui;padding:40px">${result.error}</p>`,
      400,
    );
  }

  return html(
    renderForm({
      clientName: result.client.clientName,
      clientId: result.clientId,
      redirectUri: result.redirectUri,
      codeChallenge: result.codeChallenge,
      codeChallengeMethod: result.codeChallengeMethod,
      state: result.state,
      scope: result.scope,
    }),
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const codeChallengeMethod = String(
    formData.get("code_challenge_method") ?? "S256",
  );
  const state = String(formData.get("state") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const client = await prisma.oAuthClient.findUnique({
    where: { clientId },
  });
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return html("<p>Invalid client or redirect URI.</p>", 400);
  }

  const parsed = loginSchema.safeParse({ email, password });
  if (!parsed.success) {
    return html(
      renderForm({
        clientName: client.clientName,
        error: "Please enter a valid email and password.",
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        scope,
      }),
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!user) {
    return html(
      renderForm({
        clientName: client.clientName,
        error: "Invalid email or password.",
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        scope,
      }),
    );
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    return html(
      renderForm({
        clientName: client.clientName,
        error: "Invalid email or password.",
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        scope,
      }),
    );
  }

  const grantedScope = scope || scopesForRole(user.role);

  const authCode = await prisma.oAuthAuthorizationCode.create({
    data: {
      clientId,
      userId: user.id,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope: grantedScope,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  // Clean up expired codes opportunistically
  prisma.oAuthAuthorizationCode
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", authCode.code);
  if (state) redirect.searchParams.set("state", state);

  return Response.redirect(redirect.toString(), 302);
}
