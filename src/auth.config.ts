import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

// Edge-safe Auth.js config shared by middleware and the full Node config.
// No database or bcrypt access here so it can run in the Edge runtime.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    // Credentials provider requires JWT sessions.
    strategy: "jwt",
  },
  providers: [
    // The Credentials provider (which needs Prisma + bcrypt) is added in
    // src/lib/auth.ts so it never gets bundled into the Edge middleware.
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
