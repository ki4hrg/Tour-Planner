"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/trips", label: "Trips" },
  { href: "/sites", label: "Sites" },
  { href: "/contacts", label: "Contacts" },
  { href: "/admin", label: "Admin", adminOnly: true },
];

// Admin sub-screens — keep the Admin nav item highlighted while on any of them.
const ADMIN_PATHS = ["/admin", "/trip-types", "/schedule-categories"];

export function AppNav({
  user,
}: {
  user: { name?: string | null; email: string; role: Role };
}) {
  const pathname = usePathname();

  const links = LINKS.filter((l) => !l.adminOnly || user.role === "ADMIN");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
        <Link href="/" className="mr-2 font-semibold">
          Tour&nbsp;Planner
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : link.href === "/admin"
                  ? ADMIN_PATHS.some((p) => pathname.startsWith(p))
                  : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {user.name ?? user.email} · {user.role}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
