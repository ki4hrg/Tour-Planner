import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const role = req.auth?.user?.role;
  const path = nextUrl.pathname;

  // Already-authenticated users shouldn't see the login page.
  if (path === "/login") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", nextUrl));
    }
    return NextResponse.next();
  }

  // Everything else under the matcher requires a session.
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only area.
  if (path.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Run on app routes, but skip Next internals, auth API, the public share
  // pages, and static PWA assets. Fine-grained write gating happens in the
  // server actions themselves.
  //
  // `.well-known` must be excluded here too: middleware runs BEFORE the
  // next.config rewrites that map `/.well-known/oauth-*` to `/api/well-known/*`,
  // so it sees the public source path. Without this, OAuth discovery would be
  // redirected to /login and MCP clients could never authenticate.
  matcher: [
    "/((?!api/auth|api/mcp|api/oauth|api/well-known|api/feed|api/share|\\.well-known|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|share|setup).*)",
  ],
};
