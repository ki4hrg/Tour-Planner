import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** The chip look, shared by the link chip and the in-page toggle chip. */
export function filterChipClass(active: boolean, className?: string): string {
  return cn(
    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm focus-ring pointer-coarse:min-h-10",
    active ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
    className,
  );
}

// The one URL-param filter chip (a navigating control, so a Link). In-page view
// switches over the same data use <Tabs> instead.
export function FilterChip({
  active,
  className,
  ...props
}: ComponentProps<typeof Link> & { active: boolean }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={filterChipClass(active, className)}
      {...props}
    />
  );
}

// The same chip for a filter a Client Component keeps in the URL itself
// (history.replaceState, no server round trip) — a toggle, so a button.
export function FilterChipButton({
  active,
  className,
  ...props
}: ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={filterChipClass(active, className)}
      {...props}
    />
  );
}
