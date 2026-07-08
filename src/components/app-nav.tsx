"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/lib/auth-actions";

const LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/trips", label: "Trips" },
  { href: "/locations", label: "Locations" },
  { href: "/contacts", label: "Contacts" },
  { href: "/presentations", label: "Presentations" },
  { href: "/admin", label: "Admin", adminOnly: true },
];

// Admin sub-screens — keep the Admin nav item highlighted while on any of them.
const ADMIN_PATHS = ["/admin", "/trip-types", "/schedule-categories"];

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/admin") return ADMIN_PATHS.some((p) => pathname.startsWith(p));
  return pathname.startsWith(href);
}

export function AppNav({
  user,
}: {
  user: { name?: string | null; email: string; role: Role };
}) {
  const pathname = usePathname();

  const links = LINKS.filter((l) => !l.adminOnly || user.role === "ADMIN");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
        <Link href="/" className="mr-2 font-semibold">
          Tour&nbsp;Planner
        </Link>

        {/* Desktop: inline links. Hidden on mobile to avoid horizontal scroll. */}
        <nav className="hidden flex-1 items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(link.href, pathname)
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <span className="hidden text-xs text-muted-foreground sm:inline">
          {user.name ?? user.email} · {user.role}
        </span>
        <form action={signOutAction} className="hidden sm:block">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>

        {/* Mobile: everything collapses into a single menu on the right. */}
        <div className="ml-auto sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Menu">
                <Menu className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {user.name ?? user.email} · {user.role}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {links.map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <Link
                    href={link.href}
                    className={cn(
                      isActive(link.href, pathname) && "font-medium",
                    )}
                  >
                    {link.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <form action={signOutAction}>
                  <button type="submit" className="w-full text-left">
                    Sign out
                  </button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
