import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// Carry the user's id + role through the session and JWT.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
